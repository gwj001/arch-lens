/**
 * Session-driven figure generation (「图生成走会话」): the panel asks the
 * BACKEND for a figure-generation PROMPT (with the code facts embedded), the
 * CLIENT sends it into the current session as a user message — the GUI's own
 * conversation stream then shows the agent working in real time (thinking,
 * code reading, output) with zero custom push plumbing. When the agent
 * answers, the backend's assistant/message listener matches the answer by a
 * unique figId, sanitizes the figure data and writes the same caches the
 * figure chains read, so a plain refetch renders the fresh figure.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/session-figure
 */

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import type { FlowAngle } from './types.ts'
import { indexSummary, seqInductionPrompt } from './docsgen.ts'
import { FLOW_ANGLE_LABEL, flowAngleRule, flowAngleRules, sanitizeMermaid } from './flow-angle.ts'
import { buildProfileConceptTree, sanitizeCoreIds, sanitizeEvents, sanitizeFlow, sanitizeSeqMessages } from './analysis.ts'

/** Figure kinds the session turn can produce (wire kinds mapped to cache kinds). */
export type SessionFigureKind = 'concepts' | 'seq' | 'flow' | 'interaction' | 'core'

/**
 * DYNAMIC figure kinds (hover drill-down, 「动态画图」): a small detail
 * diagram for ONE sequence edge (the two packages' method-level call
 * sequence) or ONE flow subgraph (that stage expanded into a detailed
 * flowchart). Results are cached per target, so a generated detail opens
 * instantly on the next hover (no re-generation).
 */
export type DynamicFigureKind = 'seq-edge' | 'flow-subgraph'

/**
 * Stable djb2 hash → filesystem-safe suffix. The CLIENT keeps a local mirror
 * (arch-view.tsx) so hover caches line up between panel and backend.
 * @param text - the string to hash.
 * @returns a base-36 string of the unsigned 32-bit hash.
 */
