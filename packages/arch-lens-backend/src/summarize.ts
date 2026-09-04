/**
 * AI duty summaries for the package catalog: one batched LLM call turns every
 * package's official description into a one-line summary in the configured
 * role language. Results are cached per workspace so rescans do not re-call
 * the model.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/summarize
 */

import type { Context } from '@deepseek-ai/cordis'
import { debug } from './log.ts'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime, TokenUsage } from '@deepseek-ai/dsh-llm'
import { CACHE_DIR } from './cache-dir.ts'
import { readFactVersion, readVersionedCache } from './fact-cache.ts'
import { writeFigure } from './figures.ts'
import type { ArchLensGraph } from './types.ts'
import { normalizeUsage, recordLlmCall } from './llm-stats.ts'
import { ABORTED_MESSAGE, beginGenerationStage, endGenerationStage, generationSignal, reportGeneration, tailPreview } from './abort.ts'

/** Cache file base name; the role language is appended (sanitized). */
const SUMMARY_FILE_BASE = '.arch-lens-summaries'

/** Keep cache file names filesystem-safe. */
function cacheName(language: string): string {
  const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `${CACHE_DIR}/${SUMMARY_FILE_BASE}-${safe === '' ? 'default' : safe}.json`
}

/**
 * The AUTHORITATIVE duty-summaries cache file name, exported for the figure
 * registry (`figures.ts` — shared cache naming/invalidation) AND genuinely
 * consumed by figure prompts: dutyFactsForFigure reads this cache via
 * readDutySummaries and injects the AI summaries into the 「各包职责」 section
 * of custom/overview prompts. Consumers must never re-spell cache names.
 * @param language - role language.
 * @returns the CACHE_DIR-relative cache file name.
 */
export function summariesCacheName(language: string): string {
  return cacheName(language)
}

/** Pull the JSON object out of a model answer, tolerating extra prose. */
function extractJson(text: string): Record<string, string> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim().slice(0, 200)
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * READ-ONLY duty summaries: serve the versioned cache (facts version must
 * match); null when absent/stale. NEVER generates — generation is owned by
 * the write paths (「🤖 AI 生成」 on the catalog tab).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @returns the cached id → summary map (possibly partial), or null when the
 *   cache file is missing, stale or corrupt.
 */
export async function readDutySummaries(
  fs: FileSystem,
  root: string,
  language: string,
): Promise<Record<string, string> | null> {
  const target = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null)
  if (target === null) return null
  const factsVersion = await readFactVersion(fs, root)
  const cached = await readVersionedCache<Record<string, string>>(fs, target, factsVersion)
  if (cached !== null) debug(`[arch-lens] summarize: served from cache (read-only, lang=${language})`)
  return cached
}

/**
 * Generate (or read cached) one-line AI duty summaries for every scanned
 * package, in the configured role language.
 * @param ctx - host context carrying llm and agentDefaultModel services.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param graph - scanned graph.
 * @param language - role language for the summaries (default '中文').
 * @returns id → summary map, or an error result.
 */
