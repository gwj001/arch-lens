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
import { Catalog } from './catalog.tsx'
import { InsightsPanel } from './insights-panel.tsx'
import { NotesPanel } from './notes-panel.tsx'
import { PromptEditor } from './prompt-editor.tsx'
import {
  componentQuestion,
  dataQuestion,
  DEFAULT_EXPLAIN_STYLE,
  DEFAULT_OVERVIEW_PROMPT,
  eventQuestion,
  overviewQuestion,
} from './explain.ts'
import { CONCEPT_TREE, CORE_EVENTS, SEQUENCE } from './curated.ts'
import type { ConceptNode } from './curated.ts'
import { buildGroupTree, ConceptGraph, InteractionGraph, SequenceGraph } from './graphs.tsx'
import { MermaidView } from './mermaid-view.tsx'
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
  const explainStyle = promptConfig.explainStyle ?? config.explainStyle ?? DEFAULT_EXPLAIN_STYLE
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
  const [depsView, setDepsView] = useState<'overview' | 'full'>('overview')
  const [erView, setErView] = useState<'overview' | 'full'>('overview')
  const [groupExpanded, setGroupExpanded] = useState<string[]>(['g:core', 'g:api', 'g:typert'])
  const [insights, setInsights] = useState<ArchLensCodeInsight[] | null>(null)
  const [codeFirst, setCodeFirst] = useState(false)
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
      setNotice('请先在面板顶部选择目标会话')
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
      setNotice(`讲解请求失败：${reason instanceof Error ? reason.message : String(reason)}`)
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
        setNotice('讲解请求未能送达，已跳过')
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
    submitQuestion(componentQuestion(node.short, node.group, node.blurb, files, explainStyle), `组件 ${node.short}`)
  }

  const explainEvent = (eventName: string): void => {
    const event = CORE_EVENTS.find(candidate => candidate.event === eventName)
    if (event === undefined) return
    submitQuestion(
      eventQuestion(event.event, event.mode, event.producers, event.consumers, event.note, explainStyle),
      `事件 ${event.event}`,
    )
  }

  const explainData = (title: string, data: unknown): void => {
    submitQuestion(dataQuestion(title, data, explainStyle), `图 ${title}`)
  }

  const explainAll = (): void => {
    if (graph === null) return
    submitQuestion(overviewQuestion(graph, promptConfig.overviewPrompt ?? config.overviewPrompt ?? DEFAULT_OVERVIEW_PROMPT), '整体架构')
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

  /** Fetch (or refetch) a mermaid diagram; retry-safe. */
  const fetchMermaid = (kind: 'deps' | 'er'): void => {
    if (kind === 'deps') {
      setMermaidDeps({ status: 'loading' })
      void unwrapRemote(archLens.mermaidDeps()).then(result => {
        if ('error' in result) setMermaidDeps({ status: 'error', message: result.error })
        else {
          cachedMermaidDeps = result.source
          setMermaidDeps({ status: 'ready', source: result.source })
        }
      }).catch((reason: unknown) => {
        setMermaidDeps({ status: 'error', message: String(reason) })
      })
    } else {
      setMermaidEr({ status: 'loading' })
      void unwrapRemote(archLens.mermaidEr()).then(result => {
        if ('error' in result) setMermaidEr({ status: 'error', message: result.error })
        else {
          cachedMermaidEr = result.source
          setMermaidEr({ status: 'ready', source: result.source })
        }
      }).catch((reason: unknown) => {
        setMermaidEr({ status: 'error', message: String(reason) })
      })
    }
  }

  /** Lazily fetch a mermaid diagram the first time its tab is opened. */
  const loadMermaid = (kind: 'deps' | 'er'): void => {
    const state = kind === 'deps' ? mermaidDeps : mermaidEr
    if (state.status === 'idle') fetchMermaid(kind)
  }

  const selectTab = (id: string): void => {
    setTab(id)
    if (id === 'deps' || id === 'er') loadMermaid(id)
  }

  /** Explain one concept-tree node (not a package) in the chat. */
  const explainConcept = (node: ConceptNode): void => {
    submitQuestion(
      `请讲解架构概念「${node.name}」：${node.desc}${node.inside !== undefined ? `\n内部机制：${node.inside}` : ''}\n\n${explainStyle}`,
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
    { id: 'concepts', label: '概念层级图' },
    { id: 'seq', label: '时序图' },
    { id: 'interaction', label: '核心交互图' },
    { id: 'deps', label: '依赖图' },
    { id: 'er', label: 'ER 图' },
    { id: 'catalog', label: '包目录' },
  ]

  const header = h('div', { className: css.header },
    h('span', { className: css.title }, '🧭 架构学习台'),
    tabOrder.map(unit => h('button', {
      key: unit.id,
      className: `${css.tab} ${tab === unit.id ? css.tabActive : ''}`,
      onClick: () => selectTab(unit.id),
    }, unit.label)),
    h('span', { className: css.spacer }),
    h('button', { className: `${css.btn} ${codeFirst ? css.btnPrimary : ''}`, onClick: () => setCodeFirst(value => !value) }, '🔍 代码解析'),
    h('button', { className: css.btn, onClick: explainAll }, '💡 全貌预讲解'),
    h('button', { className: css.btn, onClick: () => setEditorOpen(true) }, '✏️ 提示词'),
    h('button', { className: css.btn, onClick: refresh }, '↻ 重新扫描'),
  )

  let body: React.ReactNode
  if (error !== null) {
    body = h('div', { className: css.error },
      h('div', null, `加载失败：${error}`),
      h('div', { className: css.section },
        h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => loadGraph() }, '↻ 重试'),
      ),
    )
  } else if (graph === null) {
    body = h('div', { className: css.loading }, '正在扫描 packages/*/* …')
  } else {
    const activeTip = ((): string => {
      switch (tab) {
        case 'concepts': return '概念层级图：点击概念节点展开/收起，点击包节点查看详情'
        case 'seq': return '时序图：一次完整 turn 的消息流（策展数据）'
        case 'interaction': return '核心交互图：生产者 → 事件 → 消费者，点击事件节点查看详情'
        case 'deps': return '依赖图（Mermaid）：包间 peerDependencies 关系'
        case 'er': return 'ER 图（Mermaid）：包关系实体视图'
        default: return `包目录 # 职责：${graph.nodes.length} 个包，点击任意一行查看详情并 AI 讲解`
      }
    })()
    const explain = ((): (() => void) => {
      switch (tab) {
        case 'concepts': return () => explainData('概念层级图', CONCEPT_TREE)
        case 'seq': return () => explainData('turn 时序图', SEQUENCE)
        case 'interaction': return () => explainData('核心交互图', CORE_EVENTS)
        case 'deps': return () => explainData('依赖图', mermaidDeps.status === 'ready' ? mermaidDeps.source : '')
        case 'er': return () => explainData('ER 图', mermaidEr.status === 'ready' ? mermaidEr.source : '')
        default: return () => explainData('包目录', graph.nodes.map(node => ({ path: `src/${node.group}/${node.short}`, duty: node.blurb })))
      }
    })()
    // Dependency/ER tabs offer a lightweight group overview by default; the
    // full mermaid diagram is one toggle away and stays cached.
    const renderGraphTab = (kind: 'deps' | 'er'): React.ReactNode => {
      const view = kind === 'deps' ? depsView : erView
      const setView = kind === 'deps' ? setDepsView : setErView
      const state = kind === 'deps' ? mermaidDeps : mermaidEr
      const title = kind === 'deps' ? '依赖图' : 'ER 图'
      const full = state.status === 'ready'
        ? h(MermaidView, {
            key: `${kind}-${mermaidToken}`,
            source: state.source,
            onSelectNode: label => selectNodeByLabel(label),
          })
        : h('div', { className: css.loading },
            state.status === 'error' ? `${title}加载失败：${state.message}` : `生成${title}…`,
            state.status === 'error'
              ? h('div', { className: css.section },
                  h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => fetchMermaid(kind) }, '↻ 重试'))
              : null)
      return h('div', { className: css.graphWrap },
        h('div', { className: css.viewSwitch },
          h('button', { className: `${css.btn} ${view === 'overview' ? css.btnPrimary : ''}`, onClick: () => setView('overview') }, '组概要'),
          h('button', { className: `${css.btn} ${view === 'full' ? css.btnPrimary : ''}`, onClick: () => setView('full') }, '全量图'),
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
        conceptTree: CONCEPT_TREE,
        expanded,
        selectedId: selection !== null && selection.kind === 'pkg' ? selection.id : null,
        onToggle: toggleExpand,
        onSelectPkg: id => setSelection({ kind: 'pkg', id }),
        onExplainConcept: explainConcept,
      }),
      seq: h(SequenceGraph, { sequence: SEQUENCE }),
      interaction: h(InteractionGraph, { events: CORE_EVENTS, onSelectEvent: id => setSelection({ kind: 'event', id }) }),
      deps: renderGraphTab('deps'),
      er: renderGraphTab('er'),
      catalog: h(Catalog, { graph, onSelectPkg: id => setSelection({ kind: 'pkg', id }) }),
    }
    body = h('div', { className: css.pane },
      h('div', { className: css.tip },
        h('span', null, activeTip),
        h('span', { className: css.spacer }),
        h('button', { className: css.btn, onClick: refreshTab }, '↻ 刷新此图'),
        h('button', { className: css.btn, onClick: explain }, `🤖 讲解此${tab === 'catalog' ? '目录' : '图'}`),
      ),
      h('div', { className: css.body },
        tabOrder.map(unit => h('div', {
          key: unit.id,
          className: css.unitPane,
          style: { display: tab === unit.id ? 'flex' : 'none' },
        }, unitBodies[unit.id]))),
      h(NotesPanel, { notes }),
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
      panelBody = h('div', { className: css.error }, '详情读取失败')
    } else {
      panelBody = h('div', null,
        detail.blurb !== '' ? h('p', { className: css.blurb }, detail.blurb) : null,
        h('div', { className: css.section },
          h('div', { className: css.sectionTitle }, '核心文件索引'),
          h('ul', { className: css.files }, detail.files.map(file =>
            h('li', { key: file.name },
              h('code', null, file.name),
              file.role !== '' ? h('span', { className: css.role }, file.role) : null,
            )))),
        h('div', { className: css.section },
          h('div', { className: css.sectionTitle },
            `依赖 → ${detail.deps.length > 0 ? detail.deps.join(', ') : '（无）'} ｜ 被依赖 ← ${detail.dependents.length > 0 ? detail.dependents.join(', ') : '（无）'}`)),
        detail.keyLines.length > 0
          ? h('div', { className: css.section },
              h('div', { className: css.sectionTitle }, '关键注册点（浓缩）'),
              h('pre', { className: css.code }, detail.keyLines.join('\n')))
          : null,
        detail.snippet !== ''
          ? h('div', { className: css.section },
              h('div', { className: css.sectionTitle }, '入口代码（浓缩）'),
              h('pre', { className: `${css.code} ${css.codeScroll}` }, detail.snippet))
          : null,
        h('div', { className: css.section },
          h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => explainPkg(detailNode) }, '🤖 AI 讲解此组件'),
          h('div', { className: css.followup },
            h('input', {
              className: css.input,
              placeholder: '针对此组件的追问，回复显示在下方',
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
            }, '发送'),
          )),
        notice !== null ? h('div', { className: css.notice }, notice) : null,
        codeFirst
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
    const event = CORE_EVENTS.find(candidate => candidate.event === selection.id)
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
            h('div', { className: css.sectionTitle }, `生产者 → ${event.producers.join(', ')}`),
            h('div', { className: css.sectionTitle }, `消费者 ← ${event.consumers.join(', ')}`),
          ),
          h('div', { className: css.section },
            h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => explainEvent(event.event) }, '🤖 AI 讲解此事件'),
            h('div', { className: css.followup },
              h('input', {
                className: css.input,
                placeholder: '追问',
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
              }, '发送'),
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
          onSave: next => { setPromptConfig(next); setEditorOpen(false) },
          onClose: () => setEditorOpen(false),
        })
      : null,
    overlay,
  )
}