export function hashString(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * Serialize one dynamic-figure target into a stable key (the client mirror
 * must produce the same string, so the same cache file is hit).
 * @param kind - the dynamic figure kind.
 * @param target - the hovered element: seq-edge → from/to/label, flow-subgraph → stage.
 * @returns the target key (embedded in cache names).
 */
export function dynamicTargetKey(kind: DynamicFigureKind, target: { from?: string; to?: string; label?: string; stage?: string }): string {
  return kind === 'seq-edge'
    ? `seq:${target.from ?? ''}|${target.to ?? ''}|${target.label ?? ''}`
    : `flow:${target.stage ?? ''}`
}

/** Cache file for one dynamic figure: `.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`. */
export function dynamicFigureCacheName(kind: DynamicFigureKind, targetKey: string, language: string): string {
  const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `.arch-lens-dynamic-${kind}-${hashString(targetKey)}-${safe === '' ? 'default' : safe}.json`
}

/** One staged session-figure request, matched by figId in the answer. */
export interface PendingFigure {
  figId: string
  kind: SessionFigureKind | DynamicFigureKind
  language: string
  angle?: FlowAngle
  methodLevel?: boolean
  sessionId: string | null
  stagedAt: number
  /** The code index the prompt was built from — the listener validates seq /
   * core endpoints against it WITHOUT re-indexing, so the cache lands
   * immediately (no re-read race with the panel's refetch). */
  index: CodeIndexResult
  /** Session-driven DYNAMIC figure (edge/subgraph drill-down): written to its
   * own per-target cache file instead of the per-kind figure caches. */
  dynamic?: { kind: DynamicFigureKind; targetKey: string }
}

/** Cache file base names (must mirror the chains' cache readers). */
const CACHE_BASE: Record<SessionFigureKind, string> = {
  concepts: '.arch-lens-concept',
  seq: '.arch-lens-sequence',
  flow: '.arch-lens-flow',
  interaction: '.arch-lens-events',
  core: '.arch-lens-core',
}

/** Keep cache file names filesystem-safe (language + angle + method level). */
export function figureCacheName(kind: SessionFigureKind, language: string, angle?: FlowAngle, methodLevel = false): string {
  const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  const suffix = kind === 'flow' && angle !== undefined ? `-${angle}` : ''
  return `${CACHE_BASE[kind]}-${safe === '' ? 'default' : safe}${suffix}${methodLevel ? '-methods' : ''}.json`
}

/** The JSON output contract the agent must satisfy (echoes the figId). */
function jsonContract(kind: SessionFigureKind): string {
  switch (kind) {
    case 'flow':
      return '{"figId": "<figId>", "title": "流程标题", "mermaid": "flowchart TD\\n..."}'
    case 'concepts':
      return '{"figId": "<figId>", "conceptTree": [{"name": "...", "desc": "...", "inside": "...", "children": []}]}'
    case 'seq':
      return '{"figId": "<figId>", "seqMessages": [{"from": "包id", "to": "包id", "label": "短动宾短语或 调用 xxx()"}]}'
    case 'interaction':
      return '{"figId": "<figId>", "events": [{"event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..."}]}'
    default:
      return '{"figId": "<figId>", "core": ["包id", "包id"]}'
  }
}

/**
 * Build the session message that asks the agent to produce ONE figure.
 * The code facts (index summary, entity- or method-level) are embedded so
 * the agent is grounded; it MAY read source files with its tools to verify,
 * but its final answer must be the strict JSON below (echoing the figId).
 * @param kind - the figure kind.
 * @param index - code index result (fact source).
 * @param language - role language.
 * @param figId - unique marker the answer must echo.
 * @param angle - flow viewpoint (flow only).
 * @param methodLevel - 🔬 method-level summary (methods + call edges).
 * @returns the user-message text.
 */
export function buildFigurePrompt(
  kind: SessionFigureKind,
  index: CodeIndexResult,
  language: string,
  figId: string,
  angle?: FlowAngle,
  methodLevel = false,
): string {
  const angleRule = kind === 'flow' && angle !== undefined ? flowAngleRule(angle) : ''
  const styleRules = kind === 'flow' ? flowAngleRules(angle ?? 'event') : ''
  const methodRule = methodLevel
    ? '- 已开启🔬方法级：节点/消息尽量引用真实方法名与文件（如 `Svc.handle（api.ts:41）`），只使用摘要中列出的方法名与调用边；\n'
    : ''
  const summary = indexSummary(index, { fields: { deps: false }, methods: methodLevel })
  const mission = ((): string => {
    switch (kind) {
      case 'flow':
        return `请以「${FLOW_ANGLE_LABEL[angle ?? 'event']}」视角生成一张可学习的核心流程图。`
      case 'concepts':
        return '请归纳这个项目「是怎么运作的」：识别运行核心概念（入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳），组织成概念层级树。'
      case 'seq':
        return '请归纳【项目核心】的一次典型主流程的调用顺序。'
      case 'interaction':
        return '请列出这个项目的核心事件/交互。'
      default:
        return '请从摘要中选出构成这个项目核心流程的 4-25 个核心包 id（启动、请求处理、主循环涉及的关键包）。'
    }
  })()
  return `你是代码架构分析师。请为当前工作区生成一张架构图（这是 Arch Lens 学习台的「🤖 AI 生成」请求，figId=${figId}）。\n`
    + `你可以使用工作区工具读源码核实事实，但最终回答必须且只能是一个 JSON 对象，格式：${jsonContract(kind)}（把 figId 原样填成 ${figId}），不要输出任何解释、代码块围栏或额外文字。\n`
    + mission + '\n'
    + (kind === 'flow' ? `${angleRule}\n${styleRules}\n` : '')
    + (kind === 'seq' ? seqInductionPrompt(index, language, summary) : '')
    + methodRule
    + (kind !== 'seq' ? `输出语言：${language}。\n\n项目摘要：\n${summary}` : '')
}

/**
 * Find the answer's JSON object that carries the expected figId. Tolerates
 * prose, fenced ```json blocks and multiple JSON candidates (scans the last
 * balanced brace groups first).
 * @param answer - the assistant's full answer text.
 * @param figId - the expected marker.
 * @returns the parsed object, or null.
 */
export function extractFigureJson(answer: string, figId: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/g
  const candidates: string[] = []
  let match: RegExpExecArray | null
  while ((match = fenced.exec(answer)) !== null) candidates.push(match[1]!)
  candidates.push(answer)
  for (const text of candidates) {
    const parsed = extractBalancedJson(text, figId)
    if (parsed !== null) return parsed
  }
  return null
}

/** Accept the JSON object whose figId matches. A whole-text parse is tried
 * first (the prompt demands a pure JSON answer — the common shape), then
 * every `{` position is scanned from the end with brace balancing (nested
 * trees and prose-wrapped objects parse correctly). The cap only bounds
 * pathological answers; a real figure answer with a dozen inner objects
 * must still reach its outer `{` (regression: the old 8-start cap silently
 * skipped the outer object of answers with >8 inner objects). */
function extractBalancedJson(text: string, figId: string): Record<string, unknown> | null {
  const whole = text.trim()
  if (whole.startsWith('{') && whole.endsWith('}')) {
    try {
      const parsed = JSON.parse(whole) as unknown
      if (typeof parsed === 'object' && parsed !== null
        && (parsed as Record<string, unknown>).figId === figId) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // not a whole-text JSON object — fall through to start scanning
    }
  }
  const starts: number[] = []
  for (let i = text.lastIndexOf('{'); i >= 0 && starts.length < 256; i = text.lastIndexOf('{', i - 1)) {
    starts.push(i)
  }
  for (const start of starts) {
    let depth = 0
    let end = -1
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) { end = i; break }
      }
    }
    if (end < 0) continue
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
      if (typeof parsed === 'object' && parsed !== null
        && (parsed as Record<string, unknown>).figId === figId) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // keep scanning earlier candidates
    }
  }
  return null
}

