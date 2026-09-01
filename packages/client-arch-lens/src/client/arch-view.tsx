/**
 * Arch Lens study desk: unit tabs over the backend Remote, component/event
 * detail popups, notes summary, and the explain queue. Rendered inside the
 * floating robot panel; questions go through the core conversation pipeline
 * (props.send → session.prompt), so answers appear in the main chat view.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/arch-view
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ArchLensCodeInsight, ArchLensCoreGraph, ArchLensFlowResult, ArchLensGraph, ArchLensNotesResult, ArchLensPromptConfig, ArchLensSequenceResult, FlowAngle, LlmStatsSnapshot } from '@deepseek-ai/dsh-arch-lens-backend'
import { Catalog, dutyText } from './catalog.tsx'
import { InsightsPanel } from './insights-panel.tsx'
import { NotesPanel } from './notes-panel.tsx'
import { PromptEditor } from './prompt-editor.tsx'
import {
  codeInsightClause,
  componentQuestion,
  dataQuestion,
  DEFAULT_EXPLAIN_STYLE,
  DEFAULT_LANGUAGE,
  defaultStyle,
  eventQuestion,
  evidenceClause,
  languageClause,
  useDefaultsConfig,
} from './explain.ts'
import type { EvidenceEntry } from './explain.ts'
import { ConceptGraph, InteractionGraph, SequenceGraph } from './graphs.tsx'
import { MermaidView } from './mermaid-view.tsx'
import { composeSelectionBlock, selectionGlyph, withSelection, withoutSelection, type SelectionKind, type SelectionTarget } from './draw-selection.ts'
import { ui, uiT } from './i18n.ts'
import type { UiKey } from './i18n.ts'
import type { ArchLensRemote, FollowUpResult, RemoteConceptNode } from './remote.ts'
import { directRemote, unwrapRemote } from './remote.ts'
import css from './arch-view.module.css'

/**
 * 功能下线开关——与 backend index.ts 的同名常量成对维护（两个 bundle 无共享
 * 模块，改动必须同步）。暂时屏蔽：笔记系（NotesPanel/📊学习进度/覆盖度徽章）
 * 与「📄 一键生成文档」。理由：讲解会话历史本身就是笔记（问答+图+追问全在
 * 会话里，ARCH-NOTES.md 只是记不住图的有损子集）；模板组装文档达不到可交付
 * 质量（DSH 自身的 docs = 仓库资产 + 会话轮撰写，面板无运行时生成按钮）。
 * 恢复 = 两处翻回 false；host 守卫兜底旧页面。
 */
const NOTES_FEATURE_OFF = true
const DOCS_FEATURE_OFF = true

/** 真实 import 引用边 → 原生 mermaid flowchart（LR 自动布局）。
 * 角色（入口/共享服务/其他）由引用度自算（与后端规则一致：
 * hub = 被 ≥2 个包引用、entry = 被 0 个包引用且引用 ≥2 个包），
 * 用 classDef 着色区分——不搞手绘环形布局（弦交叉、空间错乱）。
 * 边 label 只显示动词（引用/references），目标名已在箭头指向上。 */
function callGraphToMermaid(edges: Array<{ from: string; to: string; label: string }>, language?: string): string {
  const verb = language === 'English' ? 'references' : '引用'
  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  for (const edge of edges) {
    inDeg.set(edge.to, (inDeg.get(edge.to) ?? 0) + 1)
    outDeg.set(edge.from, (outDeg.get(edge.from) ?? 0) + 1)
  }
  const roleOf = (actor: string): 'entry' | 'hub' | 'leaf' => {
    const citedBy = inDeg.get(actor) ?? 0
    const cites = outDeg.get(actor) ?? 0
    return citedBy >= 2 ? 'hub' : citedBy === 0 && cites >= 2 ? 'entry' : 'leaf'
  }
  const roles = new Map<string, 'entry' | 'hub' | 'leaf'>()
  for (const edge of edges) {
    roles.set(edge.from, roleOf(edge.from))
    roles.set(edge.to, roleOf(edge.to))
  }
  // Merge parallel edges BEFORE emitting: the raw call-graph fact list carries
  // one edge per referencing file, so A→B can repeat a dozen times — dagre
  // stacks those chords onto each other (the「线叠加」complaint). One edge per
  // ordered pair with a ×N count keeps the information, drops the pile-up;
  // a two-way pair collapses into a single <--> edge (no feedback-edge
  // rank-juggling either). The per-diagram init overrides the desk's global
  // `curve: basis` ONLY here — basis bundles hub-fan graphs into spaghetti;
  // linear chords with wider spacing read cleanly for a call graph.
  const dirCount = new Map<string, number>()
  for (const edge of edges) {
    const key = `${edge.from}\u0000${edge.to}`
    dirCount.set(key, (dirCount.get(key) ?? 0) + 1)
  }
  const label = (count: number): string => `${verb}${count > 1 ? `×${count}` : ''}`
  const lines: string[] = ['%%{init: {"flowchart": {"curve": "linear", "nodeSpacing": 110, "rankSpacing": 170}}}%%', 'flowchart LR']
  lines.push('  classDef entry fill:#e8f0fe,stroke:#3f6fd8,color:#1c2a4a')
  lines.push('  classDef hub fill:#fff3d6,stroke:#c88a2d,color:#4a3410')
  lines.push('  classDef leaf fill:#f2f2f2,stroke:#8a8a8a,color:#3a3a3a')
  const emitted = new Set<string>()
  for (const edge of edges) {
    if (edge.from === edge.to) {
      if (!emitted.has(edge.from)) {
        emitted.add(edge.from)
        lines.push(`  ${edge.from} -->|${label(dirCount.get(`${edge.from}\u0000${edge.from}`) ?? 1)}| ${edge.from}`)
      }
      continue
    }
    const first = edge.from < edge.to ? edge.from : edge.to
    const second = edge.from < edge.to ? edge.to : edge.from
    const pairKey = `${first}\u0000${second}`
    if (emitted.has(pairKey)) continue
    emitted.add(pairKey)
    const ab = dirCount.get(`${first}\u0000${second}`) ?? 0
    const ba = dirCount.get(`${second}\u0000${first}`) ?? 0
    if (ab > 0 && ba > 0) lines.push(`  ${first} <-->|${label(ab + ba)}| ${second}`)
    else if (ab > 0) lines.push(`  ${first} -->|${label(ab)}| ${second}`)
    else lines.push(`  ${second} -->|${label(ba)}| ${first}`)
  }
  const byRole: Record<'entry' | 'hub' | 'leaf', string[]> = { entry: [], hub: [], leaf: [] }
  for (const [actor, role] of roles) byRole[role].push(actor)
  for (const role of ['entry', 'hub', 'leaf'] as const) {
    if (byRole[role].length > 0) lines.push(`  class ${byRole[role].join(',')} ${role}`)
  }
  return lines.join('\n')
}

/** One concept-tree node (wire shape of the backend concept chain). */
export interface ConceptNode {
  id: string
  name: string
  desc: string
  inside?: string
  pkg?: string
  children?: ConceptNode[]
  /** 'doc' = extracted from an architecture doc; 'flow' = AI-induced. */
  source?: 'doc' | 'flow'
  /** Source anchor: doc path + heading (evidence for explains). */
  ref?: string
  /** The section's full original text (evidence for explains). */
  sourceText?: string
}

/** One core interaction row (AI structured cache `index/.arch-lens-events-<lang>.json`). */
export interface CoreEvent {
  event: string
  mode: string
  producers: string[]
  consumers: string[]
  note: string
}

/** Flow-diagram viewpoints selectable on the flow tab (order = UI order). */
const FLOW_ANGLES: FlowAngle[] = ['event', 'pipeline']

/** localStorage key for the selected flow viewpoint. */
const FLOW_ANGLE_KEY = 'arch-lens-flow-angle'

/** localStorage key for the overview sub-tab (static rule-built / AI-generated). */
const OVERVIEW_VIEW_KEY = 'arch-lens-overview-view'

/** localStorage key for the interaction sub-tab (entity-level / method-level). */
const EVENTS_VIEW_KEY = 'arch-lens-events-view'

/** localStorage key for the flow sub-tab granularity (entity-level / method-level). */
const FLOW_GRAN_KEY = 'arch-lens-flow-gran'

/** localStorage key for the per-tab 🔬 方法级 switches. */
const METHOD_LEVEL_KEY = 'arch-lens-method-level'

/** Figure granularity: entity-level (top-level entities) or method-level
 * (real methods + call edges). Interaction and flow expose it as a sub-tab
 * switch; the remaining LLM tabs keep the 🔬 toggle. */
type FigureGranularity = 'entity' | 'method'

/** Tabs that accept the 🔬 方法级 switch (the LLM-figure tabs). The
 * interaction and flow tabs expose the granularity as a sub-tab switch;
 * concepts and deps are fixed to entity-level (no method-level entry). Only
 * the sequence tab keeps the 🔬 toggle. */
const METHOD_TABS = ['seq']

/** i18n key for one flow angle chip. */
const flowAngleKey = (angle: FlowAngle): 'flowAngleEvent' | 'flowAnglePipeline' =>
  angle === 'event' ? 'flowAngleEvent' : 'flowAnglePipeline'

/** Tab id → localized tab label key (type-safe; used by the figure-sent notice). */
const FIGURE_TAB_LABEL: Record<string, UiKey> = {
  concepts: 'tabConcepts',
  seq: 'tabSeq',
  flow: 'tabFlow',
  interaction: 'tabInteraction',
  deps: 'tabDeps',
  overview: 'tabOverview',
}

// Local mirror of the backend's dynamic-figure target key (the client MUST
// NOT import values from the backend main entry — it would pull the service
// bundle into the browser module table). The string must match byte-for-byte
// so the same cache file is hit; the file NAME (hash) is backend-owned.
type DynamicKind = 'seq-edge' | 'flow-subgraph' | 'overview'
type DynamicTarget = { from?: string; to?: string; label?: string; stage?: string }
const dynamicTargetKey = (kind: DynamicKind, target: DynamicTarget): string => {
  if (kind === 'seq-edge') return `seq:${target.from ?? ''}|${target.to ?? ''}|${target.label ?? ''}`
  if (kind === 'overview') return 'overview:all'
  return `flow:${target.stage ?? ''}`
}

/** Configured prompts (defaults live here until Config arrives). */
export interface ArchViewConfig {
  overviewPrompt?: string
  explainStyle?: string
}

// Module-level cache for the AI duty summaries only, keyed by workspace root
// + role language (the backend keeps its own per-workspace caches for every
// figure, so reopening the desk on the same workspace refetches instantly).
let cachedDutySummaries = new Map<string, Record<string, string> | null>()

/** One selectable popup target. */
type Selection =
  | { kind: 'pkg'; id: string }
  | { kind: 'event'; id: string }

/** Load state of the core-flow subgraph (deps / ER tabs). */
type CoreState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; source: string; core: ArchLensCoreGraph }
  | { status: 'error'; message: string }

/**
 * The study-desk props: the backend Remote, the desk config, the target
 * session id, the session-list hook (busy state), and a send verb bound to
 * the target session by the floating robot.
 */
export interface ArchViewProps {
  archLens: ArchLensRemote
  config: ArchViewConfig
  sessionId: string | null
  send: (text: string) => Promise<void>
  /** Cancel the target session's running turn (「⏹ 终止」: stops agent turns). */
  cancel: (sessionId: string) => Promise<void>
  useSessions: PropsRuntime<'shell.overlay'>['useSessions']
}

/**
 * The Arch Lens study desk entry component.
 */
