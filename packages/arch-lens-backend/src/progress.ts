/**
 * AI learning-progress summary for the Arch Lens backend: reads the note
 * file, contrasts explained targets against the scanned graph, and appends
 * one model-generated progress entry (understanding level, unasked packages,
 * learning suggestions) to the bottom of ARCH-NOTES.md. Cached per language;
 * `force` regenerates and appends a fresh entry.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/progress
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime, TokenUsage } from '@deepseek-ai/dsh-llm'
import { CACHE_DIR } from './cache-dir.ts'
import { readFactVersion, readVersionedCache, writeVersionedCache } from './fact-cache.ts'
import { appendNote, parseNotes, readNotes } from './notes.ts'
import type { ArchLensGraph, ArchLensProgressResult } from './types.ts'
import { normalizeUsage, recordLlmCall } from './llm-stats.ts'
import { ABORTED_MESSAGE, beginGenerationStage, endGenerationStage, generationSignal, reportGeneration, tailPreview } from './abort.ts'

/** Cache file base name; the role language is appended (sanitized). */
const PROGRESS_FILE_BASE = '.arch-lens-progress'

/** Keep cache file names filesystem-safe. */
function cacheName(language: string): string {
  const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `${CACHE_DIR}/${PROGRESS_FILE_BASE}-${safe === '' ? 'default' : safe}.json`
}

/**
 * Component ids already explained: note targets written by the explain
 * buttons carry the `组件 <short>` prefix; extract the short name and match
 * it against the scanned nodes (id or short). Non-component targets
 * (事件/图/进度总结/默认架构讲解) are excluded from the coverage math.
 * @param entries - parsed note entries (target labels).
 * @param nodes - scanned graph nodes.
 * @returns the set of explained node ids.
 */
function askedComponentIds(entries: Array<{ target: string }>, nodes: ArchLensGraph['nodes']): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    const target = entry.target.trim()
    if (!target.startsWith('组件 ')) continue
    const candidate = target.slice('组件 '.length).trim()
    for (const node of nodes) {
      if (node.id === candidate || node.short === candidate) ids.add(node.id)
    }
  }
  return ids
}

/**
 * Generate (or read cached) an AI learning-progress summary and append it to
 * the note file. The summary contrasts already-explained targets against the
 * scanned packages and asks the model for understanding level, gaps, and
 * next-step suggestions in the role language.
 * @param ctx - host context carrying llm and agentDefaultModel services.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param graph - scanned graph.
 * @param notesFile - note file name.
 * @param language - role language for the summary (default '中文').
 * @param force - regenerate even when a cached summary exists.
 * @returns the progress result, or an error result.
 */
