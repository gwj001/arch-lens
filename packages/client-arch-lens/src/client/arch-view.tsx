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
import type { ArchLensCodeInsight, ArchLensGraph, ArchLensNotesResult, ArchLensPromptConfig } from '@deepseek-ai/dsh-arch-lens-backend'
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
  DEFAULT_OVERVIEW_PROMPT,
  defaultOverview,
  defaultStyle,
  eventQuestion,
  languageClause,
  overviewQuestion,
  useDefaultsConfig,
} from './explain.ts'
import { CONCEPT_TREE, CONCEPT_TREE_EN, CORE_EVENTS, CORE_EVENTS_EN, SEQUENCE, SEQUENCE_EN } from './curated.ts'
import type { ConceptNode } from './curated.ts'
import { buildGroupTree, ConceptGraph, InteractionGraph, SequenceGraph } from './graphs.tsx'
import { MermaidView } from './mermaid-view.tsx'
import { ui, uiT } from './i18n.ts'
import type { ArchLensRemote } from './remote.ts'
import { unwrapRemote } from './remote.ts'
import css from './arch-view.module.css'

/** Configured prompts and unit order (defaults live here until Config arrives). */
export interface ArchViewConfig {
  units?: string[]
  overviewPrompt?: string
  explainStyle?: string
}

// Module-level data cache: closing the robot panel unmounts the desk, but the
// scan data and diagram sources should not be refetched automatically — only
// the explicit refresh buttons invalidate them.
let cachedGraph: ArchLensGraph | null = null
let cachedMermaidDeps: string | null = null
let cachedMermaidEr: string | null = null
// AI duty summaries per role language (the backend also caches per workspace).
let cachedDutySummaries = new Map<string, Record<string, string> | null>()

/** One selectable popup target. */
type Selection =
  | { kind: 'pkg'; id: string }
  | { kind: 'event'; id: string }

