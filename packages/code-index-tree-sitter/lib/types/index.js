/**
 * tree-sitter provider for the code-index seam: detects the workspace
 * language, discovers packages, and extracts entities/imports per language.
 * Cached per workspace root; a fresh call re-indexes.
 * @module @deepseek-ai/dsh-code-index-tree-sitter
 */
import { CodeIndex } from '@deepseek-ai/dsh-code-index';
import { collectSources, detectLanguage, discoverPackageRoots, manifestDeps, readSmall, relPath, } from "./discover.js";
import { extractJava } from "./java-adapter.js";
import { extractPython } from "./python-adapter.js";
import { extractTs } from "./ts-adapter.js";
import { unwrapIndexEnvelope, wrapIndexEnvelope } from "./envelope.js";
/** Disk cache file under the shared workspace cache directory (`index/`,
 * mirrored from the arch-lens backend's CACHE_DIR so all artifacts land in
 * one place; the cross-package constant is unreachable at runtime because
 * `@deepseek-ai/dsh-code-index` resolves to the harness copy). */
const INDEX_CACHE_FILE = 'index/.arch-lens-index.json';
/** Max packages indexed concurrently (fs IO is the bottleneck). */
const CONCURRENCY = 8;
/** Service required before indexing can read files. */
export const inject = ['fs'];
/**
 * The tree-sitter provider body: provide the codeIndex service.
 * @param ctx - host context.
 */
