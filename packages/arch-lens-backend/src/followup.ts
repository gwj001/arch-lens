/**
 * 原地追问重画（figureFollowUp）：对某一个 tab 的主图做一次带追问上下文的
 * 重画——读现有图 → LLM 基于「现有图 + 用户追问」重新生成（同一 JSON 契约）
 * → 覆写同一缓存文件 → 返回新图数据。客户端拿到结果直接回填该 tab 的状态，
 * 图就"原地"更新了，不画到别的地方。
 * @module @deepseek-ai/dsh-arch-lens-backend/src/followup
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import { CACHE_DIR } from './cache-dir.ts'
import { readFactVersion, readVersionedCache, writeVersionedCache } from './fact-cache.ts'
import { indexSummary, llmText } from './docsgen.ts'
import { coreFlowchart } from './mermaid.ts'
import { dynamicFigureCacheName, extractDynamicDiagram } from './session-figure.ts'
import type {
  ArchLensConceptNode,
  ArchLensCoreGraph,
  ArchLensEventRow,
  ArchLensFlowResult,
  ArchLensSequenceResult,
  FlowAngle,
  FollowUpKind,
  FollowUpResult,
} from './types.ts'

/** Figure kinds that support in-place follow-up redraw. */
export type { FollowUpKind, FollowUpResult }

/** Keep cache file names filesystem-safe (language + angle + method level). */
function safe(language: string): string {
  const s = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return s === '' ? 'default' : s
}

function flowCacheName(language: string, angle: FlowAngle, methods = false): string {
  return `${CACHE_DIR}/.arch-lens-flow-${safe(language)}-${angle}${methods ? '-methods' : ''}.json`
}

function baseCacheName(base: string, language: string, methods = false): string {
  return `${CACHE_DIR}/.arch-lens-${base}-${safe(language)}${methods ? '-methods' : ''}.json`
}

/** Read a versioned cache file; null when absent/stale/unreadable. */
async function readCache<T>(fs: FileSystem, root: string, name: string): Promise<T | null> {
  try {
    const target = await fs.resolve(name, { cwd: root })
    const factsVersion = await readFactVersion(fs, root)
    return await readVersionedCache<T>(fs, target, factsVersion)
  } catch {
    return null
  }
}

/** Write a versioned cache file (v = facts version; non-fatal on failure).
 * 版本化写入保证读侧（readFlow/readConceptTree/…只认版本化缓存）能读到
 * 追问重画的结果；v 不匹配时写入被拒绝，陈旧结果不得污染新事实。
 * `deps` = 该图依赖的包 id（供选择性失效），缺省视为全包依赖。 */
async function writeCache(fs: FileSystem, root: string, name: string, value: unknown, sandboxPolicy?: SandboxExecutionPolicy, deps?: string[]): Promise<void> {
  try {
    const target = await fs.resolve(name, { cwd: root })
    const factsVersion = await readFactVersion(fs, root)
    await writeVersionedCache(fs, target, value, factsVersion, sandboxPolicy, deps)
  } catch {
    // cache write failures are non-fatal
  }
}

