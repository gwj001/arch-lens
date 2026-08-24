/**
 * Core-flow package selection for the Arch Lens backend: pick the packages
 * that form the project's core flow. The LLM selects ids from the index
 * summary (validated against the index — unknown ids are dropped); a
 * deterministic fallback (entry packages plus their source-import neighbors,
 * depth 1) covers LLM failure so the figure never renders empty. Edges are
 * derived by rules elsewhere (mermaid.ts importEdges); this module owns only
 * the selection and its provenance.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/core
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import { CACHE_DIR } from './cache-dir.ts'
import { readFactVersion, readVersionedCache, writeVersionedCache } from './fact-cache.ts'
import type { ArchLensCoreGraph } from './types.ts'
import { importEdges } from './mermaid.ts'
import { indexSummary, llmText } from './docsgen.ts'
import { ensureAnalysisProfile } from './analysis.ts'
import { generationSignal } from './abort.ts'

/** Cache file base name; the role language is appended (sanitized). */
const CORE_FILE_BASE = '.arch-lens-core'

/** Keep cache file names filesystem-safe (language + method level). */
function cacheName(language: string, methods = false): string {
  const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `${CACHE_DIR}/${CORE_FILE_BASE}-${safe === '' ? 'default' : safe}${methods ? '-methods' : ''}.json`
}

/** LLM selection bounds: small enough to read, large enough to be a graph. */
const MIN_CORE = 4
const MAX_CORE = 25

/** Validate and bound the LLM's id list against the indexed packages. */
function validateIds(index: CodeIndexResult, raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(index.packages.map(pkg => pkg.id))
  const ids: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (!known.has(item)) continue
    if (ids.includes(item)) continue
    ids.push(item)
    if (ids.length >= MAX_CORE) break
  }
  return ids
}

/** Deterministic fallback: entry packages plus their import neighbors (depth 1). */
function fallbackIds(index: CodeIndexResult): string[] {
  const picked = new Set(index.packages.filter(pkg => pkg.entryFiles.length > 0).map(pkg => pkg.id))
  const edges = importEdges(index)
  for (const [from, tos] of edges) {
    if (picked.has(from)) for (const to of tos) picked.add(to)
    if (tos.some(to => picked.has(to))) picked.add(from)
  }
  return [...picked]
}

/** Pull the `{ "core": [...] }` object out of a model answer, tolerating prose. */
function extractCoreJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return (parsed as Record<string, unknown>).core
  } catch {
    return undefined
  }
}

/** LLM pick: return the ids the model selects from the index summary. */
async function llmPick(ctx: Context, index: CodeIndexResult, language: string, signal?: AbortSignal, methods = false): Promise<string[]> {
  const prompt = `你是代码架构分析师。以下是某项目的代码索引摘要（包 id / 语言 / 顶层实体 / 入口文件${methods ? '/方法/真实调用边' : ''}）。\n`
    + `请从摘要中选出构成这个项目核心流程的 ${MIN_CORE}-${MAX_CORE} 个核心包 id（如启动、请求处理、主循环涉及的关键包）。\n`
    + `只能使用摘要中出现的包 id，不要编造。\n`
    + `输出语言：${language}。\n`
    + `严格按以下格式输出，不要输出其他内容：\n`
    + `{"core": ["id1", "id2", ...]}\n\n`
    + `项目摘要：\n${indexSummary(index, { fields: { deps: false }, methods })}`
  const out = await llmText(ctx, prompt, 0.3, undefined, 'core', signal)
  return validateIds(index, extractCoreJson(out))
}

/**
 * READ-ONLY core selection: serve the versioned cache when its facts version
 * matches; null when absent/stale. NEVER generates (no profile, no LLM pick,
 * no deterministic fallback, no cache write) — generation is owned by the
 * write paths (AI 生成 / regenerate). D2: 架构概览 has no rule fallback on
 * read — facts appear only after a rescan plus the user's generate action.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @param methods - 🔬 方法级 cache variant.
 * @returns the cached selection, or null when no matching cache exists.
 */
export async function readCore(
  fs: FileSystem,
  root: string,
  language: string,
  methods = false,
): Promise<ArchLensCoreGraph | null> {
  const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null)
  if (cacheTarget === null) return null
  const factsVersion = await readFactVersion(fs, root)
  const cached = await readVersionedCache<ArchLensCoreGraph>(fs, cacheTarget, factsVersion)
  if (cached !== null && typeof cached === 'object' && Array.isArray(cached.ids) && (cached.source === 'flow' || cached.source === 'curated')) {
    console.log(`[arch-lens] core: served from cache (read-only, lang=${language})`)
    return cached
  }
  return null
}

/**
 * The full core-selection chain: cache → LLM pick (validated) → deterministic
 * fallback. `force` bypasses the cache and rebuilds the selection facts.
 * WRITE path only: reads happen through readCore().
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @returns the core selection, or an error result.
 */
export async function coreGraph(
  ctx: Context,
  fs: FileSystem,
  root: string,
  index: CodeIndexResult,
  language: string,
  force: boolean,
  sandboxPolicy?: SandboxExecutionPolicy,
  methods = false,
): Promise<ArchLensCoreGraph | { error: string }> {
  const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null)
  const factsVersion = await readFactVersion(fs, root)
  if (!force && cacheTarget !== null) {
    const cached = await readVersionedCache<ArchLensCoreGraph>(fs, cacheTarget, factsVersion)
    if (cached !== null && typeof cached === 'object' && Array.isArray(cached.ids) && (cached.source === 'flow' || cached.source === 'curated')) {
      console.log(`[arch-lens] core: served from cache (lang=${language}${methods ? ', method-level' : ''})`)
      return cached
    }
  }
  const writeCache = async (result: ArchLensCoreGraph): Promise<void> => {
    if (cacheTarget === null) return
    // 核心子图依赖所选核心包：只有这些包变动才需要重选。
    await writeVersionedCache(fs, cacheTarget, result, factsVersion, sandboxPolicy, result.ids)
  }
  // Stage: shared analysis profile ids (validated the same way as the pick)
  // — consumed BEFORE the chain-own LLM pick, AFTER the cache. Skipped in
  // method-level mode (the shared profile is entity-level by design).
  if (!methods) {
    const profile = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy)
    const profileIds = validateIds(index, profile.coreIds)
    if (profileIds.length >= MIN_CORE) {
      console.log('[arch-lens] core: shared analysis profile')
      const result: ArchLensCoreGraph = { ids: profileIds, source: 'flow' }
      await writeCache(result)
      return result
    }
  }
  // LLM pick first: validated ids, source 'flow' (non-authoritative).
  let ids: string[] = []
  try {
    ids = await llmPick(ctx, index, language, generationSignal(root), methods)
  } catch (error) {
    console.warn(`[arch-lens] core: LLM pick failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (ids.length >= MIN_CORE) {
    const result: ArchLensCoreGraph = { ids, source: 'flow' }
    await writeCache(result)
    return result
  }
  // Deterministic fallback: entry packages + import neighbors. Not cached —
  // the next non-forced read retries the LLM instead of freezing on rules.
  console.log('[arch-lens] core: LLM pick empty or too small — using deterministic fallback')
  const fallback = fallbackIds(index)
  if (fallback.length === 0) return { error: 'core selection failed: no entry packages in the index' }
  return { ids: fallback, source: 'curated', ref: 'entry packages plus their source-import neighbors' }
}