export function ArchView(props: ArchViewProps): React.JSX.Element {
  const { archLens, config, sessionId } = props
  const [conceptTreeState, setConceptTreeState] = useState<ConceptNode[] | null>(null)
  // Two sequence views over one tab: 'code' = static call graph (code
  // facts), 'flow' = project-core main-flow sequence (doc verbatim or AI
  // induction). Both are fetched eagerly so switching views is instant.
  const [sequenceCodeState, setSequenceCodeState] = useState<ArchLensSequenceResult | null>(null)
  const [sequenceFlowState, setSequenceFlowState] = useState<ArchLensSequenceResult | null>(null)
  // 「调用关系图」真实数据源：代码索引里的跨包 import 引用边（非 AI，只读
  // 缓存）。与主流程时序（sequence 缓存）解耦——调用关系图不再渲染 AI 归纳。
  const [callGraphState, setCallGraphState] = useState<Array<{ from: string; to: string; label: string }> | null>(null)
  const [callGraphError, setCallGraphError] = useState<string | null>(null)
  const [seqView, setSeqView] = useState<'code' | 'flow'>('code')
  const [eventsState, setEventsState] = useState<CoreEvent[] | null>(null)
  const [eventsMethodsState, setEventsMethodsState] = useState<CoreEvent[] | null>(null)
  // 交互图的展示粒度：实体级 / 方法级（子页签切换，双数据槽各自缓存与懒加载，
  // 切视图不再互相覆盖）。视图选择持久化，刷新后保留。
  const [eventsView, setEventsView] = useState<'entity' | 'method'>(() => {
    try {
      return window.localStorage.getItem(EVENTS_VIEW_KEY) === 'method' ? 'method' : 'entity'
    } catch {
      return 'entity'
    }
  })
  const setEventsViewPersisted = (view: 'entity' | 'method'): void => {
    setEventsView(view)
    try { window.localStorage.setItem(EVENTS_VIEW_KEY, view) } catch { /* ignore */ }
  }
  // Flow diagrams per viewpoint × granularity — BOTH angles of the selected
  // granularity are fetched together (the backend generates them in one LLM
  // call), so switching the angle chip is instant and never costs another
  // model call. Entity/method granularities are separate cache files, loaded
  // lazily on sub-tab switch.
  const [flowMap, setFlowMap] = useState<Partial<Record<FlowAngle, Partial<Record<FigureGranularity, ArchLensFlowResult>>>>>({})
  // Selected granularity, persisted so reopening the page keeps the last
  // choice (and never re-requests the other granularity).
  const [flowView, setFlowView] = useState<FigureGranularity>(() => {
    try {
      return window.localStorage.getItem(FLOW_GRAN_KEY) === 'method' ? 'method' : 'entity'
    } catch {
      return 'entity'
    }
  })
  const setFlowViewPersisted = (view: FigureGranularity): void => {
    setFlowView(view)
    try { window.localStorage.setItem(FLOW_GRAN_KEY, view) } catch { /* ignore */ }
  }
  // Selected viewpoint, persisted so reopening the page keeps the last choice
  // (and never re-requests a different angle).
  const [flowAngle, setFlowAngle] = useState<FlowAngle>(() => {
    try {
      return window.localStorage.getItem(FLOW_ANGLE_KEY) === 'pipeline' ? 'pipeline' : 'event'
    } catch {
      return 'event'
    }
  })
  const setFlowAnglePersisted = (angle: FlowAngle): void => {
    setFlowAngle(angle)
    try { window.localStorage.setItem(FLOW_ANGLE_KEY, angle) } catch { /* ignore */ }
  }
  // 「已尝试加载」标记（`${angle}/${granularity}`）：flow RPC 读不到缓存（返回
  // null / error）时记录，渲染层据此显示"暂无数据"而不是永久"正在加载"——
  // 读/写分离下没有数据就是没有，不会自动生成。
  const [flowTried, setFlowTried] = useState<ReadonlySet<string>>(() => new Set())
  const flowTriedKey = (angle: FlowAngle, granularity: FigureGranularity): string => `${angle}/${granularity}`
  // 🔬 方法级 switch, per tab, default off: figures then generate from the
  // method-level summary (methods + real call edges) with their own LLM call.
  const [methodLevels, setMethodLevels] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(METHOD_LEVEL_KEY) ?? '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  // Synchronous source of truth for fetches (state updates are async, but a
  // toggle must reload the figure with the NEW granularity immediately).
  const methodLevelsRef = useRef(methodLevels)
  const methodOn = (tabId: string): boolean => methodLevelsRef.current[tabId] === true
  const setMethodPersisted = (tabId: string, on: boolean): void => {
    methodLevelsRef.current = { ...methodLevelsRef.current, [tabId]: on }
    setMethodLevels(previous => {
      const next = { ...previous, [tabId]: on }
      try { window.localStorage.setItem(METHOD_LEVEL_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  const setAllMethods = (on: boolean): void => {
    const next: Record<string, boolean> = { ...methodLevelsRef.current }
    for (const id of METHOD_TABS) next[id] = on
    methodLevelsRef.current = next
    setMethodLevels(next)
    try { window.localStorage.setItem(METHOD_LEVEL_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  const [promptConfig, setPromptConfig] = useState<ArchLensPromptConfig>({})
  const [editorOpen, setEditorOpen] = useState(false)
  const language = promptConfig.language ?? DEFAULT_LANGUAGE
  // Effective prompt: default templates follow the role language; saved
  // overrides (or deployment Config) win in "my prompts" mode.
  const useDefaults = useDefaultsConfig(promptConfig)
  const explainStyle = useDefaults
    ? (config.explainStyle ?? defaultStyle(language))
    : (promptConfig.explainStyle ?? config.explainStyle ?? DEFAULT_EXPLAIN_STYLE)
  // Figure data is derived from the workspace's own facts: concepts from the
  // architecture-doc chain, sequences from the static call graph (code view)
  // or the doc/AI core-flow chain (flow view), events from LLM structured
  // caches. No curated fallback: a null state renders an empty prompt to run
  // AI generate.
  const conceptTree = conceptTreeState
  const coreEvents = eventsState
  const [tab, setTab] = useState('concepts')
  const [graph, setGraph] = useState<ArchLensGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [followup, setFollowup] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  // The last explanation's thinking chain (model reasoning), shown in a
  // collapsible box under the tip row; empty reasoning hides the box.
  const [thinking, setThinking] = useState<{ text: string; reasoning: string } | null>(null)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  const [notes, setNotes] = useState<ArchLensNotesResult | { error: string } | null>(null)
  const [coreDeps, setCoreDeps] = useState<CoreState>({ status: 'idle' })
  // 架构概览 (rule-built): core packages + duties + import edges. The ER tab
  // was removed — it duplicated the dependency graph with no extra signal.
  const [overviewFig, setOverviewFig] = useState<CoreState>({ status: 'idle' })
  // 架构概览的展示角度：静态规则图 / AI 生成图（子页签切换，AI 图内联展示而非浮层）。
  const [overviewView, setOverviewView] = useState<'static' | 'ai'>(() => {
    try {
      return window.localStorage.getItem(OVERVIEW_VIEW_KEY) === 'ai' ? 'ai' : 'static'
    } catch {
      return 'static'
    }
  })
  const setOverviewViewPersisted = (view: 'static' | 'ai'): void => {
    setOverviewView(view)
    try { window.localStorage.setItem(OVERVIEW_VIEW_KEY, view) } catch { /* ignore */ }
  }
  const [summaries, setSummaries] = useState<Record<string, string> | null | undefined>(undefined)
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressGenerated, setProgressGenerated] = useState(false)
  // P1 live coverage badge: real-time asked/total from the zero-LLM
  // progressStats remote, refreshed with the load chain and after explain
  // turns (the 📊 summary itself stays the LLM coach's job).
  const [liveStats, setLiveStats] = useState<{ asked: number; total: number; progress: number } | null>(null)
  const [insights, setInsights] = useState<ArchLensCodeInsight[] | null>(null)
  const [aiGenRunning, setAiGenRunning] = useState(false)
  const [allGenRunning, setAllGenRunning] = useState(false)
  const [llmStats, setLlmStats] = useState<LlmStatsSnapshot | null>(null)
  const [llmStatsOpen, setLlmStatsOpen] = useState(false)
  const retryTimer = useRef<number | null>(null)
  // The workspace root the loaded figures belong to (the desk-info identity
  // resolved by setSession). Figure fetches capture the generation and drop
  // results that arrive after a workspace switch or language change.
  const workspaceKeyRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  // Set by「⏹ 终止」: generation handlers check it first and drop their
  // pending responses (so a late error never overwrites the stop notice).
  const stopRef = useRef(false)
  // In-flight follow-up redraw (✍️ 追问重画): aborting it stops the backend
  // LLM stream (cache stays untouched) and drops the pending response, so a
  // cancelled redraw never overwrites the current figure.
  const followUpAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  // Explain queue: at most one explain turn runs at a time. Requests are
  // queued, not rejected — when the session turn ends (running flips false
  // after a submit), the next queued request is submitted automatically.
  const explainQueueRef = useRef<Array<{ text: string; target: string }>>([])
  /** 讲解附件脏检：记录上一次 askFollowUpExplain 随问题发出的【当前图 mermaid
   * 源】。同一图（kind/视角/粒度一致）且源文本未变时，后续讲解只发一句引用
   * ——附件还留在同一会话的历史里，省每次 2-5KB 重复输入。会话切换或讲解队列
   * 被手动清空（历史/待发附件失效）时复位。极端情况：入队后发送失败会丢一条
   * 带全量附件的消息、而其后的引用条目按"已发过"处理——此时模型仍可通过工作
   * 区工具自查，属可接受的小概率退化。 */
  const lastAttachedFigRef = useRef<{ key: string; source: string } | null>(null)
  const explainingRef = useRef(false)
  const sawRunningRef = useRef(false)
  const pumpTimerRef = useRef<number | null>(null)

  // Graph load with bounded auto-retry: right after a page load the session
  // channel may not be established yet, and the first remote call fails with
  // "Failed to fetch". Back off a few seconds instead of showing an error.
  // Results from a superseded workspace or language are dropped. The graph
  // result carries the workspace root (the desk-info identity): a root
  // different from the current one means the data source moved to another
  // workspace, so the previous workspace's figures are dropped and re-pulled.
  const loadGraph = (attempt = 0): void => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    const generation = generationRef.current
    setError(null)
    void unwrapRemote(archLens.graph()).then(result => {
      if (result === null) {
        // 无事实缓存（从未 rescan 或磁盘缓存被置无效）：合法状态，不是错误 —
        // 渲染「请点击 重新扫描」引导，绝不自动扫盘。
        if (generation !== generationRef.current) return
        setGraph(null)
        return
      }
      if ('error' in result) {
        if (attempt < 2) {
          retryTimer.current = window.setTimeout(() => loadGraph(attempt + 1), 1500 * (attempt + 1))
          return
        }
        setError(result.error)
        return
      }
      if (generation !== generationRef.current) return
      const root = result.root ?? null
      if (root !== workspaceKeyRef.current) {
        workspaceKeyRef.current = root
        clearFigures()
        loadAllFigures()
        return
      }
      setGraph(result)
    }).catch((reason: unknown) => {
      if (attempt < 2) {
        retryTimer.current = window.setTimeout(() => loadGraph(attempt + 1), 1500 * (attempt + 1))
        return
      }
      setError(String(reason))
    })
  }

  /** Drop every figure state and invalidate in-flight fetches (the module caches stay). */
  const clearFigures = (): void => {
    generationRef.current += 1
    setGraph(null)
    setError(null)
    setConceptTreeState(null)
    setSequenceCodeState(null)
    setSequenceFlowState(null)
    setCallGraphState(null)
    setCallGraphError(null)
    setEventsState(null)
    setEventsMethodsState(null)
    setFlowMap({})
    setFlowTried(new Set())
    setCoreDeps({ status: 'idle' })
    setOverviewFig({ status: 'idle' })
    setInsights(null)
    setSummaries(undefined)
  }

  /** Fetch both sequence views for one generation (code call graph + main-flow sequence).
   * directRemote: the injected sequence descriptor strips new request fields
   * (methodLevel), so the raw gateway path is used for ALL figure fetches. */
  const loadSequences = (generation: number): void => {
    void directRemote<ArchLensSequenceResult | null | { error: string }>('sequence', { request: { language, methodLevel: methodOn('seq') } }).then(data => {
      if (generation !== generationRef.current) return
      if (data !== null && !('error' in data)) setSequenceCodeState(data)
    }).catch(() => {})
    // 读路径：主流程时序视图与调用关系图视图共用同一版本化缓存（写路径在
    // AI 生成时写）。原 prefer:'flow' 区分已被读/写分离取代。
    void directRemote<ArchLensSequenceResult | null | { error: string }>('sequence', { request: { language, methodLevel: methodOn('seq') } }).then(data => {
      if (generation !== generationRef.current) return
      if (data !== null && !('error' in data)) setSequenceFlowState(data)
    }).catch(() => {})
    // 「调用关系图」真实数据源（纯读索引缓存，非 AI）：跨包 import 引用边。
    void directRemote<{ ok: true; edges: Array<{ from: string; to: string; label: string }> } | { error: string }>('callGraph', { request: { language } }).then(data => {
      if (generation !== generationRef.current) return
      if (data !== null && 'ok' in data && data.ok) {
        setCallGraphState(data.edges)
        setCallGraphError(null)
      } else if (data !== null && 'error' in data) {
        setCallGraphError(data.error)
      }
    }).catch(() => setCallGraphError('调用关系图加载失败'))
  }

  /** Re-pull EVERY figure for the current workspace root, no backend invalidation. */
  const loadAllFigures = (): void => {
    const generation = generationRef.current
    // Each stage is fire-and-forget: a single stale-remote failure must never
    // block the rest of the load chain (graphs must still render).
    try { loadMetadata() } catch { /* metadata is non-critical */ }
    try { loadGraph() } catch { /* retried by the error UI */ }
    refreshLiveStats()
    void directRemote<RemoteConceptNode[] | null | { error: string }>('conceptTree', { request: { language } }).then(tree => {
      if (generation !== generationRef.current) return
      if (tree !== null && !('error' in tree)) setConceptTreeState(tree)
    }).catch(() => {})
    loadSequences(generation)
    void directRemote<Array<CoreEvent> | null | { error: string }>('events', { request: { language } }).then(data => {
      if (generation !== generationRef.current) return
      if (data !== null && !('error' in data)) setEventsState(data)
    }).catch(() => {})
    void directRemote<Array<CoreEvent> | null | { error: string }>('events', { request: { language, methodLevel: true } }).then(data => {
      if (generation !== generationRef.current) return
      if (data !== null && !('error' in data)) setEventsMethodsState(data)
    }).catch(() => {})
    // Both flow viewpoints are served from the backend's shared profile
    // (generated together in one LLM call), so fetching both is free.
    ensureFlow(generation)
    if (tab === 'deps') {
      fetchCore()
    } else if (tab === 'overview') {
      fetchOverview()
    }
  }

  /**
   * Lazy figure loaders: each AI-derived unit (concepts / seq / flow /
   * events) is fetched on first view and after a rescan clears its state.
   * This keeps a rescan purely factual — no figure is auto-generated unless
   * the user actually looks at its tab.
   */
  const ensureConcepts = (force = false): void => {
    if (!force && conceptTreeState !== null) return
    const generation = generationRef.current
    void directRemote<RemoteConceptNode[] | null | { error: string }>('conceptTree', { request: { language } }).then(tree => {
      if (generation !== generationRef.current) return
      if (tree !== null && !('error' in tree)) setConceptTreeState(tree)
    }).catch(() => {})
  }

  const ensureSequences = (force = false): void => {
    if (!force && (sequenceCodeState !== null || sequenceFlowState !== null)) return
    loadSequences(generationRef.current)
  }

  /** Fetch both flow viewpoints once (each served from the profile/cache —
   * the backend generates them together, so this never doubles LLM work).
   * Goes through directRemote: the injected flow descriptor lags the host
   * and strips the angle/methodLevel fields.
   * @param generation - the generation guard to validate results against.
   * @param granularity - entity or method level to fetch.
   * @param force - skip the already-loaded check (used after a rescan, whose
   *   clearFigures() has not re-rendered yet, so the closure still holds the
   *   stale pre-clear state and would wrongly skip the re-pull).
   */
  const ensureFlow = (generation: number = generationRef.current, granularity: FigureGranularity = flowView, force = false): void => {
    for (const angle of FLOW_ANGLES) {
      if (!force && flowMap[angle]?.[granularity] !== undefined) continue
      void directRemote<ArchLensFlowResult | null | { error: string }>('flow', { request: { language, angle, methodLevel: granularity === 'method' } }).then(data => {
        if (generation !== generationRef.current) return
        // 无论有无数据都标记"已尝试"：null（无缓存）/ error 时不落图数据，
        // 渲染层据此显示"暂无数据"而不是永久加载（读不到不会自动生成）。
        const key = flowTriedKey(angle, granularity)
        setFlowTried(previous => (previous.has(key) ? previous : new Set(previous).add(key)))
        if (data !== null && !('error' in data)) setFlowMap(previous => ({ ...previous, [angle]: { ...previous[angle], [granularity]: data } }))
      }).catch(() => {})
    }
  }

  /** 流程图子页签切换：实体级 / 方法级；切到目标粒度时若该粒度还没数据，懒加载。 */
  const selectFlowView = (view: FigureGranularity): void => {
    setFlowViewPersisted(view)
    ensureFlow(generationRef.current, view)
  }

  /** Fetch BOTH interaction views once (entity-level + method-level, each
   * served from its own cache file). Kept lazy per figure like the other
   * tabs; both are pulled together so switching the sub-tab is instant. */
  const ensureEvents = (force = false): void => {
    const generation = generationRef.current
    if (force || eventsState === null) {
      void directRemote<Array<CoreEvent> | null | { error: string }>('events', { request: { language } }).then(data => {
        if (generation !== generationRef.current) return
        if (data !== null && !('error' in data)) setEventsState(data)
      }).catch(() => {})
    }
    if (force || eventsMethodsState === null) {
      void directRemote<Array<CoreEvent> | null | { error: string }>('events', { request: { language, methodLevel: true } }).then(data => {
        if (generation !== generationRef.current) return
        if (data !== null && !('error' in data)) setEventsMethodsState(data)
      }).catch(() => {})
    }
  }

  /** 交互图子页签切换：切换视图时若目标视图还没数据，懒加载它。 */
  const selectEventsView = (view: 'entity' | 'method'): void => {
    setEventsViewPersisted(view)
    if (view === 'method' ? eventsMethodsState === null : eventsState === null) ensureEvents()
  }

  /** Load only the ACTIVE tab's figure (used after a rescan; the other tabs
   * load lazily when switched to, so a rescan never generates figures by
   * itself — it rebuilds facts only). `force` skips the already-loaded
   * checks: clearFigures() just ran inside the same handler and its state
   * updates have not re-rendered yet, so the closures would otherwise read
   * stale non-null state and wrongly skip the re-pull.
   * @param force - force a re-pull of the active tab's figure.
   */
  const ensureActiveTab = (force = false): void => {
    if (tab === 'concepts') ensureConcepts(force)
    else if (tab === 'seq') ensureSequences(force)
    else if (tab === 'flow') ensureFlow(generationRef.current, flowView, force)
    else if (tab === 'interaction') ensureEvents(force)
    else if (tab === 'catalog') loadSummaries(0)
    else if (tab === 'deps') {
      loadCore(force)
    } else if (tab === 'overview') {
      if (force || overviewFig.status === 'idle') fetchOverview()
    }
  }

  /** 估算 token 的显示格式（≥1000 显示为 x.xk）。 */
  const fmtTokens = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  /** 拉取 LLM 用量统计（累计 + 最近记录，落盘 index/.arch-lens-llm-stats.json）。
   * 防御性隔离：remote 方法在旧运行时缺失时绝不能拖垮主加载链。 */
  const refreshLlmStats = (): void => {
    try {
      void directRemote<LlmStatsSnapshot>('llmStats', {}).then(setLlmStats).catch(() => {})
    } catch {
      // llmStats remote unavailable (stale runtime) — statistics stay empty.
    }
  }

  /** 实时覆盖度徽章数据：progressStats 纯算术旁路（零 LLM），失败静默保留旧值。 */
  const refreshLiveStats = (): void => {
    if (NOTES_FEATURE_OFF) return
    try {
      void unwrapRemote(archLens.progressStats()).then(result => {
        if ('error' in result) return
        setLiveStats({ asked: result.asked.length, total: result.total, progress: result.progress })
      }).catch(() => {})
    } catch {
      // progressStats remote unavailable (stale runtime) — badge stays hidden.
    }
  }

  /** Refresh the per-workspace metadata (prompt config, code insights).
   * Notes are lazy (loaded on demand by the notes panel); each item is
   * fire-and-forget so one failure never blocks the rest of the load. */
  const loadMetadata = (): void => {
    const generation = generationRef.current
    void unwrapRemote(archLens.promptConfig()).then(result => {
      if (generation === generationRef.current) setPromptConfig(result.config)
    }).catch(() => {})
    void unwrapRemote(archLens.analyze()).then(result => {
      if (generation !== generationRef.current) return
      if (!('error' in result)) setInsights(result)
    }).catch(() => {})
    refreshLlmStats()
  }

  /** Load the notes summary lazily (only when the notes panel asks for it). */
  const loadNotes = (): void => {
    if (notes !== null) return
    const generation = generationRef.current
    try {
      void unwrapRemote(archLens.notes()).then(result => {
        if (generation === generationRef.current) setNotes(result)
      }).catch(() => {})
    } catch {
      // ignore
    }
  }

  /** 单次调用的显示 token：provider 实际 usage 优先，字符估算兜底。 */
  const recordTokens = (record: LlmStatsSnapshot['records'][number]): { inText: string; outText: string; actual: boolean; reasoning?: string } => {
    const usage = record.usage
    if (usage !== undefined) {
      return {
        inText: fmtTokens(usage.inTokens),
        outText: fmtTokens(usage.outTokens),
        actual: true,
        ...(usage.reasoningTokens !== undefined && usage.reasoningTokens > 0 ? { reasoning: fmtTokens(usage.reasoningTokens) } : {}),
      }
    }
    return { inText: fmtTokens(record.estInTokens), outText: fmtTokens(record.estOutTokens), actual: false }
  }

  /** 完成通知 + 最新一次 LLM 调用的 token（实际/估算）与耗时（输入→输出）。 */
  const noticeWithLlm = (base: string): void => {
    setNotice(base)
    try {
      void directRemote<LlmStatsSnapshot>('llmStats', {}).then(stats => {
        setLlmStats(stats)
        const last = stats.records[0]
        if (last !== undefined) {
          const tokens = recordTokens(last)
          setNotice(`${base}（${tokens.actual ? '实际' : '估算'} ${tokens.inText}→${tokens.outText} tokens${tokens.reasoning !== undefined ? ` +${tokens.reasoning} reasoning` : ''}，耗时 ${(last.ms / 1000).toFixed(1)}s）`)
        }
      }).catch(() => {})
    } catch {
      // llmStats remote unavailable — keep the plain completion notice.
    }
  }

  // Load the data source for the current session's workspace, then pull the
  // figures. This is the ONE load path: mount, session switch, and the reload
  // button all land here. The backend setSession is cache-first (never
  // invalidates), and the workspace identity rides the graph result
  // (`graph.root`), so loadGraph decides whether the data source actually
  // moved and re-pulls only when it did.
  useEffect(() => {
    let cancelled = false
    // 会话切换：旧会话历史里的附件引用对新目标会话无意义，复位脏检记录。
    lastAttachedFigRef.current = null
    void unwrapRemote(archLens.setSession(sessionId)).then(() => {
      if (cancelled) return
      loadAllFigures()
    }).catch((reason: unknown) => {
      if (cancelled) return
      setNotice(uiT(language, 'sessionSwitchFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
    return () => { cancelled = true }
  }, [archLens, sessionId, language])

  useEffect(() => {
    // Figure loading is owned by the setSession effect on the first mount;
    // this effect only re-pulls when the role language changes.
    if (mountedRef.current) {
      generationRef.current += 1
      loadAllFigures()
    }
    mountedRef.current = true
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
      if (pumpTimerRef.current !== null) window.clearTimeout(pumpTimerRef.current)
    }
  }, [archLens, language])

  /** Submit one queued explain request; only one runs at a time. */
  const pumpExplainQueue = (): void => {
    if (explainingRef.current) return
    const next = explainQueueRef.current.shift()
    if (next === undefined) return
    if (props.sessionId === null) {
      setNotice(ui(language, 'noSessionNotice'))
      pumpExplainQueue()
      return
    }
    explainingRef.current = true
    sawRunningRef.current = false
    // Stage the note metadata BEFORE the send: the pending slot must already
    // hold the question while the answer is in flight, so the backend's
    // assistant/message listener can match it. A failed send clears the
    // staged metadata so no later ordinary message gets mis-recorded as an
    // explain.
    void unwrapRemote(archLens.notePending({
      target: next.target,
      text: next.text,
      sessionId: props.sessionId,
    })).catch(() => {})
    void props.send(next.text).catch((reason: unknown) => {
      // Transport/business failure: surface it, drop the staged note metadata
      // (notePending with an empty text clears the backend slot), unlock
      // immediately, and move on to the next queued request instead of
      // waiting for the turn.
      console.error('[arch-lens] explain send failed:', reason)
      setNotice(uiT(language, 'sendFailedNotice', { msg: reason instanceof Error ? reason.message : String(reason) }))
      void unwrapRemote(archLens.notePending({
        target: next.target,
        text: '',
        ...(props.sessionId === null ? {} : { sessionId: props.sessionId }),
      })).catch(() => {})
      explainingRef.current = false
      sawRunningRef.current = false
      pumpExplainQueue()
    })
    // Safety net: if the turn never starts (submit failed at the transport
    // layer), unlock and continue with the next request instead of stalling.
    if (pumpTimerRef.current !== null) window.clearTimeout(pumpTimerRef.current)
    pumpTimerRef.current = window.setTimeout(() => {
      if (explainingRef.current && !sawRunningRef.current) {
        explainingRef.current = false
        setNotice(ui(language, 'sendSkipNotice'))
        pumpExplainQueue()
      }
    }, 20000)
  }

  // Turn completion unlocks the queue: after a submit, wait for running to
  // flip true (turn started) and then false (turn finished) before the next.
  // A session-driven FIGURE generation completes the same way: when the turn
  // finishes, the backend has written the figure cache — refetch and render.
  const running = props.useSessions(state =>
    props.sessionId === null ? false : (state.byId[props.sessionId as SessionId]?.running ?? false))
  useEffect(() => {
    if (running) sawRunningRef.current = true
    if (!running && sawRunningRef.current) {
      sawRunningRef.current = false
      const stagedFigure = pendingFigureRef.current
      if (stagedFigure !== null) {
        pendingFigureRef.current = null
        setAiGenRunning(false)
        setNotice(ui(language, 'figureDone'))
        // The agent's answer was parsed and cached by the backend — a plain
        // refetch of this tab renders the fresh figure. The short delay lets
        // the backend's async cache write land first (it uses the staged
        // index, so it is milliseconds — this is just a safety margin).
        const refetch = (): void => {
          if (stagedFigure.kind === 'concepts') { setConceptTreeState(null); ensureConcepts(true) }
          else if (stagedFigure.kind === 'seq') { setSequenceCodeState(null); setSequenceFlowState(null); setCallGraphState(null); setCallGraphError(null); loadSequences(generationRef.current) }
          else if (stagedFigure.kind === 'flow') { setFlowMap({}); ensureFlow(generationRef.current, flowView, true) }
          else if (stagedFigure.kind === 'interaction') { setEventsState(null); setEventsMethodsState(null); ensureEvents(true) }
          else { fetchCore() }
        }
        window.setTimeout(refetch, 400)
        return
      }
      const stagedDynamic = pendingDynamicRef.current
      if (stagedDynamic !== null) {
        pendingDynamicRef.current = null
        // The backend cached the dynamic detail (matched by figId) — fetch it
        // into the overlay. A short delay mirrors the figure refetch margin.
        window.setTimeout(() => loadDynamicFigure(stagedDynamic.key), 400)
        return
      }
      const stagedDraw = pendingDrawRef.current
      if (stagedDraw !== null) {
        pendingDrawRef.current = null
        // The backend captured the custom figure (diagram + 概要) in memory —
        // fetch it into the 🎨 动态出图 tab (no disk write happened).
        window.setTimeout(() => loadDrawFigure(stagedDraw.figureId), 400)
        return
      }
      if (explainingRef.current) {
        explainingRef.current = false
        pumpExplainQueue()
        // The finished explanation's thinking chain (reasoning blocks live in
        // the session message; the backend projects them out for the panel).
        if (props.sessionId !== null) {
          try {
            void directRemote<{ text: string; reasoning: string } | { error: string }>('lastAnswer', { request: { sessionId: props.sessionId } }).then(result => {
              if ('error' in result) return
              if (result.reasoning.trim() !== '') {
                setThinking(result)
                setThinkingOpen(true)
              } else {
                setThinking(result)
              }
            }).catch(() => {})
          } catch {
            // lastAnswer remote unavailable (stale runtime) — no thinking box.
          }
          // 讲解回合结束 → 笔记覆盖度可能变化：刷新实时徽章（零 LLM）。
          refreshLiveStats()
        }
      }
    }
  }, [running])

  // One staged session-driven figure generation: { figId, kind } — the GUI
  // conversation stream shows the agent working; on turn completion the
  // running-flip effect refetches this tab's figure (backend already cached).
  const pendingFigureRef = useRef<{ figId: string; kind: string } | null>(null)

  // DYNAMIC figure drill-down (「动态画图」hover): the overlay shows the
  // generated detail; per-target results are kept in memory + disk cache so a
  // later hover opens them instantly without re-generating.
  const dynamicCacheRef = useRef<Map<string, { title: string; diagram: string }>>(new Map())
  const pendingDynamicRef = useRef<{ figId: string; key: string } | null>(null)
  /**
   * L2.5 渲染即校验：the browser's mermaid is the ONLY syntax authority (the
   * host has no DOM). Drill-down figures are auto-persisted at capture, so a
   * render failure must purge BOTH stores — the disk cache (host side) and
   * this panel's own memory map — or the broken diagram lives on forever.
   * Fire-and-forget: even if the host cannot delete (absent/read-only), the
   * memory purge still stands; the visible inline error is kept (purge is
   * cleanup, not suppression).
   */
  const invalidateDynamicFigure = (kind: DynamicKind, key: string): void => {
    dynamicCacheRef.current.delete(key)
    void directRemote<{ ok: true; removed: boolean } | { error: string }>('dynamicFigureFailed', { request: { kind, targetKey: key, language } }).then(result => {
      if (!('error' in result) && result.removed) setNotice(ui(language, 'dynamicCacheInvalidated'))
    }).catch(() => { /* best-effort; memory side already purged */ })
  }
  /** 保存门槛 + 🔧修复按钮（L2.5 消费方②/L3 触发器）：the settled render
   * verdict for the EXACT diagram text the draw panel shows now — STATE (not
   * a ref) because the 保存 gate AND the repair button must re-render with it.
   * A failed render blocks 保存 (a figure the browser proved unrenderable
   * never reaches disk) and surfaces 「🔧 按报错修复重画」. Keyed by text: a
   * redraw/new scene changes the text → the stale verdict no longer applies. */
  const [drawRenderVerdict, setDrawRenderVerdict] = useState<{ diagram: string; error: string | null } | null>(null)
  /** Consecutive failed REPAIR rounds per scene (manual button only — the
   * counter never triggers anything automatically); reset on a successful
   * render. At ≥3 the button copy pivots to「重新生成」guidance (a model that
   * failed 3 syntax fixes on one diagram needs a fresh draw, not more feeding). */
  const repairAttemptsRef = useRef<Map<string, number>>(new Map())
  const [dynamicFig, setDynamicFig] = useState<{
    key: string
    kind: DynamicKind
    title?: string
    diagram?: string
    status: 'generating' | 'ready' | 'error'
    message?: string
  } | null>(null)
  const [dynamicCollapsed, setDynamicCollapsed] = useState(false)

  /**
   * 「动态画图」: open (or generate) the detail figure for ONE hovered
   * sequence edge or flow subgraph. Cached results open instantly — first the
   * in-memory cache, then the DISK cache (a page refresh empties the memory
   * map, so a previously generated detail must still open without a new LLM
   * turn). A miss stages the prompt host-side (dynamicFigurePrompt) and sends
   * it into the current session — the conversation stream shows the agent
   * drawing, and the running-flip effect fetches the cached diagram when the
   * turn ends.
   */
  const requestDynamicFigure = (kind: DynamicKind, target: DynamicTarget, mermaidSource?: string, generate = true): void => {
    const key = dynamicTargetKey(kind, target)
    const cached = dynamicCacheRef.current.get(key)
    if (cached !== undefined) {
      setDynamicFig({ key, kind, title: cached.title, diagram: cached.diagram, status: 'ready' })
      setDynamicCollapsed(false)
      return
    }
    if (pendingDynamicRef.current !== null || dynamicFig?.status === 'generating') return
    // Disk-cache fallback: after a page refresh the memory map is empty, but
    // the per-target cache file may exist — open it instead of re-generating.
    const openCached = (result: { title: string; diagram: string } | null | { error: string }): void => {
      if (result === null || 'error' in result) {
        if (!generate) return // cache-only read (sub-tab switch): keep the empty state
        startDynamicGeneration(kind, target, mermaidSource, key)
        return
      }
      dynamicCacheRef.current.set(key, { title: result.title, diagram: result.diagram })
      setDynamicFig({ key, kind, title: result.title, diagram: result.diagram, status: 'ready' })
      setDynamicCollapsed(false)
    }
    void directRemote<{ title: string; diagram: string } | null | { error: string }>('dynamicFigure', { request: { kind, targetKey: key, language } })
      .then(openCached)
      .catch(() => startDynamicGeneration(kind, target, mermaidSource, key))
  }

  /** Stage a dynamic figure prompt host-side and send it into the session.
   * 职责事实由 host 从磁盘自取（dutyFactsForFigure）——客户端不再附带任何
   * blurbs 载荷（LEGACY 填洞已删除，职责→出图是磁盘状态的纯函数）。 */
  const startDynamicGeneration = (kind: DynamicKind, target: DynamicTarget, mermaidSource: string | undefined, key: string): void => {
    if (pendingDynamicRef.current !== null || dynamicFig?.status === 'generating') return
    setDynamicFig({ key, kind, status: 'generating' })
    setDynamicCollapsed(false)
    const request: Record<string, unknown> = { kind, target, language }
    if (kind === 'flow-subgraph' && mermaidSource !== undefined) request.context = { mermaid: mermaidSource }
    void directRemote<{ figId: string; prompt: string } | { error: string }>('dynamicFigurePrompt', { request }).then(result => {
      if ('error' in result) {
        setDynamicFig({ key, kind, status: 'error', message: result.error })
        return
      }
      pendingDynamicRef.current = { figId: result.figId, key }
      try {
        void props.send(result.prompt).catch((reason: unknown) => {
          pendingDynamicRef.current = null
          setDynamicFig({ key, kind, status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
        })
      } catch (reason) {
        pendingDynamicRef.current = null
        setDynamicFig({ key, kind, status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
      }
    }).catch((reason: unknown) => {
      setDynamicFig({ key, kind, status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  /** Fetch one cached dynamic figure after the generating turn completes. */
  const loadDynamicFigure = (key: string): void => {
    const kind: DynamicKind = key === 'overview:all' ? 'overview' : key.startsWith('seq:') ? 'seq-edge' : 'flow-subgraph'
    void directRemote<{ title: string; diagram: string } | null | { error: string }>('dynamicFigure', { request: { kind, targetKey: key, language } }).then(result => {
      if (result === null || 'error' in result) {
        setDynamicFig(current => current === null || current.key !== key ? current : { ...current, status: 'error', message: 'dynamic figure not found' })
        return
      }
      dynamicCacheRef.current.set(key, { title: result.title, diagram: result.diagram })
      setDynamicFig(current => current === null || current.key !== key ? current : { key, kind, title: result.title, diagram: result.diagram, status: 'ready' })
      setNotice(ui(language, 'dynamicDone'))
    }).catch(() => {
      setDynamicFig(current => current === null || current.key !== key ? current : { ...current, status: 'error', message: 'dynamic figure fetch failed' })
    })
  }

  // 🎨 动态出图 (custom figure): the user types ANY request ("存图的逻辑，
  // 怎么存的，存哪、怎么读的…"), the agent draws a diagram + 概要 via the
  // session turn (the prompt embeds the FULL scan facts). The result is
  // memory-only by default; the 保存 button persists it explicitly.
  const pendingDrawRef = useRef<{ figId: string; figureId: string } | null>(null)
  const [drawText, setDrawText] = useState('')
  /** The 🎨 draw textarea — focused after a graph node is sent into it. */
  const drawTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** Every known scene (saved on disk + unsaved in memory), for the scene
   * list: 查看/删除/追问 target a scene by its stable figureId (`dynamic-N`). */
  const [drawFigures, setDrawFigures] = useState<Array<{ figureId: string; title: string; text: string; saved: boolean }>>([])
  const [drawFig, setDrawFig] = useState<{
    status: 'idle' | 'generating' | 'ready' | 'error'
    figureId?: string | undefined
    title?: string
    diagram?: string
    summary?: string
    text?: string
    message?: string
    /** True when the CURRENT content is persisted under the scene id (a
     * follow-up re-render flips it back to false — 保存 re-locks it). */
    saved?: boolean
  }>({ status: 'idle' })

  /**
   * 右键选中清单：chips of {kind,label} scoped to the draw panel's CURRENT
   * scene figureId (user rule: 不跨 tab、不跨图号 — picking in another scene
   * replaces the list, and a stale list never composes into a new intent).
   */
  const [drawSelection, setDrawSelection] = useState<{ figureId: string; items: SelectionTarget[] }>({ figureId: '', items: [] })
  /** The chip list ONLY counts while it belongs to the scene on screen. */
  const currentSelectionItems = (): SelectionTarget[] =>
    drawFig.figureId !== undefined && drawSelection.figureId === drawFig.figureId ? drawSelection.items : []
  const addDrawSelection = (kind: SelectionKind, label: string): void => {
    const figureId = drawFig.figureId ?? ''
    const target = { kind, label }
    setDrawSelection(previous =>
      previous.figureId !== figureId ? { figureId, items: [target] } : { figureId, items: withSelection(previous.items, target) })
    requestAnimationFrame(() => { drawTextareaRef.current?.focus() })
  }
  const removeDrawSelection = (target: SelectionTarget): void => {
    setDrawSelection(previous => ({ ...previous, items: withoutSelection(previous.items, target) }))
  }

  /** Stage a custom-figure prompt host-side and send it into the session. The
   * target scene id (`drawFig.figureId`) is reused for a FOLLOW-UP (追问重画);
   * a fresh scene allocates a new `dynamic-N` id host-side.
   * 最终意图 = 选中目标清单(chips) + 用户语言(可空)——按钮本身即动词（重画），
   * 组合后的文本是唯一进 prompt 的目标描述；发送成功即清空清单（一次性意图）。 */
  const drawFigure = (): void => {
    const raw = drawText.trim()
    const chips = currentSelectionItems()
    if (raw === '' && chips.length === 0) return
    const text = composeSelectionBlock(`图号 ${drawFig.figureId ?? ''}`, chips)
      + (raw !== '' ? raw : chips.length > 0 ? '无附加文字：请聚焦上述选中目标，重画/扩展它们的细节与关联。' : '')
    if (text.trim() === '' || pendingDrawRef.current !== null || drawFig.status === 'generating') return
    stopRef.current = false
    const targetId = drawFig.figureId
    setDrawFig({ status: 'generating', figureId: targetId })
    void directRemote<{ figId: string; figureId: string; prompt: string } | { error: string }>('customFigurePrompt', {
      request: { text, figureId: targetId, language },
    }).then(result => {
      if ('error' in result) {
        setDrawFig({ status: 'error', figureId: targetId, message: result.error })
        return
      }
      pendingDrawRef.current = { figId: result.figId, figureId: result.figureId }
      setDrawFig({ status: 'generating', figureId: result.figureId })
      // The composed intent left the desk — the one-shot chip list clears.
      setDrawSelection({ figureId: '', items: [] })
      const fail = (reason: unknown): void => {
        pendingDrawRef.current = null
        setDrawFig({ status: 'error', figureId: result.figureId, message: reason instanceof Error ? reason.message : String(reason) })
      }
      try {
        void props.send(result.prompt).catch(fail)
      } catch (reason) {
        fail(reason)
      }
    }).catch((reason: unknown) => {
      setDrawFig({ status: 'error', figureId: targetId, message: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  /** Fetch the in-memory custom figure (diagram + 概要) for the staged scene
   * after the turn ends, then refresh the scene list. The scene id is passed
   * explicitly — by the time the 400 ms refetch delay fires, the staged
   * pendingDrawRef slot has already been cleared by the turn-completion
   * effect, so reading it here would always miss (figure never rendered). */
  const loadDrawFigure = (figureId: string): void => {
    if (figureId === '') return
    void directRemote<{ figureId: string; title: string; diagram: string; summary: string; text: string; saved?: boolean } | null | { error: string }>('customFigure', { request: { figureId } }).then(result => {
      if (result === null || 'error' in result) {
        setDrawFig(current => current.status === 'generating' ? { status: 'error', message: 'custom figure not found' } : current)
        return
      }
      setDrawFig({ status: 'ready', figureId: result.figureId, title: result.title, diagram: result.diagram, summary: result.summary, text: result.text, saved: result.saved === true })
      refreshDrawFigures()
      setNotice(ui(language, 'drawDone'))
    }).catch((reason: unknown) => {
      setDrawFig(current => current.status === 'generating'
        ? { status: 'error', message: reason instanceof Error ? reason.message : String(reason) }
        : current)
    })
  }

  /** Refresh the scene list from the backend (saved disk scenes + memory). */
  const refreshDrawFigures = (): void => {
    void directRemote<Array<{ figureId: string; title: string; text: string; saved: boolean }> | { error: string }>('customFigureList', {}).then(list => {
      if (!('error' in list)) setDrawFigures(list)
    }).catch(() => {})
  }

  /** 新增场景动图: reset the active slot to a brand-new scene (its id is
   * allocated host-side on the next 画图). */
  const newDrawScene = (): void => {
    setDrawText('')
    setDrawFig({ status: 'idle' })
    setNotice(ui(language, 'drawSceneNew'))
  }

  /** Load ONE scene (查看): memory content first, else the saved disk file. */
  const selectDrawFigure = (figureId: string): void => {
    void directRemote<{ figureId: string; title: string; diagram: string; summary: string; text: string; saved?: boolean } | null | { error: string }>('customFigure', { request: { figureId } }).then(result => {
      if (result === null || 'error' in result) return
      setDrawFig({ status: 'ready', figureId: result.figureId, title: result.title, diagram: result.diagram, summary: result.summary, text: result.text, saved: result.saved === true })
      setDrawText(result.text)
    }).catch(() => {})
  }

  /** Delete a scene by its figureId (disk tombstoned host-side; memory dropped). */
  const deleteDrawFigure = (figureId: string): void => {
    void directRemote<{ ok: true } | { error: string }>('customFigureDelete', { request: { figureId } }).then(result => {
      if ('error' in result) {
        setNotice(uiT(language, 'drawDeleteFailed', { msg: result.error }))
        return
      }
      refreshDrawFigures()
      setDrawFig(current => current.figureId === figureId ? { status: 'idle' } : current)
      setNotice(uiT(language, 'drawDeleted', { id: figureId }))
    }).catch((reason: unknown) => {
      setNotice(uiT(language, 'drawDeleteFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** 保存按钮: persist the ACTIVE scene under its locked figureId
   * (`index/.arch-lens-draw-<figureId>-<lang>.json`) — 保存当前的图-锁定图号. */
  const saveDrawFigure = (): void => {
    if (drawFig.status !== 'ready' || drawFig.figureId === undefined) return
    // 渲染即校验门槛：this exact diagram text has been rendered and FAILED →
    // saving would persist a figure the browser already proved unrenderable.
    // Unknown verdict (still rendering) passes — the button needs a ready
    // render to appear at all, so in practice the verdict is settled here.
    const verdict = drawRenderVerdict
    if (drawFig.diagram !== undefined && verdict !== null && verdict.diagram === drawFig.diagram && verdict.error !== null) {
      setNotice(ui(language, 'drawSaveBlocked'))
      return
    }
    const figureId = drawFig.figureId
    void directRemote<{ ok: true; path: string } | { error: string }>('saveCustomFigure', { request: { figureId, language } }).then(result => {
      if ('error' in result) {
        setNotice(uiT(language, 'drawSaveFailed', { msg: result.error }))
        return
      }
      setDrawFig(current => current.figureId === figureId ? { ...current, saved: true } : current)
      refreshDrawFigures()
      setNotice(uiT(language, 'drawSaved', { path: result.path }))
    }).catch((reason: unknown) => {
      setNotice(uiT(language, 'drawSaveFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /**
   * 「🔧 按报错修复重画」(L3): feed the renderer's parse error + the broken
   * scene (host-side copy — the client sends only ids) back through the same
   * session-turn pipeline as a grammar-only redraw, overwriting the SAME scene
   * figureId. MANUAL ONLY (zero-LLM discipline: nothing here auto-fires; each
   * round costs one user-clicked turn), and the consecutive-failure count only
   * changes the button's COPY — retries stay user-gated forever.
   */
  const repairDrawFigure = (): void => {
    const figureId = drawFig.figureId
    const verdict = drawRenderVerdict
    if (figureId === undefined || drawFig.status !== 'ready' || drawFig.diagram === undefined) return
    if (verdict === null || verdict.diagram !== drawFig.diagram || verdict.error === null) return
    if (pendingDrawRef.current !== null) return
    repairAttemptsRef.current.set(figureId, (repairAttemptsRef.current.get(figureId) ?? 0) + 1)
    setDrawFig({ status: 'generating', figureId })
    void directRemote<{ figId: string; figureId: string; prompt: string } | { error: string }>('figureRepairPrompt', {
      request: { figureId, error: verdict.error },
    }).then(result => {
      if ('error' in result) {
        setDrawFig({ status: 'error', figureId, message: result.error })
        return
      }
      pendingDrawRef.current = { figId: result.figId, figureId: result.figureId }
      const fail = (reason: unknown): void => {
        pendingDrawRef.current = null
        setDrawFig({ status: 'error', figureId, message: reason instanceof Error ? reason.message : String(reason) })
      }
      try {
        void props.send(result.prompt).catch(fail)
      } catch (reason) {
        fail(reason)
      }
    }).catch((reason: unknown) => {
      setDrawFig({ status: 'error', figureId, message: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  /** 动态出图的「🗣 AI 讲解」：把当前图的标题/生成概要/图源作为讲解问题送进
   * 主会话讲解队列（回答照旧沉淀 ARCH-NOTES）。图源附件与「追问重画」对话框
   * 共用 lastAttachedFigRef 脏检——同图内容未变时只发引用，省重复输入。 */
  const askDrawExplain = (): void => {
    if (drawFig.status !== 'ready' || typeof drawFig.diagram !== 'string' || drawFig.diagram === '') return
    const diagram = drawFig.diagram
    const figureId = drawFig.figureId ?? '当前'
    const title = drawFig.title === undefined || drawFig.title === '' ? figureId : drawFig.title
    const attachKey = `dynamic/${figureId}`
    const lastAttached = lastAttachedFigRef.current
    const attachUnchanged = lastAttached !== null
      && lastAttached.key === attachKey && lastAttached.source === diagram
    if (!attachUnchanged) lastAttachedFigRef.current = { key: attachKey, source: diagram }
    // 讲解动词 + 选中目标 + 用户语言（都可缺省）：与追问重画共用同一份清单。
    const chips = currentSelectionItems()
    const raw = drawText.trim()
    submitQuestion(
      `（针对动态图 ${figureId}）请讲解这张「${title}」`
      + (chips.length > 0
        ? `，聚焦下列选中目标——逐个讲清它是什么、承担什么、与相邻元素怎么走位，最后补一段它们与全图的关系：\n${composeSelectionBlock(`图号 ${drawFig.figureId ?? ''}`, chips).trim()}`
        : '')
      + (raw !== '' ? `\n用户补充问题：${raw}` : '')
      + (drawFig.summary === undefined || drawFig.summary === '' ? '' : `\n（生成时的概要：${drawFig.summary}）`)
      + (attachUnchanged
          ? `\n\n【图源】与上一条讲解附带的相同（${attachKey}），未变化，请沿用它。`
          : `\n\n【图源】\n${diagram}`)
      + `\n\n${explainStyle}${languageClause(language)}`,
      `动态图 ${figureId}`,
    )
    if (chips.length > 0) setDrawSelection({ figureId: '', items: [] })
  }

  /**
   * 🎨 动态出图 recovery: after a page refresh or a desk reopen the panel's
   * pendingDrawRef is gone, but the backend still holds captured figures in
   * memory and saved scenes on disk. Refresh the scene list and, when the
   * panel is still idle, auto-select the newest figure (memory first, else the
   * newest saved one) so the figure comes back instead of an empty panel.
   * Race-safe: never overwrites a state that moved on (generating/ready/error).
   */
  const recoverDrawFigure = (): void => {
    if (drawFig.status !== 'idle') return
    refreshDrawFigures()
    void directRemote<{ figureId: string; title: string; diagram: string; summary: string; text: string; saved?: boolean } | null | { error: string }>('customFigure', { request: {} }).then(result => {
      if (result === null || 'error' in result) return // nothing captured — stay idle
      setDrawFig(current => current.status === 'idle'
        ? { status: 'ready', figureId: result.figureId, title: result.title, diagram: result.diagram, summary: result.summary, text: result.text, saved: result.saved === true }
        : current)
    }).catch(() => {})
  }

  const submitQuestion = (text: string, target: string): void => {
    explainQueueRef.current.push({ text, target })
    pumpExplainQueue()
  }

  /** 架构概览子页签切换：AI 页签只读缓存（内存/磁盘），未命中保持空态不自动生成。 */
  const selectOverviewView = (view: 'static' | 'ai'): void => {
    setOverviewViewPersisted(view)
    if (view === 'ai') {
      requestDynamicFigure('overview', { stage: '总览' }, undefined, false)
    }
  }

  const explainPkg = (node: ArchLensGraph['nodes'][number]): void => {
    const files = node.detail.files.map(file => file.name)
    const blurb = dutyText(node, language, summaries)
    const insight = insights?.find(item => item.id === node.id)
    const snippet = node.detail.snippet === '' ? '' : `\n\n【入口源码（浓缩，${node.detail.snippet.split('\n').length} 行）】\n${node.detail.snippet}`
    const evidence: EvidenceEntry[] = [
      { label: '组件职责（本地化）', ref: 'AI 职责总结（生成时优先）/ package.json description / README.md', text: blurb },
      { label: '核心文件索引', ref: '工作区扫描 packages/*/*/src', text: files.join(', ') },
    ]
    if (insight !== undefined && (insight.provides.length > 0 || insight.listens.length > 0 || insight.remotes.length > 0 || insight.tools.length > 0)) {
      const parts = [
        ...(insight.provides.length > 0 ? [`提供服务：${insight.provides.join(', ')}`] : []),
        ...(insight.listens.length > 0 ? [`监听事件：${insight.listens.join(', ')}`] : []),
        ...(insight.remotes.length > 0 ? [`Remote 方法：${insight.remotes.join(', ')}`] : []),
        ...(insight.tools.length > 0 ? [`注册工具：${insight.tools.join(', ')}`] : []),
      ]
      evidence.push({ label: '代码线索（注册提取）', ref: '入口源码 src/index.ts（analyze）', text: parts.join('；') })
    }
    if (node.detail.snippet !== '') {
      evidence.push({ label: '入口源码（浓缩）', ref: `src/${node.detail.files[0]?.name ?? 'index.ts'}`, text: node.detail.snippet.slice(0, 1200) })
    }
    submitQuestion(componentQuestion(node.short, node.group, blurb, files, explainStyle, language, insight, evidence) + snippet, `组件 ${node.short}`)
  }

  const explainEvent = (eventName: string): void => {
    const event = coreEvents?.find(candidate => candidate.event === eventName)
    if (event === undefined) return
    submitQuestion(
      eventQuestion(event.event, event.mode, event.producers, event.consumers, event.note, explainStyle, language,
        [{ label: '事件数据', ref: 'index/.arch-lens-events-<lang>.json（AI 结构化缓存）', text: `事件 ${event.event}（${event.mode}）生产者：${event.producers.join(', ')}；消费者：${event.consumers.join(', ')}；${event.note}` }]),
      `事件 ${event.event}`,
    )
  }

  const explainData = (title: string, data: unknown, ref: string, basis?: string): void => {
    submitQuestion(dataQuestion(title, data, explainStyle, language,
      [{ label: '图数据', ref, text: JSON.stringify(data).slice(0, 1200) }], basis), `图 ${title}`)
  }

  /**
   * Explain the flow diagram in the chat. Doc flows cite the verbatim flow
   * block + anchor; induced flows declare themselves non-authoritative.
   */
  const explainFlow = (): void => {
    const flowState = flowMap[flowAngle]?.[flowView]
    if (flowState === undefined) return
    const evidence: EvidenceEntry[] = flowState.source === 'flow'
      ? [{ label: 'AI 归纳（项目无文档流程）', ref: 'code-index 运行流元数据（入口/依赖/实体）', text: '流程图由 LLM 从代码索引归纳（非权威，建议生成架构文档后复核）' }]
      : [{ label: '流程原文（逐字引用）', ref: flowState.ref ?? '架构文档', text: flowState.sourceText ?? flowState.mermaid }]
    submitQuestion(
      `请讲解流程图「${flowState.title}」（${flowView === 'method' ? '方法级' : '实体级'}）：\n\n${explainStyle}${evidenceClause(evidence, flowState.source === 'flow' ? 'LLM 推断查证数据' : undefined)}${languageClause(language)}`,
      `流程图 ${flowState.title}`,
    )
  }

  /**
   * Rescan = REBUILD facts only: the backend invalidates the scan graph, the
   * code-index (memory + disk) and all AI caches; here we drop the figure
   * states, re-pull metadata and the ACTIVE tab's figure. Other tabs load
   * lazily on first switch, so a rescan never auto-generates any figure
   * (no LLM work) — figures regenerate on demand, after the invalidation.
   */
  const refresh = (): void => {
    clearFigures()
    // rescan = 失效：AI 职责总结的前端内存缓存也必须清，否则旧总结
    // （可能已是另一语言/旧代码）会绕过后端版本化校验继续显示。
    cachedDutySummaries.clear()
    const generation = generationRef.current
    void unwrapRemote(archLens.refresh()).then(result => {
      if (generation !== generationRef.current) return
      if ('error' in result) setError(result.error)
      else {
        setGraph(result.graph)
        // Layer-1 change detection: no file moved since the last rescan — the
        // backend skipped the rebuild (caches were still valid).
        if (!result.changed) setNotice(ui(language, 'rescanNoChange'))
        else if (result.changes !== null) {
          // Selective invalidation: report the change facts so the user knows
          // which figures were invalidated and can rebuild them on demand.
          const files = result.changes.added.length + result.changes.modified.length + result.changes.removed.length
          setNotice(uiT(language, 'rescanChanged', { files: String(files), pkgs: String(result.changes.changedPackages.length) }))
        }
      }
      // Facts + metadata only; the active tab re-renders on demand. Force the
      // re-pull: clearFigures() above set the figure states to null, but the
      // closure still holds the pre-clear values until React re-renders, so
      // the ensure guards would wrongly skip the fetch.
      loadMetadata()
      ensureActiveTab(true)
    }).catch((reason: unknown) => setError(String(reason)))
  }

  /** 「🔁 全量重建」: regenerate the AI figures with smart incremental mode
   * (incremental=true): only figures whose cache is invalidated/missing are
   * redrawn, valid ones are skipped — rescan does the precise invalidation,
   * so this step just redraws the affected figures (zero LLM calls when
   * everything is up to date). On success the figure states are cleared and
   * re-pulled. */
  const regenerateAll = (): void => {
    if (allGenRunning) return
    setAllGenRunning(true)
    setNotice(null)
    const generation = generationRef.current
    void unwrapRemote(archLens.generateAll({ language, incremental: true })).then(result => {
      if (generation !== generationRef.current) return
      setAllGenRunning(false)
      if ('error' in result) {
        setNotice(uiT(language, 'regenerateAllFailed', { msg: result.error }))
      } else {
        const rebuiltN = (result as { rebuilt?: string[] }).rebuilt?.length ?? 0
        const skippedN = (result as { skipped?: string[] }).skipped?.length ?? 0
        setNotice(rebuiltN === 0
          ? ui(language, 'regenerateAllUpToDate')
          : uiT(language, 'regenerateAllDone', { rebuilt: rebuiltN, skipped: skippedN }))
        clearFigures()
        cachedDutySummaries.clear()
        loadMetadata()
        // clearFigures() nulls the graph; refresh() restores it from the
        // rescan result, but generateAll has no graph payload — re-pull it.
        loadGraph()
        ensureActiveTab(true)
      }
    }).catch((reason: unknown) => {
      setAllGenRunning(false)
      setNotice(uiT(language, 'regenerateAllFailed', { msg: String(reason) }))
    })
  }

  /** 「⚡ 变动更新」: ONE chained pass — first refresh() (file-change detection
   * + new factsVersion + selective invalidation of the affected figure
   * caches), then generateAll(incremental) to redraw exactly the invalidated
   * figures. A single button completes "detect changes + repair figures";
   * previously it only ran generateAll, so without a prior rescan every
   * cache still matched the old factsVersion and everything was skipped. */
  const regenerateInvalidated = (): void => {
    if (allGenRunning) return
    setAllGenRunning(true)
    setNotice(null)
    const generation = generationRef.current
    void unwrapRemote(archLens.refresh()).then(refreshResult => {
      if (generation !== generationRef.current) return
      if ('error' in refreshResult) {
        setAllGenRunning(false)
        setError(refreshResult.error)
        return
      }
      setGraph(refreshResult.graph)
      // 注意：这里【不能】在 !changed 时提前返回——generateAll(incremental) 是
      // 按"缓存对当前 factsVersion 是否有效"逐图判定的（阶段2 语义）。文件没动
      // 不代表图都在：手动删过缓存 / v:0 失效过的图，恰恰需要这条链补画，
      // 而未失效的图增量判定是秒级零 LLM，跳过这步反而会造成"没效果"的假象。
      // 事实已重建（新 factsVersion）或本就新鲜：补画失效的图。
      void unwrapRemote(archLens.generateAll({ language, incremental: true })).then(genResult => {
        if (generation !== generationRef.current) return
        setAllGenRunning(false)
        if ('error' in genResult) {
          setNotice(uiT(language, 'regenerateInvalidatedFailed', { msg: genResult.error }))
        } else {
          const rebuiltN = (genResult as { rebuilt?: string[] }).rebuilt?.length ?? 0
          const skippedN = (genResult as { skipped?: string[] }).skipped?.length ?? 0
          setNotice(rebuiltN === 0
            ? ui(language, 'regenerateAllUpToDate')
            : uiT(language, 'regenerateAllDone', { rebuilt: rebuiltN, skipped: skippedN }))
          clearFigures()
          cachedDutySummaries.clear()
          loadMetadata()
          loadGraph()
          ensureActiveTab(true)
        }
      }).catch((reason: unknown) => {
        setAllGenRunning(false)
        setNotice(uiT(language, 'regenerateInvalidatedFailed', { msg: String(reason) }))
      })
    }).catch((reason: unknown) => {
      setAllGenRunning(false)
      setError(String(reason))
    })
  }

  /** Fetch the core-flow subgraph (deps tab). */
  /** 依赖图核心子图 — 只读：拉取版本化 core 缓存；null（无缓存）→ 空态，
   * 提示点「🤖 AI 生成」建立（D1/D2：读路径不生成任何事实）。 */
  const fetchCore = (): void => {
    const generation = generationRef.current
    setCoreDeps({ status: 'loading' })
    void directRemote<{ kind: 'flowchart' | 'erDiagram'; source: string; core: ArchLensCoreGraph } | null | { error: string }>(
      'mermaidCore',
      { request: { kind: 'flowchart', language } },
    ).then(result => {
      if (generation !== generationRef.current) return
      if (result === null) setCoreDeps({ status: 'idle' })
      else if ('error' in result) setCoreDeps({ status: 'error', message: result.error })
      else setCoreDeps({ status: 'ready', source: result.source, core: result.core })
    }).catch((reason: unknown) => {
      if (generation !== generationRef.current) return
      setCoreDeps({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  /** 架构概览 (rule-built) — 只读：core 缓存 + 扫描图拼装；null → 空态
   * （D2：纯规则图同样点了扫描/AI 生成才有，读路径无规则兜底）。 */
  const fetchOverview = (): void => {
    const generation = generationRef.current
    setOverviewFig({ status: 'loading' })
    void directRemote<{ title: string; mermaid: string; core: ArchLensCoreGraph } | null | { error: string }>(
      'overviewFigure',
      { request: { language } },
    ).then(result => {
      if (generation !== generationRef.current) return
      if (result === null) setOverviewFig({ status: 'idle' })
      else if ('error' in result) setOverviewFig({ status: 'error', message: result.error })
      else setOverviewFig({ status: 'ready', source: result.mermaid, core: result.core })
    }).catch((reason: unknown) => {
      if (generation !== generationRef.current) return
      setOverviewFig({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  /** Lazily fetch the core subgraph the first time a tab opens. */
  const loadCore = (force = false): void => {
    if (force || coreDeps.status === 'idle') fetchCore()
  }

  const selectTab = (id: string): void => {
    setTab(id)
    // Every figure loads lazily on first switch (and re-loads lazily after a
    // rescan cleared it): concepts/seq/flow/events fetch here, deps/er fetch
    // their core subgraph below.
    if (id === 'concepts') ensureConcepts()
    else if (id === 'seq') ensureSequences()
    else if (id === 'flow') ensureFlow()
    else if (id === 'interaction') ensureEvents()
    else if (id === 'catalog') loadSummaries(0)
    else if (id === 'deps') {
      loadCore()
    } else if (id === 'overview') {
      if (overviewFig.status === 'idle') fetchOverview()
      // Re-entering with the AI sub-tab active re-opens the cached AI figure
      // (memory/disk) instead of showing the empty hint.
      if (overviewView === 'ai') requestDynamicFigure('overview', { stage: '总览' }, undefined, false)
    } else if (id === 'draw') {
      // Recover a custom figure the backend already captured (page refresh /
      // desk reopen lost the panel's pendingDrawRef) so 保存 still shows.
      recoverDrawFigure()
    }
  }

  /** 🔬 方法级 toggle for the ACTIVE tab: flip the persisted switch, then
   * reload the figure with the new granularity (method-level figures use
   * their own caches/LLM calls; the shared profile stays entity-level). */
  const toggleMethodLevel = (): void => {
    const on = !methodOn(tab)
    setMethodPersisted(tab, on)
    setNotice(uiT(language, 'methodToggle', { state: on ? ui(language, 'methodOn') : ui(language, 'methodOff') }))
    if (tab === 'concepts') { setConceptTreeState(null); ensureConcepts(true) }
    else if (tab === 'seq') { setSequenceCodeState(null); setSequenceFlowState(null); setCallGraphState(null); setCallGraphError(null); loadSequences(generationRef.current) }
    else if (tab === 'flow') { setFlowMap({}); ensureFlow(generationRef.current, flowView, true) }
    else if (tab === 'interaction') { setEventsState(null); setEventsMethodsState(null); ensureEvents(true) }
    else if (tab === 'deps') { fetchCore() }
  }

  /**
   * AI generate = regenerate THIS figure's shared-profile field (分离方案):
   * one trimmed-summary LLM call on the backend, the fresh data rendered
   * directly. No doc rewrite (architecture.generated.md is only written by
   * 「📄 一键生成文档」), no index rebuild. Core regeneration invalidates
   * flow/seq/events on the backend, which re-generate on demand.
   * Figures now generate AS A SESSION TURN: the prompt is built host-side
   * (facts embedded), sent into the current session — the GUI conversation
   * stream shows the agent working in real time — and the answer is parsed
   * into the figure cache; the panel refetches when the turn completes.
   */
  const aiGenerate = (): void => {
    if (aiGenRunning) return
    stopRef.current = false
    setAiGenRunning(true)
    setNotice(null)
    if (tab === 'catalog') {
      // Duty summaries are their own batched LLM path, unchanged.
      loadSummaries(0, true)
      setAiGenRunning(false)
      return
    }
    if (tab === 'overview') {
      // 架构概览的「🤖 AI 生成」= 纯 LLM 分支：会话里让 LLM 自己选核心包并
      // 画一张分层总览图，切到「AI 生成」子页签内联展示（不再是浮层）——与
      // 规则拼装的静态总览用页签切换对比。
      setOverviewViewPersisted('ai')
      requestDynamicFigure('overview', { stage: '总览' })
      setAiGenRunning(false)
      return
    }
    const kind = tab === 'concepts' ? 'concepts'
      : tab === 'seq' ? 'seq'
        : tab === 'flow' ? 'flow'
          : tab === 'interaction' ? 'interaction'
            : 'deps'
    const angle = tab === 'flow' ? flowAngle : undefined
    const request: Record<string, unknown> = { kind, language }
    if (angle !== undefined) request.angle = angle
    if (tab === 'flow') request.methodLevel = flowView === 'method'
    else if (METHOD_TABS.includes(tab)) request.methodLevel = methodOn(tab)
    void directRemote<{ figId: string; prompt: string } | { error: string }>('figurePrompt', { request }).then(result => {
      if (stopRef.current) return
      if ('error' in result) {
        setAiGenRunning(false)
        setNotice(uiT(language, 'aiGenFailed', { msg: result.error }))
        return
      }
      // Stage + send: the GUI streams the agent's work (SSE); the backend
      // caches the figure when the answer carries the figId.
      pendingFigureRef.current = { figId: result.figId, kind: tab }
      // 兜底轮询：页面自动刷新依赖 running 翻转（turn 结束），但本会话的
      // agent 回复 JSON 后 turn 往往还在继续（同一轮里还有别的工作），
      // running 一直 true → 翻转不触发 → 图生成了页面不更新。轮询每 2s
      // 强制重拉当前图（读缓存，非 null 才更新、不清空状态不闪烁），回复
      // 落缓存后几秒内即刷新，无需等 turn 结束；正常路径（running 翻转
      // refetch）消费 pendingFigureRef 后置 null，轮询自动停止；60s 兜底上限。
      const staged = { figId: result.figId, kind: tab }
      const poll = (): void => {
        if (pendingFigureRef.current?.figId !== staged.figId) { window.clearInterval(handle); return }
        if (staged.kind === 'concepts') ensureConcepts(true)
        else if (staged.kind === 'seq') loadSequences(generationRef.current)
        else if (staged.kind === 'flow') ensureFlow(generationRef.current, flowView, true)
        else if (staged.kind === 'interaction') ensureEvents(true)
        else fetchCore()
      }
      const handle = window.setInterval(poll, 2000)
      // 5 分钟兜底上限：agent 回复（读源码+生成）通常 1-3 分钟，turn 结束的
      // running flip 会消费 pendingFigureRef 提前停止轮询；只有会话 turn
      // 长期不结束（本会话持续工作）时才需要轮询撑满全程。
      window.setTimeout(() => window.clearInterval(handle), 300000)
      setNotice(uiT(language, 'figureSent', { tab: ui(language, FIGURE_TAB_LABEL[tab] ?? 'tabConcepts') }))
      try {
        void props.send(result.prompt).catch((reason: unknown) => {
          pendingFigureRef.current = null
          setAiGenRunning(false)
          setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
        })
      } catch (reason) {
        pendingFigureRef.current = null
        setAiGenRunning(false)
        setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
      }
    }).catch((reason: unknown) => {
      if (stopRef.current) return
      setAiGenRunning(false)
      setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /**
   *「⏹ 终止」: abort every in-flight LLM generation for this workspace (the
   * backend AbortSignal fires, so provider streams stop promptly), drop all
   * pending figure responses locally, and clear the running flags. The
   * stopRef guard keeps late error responses from overwriting the notice.
   *
   * Two kinds of work are stopped: BACKEND streams (llmText paths, via
   * cancelGeneration → abortGeneration) and SESSION TURNS (「🤖 AI 生成」
   * figures and「AI 讲解」run as agent turns in the GUI session — the backend
   * AbortSignal never reaches them, so the running turn is cancelled through
   * the session runtime, the same path the GUI's own stop action uses).
   */
  const stopGeneration = (): void => {
    stopRef.current = true
    generationRef.current += 1
    setAiGenRunning(false)
    setProgressRunning(false)
    // A session-driven figure/explain was staged: its turn must be cancelled
    // (not treated as a completed generation). Drop the staged refs so the
    // running-flip effect does not refetch a figure that was never produced.
    const stopSessionTurn = pendingFigureRef.current !== null
      || pendingDynamicRef.current !== null
      || pendingDrawRef.current !== null
      || explainingRef.current
    pendingFigureRef.current = null
    pendingDynamicRef.current = null
    pendingDrawRef.current = null
    explainQueueRef.current = []
    // 队列被手动清空：可能有尚未发出的全量附件条目被丢弃，复位脏检记录，
    // 下一条讲解保证重新附带完整 mermaid 源。
    lastAttachedFigRef.current = null
    explainingRef.current = false
    sawRunningRef.current = false
    if (dynamicFig?.status === 'generating') {
      setDynamicFig(current => current === null || current.status !== 'generating'
        ? current
        : { ...current, status: 'error', message: ui(language, 'genStopped') })
    }
    if (drawFig.status === 'generating') {
      setDrawFig({ status: 'error', message: ui(language, 'genStopped') })
    }
    try {
      void directRemote<{ ok: boolean }>('cancelGeneration', {}).catch(() => {})
    } catch {
      // cancelGeneration remote unavailable (stale runtime) — the local
      // guards still drop pending results.
    }
    if (stopSessionTurn && props.sessionId !== null) {
      void props.cancel(props.sessionId).catch(() => {})
    }
    setNotice(ui(language, 'genStopped'))
  }

  /** Global "one-shot docs": generate the full architecture doc for the project. */
  const genDocs = (): void => {
    if (aiGenRunning) return
    stopRef.current = false
    setAiGenRunning(true)
    setNotice(null)
    void unwrapRemote(archLens.generateDocs({ language })).then(result => {
      if (stopRef.current) return
      setAiGenRunning(false)
      if ('error' in result) {
        console.warn('[arch-lens] generate docs failed:', result.error)
        setNotice(uiT(language, 'genDocFailed', { msg: result.error }))
        return
      }
      noticeWithLlm(ui(language, 'genDocDone'))
      // Concept tree follows the generated doc: the write path already rebuilt
      // the concept cache, so a plain cache read returns the fresh tree.
      void unwrapRemote(archLens.conceptTree({ language })).then(tree => {
        if (tree !== null && !('error' in tree)) setConceptTreeState(tree)
      }).catch(() => {})
      loadSequences(generationRef.current)
      void unwrapRemote(archLens.events({ language })).then(data => {
        if (data !== null && !('error' in data)) setEventsState(data)
      }).catch(() => {})
      // The generated doc may carry a flow block — re-derive both viewpoints.
      ensureFlow(generationRef.current)
    }).catch((reason: unknown) => {
      if (stopRef.current) return
      setAiGenRunning(false)
      setNotice(uiT(language, 'genDocFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Generate (or regenerate) the AI learning-progress summary in the notes. */
  const runProgress = (): void => {
    if (progressRunning) return
    stopRef.current = false
    setProgressRunning(true)
    setNotice(null)
    void unwrapRemote(archLens.progress({ language, force: progressGenerated })).then(result => {
      if (stopRef.current) return
      setProgressRunning(false)
      if ('error' in result) {
        console.warn('[arch-lens] progress failed:', result.error)
        setNotice(uiT(language, 'progressFailed', { msg: result.error }))
        return
      }
      console.log(`[arch-lens] progress: ${result.progress}% covered, summary ${result.summary.length} chars`)
      setProgressGenerated(true)
      noticeWithLlm(result.fromCache === true
        ? uiT(language, 'progressCached', { at: result.generatedAt === undefined ? '?' : new Date(result.generatedAt).toLocaleString() })
        : ui(language, progressGenerated ? 'progressRegenerated' : 'progressDone'))
      void unwrapRemote(archLens.notes()).then(notes => { setNotes(notes) }).catch(() => {})
      refreshLiveStats()
    }).catch((reason: unknown) => {
      if (stopRef.current) return
      setProgressRunning(false)
      setNotice(uiT(language, 'progressReqFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  // AI duty summaries for the catalog, cached per workspace root + role
  // language. Only SUCCESS results are cached: a failure stays uncached so
  // the next catalog visit retries instead of silently showing stale raw
  // text forever. The backend generates at most two batches per call (30s
  // RPC budget), so a partial result re-invokes to fill the rest.
  const summaryCacheKey = `${workspaceKeyRef.current ?? ''}|${language}`
  const loadSummaries = (attempt = 0, force = false): void => {
    const cached = cachedDutySummaries.get(summaryCacheKey)
    // Force (AI generate / rescan) must bypass the front-end cache: the whole
    // point is a fresh LLM pass over current code. A partial map is a valid
    // serve under the row-fallback contract (no completeness threshold).
    if (!force && cached !== undefined && cached !== null) {
      setSummaries(cached)
      return
    }
    stopRef.current = false
    console.log(`[arch-lens] loadSummaries: requesting (root=${workspaceKeyRef.current}, lang=${language}, attempt=${attempt}, force=${force})`)
    setSummaries(cached ?? null)
    // 读路径（默认）只读版本化缓存；force（「🤖 AI 生成」）才触发 LLM 补齐。
    void unwrapRemote(archLens.summarizeDuties(force ? { language, force: true } : { language })).then(result => {
      if (stopRef.current) return
      if (result === null) {
        // 只读路径：缓存缺失/不完整 → 空态（「暂无数据」），不是错误，不重试。
        setSummaries(null)
        return
      }
      if ('error' in result) {
        console.warn('[arch-lens] loadSummaries failed:', result.error)
        setSummaries(null)
        setNotice(uiT(language, 'summarizeFailedNotice', { msg: result.error }))
      } else {
        console.log(`[arch-lens] loadSummaries: got ${Object.keys(result).length} summaries`)
        cachedDutySummaries.set(summaryCacheKey, result)
        setSummaries(result)
        // Partial fill: the backend caps batches per call, so a FORCE (AI 生成)
        // pass keeps pulling until every package has a summary or the attempt
        // cap is reached. The READ pass has no generator to chase — pulling the
        // same partial cache again would only spin; partial renders as-is.
        if (force && graph !== null && Object.keys(result).length < graph.nodes.length && attempt < 5) {
          window.setTimeout(() => loadSummaries(attempt + 1, force), 1500)
        }
      }
    }).catch((reason: unknown) => {
      if (stopRef.current) return
      console.warn('[arch-lens] loadSummaries request failed:', reason)
      setSummaries(null)
      setNotice(uiT(language, 'summarizeReqFailedNotice', { msg: String(reason) }))
    })
  }

  // Language switch resets to the cached summaries for that workspace+language.
  useEffect(() => {
    const cached = cachedDutySummaries.get(`${workspaceKeyRef.current ?? ''}|${language}`)
    if (cached !== undefined) setSummaries(cached)
    else setSummaries(undefined)
  }, [language])

  /** Explain one concept-tree node (not a package) in the chat. */
  const explainConcept = (node: ConceptNode): void => {
    const insight = node.pkg === undefined ? undefined : insights?.find(item => item.id === node.pkg)
    // Mandatory evidence: doc nodes cite the verbatim section + anchor — with
    // an honest caveat, because the doc may itself be arch-lens generated
    // (AI-written) rather than hand-authored; flow nodes (AI-induced, no
    // architecture doc) declare themselves non-authoritative.
    const evidence: EvidenceEntry[] = node.source === 'flow'
      ? [{ label: 'AI 归纳（项目无架构文档）', ref: 'code-index 运行流元数据（入口/依赖/实体）', text: `${node.desc}${node.inside !== undefined ? `；${node.inside}` : ''}（非权威，建议生成架构文档后复核）` }]
      : [{ label: '概念原文（逐字引用；文档可能由 AI 生成，内容以代码为准）', ref: node.ref ?? '架构文档', text: node.sourceText ?? `${node.desc}${node.inside !== undefined ? `；${node.inside}` : ''}` }]
    submitQuestion(
      `请讲解架构概念「${node.name}」：${node.desc}${node.inside !== undefined ? `\n内部机制：${node.inside}` : ''}\n\n${explainStyle}${codeInsightClause(insight)}${evidenceClause(evidence, node.source === 'flow' ? 'LLM 推断查证数据' : undefined)}${languageClause(language)}`,
      `概念 ${node.name}`,
    )
  }

  /** Open the package detail popup for a clicked mermaid node/entity label. */
  const selectNodeByLabel = (label: string): void => {
    const node = graph?.nodes.find(candidate => candidate.short === label)
    if (node !== undefined) setSelection({ kind: 'pkg', id: node.id })
  }

  // 概览图节点【左键 → 跳动态出图】的联动已按用户要求移除（含其短名提取函数）：
  // 概览左键不再劫持 tab；需要出图走 🎨 面板本身（右键元素进选中清单）。
  // 其他 tab 的左键联动（核心关系图 selectNodeByLabel 等）原样保留。

  /** 原地追问重画对话框状态：在哪个图上、用户语言（可空）、随带的选中清单副本。
   * 提交即关框转后台（followUpRun），对话框不再承载运行中/错误态。 */
  const [followUpDlg, setFollowUpDlg] = useState<{
    kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview'
    angle?: FlowAngle | undefined
    methods: boolean
    text: string
    items: SelectionTarget[]
  } | null>(null)

  /** 后台进行中的追问重画（kind+视角+粒度定位被重画的图）：非 null 时页顶
   * 挂「重画进行中」条，页面其余部分照常可用；结果自动回填对应 tab 的主图。
   * 后端一次只容忍一路重画，运行期间「追问重画」提交按钮禁用。 */
  const [followUpRun, setFollowUpRun] = useState<{
    kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview'
    angle?: FlowAngle | undefined
    methods: boolean
  } | null>(null)

  /** 右键选中清单（托盘）：与 🎨 出图同一套 chips 语义（多选、✕删、发送后清空）。
   * 作用域 = 当前 tab 的图（kind+视角+粒度）：换图即换清单，陈旧目标绝不
   * 混进下一次意图。concepts/events/core/overview 在页内托盘显形；seq/flow
   * 只作隐藏累积（右键即开框，清单在对话框里编辑，关框写回）。发送成功后
   * 两边一起清空。 */
  const [followUpSel, setFollowUpSel] = useState<{
    kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview'
    angle?: FlowAngle | undefined
    methods: boolean
    items: SelectionTarget[]
  }>({ kind: 'flow', methods: false, items: [] })

  /** 追问作用域的粒度：交互图/流程图的粒度跟随当前子页签（实体级/方法级）；
   * 时序图跟 🔬；概念图/依赖图固定实体级。 */
  const followUpMethods = (kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview'): boolean =>
    kind === 'events' ? eventsView === 'method'
      : kind === 'flow' ? flowView === 'method'
        : kind === 'seq' ? methodOn('seq')
          : false

  /** 右键任意图元素：
   *  - 调用关系图(seq)/流程图(flow)：直接打开追问对话框（上一版交互），选中项
   *    作为 chips 只出现在对话框窗口内（标题下方一行），不进文本输入框；
   *  - 其余图：先进页内选中托盘（多选、✕删），由用户按「✍️ 追问重画」进对话框。
   *  两种交互都以托盘为跨轮次累积载体：关框再选，清单合并续用、重复即去重。 */
  const selectFollowUpTarget = (kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview', target: SelectionTarget, angle?: FlowAngle): void => {
    const methods = followUpMethods(kind)
    const sameScope = followUpSel.kind === kind && followUpSel.angle === angle && followUpSel.methods === methods
    const items = sameScope ? withSelection(followUpSel.items, target) : [target]
    setFollowUpSel({ kind, angle, methods, items })
    if (kind === 'seq' || kind === 'flow') {
      setFollowUpDlg(current => current !== null && current.kind === kind && current.angle === angle && current.methods === methods
        ? { ...current, items: withSelection(current.items, target) }
        : { kind, angle, methods, text: '', items })
    }
  }
  const removeFollowUpTarget = (target: SelectionTarget): void => {
    setFollowUpSel(previous => ({ ...previous, items: withoutSelection(previous.items, target) }))
  }
  /** 关闭对话框：把框内编辑过的清单（含 ✕ 删除的）写回托盘——每轮弹窗看到
   *  同一份清单；只有发送成功才算一次性意图出膛、两边一起清空。 */
  const closeFollowUpDlg = (): void => {
    const dlg = followUpDlg
    if (dlg === null) return
    setFollowUpSel(previous =>
      previous.kind === dlg.kind && previous.angle === dlg.angle && previous.methods === dlg.methods
        ? { ...previous, items: dlg.items }
        : previous)
    setFollowUpDlg(null)
  }
  /** 发送成功 = 一次性意图出膛：清空与当前图作用域匹配的托盘清单。 */
  const clearFollowUpTray = (kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview', angle: FlowAngle | undefined, methods: boolean): void => {
    setFollowUpSel(previous =>
      previous.kind === kind && previous.angle === angle && previous.methods === methods
        ? { ...previous, items: [] }
        : previous)
  }

  /** 托盘行渲染：只在走托盘交互的图的 tab 显示（kind→tab：events→interaction、
   *  core→deps）；seq/flow 的清单由对话框窗口本身承担，页内不出行。 */
  const renderFollowUpTray = (): React.ReactNode => {
    if (followUpSel.kind === 'seq' || followUpSel.kind === 'flow') return null
    const trayTab = followUpSel.kind === 'events' ? 'interaction' : followUpSel.kind === 'core' ? 'deps' : followUpSel.kind
    if (followUpSel.items.length === 0 || trayTab !== tab) return null
    return h('div', { className: css.drawChips },
      h('span', { className: css.badge }, uiT(language, 'followUpChipsScope', { kind: followUpKindLabel(followUpSel.kind) })),
      followUpSel.items.map(item => h('span', { key: item.kind + ' ' + item.label, className: css.drawChip },
        h('span', { className: css.drawChipText }, selectionGlyph(item.kind) + ' ' + item.label),
        h('button', { className: css.drawChipX, onClick: () => { removeFollowUpTarget(item) } }, '✕'))))
  }

  /** 后台重画状态条：任何 tab 都显示（不绑作用域）——用户逛到别的页也看得见
   *  这路任务并可 ⏹ 终止；完成后对应 tab 的主图自动刷新，结果走 notice。 */
  const renderFollowUpRunning = (): React.ReactNode => {
    if (followUpRun === null) return null
    return h('div', { className: css.drawChips },
      h('span', { className: css.badge }, uiT(language, 'followUpRunningBadge', { kind: followUpKindLabel(followUpRun.kind) })),
      h('button', { className: css.btn, onClick: cancelFollowUp }, ui(language, 'followUpCancelRun')))
  }

  /** 「✍️ 追问重画」按钮 → 打开本 tab 的对话框：带上托盘清单的副本，文本从空开始。 */
  const openFollowUp = (kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview', angle?: FlowAngle): void => {
    const methods = followUpMethods(kind)
    const items = followUpSel.kind === kind && followUpSel.angle === angle && followUpSel.methods === methods ? followUpSel.items : []
    setFollowUpDlg({ kind, angle, methods, text: '', items })
  }

  /** 提交追问 → 立刻关框转后台（followUpRun），页面照常可用；
   *  figureFollowUp 完成后结果原地回填对应 tab 的主图并出 notice。
   *  最终意图 = 当前图（后端自带为底稿）+ 选中清单(chips，可空) + 用户语言(可空)。
   *  成功 = 一次性意图出膛（清托盘）；失败 = 图与托盘都不动，可修正后重发。 */
  const runFollowUp = (): void => {
    const dlg = followUpDlg
    if (dlg === null || followUpRun !== null) return
    const raw = dlg.text.trim()
    if (raw === '' && dlg.items.length === 0) return
    const followUp = composeSelectionBlock(`当前${followUpKindLabel(dlg.kind)}`, dlg.items)
      + (raw !== '' ? raw : '无附加文字：请聚焦上述选中目标，重画/扩展它们的细节与关联。')
    const controller = new AbortController()
    followUpAbortRef.current = controller
    const run = { kind: dlg.kind, angle: dlg.angle, methods: dlg.methods }
    const items = dlg.items
    closeFollowUpDlg() // 关框 + 把框内 ✕ 的删除写回托盘，成功回调再按消费清单精确移除
    setFollowUpRun(run)
    void directRemote<FollowUpResult | { error: string }>('figureFollowUp', {
      request: {
        kind: dlg.kind,
        language,
        followUp,
        ...(dlg.angle === undefined ? {} : { angle: dlg.angle }),
        ...(dlg.methods ? { methodLevel: true } : {}),
      },
    }, controller.signal).then(result => {
      // Cancelled: abort + stop already reverted the badge; a late result drops.
      if (controller.signal.aborted) return
      setFollowUpRun(null)
      if ('error' in result) {
        setNotice(uiT(language, 'followUpFailed', { msg: result.error }))
        return
      }
      // 只清本次消费掉的 chips：运行期间新选的目标留给下一轮意图。
      setFollowUpSel(previous =>
        previous.kind === run.kind && previous.angle === run.angle && previous.methods === run.methods
          ? { ...previous, items: previous.items.filter(item => !items.includes(item)) }
          : previous)
      applyFollowUp(run.kind, result, run.angle)
      setNotice(ui(language, 'followUpDone'))
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      setFollowUpRun(null)
      setNotice(uiT(language, 'followUpFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    }).finally(() => {
      if (followUpAbortRef.current === controller) followUpAbortRef.current = null
    })
  }

  /** 对话框里的「🗣 AI 讲解」：选中清单（chips）+ 用户语言（都可缺省，至少
   * 其一）作为讲解问题塞进主会话讲解队列（回答照旧走 ARCH-NOTES 沉淀），
   * 流程图页会随问题附上当前图的 mermaid 源作为事实依据。与「重画」的区别：
   * 只讲解、不改图，发送后清空托盘并关闭对话框。 */
  const askFollowUpExplain = (): void => {
    const dlg = followUpDlg
    if (dlg === null) return
    const raw = dlg.text.trim()
    if (raw === '' && dlg.items.length === 0) return
    const source = dlg.kind === 'flow'
      ? flowMap[dlg.angle ?? flowAngle]?.[dlg.methods === true ? 'method' : 'entity']?.mermaid
      : undefined
    const kindLabel = followUpKindLabel(dlg.kind)
    // 附件脏检：同图同内容 → 发引用；变图/变内容 → 重发全文并更新记录。
    const attachKey = `flow/${dlg.angle ?? flowAngle}/${dlg.methods === true ? 'method' : 'entity'}`
    const lastAttached = lastAttachedFigRef.current
    const attachUnchanged = source !== undefined
      && lastAttached !== null && lastAttached.key === attachKey && lastAttached.source === source
    if (source !== undefined && !attachUnchanged) lastAttachedFigRef.current = { key: attachKey, source }
    submitQuestion(
      `（针对当前${kindLabel}）`
      + (dlg.items.length > 0
          ? `请聚焦下列选中目标——逐个讲清它是什么、承担什么、与相邻元素怎么走位，最后补一段它们与全图的关系：\n${composeSelectionBlock(`当前${kindLabel}`, dlg.items).trim()}`
          : '')
      + (raw !== '' ? `${dlg.items.length > 0 ? '\n' : ''}用户补充问题：${raw}` : '')
      + (source === undefined
          ? ''
          : attachUnchanged
            ? `\n\n【当前图】与上一条讲解附带的相同（${attachKey}），未变化，请沿用它。`
            : `\n\n【当前图（mermaid 源）】\n${source}`)
      + `\n\n${explainStyle}${languageClause(language)}`,
      kindLabel,
    )
    clearFollowUpTray(dlg.kind, dlg.angle, dlg.methods)
    setFollowUpDlg(null)
  }

  /** 「⏹ 终止重画」：abort 前端 RPC + best-effort 叫停后端 LLM 流（缓存不脏、
   *  图保持原样），并释放 followUpRun 让下一次追问可以提交。 */
  const cancelFollowUp = (): void => {
    const controller = followUpAbortRef.current
    if (controller !== null) {
      followUpAbortRef.current = null
      controller.abort()
      // Best-effort: tell the backend to stop the LLM stream so the cache is
      // never overwritten by the cancelled redraw.
      void directRemote<{ ok: boolean }>('cancelFollowUp', {}).catch(() => {})
    }
    setFollowUpRun(null)
  }

  /** 把 figureFollowUp 的结果回填到对应 tab 的状态（原地更新，不切 tab）。 */
  const applyFollowUp = (kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview', value: FollowUpResult, angle?: FlowAngle): void => {
    if (kind === 'flow' && angle !== undefined && 'mermaid' in value) {
      // 回填到当前子页签粒度对应的数据槽（实体级/方法级各自独立）。
      const granularity: FigureGranularity = flowView === 'method' ? 'method' : 'entity'
      setFlowMap(previous => ({ ...previous, [angle]: { ...previous[angle], [granularity]: value } }))
      return
    }
    if (kind === 'seq' && 'messages' in value) {
      setSequenceFlowState(value)
      setSeqView('flow')
      return
    }
    if (kind === 'concepts' && Array.isArray(value)) {
      setConceptTreeState(value as RemoteConceptNode[])
      return
    }
    if (kind === 'events' && Array.isArray(value)) {
      // 回填到当前子页签对应的数据槽（实体级/方法级各自独立）。
      // kind === 'events' 时后端只会回事件行（ArchLensEventRow[]，与 CoreEvent 同形）；联合类型在此不可分辨，同概念树处惯例做类型级收窄。
      if (eventsView === 'method') setEventsMethodsState(value as CoreEvent[])
      else setEventsState(value as CoreEvent[])
      return
    }
    if (kind === 'core' && 'kind' in value && value.kind === 'flowchart') {
      setCoreDeps({ status: 'ready', source: value.source, core: value.core })
      return
    }
    if (kind === 'overview') {
      const overviewValue = value as { title: string; diagram: string; kind: 'overview'; targetKey: string }
      setDynamicFig({ key: `followup-${Date.now().toString(36)}`, kind: 'overview', title: overviewValue.title, diagram: overviewValue.diagram, status: 'ready' })
      selectOverviewView('ai')
    }
  }

  /** 对话框标题里的图类型名（本地化）。 */
  const followUpKindLabel = (kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview'): string => {
    switch (kind) {
      case 'flow': return ui(language, 'tabFlow')
      case 'seq': return ui(language, 'tabSeq')
      case 'concepts': return ui(language, 'tabConcepts')
      case 'events': return ui(language, 'tabInteraction')
      case 'core': return ui(language, 'tabDeps')
      default: return ui(language, 'tabOverview')
    }
  }

  const toggleExpand = (id: string): void => {
    setExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  }

  const tabOrder: Array<{ id: string; label: string }> = [
    { id: 'concepts', label: ui(language, 'tabConcepts') },
    { id: 'overview', label: ui(language, 'tabOverview') },
    { id: 'seq', label: ui(language, 'tabSeq') },
    { id: 'flow', label: ui(language, 'tabFlow') },
    { id: 'interaction', label: ui(language, 'tabInteraction') },
    { id: 'deps', label: ui(language, 'tabDeps') },
    { id: 'catalog', label: ui(language, 'tabCatalog') },
    { id: 'draw', label: ui(language, 'tabDraw') },
  ]

  const header = h('div', { className: css.header },
    tabOrder.map(unit => h('button', {
      key: unit.id,
      className: `${css.tab} ${tab === unit.id ? css.tabActive : ''}`,
      onClick: () => selectTab(unit.id),
    }, unit.label)),
    h('span', { className: css.spacer }),
    NOTES_FEATURE_OFF ? null : h('button', { className: css.btn, onClick: runProgress, disabled: progressRunning },
      progressRunning ? ui(language, 'progressWorking') : ui(language, 'btnProgress')),
    liveStats !== null && liveStats.total > 0
      ? h('span', { className: css.badge }, `${ui(language, 'progressLiveBadge')} ${liveStats.asked}/${liveStats.total} · ${liveStats.progress}%`)
      : null,
    DOCS_FEATURE_OFF ? null : h('button', { className: css.btn, onClick: genDocs, disabled: aiGenRunning },
      aiGenRunning ? ui(language, 'genDocWorking') : ui(language, 'btnGenDoc')),
    h('button', { className: css.btn, onClick: () => setEditorOpen(true) }, ui(language, 'btnPrompts')),
    h('button', { className: css.btn, onClick: refresh }, ui(language, 'btnRescan')),
    h('button', { className: css.btn, onClick: regenerateInvalidated, disabled: allGenRunning || aiGenRunning },
      allGenRunning ? ui(language, 'regenerateInvalidatedWorking') : ui(language, 'btnRegenerateInvalidated')),
    h('button', { className: css.btn, onClick: regenerateAll, disabled: allGenRunning || aiGenRunning },
      allGenRunning ? ui(language, 'regenerateAllWorking') : ui(language, 'btnRegenerateAll')),
    h('button', { className: `${css.btn} ${css.stopBtn}`, onClick: stopGeneration }, ui(language, 'btnStop')),
    h('button', {
      className: css.btn,
      onClick: () => { setLlmStatsOpen(value => !value); if (llmStats === null) refreshLlmStats() },
    }, '⚡ LLM'),
  )

  let body: React.ReactNode
  if (error !== null) {
    body = h('div', { className: css.error },
      h('div', null, uiT(language, 'loadFailed', { msg: error })),
      h('div', { className: css.section },
        h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => loadGraph() }, ui(language, 'retry')),
      ),
    )
  } else if (graph === null) {
    // 无事实缓存：合法空态（从未 rescan / 缓存被 rescan 置无效）。只给引导，
    // 绝不在读路径自动扫盘或生成。
    body = h('div', { className: css.loading },
      h('div', null, ui(language, 'noFactsTitle')),
      h('div', { className: css.section }, ui(language, 'noFactsHint')),
      h('div', { className: css.section },
        h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: refresh }, ui(language, 'noFactsBtn')),
      ),
    )
  } else {
    const activeTip = ((): string => {
      switch (tab) {
        case 'concepts': return ui(language, 'tipConcepts')
        case 'seq': return ui(language, 'tipSeq')
        case 'flow': return ui(language, 'tipFlow')
        case 'interaction': return ui(language, 'tipInteraction')
        case 'deps': return ui(language, 'tipDeps')
        case 'overview': return ui(language, 'tipOverview')
        case 'draw': return ui(language, 'tipDraw')
        default: return uiT(language, 'tipCatalog', { count: String(graph.nodes.length) })
      }
    })()
    const explain = ((): (() => void) => {
      switch (tab) {
        case 'concepts': return () => explainData(ui(language, 'tabConcepts'), conceptTree, '概念树（架构文档提取或 AI 归纳，source: doc/flow）')
        case 'seq': {
          // 讲解对象随子页签数据源：调用关系图 = 真实 import 引用边（代码索引，
          // 非 AI）；主流程时序 = sequence 缓存（doc 逐字 / AI 归纳）。
          const explainSeq = seqView === 'code'
            ? callGraphState
            : sequenceFlowState === null ? null : sequenceFlowState.messages
          const refText = explainSeq === null
            ? (seqView === 'flow' ? '主流程时序（暂无数据：点击 🤖 AI 生成，从当前代码归纳核心主流程）' : '调用关系图（暂无数据：请先点击「↻ 重新扫描」生成代码索引）')
            : seqView === 'code'
              ? '调用关系图（真实 import 引用边，来自代码索引 index/.arch-lens-index.json，非 AI；边的顺序是遍历顺序，不代表执行时序）'
              : sequenceFlowState?.source === 'doc'
                ? `主流程时序（架构文档「## 时序」章节逐字提取：${sequenceFlowState.ref ?? '架构文档'}）`
                : '主流程时序（AI 结构化缓存 index/.arch-lens-sequence-<lang>.json，非权威）'
          return () => explainData(ui(language, 'tabSeq'), explainSeq === null ? [] : explainSeq, refText,
            seqView === 'flow' && sequenceFlowState?.source === 'flow' ? 'LLM 推断查证数据' : undefined)
        }
        case 'flow': return explainFlow
        case 'interaction': {
          // interaction 无方法级生成路径（METHOD_TABS 仅 seq）：讲解一律用
          // 实体级数据（方法级缓存恒空，回退避免"暂无数据"）。
          const events = eventsState ?? eventsMethodsState ?? null
          return () => explainData(
            ui(language, 'tabInteraction'),
            events ?? [],
            '交互数据（AI 结构化缓存 index/.arch-lens-events-<lang>.json，实体级）',
            'LLM 推断查证数据',
          )
        }
        case 'deps': return () => explainData(ui(language, 'tabDeps'), coreDeps.status === 'ready' ? coreDeps.source : '', '依赖图（核心子图：LLM 选包 + 源码 import 边）')
        case 'overview': {
          // 当前子页签决定讲解对象：AI 生成图（AI 页签 + 就绪）讲解 AI 图，
          // 否则讲解静态规则拼装图。
          const aiOverview = overviewView === 'ai'
            && dynamicFig !== null
            && dynamicFig.kind === 'overview'
            && dynamicFig.status === 'ready'
            && dynamicFig.diagram !== undefined
          if (aiOverview) {
            return () => explainData(
              `${ui(language, 'tabOverview')}（🤖 AI 生成）`,
              { title: dynamicFig.title ?? ui(language, 'tabOverview'), diagram: dynamicFig.diagram },
              'AI 生成的架构总览（纯 LLM：AI 选包 + 分层总览图）',
              'LLM 推断查证数据',
            )
          }
          return () => explainData(ui(language, 'tabOverview'), overviewFig.status === 'ready' ? overviewFig.source : '', '架构概览（核心包 + 一句话职责 + 源码 import 边；AI 选包 + 规则拼装，零 LLM）')
        }
        // 🎨 动态出图 explains the drawn figure (diagram + 概要) when ready —
        // but the tip-row buttons are hidden for this tab; this is defensive.
        case 'draw': return () => {
          if (drawFig.status === 'ready' && drawFig.diagram !== undefined) {
            explainData(`${ui(language, 'tabDraw')}（${drawFig.title ?? ''}）`, { title: drawFig.title ?? '', diagram: drawFig.diagram, summary: drawFig.summary ?? '' }, '动态出图（用户输入 + LLM 依据推断查证数据绘制；默认不保存）', 'LLM 推断查证数据')
          }
        }
        default: return () => explainData(ui(language, 'tabCatalog'), graph.nodes.map(node => ({ path: node.group === '' ? `src/${node.short}` : `src/${node.group}/${node.short}`, duty: node.blurb })), '包目录（扫描 + README/description）')
      }
    })()
    // Dependency tab shows ONLY the core-flow subgraph (LLM-picked core
    // packages with rule-derived source-import edges) — the full mermaid
    // views were removed: the entity/package-level full diagrams added no
    // learning value over the scan/import projections.
    const renderGraphTab = (): React.ReactNode => {
      const core = coreDeps
      const title = ui(language, 'tabDeps')
      const overview = core.status === 'ready'
        ? h('div', { className: css.flowWrap },
            h('div', { className: css.flowMeta },
              h('span', { className: css.badge }, core.core.source === 'flow' ? ui(language, 'coreBadgeFlow') : ui(language, 'coreBadgeCurated')),
              h('span', { className: css.flowTitle }, ui(language, 'viewOverview')),
              core.core.ref !== undefined ? h('code', { className: css.flowRef }, core.core.ref) : null,
            ),
            h(MermaidView, { key: 'core-deps', source: core.source, onSelectNode: label => selectNodeByLabel(label), onNodeContext: (label, kind) => selectFollowUpTarget('core', { kind, label }) }),
          )
        // Core not ready (读/写分离：rescan 后 core 缓存失效，直到点 AI 生成):
        // 只显示空态引导，不再用包分组树兜底（那看起来像包目录，语义混淆）。
        : core.status === 'error'
          ? h('div', { className: css.loading }, uiT(language, 'failLoad', { t: title, msg: core.message }))
          : h('div', { className: css.loading }, ui(language, 'noDataFigure'))
      return h('div', { className: css.graphWrap }, overview)
    }

    // Every unit body stays mounted; inactive tabs are hidden, so switching
    // back does not regenerate diagrams (the refresh button refetches).
    // A null figure state (no AI cache yet) renders an empty prompt instead
    // of a curated fallback — the data must come from this workspace's code.
    const noData = h('div', { className: css.loading }, ui(language, 'noDataFigure'))
    const unitBodies: Record<string, React.ReactNode> = {
      concepts: conceptTreeState === null
        ? noData
        : h(ConceptGraph, {
            graph,
            conceptTree: conceptTreeState,
            expanded,
            selectedId: selection !== null && selection.kind === 'pkg' ? selection.id : null,
            onToggle: toggleExpand,
            onSelectPkg: id => setSelection({ kind: 'pkg', id }),
            onExplainConcept: explainConcept,
            onAsk: (label, kind) => selectFollowUpTarget('concepts', { kind, label }),
          }),
      seq: h('div', { className: css.flowWrap },
        h('div', { className: css.viewSwitch },
          h('button', { className: `${css.btn} ${seqView === 'code' ? css.btnPrimary : ''}`, onClick: () => setSeqView('code') }, ui(language, 'viewCode')),
          h('button', { className: `${css.btn} ${seqView === 'flow' ? css.btnPrimary : ''}`, onClick: () => setSeqView('flow') }, ui(language, 'viewFlow')),
          // 可见入口：打开追问对话框（带上托盘选中清单）；右键元素先把目标
          // 收进托盘 chips（可多选、✕删），结果原地更新本页。
          h('button', {
            className: css.btn,
            onClick: () => openFollowUp('seq'),
          }, ui(language, 'followUpBtn')),
        ),
        // 子页签区分渲染与数据源：调用关系图 = 真实 import 引用边（只读代码
        // 索引缓存，非 AI）；主流程时序 = sequence 缓存的泳道时序图。
        seqView === 'code'
          ? callGraphState !== null
            ? h('div', null,
                h('div', { className: css.flowMeta },
                  h('span', { className: css.badge }, ui(language, 'seqCodeBadge')),
                  h('span', { className: css.flowTitle }, ui(language, 'callGraphSource'))),
                // 原生 mermaid flowchart 渲染（LR 自动布局）：包级引用边没有
                // 方法级时序可下钻，故无「动态画图」；右键节点可追问包间关系。
                h(MermaidView, {
                  key: 'callgraph',
                  source: callGraphToMermaid(callGraphState, language),
                  onNodeContext: (label, kind) => selectFollowUpTarget('seq', { kind, label }),
                }))
            : callGraphError !== null
              ? h('div', { className: css.notice }, callGraphError)
              : h('div', { className: css.loading }, ui(language, 'loadingFlow'))
          : sequenceFlowState === null
            ? noData
            : h('div', null,
                h('div', { className: css.flowMeta },
                  h('span', { className: css.badge },
                    sequenceFlowState.source === 'code' ? ui(language, 'seqCodeBadge')
                      : sequenceFlowState.source === 'doc' ? ui(language, 'seqDocBadge')
                      : ui(language, 'seqAIBadge')),
                  sequenceFlowState.ref !== undefined
                    ? h('span', { className: css.flowTitle }, sequenceFlowState.ref)
                    : null),
                h(SequenceGraph, {
                  result: sequenceFlowState,
                  language,
                  onDynamicRequest: message => requestDynamicFigure('seq-edge', { from: message.from, to: message.to, label: message.label }),
                  onAsk: (label, kind) => selectFollowUpTarget('seq', { kind, label }),
                }))),
      flow: (() => {
        const flowState = flowMap[flowAngle]?.[flowView]
        // 视图切换（实体/方法 + 视角 + 追问）必须始终可见：即使当前视图无
        // 数据（方法级缓存未生成），也要能切回有数据的视图——之前切换按钮
        // 在 flowState 分支里，无数据时按钮消失导致"切不回去"。
        return h('div', { className: css.flowWrap },
          h('div', { className: css.viewSwitch },
            h('button', { className: `${css.btn} ${flowView === 'entity' ? css.btnPrimary : ''}`, onClick: () => selectFlowView('entity') }, ui(language, 'viewEntity')),
            h('button', { className: `${css.btn} ${flowView === 'method' ? css.btnPrimary : ''}`, onClick: () => selectFlowView('method') }, ui(language, 'viewMethod')),
            h('span', { className: css.angleLabel }, ui(language, 'flowAngleLabel')),
            FLOW_ANGLES.map(angle => h('button', {
              key: angle,
              className: `${css.btn} ${flowAngle === angle ? css.btnPrimary : ''}`,
              // Instant local switch: both viewpoints are already loaded
              // (generated together in one LLM call).
              onClick: () => setFlowAnglePersisted(angle),
            }, ui(language, flowAngleKey(angle)))),
            // 可见入口：打开追问对话框（带上托盘选中清单）；右键元素先把目标
            // 收进托盘 chips（可多选、✕删），结果原地更新本页图。
            h('button', {
              className: css.btn,
              onClick: () => openFollowUp('flow', flowAngle),
            }, ui(language, 'followUpBtn')),
          ),
          flowState === undefined
            ? (flowTried.has(flowTriedKey(flowAngle, flowView))
                ? h('div', { className: css.loading }, ui(language, 'noDataFigure'))
                : h('div', { className: css.loading }, ui(language, 'loadingFlow')))
            : h('div', null,
                h('div', { className: css.flowMeta },
                  h('span', { className: css.badge }, flowState.source === 'doc' ? ui(language, 'flowDocBadge') : ui(language, 'flowAIBadge')),
                  h('span', { className: css.flowTitle }, flowState.title),
                  flowState.ref !== undefined ? h('code', { className: css.flowRef }, flowState.ref) : null,
                ),
                h(MermaidView, {
                  // key 绑定「视角/粒度」：切换时销毁旧实例，避免旧图渲染状态
                  // 残留导致"切换时旧图一闪而过"。
                  key: `${flowAngle}/${flowView}`,
                  source: flowState.mermaid,
                  onClusterAction: stage => requestDynamicFigure('flow-subgraph', { stage }, flowState.mermaid),
                  onNodeContext: (label, kind) => selectFollowUpTarget('flow', { kind, label }, flowAngle),
                }),
              ),
        )
      })(),
      interaction: (() => {
        // interaction 只做实体级（METHOD_TABS 仅 seq，方法级无生成路径、
        // 缓存恒空）：视图切换条只显示「实体级」，不提供方法级按钮。
        const events = eventsState ?? eventsMethodsState ?? null
        return h('div', { className: css.flowWrap },
          h('div', { className: css.viewSwitch },
            h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => selectEventsView('entity') }, ui(language, 'viewEntity')),
          ),
          events === null
            ? noData
            : h(InteractionGraph, { events, onSelectEvent: id => setSelection({ kind: 'event', id }), onAsk: (label, kind) => selectFollowUpTarget('events', { kind, label }) }),
        )
      })(),
      deps: renderGraphTab(),
      overview: h('div', { className: css.flowWrap },
        h('div', { className: css.viewSwitch },
          h('button', { className: `${css.btn} ${overviewView === 'static' ? css.btnPrimary : ''}`, onClick: () => selectOverviewView('static') }, ui(language, 'viewStatic')),
          h('button', { className: `${css.btn} ${overviewView === 'ai' ? css.btnPrimary : ''}`, onClick: () => selectOverviewView('ai') }, ui(language, 'viewAi')),
        ),
        overviewView === 'static'
          ? overviewFig.status === 'ready'
            ? h('div', null,
                h('div', { className: css.flowMeta },
                  h('span', { className: css.badge }, overviewFig.core.source === 'flow' ? ui(language, 'coreBadgeFlow') : ui(language, 'coreBadgeCurated')),
                  h('span', { className: css.flowTitle }, ui(language, 'tabOverview')),
                ),
                h(MermaidView, { key: 'overview', source: overviewFig.source, onNodeContext: (label, kind) => selectFollowUpTarget('overview', { kind, label }) }),
              )
            : overviewFig.status === 'error'
              ? h('div', { className: css.loading }, uiT(language, 'failLoad', { t: ui(language, 'tabOverview'), msg: overviewFig.message }))
              : overviewFig.status === 'idle'
                // 失效/从未生成 → 无数据空态（不是"正在加载"）：读路径不自动
                // 生成，等用户点 🤖 AI 生成 或 🔁 全量重建。
                ? noData
                : h('div', { className: css.loading }, ui(language, 'loadingScan'))
          : dynamicFig !== null && dynamicFig.kind === 'overview' && dynamicFig.status === 'ready' && dynamicFig.diagram !== undefined
            ? h('div', null,
                h('div', { className: css.flowMeta },
                  h('span', { className: css.badge }, ui(language, 'viewAiBadge')),
                  h('span', { className: css.flowTitle }, dynamicFig.title ?? ui(language, 'tabOverview')),
                ),
                h(MermaidView, { key: 'overview-ai', source: dynamicFig.diagram, onNodeContext: (label, kind) => selectFollowUpTarget('overview', { kind, label }), onRenderError: () => invalidateDynamicFigure(dynamicFig.kind, dynamicFig.key) }),
              )
            : dynamicFig !== null && dynamicFig.kind === 'overview' && dynamicFig.status === 'generating'
              ? h('div', { className: css.loading }, ui(language, 'dynamicGenerating'))
              : dynamicFig !== null && dynamicFig.kind === 'overview' && dynamicFig.status === 'error'
                ? h('div', { className: css.loading }, uiT(language, 'dynamicFailed', { msg: dynamicFig.message ?? '' }))
                : h('div', { className: css.loading }, ui(language, 'aiOverviewEmpty'))),
      // 包目录 = 扫描事实表：行永远来自 graph.nodes（本 tab 的契约就是
      // "扫描 + README/description"），AI 职责总结只是行内增强——dutyText 按
      // AI→blurbZh→blurb 行级兜底。旧版把"总结不全"整个 tab 拦成空态，而
      // 增量更新只认版本戳（部分缓存永远"有效"不再补），读路径又要求全覆盖
      // （永远 null）——半生成的缓存既补不齐也看不见，247 包的扫描表被 80 条
      // AI 总结的存在与否一票否决。现在 undefined=拉取中转圈，拿到即渲染。
      catalog: summaries === undefined
        ? h('div', { className: css.loading }, ui(language, 'loadingScan'))
        : h(Catalog, {
            graph,
            onSelectPkg: id => setSelection({ kind: 'pkg', id }),
            language,
            summaries: summaries ?? {},
          }),
      draw: h('div', { className: css.flowWrap },
        h('div', { className: css.drawBox },
          h('div', { className: css.drawScenes },
            h('button', {
              className: `${css.btn} ${drawFig.figureId === undefined ? css.btnPrimary : ''}`,
              onClick: newDrawScene,
            }, ui(language, 'drawNewScene')),
            h('span', { className: css.badge },
              drawFig.figureId !== undefined ? uiT(language, 'drawSceneId', { id: drawFig.figureId }) : ui(language, 'drawSceneNew')),
            drawFig.saved === true && drawFig.figureId !== undefined
              ? h('span', { className: css.drawSavedBadge }, ui(language, 'drawSavedBadge'))
              : null,
          ),
          drawFigures.length > 0
            ? h('div', { className: css.drawSceneList },
                drawFigures.map(item =>
                  h('div', {
                    key: item.figureId,
                    className: `${css.drawSceneRow} ${drawFig.figureId === item.figureId ? css.drawSceneActive : ''}`,
                  },
                    h('button', {
                      className: `${css.btn} ${css.drawScenePick}`,
                      onClick: () => selectDrawFigure(item.figureId),
                      title: ui(language, 'drawView'),
                    }, `${item.figureId}${item.title !== '' ? ` · ${item.title}` : ''}`),
                    h('span', { className: `${css.drawSavedBadge} ${item.saved ? '' : css.drawUnsavedBadge}` },
                      item.saved ? ui(language, 'drawSavedBadge') : ui(language, 'drawUnsaved')),
                    h('button', {
                      className: css.btn,
                      onClick: () => deleteDrawFigure(item.figureId),
                      title: ui(language, 'drawDelete'),
                    }, ui(language, 'drawDelete')),
                  ),
                ),
              )
            : null,
          // 选中清单（chips）：右键图元素逐个加进来，✕ 移除；与文本框（用户
          // 语言，可空）+ 按钮（动词）共同构成最终意图。发送成功即清空。
          currentSelectionItems().length > 0
            ? h('div', { className: css.drawChips },
                h('span', { className: css.badge }, uiT(language, 'drawChipsScope', { id: drawFig.figureId ?? '' })),
                drawSelection.items.map(item => h('span', { key: `${item.kind}\u0000${item.label}`, className: css.drawChip },
                  h('span', { className: css.drawChipText }, `${selectionGlyph(item.kind)} ${item.label}`),
                  h('button', {
                    className: css.drawChipX,
                    onClick: () => { removeDrawSelection(item) },
                  }, '✕'))))
            : null,
          h('textarea', {
            className: css.drawInput,
            ref: drawTextareaRef,
            value: drawText,
            onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDrawText(event.target.value),
            placeholder: ui(language, 'drawPlaceholder'),
            rows: 3,
          }),
          h('div', { className: css.drawActions },
            h('button', {
              className: `${css.btn} ${css.btnPrimary}`,
              onClick: drawFigure,
              disabled: (drawText.trim() === '' && currentSelectionItems().length === 0) || drawFig.status === 'generating',
            }, drawFig.status === 'generating'
              ? ui(language, 'drawWorking')
              : (drawFig.figureId !== undefined ? ui(language, 'drawFollowUp') : ui(language, 'drawBtn'))),
            drawFig.status === 'ready' && drawFig.saved !== true && drawFig.figureId !== undefined
              ? h('button', { className: css.btn, onClick: saveDrawFigure }, ui(language, 'drawSave'))
              : null,
            // 🔧 修复按钮：appears ONLY while the renderer's verdict says the
            // CURRENT diagram text is broken (that IS the validation). Manual
            // gate on the LLM round; ≥3 consecutive failed repairs pivot the
            // copy to steer toward a fresh 重新生成 instead of more feeding.
            drawFig.status === 'ready' && drawFig.diagram !== undefined && drawRenderVerdict !== null
              && drawRenderVerdict.diagram === drawFig.diagram && drawRenderVerdict.error !== null
              ? h('button', {
                  className: `${css.btn} ${css.btnPrimary}`,
                  onClick: repairDrawFigure,
                }, (repairAttemptsRef.current.get(drawFig.figureId ?? '') ?? 0) >= 3
                  ? uiT(language, 'drawRepairStuck', { n: repairAttemptsRef.current.get(drawFig.figureId ?? '') ?? 0 })
                  : ui(language, 'drawRepair'))
              : null,
            drawFig.status === 'ready'
              ? h('button', { className: css.btn, onClick: askDrawExplain }, ui(language, 'followUpExplain'))
              : null,
          ),
        ),
        drawFig.status === 'idle'
          ? h('div', { className: css.loading }, ui(language, 'drawEmpty'))
          : drawFig.status === 'generating'
            ? h('div', { className: css.loading }, ui(language, 'drawGenerating'))
            : drawFig.status === 'error'
              ? h('div', { className: css.loading }, uiT(language, 'drawFailed', { msg: drawFig.message ?? '' }))
              : h('div', null,
                  drawFig.title !== undefined && drawFig.title !== ''
                    ? h('div', { className: css.flowMeta },
                        h('span', { className: css.badge }, ui(language, 'viewAiBadge')),
                        h('span', { className: css.flowTitle }, drawFig.title),
                      )
                    : null,
                  drawFig.diagram !== undefined
                    ? h(MermaidView, {
                        key: `draw-${drawFig.figureId ?? 'x'}`,
                        source: drawFig.diagram,
                        // 右键 → 选中清单（节点/边/子图带类型进 chip，多选可删）。
                        onNodeContext: (label, kind) => { addDrawSelection(kind, label) },
                        // verdict recorded against the ORIGINAL diagram text: a
                        // failed render gates 保存 (see saveDrawFigure), and a
                        // redraw/new scene changes the text → old verdict stale.
                        // Success also clears the scene's repair streak.
                        onRendered: () => {
                          setDrawRenderVerdict({ diagram: drawFig.diagram ?? '', error: null })
                          if (drawFig.figureId !== undefined) repairAttemptsRef.current.delete(drawFig.figureId)
                        },
                        onRenderError: message => { setDrawRenderVerdict({ diagram: drawFig.diagram ?? '', error: message }) },
                      })
                    : null,
                  drawFig.summary !== undefined && drawFig.summary !== ''
                    ? h('div', { className: css.drawSummary }, drawFig.summary)
                    : null,
                  drawFig.saved === true && drawFig.figureId !== undefined
                    ? h('div', { className: css.drawSaved }, uiT(language, 'drawSceneSaved', { id: drawFig.figureId }))
                    : null,
                ),
      ),
    }
    body = h('div', { className: css.pane },
      h('div', { className: css.tip },
        h('span', null, activeTip),
        h('span', { className: css.spacer }),
        METHOD_TABS.includes(tab)
          ? h('button', {
              className: `${css.btn} ${methodOn(tab) ? css.btnPrimary : ''}`,
              onClick: toggleMethodLevel,
              title: ui(language, 'methodHint'),
            }, `🔬 ${methodOn(tab) ? ui(language, 'methodOn') : ui(language, 'methodOff')}`)
          : null,
        // 🎨 动态出图 has its own 画图 button — the tab-generic 🤖 AI 生成 /
        // 讲解此图 actions do not apply there.
        tab !== 'draw' ? h('button', { className: css.btn, onClick: aiGenerate, disabled: aiGenRunning },
          aiGenRunning ? ui(language, 'aiGenWorking') : ui(language, 'btnAiGen')) : null,
        tab !== 'draw' ? h('button', { className: css.btn, onClick: explain }, tab === 'catalog' ? ui(language, 'btnExplainCatalog') : ui(language, 'btnExplainGraph')) : null,
      ),
      renderFollowUpTray(),
      renderFollowUpRunning(),
      thinking !== null && thinking.reasoning !== ''
        ? h('div', { className: css.thinking },
            h('button', {
              className: css.thinkingToggle,
              onClick: () => setThinkingOpen(value => !value),
              title: ui(language, 'thinkingHint'),
            }, `🧠 ${ui(language, 'thinkingLabel')} ${thinkingOpen ? '▾' : '▸'}`),
            thinkingOpen ? h('div', { className: css.thinkingBody }, thinking.reasoning) : null,
          )
        : null,
      h('div', { className: css.body },
        tabOrder.map(unit => h('div', {
          key: unit.id,
          className: css.unitPane,
          style: { display: tab === unit.id ? 'flex' : 'none' },
        }, unitBodies[unit.id])),
        // 「动态画图」overlay: the generated detail diagram (seq-edge drill
        // down / flow-subgraph expansion), collapsible and closable; cached
        // results reopen instantly on later hovers. The AI-generated OVERVIEW
        // is NOT an overlay — it renders inline in the 架构概览「AI 生成」sub-tab.
        dynamicFig !== null && dynamicFig.kind !== 'overview'
          ? h('div', { className: css.dynOverlay },
              h('div', { className: css.dynHead },
                h('span', { className: css.dynTitle },
                  dynamicFig.status === 'generating'
                    ? ui(language, 'dynamicGenerating')
                    : dynamicFig.status === 'error'
                      ? uiT(language, 'dynamicFailed', { msg: dynamicFig.message ?? '' })
                      : (dynamicFig.title ?? ui(language, 'dynamicUntitled'))),
                // 讲解弹层里的下钻图本身（与顶部「讲解此图」讲主图互不干扰）。
                dynamicFig.status === 'ready' && dynamicFig.diagram !== undefined
                  ? h('button', {
                      className: css.btn,
                      onClick: () => explainData(
                        uiT(language, 'dynamicExplainTitle', { t: dynamicFig.title ?? ui(language, 'dynamicUntitled') }),
                        { title: dynamicFig.title ?? '', diagram: dynamicFig.diagram },
                        ui(language, 'dynamicExplainRef'),
                        'LLM 推断查证数据',
                      ),
                    }, ui(language, 'dynamicExplain'))
                  : null,
                h('button', {
                  className: css.btn,
                  onClick: () => setDynamicCollapsed(value => !value),
                }, dynamicCollapsed ? ui(language, 'dynamicExpand') : ui(language, 'dynamicCollapse')),
                h('button', { className: css.btn, onClick: () => setDynamicFig(null) }, '✕'),
              ),
              !dynamicCollapsed && dynamicFig.status === 'ready' && dynamicFig.diagram !== undefined
                ? h('div', { className: css.dynBody },
                    h(MermaidView, { key: `dyn-${dynamicFig.key}`, source: dynamicFig.diagram, onRenderError: () => invalidateDynamicFigure(dynamicFig.kind, dynamicFig.key) }))
                : !dynamicCollapsed && dynamicFig.status === 'generating'
                  ? h('div', { className: css.dynLoading }, ui(language, 'dynamicGenerating'))
                  : null,
            )
          : null,
      ),
      NOTES_FEATURE_OFF ? null : h(NotesPanel, { notes, language, onLoad: loadNotes }),
    )
  }

  const detailNode = graph !== null && selection !== null && selection.kind === 'pkg'
    ? graph.nodes.find(node => node.id === selection.id)
    : undefined
  let overlay: React.ReactNode = null
  if (detailNode !== undefined) {
    // Detail rides along with the graph: opens instantly, no RPC round trip.
    const detail = detailNode.detail
    let panelBody: React.ReactNode
    if (detail === undefined) {
      panelBody = h('div', { className: css.error }, ui(language, 'detailFailed'))
    } else {
      const depsText = detail.deps.length > 0 ? detail.deps.join(', ') : '—'
      const dependentsText = detail.dependents.length > 0 ? detail.dependents.join(', ') : '—'
      panelBody = h('div', null,
        dutyText(detailNode, language, summaries) !== '' ? h('p', { className: css.blurb }, dutyText(detailNode, language, summaries)) : null,
        h('div', { className: css.section },
          h('div', { className: css.sectionTitle }, ui(language, 'detailFiles')),
          h('ul', { className: css.files }, detail.files.map(file =>
            h('li', { key: file.name },
              h('code', null, file.name),
              file.role !== '' ? h('span', { className: css.role }, file.role) : null,
            )))),
        h('div', { className: css.section },
          h('div', { className: css.sectionTitle },
            uiT(language, 'detailDeps', { deps: depsText, dependents: dependentsText }))),
        detail.keyLines.length > 0
          ? h('div', { className: css.section },
              h('div', { className: css.sectionTitle }, ui(language, 'detailKeyLines')),
              h('pre', { className: css.code }, detail.keyLines.join('\n')))
          : null,
        detail.snippet !== ''
          ? h('div', { className: css.section },
              h('div', { className: css.sectionTitle }, ui(language, 'detailSnippet')),
              h('pre', { className: `${css.code} ${css.codeScroll}` }, detail.snippet))
          : null,
        h('div', { className: css.section },
          h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => explainPkg(detailNode) }, ui(language, 'detailExplain')),
          h('div', { className: css.followup },
            h('input', {
              className: css.input,
              placeholder: ui(language, 'detailFollowup'),
              value: followup,
              onChange: event => setFollowup(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter') {
                  if (followup.trim() !== '') {
                    submitQuestion(`（针对组件 ${detailNode.short}）${followup.trim()}`, `组件 ${detailNode.short}`)
                    setFollowup('')
                  }
                }
              },
            }),
            h('button', {
              className: css.btn,
              onClick: () => {
                if (followup.trim() === '') return
                submitQuestion(`（针对组件 ${detailNode.short}）${followup.trim()}`, `组件 ${detailNode.short}`)
                setFollowup('')
              },
            }, ui(language, 'send')),
          )),
        notice !== null ? h('div', { className: css.notice }, notice) : null,
        insights?.find(item => item.id === detailNode.short) !== undefined
          ? h(InsightsPanel, { insight: insights?.find(item => item.id === detailNode.short) })
          : null,
      )
    }
    overlay = h('div', { className: css.overlay, onClick: () => setSelection(null) },
      h('div', { className: css.panel, onClick: (event: React.MouseEvent) => event.stopPropagation() },
        h('div', { className: css.panelHead },
          h('span', { className: css.panelTitle }, detailNode.short),
          h('span', { className: css.badge }, detailNode.group),
          h('span', { className: css.spacer }),
          h('button', { className: css.btn, onClick: () => setSelection(null) }, '✕'),
        ),
        panelBody,
      ),
    )
  } else if (selection !== null && selection.kind === 'event') {
    const event = coreEvents?.find(candidate => candidate.event === selection.id)
    if (event !== undefined) {
      overlay = h('div', { className: css.overlay, onClick: () => setSelection(null) },
        h('div', { className: css.panel, onClick: (eventClick: React.MouseEvent) => eventClick.stopPropagation() },
          h('div', { className: css.panelHead },
            h('span', { className: css.panelTitle }, event.event),
            h('span', { className: `${css.badge} ${css.badgeEvent}` }, event.mode),
            h('span', { className: css.spacer }),
            h('button', { className: css.btn, onClick: () => setSelection(null) }, '✕'),
          ),
          h('p', { className: css.blurb }, event.note),
          h('div', { className: css.section },
            h('div', { className: css.sectionTitle }, uiT(language, 'eventProducers', { list: event.producers.join(', ') })),
            h('div', { className: css.sectionTitle }, uiT(language, 'eventConsumers', { list: event.consumers.join(', ') })),
          ),
          h('div', { className: css.section },
            h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => explainEvent(event.event) }, ui(language, 'eventExplain')),
            h('div', { className: css.followup },
              h('input', {
                className: css.input,
                placeholder: ui(language, 'followupPlaceholder'),
                value: followup,
                onChange: inputEvent => setFollowup(inputEvent.target.value),
                onKeyDown: inputEvent => {
                  if (inputEvent.key === 'Enter' && followup.trim() !== '') {
                    submitQuestion(`（针对事件 ${event.event}）${followup.trim()}`, `事件 ${event.event}`)
                    setFollowup('')
                  }
                },
              }),
              h('button', {
                className: css.btn,
                onClick: () => {
                  if (followup.trim() === '') return
                  submitQuestion(`（针对事件 ${event.event}）${followup.trim()}`, `事件 ${event.event}`)
                  setFollowup('')
                },
              }, ui(language, 'send')),
            )),
          notice !== null ? h('div', { className: css.notice }, notice) : null,
        ),
      )
    }
  }

  return h('div', { className: css.root },
    header,
    // 主面板提示条：所有 setNotice 结果（重新扫描 ✓、全量重建完成/失败、
    // 只读模式拒绝等）都必须在此可见——之前 notice 只在详情/事件 overlay
    // 里渲染，主面板操作的结果完全看不到（"没提示"）。
    notice !== null ? h('div', { className: css.notice }, notice) : null,
    llmStatsOpen && llmStats !== null
      ? h('div', { className: css.llmStats },
          (() => {
            const hasUsage = llmStats.totalUsageInTokens > 0 || llmStats.totalUsageOutTokens > 0
            return h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', fontWeight: 600, marginBottom: 6 } },
              h('span', null, `LLM 用量${hasUsage ? '（实际）' : '（估算）'}`),
              h('span', null, `${llmStats.totalCalls} 次调用`),
              h('span', null, hasUsage
                ? `输入 ${fmtTokens(llmStats.totalUsageInTokens)} tokens`
                : `输入 ${fmtTokens(llmStats.totalInTokens)} tokens`),
              h('span', null, hasUsage
                ? `输出 ${fmtTokens(llmStats.totalUsageOutTokens)} tokens`
                : `输出 ${fmtTokens(llmStats.totalOutTokens)} tokens`),
              h('span', null, `总耗时 ${(llmStats.totalMs / 1000).toFixed(1)}s`),
            )
          })(),
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 4 } },
            h('button', { className: css.btn, onClick: () => setAllMethods(true) }, ui(language, 'methodAllOn')),
            h('button', { className: css.btn, onClick: () => setAllMethods(false) }, ui(language, 'methodAllOff')),
            h('span', { style: { fontSize: 10, color: '#888', alignSelf: 'center' } }, ui(language, 'methodHint')),
          ),
          llmStats.records.map((record, index) => {
            const tokens = recordTokens(record)
            return h('div', { key: `${record.at}-${index}`, style: { display: 'flex', gap: 8, padding: '2px 0' } },
              h('code', { style: { minWidth: 130 } }, record.label ?? record.kind),
              h('span', null,
                `${tokens.inText}→${tokens.outText} tokens${tokens.reasoning !== undefined ? ` +${tokens.reasoning} reasoning` : ''}${tokens.actual ? '' : '（估）'} · ${(record.ms / 1000).toFixed(1)}s · ${new Date(record.at).toLocaleTimeString()}`),
            )
          }),
        )
      : null,
    h('div', { className: css.body }, body),
    editorOpen
      ? h(PromptEditor, {
          archLens,
          config: promptConfig,
          base: config,
          onSave: next => { setPromptConfig(next); setEditorOpen(false) },
          onClose: () => setEditorOpen(false),
        })
      : null,
    followUpDlg !== null
      ? h('div', { className: css.followUpMask, onClick: () => { closeFollowUpDlg() } },
          h('div', { className: css.followUpCard, onClick: (event: React.MouseEvent) => event.stopPropagation() },
            h('div', { className: css.followUpTitle }, uiT(language, 'followUpTitle', { kind: followUpKindLabel(followUpDlg.kind) })),
            // 对话框内的选中清单（✕ 删除、关框写回托盘）：最终意图 =
            // 当前图（后端底稿）+ 这些节点 + 下方用户语言（两者至少其一）。
            followUpDlg.items.length > 0
              ? h('div', { className: css.drawChips },
                  h('span', { className: css.badge }, uiT(language, 'followUpChipsScope', { kind: followUpKindLabel(followUpDlg.kind) })),
                  followUpDlg.items.map(item => h('span', { key: item.kind + ' ' + item.label, className: css.drawChip },
                    h('span', { className: css.drawChipText }, selectionGlyph(item.kind) + ' ' + item.label),
                    h('button', {
                      className: css.drawChipX,
                      onClick: () => { setFollowUpDlg(current => current === null ? null : { ...current, items: withoutSelection(current.items, item) }) },
                    }, '✕'))))
              : null,
            h('textarea', {
              className: css.followUpInput,
              value: followUpDlg.text,
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setFollowUpDlg(current => current === null ? null : { ...current, text: event.target.value, error: undefined }),
              placeholder: ui(language, 'followUpPlaceholder'),
              rows: 4,
              autoFocus: true,
            }),
            h('div', { className: css.followUpActions },
              h('button', { className: css.btn, onClick: () => { closeFollowUpDlg() } }, ui(language, 'followUpCancel')),
              h('button', {
                className: css.btn,
                onClick: askFollowUpExplain,
                disabled: followUpDlg.text.trim() === '' && followUpDlg.items.length === 0,
              }, ui(language, 'followUpExplain')),
              h('button', {
                className: `${css.btn} ${css.btnPrimary}`,
                onClick: runFollowUp,
                disabled: followUpRun !== null || (followUpDlg.text.trim() === '' && followUpDlg.items.length === 0),
                title: followUpRun !== null ? ui(language, 'followUpBusyHint') : undefined,
              }, ui(language, 'followUpRun')),
            ),
          ),
        )
      : null,
    overlay,
  )
}