export async function summarizeProgress(
  ctx: Context,
  fs: FileSystem,
  root: string,
  graph: ArchLensGraph,
  notesFile: string,
  language: string,
  force: boolean,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<ArchLensProgressResult | { error: string }> {
  const cacheTarget = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null)
  // Version-bound like every other cached figure: a re-scan advances the
  // facts version and the stale summary (old denominator, old coverage) can
  // never be served. Legacy/unversioned files read as a miss and get
  // rewritten in the envelope format.
  const factsVersion = await readFactVersion(fs, root)
  if (!force && cacheTarget !== null) {
    const cached = await readVersionedCache<ArchLensProgressResult>(fs, cacheTarget, factsVersion)
    if (cached !== null) {
      console.log(`[arch-lens] progress: served from cache (lang=${language})`)
      return { ...cached, fromCache: true }
    }
  }

  const notes = await readNotes(fs, root, notesFile)
  if ('error' in notes) return notes
  // Coverage math uses component ids only; the prompt below still shows the
  // raw targets (events/figures/progress entries included) for context.
  const rawTargets = notes.entries.map(entry => entry.target.trim()).filter(Boolean)
  const askedSet = askedComponentIds(notes.entries, graph.nodes)
  const asked = [...askedSet]
  const allIds = graph.nodes.map(node => node.id)
  const unasked = allIds.filter(id => !askedSet.has(id))
  const total = allIds.length
  const progress = total === 0 ? 0 : Math.round((total - unasked.length) / total * 100)

  const llm = ctx.get('llm') as LlmRuntime | undefined
  const defaultModel = ctx.get('agentDefaultModel') as
    | { currentSelection(): { provider: string; model: string } }
    | undefined
  if (llm === undefined || defaultModel === undefined) {
    console.warn('[arch-lens] progress unavailable: llm or agentDefaultModel service missing')
    return { error: 'progress unavailable: llm or agentDefaultModel service missing' }
  }
  const selection = defaultModel.currentSelection()
  const askedLines = rawTargets.slice(-15).map(target => `- ${target}`).join('\n')
  const unaskedLines = unasked.slice(0, 40).map(id => `- ${id}`).join('\n')
  const prompt = `你是代码仓库学习教练。学习者在用「架构学习台」学习一个代码仓库，已通过 AI 讲解记录如下笔记。\n`
    + `请评估学习者的了解程度，指出还没讲过的重点组件，并给 3-5 条下一步学习建议（按优先级排序）。\n`
    + `输出语言：${language}。\n`
    + `输出格式：纯文本 Markdown，小标题分段（了解程度评估 / 未覆盖的重点 / 学习建议），不要代码块。\n\n`
    + `已讲解目标（最近 15 条）：\n${askedLines === '' ? '（暂无）' : askedLines}\n\n`
    + `尚未提问的组件（最多列 40 个）：\n${unaskedLines === '' ? '（全部已覆盖）' : unaskedLines}\n\n`
    + `总组件数：${total}，已覆盖 ${progress}%。`

  const signal = generationSignal(root)
  try {
    const prepared = await llm.prepareCall({
      provider: selection.provider,
      model: selection.model,
      temperature: 0.3,
    }, signal)
    const cfg = prepared.config
    const started = Date.now()
    let out = ''
    let usage: TokenUsage | undefined
    // ⚙️ live generation status (same mechanism as llmText).
    beginGenerationStage(signal, 'LLM：progress')
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
    recordLlmCall('progress', prompt, out, Date.now() - started, normalizeUsage(usage))
    const summary = out.trim()
    if (summary === '') return { error: 'progress failed: model returned an empty summary' }
    console.log(`[arch-lens] progress: generated ${summary.length} chars (lang=${language})`)

    const result: ArchLensProgressResult = {
      path: notesFile,
      summary,
      asked,
      unasked,
      total,
      progress,
      generatedAt: Date.now(),
    }
    if (cacheTarget !== null) {
      // deps = every scanned package: progress spans the whole denominator,
      // so any package's facts moving invalidates the summary. Write failure
      // stays non-fatal (the summary result is still returned and appended).
      try {
        await writeVersionedCache(fs, cacheTarget, result, factsVersion, sandboxPolicy, allIds)
      } catch (error) {
        console.warn(`[arch-lens] progress cache write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // Append the summary to the note file bottom as one record. Duplicate
    // suppression is irrelevant here (the question is unique per run), but
    // force-runs naturally leave a history of progress snapshots.
    const appended = await appendNote(fs, root, {
      target: '📊 学习进度总结',
      question: `学习进度（已覆盖 ${progress}%）`,
      answer: summary,
    }, notesFile, sandboxPolicy)
    if ('error' in appended) {
      console.warn(`[arch-lens] progress: note append failed: ${appended.error}`)
    }
    return result
  } catch (error) {
    console.warn(`[arch-lens] progress failed: ${error instanceof Error ? error.message : String(error)}`)
    return { error: `progress failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Parse-only export so the Remote method can report asked/unasked without LLM. */
export function progressStats(
  fs: FileSystem,
  root: string,
  graph: ArchLensGraph,
  notesFile: string,
): Promise<{ asked: string[]; unasked: string[]; total: number; progress: number } | { error: string }> {
  return readNotes(fs, root, notesFile).then(notes => {
    if ('error' in notes) return notes
    const askedSet = askedComponentIds(notes.entries, graph.nodes)
    const asked = [...askedSet]
    const allIds = graph.nodes.map(node => node.id)
    const unasked = allIds.filter(id => !askedSet.has(id))
    const total = allIds.length
    return { asked, unasked, total, progress: total === 0 ? 0 : Math.round((total - unasked.length) / total * 100) }
  })
}

/** Re-export for callers that want the parsed entries directly. */
export { parseNotes }
