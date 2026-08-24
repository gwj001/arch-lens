import { CACHE_DIR } from "./cache-dir.js";
/** The graph cache file whose generatedAt is the facts version. */
const GRAPH_CACHE_FILE = `${CACHE_DIR}/.arch-lens-graph.json`;
/**
 * Current facts version (graph.generatedAt), or 0 when the graph is
 * unavailable. Version 0 disables caching entirely (safest direction: an
 * unknown facts version must never serve or persist a cache).
 */
export async function readFactVersion(fs, root) {
    try {
        const target = await fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return 0;
        const parsed = JSON.parse(await fs.readText(target));
        return typeof parsed.generatedAt === 'number' && Number.isFinite(parsed.generatedAt) ? parsed.generatedAt : 0;
    }
    catch {
        return 0;
    }
}
/**
 * Versioned cache read: only data written against the CURRENT facts version
 * is served. Old-version, unversioned-legacy, corrupt or missing files all
 * read as null → the chain regenerates and rewrites the cache.
 */
export async function readVersionedCache(fs, target, version) {
    if (version === 0)
        return null;
    try {
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return null;
        const parsed = JSON.parse(await fs.readText(target));
        if (parsed.v !== version)
            return null;
        return parsed.data;
    }
    catch {
        return null;
    }
}
/**
 * Versioned cache write. Skipped entirely when the facts version is unknown
 * (0) so an unverifiable cache can never be served later. `deps` records the
 * package ids this figure was derived from; the rescan invalidation uses it to
 * invalidate only the figures whose facts actually moved (selective
 * invalidation). Absent `deps` ⇒ no field is written (legacy-compatible) and
 * the invalidation treats the cache as depending on every package.
 */
export async function writeVersionedCache(fs, target, data, version, sandboxPolicy, deps) {
    if (version === 0)
        return;
    try {
        const wrapped = { v: version, data };
        if (deps !== undefined && deps.length > 0)
            wrapped.deps = [...new Set(deps)];
        await fs.writeText(target, JSON.stringify(wrapped), undefined, undefined, sandboxPolicy);
    }
    catch {
        // best-effort cache write
    }
}
/**
 * Read a cache file's `{ v, deps, data }` envelope regardless of whether its
 * version is current. Non-versioned, corrupt or missing files read as null.
 */
export async function readRawCache(fs, target) {
    try {
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return null;
        const parsed = JSON.parse(await fs.readText(target));
        if (typeof parsed.v !== 'number')
            return null;
        const deps = Array.isArray(parsed.deps)
            ? parsed.deps.filter((d) => typeof d === 'string')
            : [];
        return { v: parsed.v, deps, depsPresent: Array.isArray(parsed.deps), data: parsed.data };
    }
    catch {
        return null;
    }
}
/** Cache files the rescan invalidation must never touch (they are either the
 * facts source itself, or non-figure artifacts). */
const SKIP_INVALIDATION = new Set([
    '.arch-lens-graph.json',
    '.arch-lens-file-manifest.json',
    '.arch-lens-index.json',
    '.arch-lens-llm-stats.json',
    '.arch-lens-progress-default.json',
]);
/**
 * Selective invalidation (rescan with changes): for every versioned figure
 * cache under the cache dir, a cache whose `deps` intersects `changedPackages`
 * is invalidated (written as `{ v: 0 }`, which no read can ever match), while
 * every other cache has its version re-stamped to `newFactsVersion` (content
 * and deps unchanged) so it keeps being served after the graph rebuild.
 * A legacy cache without a deps field depends on every package → invalidated.
 * A cache with an explicit empty deps (e.g. a doc-sourced flow) depends on
 * nothing → only re-stamped, never invalidated.
 */
export async function selectiveInvalidate(fs, root, changedPackages, newFactsVersion, sandboxPolicy) {
    const dir = await fs.resolve(CACHE_DIR, { cwd: root }).catch(() => null);
    if (dir === null)
        return;
    let entries;
    try {
        entries = await fs.listDir(dir);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (entry.type !== 'file')
            continue;
        if (!entry.name.startsWith('.arch-lens-') || !entry.name.endsWith('.json'))
            continue;
        if (SKIP_INVALIDATION.has(entry.name))
            continue;
        const raw = await readRawCache(fs, entry.target);
        if (raw === null)
            continue;
        // Legacy (no deps field) ⇒ depends on every package. Explicit empty deps
        // (doc-sourced) ⇒ depends on nothing.
        const hit = !raw.depsPresent || raw.deps.some(d => changedPackages.has(d));
        if (hit) {
            // Invalidate: v=0 can never equal any real facts version.
            await fs.writeText(entry.target, JSON.stringify({ v: 0 }), undefined, undefined, sandboxPolicy).catch(() => { });
        }
        else {
            const wrapped = { v: newFactsVersion, data: raw.data };
            if (raw.depsPresent)
                wrapped.deps = raw.deps;
            await fs.writeText(entry.target, JSON.stringify(wrapped), undefined, undefined, sandboxPolicy).catch(() => { });
        }
    }
}
//# sourceMappingURL=fact-cache.js.map