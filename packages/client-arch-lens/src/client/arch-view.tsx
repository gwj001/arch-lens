/**
 * Arch Lens study desk: unit tabs over the backend Remote, component/event
 * detail popups, notes summary, and the explain queue. Rendered inside the
 * floating robot panel; questions go through the core conversation pipeline
 * (props.send → session.prompt), so answers appear in the main chat view.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/arch-view
 */

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ArchLensCodeInsight, ArchLensCoreGraph, ArchLensFlowResult, ArchLensGraph, ArchLensNotesResult, ArchLensPromptConfig, ArchLensSequenceResult } from '@deepseek-ai/dsh-arch-lens-backend'
import { Catalog, dutyText } from './catalog.tsx'
import { InsightsPanel } from './insights-panel.tsx'
import { NotesPanel } from './notes-panel.tsx'
import { PromptEditor } from './prompt-editor.tsx'
import {
  codeInsightClause,
  componentQuestion,
  coreCandidates,
  dataQuestion,
  DEFAULT_EXPLAIN_STYLE,
  DEFAULT_LANGUAGE,
  DEFAULT_OVERVIEW_PROMPT,
  defaultOverview,
  defaultStyle,
  eventQuestion,
  evidenceClause,
  languageClause,
  overviewQuestion,
  useDefaultsConfig,
} from './explain.ts'
import type { EvidenceEntry } from './explain.ts'
import { buildGroupTree, ConceptGraph, InteractionGraph, SequenceGraph } from './graphs.tsx'
import { MermaidView } from './mermaid-view.tsx'
import { ui, uiT } from './i18n.ts'
import type { ArchLensRemote } from './remote.ts'
import { unwrapRemote } from './remote.ts'
import css from './arch-view.module.css'

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

/** One core interaction row (AI structured cache `.arch-lens-events-<lang>.json`). */
export interface CoreEvent {
  event: string
  mode: string
  producers: string[]
  consumers: string[]
  note: string
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

/** Load state of a lazily fetched mermaid diagram (deps / ER tabs). */
type MermaidState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'indexing' }
  | { status: 'ready'; source: string }
  | { status: 'error'; message: string }

/** Load state of the core-flow subgraph (deps / ER overview). */
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
  useSessions: PropsRuntime<'shell.overlay'>['useSessions']
}

/**
 * The Arch Lens study desk entry component.
 */