/** Load state of a lazily fetched mermaid diagram (deps / ER tabs). */
type MermaidState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; source: string }
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
  const { archLens, config } = props
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
  // Curated figure data follows the role language (zh mirror vs en mirror).
  const conceptTree = language === 'English' ? CONCEPT_TREE_EN : CONCEPT_TREE
  const sequence = language === 'English' ? SEQUENCE_EN : SEQUENCE
  const coreEvents = language === 'English' ? CORE_EVENTS_EN : CORE_EVENTS
  const [tab, setTab] = useState('concepts')
  const [graph, setGraph] = useState<ArchLensGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [followup, setFollowup] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string[]>(['cordis', 'core', 'sandbox'])
  const [notes, setNotes] = useState<ArchLensNotesResult | { error: string } | null>(null)
  const [mermaidDeps, setMermaidDeps] = useState<MermaidState>({ status: 'idle' })
  const [mermaidEr, setMermaidEr] = useState<MermaidState>({ status: 'idle' })
  const [mermaidToken, setMermaidToken] = useState(0)
  const [summaries, setSummaries] = useState<Record<string, string> | null | undefined>(undefined)
  const [depsView, setDepsView] = useState<'overview' | 'full'>('overview')
  const [erView, setErView] = useState<'overview' | 'full'>('overview')
  const [groupExpanded, setGroupExpanded] = useState<string[]>(['g:core', 'g:api', 'g:typert'])
  const [progressRunning, setProgressRunning] = useState(false)
  const [progressGenerated, setProgressGenerated] = useState(false)
  const [insights, setInsights] = useState<ArchLensCodeInsight[] | null>(null)
  const retryTimer = useRef<number | null>(null)
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
  const loadGraph = (attempt = 0): void => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
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
      cachedGraph = result
      setGraph(result)
    }).catch((reason: unknown) => {
      if (attempt < 2) {
        retryTimer.current = window.setTimeout(() => loadGraph(attempt + 1), 1500 * (attempt + 1))
        return
      }
      setError(String(reason))
    })
  }

  useEffect(() => {
    // Remounts reuse the module cache instead of refetching; only the
    // explicit refresh buttons invalidate it.
    if (cachedGraph !== null) {
      setGraph(cachedGraph)
      if (cachedMermaidDeps !== null) setMermaidDeps({ status: 'ready', source: cachedMermaidDeps })
      if (cachedMermaidEr !== null) setMermaidEr({ status: 'ready', source: cachedMermaidEr })
    } else {
      loadGraph()
    }
    void unwrapRemote(archLens.notes()).then(result => { setNotes(result) }).catch(() => {})
    void unwrapRemote(archLens.promptConfig()).then(result => {
      setPromptConfig(result.config)
    }).catch(() => {})
    void unwrapRemote(archLens.analyze()).then(result => {
      if (!('error' in result)) setInsights(result)
    }).catch(() => {})
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
      if (pumpTimerRef.current !== null) window.clearTimeout(pumpTimerRef.current)
    }
  }, [archLens])

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
    void props.send(next.text).then(() => {
      void unwrapRemote(archLens.notePending({
        target: next.target,
        text: next.text,
        ...(props.sessionId === null ? {} : { sessionId: props.sessionId }),
      })).catch(() => {})
    }).catch((reason: unknown) => {
      // Transport/business failure: surface it, unlock immediately, and move
      // on to the next queued request instead of waiting for the turn.
      console.error('[arch-lens] explain send failed:', reason)
      setNotice(uiT(language, 'sendFailedNotice', { msg: reason instanceof Error ? reason.message : String(reason) }))
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
    submitQuestion(componentQuestion(node.short, node.group, blurb, files, explainStyle, language, insight), `组件 ${node.short}`)
  }

  const explainEvent = (eventName: string): void => {
    const event = coreEvents.find(candidate => candidate.event === eventName)
    if (event === undefined) return
    submitQuestion(
      eventQuestion(event.event, event.mode, event.producers, event.consumers, event.note, explainStyle, language),
      `事件 ${event.event}`,
    )
  }

  const explainData = (title: string, data: unknown): void => {
    submitQuestion(dataQuestion(title, data, explainStyle, language), `图 ${title}`)
  }

  const explainAll = (): void => {
    if (graph === null) return
    submitQuestion(overviewQuestion(graph, overviewPrompt, language), '整体架构')
  }

  const refresh = (): void => {
    cachedGraph = null
    setGraph(null)
    setError(null)
    void unwrapRemote(archLens.refresh()).then(result => {
      if ('error' in result) setError(result.error)
      else {
        cachedGraph = result
        setGraph(result)
      }
    }).catch((reason: unknown) => setError(String(reason)))
  }

  /** Fetch (or refetch) a mermaid diagram; prefers the code-index source. */
  const fetchMermaid = (kind: 'deps' | 'er'): void => {
    const indexedKind = kind === 'deps' ? 'flowchart' : 'erDiagram'
    const setState = kind === 'deps' ? setMermaidDeps : setMermaidEr
    setState({ status: 'loading' })
    void unwrapRemote(archLens.mermaidIndexed({ kind: indexedKind })).then(result => {
      if ('error' in result) {
        // Fall back to the scanned-graph (peerDeps) source.
        console.warn(`[arch-lens] indexed mermaid unavailable (${result.error}); falling back to scan graph`)
        const applyFallback = (fallback: { source: string } | { error: string }): void => {
          if ('error' in fallback) setState({ status: 'error', message: fallback.error })
          else {
            if (kind === 'deps') cachedMermaidDeps = fallback.source
            else cachedMermaidEr = fallback.source
            setState({ status: 'ready', source: fallback.source })
          }
        }
        if (kind === 'deps') {
          return unwrapRemote(archLens.mermaidDeps()).then(applyFallback)
        }
        return unwrapRemote(archLens.mermaidEr()).then(applyFallback)
      }
      if (kind === 'deps') cachedMermaidDeps = result.source
      else cachedMermaidEr = result.source
      setState({ status: 'ready', source: result.source })
    }).catch((reason: unknown) => {
      setState({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    })
  }

  /** Lazily fetch a mermaid diagram the first time its tab is opened. */
  const loadMermaid = (kind: 'deps' | 'er'): void => {
    const state = kind === 'deps' ? mermaidDeps : mermaidEr
    if (state.status === 'idle') fetchMermaid(kind)
  }

  const selectTab = (id: string): void => {
    setTab(id)
    if (id === 'deps' || id === 'er') loadMermaid(id)
    if (id === 'catalog') loadSummaries()
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

  // AI duty summaries for the catalog, cached per role language. Only SUCCESS
  // results are cached: a failure stays uncached so the next catalog visit
  // retries instead of silently showing stale raw text forever. The backend
  // generates at most two batches per call (30s RPC budget), so a partial
  // result re-invokes to fill the rest.
  const loadSummaries = (attempt = 0): void => {
    const cached = cachedDutySummaries.get(language)
    if (cached !== undefined && cached !== null && Object.keys(cached).length >= (graph?.nodes.length ?? 0)) {
      setSummaries(cached)
      return
    }
    console.log(`[arch-lens] loadSummaries: requesting (lang=${language}, attempt=${attempt})`)
    setSummaries(cached ?? null)
    void unwrapRemote(archLens.summarizeDuties({ language })).then(result => {
      if ('error' in result) {
        console.warn('[arch-lens] loadSummaries failed:', result.error)
        setSummaries(null)
        setNotice(uiT(language, 'summarizeFailedNotice', { msg: result.error }))
      } else {
        console.log(`[arch-lens] loadSummaries: got ${Object.keys(result).length} summaries`)
        cachedDutySummaries.set(language, result)
        setSummaries(result)
        // Partial fill: the backend caps batches per call; keep pulling until
        // every package has a summary or the cap is reached.
        if (graph !== null && Object.keys(result).length < graph.nodes.length && attempt < 5) {
          window.setTimeout(() => loadSummaries(attempt + 1), 1500)
        }
      }
    }).catch((reason: unknown) => {
      console.warn('[arch-lens] loadSummaries request failed:', reason)
      setSummaries(null)
      setNotice(uiT(language, 'summarizeReqFailedNotice', { msg: String(reason) }))
    })
  }

  // Language switch resets to the cached summaries for that language.
  useEffect(() => {
    const cached = cachedDutySummaries.get(language)
    if (cached !== undefined) setSummaries(cached)
    else setSummaries(undefined)
  }, [language])

  /** Explain one concept-tree node (not a package) in the chat. */
  const explainConcept = (node: ConceptNode): void => {
    const insight = node.pkg === undefined ? undefined : insights?.find(item => item.id === node.pkg)
    submitQuestion(
      `请讲解架构概念「${node.name}」：${node.desc}${node.inside !== undefined ? `\n内部机制：${node.inside}` : ''}\n\n${explainStyle}${codeInsightClause(insight)}${languageClause(language)}`,
      `概念 ${node.name}`,
    )
  }

  /** Refresh the current tab: refetch data and force the graph to re-render. */
  const refreshTab = (): void => {
    if (tab === 'deps' || tab === 'er') {
      fetchMermaid(tab)
      setMermaidToken(value => value + 1)
      return
    }
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
    { id: 'interaction', label: ui(language, 'tabInteraction') },
    { id: 'deps', label: ui(language, 'tabDeps') },
    { id: 'er', label: ui(language, 'tabEr') },
    { id: 'catalog', label: ui(language, 'tabCatalog') },
  ]

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
    h('button', { className: css.btn, onClick: () => setEditorOpen(true) }, ui(language, 'btnPrompts')),
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
        case 'interaction': return ui(language, 'tipInteraction')
        case 'deps': return ui(language, 'tipDeps')
        case 'er': return ui(language, 'tipEr')
        default: return uiT(language, 'tipCatalog', { count: String(graph.nodes.length) })
      }
    })()
    const explain = ((): (() => void) => {
      switch (tab) {
        case 'concepts': return () => explainData(ui(language, 'tabConcepts'), conceptTree)
        case 'seq': return () => explainData(ui(language, 'tabSeq'), sequence)
        case 'interaction': return () => explainData(ui(language, 'tabInteraction'), coreEvents)
        case 'deps': return () => explainData(ui(language, 'tabDeps'), mermaidDeps.status === 'ready' ? mermaidDeps.source : '')
        case 'er': return () => explainData(ui(language, 'tabEr'), mermaidEr.status === 'ready' ? mermaidEr.source : '')
        default: return () => explainData(ui(language, 'tabCatalog'), graph.nodes.map(node => ({ path: `src/${node.group}/${node.short}`, duty: node.blurb })))
      }
    })()
    // Dependency/ER tabs offer a lightweight group overview by default; the
    // full mermaid diagram is one toggle away and stays cached.
    const renderGraphTab = (kind: 'deps' | 'er'): React.ReactNode => {
      const view = kind === 'deps' ? depsView : erView
      const setView = kind === 'deps' ? setDepsView : setErView
      const state = kind === 'deps' ? mermaidDeps : mermaidEr
      const title = ui(language, kind === 'deps' ? 'tabDeps' : 'tabEr')
      const full = state.status === 'ready'
        ? h(MermaidView, {
            key: `${kind}-${mermaidToken}`,
            source: state.source,
            onSelectNode: label => selectNodeByLabel(label),
          })
        : h('div', { className: css.loading },
            state.status === 'error' ? uiT(language, 'failLoad', { t: title, msg: state.message }) : uiT(language, 'generating', { t: title }),
            state.status === 'error'
              ? h('div', { className: css.section },
                  h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => fetchMermaid(kind) }, ui(language, 'retry')))
              : null)
      return h('div', { className: css.graphWrap },
        h('div', { className: css.viewSwitch },
          h('button', { className: `${css.btn} ${view === 'overview' ? css.btnPrimary : ''}`, onClick: () => setView('overview') }, ui(language, 'viewOverview')),
          h('button', { className: `${css.btn} ${view === 'full' ? css.btnPrimary : ''}`, onClick: () => setView('full') }, ui(language, 'viewFull')),
        ),
        view === 'overview'
          ? h(ConceptGraph, {
              graph,
              conceptTree: groupTree,
              expanded: groupExpanded,
              selectedId: selection !== null && selection.kind === 'pkg' ? selection.id : null,
              onToggle: toggleGroup,
              onSelectPkg: id => setSelection({ kind: 'pkg', id }),
            })
          : full,
      )
    }

    // Every unit body stays mounted; inactive tabs are hidden, so switching
    // back does not regenerate diagrams (the refresh button refetches).
    const unitBodies: Record<string, React.ReactNode> = {
      concepts: h(ConceptGraph, {
        graph,
        conceptTree,
        expanded,
        selectedId: selection !== null && selection.kind === 'pkg' ? selection.id : null,
        onToggle: toggleExpand,
        onSelectPkg: id => setSelection({ kind: 'pkg', id }),
        onExplainConcept: explainConcept,
      }),
      seq: h(SequenceGraph, { sequence }),
      interaction: h(InteractionGraph, { events: coreEvents, onSelectEvent: id => setSelection({ kind: 'event', id }) }),
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
    const event = coreEvents.find(candidate => candidate.event === selection.id)
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
