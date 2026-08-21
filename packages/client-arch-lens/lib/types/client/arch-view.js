/**
 * Arch Lens study desk: unit tabs over the backend Remote, component/event
 * detail popups, notes summary, and the explain queue. Rendered inside the
 * floating robot panel; questions go through the core conversation pipeline
 * (props.send → session.prompt), so answers appear in the main chat view.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/arch-view
 */
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { Catalog, dutyText } from "./catalog.js";
import { InsightsPanel } from "./insights-panel.js";
import { NotesPanel } from "./notes-panel.js";
import { PromptEditor } from "./prompt-editor.js";
import { codeInsightClause, componentQuestion, coreCandidates, dataQuestion, DEFAULT_EXPLAIN_STYLE, DEFAULT_LANGUAGE, DEFAULT_OVERVIEW_PROMPT, defaultOverview, defaultStyle, eventQuestion, evidenceClause, languageClause, overviewQuestion, useDefaultsConfig, } from "./explain.js";
import { buildGroupTree, ConceptGraph, InteractionGraph, SequenceGraph } from "./graphs.js";
import { MermaidView } from "./mermaid-view.js";
import { ui, uiT } from "./i18n.js";
import { directRemote, unwrapRemote } from "./remote.js";
import css from './arch-view.module.css';
/** Flow-diagram viewpoints selectable on the flow tab (order = UI order). */
const FLOW_ANGLES = ['event', 'pipeline'];
/** localStorage key for the selected flow viewpoint. */
const FLOW_ANGLE_KEY = 'arch-lens-flow-angle';
/** i18n key for one flow angle chip. */
const flowAngleKey = (angle) => angle === 'event' ? 'flowAngleEvent' : 'flowAnglePipeline';
// Module-level cache for the AI duty summaries only, keyed by workspace root
// + role language (the backend keeps its own per-workspace caches for every
// figure, so reopening the desk on the same workspace refetches instantly).
let cachedDutySummaries = new Map();
/**
 * The Arch Lens study desk entry component.
 */