export function ArchView(props: ArchViewProps): React.JSX.Element {
  const { archLens, config, sessionId } = props
  const [conceptTreeState, setConceptTreeState] = useState<ConceptNode[] | null>(null)
  const [sequenceState, setSequenceState] = useState<ArchLensSequenceResult | null>(null)
  const [eventsState, setEventsState] = useState<CoreEvent[] | null>(null)
  const [flowState, setFlowState] = useState<ArchLensFlowResult | null>(null)
  const [promptConfig, setPromptConfig] = useState<ArchLensPromptConfig>({})
  const [editorOpen, setEditorOpen] = useState(false)
  const language = promptConfig.language ?? DEFAULT_LANGUAGE
  // Effective prompt: default templates follow the role language; saved
  // overrides (or deployment Config) win in "my prompts" mode.
  const useDefaults = useDefaultsConfig(promptConfig)
  const explainStyle = useDefaults
    ? (config.explainStyle ?? defaultStyle(language))
    : (promptConfig.explainStyle ?? config.explainStyle ?? DEFAULT_EXPLAIN_STYLE)
  const overviewPrompt = useDefaults
    ? (config.overviewPrompt ?? defaultOverview(language))
    : (promptConfig.overviewPrompt ?? config.overviewPrompt ?? DEFAULT_OVERVIEW_PROMPT)
  // Figure data is AI-generated/cache-first only (concept from the
  // architecture-doc chain, sequence/events from LLM structured caches). No
  // curated fallback: a null state renders an empty prompt to run AI generate.
  const conceptTree = conceptTreeState
  const sequence = sequenceState
  const coreEvents = eventsState
  const [tab, setTab] = useState('concepts')
  const [graph, setGraph] = useState<ArchLensGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [followup, setFollowup] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string[]>([])
  const [notes, setNotes] = useState<ArchLensNotesResult | { error: string } | null>(null)
  const [mermaidDeps, setMermaidDeps] = useState<MermaidState>({ status: 'idle' })
  const [mermaidEr, setMermaidEr] = useState<MermaidState>({ status: 'idle' })
  const [coreDeps, setCoreDeps] = useState<CoreState>({ status: 'idle' })
  const [coreEr, setCoreEr] = useState<CoreState>({ status: 'idle' })
  const [mermaidToken, setMermaidToken] = useState(0)
  const [summaries, setSummaries] = useState<Record<string, string> | null | undefined>(undefined)
  const [depsView, setDepsView] = useState<'overview' | 'full'>('overview')
  const [erView, setErView] = useState<'overview' | 'full'>('overview')
  const [groupExpanded, setGroupExpanded] = useState<string[]>([])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressGenerated, setProgressGenerated] = useState(false)
  const [insights, setInsights] = useState<ArchLensCodeInsight[] | null>(null)
  const [aiGenRunning, setAiGenRunning] = useState(false)
  const retryTimer = useRef<number | null>(null)
  // The workspace root the loaded figures belong to (the desk-info identity
  // resolved by setSession). Figure fetches capture the generation and drop
  // results that arrive after a workspace switch or language change.
  const workspaceKeyRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  // Explain queue: at most one explain turn runs at a time. Requests are
  // queued, not rejected — when the session turn ends (running flips false
  // after a submit), the next queued request is submitted automatically.
  const explainQueueRef = useRef<Array<{ text: string; target: string }>>([])
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
    setSequenceState(null)
    setEventsState(null)
    setFlowState(null)
    setMermaidDeps({ status: 'idle' })
    setMermaidEr({ status: 'idle' })
    setCoreDeps({ status: 'idle' })
    setCoreEr({ status: 'idle' })
    setInsights(null)
    setSummaries(undefined)
  }

  /** Re-pull EVERY figure for the current workspace root, no backend invalidation. */
  const loadAllFigures = (): void => {
    const generation = generationRef.current
    loadMetadata()
    loadGraph()
    void unwrapRemote(archLens.conceptTree({ language })).then(tree => {
      if (generation !== generationRef.current) return
      if (!('error' in tree)) setConceptTreeState(tree)
    }).catch(() => {})
    void unwrapRemote(archLens.sequence({ language })).then(data => {
      if (generation !== generationRef.current) return
      if (data !== null && !('error' in data)) setSequenceState(data)
    }).catch(() => {})
    void unwrapRemote(archLens.events({ language })).then(data => {
      if (generation !== generationRef.current) return
      if (data !== null && !('error' in data)) setEventsState(data)
    }).catch(() => {})
    void unwrapRemote(archLens.flow({ language })).then(data => {
      if (generation !== generationRef.current) return
      if (!('error' in data)) setFlowState(data)
    }).catch(() => {})
    if (tab === 'deps' || tab === 'er') {
      fetchMermaid(tab)
      fetchCore(tab)
    }
  }

  /** Refresh the per-workspace metadata (notes, prompt config, code insights). */
  const loadMetadata = (): void => {
    const generation = generationRef.current
    void unwrapRemote(archLens.notes()).then(result => {
      if (generation === generationRef.current) setNotes(result)
    }).catch(() => {})
    void unwrapRemote(archLens.promptConfig()).then(result => {
      if (generation === generationRef.current) setPromptConfig(result.config)
    }).catch(() => {})
    void unwrapRemote(archLens.analyze()).then(result => {
      if (generation !== generationRef.current) return
      if (!('error' in result)) setInsights(result)
    }).catch(() => {})
  }

  // Load the data source for the current session's workspace, then pull the
  // figures. This is the ONE load path: mount, session switch, and the reload
  // button all land here. The backend setSession is cache-first (never
  // invalidates), and the workspace identity rides the graph result
  // (`graph.root`), so loadGraph decides whether the data source actually
  // moved and re-pulls only when it did.
  useEffect(() => {
    let cancelled = false
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
  const running = props.useSessions(state =>
    props.sessionId === null ? false : (state.byId[props.sessionId as SessionId]?.running ?? false))
  useEffect(() => {
    if (running) sawRunningRef.current = true
    if (!running && explainingRef.current && sawRunningRef.current) {
      explainingRef.current = false
      sawRunningRef.current = false
      pumpExplainQueue()
    }
  }, [running])

  const submitQuestion = (text: string, target: string): void => {
    explainQueueRef.current.push({ text, target })
    pumpExplainQueue()
  }

  const explainPkg = (node: ArchLensGraph['nodes'][number]): void => {
    const files = node.detail.files.map(file => file.name)
    const blurb = language === DEFAULT_LANGUAGE ? (node.blurbZh ?? node.blurb) : node.blurb
    const insight = insights?.find(item => item.id === node.id)
    const snippet = node.detail.snippet === '' ? '' : `\n\n【入口源码（浓缩，${node.detail.snippet.split('\n').length} 行）】\n${node.detail.snippet}`
    const evidence: EvidenceEntry[] = [
      { label: '组件职责（本地化）', ref: 'package.json description / README.md', text: blurb },
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
        [{ label: '事件数据', ref: '.arch-lens-events-<lang>.json（AI 结构化缓存）', text: `事件 ${event.event}（${event.mode}）生产者：${event.producers.join(', ')}；消费者：${event.consumers.join(', ')}；${event.note}` }]),
      `事件 ${event.event}`,
    )
  }

  const explainData = (title: string, data: unknown, ref: string): void => {
    submitQuestion(dataQuestion(title, data, explainStyle, language,
      [{ label: '图数据', ref, text: JSON.stringify(data).slice(0, 1200) }]), `图 ${title}`)
  }

  const explainAll = (): void => {
    if (graph === null) return
    submitQuestion(overviewQuestion(graph, overviewPrompt, language,
      [{ label: '工作区扫描图', ref: 'packages/*/*（package.json peerDependencies + README + src 索引）', text: `包数 ${graph.nodes.length}；依赖边 ${graph.edges.length}；核心候选：${coreCandidates(graph).join('、')}` }]), '整体架构')
  }

  /**
   * Explain the flow diagram in the chat. Doc flows cite the verbatim flow
   * block + anchor; induced flows declare themselves non-authoritative.
   */
  const explainFlow = (): void => {
    if (flowState === null) return
    const evidence: EvidenceEntry[] = flowState.source === 'flow'
      ? [{ label: 'AI 归纳（项目无文档流程）', ref: 'code-index 运行流元数据（入口/依赖/实体）', text: '流程图由 LLM 从代码索引归纳（非权威，建议生成架构文档后复核）' }]
      : [{ label: '流程原文（逐字引用）', ref: flowState.ref ?? '架构文档', text: flowState.sourceText ?? flowState.mermaid }]
    submitQuestion(
      `请讲解流程图「${flowState.title}」：\n\n${explainStyle}${evidenceClause(evidence)}${languageClause(language)}`,
      `流程图 ${flowState.title}`,
    )
  }

  /**
   * Rescan = REBUILD every fact source: the backend invalidates the scan
   * graph, the code-index (memory + disk) and all AI caches; here we drop the
   * figure states and re-pull every figure AFTER the backend refresh settles
   * (a parallel re-pull could read the pre-invalidation caches — a race).
   */
  const refresh = (): void => {
    clearFigures()
    const generation = generationRef.current
    void unwrapRemote(archLens.refresh()).then(result => {
      if (generation !== generationRef.current) return
      if ('error' in result) setError(result.error)
      else setGraph(result)
      // Re-pull every figure only now — all caches are invalidated.
      loadAllFigures()
    }).catch((reason: unknown) => setError(String(reason)))
  }

  /** Fetch (or refetch) a mermaid diagram; prefers the code-index source. */
  const fetchMermaid = (kind: 'deps' | 'er', attempt = 0): void => {
    const indexedKind = kind === 'deps' ? 'flowchart' : 'erDiagram'
    const setState = kind === 'deps' ? setMermaidDeps : setMermaidEr
    const generation = generationRef.current
    setState({ status: 'loading' })
    void unwrapRemote(archLens.mermaidIndexed({ kind: indexedKind })).then(result => {
      if (generation !== generationRef.current) return
      if ('error' in result) {
        // First index can exceed the 30s RPC budget (multi-minute on large
        // workspaces). Poll until the backend cache lands, then fall back to
        // the scanned-graph (peerDeps) source after the patience window.
        if (attempt < 25) {
          setState({ status: 'indexing' })
          console.log(`[arch-lens] indexed mermaid still cooking (${result.error}); retry ${attempt + 1}`)
          window.setTimeout(() => fetchMermaid(kind, attempt + 1), 3000)
          return
        }
        console.warn(`[arch-lens] indexed mermaid unavailable (${result.error}); falling back to scan graph`)
        const applyFallback = (fallback: { source: string } | { error: string }): void => {
          if (generation !== generationRef.current) return
          if ('error' in fallback) setState({ status: 'error', message: fallback.error })
          else setState({ status: 'ready', source: fallback.source })
        }
        if (kind === 'deps') {
          return unwrapRemote(archLens.mermaidDeps()).then(applyFallback)
        }
        return unwrapRemote(archLens.mermaidEr()).then(applyFallback)
      }
      setState({ status: 'ready', source: result.source })
    }).catch((reason: unknown) => {
      if (generation !== generationRef.current) return
      if (attempt < 25) {
        setState({ status: 'indexing' })
        window.setTimeout(() => fetchMermaid(kind, attempt + 1), 3000)
        return
      }
      setState({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  /** Fetch the core-flow subgraph (deps / ER overview) for one kind. */
  const fetchCore = (kind: 'deps' | 'er', force = false): void => {
    const setState = kind === 'deps' ? setCoreDeps : setCoreEr
    const generation = generationRef.current
    setState({ status: 'loading' })
    void unwrapRemote(archLens.mermaidCore({ kind: kind === 'deps' ? 'flowchart' : 'erDiagram', language, force })).then(result => {
      if (generation !== generationRef.current) return
      if ('error' in result) setState({ status: 'error', message: result.error })
      else setState({ status: 'ready', source: result.source, core: result.core })
    }).catch((reason: unknown) => {
      if (generation !== generationRef.current) return
      setState({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  /** Lazily fetch the core subgraph the first time a tab opens. */
  const loadCore = (kind: 'deps' | 'er'): void => {
    const state = kind === 'deps' ? coreDeps : coreEr
    if (state.status === 'idle') fetchCore(kind)
  }

  /** Lazily fetch a mermaid diagram the first time its tab is opened. */
  const loadMermaid = (kind: 'deps' | 'er'): void => {
    const state = kind === 'deps' ? mermaidDeps : mermaidEr
    if (state.status === 'idle') fetchMermaid(kind)
  }

  const selectTab = (id: string): void => {
    setTab(id)
    if (id === 'deps' || id === 'er') {
      loadMermaid(id)
      loadCore(id)
    }
  }

  /**
   * AI generate = rebuild THIS figure's fact source (code-index forced) and
   * have the LLM produce the dimension content (doc section + figure data).
   */
  const aiGenerate = (): void => {
    if (aiGenRunning) return
    setAiGenRunning(true)
    setNotice(null)
    // Flow: AI generate = force-fresh facts, then re-derive the flow (doc
    // transcode, or induction when no doc block exists). No doc section is
    // written — the flow's facts are the doc block or the code index itself.
    if (tab === 'flow') {
      void unwrapRemote(archLens.refreshIndex()).then(() => {
        void unwrapRemote(archLens.flow({ language, force: true })).then(result => {
          setAiGenRunning(false)
          if ('error' in result) {
            console.warn('[arch-lens] ai generate failed:', result.error)
            setNotice(uiT(language, 'aiGenFailed', { msg: result.error }))
            return
          }
          setFlowState(result)
          setNotice(ui(language, 'aiGenDone'))
        }).catch((reason: unknown) => {
          setAiGenRunning(false)
          setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
        })
      }).catch((reason: unknown) => {
        setAiGenRunning(false)
        setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
      })
      return
    }
    const kind = tab === 'concepts' ? 'concepts'
      : tab === 'seq' ? 'seq'
        : tab === 'interaction' ? 'interaction'
          : tab === 'deps' ? 'deps'
            : tab === 'er' ? 'er'
              : 'catalog'
    // Step 1: force-fresh facts before the LLM reads any metadata.
    void unwrapRemote(archLens.refreshIndex()).then(() => {
      void unwrapRemote(archLens.generateDocSection({ kind, language })).then(result => {
        setAiGenRunning(false)
        if ('error' in result) {
          console.warn('[arch-lens] ai generate failed:', result.error)
          setNotice(uiT(language, 'aiGenFailed', { msg: result.error }))
          return
        }
        setNotice(ui(language, 'aiGenDone'))
        // Step 2: re-derive the figure from the freshly generated content.
        if (kind === 'concepts') {
          void unwrapRemote(archLens.conceptTree({ language, force: true })).then(tree => {
            if (!('error' in tree)) setConceptTreeState(tree)
          }).catch(() => {})
        } else if (kind === 'seq') {
          void unwrapRemote(archLens.sequence({ language })).then(data => {
            if (data !== null && !('error' in data)) setSequenceState(data)
          }).catch(() => {})
        } else if (kind === 'interaction') {
          void unwrapRemote(archLens.events({ language })).then(data => {
            if (data !== null && !('error' in data)) setEventsState(data)
          }).catch(() => {})
        } else if (kind === 'deps' || kind === 'er') {
          fetchMermaid(kind)
          // AI generate = also force a fresh core selection for the overview.
          fetchCore(kind, true)
          setMermaidToken(value => value + 1)
        } else if (kind === 'catalog') {
          loadSummaries(0, true)
        }
      }).catch((reason: unknown) => {
        setAiGenRunning(false)
        setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
      })
    }).catch((reason: unknown) => {
      setAiGenRunning(false)
      setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Global "one-shot docs": generate the full architecture doc for the project. */
  const genDocs = (): void => {
    if (aiGenRunning) return
    setAiGenRunning(true)
    setNotice(null)
    void unwrapRemote(archLens.generateDocs({ language })).then(result => {
      setAiGenRunning(false)
      if ('error' in result) {
        console.warn('[arch-lens] generate docs failed:', result.error)
        setNotice(uiT(language, 'genDocFailed', { msg: result.error }))
        return
      }
      setNotice(ui(language, 'genDocDone'))
      // Concept tree follows the generated doc immediately.
      void unwrapRemote(archLens.conceptTree({ language, force: true })).then(tree => {
        if (!('error' in tree)) setConceptTreeState(tree)
      }).catch(() => {})
      void unwrapRemote(archLens.sequence({ language })).then(data => {
        if (data !== null && !('error' in data)) setSequenceState(data)
      }).catch(() => {})
      void unwrapRemote(archLens.events({ language })).then(data => {
        if (data !== null && !('error' in data)) setEventsState(data)
      }).catch(() => {})
      // The generated doc may carry a flow block — re-derive the flow.
      void unwrapRemote(archLens.flow({ language, force: true })).then(data => {
        if (!('error' in data)) setFlowState(data)
      }).catch(() => {})
    }).catch((reason: unknown) => {
      setAiGenRunning(false)
      setNotice(uiT(language, 'genDocFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Generate (or regenerate) the AI learning-progress summary in the notes. */
  const runProgress = (): void => {
    if (progressRunning) return
    setProgressRunning(true)
    setNotice(null)
    void unwrapRemote(archLens.progress({ language, force: progressGenerated })).then(result => {
      setProgressRunning(false)
      if ('error' in result) {
        console.warn('[arch-lens] progress failed:', result.error)
        setNotice(uiT(language, 'progressFailed', { msg: result.error }))
        return
      }
      console.log(`[arch-lens] progress: ${result.progress}% covered, summary ${result.summary.length} chars`)
      setProgressGenerated(true)
      setNotice(progressGenerated ? ui(language, 'progressRegenerated') : ui(language, 'progressDone'))
      void unwrapRemote(archLens.notes()).then(notes => { setNotes(notes) }).catch(() => {})
    }).catch((reason: unknown) => {
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
    // point is a fresh LLM pass over current code.
    if (!force && cached !== undefined && cached !== null && Object.keys(cached).length >= (graph?.nodes.length ?? 0)) {
      setSummaries(cached)
      return
    }
    console.log(`[arch-lens] loadSummaries: requesting (root=${workspaceKeyRef.current}, lang=${language}, attempt=${attempt}, force=${force})`)
    setSummaries(cached ?? null)
    void unwrapRemote(archLens.summarizeDuties({ language })).then(result => {
      if ('error' in result) {
        console.warn('[arch-lens] loadSummaries failed:', result.error)
        setSummaries(null)
        setNotice(uiT(language, 'summarizeFailedNotice', { msg: result.error }))
      } else {
        console.log(`[arch-lens] loadSummaries: got ${Object.keys(result).length} summaries`)
        cachedDutySummaries.set(summaryCacheKey, result)
        setSummaries(result)
        // Partial fill: the backend caps batches per call; keep pulling until
        // every package has a summary or the cap is reached.
        if (graph !== null && Object.keys(result).length < graph.nodes.length && attempt < 5) {
          window.setTimeout(() => loadSummaries(attempt + 1, force), 1500)
        }
      }
    }).catch((reason: unknown) => {
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
      `请讲解架构概念「${node.name}」：${node.desc}${node.inside !== undefined ? `\n内部机制：${node.inside}` : ''}\n\n${explainStyle}${codeInsightClause(insight)}${evidenceClause(evidence)}${languageClause(language)}`,
      `概念 ${node.name}`,
    )
  }

  /**
   * Refresh THIS figure = rebuild its fact source (code-index forced) and
   * re-derive the figure from the fresh facts. No LLM, no doc writes.
   */
  const refreshTab = (): void => {
    if (tab === 'deps' || tab === 'er') {
      void unwrapRemote(archLens.refreshIndex()).then(() => {
        fetchMermaid(tab)
        // Refresh keeps the core selection (ids) and re-derives its edges
        // from the fresh index; only AI generate re-picks the core.
        fetchCore(tab)
        setMermaidToken(value => value + 1)
      }).catch(() => fetchMermaid(tab))
      return
    }
    if (tab === 'concepts') {
      void unwrapRemote(archLens.refreshIndex()).then(() => {
        void unwrapRemote(archLens.conceptTree({ language, force: true })).then(tree => {
          if (!('error' in tree)) setConceptTreeState(tree)
        }).catch(() => {})
      }).catch(() => {})
      return
    }
    if (tab === 'seq') {
      void unwrapRemote(archLens.refreshIndex()).then(() => {
        void unwrapRemote(archLens.sequence({ language })).then(data => {
          if (data !== null && !('error' in data)) setSequenceState(data)
        }).catch(() => {})
      }).catch(() => {})
      return
    }
    if (tab === 'interaction') {
      void unwrapRemote(archLens.refreshIndex()).then(() => {
        void unwrapRemote(archLens.events({ language })).then(data => {
          if (data !== null && !('error' in data)) setEventsState(data)
        }).catch(() => {})
      }).catch(() => {})
      return
    }
    if (tab === 'flow') {
      void unwrapRemote(archLens.refreshIndex()).then(() => {
        void unwrapRemote(archLens.flow({ language, force: true })).then(data => {
          if (!('error' in data)) setFlowState(data)
        }).catch(() => {})
      }).catch(() => {})
      return
    }
    // catalog: rescan the scan graph so blurbs are current.
    refresh()
  }

  /** Open the package detail popup for a clicked mermaid node/entity label. */
  const selectNodeByLabel = (label: string): void => {
    const node = graph?.nodes.find(candidate => candidate.short === label)
    if (node !== undefined) setSelection({ kind: 'pkg', id: node.id })
  }

  const toggleExpand = (id: string): void => {
    setExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  }

  const groupTree = useMemo(() => graph !== null ? buildGroupTree(graph) : [], [graph])

  const toggleGroup = (id: string): void => {
    setGroupExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  }

  const tabOrder: Array<{ id: string; label: string }> = [
    { id: 'concepts', label: ui(language, 'tabConcepts') },
    { id: 'seq', label: ui(language, 'tabSeq') },
    { id: 'flow', label: ui(language, 'tabFlow') },
    { id: 'interaction', label: ui(language, 'tabInteraction') },
    { id: 'deps', label: ui(language, 'tabDeps') },
    { id: 'er', label: ui(language, 'tabEr') },
    { id: 'catalog', label: ui(language, 'tabCatalog') },
  ]

  /**
   * Reload = the same load path as mount/session-switch: re-load the data
   * source for the current session and re-pull every figure from the
   * workspace caches. No refresh/invalidation: the backend keeps its scan,
   * index, and AI caches untouched.
   */
  const reload = (): void => {
    void unwrapRemote(archLens.setSession(sessionId)).then(() => {
      loadAllFigures()
    }).catch((reason: unknown) => {
      setNotice(uiT(language, 'sessionSwitchFailed', { msg: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  const header = h('div', { className: css.header },
    tabOrder.map(unit => h('button', {
      key: unit.id,
      className: `${css.tab} ${tab === unit.id ? css.tabActive : ''}`,
      onClick: () => selectTab(unit.id),
    }, unit.label)),
    h('span', { className: css.spacer }),
    h('button', { className: css.btn, onClick: explainAll }, ui(language, 'btnOverview')),
    h('button', { className: css.btn, onClick: runProgress, disabled: progressRunning },
      progressRunning ? ui(language, 'progressWorking') : ui(language, 'btnProgress')),
    h('button', { className: css.btn, onClick: genDocs, disabled: aiGenRunning },
      aiGenRunning ? ui(language, 'genDocWorking') : ui(language, 'btnGenDoc')),
    h('button', { className: css.btn, onClick: () => setEditorOpen(true) }, ui(language, 'btnPrompts')),
    h('button', { className: css.btn, onClick: reload }, ui(language, 'btnReload')),
    h('button', { className: css.btn, onClick: refresh }, ui(language, 'btnRescan')),
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
    body = h('div', { className: css.loading }, ui(language, 'loadingScan'))
  } else {
    const activeTip = ((): string => {
      switch (tab) {
        case 'concepts': return ui(language, 'tipConcepts')
        case 'seq': return ui(language, 'tipSeq')
        case 'flow': return ui(language, 'tipFlow')
        case 'interaction': return ui(language, 'tipInteraction')
        case 'deps': return ui(language, 'tipDeps')
        case 'er': return ui(language, 'tipEr')
        default: return uiT(language, 'tipCatalog', { count: String(graph.nodes.length) })
      }
    })()
    const explain = ((): (() => void) => {
      switch (tab) {
        case 'concepts': return () => explainData(ui(language, 'tabConcepts'), conceptTree, '概念树（架构文档提取或 AI 归纳，source: doc/flow）')
        case 'seq': {
          const refText = sequence === null
            ? '时序数据（无数据）'
            : sequence.source === 'code'
              ? '时序数据（代码静态调用图 .arch-lens-index.json calls）'
              : sequence.source === 'doc'
                ? `时序数据（架构文档「## 时序」章节逐字提取：${sequence.ref ?? '架构文档'}）`
                : '时序数据（AI 结构化缓存 .arch-lens-sequence-<lang>.json，非权威）'
          return () => explainData(ui(language, 'tabSeq'), sequence === null ? [] : sequence.messages, refText)
        }
        case 'flow': return explainFlow
        case 'interaction': return () => explainData(ui(language, 'tabInteraction'), coreEvents, '交互数据（AI 结构化缓存 .arch-lens-events-<lang>.json）')
        case 'deps': return () => explainData(ui(language, 'tabDeps'), mermaidDeps.status === 'ready' ? mermaidDeps.source : '', '依赖图（源码 imports 聚合或扫描 peerDependencies）')
        case 'er': return () => explainData(ui(language, 'tabEr'), mermaidEr.status === 'ready' ? mermaidEr.source : '', 'ER 图（源码 imports/实体聚合或扫描）')
        default: return () => explainData(ui(language, 'tabCatalog'), graph.nodes.map(node => ({ path: node.group === '' ? `src/${node.short}` : `src/${node.group}/${node.short}`, duty: node.blurb })), '包目录（扫描 + README/description）')
      }
    })()
    // Dependency/ER tabs default to the core-flow subgraph (LLM-picked core
    // packages with rule-derived source-import edges); the full mermaid
    // diagram is one toggle away and stays cached.
    const renderGraphTab = (kind: 'deps' | 'er'): React.ReactNode => {
      const view = kind === 'deps' ? depsView : erView
      const setView = kind === 'deps' ? setDepsView : setErView
      const state = kind === 'deps' ? mermaidDeps : mermaidEr
      const core = kind === 'deps' ? coreDeps : coreEr
      const title = ui(language, kind === 'deps' ? 'tabDeps' : 'tabEr')
      const full = state.status === 'ready'
        ? h(MermaidView, {
            key: `${kind}-${mermaidToken}`,
            source: state.source,
            onSelectNode: label => selectNodeByLabel(label),
          })
        : h('div', { className: css.loading },
            state.status === 'error' ? uiT(language, 'failLoad', { t: title, msg: state.message })
              : state.status === 'indexing' ? ui(language, 'indexingCopy')
                : uiT(language, 'generating', { t: title }),
            state.status === 'error'
              ? h('div', { className: css.section },
                  h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => fetchMermaid(kind) }, ui(language, 'retry')))
              : null)
      const overview = core.status === 'ready'
        ? h('div', { className: css.flowWrap },
            h('div', { className: css.flowMeta },
              h('span', { className: css.badge }, core.core.source === 'flow' ? ui(language, 'coreBadgeFlow') : ui(language, 'coreBadgeCurated')),
              h('span', { className: css.flowTitle }, ui(language, 'viewOverview')),
              core.core.ref !== undefined ? h('code', { className: css.flowRef }, core.core.ref) : null,
            ),
            h(MermaidView, { key: `core-${kind}-${mermaidToken}`, source: core.source, onSelectNode: label => selectNodeByLabel(label) }),
          )
        // Core not ready yet: fall back to the group tree (keeps the tab useful).
        : h(ConceptGraph, {
            graph,
            conceptTree: groupTree,
            expanded: groupExpanded,
            selectedId: selection !== null && selection.kind === 'pkg' ? selection.id : null,
            onToggle: toggleGroup,
            onSelectPkg: id => setSelection({ kind: 'pkg', id }),
          })
      return h('div', { className: css.graphWrap },
        h('div', { className: css.viewSwitch },
          h('button', { className: `${css.btn} ${view === 'overview' ? css.btnPrimary : ''}`, onClick: () => setView('overview') }, ui(language, 'viewOverview')),
          h('button', { className: `${css.btn} ${view === 'full' ? css.btnPrimary : ''}`, onClick: () => setView('full') }, ui(language, 'viewFull')),
        ),
        view === 'overview'
          ? overview
          : full,
      )
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
          }),
      seq: sequenceState === null
        ? noData
        : h('div', { className: css.flowWrap },
            h('div', { className: css.flowMeta },
              h('span', { className: css.badge },
                sequenceState.source === 'code' ? ui(language, 'seqCodeBadge')
                  : sequenceState.source === 'doc' ? ui(language, 'seqDocBadge')
                  : ui(language, 'seqAIBadge')),
              sequenceState.ref !== undefined
                ? h('span', { className: css.flowTitle }, sequenceState.ref)
                : null),
            h(SequenceGraph, { result: sequenceState })),
      flow: flowState === null
        ? h('div', { className: css.loading }, ui(language, 'loadingFlow'))
        : h('div', { className: css.flowWrap },
            h('div', { className: css.flowMeta },
              h('span', { className: css.badge }, flowState.source === 'doc' ? ui(language, 'flowDocBadge') : ui(language, 'flowAIBadge')),
              h('span', { className: css.flowTitle }, flowState.title),
              flowState.ref !== undefined ? h('code', { className: css.flowRef }, flowState.ref) : null,
            ),
            h(MermaidView, { key: `flow-${mermaidToken}`, source: flowState.mermaid }),
          ),
      interaction: eventsState === null
        ? noData
        : h(InteractionGraph, { events: eventsState, onSelectEvent: id => setSelection({ kind: 'event', id }) }),
      deps: renderGraphTab('deps'),
      er: renderGraphTab('er'),
      catalog: h(Catalog, {
        graph,
        onSelectPkg: id => setSelection({ kind: 'pkg', id }),
        language,
        ...(summaries === undefined || summaries === null ? {} : { summaries }),
      }),
    }
    body = h('div', { className: css.pane },
      h('div', { className: css.tip },
        h('span', null, activeTip),
        h('span', { className: css.spacer }),
        h('button', { className: css.btn, onClick: aiGenerate, disabled: aiGenRunning },
          aiGenRunning ? ui(language, 'aiGenWorking') : ui(language, 'btnAiGen')),
        h('button', { className: css.btn, onClick: refreshTab }, ui(language, 'btnRefresh')),
        h('button', { className: css.btn, onClick: explain }, tab === 'catalog' ? ui(language, 'btnExplainCatalog') : ui(language, 'btnExplainGraph')),
      ),
      h('div', { className: css.body },
        tabOrder.map(unit => h('div', {
          key: unit.id,
          className: css.unitPane,
          style: { display: tab === unit.id ? 'flex' : 'none' },
        }, unitBodies[unit.id]))),
      h(NotesPanel, { notes, language }),
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
        dutyText(detailNode, language) !== '' ? h('p', { className: css.blurb }, dutyText(detailNode, language)) : null,
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
    overlay,
  )
}
