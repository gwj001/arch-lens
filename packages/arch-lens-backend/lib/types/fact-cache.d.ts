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
 *
 * A FAILED write THROWS instead of being swallowed: a write path that just
 * spent minutes on LLM generation must surface "could not persist" to the
 * user (e.g. the session sandbox is read-only) rather than silently reporting
 * success while every cache stays stale — that produced the "生成成功但图全空"
 * symptom. Callers either let it propagate (generateAll steps collect it) or
 * convert it into an error result.
 */
export declare function writeVersionedCache<T>(fs: FileSystem, target: FsTarget, data: T, version: number, sandboxPolicy?: SandboxExecutionPolicy, deps?: string[], requires?: readonly string[]): Promise<void>;
/** Raw versioned-cache envelope, read WITHOUT the facts-version check — used
 * by selective invalidation to inspect a cache's dependency packages. */
export interface RawVersionedCache {
    v: number;
    /** Package ids this figure was derived from. */
    deps: string[];
    /** Whether the cache file actually carries a `deps` field: false = legacy
     * cache written before deps existed (⇒ depends on every package). */
    depsPresent: boolean;
    /** Logical spine dependencies (phase 2): cache-kind ids whose CONTENT this
     * cache consumed (e.g. a chapter embedding a figure). Absent ⇒ []. Unlike
     * `deps` (package facts, covered by the facts version) these can move
     * WITHOUT a facts-version change — `invalidateRequiring` covers them. */
    requires: string[];
    data: unknown;
}
/**
 * Read a cache file's `{ v, deps, requires, data }` envelope regardless of
 * whether its version is current. Non-versioned, corrupt or missing files
 * read as null.
 */
export declare function readRawCache(fs: FileSystem, target: FsTarget): Promise<RawVersionedCache | null>;
/**
 * Prior-draft read for incremental revision (comprehension-spine phase 1).
 * Returns a STALE cache's data as a "prior draft" when the envelope exists,
 * carries a REAL version (not the `{v:0}` invalidation tombstone), but does
 * NOT match the current facts version. A current-version cache is NOT a prior
 * (the fresh read serves it); missing, legacy-unversioned, tombstone or
 * data-less files all read as null.
 *
 * Unlike `readVersionedCache` this never SERVES the data to a reader — it only
 * feeds a revision prompt, where the fresh facts remain authoritative. Callers
 * pair it with `force`: a forced rebuild must skip the prior (escape hatch).
 * @param fs - filesystem service.
 * @param target - resolved cache file.
 * @param version - the CURRENT facts version.
 * @returns the stale data as a prior draft, or null.
 */
export declare function readStalePrior<T>(fs: FileSystem, target: FsTarget, version: number): Promise<T | null>;
/**
 * Cascade invalidation over the logical spine (comprehension-spine phase 2).
 * Tombstone (`{v:0}`) every versioned cache whose envelope `requires` the
 * given node — i.e. every cache that CONSUMED that node's content. This covers
 * dependencies that move WITHOUT a facts-version change (e.g. a figure that is
 * regenerated in place, which a chapter embedding it must notice), which the
 * facts-version read cannot see. Best-effort per file; never touches the facts
 * source, user draw assets, or non-envelope files.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param node - the cache-kind id that changed (e.g. 'seq', 'flow-event').
 * @param sandboxPolicy - session-scoped write policy.
 * @returns the cache file names actually tombstoned.
 */
export declare function invalidateRequiring(fs: FileSystem, root: string, node: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<string[]>;
/**
 * Selective invalidation (rescan with changes) — TWO passes.
 *
 * Pass 1 (entity/profile caches): a cache whose `deps` intersects
 * `changedPackages` is invalidated (written as `{ v: 0 }`, which no read can
 * ever match), while every other cache has its version re-stamped to
 * `newFactsVersion` (content and deps unchanged) so it keeps being served
 * after the graph rebuild. A legacy cache without a deps field depends on
 * every package → invalidated. A cache with an explicit empty deps (e.g. a
 * doc-sourced flow) depends on nothing → only re-stamped, never invalidated.
 * Each invalidated figure kind is recorded for the cascade below.
 *
 * Pass 2 (dynamic drill-down figures, D1): a versioned `.arch-lens-dynamic-*`
 * cache is invalidated when its own `deps` hit the change set, OR its parent
 * entity figure was invalidated in pass 1 (seq-edge→sequence,
 * flow-subgraph→flow), OR it is an overview (whole-workspace view: depends on
 * every package), OR it is a legacy unversioned file (no longer servable by
 * the version-bound read anyway — mark it so the hover regenerates cleanly).
 * Survivors are re-stamped like entity caches. `.arch-lens-draw-*` (user
 * assets) are never touched.
 */
export declare function selectiveInvalidate(fs: FileSystem, root: string, changedPackages: ReadonlySet<string>, newFactsVersion: number, sandboxPolicy?: SandboxExecutionPolicy): Promise<void>;
/**
 * Tombstone sweep (rescan tail): physically remove `.arch-lens-*.json` files
 * NO CURRENT READER CAN EVER SERVE. Every cache the current code writes is a
 * `{ v, deps, data }` envelope, so an UNVERSIONED file in a figure family is
 * a pre-versioning leftover (e.g. the angle-less `.arch-lens-flow-<lang>.json`
 * era) or corruption — the version-bound read already refuses it, and neither
 * invalidation nor any named delete ever reaches it, so without this sweep it
 * lingers forever. Invalidation markers (`{ v: 0 }`) ARE envelopes and stay:
 * they are managed graves the current code wrote.
 * Runs under the rescan's writable gate (remoteRefresh checks ensureWritable
 * first); best-effort per file — a locked/already-gone file is skipped.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param remove - removal strategy; defaults to a physical unlink via
 *   processPath (the dsh-fs service has no delete). Tests inject a fake.
 * @returns the names actually removed.
 */
export declare function sweepLegacyCaches(fs: FileSystem, root: string, remove?: (target: FsTarget) => Promise<void>): Promise<string[]>;
//# sourceMappingURL=fact-cache.d.ts.map