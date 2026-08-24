/**
 * Versioned AI-figure caches.
 *
 * The scanned graph's `generatedAt` is the "facts version": a rescan (file
 * change detected) rebuilds the graph with a fresh generatedAt, so every
 * figure cache written against an older graph is stale. Instead of physically
 * deleting the cache files (which forces a full LLM re-generation on the next
 * panel open — the "reopen is slow" symptom), each cache records the facts
 * version it was generated against and readers simply refuse a mismatched
 * version. Reopening the panel without a rescan keeps the same facts version,
 * so the caches are served instantly.
 */
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
/**
 * Current facts version (graph.generatedAt), or 0 when the graph is
 * unavailable. Version 0 disables caching entirely (safest direction: an
 * unknown facts version must never serve or persist a cache).
 */
export declare function readFactVersion(fs: FileSystem, root: string): Promise<number>;
/**
 * Versioned cache read: only data written against the CURRENT facts version
 * is served. Old-version, unversioned-legacy, corrupt or missing files all
 * read as null → the chain regenerates and rewrites the cache.
 */
export declare function readVersionedCache<T>(fs: FileSystem, target: FsTarget, version: number): Promise<T | null>;
/**
 * Versioned cache write. Skipped entirely when the facts version is unknown
 * (0) so an unverifiable cache can never be served later. `deps` records the
 * package ids this figure was derived from; the rescan invalidation uses it to
 * invalidate only the figures whose facts actually moved (selective
 * invalidation). Absent `deps` ⇒ no field is written (legacy-compatible) and
 * the invalidation treats the cache as depending on every package.
 */
export declare function writeVersionedCache<T>(fs: FileSystem, target: FsTarget, data: T, version: number, sandboxPolicy?: SandboxExecutionPolicy, deps?: string[]): Promise<void>;
/** Raw versioned-cache envelope, read WITHOUT the facts-version check — used
 * by selective invalidation to inspect a cache's dependency packages. */
export interface RawVersionedCache {
    v: number;
    /** Package ids this figure was derived from. */
    deps: string[];
    /** Whether the cache file actually carries a `deps` field: false = legacy
     * cache written before deps existed (⇒ depends on every package). */
    depsPresent: boolean;
    data: unknown;
}
/**
 * Read a cache file's `{ v, deps, data }` envelope regardless of whether its
 * version is current. Non-versioned, corrupt or missing files read as null.
 */
export declare function readRawCache(fs: FileSystem, target: FsTarget): Promise<RawVersionedCache | null>;
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
export declare function selectiveInvalidate(fs: FileSystem, root: string, changedPackages: ReadonlySet<string>, newFactsVersion: number, sandboxPolicy?: SandboxExecutionPolicy): Promise<void>;
//# sourceMappingURL=fact-cache.d.ts.map