/** The existing figure of one kind, rendered as prompt context text. */
async function existingText(fs: FileSystem, root: string, kind: FollowUpKind, language: string, angle: FlowAngle, methods: boolean): Promise<string> {
  try {
    switch (kind) {
      case 'flow': {
        const cached = await readCache<ArchLensFlowResult>(fs, root, flowCacheName(language, angle, methods))
        return cached !== null && typeof cached.mermaid === 'string'
          ? `标题：${cached.title ?? ''}\n现有图（mermaid）：\n${cached.mermaid}`
          : ''
      }
      case 'seq': {
        const cached = await readCache<unknown[]>(fs, root, baseCacheName('sequence', language, methods))
        return cached !== null ? `现有时序消息（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : ''
      }
      case 'concepts': {
        const cached = await readCache<unknown[]>(fs, root, baseCacheName('concept', language, methods))
        return cached !== null ? `现有概念树（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : ''
      }
      case 'events': {
        const cached = await readCache<unknown[]>(fs, root, baseCacheName('events', language, methods))
        return cached !== null ? `现有核心交互（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : ''
      }
      case 'core': {
        const cached = await readCache<ArchLensCoreGraph>(fs, root, baseCacheName('core', language, methods))
        return cached !== null && Array.isArray(cached.ids) ? `现有核心包：${cached.ids.join('、')}` : ''
      }
      case 'overview': {
        const cached = await readCache<{ title?: unknown; diagram?: unknown }>(fs, root, dynamicFigureCacheName('overview', 'overview:all', language))
        return cached !== null && typeof cached.diagram === 'string'
          ? `标题：${typeof cached.title === 'string' ? cached.title : ''}\n现有总览图（mermaid）：\n${cached.diagram}`
          : ''
      }
    }
  } catch {
    return ''
  }
}

/** Per-kind JSON contract appended to every follow-up prompt. */
function contractOf(kind: FollowUpKind): string {
  switch (kind) {
    case 'flow':
      return '严格输出 JSON：{"title": "流程标题", "mermaid": "flowchart TD\\n..."}（mermaid 为完整 flowchart 源码，不要代码块围栏），不要输出其他内容。'
    case 'seq':
      return '严格输出 JSON 数组：[{ "from": "包id", "to": "包id", "label": "短动宾短语或 调用 xxx()" }]（10-16 条，from/to 只能是摘要中的包 id），不要输出其他内容。'
    case 'concepts':
      return '严格输出 JSON 数组：[{ "name": "概念名", "desc": "一句话", "inside": "一句话", "children": [] }]（层级小节），不要输出其他内容。'
    case 'events':
      return '严格输出 JSON 数组：[{ "event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..." }]（8-14 条），不要输出其他内容。'
    case 'core':
      return '严格输出 JSON：{"core": ["包id", ...]}（4-25 个核心包 id，只能是摘要中的包 id），不要输出其他内容。'
    default:
      return '严格输出 JSON：{"title": "简短标题", "diagram": "flowchart TD\\n..."}（架构总览图），不要输出其他内容。'
  }
}

/** Build the follow-up prompt: summary + existing figure + user's ask + contract. */
function followUpPrompt(kind: FollowUpKind, language: string, followUp: string, summary: string, existing: string): string {
  const base = `你是代码架构分析师。以下是某项目的代码索引摘要（包/依赖/实体/入口）。\n输出语言：${language}。\n只依据摘要事实作答；源码中没有证据的环节必须在图上标注【推断】。\n\n项目摘要：\n${summary}\n\n`
  const existingBlock = existing !== ''
    ? `该图已有以下版本（保持同一场景，在现有图上扩展/重画细节）：\n${existing}\n\n`
    : ''
  const ask = `用户对现有图提出追问/扩展要求：${followUp}\n请基于现有图重画或扩展细节。\n`
  return base + existingBlock + ask + contractOf(kind)
}

/** Pull the first {...} object out of a model answer, tolerating prose. */
function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Pull the first [...] array out of a model answer; null when empty. */
function extractArray(text: string): unknown[] | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown
    return Array.isArray(value) && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/** Validate and bound the LLM's core ids against the indexed packages. */
function validateCoreIds(index: CodeIndexResult, raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(index.packages.map(pkg => pkg.id))
  const ids: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (!known.has(item)) continue
    if (ids.includes(item)) continue
    ids.push(item)
    if (ids.length >= 25) break
  }
  return ids
}

/** Strip fences / stray prose from a mermaid answer; '' when no diagram. */
function cleanMermaid(out: string): string {
  const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out)
  if (fenced !== null) return fenced[1]!.trim()
  const idx = out.search(/\b(?:flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|journey|gantt)\b/)
  if (idx < 0) return ''
  return out.slice(idx).trim().replace(/```\s*$/, '').trim()
}

/**
 * In-place follow-up redraw for ONE tab figure. Reads the existing figure,
 * asks the LLM to extend/redraw it with the follow-up, overwrites the SAME
 * cache, and returns the new figure (same contract as the tab's RPC).
 * @param request - figure kind, role language, viewpoint (flow), method-level
 *   switch, and the user's follow-up instruction.
 * @param signal - optional cancellation: aborting it stops the LLM stream
 *   promptly (the panel's「取消」button while a redraw is running).
 * @returns the new figure data, or an error.
 */
export async function figureFollowUp(
  ctx: Context,
  fs: FileSystem,
  root: string,
  index: CodeIndexResult,
  request: { kind: FollowUpKind; language: string; angle?: FlowAngle; methodLevel?: boolean; followUp: string },
  sandboxPolicy?: SandboxExecutionPolicy,
  signal?: AbortSignal,
): Promise<FollowUpResult | { error: string }> {
  const { kind, language } = request
  const methods = request.methodLevel === true
  const angle = request.angle ?? 'event'
  try {
    const summary = indexSummary(index, { fields: { deps: false }, methods })
    const existing = await existingText(fs, root, kind, language, angle, methods)
    const text = await llmText(ctx, followUpPrompt(kind, language, request.followUp, summary, existing), 0.3, undefined, `followup-${kind}`, signal)
    if (text === '') return { error: 'follow-up generation returned empty text' }
    switch (kind) {
      case 'flow': {
        const parsed = extractJson(text)
        if (parsed === null || typeof parsed.mermaid !== 'string') return { error: 'flow follow-up did not parse into a diagram' }
        const mermaid = cleanMermaid(parsed.mermaid)
        if (mermaid === '') return { error: 'flow follow-up produced no mermaid' }
        const result: ArchLensFlowResult = {
          title: typeof parsed.title === 'string' && parsed.title !== '' ? parsed.title.slice(0, 60) : '核心流程',
          source: 'flow',
          angle,
          mermaid,
        }
        await writeCache(fs, root, flowCacheName(language, angle, methods), result, sandboxPolicy, index.packages.map(pkg => pkg.id))
        return result
      }
      case 'seq': {
        const messages = extractArray(text)
        if (messages === null) return { error: 'seq follow-up produced no messages' }
        const deps = (messages as Array<{ from?: unknown; to?: unknown }>)
          .flatMap(message => [message.from, message.to])
          .filter((id): id is string => typeof id === 'string' && id !== '')
        const result: ArchLensSequenceResult = { messages: messages as ArchLensSequenceResult['messages'], source: 'flow' }
        await writeCache(fs, root, baseCacheName('sequence', language, methods), messages, sandboxPolicy, deps)
        return result
      }
      case 'concepts': {
        const tree = extractArray(text)
        if (tree === null) return { error: 'concepts follow-up produced no tree' }
        await writeCache(fs, root, baseCacheName('concept', language, methods), tree, sandboxPolicy, index.packages.map(pkg => pkg.id))
        return tree as ArchLensConceptNode[]
      }
      case 'events': {
        const events = extractArray(text)
        if (events === null) return { error: 'events follow-up produced no events' }
        const deps: string[] = []
        for (const event of events as Array<{ producers?: unknown; consumers?: unknown }>) {
          for (const list of [event.producers, event.consumers]) {
            if (Array.isArray(list)) {
              for (const id of list) {
                if (typeof id === 'string' && id !== '') deps.push(id)
              }
            }
          }
        }
        await writeCache(fs, root, baseCacheName('events', language, methods), events, sandboxPolicy, deps)
        return events as ArchLensEventRow[]
      }
      case 'core': {
        const parsed = extractJson(text)
        const ids = validateCoreIds(index, parsed?.core)
        if (ids.length < 4) return { error: 'core follow-up produced no valid package ids' }
        const core: ArchLensCoreGraph = { ids, source: 'flow' }
        await writeCache(fs, root, baseCacheName('core', language, methods), core, sandboxPolicy, ids)
        return { kind: 'flowchart', source: coreFlowchart(index, ids), core }
      }
      case 'overview': {
        const parsed = extractJson(text)
        const value = parsed !== null ? extractDynamicDiagram(parsed) : undefined
        if (value === undefined) return { error: 'overview follow-up did not parse into a diagram' }
        const targetKey = 'overview:all'
        await writeCache(fs, root, dynamicFigureCacheName('overview', targetKey, language), { ...value, source: 'flow', kind: 'overview', targetKey }, sandboxPolicy)
        return { ...value, kind: 'overview', targetKey }
      }
    }
  } catch (error) {
    return { error: `follow-up failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