export function ArchView(props) {
    const { archLens, config, sessionId } = props;
    const [conceptTreeState, setConceptTreeState] = useState(null);
    // Two sequence views over one tab: 'code' = static call graph (code
    // facts), 'flow' = project-core main-flow sequence (doc verbatim or AI
    // induction). Both are fetched eagerly so switching views is instant.
    const [sequenceCodeState, setSequenceCodeState] = useState(null);
    const [sequenceFlowState, setSequenceFlowState] = useState(null);
    const [seqView, setSeqView] = useState('code');
    const [eventsState, setEventsState] = useState(null);
    // Flow diagrams per viewpoint — BOTH are fetched together (the backend
    // generates them in one LLM call), so switching the angle chip is instant
    // and never costs another model call.
    const [flowMap, setFlowMap] = useState({});
    // Selected viewpoint, persisted so reopening the page keeps the last choice
    // (and never re-requests a different angle).
    const [flowAngle, setFlowAngle] = useState(() => {
        try {
            return window.localStorage.getItem(FLOW_ANGLE_KEY) === 'pipeline' ? 'pipeline' : 'event';
        }
        catch {
            return 'event';
        }
    });
    const setFlowAnglePersisted = (angle) => {
        setFlowAngle(angle);
        try {
            window.localStorage.setItem(FLOW_ANGLE_KEY, angle);
        }
        catch { /* ignore */ }
    };
    const [promptConfig, setPromptConfig] = useState({});
    const [editorOpen, setEditorOpen] = useState(false);
    const language = promptConfig.language ?? DEFAULT_LANGUAGE;
    // Effective prompt: default templates follow the role language; saved
    // overrides (or deployment Config) win in "my prompts" mode.
    const useDefaults = useDefaultsConfig(promptConfig);
    const explainStyle = useDefaults
        ? (config.explainStyle ?? defaultStyle(language))
        : (promptConfig.explainStyle ?? config.explainStyle ?? DEFAULT_EXPLAIN_STYLE);
    const overviewPrompt = useDefaults
        ? (config.overviewPrompt ?? defaultOverview(language))
        : (promptConfig.overviewPrompt ?? config.overviewPrompt ?? DEFAULT_OVERVIEW_PROMPT);
    // Figure data is derived from the workspace's own facts: concepts from the
    // architecture-doc chain, sequences from the static call graph (code view)
    // or the doc/AI core-flow chain (flow view), events from LLM structured
    // caches. No curated fallback: a null state renders an empty prompt to run
    // AI generate.
    const conceptTree = conceptTreeState;
    const coreEvents = eventsState;
    const [tab, setTab] = useState('concepts');
    const [graph, setGraph] = useState(null);
    const [error, setError] = useState(null);
    const [selection, setSelection] = useState(null);
    const [followup, setFollowup] = useState('');
    const [notice, setNotice] = useState(null);
    // The last explanation's thinking chain (model reasoning), shown in a
    // collapsible box under the tip row; empty reasoning hides the box.
    const [thinking, setThinking] = useState(null);
    const [thinkingOpen, setThinkingOpen] = useState(false);
    const [expanded, setExpanded] = useState([]);
    const [notes, setNotes] = useState(null);
    const [coreDeps, setCoreDeps] = useState({ status: 'idle' });
    const [coreEr, setCoreEr] = useState({ status: 'idle' });
    const [mermaidToken, setMermaidToken] = useState(0);
    const [summaries, setSummaries] = useState(undefined);
    const [groupExpanded, setGroupExpanded] = useState([]);
    const [progressRunning, setProgressRunning] = useState(false);
    const [progressGenerated, setProgressGenerated] = useState(false);
    const [insights, setInsights] = useState(null);
    const [aiGenRunning, setAiGenRunning] = useState(false);
    const [llmStats, setLlmStats] = useState(null);
    const [llmStatsOpen, setLlmStatsOpen] = useState(false);
    const retryTimer = useRef(null);
    // The workspace root the loaded figures belong to (the desk-info identity
    // resolved by setSession). Figure fetches capture the generation and drop
    // results that arrive after a workspace switch or language change.
    const workspaceKeyRef = useRef(null);
    const generationRef = useRef(0);
    // Set by「⏹ 终止」: generation handlers check it first and drop their
    // pending responses (so a late error never overwrites the stop notice).
    const stopRef = useRef(false);
    const mountedRef = useRef(false);
    // Explain queue: at most one explain turn runs at a time. Requests are
    // queued, not rejected — when the session turn ends (running flips false
    // after a submit), the next queued request is submitted automatically.
    const explainQueueRef = useRef([]);
    const explainingRef = useRef(false);
    const sawRunningRef = useRef(false);
    const pumpTimerRef = useRef(null);
    // Graph load with bounded auto-retry: right after a page load the session
    // channel may not be established yet, and the first remote call fails with
    // "Failed to fetch". Back off a few seconds instead of showing an error.
    // Results from a superseded workspace or language are dropped. The graph
    // result carries the workspace root (the desk-info identity): a root
    // different from the current one means the data source moved to another
    // workspace, so the previous workspace's figures are dropped and re-pulled.
    const loadGraph = (attempt = 0) => {
        if (retryTimer.current !== null) {
            window.clearTimeout(retryTimer.current);
            retryTimer.current = null;
        }
        const generation = generationRef.current;
        setError(null);
        void unwrapRemote(archLens.graph()).then(result => {
            if ('error' in result) {
                if (attempt < 2) {
                    retryTimer.current = window.setTimeout(() => loadGraph(attempt + 1), 1500 * (attempt + 1));
                    return;
                }
                setError(result.error);
                return;
            }
            if (generation !== generationRef.current)
                return;
            const root = result.root ?? null;
            if (root !== workspaceKeyRef.current) {
                workspaceKeyRef.current = root;
                clearFigures();
                loadAllFigures();
                return;
            }
            setGraph(result);
        }).catch((reason) => {
            if (attempt < 2) {
                retryTimer.current = window.setTimeout(() => loadGraph(attempt + 1), 1500 * (attempt + 1));
                return;
            }
            setError(String(reason));
        });
    };
    /** Drop every figure state and invalidate in-flight fetches (the module caches stay). */
    const clearFigures = () => {
        generationRef.current += 1;
        setGraph(null);
        setError(null);
        setConceptTreeState(null);
        setSequenceCodeState(null);
        setSequenceFlowState(null);
        setEventsState(null);
        setFlowMap({});
        setCoreDeps({ status: 'idle' });
        setCoreEr({ status: 'idle' });
        setInsights(null);
        setSummaries(undefined);
    };
    /** Fetch both sequence views for one generation (code call graph + main-flow sequence). */
    const loadSequences = (generation) => {
        void unwrapRemote(archLens.sequence({ language })).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && !('error' in data))
                setSequenceCodeState(data);
        }).catch(() => { });
        void unwrapRemote(archLens.sequence({ language, prefer: 'flow' })).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && !('error' in data))
                setSequenceFlowState(data);
        }).catch(() => { });
    };
    /** Re-pull EVERY figure for the current workspace root, no backend invalidation. */
    const loadAllFigures = () => {
        const generation = generationRef.current;
        // Each stage is fire-and-forget: a single stale-remote failure must never
        // block the rest of the load chain (graphs must still render).
        try {
            loadMetadata();
        }
        catch { /* metadata is non-critical */ }
        try {
            loadGraph();
        }
        catch { /* retried by the error UI */ }
        void unwrapRemote(archLens.conceptTree({ language })).then(tree => {
            if (generation !== generationRef.current)
                return;
            if (!('error' in tree))
                setConceptTreeState(tree);
        }).catch(() => { });
        loadSequences(generation);
        void unwrapRemote(archLens.events({ language })).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && !('error' in data))
                setEventsState(data);
        }).catch(() => { });
        // Both flow viewpoints are served from the backend's shared profile
        // (generated together in one LLM call), so fetching both is free.
        ensureFlow(generation);
        if (tab === 'deps' || tab === 'er') {
            // deps/ER show only the core subgraph now (no full views).
            fetchCore(tab);
        }
    };
    /**
     * Lazy figure loaders: each AI-derived unit (concepts / seq / flow /
     * events) is fetched on first view and after a rescan clears its state.
     * This keeps a rescan purely factual — no figure is auto-generated unless
     * the user actually looks at its tab.
     */
    const ensureConcepts = () => {
        if (conceptTreeState !== null)
            return;
        const generation = generationRef.current;
        void unwrapRemote(archLens.conceptTree({ language })).then(tree => {
            if (generation !== generationRef.current)
                return;
            if (!('error' in tree))
                setConceptTreeState(tree);
        }).catch(() => { });
    };
    const ensureSequences = () => {
        if (sequenceCodeState !== null || sequenceFlowState !== null)
            return;
        loadSequences(generationRef.current);
    };
    /** Fetch both flow viewpoints once (each served from the profile/cache —
     * the backend generates them together, so this never doubles LLM work).
     * Goes through directRemote: the injected flow descriptor lags the host
     * and strips the angle field, which would return the same diagram for
     * both viewpoints.
     * @param generation - the generation guard to validate results against.
     */
    const ensureFlow = (generation = generationRef.current) => {
        for (const angle of FLOW_ANGLES) {
            if (flowMap[angle] !== undefined)
                continue;
            void directRemote('flow', { request: { language, angle } }).then(data => {
                if (generation !== generationRef.current)
                    return;
                if (!('error' in data))
                    setFlowMap(previous => ({ ...previous, [angle]: data }));
            }).catch(() => { });
        }
    };
    const ensureEvents = () => {
        if (eventsState !== null)
            return;
        const generation = generationRef.current;
        void unwrapRemote(archLens.events({ language })).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && !('error' in data))
                setEventsState(data);
        }).catch(() => { });
    };
    /** Load only the ACTIVE tab's figure (used after a rescan; the other tabs
     * load lazily when switched to, so a rescan never generates figures by
     * itself — it rebuilds facts only). */
    const ensureActiveTab = () => {
        if (tab === 'concepts')
            ensureConcepts();
        else if (tab === 'seq')
            ensureSequences();
        else if (tab === 'flow')
            ensureFlow();
        else if (tab === 'interaction')
            ensureEvents();
        else if (tab === 'catalog')
            loadSummaries(0);
        else if (tab === 'deps' || tab === 'er') {
            loadCore(tab);
        }
    };
    /** 估算 token 的显示格式（≥1000 显示为 x.xk）。 */
    const fmtTokens = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    /** 拉取 LLM 用量统计（累计 + 最近记录，落盘 .arch-lens-llm-stats.json）。
     * 防御性隔离：remote 方法在旧运行时缺失时绝不能拖垮主加载链。 */
    const refreshLlmStats = () => {
        try {
            void directRemote('llmStats', {}).then(setLlmStats).catch(() => { });
        }
        catch {
            // llmStats remote unavailable (stale runtime) — statistics stay empty.
        }
    };
    /** Refresh the per-workspace metadata (prompt config, code insights).
     * Notes are lazy (loaded on demand by the notes panel); each item is
     * fire-and-forget so one failure never blocks the rest of the load. */
    const loadMetadata = () => {
        const generation = generationRef.current;
        void unwrapRemote(archLens.promptConfig()).then(result => {
            if (generation === generationRef.current)
                setPromptConfig(result.config);
        }).catch(() => { });
        void unwrapRemote(archLens.analyze()).then(result => {
            if (generation !== generationRef.current)
                return;
            if (!('error' in result))
                setInsights(result);
        }).catch(() => { });
        refreshLlmStats();
    };
    /** Load the notes summary lazily (only when the notes panel asks for it). */
    const loadNotes = () => {
        if (notes !== null)
            return;
        const generation = generationRef.current;
        try {
            void unwrapRemote(archLens.notes()).then(result => {
                if (generation === generationRef.current)
                    setNotes(result);
            }).catch(() => { });
        }
        catch {
            // ignore
        }
    };
    /** 单次调用的显示 token：provider 实际 usage 优先，字符估算兜底。 */
    const recordTokens = (record) => {
        const usage = record.usage;
        if (usage !== undefined) {
            return {
                inText: fmtTokens(usage.inTokens),
                outText: fmtTokens(usage.outTokens),
                actual: true,
                ...(usage.reasoningTokens !== undefined && usage.reasoningTokens > 0 ? { reasoning: fmtTokens(usage.reasoningTokens) } : {}),
            };
        }
        return { inText: fmtTokens(record.estInTokens), outText: fmtTokens(record.estOutTokens), actual: false };
    };
    /** 完成通知 + 最新一次 LLM 调用的 token（实际/估算）与耗时（输入→输出）。 */
    const noticeWithLlm = (base) => {
        setNotice(base);
        try {
            void directRemote('llmStats', {}).then(stats => {
                setLlmStats(stats);
                const last = stats.records[0];
                if (last !== undefined) {
                    const tokens = recordTokens(last);
                    setNotice(`${base}（${tokens.actual ? '实际' : '估算'} ${tokens.inText}→${tokens.outText} tokens${tokens.reasoning !== undefined ? ` +${tokens.reasoning} reasoning` : ''}，耗时 ${(last.ms / 1000).toFixed(1)}s）`);
                }
            }).catch(() => { });
        }
        catch {
            // llmStats remote unavailable — keep the plain completion notice.
        }
    };
    // Load the data source for the current session's workspace, then pull the
    // figures. This is the ONE load path: mount, session switch, and the reload
    // button all land here. The backend setSession is cache-first (never
    // invalidates), and the workspace identity rides the graph result
    // (`graph.root`), so loadGraph decides whether the data source actually
    // moved and re-pulls only when it did.
    useEffect(() => {
        let cancelled = false;
        void unwrapRemote(archLens.setSession(sessionId)).then(() => {
            if (cancelled)
                return;
            loadAllFigures();
        }).catch((reason) => {
            if (cancelled)
                return;
            setNotice(uiT(language, 'sessionSwitchFailed', { msg: reason instanceof Error ? reason.message : String(reason) }));
        });
        return () => { cancelled = true; };
    }, [archLens, sessionId, language]);
    useEffect(() => {
        // Figure loading is owned by the setSession effect on the first mount;
        // this effect only re-pulls when the role language changes.
        if (mountedRef.current) {
            generationRef.current += 1;
            loadAllFigures();
        }
        mountedRef.current = true;
        return () => {
            if (retryTimer.current !== null)
                window.clearTimeout(retryTimer.current);
            if (pumpTimerRef.current !== null)
                window.clearTimeout(pumpTimerRef.current);
        };
    }, [archLens, language]);
    /** Submit one queued explain request; only one runs at a time. */
    const pumpExplainQueue = () => {
        if (explainingRef.current)
            return;
        const next = explainQueueRef.current.shift();
        if (next === undefined)
            return;
        if (props.sessionId === null) {
            setNotice(ui(language, 'noSessionNotice'));
            pumpExplainQueue();
            return;
        }
        explainingRef.current = true;
        sawRunningRef.current = false;
        // Stage the note metadata BEFORE the send: the pending slot must already
        // hold the question while the answer is in flight, so the backend's
        // assistant/message listener can match it. A failed send clears the
        // staged metadata so no later ordinary message gets mis-recorded as an
        // explain.
        void unwrapRemote(archLens.notePending({
            target: next.target,
            text: next.text,
            sessionId: props.sessionId,
        })).catch(() => { });
        void props.send(next.text).catch((reason) => {
            // Transport/business failure: surface it, drop the staged note metadata
            // (notePending with an empty text clears the backend slot), unlock
            // immediately, and move on to the next queued request instead of
            // waiting for the turn.
            console.error('[arch-lens] explain send failed:', reason);
            setNotice(uiT(language, 'sendFailedNotice', { msg: reason instanceof Error ? reason.message : String(reason) }));
            void unwrapRemote(archLens.notePending({
                target: next.target,
                text: '',
                ...(props.sessionId === null ? {} : { sessionId: props.sessionId }),
            })).catch(() => { });
            explainingRef.current = false;
            sawRunningRef.current = false;
            pumpExplainQueue();
        });
        // Safety net: if the turn never starts (submit failed at the transport
        // layer), unlock and continue with the next request instead of stalling.
        if (pumpTimerRef.current !== null)
            window.clearTimeout(pumpTimerRef.current);
        pumpTimerRef.current = window.setTimeout(() => {
            if (explainingRef.current && !sawRunningRef.current) {
                explainingRef.current = false;
                setNotice(ui(language, 'sendSkipNotice'));
                pumpExplainQueue();
            }
        }, 20000);
    };
    // Turn completion unlocks the queue: after a submit, wait for running to
    // flip true (turn started) and then false (turn finished) before the next.
    const running = props.useSessions(state => props.sessionId === null ? false : (state.byId[props.sessionId]?.running ?? false));
    useEffect(() => {
        if (running)
            sawRunningRef.current = true;
        if (!running && explainingRef.current && sawRunningRef.current) {
            explainingRef.current = false;
            sawRunningRef.current = false;
            pumpExplainQueue();
            // The finished explanation's thinking chain (reasoning blocks live in
            // the session message; the backend projects them out for the panel).
            if (props.sessionId !== null) {
                try {
                    void directRemote('lastAnswer', { request: { sessionId: props.sessionId } }).then(result => {
                        if ('error' in result)
                            return;
                        if (result.reasoning.trim() !== '') {
                            setThinking(result);
                            setThinkingOpen(true);
                        }
                        else {
                            setThinking(result);
                        }
                    }).catch(() => { });
                }
                catch {
                    // lastAnswer remote unavailable (stale runtime) — no thinking box.
                }
            }
        }
    }, [running]);
    const submitQuestion = (text, target) => {
        explainQueueRef.current.push({ text, target });
        pumpExplainQueue();
    };
    const explainPkg = (node) => {
        const files = node.detail.files.map(file => file.name);
        const blurb = language === DEFAULT_LANGUAGE ? (node.blurbZh ?? node.blurb) : node.blurb;
        const insight = insights?.find(item => item.id === node.id);
        const snippet = node.detail.snippet === '' ? '' : `\n\n【入口源码（浓缩，${node.detail.snippet.split('\n').length} 行）】\n${node.detail.snippet}`;
        const evidence = [
            { label: '组件职责（本地化）', ref: 'package.json description / README.md', text: blurb },
            { label: '核心文件索引', ref: '工作区扫描 packages/*/*/src', text: files.join(', ') },
        ];
        if (insight !== undefined && (insight.provides.length > 0 || insight.listens.length > 0 || insight.remotes.length > 0 || insight.tools.length > 0)) {
            const parts = [
                ...(insight.provides.length > 0 ? [`提供服务：${insight.provides.join(', ')}`] : []),
                ...(insight.listens.length > 0 ? [`监听事件：${insight.listens.join(', ')}`] : []),
                ...(insight.remotes.length > 0 ? [`Remote 方法：${insight.remotes.join(', ')}`] : []),
                ...(insight.tools.length > 0 ? [`注册工具：${insight.tools.join(', ')}`] : []),
            ];
            evidence.push({ label: '代码线索（注册提取）', ref: '入口源码 src/index.ts（analyze）', text: parts.join('；') });
        }
        if (node.detail.snippet !== '') {
            evidence.push({ label: '入口源码（浓缩）', ref: `src/${node.detail.files[0]?.name ?? 'index.ts'}`, text: node.detail.snippet.slice(0, 1200) });
        }
        submitQuestion(componentQuestion(node.short, node.group, blurb, files, explainStyle, language, insight, evidence) + snippet, `组件 ${node.short}`);
    };
    const explainEvent = (eventName) => {
        const event = coreEvents?.find(candidate => candidate.event === eventName);
        if (event === undefined)
            return;
        submitQuestion(eventQuestion(event.event, event.mode, event.producers, event.consumers, event.note, explainStyle, language, [{ label: '事件数据', ref: '.arch-lens-events-<lang>.json（AI 结构化缓存）', text: `事件 ${event.event}（${event.mode}）生产者：${event.producers.join(', ')}；消费者：${event.consumers.join(', ')}；${event.note}` }]), `事件 ${event.event}`);
    };
    const explainData = (title, data, ref) => {
        submitQuestion(dataQuestion(title, data, explainStyle, language, [{ label: '图数据', ref, text: JSON.stringify(data).slice(0, 1200) }]), `图 ${title}`);
    };
    const explainAll = () => {
        if (graph === null)
            return;
        submitQuestion(overviewQuestion(graph, overviewPrompt, language, [{ label: '工作区扫描图', ref: 'packages/*/*（package.json peerDependencies + README + src 索引）', text: `包数 ${graph.nodes.length}；依赖边 ${graph.edges.length}；核心候选：${coreCandidates(graph).join('、')}` }]), '整体架构');
    };
    /**
     * Explain the flow diagram in the chat. Doc flows cite the verbatim flow
     * block + anchor; induced flows declare themselves non-authoritative.
     */
    const explainFlow = () => {
        const flowState = flowMap[flowAngle];
        if (flowState === undefined)
            return;
        const evidence = flowState.source === 'flow'
            ? [{ label: 'AI 归纳（项目无文档流程）', ref: 'code-index 运行流元数据（入口/依赖/实体）', text: '流程图由 LLM 从代码索引归纳（非权威，建议生成架构文档后复核）' }]
            : [{ label: '流程原文（逐字引用）', ref: flowState.ref ?? '架构文档', text: flowState.sourceText ?? flowState.mermaid }];
        submitQuestion(`请讲解流程图「${flowState.title}」：\n\n${explainStyle}${evidenceClause(evidence)}${languageClause(language)}`, `流程图 ${flowState.title}`);
    };
    /**
     * Rescan = REBUILD facts only: the backend invalidates the scan graph, the
     * code-index (memory + disk) and all AI caches; here we drop the figure
     * states, re-pull metadata and the ACTIVE tab's figure. Other tabs load
     * lazily on first switch, so a rescan never auto-generates any figure
     * (no LLM work) — figures regenerate on demand, after the invalidation.
     */
    const refresh = () => {
        clearFigures();
        const generation = generationRef.current;
        void unwrapRemote(archLens.refresh()).then(result => {
            if (generation !== generationRef.current)
                return;
            if ('error' in result)
                setError(result.error);
            else
                setGraph(result);
            // Facts + metadata only; the active tab re-renders on demand.
            loadMetadata();
            ensureActiveTab();
        }).catch((reason) => setError(String(reason)));
    };
    /** Fetch the core-flow subgraph (deps / ER tabs). */
    const fetchCore = (kind, force = false) => {
        const setState = kind === 'deps' ? setCoreDeps : setCoreEr;
        const generation = generationRef.current;
        setState({ status: 'loading' });
        void unwrapRemote(archLens.mermaidCore({ kind: kind === 'deps' ? 'flowchart' : 'erDiagram', language, force })).then(result => {
            if (generation !== generationRef.current)
                return;
            if ('error' in result)
                setState({ status: 'error', message: result.error });
            else
                setState({ status: 'ready', source: result.source, core: result.core });
        }).catch((reason) => {
            if (generation !== generationRef.current)
                return;
            setState({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
        });
    };
    /** Lazily fetch the core subgraph the first time a tab opens. */
    const loadCore = (kind) => {
        const state = kind === 'deps' ? coreDeps : coreEr;
        if (state.status === 'idle')
            fetchCore(kind);
    };
    const selectTab = (id) => {
        setTab(id);
        // Every figure loads lazily on first switch (and re-loads lazily after a
        // rescan cleared it): concepts/seq/flow/events fetch here, deps/er fetch
        // their core subgraph below.
        if (id === 'concepts')
            ensureConcepts();
        else if (id === 'seq')
            ensureSequences();
        else if (id === 'flow')
            ensureFlow();
        else if (id === 'interaction')
            ensureEvents();
        else if (id === 'catalog')
            loadSummaries(0);
        else if (id === 'deps' || id === 'er') {
            loadCore(id);
        }
    };
    /**
     * AI generate = regenerate THIS figure's shared-profile field (分离方案):
     * one trimmed-summary LLM call on the backend, the fresh data rendered
     * directly. No doc rewrite (architecture.generated.md is only written by
     * 「📄 一键生成文档」), no index rebuild. Core regeneration invalidates
     * flow/seq/events on the backend, which re-generate on demand.
     */
    const aiGenerate = () => {
        if (aiGenRunning)
            return;
        stopRef.current = false;
        setAiGenRunning(true);
        setNotice(null);
        if (tab === 'catalog') {
            // Duty summaries are their own batched LLM path, unchanged.
            loadSummaries(0, true);
            setAiGenRunning(false);
            return;
        }
        const kind = tab === 'concepts' ? 'concepts'
            : tab === 'seq' ? 'seq'
                : tab === 'flow' ? 'flow'
                    : tab === 'interaction' ? 'interaction'
                        : tab === 'deps' ? 'deps'
                            : 'er';
        void directRemote('regenerateFigure', { request: { kind, language } }).then(result => {
            if (stopRef.current)
                return;
            setAiGenRunning(false);
            if ('error' in result) {
                console.warn('[arch-lens] ai generate failed:', result.error);
                setNotice(uiT(language, 'aiGenFailed', { msg: result.error }));
                return;
            }
            noticeWithLlm(ui(language, 'aiGenDone'));
            switch (result.kind) {
                case 'concepts':
                    setConceptTreeState(result.tree);
                    break;
                case 'seq':
                    // The regenerated main-flow sequence is the point of the exercise —
                    // switch to that view so the learner sees it.
                    setSequenceFlowState({ source: 'flow', messages: result.messages });
                    setSeqView('flow');
                    break;
                case 'flow':
                    // Both viewpoints arrive in one response (a stale host may still
                    // answer with the old single-flow shape — ignore it, the current
                    // diagrams stay visible until a restart).
                    if (result.flows !== undefined)
                        setFlowMap(result.flows);
                    break;
                case 'interaction':
                    setEventsState(result.events);
                    break;
                case 'core':
                    // New selection is written back to the shared profile; force a
                    // re-derive of the current overview (deps/ER).
                    fetchCore(tab, true);
                    setMermaidToken(value => value + 1);
                    break;
            }
        }).catch((reason) => {
            if (stopRef.current)
                return;
            setAiGenRunning(false);
            setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }));
        });
    };
    /**
     *「⏹ 终止」: abort every in-flight LLM generation for this workspace (the
     * backend AbortSignal fires, so provider streams stop promptly), drop all
     * pending figure responses locally, and clear the running flags. The
     * stopRef guard keeps late error responses from overwriting the notice.
     */
    const stopGeneration = () => {
        stopRef.current = true;
        generationRef.current += 1;
        setAiGenRunning(false);
        setProgressRunning(false);
        try {
            void directRemote('cancelGeneration', {}).catch(() => { });
        }
        catch {
            // cancelGeneration remote unavailable (stale runtime) — the local
            // guards still drop pending results.
        }
        setNotice(ui(language, 'genStopped'));
    };
    /** Global "one-shot docs": generate the full architecture doc for the project. */
    const genDocs = () => {
        if (aiGenRunning)
            return;
        stopRef.current = false;
        setAiGenRunning(true);
        setNotice(null);
        void unwrapRemote(archLens.generateDocs({ language })).then(result => {
            if (stopRef.current)
                return;
            setAiGenRunning(false);
            if ('error' in result) {
                console.warn('[arch-lens] generate docs failed:', result.error);
                setNotice(uiT(language, 'genDocFailed', { msg: result.error }));
                return;
            }
            noticeWithLlm(ui(language, 'genDocDone'));
            // Concept tree follows the generated doc immediately.
            void unwrapRemote(archLens.conceptTree({ language, force: true })).then(tree => {
                if (!('error' in tree))
                    setConceptTreeState(tree);
            }).catch(() => { });
            loadSequences(generationRef.current);
            void unwrapRemote(archLens.events({ language })).then(data => {
                if (data !== null && !('error' in data))
                    setEventsState(data);
            }).catch(() => { });
            // The generated doc may carry a flow block — re-derive both viewpoints.
            ensureFlow(generationRef.current);
        }).catch((reason) => {
            if (stopRef.current)
                return;
            setAiGenRunning(false);
            setNotice(uiT(language, 'genDocFailed', { msg: reason instanceof Error ? reason.message : String(reason) }));
        });
    };
    /** Generate (or regenerate) the AI learning-progress summary in the notes. */
    const runProgress = () => {
        if (progressRunning)
            return;
        stopRef.current = false;
        setProgressRunning(true);
        setNotice(null);
        void unwrapRemote(archLens.progress({ language, force: progressGenerated })).then(result => {
            if (stopRef.current)
                return;
            setProgressRunning(false);
            if ('error' in result) {
                console.warn('[arch-lens] progress failed:', result.error);
                setNotice(uiT(language, 'progressFailed', { msg: result.error }));
                return;
            }
            console.log(`[arch-lens] progress: ${result.progress}% covered, summary ${result.summary.length} chars`);
            setProgressGenerated(true);
            noticeWithLlm(progressGenerated ? ui(language, 'progressRegenerated') : ui(language, 'progressDone'));
            void unwrapRemote(archLens.notes()).then(notes => { setNotes(notes); }).catch(() => { });
        }).catch((reason) => {
            if (stopRef.current)
                return;
            setProgressRunning(false);
            setNotice(uiT(language, 'progressReqFailed', { msg: reason instanceof Error ? reason.message : String(reason) }));
        });
    };
    // AI duty summaries for the catalog, cached per workspace root + role
    // language. Only SUCCESS results are cached: a failure stays uncached so
    // the next catalog visit retries instead of silently showing stale raw
    // text forever. The backend generates at most two batches per call (30s
    // RPC budget), so a partial result re-invokes to fill the rest.
    const summaryCacheKey = `${workspaceKeyRef.current ?? ''}|${language}`;
    const loadSummaries = (attempt = 0, force = false) => {
        const cached = cachedDutySummaries.get(summaryCacheKey);
        // Force (AI generate / rescan) must bypass the front-end cache: the whole
        // point is a fresh LLM pass over current code.
        if (!force && cached !== undefined && cached !== null && Object.keys(cached).length >= (graph?.nodes.length ?? 0)) {
            setSummaries(cached);
            return;
        }
        stopRef.current = false;
        console.log(`[arch-lens] loadSummaries: requesting (root=${workspaceKeyRef.current}, lang=${language}, attempt=${attempt}, force=${force})`);
        setSummaries(cached ?? null);
        void unwrapRemote(archLens.summarizeDuties({ language })).then(result => {
            if (stopRef.current)
                return;
            if ('error' in result) {
                console.warn('[arch-lens] loadSummaries failed:', result.error);
                setSummaries(null);
                setNotice(uiT(language, 'summarizeFailedNotice', { msg: result.error }));
            }
            else {
                console.log(`[arch-lens] loadSummaries: got ${Object.keys(result).length} summaries`);
                cachedDutySummaries.set(summaryCacheKey, result);
                setSummaries(result);
                // Partial fill: the backend caps batches per call; keep pulling until
                // every package has a summary or the cap is reached.
                if (graph !== null && Object.keys(result).length < graph.nodes.length && attempt < 5) {
                    window.setTimeout(() => loadSummaries(attempt + 1, force), 1500);
                }
            }
        }).catch((reason) => {
            if (stopRef.current)
                return;
            console.warn('[arch-lens] loadSummaries request failed:', reason);
            setSummaries(null);
            setNotice(uiT(language, 'summarizeReqFailedNotice', { msg: String(reason) }));
        });
    };
    // Language switch resets to the cached summaries for that workspace+language.
    useEffect(() => {
        const cached = cachedDutySummaries.get(`${workspaceKeyRef.current ?? ''}|${language}`);
        if (cached !== undefined)
            setSummaries(cached);
        else
            setSummaries(undefined);
    }, [language]);
    /** Explain one concept-tree node (not a package) in the chat. */
    const explainConcept = (node) => {
        const insight = node.pkg === undefined ? undefined : insights?.find(item => item.id === node.pkg);
        // Mandatory evidence: doc nodes cite the verbatim section + anchor — with
        // an honest caveat, because the doc may itself be arch-lens generated
        // (AI-written) rather than hand-authored; flow nodes (AI-induced, no
        // architecture doc) declare themselves non-authoritative.
        const evidence = node.source === 'flow'
            ? [{ label: 'AI 归纳（项目无架构文档）', ref: 'code-index 运行流元数据（入口/依赖/实体）', text: `${node.desc}${node.inside !== undefined ? `；${node.inside}` : ''}（非权威，建议生成架构文档后复核）` }]
            : [{ label: '概念原文（逐字引用；文档可能由 AI 生成，内容以代码为准）', ref: node.ref ?? '架构文档', text: node.sourceText ?? `${node.desc}${node.inside !== undefined ? `；${node.inside}` : ''}` }];
        submitQuestion(`请讲解架构概念「${node.name}」：${node.desc}${node.inside !== undefined ? `\n内部机制：${node.inside}` : ''}\n\n${explainStyle}${codeInsightClause(insight)}${evidenceClause(evidence)}${languageClause(language)}`, `概念 ${node.name}`);
    };
    /** Open the package detail popup for a clicked mermaid node/entity label. */
    const selectNodeByLabel = (label) => {
        const node = graph?.nodes.find(candidate => candidate.short === label);
        if (node !== undefined)
            setSelection({ kind: 'pkg', id: node.id });
    };
    const toggleExpand = (id) => {
        setExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
    };
    const groupTree = useMemo(() => graph !== null ? buildGroupTree(graph) : [], [graph]);
    const toggleGroup = (id) => {
        setGroupExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
    };
    const tabOrder = [
        { id: 'concepts', label: ui(language, 'tabConcepts') },
        { id: 'seq', label: ui(language, 'tabSeq') },
        { id: 'flow', label: ui(language, 'tabFlow') },
        { id: 'interaction', label: ui(language, 'tabInteraction') },
        { id: 'deps', label: ui(language, 'tabDeps') },
        { id: 'er', label: ui(language, 'tabEr') },
        { id: 'catalog', label: ui(language, 'tabCatalog') },
    ];
    const header = h('div', { className: css.header }, tabOrder.map(unit => h('button', {
        key: unit.id,
        className: `${css.tab} ${tab === unit.id ? css.tabActive : ''}`,
        onClick: () => selectTab(unit.id),
    }, unit.label)), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: explainAll }, ui(language, 'btnOverview')), h('button', { className: css.btn, onClick: runProgress, disabled: progressRunning }, progressRunning ? ui(language, 'progressWorking') : ui(language, 'btnProgress')), h('button', { className: css.btn, onClick: genDocs, disabled: aiGenRunning }, aiGenRunning ? ui(language, 'genDocWorking') : ui(language, 'btnGenDoc')), h('button', { className: css.btn, onClick: () => setEditorOpen(true) }, ui(language, 'btnPrompts')), h('button', { className: css.btn, onClick: refresh }, ui(language, 'btnRescan')), h('button', { className: `${css.btn} ${css.stopBtn}`, onClick: stopGeneration }, ui(language, 'btnStop')), h('button', {
        className: css.btn,
        onClick: () => { setLlmStatsOpen(value => !value); if (llmStats === null)
            refreshLlmStats(); },
    }, '⚡ LLM'));
    let body;
    if (error !== null) {
        body = h('div', { className: css.error }, h('div', null, uiT(language, 'loadFailed', { msg: error })), h('div', { className: css.section }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => loadGraph() }, ui(language, 'retry'))));
    }
    else if (graph === null) {
        body = h('div', { className: css.loading }, ui(language, 'loadingScan'));
    }
    else {
        const activeTip = (() => {
            switch (tab) {
                case 'concepts': return ui(language, 'tipConcepts');
                case 'seq': return ui(language, 'tipSeq');
                case 'flow': return ui(language, 'tipFlow');
                case 'interaction': return ui(language, 'tipInteraction');
                case 'deps': return ui(language, 'tipDeps');
                case 'er': return ui(language, 'tipEr');
                default: return uiT(language, 'tipCatalog', { count: String(graph.nodes.length) });
            }
        })();
        // The active sequence view: static call graph or the main-flow sequence.
        const sequence = seqView === 'code' ? sequenceCodeState : sequenceFlowState;
        const explain = (() => {
            switch (tab) {
                case 'concepts': return () => explainData(ui(language, 'tabConcepts'), conceptTree, '概念树（架构文档提取或 AI 归纳，source: doc/flow）');
                case 'seq': {
                    const refText = sequence === null
                        ? (seqView === 'flow' ? '主流程时序（暂无数据：点击 🤖 AI 生成，从当前代码归纳核心主流程）' : '调用关系图（无数据）')
                        : sequence.source === 'code'
                            ? '调用关系图（代码静态事实：真实调用边，或跨包 import 引用；边的顺序是遍历顺序，不代表执行时序）'
                            : sequence.source === 'doc'
                                ? `主流程时序（架构文档「## 时序」章节逐字提取：${sequence.ref ?? '架构文档'}）`
                                : '主流程时序（AI 结构化缓存 .arch-lens-sequence-<lang>.json，非权威）';
                    return () => explainData(ui(language, 'tabSeq'), sequence === null ? [] : sequence, refText);
                }
                case 'flow': return explainFlow;
                case 'interaction': return () => explainData(ui(language, 'tabInteraction'), coreEvents, '交互数据（AI 结构化缓存 .arch-lens-events-<lang>.json）');
                case 'deps': return () => explainData(ui(language, 'tabDeps'), coreDeps.status === 'ready' ? coreDeps.source : '', '依赖图（核心子图：LLM 选包 + 源码 import 边）');
                case 'er': return () => explainData(ui(language, 'tabEr'), coreEr.status === 'ready' ? coreEr.source : '', 'ER 图（核心子图：LLM 选包 + 源码 import 边）');
                default: return () => explainData(ui(language, 'tabCatalog'), graph.nodes.map(node => ({ path: node.group === '' ? `src/${node.short}` : `src/${node.group}/${node.short}`, duty: node.blurb })), '包目录（扫描 + README/description）');
            }
        })();
        // Dependency/ER tabs show ONLY the core-flow subgraph (LLM-picked core
        // packages with rule-derived source-import edges) — the full mermaid
        // views were removed: the entity/package-level full diagrams added no
        // learning value over the scan/import projections.
        const renderGraphTab = (kind) => {
            const core = kind === 'deps' ? coreDeps : coreEr;
            const title = ui(language, kind === 'deps' ? 'tabDeps' : 'tabEr');
            const overview = core.status === 'ready'
                ? h('div', { className: css.flowWrap }, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, core.core.source === 'flow' ? ui(language, 'coreBadgeFlow') : ui(language, 'coreBadgeCurated')), h('span', { className: css.flowTitle }, ui(language, 'viewOverview')), core.core.ref !== undefined ? h('code', { className: css.flowRef }, core.core.ref) : null), h(MermaidView, { key: `core-${kind}-${mermaidToken}`, source: core.source, onSelectNode: label => selectNodeByLabel(label) }))
                // Core not ready yet: fall back to the group tree (keeps the tab useful).
                : core.status === 'error'
                    ? h('div', { className: css.loading }, uiT(language, 'failLoad', { t: title, msg: core.message }))
                    : h(ConceptGraph, {
                        graph,
                        conceptTree: groupTree,
                        expanded: groupExpanded,
                        selectedId: selection !== null && selection.kind === 'pkg' ? selection.id : null,
                        onToggle: toggleGroup,
                        onSelectPkg: id => setSelection({ kind: 'pkg', id }),
                    });
            return h('div', { className: css.graphWrap }, overview);
        };
        // Every unit body stays mounted; inactive tabs are hidden, so switching
        // back does not regenerate diagrams (the refresh button refetches).
        // A null figure state (no AI cache yet) renders an empty prompt instead
        // of a curated fallback — the data must come from this workspace's code.
        const noData = h('div', { className: css.loading }, ui(language, 'noDataFigure'));
        const unitBodies = {
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
            seq: h('div', { className: css.flowWrap }, h('div', { className: css.viewSwitch }, h('button', { className: `${css.btn} ${seqView === 'code' ? css.btnPrimary : ''}`, onClick: () => setSeqView('code') }, ui(language, 'viewCode')), h('button', { className: `${css.btn} ${seqView === 'flow' ? css.btnPrimary : ''}`, onClick: () => setSeqView('flow') }, ui(language, 'viewFlow'))), sequence === null
                ? noData
                : h('div', null, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, sequence.source === 'code' ? ui(language, 'seqCodeBadge')
                    : sequence.source === 'doc' ? ui(language, 'seqDocBadge')
                        : ui(language, 'seqAIBadge')), sequence.ref !== undefined
                    ? h('span', { className: css.flowTitle }, sequence.ref)
                    : null), h(SequenceGraph, { result: sequence, language }))),
            flow: (() => {
                const flowState = flowMap[flowAngle];
                return flowState === undefined
                    ? h('div', { className: css.loading }, ui(language, 'loadingFlow'))
                    : h('div', { className: css.flowWrap }, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, flowState.source === 'doc' ? ui(language, 'flowDocBadge') : ui(language, 'flowAIBadge')), h('span', { className: css.flowTitle }, flowState.title), flowState.ref !== undefined ? h('code', { className: css.flowRef }, flowState.ref) : null), h('div', { className: css.viewSwitch }, h('span', { className: css.angleLabel }, ui(language, 'flowAngleLabel')), FLOW_ANGLES.map(angle => h('button', {
                        key: angle,
                        className: `${css.btn} ${flowAngle === angle ? css.btnPrimary : ''}`,
                        // Instant local switch: both viewpoints are already loaded
                        // (generated together in one LLM call).
                        onClick: () => setFlowAnglePersisted(angle),
                    }, ui(language, flowAngleKey(angle))))), h(MermaidView, { key: `flow-${mermaidToken}`, source: flowState.mermaid }));
            })(),
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
        };
        body = h('div', { className: css.pane }, h('div', { className: css.tip }, h('span', null, activeTip), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: aiGenerate, disabled: aiGenRunning }, aiGenRunning ? ui(language, 'aiGenWorking') : ui(language, 'btnAiGen')), h('button', { className: css.btn, onClick: explain }, tab === 'catalog' ? ui(language, 'btnExplainCatalog') : ui(language, 'btnExplainGraph'))), thinking !== null && thinking.reasoning !== ''
            ? h('div', { className: css.thinking }, h('button', {
                className: css.thinkingToggle,
                onClick: () => setThinkingOpen(value => !value),
                title: ui(language, 'thinkingHint'),
            }, `🧠 ${ui(language, 'thinkingLabel')} ${thinkingOpen ? '▾' : '▸'}`), thinkingOpen ? h('div', { className: css.thinkingBody }, thinking.reasoning) : null)
            : null, h('div', { className: css.body }, tabOrder.map(unit => h('div', {
            key: unit.id,
            className: css.unitPane,
            style: { display: tab === unit.id ? 'flex' : 'none' },
        }, unitBodies[unit.id]))), h(NotesPanel, { notes, language, onLoad: loadNotes }));
    }
    const detailNode = graph !== null && selection !== null && selection.kind === 'pkg'
        ? graph.nodes.find(node => node.id === selection.id)
        : undefined;
    let overlay = null;
    if (detailNode !== undefined) {
        // Detail rides along with the graph: opens instantly, no RPC round trip.
        const detail = detailNode.detail;
        let panelBody;
        if (detail === undefined) {
            panelBody = h('div', { className: css.error }, ui(language, 'detailFailed'));
        }
        else {
            const depsText = detail.deps.length > 0 ? detail.deps.join(', ') : '—';
            const dependentsText = detail.dependents.length > 0 ? detail.dependents.join(', ') : '—';
            panelBody = h('div', null, dutyText(detailNode, language) !== '' ? h('p', { className: css.blurb }, dutyText(detailNode, language)) : null, h('div', { className: css.section }, h('div', { className: css.sectionTitle }, ui(language, 'detailFiles')), h('ul', { className: css.files }, detail.files.map(file => h('li', { key: file.name }, h('code', null, file.name), file.role !== '' ? h('span', { className: css.role }, file.role) : null)))), h('div', { className: css.section }, h('div', { className: css.sectionTitle }, uiT(language, 'detailDeps', { deps: depsText, dependents: dependentsText }))), detail.keyLines.length > 0
                ? h('div', { className: css.section }, h('div', { className: css.sectionTitle }, ui(language, 'detailKeyLines')), h('pre', { className: css.code }, detail.keyLines.join('\n')))
                : null, detail.snippet !== ''
                ? h('div', { className: css.section }, h('div', { className: css.sectionTitle }, ui(language, 'detailSnippet')), h('pre', { className: `${css.code} ${css.codeScroll}` }, detail.snippet))
                : null, h('div', { className: css.section }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => explainPkg(detailNode) }, ui(language, 'detailExplain')), h('div', { className: css.followup }, h('input', {
                className: css.input,
                placeholder: ui(language, 'detailFollowup'),
                value: followup,
                onChange: event => setFollowup(event.target.value),
                onKeyDown: event => {
                    if (event.key === 'Enter') {
                        if (followup.trim() !== '') {
                            submitQuestion(`（针对组件 ${detailNode.short}）${followup.trim()}`, `组件 ${detailNode.short}`);
                            setFollowup('');
                        }
                    }
                },
            }), h('button', {
                className: css.btn,
                onClick: () => {
                    if (followup.trim() === '')
                        return;
                    submitQuestion(`（针对组件 ${detailNode.short}）${followup.trim()}`, `组件 ${detailNode.short}`);
                    setFollowup('');
                },
            }, ui(language, 'send')))), notice !== null ? h('div', { className: css.notice }, notice) : null, insights?.find(item => item.id === detailNode.short) !== undefined
                ? h(InsightsPanel, { insight: insights?.find(item => item.id === detailNode.short) })
                : null);
        }
        overlay = h('div', { className: css.overlay, onClick: () => setSelection(null) }, h('div', { className: css.panel, onClick: (event) => event.stopPropagation() }, h('div', { className: css.panelHead }, h('span', { className: css.panelTitle }, detailNode.short), h('span', { className: css.badge }, detailNode.group), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: () => setSelection(null) }, '✕')), panelBody));
    }
    else if (selection !== null && selection.kind === 'event') {
        const event = coreEvents?.find(candidate => candidate.event === selection.id);
        if (event !== undefined) {
            overlay = h('div', { className: css.overlay, onClick: () => setSelection(null) }, h('div', { className: css.panel, onClick: (eventClick) => eventClick.stopPropagation() }, h('div', { className: css.panelHead }, h('span', { className: css.panelTitle }, event.event), h('span', { className: `${css.badge} ${css.badgeEvent}` }, event.mode), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: () => setSelection(null) }, '✕')), h('p', { className: css.blurb }, event.note), h('div', { className: css.section }, h('div', { className: css.sectionTitle }, uiT(language, 'eventProducers', { list: event.producers.join(', ') })), h('div', { className: css.sectionTitle }, uiT(language, 'eventConsumers', { list: event.consumers.join(', ') }))), h('div', { className: css.section }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => explainEvent(event.event) }, ui(language, 'eventExplain')), h('div', { className: css.followup }, h('input', {
                className: css.input,
                placeholder: ui(language, 'followupPlaceholder'),
                value: followup,
                onChange: inputEvent => setFollowup(inputEvent.target.value),
                onKeyDown: inputEvent => {
                    if (inputEvent.key === 'Enter' && followup.trim() !== '') {
                        submitQuestion(`（针对事件 ${event.event}）${followup.trim()}`, `事件 ${event.event}`);
                        setFollowup('');
                    }
                },
            }), h('button', {
                className: css.btn,
                onClick: () => {
                    if (followup.trim() === '')
                        return;
                    submitQuestion(`（针对事件 ${event.event}）${followup.trim()}`, `事件 ${event.event}`);
                    setFollowup('');
                },
            }, ui(language, 'send')))), notice !== null ? h('div', { className: css.notice }, notice) : null));
        }
    }
    return h('div', { className: css.root }, header, llmStatsOpen && llmStats !== null
        ? h('div', { className: css.llmStats }, (() => {
            const hasUsage = llmStats.totalUsageInTokens > 0 || llmStats.totalUsageOutTokens > 0;
            return h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', fontWeight: 600, marginBottom: 6 } }, h('span', null, `LLM 用量${hasUsage ? '（实际）' : '（估算）'}`), h('span', null, `${llmStats.totalCalls} 次调用`), h('span', null, hasUsage
                ? `输入 ${fmtTokens(llmStats.totalUsageInTokens)} tokens`
                : `输入 ${fmtTokens(llmStats.totalInTokens)} tokens`), h('span', null, hasUsage
                ? `输出 ${fmtTokens(llmStats.totalUsageOutTokens)} tokens`
                : `输出 ${fmtTokens(llmStats.totalOutTokens)} tokens`), h('span', null, `总耗时 ${(llmStats.totalMs / 1000).toFixed(1)}s`));
        })(), llmStats.records.slice(0, 20).map((record, index) => {
            const tokens = recordTokens(record);
            return h('div', { key: `${record.at}-${index}`, style: { display: 'flex', gap: 8, padding: '2px 0' } }, h('code', { style: { minWidth: 130 } }, record.kind), h('span', null, `${tokens.inText}→${tokens.outText} tokens${tokens.reasoning !== undefined ? ` +${tokens.reasoning} reasoning` : ''}${tokens.actual ? '' : '（估）'} · ${(record.ms / 1000).toFixed(1)}s · ${new Date(record.at).toLocaleTimeString()}`));
        }))
        : null, h('div', { className: css.body }, body), editorOpen
        ? h(PromptEditor, {
            archLens,
            config: promptConfig,
            base: config,
            onSave: next => { setPromptConfig(next); setEditorOpen(false); },
            onClose: () => setEditorOpen(false),
        })
        : null, overlay);
}
//# sourceMappingURL=arch-view.js.map