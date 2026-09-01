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
import { unlink } from 'node:fs/promises'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { CACHE_DIR } from './cache-dir.ts'

/** The graph cache file whose generatedAt is the facts version. */
const GRAPH_CACHE_FILE = `${CACHE_DIR}/.arch-lens-graph.json`

/**
 * Current facts version (graph.generatedAt), or 0 when the graph is
 * unavailable. Version 0 disables caching entirely (safest direction: an
 * unknown facts version must never serve or persist a cache).
 */
export async function readFactVersion(fs: FileSystem, root: string): Promise<number> {
  try {
    const target = await fs.resolve(GRAPH_CACHE_FILE, { cwd: root })
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file') return 0
    const parsed = JSON.parse(await fs.readText(target)) as { generatedAt?: unknown }
    return typeof parsed.generatedAt === 'number' && Number.isFinite(parsed.generatedAt) ? parsed.generatedAt : 0
  } catch {
    return 0
  }
}

/**
 * Versioned cache read: only data written against the CURRENT facts version
 * is served. Old-version, unversioned-legacy, corrupt or missing files all
 * read as null → the chain regenerates and rewrites the cache.
 */
export async function readVersionedCache<T>(fs: FileSystem, target: FsTarget, version: number): Promise<T | null> {
  if (version === 0) return null
  try {
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file') return null
    const parsed = JSON.parse(await fs.readText(target)) as { v?: unknown; data?: unknown }
    if (parsed.v !== version) return null
    return parsed.data as T
  } catch {
    return null
  }
}

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
export async function writeVersionedCache<T>(
  fs: FileSystem,
  target: FsTarget,
  data: T,
  version: number,
  sandboxPolicy?: SandboxExecutionPolicy,
  deps?: string[],
  requires?: readonly string[],
): Promise<void> {
  if (version === 0) return
  const wrapped: { v: number; deps?: string[]; requires?: string[]; data: T } = { v: version, data }
  if (deps !== undefined && deps.length > 0) wrapped.deps = [...new Set(deps)]
  if (requires !== undefined && requires.length > 0) wrapped.requires = [...new Set(requires)]
  await fs.writeText(target, JSON.stringify(wrapped), undefined, undefined, sandboxPolicy)
}

/** Raw versioned-cache envelope, read WITHOUT the facts-version check — used
 * by selective invalidation to inspect a cache's dependency packages. */
export interface RawVersionedCache {
  v: number
  /** Package ids this figure was derived from. */
  deps: string[]
  /** Whether the cache file actually carries a `deps` field: false = legacy
   * cache written before deps existed (⇒ depends on every package). */
  depsPresent: boolean
  /** Logical spine dependencies (phase 2): cache-kind ids whose CONTENT this
   * cache consumed (e.g. a chapter embedding a figure). Absent ⇒ []. Unlike
   * `deps` (package facts, covered by the facts version) these can move
   * WITHOUT a facts-version change — `invalidateRequiring` covers them. */
  requires: string[]
  data: unknown
}

/**
 * Read a cache file's `{ v, deps, requires, data }` envelope regardless of
 * whether its version is current. Non-versioned, corrupt or missing files
 * read as null.
 */
export async function readRawCache(fs: FileSystem, target: FsTarget): Promise<RawVersionedCache | null> {
  try {
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file') return null
    const parsed = JSON.parse(await fs.readText(target)) as { v?: unknown; deps?: unknown; requires?: unknown; data?: unknown }
    if (typeof parsed.v !== 'number') return null
    const deps = Array.isArray(parsed.deps)
      ? parsed.deps.filter((d): d is string => typeof d === 'string')
      : []
    const requires = Array.isArray(parsed.requires)
      ? parsed.requires.filter((d): d is string => typeof d === 'string')
      : []
    return { v: parsed.v, deps, depsPresent: Array.isArray(parsed.deps), requires, data: parsed.data }
  } catch {
    return null
  }
}

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
export async function readStalePrior<T>(fs: FileSystem, target: FsTarget, version: number): Promise<T | null> {
  if (version === 0) return null
  const raw = await readRawCache(fs, target)
  if (raw === null || raw.v === 0 || raw.v === version) return null
  if (raw.data === null || raw.data === undefined) return null
  return raw.data as T
}

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
export async function invalidateRequiring(
  fs: FileSystem,
  root: string,
  node: string,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<string[]> {
  const dir = await fs.resolve(CACHE_DIR, { cwd: root }).catch(() => null)
  if (dir === null) return []
  let entries
  try {
    entries = await fs.listDir(dir)
  } catch {
    return []
  }
  const tombstoned: string[] = []
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    if (!entry.name.startsWith('.arch-lens-') || !entry.name.endsWith('.json')) continue
    if (SKIP_INVALIDATION.has(entry.name) || entry.name.startsWith('.arch-lens-draw-')) continue
    const raw = await readRawCache(fs, entry.target)
    if (raw === null || raw.v === 0) continue // absent or already a grave
    if (!raw.requires.includes(node)) continue
    await fs.writeText(entry.target, JSON.stringify({ v: 0 }), undefined, undefined, sandboxPolicy)
      .then(() => { tombstoned.push(entry.name) })
      .catch(() => {}) // locked / gone — skip, not fatal
  }
  return tombstoned
}

/** Cache files the rescan invalidation must never touch (they are either the
 * facts source itself, or non-figure artifacts). */
