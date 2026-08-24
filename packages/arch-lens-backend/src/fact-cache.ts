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
): Promise<void> {
  if (version === 0) return
  const wrapped: { v: number; deps?: string[]; data: T } = { v: version, data }
  if (deps !== undefined && deps.length > 0) wrapped.deps = [...new Set(deps)]
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
  data: unknown
}

/**
 * Read a cache file's `{ v, deps, data }` envelope regardless of whether its
 * version is current. Non-versioned, corrupt or missing files read as null.
 */
export async function readRawCache(fs: FileSystem, target: FsTarget): Promise<RawVersionedCache | null> {
  try {
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file') return null
    const parsed = JSON.parse(await fs.readText(target)) as { v?: unknown; deps?: unknown; data?: unknown }
    if (typeof parsed.v !== 'number') return null
    const deps = Array.isArray(parsed.deps)
      ? parsed.deps.filter((d): d is string => typeof d === 'string')
      : []
    return { v: parsed.v, deps, depsPresent: Array.isArray(parsed.deps), data: parsed.data }
  } catch {
    return null
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
])

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
  for (const entry of entries) {
    if (entry.type !== 'file') continue
    if (!entry.name.startsWith('.arch-lens-') || !entry.name.endsWith('.json')) continue
    if (SKIP_INVALIDATION.has(entry.name)) continue
    const raw = await readRawCache(fs, entry.target)
    if (raw === null) continue
    // Legacy (no deps field) ⇒ depends on every package. Explicit empty deps
    // (doc-sourced) ⇒ depends on nothing.
    const hit = !raw.depsPresent || raw.deps.some(d => changedPackages.has(d))
    if (hit) {
      // Invalidate: v=0 can never equal any real facts version.
      await fs.writeText(entry.target, JSON.stringify({ v: 0 }), undefined, undefined, sandboxPolicy).catch(() => {})
    } else {
      const wrapped: { v: number; deps?: string[]; data: unknown } = { v: newFactsVersion, data: raw.data }
      if (raw.depsPresent) wrapped.deps = raw.deps
      await fs.writeText(entry.target, JSON.stringify(wrapped), undefined, undefined, sandboxPolicy).catch(() => {})
    }
  }
}