/**
 * Sanitize the parsed answer into the figure's cache shape and persist it to
 * the same file the chain reads, so a plain refetch renders the fresh figure.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (id validation for seq/core answers).
 * @param kind - the figure kind.
 * @param parsed - the answer JSON (figId matched already).
 * @param language - role language.
 * @param angle - flow viewpoint (flow only).
 * @param methodLevel - cache suffix.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns `{ ok: true }` or `{ error }`.
 */
export async function writeFigureCache(
  fs: FileSystem,
  root: string,
  index: CodeIndexResult,
  kind: SessionFigureKind,
  parsed: Record<string, unknown>,
  language: string,
  angle?: FlowAngle,
  methodLevel = false,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<{ ok: true } | { error: string }> {
  let value: unknown
  if (kind === 'flow') {
    const flow = sanitizeFlow(parsed, angle ?? 'event')
    if (flow === undefined) return { error: 'flow answer did not parse into a diagram' }
    value = { title: flow.title, source: 'flow', angle: flow.angle, mermaid: sanitizeMermaid(flow.mermaid) }
  } else if (kind === 'concepts') {
    const tree = buildProfileConceptTree(parsed.conceptTree, 'session-figure')
    if (tree.length === 0) return { error: 'concept answer produced no tree' }
    value = tree
  } else if (kind === 'seq') {
    const messages = sanitizeSeqMessages(parsed.seqMessages, index.packages.map(pkg => pkg.id))
    if (messages.length === 0) return { error: 'seq answer produced no messages' }
    value = { source: 'flow', messages }
  } else if (kind === 'interaction') {
    const events = sanitizeEvents(parsed.events)
    if (events.length === 0) return { error: 'events answer produced no events' }
    value = events
  } else {
    const ids = sanitizeCoreIds(index, parsed.core)
    if (ids.length === 0) return { error: 'core answer produced no ids' }
    value = { ids, source: 'flow' }
  }
  try {
    const target = await fs.resolve(figureCacheName(kind, language, angle, methodLevel), { cwd: root })
    await fs.writeText(target, JSON.stringify(value), undefined, undefined, sandboxPolicy)
    return { ok: true }
  } catch (error) {
    return { error: `figure cache write failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/* ---------------------------------------------------------------------------
 * DYNAMIC figures (hover drill-down): a small detail diagram for ONE
 * sequence edge or ONE flow subgraph, generated as a session turn and
 * cached per target (`.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`) so
 * the panel opens it instantly on later hovers.
 * ------------------------------------------------------------------------- */

/** The JSON output contract the agent must satisfy for a dynamic figure. */
function dynamicJsonContract(kind: DynamicFigureKind): string {
  return kind === 'seq-edge'
    ? '{"figId": "<figId>", "title": "简短标题", "diagram": "sequenceDiagram\\n  participant A as ...\\n  A->>B: ..."}'
    : '{"figId": "<figId>", "title": "简短标题", "diagram": "flowchart TD\\n  A --> B"}'
}

/** The package's directory relative to the workspace root (`/` separators),
 * used to attribute real call edges (fromFile) to a package id. */
function pkgRelDir(index: CodeIndexResult, id: string): string {
  const pkg = index.packages.find(candidate => candidate.id === id)
  if (pkg === undefined) return ''
  if (!pkg.path.startsWith(index.root)) return ''
  return pkg.path.slice(index.root.length).replace(/^[/\\]+/, '').replace(/\\/g, '/')
}

/** The two packages' method-level summary + their real call edges (file:line). */
function seqEdgeFacts(index: CodeIndexResult, target: { from?: string; to?: string }): string {
  const ids = [target.from, target.to].filter((id): id is string => typeof id === 'string' && id !== '')
  const summary = indexSummary(index, { fields: { deps: false }, methods: true, packages: ids })
  const dirs = ids.map(id => pkgRelDir(index, id)).filter(dir => dir !== '')
  const edges = (index.calls ?? [])
    .filter(edge => dirs.some(dir => edge.fromFile.startsWith(`${dir}/`)))
    .slice(0, 60)
    .map(edge => `- ${edge.from ?? '?'} → ${edge.to}（${edge.fromFile}${edge.line !== undefined ? `:${edge.line}` : ''}）`)
  return `这两包的摘要（方法级）：\n${summary}\n\n这两包源码中的真实调用边（含调用点文件行号）：\n${edges.length > 0 ? edges.join('\n') : '（无调用边记录——只能基于摘要推断，请标注【推断】）'}`
}

/**
 * Build the session message that asks the agent to draw ONE dynamic detail
 * figure. Facts are embedded (the hovered edge's two packages with their
 * method-level summary + real call edges, or the flow subgraph's source
 * block + the code summary); the answer must be the strict JSON below.
 * @param kind - seq-edge (edge drill-down) or flow-subgraph (stage expansion).
 * @param index - code index result (fact source).
 * @param language - role language.
 * @param figId - unique marker the answer must echo.
 * @param target - the hovered element (from/to/label or stage).
 * @param mermaidSource - the current flow diagram source (flow-subgraph only).
 * @returns the user-message text.
 */
export function buildDynamicFigurePrompt(
  kind: DynamicFigureKind,
  index: CodeIndexResult,
  language: string,
  figId: string,
  target: { from?: string; to?: string; label?: string; stage?: string },
  mermaidSource?: string,
): string {
  const mission = kind === 'seq-edge'
    ? `主流程时序中有一条消息 ${target.from ?? '?'} → ${target.to ?? '?'}（${target.label ?? ''}）。请钻取这两个包之间的【方法级调用时序】，输出 mermaid sequenceDiagram（参与者用包 id；消息 label 尽量引用真实方法名与文件，如 \`Svc.handle（api.ts:41）\`；只使用下面摘要/调用边中的事实）。`
    : `当前流程图中有一个阶段子块「${target.stage ?? '?'}」。请展开该子块，生成一张更详细的 flowchart 图：保留子块内的节点与边，补充子块内部的步骤细节（仅基于代码事实；源码中没有证据的环节必须标注【推断】）。`
  const context = kind === 'seq-edge'
    ? seqEdgeFacts(index, target)
    : `当前流程图源（只展开指定的子块，不要重画整图）：\n\`\`\`mermaid\n${mermaidSource ?? ''}\n\`\`\`\n\n代码摘要（供核实子块内的包/实体）：\n${indexSummary(index, { fields: { deps: false } })}`
  return `你是代码架构分析师。请为当前工作区生成一张【动态细节图】（这是 Arch Lens 学习台的「动态画图」请求，figId=${figId}）。\n`
    + `你可以使用工作区工具读源码核实事实，但最终回答必须且只能是一个 JSON 对象，格式：${dynamicJsonContract(kind)}（把 figId 原样填成 ${figId}），不要输出任何解释、代码块围栏或额外文字。\n`
    + mission + '\n'
    + `输出语言：${language}。\n\n${context}`
}

/** Extract the diagram body from a dynamic answer ({title?, diagram}): strips
 * fences and stray prose, keeps the first diagram statement, repairs edge
 * labels. @returns the clean value, or undefined when unusable. */
export function extractDynamicDiagram(parsed: Record<string, unknown>): { title: string; diagram: string } | undefined {
  const record = parsed as { title?: unknown; diagram?: unknown }
  if (typeof record.diagram !== 'string') return undefined
  const diagram = extractDiagramText(record.diagram)
  if (diagram === '') return undefined
  return {
    title: typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim().slice(0, 60) : '动态细节图',
    diagram,
  }
}

/** Strip fences / trailing prose from a diagram answer; '' when no diagram. */
function extractDiagramText(out: string): string {
  const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out)
  if (fenced !== null) return sanitizeMermaid(fenced[1]!.trim())
  const idx = out.search(/\b(?:flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|journey|gantt)\b/)
  if (idx < 0) return ''
  return sanitizeMermaid(out.slice(idx).trim().replace(/```\s*$/, '').trim())
}

/**
 * Persist one dynamic figure to its per-target cache file.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param kind - the dynamic figure kind.
 * @param targetKey - the serialized hover target (cache identity).
 * @param parsed - the answer JSON (figId matched already).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns `{ ok: true }` or `{ error }`.
 */
export async function writeDynamicFigureCache(
  fs: FileSystem,
  root: string,
  kind: DynamicFigureKind,
  targetKey: string,
  parsed: Record<string, unknown>,
  language: string,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<{ ok: true } | { error: string }> {
  const value = extractDynamicDiagram(parsed)
  if (value === undefined) return { error: 'dynamic answer did not parse into a diagram' }
  try {
    const target = await fs.resolve(dynamicFigureCacheName(kind, targetKey, language), { cwd: root })
    await fs.writeText(target, JSON.stringify({ ...value, source: 'flow', kind, targetKey }), undefined, undefined, sandboxPolicy)
    return { ok: true }
  } catch (error) {
    return { error: `dynamic figure cache write failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