const SKIP_INVALIDATION = new Set([
  '.arch-lens-graph.json',
  '.arch-lens-file-manifest.json',
  '.arch-lens-index.json',
  '.arch-lens-llm-stats.json',
  '.arch-lens-progress-default.json',
])

/** Entity cache file prefix → kind-family label (the key the dynamic-figure
 * cascade matches on: a drill-down dies together with its parent figure). */
const ENTITY_KIND_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['.arch-lens-concept', 'concept'],
  ['.arch-lens-sequence', 'sequence'],
  ['.arch-lens-events', 'events'],
  ['.arch-lens-flow', 'flow'],
  ['.arch-lens-core', 'core'],
  ['.arch-lens-summaries', 'summaries'],
  ['.arch-lens-analysis', 'analysis'],
]

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
export async function selectiveInvalidate(
  fs: FileSystem,
  root: string,
  changedPackages: ReadonlySet<string>,
  newFactsVersion: number,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<void> {
  const dir = await fs.resolve(CACHE_DIR, { cwd: root }).catch(() => null)
  if (dir === null) return
  let entries
  try {
    entries = await fs.listDir(dir)
  } catch {
    return
  }
  /** Invalidated in pass 1, cascaded in pass 2. */
  const invalidatedKinds = new Set<string>()
  const dynamicFiles: Array<{ name: string; target: FsTarget }> = []
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    if (!entry.name.startsWith('.arch-lens-') || !entry.name.endsWith('.json')) continue
    if (SKIP_INVALIDATION.has(entry.name) || entry.name.startsWith('.arch-lens-draw-')) continue
    if (entry.name.startsWith('.arch-lens-dynamic-')) {
      dynamicFiles.push({ name: entry.name, target: entry.target })
      continue
    }
    const raw = await readRawCache(fs, entry.target)
    if (raw === null) continue
    // Legacy (no deps field) ⇒ depends on every package. Explicit empty deps
    // (doc-sourced) ⇒ depends on nothing.
    const hit = !raw.depsPresent || raw.deps.some(d => changedPackages.has(d))
    if (hit) {
      // Invalidate: v=0 can never equal any real facts version.
      await fs.writeText(entry.target, JSON.stringify({ v: 0 }), undefined, undefined, sandboxPolicy).catch(() => {})
      const family = ENTITY_KIND_PREFIXES.find(([prefix]) => entry.name.startsWith(prefix))
      if (family !== undefined) invalidatedKinds.add(family[1])
    } else {
      const wrapped: { v: number; deps?: string[]; data: unknown } = { v: newFactsVersion, data: raw.data }
      if (raw.depsPresent) wrapped.deps = raw.deps
      await fs.writeText(entry.target, JSON.stringify(wrapped), undefined, undefined, sandboxPolicy).catch(() => {})
    }
  }
  // Pass 2: dynamic drill-down figures follow their parent figure (D1).
  for (const file of dynamicFiles) {
    const parentKind = file.name.includes('-seq-edge-')
      ? 'sequence'
      : file.name.includes('-flow-subgraph-')
        ? 'flow'
        : file.name.includes('-overview-')
          ? 'overview'
          : undefined
    if (parentKind === undefined) continue
    const raw = await readRawCache(fs, file.target)
    const hit = raw === null
      || parentKind === 'overview'
      || !raw.depsPresent
      || raw.deps.some(d => changedPackages.has(d))
      || invalidatedKinds.has(parentKind)
    if (hit) {
      await fs.writeText(file.target, JSON.stringify({ v: 0 }), undefined, undefined, sandboxPolicy).catch(() => {})
    } else {
      const wrapped: { v: number; deps?: string[]; data: unknown } = { v: newFactsVersion, data: raw.data }
      if (raw.depsPresent) wrapped.deps = raw.deps
      await fs.writeText(file.target, JSON.stringify(wrapped), undefined, undefined, sandboxPolicy).catch(() => {})
    }
  }
}

/** Cache files the legacy sweep must never touch, beyond SKIP_INVALIDATION:
 * saved custom figures are USER assets, and progress caches are plain-JSON
 * per-language files — neither carries a version envelope by design. */
const SKIP_SWEEP_PREFIXES: readonly string[] = ['.arch-lens-draw-', '.arch-lens-progress-']

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
export async function sweepLegacyCaches(
  fs: FileSystem,
  root: string,
  remove?: (target: FsTarget) => Promise<void>,
): Promise<string[]> {
  const dir = await fs.resolve(CACHE_DIR, { cwd: root }).catch(() => null)
  if (dir === null) return []
  let entries
  try {
    entries = await fs.listDir(dir)
  } catch {
    return []
  }
  const removeFile = remove ?? (async (target: FsTarget): Promise<void> => {
    await unlink(fs.processPath(target))
  })
  const removed: string[] = []
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    if (!entry.name.startsWith('.arch-lens-') || !entry.name.endsWith('.json')) continue
    if (SKIP_INVALIDATION.has(entry.name) || SKIP_SWEEP_PREFIXES.some(prefix => entry.name.startsWith(prefix))) continue
    const raw = await readRawCache(fs, entry.target)
    if (raw !== null) continue // versioned (current or managed `{v:0}` grave) — not a tombstone
    try {
      await removeFile(entry.target)
      removed.push(entry.name)
    } catch {
      // locked / already gone — nothing to sweep
    }
  }
  return removed
}
