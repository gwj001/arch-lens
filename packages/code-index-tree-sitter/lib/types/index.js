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
    ctx.provide('codeIndex', new CodeIndexTreeSitter(ctx, fs));
}
/** Extract one source file into imports and entities by language. */
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
/** The provider implementation. */
class CodeIndexTreeSitter extends CodeIndex {
    fs;
    cache = new Map();
    constructor(ctx, fs) {
        super(ctx);
        this.fs = fs;
    }
    indexWorkspace(root) {
        let run = this.cache.get(root);
        if (run === undefined) {
            run = this.index(root);
            this.cache.set(root, run);
        }
        return run;
    }
    async index(root) {
        const language = await detectLanguage(this.fs, root);
        if (language === 'unknown')
            return { root, language, packages: [] };
        const packageRoots = await discoverPackageRoots(this.fs, root, language);
        const packages = [];
        for (const pkgDir of packageRoots) {
            const pkg = await this.indexPackage(root, pkgDir, language);
            if (pkg !== undefined)
                packages.push(pkg);
        }
        return { root, language, packages };
    }
    async indexPackage(root, pkgDir, language) {
        const files = await collectSources(this.fs, pkgDir, language);
        if (files.length === 0)
            return undefined;
        const deps = await manifestDeps(this.fs, pkgDir, language);
        const entities = [];
        const imports = [];
        const entryFiles = [];
        for (const file of files) {
            const rel = relPath(root, file.displayPath);
            const source = await readSmall(this.fs, file);
            if (source === null)
                continue;
            const extracted = extractFile(rel, source, language);
            entities.push(...extracted.entities);
            imports.push(...extracted.imports);
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