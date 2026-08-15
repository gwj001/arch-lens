/**
 * AI duty summaries for the package catalog: one batched LLM call turns every
 * package's official description into a one-line summary in the configured
 * role language. Results are cached per workspace so rescans do not re-call
 * the model.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/summarize
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { ArchLensGraph } from './types.ts'

/** Cache file base name; the role language is appended (sanitized). */
const SUMMARY_FILE_BASE = '.arch-lens-summaries'

/** Keep cache file names filesystem-safe. */
function cacheName(language: string): string {
  const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `${SUMMARY_FILE_BASE}-${safe === '' ? 'default' : safe}.json`
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
): Promise<Record<string, string> | { error: string }> {
  const target = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null)
  let cached: Record<string, string> = {}
  if (target !== null) {
    try {
      const info = await fs.stat(target)
      if (info !== undefined && info.type === 'file') {
        cached = JSON.parse(await fs.readText(target)) as Record<string, string>
      }
    } catch {
      cached = {}
    }
  }

  const missing = graph.nodes
    .filter(node => cached[node.id] === undefined || cached[node.id] === '')
    .map(node => node.id)
  if (missing.length === 0) return cached

  const llm = ctx.get('llm') as LlmRuntime | undefined
  const defaultModel = ctx.get('agentDefaultModel') as { current(): { provider: string; model: string } } | undefined
  if (llm === undefined || defaultModel === undefined) {
    return { error: 'summarize unavailable: llm or agentDefaultModel service missing' }
  }
  const selection = defaultModel.current()
  const lines = graph.nodes
    .filter(node => missing.includes(node.id))
    .map(node => `- ${node.id}: ${node.blurb}`)
    .join('\n')
  const prompt = `你是代码仓库分析助手。以下是一个代码仓库中每个 npm 包的短名与其官方英文描述。\n`
    + `请为每个包写一行「职责总结」（简洁、准确、用自然语言说明这个包干什么）。\n`
    + `输出语言：${language}。\n`
    + `严格输出 JSON 对象（键=包短名，值=一行总结），不要输出任何其他内容：\n\n${lines}`

  try {
    const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature: 0, maxTokens: 8000 })
    let out = ''
    for await (const chunk of prepared.stream({
      provider: selection.provider,
      model: selection.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })],
      temperature: 0,
      maxTokens: 8000,
    })) {
      if (chunk.type === 'text-delta') out += chunk.text
    }
    const parsed = extractJson(out)
    if (parsed === null) {
      return { error: 'summarize failed: model output did not contain a JSON object' }
    }
    const merged = { ...cached, ...parsed }
    if (target !== null) {
      try {
        await fs.writeText(target, JSON.stringify(merged, null, 2))
      } catch {
        // Cache write failures are non-fatal.
      }
    }
    return merged
  } catch (error) {
    return { error: `summarize failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