export async function summarizeDuties(
  ctx: Context,
  fs: FileSystem,
  root: string,
  graph: ArchLensGraph,
  language: string,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<Record<string, string> | { error: string }> {
  const target = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null)
  let cached: Record<string, string> = {}
  if (target !== null) {
    const factsVersion = await readFactVersion(fs, root)
    const fromCache = await readVersionedCache<Record<string, string>>(fs, target, factsVersion)
    if (fromCache !== null) cached = fromCache
  }

  const missing = graph.nodes
    .filter(node => cached[node.id] === undefined || cached[node.id] === '')
    .map(node => node.id)
  if (missing.length === 0) {
    debug(`[arch-lens] summarize: all ${graph.nodes.length} packages cached (lang=${language})`)
    return cached
  }
  debug(`[arch-lens] summarize: ${missing.length} missing of ${graph.nodes.length} (lang=${language})`)

  const llm = ctx.get('llm') as LlmRuntime | undefined
  const defaultModel = ctx.get('agentDefaultModel') as
    | { currentSelection(): { provider: string; model: string } }
    | undefined
  if (llm === undefined || defaultModel === undefined) {
    console.warn('[arch-lens] summarize unavailable: llm or agentDefaultModel service missing')
    return { error: 'summarize unavailable: llm or agentDefaultModel service missing' }
  }
  const selection = defaultModel.currentSelection()
  // Batch the request: a single call for 130+ packages risks output
  // truncation, which makes the JSON unparseable. Each batch is small enough
  // to finish quickly, and at most two batches run per RPC so the whole call
  // stays inside the 30s transport timeout; the client re-invokes to fill
  // the remaining batches (the cache makes the next call incremental).
  const BATCH_SIZE = 40
  const MAX_BATCHES_PER_CALL = 2
  const missingBatches: string[][] = []
  for (let i = 0; i < missing.length; i += BATCH_SIZE) missingBatches.push(missing.slice(i, i + BATCH_SIZE))

  const merged: Record<string, string> = { ...cached }
  const signal = generationSignal(root)
  for (const batch of missingBatches.slice(0, MAX_BATCHES_PER_CALL)) {
    const lines = graph.nodes
      .filter(node => batch.includes(node.id))
      .map(node => `- ${node.id}: ${node.blurb !== '' ? node.blurb : '（无自带描述，请依据其源码/文件判断职责）'}`)
      .join('\n')
    const prompt = `你是代码仓库分析助手。以下是一个代码仓库中 ${batch.length} 个包/模块的短名与其说明（说明可能为空）。\n`
      + `请为每个包或模块写一行「职责总结」（简洁、准确、用自然语言说明它在仓库里负责什么；说明为空时根据短名与代码常识判断，不要编造）。\n`
      + `输出语言：${language}。\n`
      + `严格输出 JSON 对象（键=包/模块短名，值=一行总结），不要输出任何其他内容：\n\n${lines}`

    try {
      const prepared = await llm.prepareCall({
        provider: selection.provider,
        model: selection.model,
        temperature: 0,
      }, signal)
      // The resolved config may carry adapter-defaulted fields; stream must
      // reproduce it exactly or the prepared call is rejected.
      const cfg = prepared.config
      const started = Date.now()
      let out = ''
      let usage: TokenUsage | undefined
      // ⚙️ live generation status (same mechanism as llmText).
      beginGenerationStage(signal, 'LLM：duties')
      let textTail = ''
      for await (const chunk of prepared.stream({
        provider: cfg.provider,
        model: cfg.model,
        ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
        ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
        ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
        ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
        ...(signal.aborted ? {} : { signal }),
        messages: [createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'user' },
        })],
      })) {
        if (signal.aborted) {
          endGenerationStage(signal)
          throw new Error(ABORTED_MESSAGE)
        }
        if (chunk.type === 'text-delta') {
          out += chunk.text
          textTail = tailPreview(textTail, chunk.text)
          reportGeneration(signal, out.length, textTail)
        }
        if (chunk.type === 'usage') usage = chunk.usage
      }
      if (signal.aborted) {
        endGenerationStage(signal)
        throw new Error(ABORTED_MESSAGE)
      }
      endGenerationStage(signal)
      recordLlmCall('duties', prompt, out, Date.now() - started, normalizeUsage(usage))
      const parsed = extractJson(out)
      if (parsed === null) {
        console.warn(`[arch-lens] summarize: batch output had no JSON object (${out.length} chars): ${out.slice(0, 300)}`)
        return { error: 'summarize failed: model output did not contain a JSON object' }
      }
      debug(`[arch-lens] summarize: batch generated ${Object.keys(parsed).length} summaries`)
      Object.assign(merged, parsed)
    } catch (error) {
      console.warn(`[arch-lens] summarize failed: ${error instanceof Error ? error.message : String(error)}`)
      return { error: `summarize failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  // 统一写入口：职责总结按包独立（deps = 已总结包 id，规则在 figureDeps）。
  const factsVersion = await readFactVersion(fs, root)
  await writeFigure(fs, root, 'duties', language, factsVersion, merged, { policy: sandboxPolicy })
  return merged
}