export function apply(ctx) {
    const fs = ctx.get('fs');
    if (fs === undefined)
        throw new Error('code-index-tree-sitter requires the fs service');
    new CodeIndexTreeSitter(ctx, fs);
}
/** Extract one source file into imports, entities, and calls by language. */
function extractFile(rel, source, language) {
    switch (language) {
        case 'typescript':
            return extractTs(rel, source);
        case 'python':
            return extractPython(rel, source);
        case 'java':
            return extractJava(rel, source);
    }
}
/** Run `work` over items with bounded concurrency. */
async function mapLimit(items, limit, work) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            out[index] = await work(items[index]);
        }
    });
    await Promise.all(workers);
    return out;
}
/** The provider implementation. */
class CodeIndexTreeSitter extends CodeIndex {
    fs;
    cache = new Map();
    constructor(ctx, fs) {
        super(ctx);
        this.fs = fs;
    }
    indexWorkspace(root, sandboxPolicy, factsVersion = 0) {
        // The in-memory run is version-bound too: the same root must never serve
        // an index built against a different facts version (defense in depth for
        // callers that skip the refresh() invalidation).
        const key = `${factsVersion}\u0000${root}`;
        let run = this.cache.get(key);
        if (run === undefined) {
            run = this.index(root, sandboxPolicy, factsVersion);
            this.cache.set(key, run);
        }
        return run;
    }
    /**
     * Force-invalidate: drop the in-memory run and blank the on-disk cache (an
     * unparseable file reads back as "no cache", so the next indexWorkspace
     * re-indexes from current sources). Used by rescan and "refresh this
     * figure" — a stale index after code changed is never legal.
     * @param root - absolute workspace root.
     * @param sandboxPolicy - session-scoped policy for the disk write.
     */
    async refresh(root, sandboxPolicy) {
        for (const key of [...this.cache.keys()]) {
            if (key.endsWith(`\u0000${root}`))
                this.cache.delete(key);
        }
        try {
            const target = await this.resolveCacheFile(root);
            if (target !== null)
                await this.fs.writeText(target, '', undefined, undefined, sandboxPolicy);
        }
        catch {
            // best-effort disk invalidation; a missing cache is just a re-index
        }
        console.log(`[code-index] refresh: index invalidated for ${root}`);
    }
    async index(root, sandboxPolicy, factsVersion = 0) {
        const language = await detectLanguage(this.fs, root);
        if (language === 'unknown')
            return { root, language, packages: [] };
        // Disk cache: a finished index survives process restarts, so the 30s RPC
        // budget never has to re-run a multi-minute first index. Version-bound:
        // a disk entry only serves the facts version it was built for, and an
        // unknown version (0) neither reads nor persists (v=0 discipline).
        const cacheFile = await this.resolveCacheFile(root);
        const cached = cacheFile === null || factsVersion === 0 ? null : await this.readCache(cacheFile, language, factsVersion);
        if (cached !== null) {
            console.log(`[code-index] serving disk cache (${cached.packages.length} packages)`);
            return cached;
        }
        const packageRoots = await discoverPackageRoots(this.fs, root, language);
        const results = await mapLimit(packageRoots, CONCURRENCY, pkgDir => this.indexPackage(root, pkgDir, language));
        const packages = results.filter((pkg) => pkg !== undefined);
        const calls = packages.flatMap(pkg => pkg.calls ?? []);
        const result = { root, language, packages, ...(calls.length > 0 ? { calls } : {}) };
        if (cacheFile !== null && factsVersion !== 0) {
            try {
                await this.fs.writeText(cacheFile, wrapIndexEnvelope(factsVersion, result), undefined, undefined, sandboxPolicy);
                console.log(`[code-index] disk cache written (${packages.length} packages)`);
            }
            catch (error) {
                console.warn(`[code-index] cache write failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return result;
    }
    /** Resolve the cache file target under the workspace root, or null. */
    async resolveCacheFile(root) {
        try {
            return await this.fs.resolve(INDEX_CACHE_FILE, { cwd: root });
        }
        catch {
            return null;
        }
    }
    /** Read the versioned cache file; a legacy/unversioned, foreign-version or
     * wrong-language file is a miss (the caller then rebuilds from sources).
     * @param target - the resolved cache file target.
     * @param language - the workspace language detected for this request.
     * @param factsVersion - the current facts version to match against.
     * @returns the cached index, or null when it may not be served.
     */
    async readCache(target, language, factsVersion) {
        try {
            const info = await this.fs.stat(target);
            if (info === undefined || info.type !== 'file')
                return null;
            const text = await this.fs.readText(target);
            return unwrapIndexEnvelope(text, factsVersion, language);
        }
        catch {
            return null;
        }
    }
    async indexPackage(root, pkgDir, language) {
        const files = await collectSources(this.fs, pkgDir, language);
        if (files.length === 0)
            return undefined;
        const deps = await manifestDeps(this.fs, pkgDir, language);
        const entities = [];
        const imports = [];
        const calls = [];
        const entryFiles = [];
        for (const file of files) {
            const rel = relPath(root, file.displayPath);
            const source = await readSmall(this.fs, file);
            if (source === null)
                continue;
            const extracted = extractFile(rel, source, language);
            entities.push(...extracted.entities);
            imports.push(...extracted.imports);
            calls.push(...(extracted.calls ?? []));
            if (isEntryFile(rel, language))
                entryFiles.push(rel);
        }
        return {
            id: shortId(pkgDir, language),
            path: pkgDir,
            language,
            deps,
            entities,
            imports,
            entryFiles,
            ...(calls.length > 0 ? { calls } : {}),
        };
    }
}
/** Whether a relative file looks like an entry point for the language. */
function isEntryFile(rel, language) {
    const name = rel.split('/').at(-1) ?? '';
    if (language === 'typescript')
        return name === 'index.ts' || name === 'index.tsx' || name === 'index.js';
    if (language === 'python')
        return name === '__init__.py' || name === 'main.py' || name === 'cli.py';
    return /(Main|Application|App|Launcher)\.java$/.test(name);
}
/** Short package id: last path segment, npm scope stripped. */
function shortId(pkgDir, language) {
    const last = pkgDir.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? pkgDir;
    if (language === 'typescript')
        return last.replace(/^@[^/]+\//, '');
    return last;
}
//# sourceMappingURL=index.js.map