/**
 * Arch Lens study desk: unit tabs over the backend Remote, component/event
 * detail popups, notes summary, and the explain queue. Rendered inside the
 * floating robot panel; questions go through the core conversation pipeline
 * (props.send → session.prompt), so answers appear in the main chat view.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/arch-view
 */
import { createElement as h, useEffect, useRef, useState } from 'react';
import { Catalog, dutyText } from "./catalog.js";
import { InsightsPanel } from "./insights-panel.js";
import { NotesPanel } from "./notes-panel.js";
import { PromptEditor } from "./prompt-editor.js";
import { codeInsightClause, componentQuestion, dataQuestion, DEFAULT_EXPLAIN_STYLE, DEFAULT_LANGUAGE, defaultStyle, eventQuestion, evidenceClause, languageClause, useDefaultsConfig, } from "./explain.js";
import { ConceptGraph, InteractionGraph, SequenceGraph } from "./graphs.js";
import { MermaidView } from "./mermaid-view.js";
import { ui, uiT } from "./i18n.js";
import { directRemote, unwrapRemote } from "./remote.js";
import css from './arch-view.module.css';
/** 真实 import 引用边 → 原生 mermaid flowchart（LR 自动布局）。
 * 角色（入口/共享服务/其他）由引用度自算（与后端规则一致：
 * hub = 被 ≥2 个包引用、entry = 被 0 个包引用且引用 ≥2 个包），
 * 用 classDef 着色区分——不搞手绘环形布局（弦交叉、空间错乱）。
 * 边 label 只显示动词（引用/references），目标名已在箭头指向上。 */
function callGraphToMermaid(edges, language) {
    const verb = language === 'English' ? 'references' : '引用';
    const inDeg = new Map();
    const outDeg = new Map();
    for (const edge of edges) {
        inDeg.set(edge.to, (inDeg.get(edge.to) ?? 0) + 1);
        outDeg.set(edge.from, (outDeg.get(edge.from) ?? 0) + 1);
    }
    const roleOf = (actor) => {
        const citedBy = inDeg.get(actor) ?? 0;
        const cites = outDeg.get(actor) ?? 0;
        return citedBy >= 2 ? 'hub' : citedBy === 0 && cites >= 2 ? 'entry' : 'leaf';
    };
    const roles = new Map();
    for (const edge of edges) {
        roles.set(edge.from, roleOf(edge.from));
        roles.set(edge.to, roleOf(edge.to));
    }
    const lines = ['flowchart LR'];
    lines.push('  classDef entry fill:#e8f0fe,stroke:#3f6fd8,color:#1c2a4a');
    lines.push('  classDef hub fill:#fff3d6,stroke:#c88a2d,color:#4a3410');
    lines.push('  classDef leaf fill:#f2f2f2,stroke:#8a8a8a,color:#3a3a3a');
    for (const edge of edges)
        lines.push(`  ${edge.from} -->|${verb}| ${edge.to}`);
    const byRole = { entry: [], hub: [], leaf: [] };
    for (const [actor, role] of roles)
        byRole[role].push(actor);
    for (const role of ['entry', 'hub', 'leaf']) {
        if (byRole[role].length > 0)
            lines.push(`  class ${byRole[role].join(',')} ${role}`);
    }
    return lines.join('\n');
}
/** Flow-diagram viewpoints selectable on the flow tab (order = UI order). */
const FLOW_ANGLES = ['event', 'pipeline'];
/** localStorage key for the selected flow viewpoint. */
const FLOW_ANGLE_KEY = 'arch-lens-flow-angle';
/** localStorage key for the overview sub-tab (static rule-built / AI-generated). */
const OVERVIEW_VIEW_KEY = 'arch-lens-overview-view';
/** localStorage key for the interaction sub-tab (entity-level / method-level). */
const EVENTS_VIEW_KEY = 'arch-lens-events-view';
/** localStorage key for the flow sub-tab granularity (entity-level / method-level). */
const FLOW_GRAN_KEY = 'arch-lens-flow-gran';
/** localStorage key for the per-tab 🔬 方法级 switches. */
const METHOD_LEVEL_KEY = 'arch-lens-method-level';
/** Tabs that accept the 🔬 方法级 switch (the LLM-figure tabs). The
 * interaction and flow tabs expose the granularity as a sub-tab switch;
 * concepts and deps are fixed to entity-level (no method-level entry). Only
 * the sequence tab keeps the 🔬 toggle. */
const METHOD_TABS = ['seq'];
/** i18n key for one flow angle chip. */
const flowAngleKey = (angle) => angle === 'event' ? 'flowAngleEvent' : 'flowAnglePipeline';
/** Tab id → localized tab label key (type-safe; used by the figure-sent notice). */
const FIGURE_TAB_LABEL = {
    concepts: 'tabConcepts',
    seq: 'tabSeq',
    flow: 'tabFlow',
    interaction: 'tabInteraction',
    deps: 'tabDeps',
    overview: 'tabOverview',
};
const dynamicTargetKey = (kind, target) => {
    if (kind === 'seq-edge')
        return `seq:${target.from ?? ''}|${target.to ?? ''}|${target.label ?? ''}`;
    if (kind === 'overview')
        return 'overview:all';
    return `flow:${target.stage ?? ''}`;
};
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
    // 「调用关系图」真实数据源：代码索引里的跨包 import 引用边（非 AI，只读
    // 缓存）。与主流程时序（sequence 缓存）解耦——调用关系图不再渲染 AI 归纳。
    const [callGraphState, setCallGraphState] = useState(null);
    const [callGraphError, setCallGraphError] = useState(null);
    const [seqView, setSeqView] = useState('code');
    const [eventsState, setEventsState] = useState(null);
    const [eventsMethodsState, setEventsMethodsState] = useState(null);
    // 交互图的展示粒度：实体级 / 方法级（子页签切换，双数据槽各自缓存与懒加载，
    // 切视图不再互相覆盖）。视图选择持久化，刷新后保留。
    const [eventsView, setEventsView] = useState(() => {
        try {
            return window.localStorage.getItem(EVENTS_VIEW_KEY) === 'method' ? 'method' : 'entity';
        }
        catch {
            return 'entity';
        }
    });
    const setEventsViewPersisted = (view) => {
        setEventsView(view);
        try {
            window.localStorage.setItem(EVENTS_VIEW_KEY, view);
        }
        catch { /* ignore */ }
    };
    // Flow diagrams per viewpoint × granularity — BOTH angles of the selected
    // granularity are fetched together (the backend generates them in one LLM
    // call), so switching the angle chip is instant and never costs another
    // model call. Entity/method granularities are separate cache files, loaded
    // lazily on sub-tab switch.
    const [flowMap, setFlowMap] = useState({});
    // Selected granularity, persisted so reopening the page keeps the last
    // choice (and never re-requests the other granularity).
    const [flowView, setFlowView] = useState(() => {
        try {
            return window.localStorage.getItem(FLOW_GRAN_KEY) === 'method' ? 'method' : 'entity';
        }
        catch {
            return 'entity';
        }
    });
    const setFlowViewPersisted = (view) => {
        setFlowView(view);
        try {
            window.localStorage.setItem(FLOW_GRAN_KEY, view);
        }
        catch { /* ignore */ }
    };
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
    // 「已尝试加载」标记（`${angle}/${granularity}`）：flow RPC 读不到缓存（返回
    // null / error）时记录，渲染层据此显示"暂无数据"而不是永久"正在加载"——
    // 读/写分离下没有数据就是没有，不会自动生成。
    const [flowTried, setFlowTried] = useState(() => new Set());
    const flowTriedKey = (angle, granularity) => `${angle}/${granularity}`;
    // 🔬 方法级 switch, per tab, default off: figures then generate from the
    // method-level summary (methods + real call edges) with their own LLM call.
    const [methodLevels, setMethodLevels] = useState(() => {
        try {
            return JSON.parse(window.localStorage.getItem(METHOD_LEVEL_KEY) ?? '{}');
        }
        catch {
            return {};
        }
    });
    // Synchronous source of truth for fetches (state updates are async, but a
    // toggle must reload the figure with the NEW granularity immediately).
    const methodLevelsRef = useRef(methodLevels);
    const methodOn = (tabId) => methodLevelsRef.current[tabId] === true;
    const setMethodPersisted = (tabId, on) => {
        methodLevelsRef.current = { ...methodLevelsRef.current, [tabId]: on };
        setMethodLevels(previous => {
            const next = { ...previous, [tabId]: on };
            try {
                window.localStorage.setItem(METHOD_LEVEL_KEY, JSON.stringify(next));
            }
            catch { /* ignore */ }
            return next;
        });
    };
    const setAllMethods = (on) => {
        const next = { ...methodLevelsRef.current };
        for (const id of METHOD_TABS)
            next[id] = on;
        methodLevelsRef.current = next;
        setMethodLevels(next);
        try {
            window.localStorage.setItem(METHOD_LEVEL_KEY, JSON.stringify(next));
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
    // 架构概览 (rule-built): core packages + duties + import edges. The ER tab
    // was removed — it duplicated the dependency graph with no extra signal.
    const [overviewFig, setOverviewFig] = useState({ status: 'idle' });
    // 架构概览的展示角度：静态规则图 / AI 生成图（子页签切换，AI 图内联展示而非浮层）。
    const [overviewView, setOverviewView] = useState(() => {
        try {
            return window.localStorage.getItem(OVERVIEW_VIEW_KEY) === 'ai' ? 'ai' : 'static';
        }
        catch {
            return 'static';
        }
    });
    const setOverviewViewPersisted = (view) => {
        setOverviewView(view);
        try {
            window.localStorage.setItem(OVERVIEW_VIEW_KEY, view);
        }
        catch { /* ignore */ }
    };
    const [summaries, setSummaries] = useState(undefined);
    const [progressRunning, setProgressRunning] = useState(false);
    const [progressGenerated, setProgressGenerated] = useState(false);
    const [insights, setInsights] = useState(null);
    const [aiGenRunning, setAiGenRunning] = useState(false);
    const [allGenRunning, setAllGenRunning] = useState(false);
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
    // In-flight follow-up redraw (✍️ 追问重画): aborting it stops the backend
    // LLM stream (cache stays untouched) and drops the pending response, so a
    // cancelled redraw never overwrites the current figure.
    const followUpAbortRef = useRef(null);
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
            if (result === null) {
                // 无事实缓存（从未 rescan 或磁盘缓存被置无效）：合法状态，不是错误 —
                // 渲染「请点击 重新扫描」引导，绝不自动扫盘。
                if (generation !== generationRef.current)
                    return;
                setGraph(null);
                return;
            }
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
        setCallGraphState(null);
        setCallGraphError(null);
        setEventsState(null);
        setEventsMethodsState(null);
        setFlowMap({});
        setFlowTried(new Set());
        setCoreDeps({ status: 'idle' });
        setOverviewFig({ status: 'idle' });
        setInsights(null);
        setSummaries(undefined);
    };
    /** Fetch both sequence views for one generation (code call graph + main-flow sequence).
     * directRemote: the injected sequence descriptor strips new request fields
     * (methodLevel), so the raw gateway path is used for ALL figure fetches. */
    const loadSequences = (generation) => {
        void directRemote('sequence', { request: { language, methodLevel: methodOn('seq') } }).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && !('error' in data))
                setSequenceCodeState(data);
        }).catch(() => { });
        // 读路径：主流程时序视图与调用关系图视图共用同一版本化缓存（写路径在
        // AI 生成时写）。原 prefer:'flow' 区分已被读/写分离取代。
        void directRemote('sequence', { request: { language, methodLevel: methodOn('seq') } }).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && !('error' in data))
                setSequenceFlowState(data);
        }).catch(() => { });
        // 「调用关系图」真实数据源（纯读索引缓存，非 AI）：跨包 import 引用边。
        void directRemote('callGraph', { request: { language } }).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && 'ok' in data && data.ok) {
                setCallGraphState(data.edges);
                setCallGraphError(null);
            }
            else if (data !== null && 'error' in data) {
                setCallGraphError(data.error);
            }
        }).catch(() => setCallGraphError('调用关系图加载失败'));
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
        void directRemote('conceptTree', { request: { language } }).then(tree => {
            if (generation !== generationRef.current)
                return;
            if (tree !== null && !('error' in tree))
                setConceptTreeState(tree);
        }).catch(() => { });
        loadSequences(generation);
        void directRemote('events', { request: { language } }).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && !('error' in data))
                setEventsState(data);
        }).catch(() => { });
        void directRemote('events', { request: { language, methodLevel: true } }).then(data => {
            if (generation !== generationRef.current)
                return;
            if (data !== null && !('error' in data))
                setEventsMethodsState(data);
        }).catch(() => { });
        // Both flow viewpoints are served from the backend's shared profile
        // (generated together in one LLM call), so fetching both is free.
        ensureFlow(generation);
        if (tab === 'deps') {
            fetchCore();
        }
        else if (tab === 'overview') {
            fetchOverview();
        }
    };
    /**
     * Lazy figure loaders: each AI-derived unit (concepts / seq / flow /
     * events) is fetched on first view and after a rescan clears its state.
     * This keeps a rescan purely factual — no figure is auto-generated unless
     * the user actually looks at its tab.
     */
    const ensureConcepts = (force = false) => {
        if (!force && conceptTreeState !== null)
            return;
        const generation = generationRef.current;
        void directRemote('conceptTree', { request: { language } }).then(tree => {
            if (generation !== generationRef.current)
                return;
            if (tree !== null && !('error' in tree))
                setConceptTreeState(tree);
        }).catch(() => { });
    };
    const ensureSequences = (force = false) => {
        if (!force && (sequenceCodeState !== null || sequenceFlowState !== null))
            return;
        loadSequences(generationRef.current);
    };
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
    const ensureFlow = (generation = generationRef.current, granularity = flowView, force = false) => {
        for (const angle of FLOW_ANGLES) {
            if (!force && flowMap[angle]?.[granularity] !== undefined)
                continue;
            void directRemote('flow', { request: { language, angle, methodLevel: granularity === 'method' } }).then(data => {
                if (generation !== generationRef.current)
                    return;
                // 无论有无数据都标记"已尝试"：null（无缓存）/ error 时不落图数据，
                // 渲染层据此显示"暂无数据"而不是永久加载（读不到不会自动生成）。
                const key = flowTriedKey(angle, granularity);
                setFlowTried(previous => (previous.has(key) ? previous : new Set(previous).add(key)));
                if (data !== null && !('error' in data))
                    setFlowMap(previous => ({ ...previous, [angle]: { ...previous[angle], [granularity]: data } }));
            }).catch(() => { });
        }
    };
    /** 流程图子页签切换：实体级 / 方法级；切到目标粒度时若该粒度还没数据，懒加载。 */
    const selectFlowView = (view) => {
        setFlowViewPersisted(view);
        ensureFlow(generationRef.current, view);
    };
    /** Fetch BOTH interaction views once (entity-level + method-level, each
     * served from its own cache file). Kept lazy per figure like the other
     * tabs; both are pulled together so switching the sub-tab is instant. */
    const ensureEvents = (force = false) => {
        const generation = generationRef.current;
        if (force || eventsState === null) {
            void directRemote('events', { request: { language } }).then(data => {
                if (generation !== generationRef.current)
                    return;
                if (data !== null && !('error' in data))
                    setEventsState(data);
            }).catch(() => { });
        }
        if (force || eventsMethodsState === null) {
            void directRemote('events', { request: { language, methodLevel: true } }).then(data => {
                if (generation !== generationRef.current)
                    return;
                if (data !== null && !('error' in data))
                    setEventsMethodsState(data);
            }).catch(() => { });
        }
    };
    /** 交互图子页签切换：切换视图时若目标视图还没数据，懒加载它。 */
    const selectEventsView = (view) => {
        setEventsViewPersisted(view);
        if (view === 'method' ? eventsMethodsState === null : eventsState === null)
            ensureEvents();
    };
    /** Load only the ACTIVE tab's figure (used after a rescan; the other tabs
     * load lazily when switched to, so a rescan never generates figures by
     * itself — it rebuilds facts only). `force` skips the already-loaded
     * checks: clearFigures() just ran inside the same handler and its state
     * updates have not re-rendered yet, so the closures would otherwise read
     * stale non-null state and wrongly skip the re-pull.
     * @param force - force a re-pull of the active tab's figure.
     */
    const ensureActiveTab = (force = false) => {
        if (tab === 'concepts')
            ensureConcepts(force);
        else if (tab === 'seq')
            ensureSequences(force);
        else if (tab === 'flow')
            ensureFlow(generationRef.current, flowView, force);
        else if (tab === 'interaction')
            ensureEvents(force);
        else if (tab === 'catalog')
            loadSummaries(0);
        else if (tab === 'deps') {
            loadCore(force);
        }
        else if (tab === 'overview') {
            if (force || overviewFig.status === 'idle')
                fetchOverview();
        }
    };
    /** 估算 token 的显示格式（≥1000 显示为 x.xk）。 */
    const fmtTokens = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    /** 拉取 LLM 用量统计（累计 + 最近记录，落盘 index/.arch-lens-llm-stats.json）。
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
    // A session-driven FIGURE generation completes the same way: when the turn
    // finishes, the backend has written the figure cache — refetch and render.
    const running = props.useSessions(state => props.sessionId === null ? false : (state.byId[props.sessionId]?.running ?? false));
    useEffect(() => {
        if (running)
            sawRunningRef.current = true;
        if (!running && sawRunningRef.current) {
            sawRunningRef.current = false;
            const stagedFigure = pendingFigureRef.current;
            if (stagedFigure !== null) {
                pendingFigureRef.current = null;
                setAiGenRunning(false);
                setNotice(ui(language, 'figureDone'));
                // The agent's answer was parsed and cached by the backend — a plain
                // refetch of this tab renders the fresh figure. The short delay lets
                // the backend's async cache write land first (it uses the staged
                // index, so it is milliseconds — this is just a safety margin).
                const refetch = () => {
                    if (stagedFigure.kind === 'concepts') {
                        setConceptTreeState(null);
                        ensureConcepts(true);
                    }
                    else if (stagedFigure.kind === 'seq') {
                        setSequenceCodeState(null);
                        setSequenceFlowState(null);
                        setCallGraphState(null);
                        setCallGraphError(null);
                        loadSequences(generationRef.current);
                    }
                    else if (stagedFigure.kind === 'flow') {
                        setFlowMap({});
                        ensureFlow(generationRef.current, flowView, true);
                    }
                    else if (stagedFigure.kind === 'interaction') {
                        setEventsState(null);
                        setEventsMethodsState(null);
                        ensureEvents(true);
                    }
                    else {
                        fetchCore();
                    }
                };
                window.setTimeout(refetch, 400);
                return;
            }
            const stagedDynamic = pendingDynamicRef.current;
            if (stagedDynamic !== null) {
                pendingDynamicRef.current = null;
                // The backend cached the dynamic detail (matched by figId) — fetch it
                // into the overlay. A short delay mirrors the figure refetch margin.
                window.setTimeout(() => loadDynamicFigure(stagedDynamic.key), 400);
                return;
            }
            const stagedDraw = pendingDrawRef.current;
            if (stagedDraw !== null) {
                pendingDrawRef.current = null;
                // The backend captured the custom figure (diagram + 概要) in memory —
                // fetch it into the 🎨 动态出图 tab (no disk write happened).
                window.setTimeout(() => loadDrawFigure(stagedDraw.figureId), 400);
                return;
            }
            if (explainingRef.current) {
                explainingRef.current = false;
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
        }
    }, [running]);
    // One staged session-driven figure generation: { figId, kind } — the GUI
    // conversation stream shows the agent working; on turn completion the
    // running-flip effect refetches this tab's figure (backend already cached).
    const pendingFigureRef = useRef(null);
    // DYNAMIC figure drill-down (「动态画图」hover): the overlay shows the
    // generated detail; per-target results are kept in memory + disk cache so a
    // later hover opens them instantly without re-generating.
    const dynamicCacheRef = useRef(new Map());
    const pendingDynamicRef = useRef(null);
    const [dynamicFig, setDynamicFig] = useState(null);
    const [dynamicCollapsed, setDynamicCollapsed] = useState(false);
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
    const requestDynamicFigure = (kind, target, mermaidSource, blurbs, generate = true) => {
        const key = dynamicTargetKey(kind, target);
        const cached = dynamicCacheRef.current.get(key);
        if (cached !== undefined) {
            setDynamicFig({ key, kind, title: cached.title, diagram: cached.diagram, status: 'ready' });
            setDynamicCollapsed(false);
            return;
        }
        if (pendingDynamicRef.current !== null || dynamicFig?.status === 'generating')
            return;
        // Disk-cache fallback: after a page refresh the memory map is empty, but
        // the per-target cache file may exist — open it instead of re-generating.
        const openCached = (result) => {
            if (result === null || 'error' in result) {
                if (!generate)
                    return; // cache-only read (sub-tab switch): keep the empty state
                startDynamicGeneration(kind, target, mermaidSource, key, blurbs);
                return;
            }
            dynamicCacheRef.current.set(key, { title: result.title, diagram: result.diagram });
            setDynamicFig({ key, kind, title: result.title, diagram: result.diagram, status: 'ready' });
            setDynamicCollapsed(false);
        };
        void directRemote('dynamicFigure', { request: { kind, targetKey: key, language } })
            .then(openCached)
            .catch(() => startDynamicGeneration(kind, target, mermaidSource, key, blurbs));
    };
    /** Stage a dynamic figure prompt host-side and send it into the session. */
    const startDynamicGeneration = (kind, target, mermaidSource, key, blurbs) => {
        if (pendingDynamicRef.current !== null || dynamicFig?.status === 'generating')
            return;
        setDynamicFig({ key, kind, status: 'generating' });
        setDynamicCollapsed(false);
        const request = { kind, target, language };
        if (kind === 'flow-subgraph' && mermaidSource !== undefined)
            request.context = { mermaid: mermaidSource };
        if (kind === 'overview' && blurbs !== undefined)
            request.context = { blurbs };
        void directRemote('dynamicFigurePrompt', { request }).then(result => {
            if ('error' in result) {
                setDynamicFig({ key, kind, status: 'error', message: result.error });
                return;
            }
            pendingDynamicRef.current = { figId: result.figId, key };
            try {
                void props.send(result.prompt).catch((reason) => {
                    pendingDynamicRef.current = null;
                    setDynamicFig({ key, kind, status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
                });
            }
            catch (reason) {
                pendingDynamicRef.current = null;
                setDynamicFig({ key, kind, status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
            }
        }).catch((reason) => {
            setDynamicFig({ key, kind, status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
        });
    };
    /** Fetch one cached dynamic figure after the generating turn completes. */
    const loadDynamicFigure = (key) => {
        const kind = key === 'overview:all' ? 'overview' : key.startsWith('seq:') ? 'seq-edge' : 'flow-subgraph';
        void directRemote('dynamicFigure', { request: { kind, targetKey: key, language } }).then(result => {
            if (result === null || 'error' in result) {
                setDynamicFig(current => current === null || current.key !== key ? current : { ...current, status: 'error', message: 'dynamic figure not found' });
                return;
            }
            dynamicCacheRef.current.set(key, { title: result.title, diagram: result.diagram });
            setDynamicFig(current => current === null || current.key !== key ? current : { key, kind, title: result.title, diagram: result.diagram, status: 'ready' });
            setNotice(ui(language, 'dynamicDone'));
        }).catch(() => {
            setDynamicFig(current => current === null || current.key !== key ? current : { ...current, status: 'error', message: 'dynamic figure fetch failed' });
        });
    };
    // 🎨 动态出图 (custom figure): the user types ANY request ("存图的逻辑，
    // 怎么存的，存哪、怎么读的…"), the agent draws a diagram + 概要 via the
    // session turn (the prompt embeds the FULL scan facts). The result is
    // memory-only by default; the 保存 button persists it explicitly.
    const pendingDrawRef = useRef(null);
    const [drawText, setDrawText] = useState('');
    /** The 🎨 draw textarea — focused after a graph node is sent into it. */
    const drawTextareaRef = useRef(null);
    /** Every known scene (saved on disk + unsaved in memory), for the scene
     * list: 查看/删除/追问 target a scene by its stable figureId (`dynamic-N`). */
    const [drawFigures, setDrawFigures] = useState([]);
    const [drawFig, setDrawFig] = useState({ status: 'idle' });
    /** Stage a custom-figure prompt host-side and send it into the session. The
     * target scene id (`drawFig.figureId`) is reused for a FOLLOW-UP (追问重画);
     * a fresh scene allocates a new `dynamic-N` id host-side. */
    const drawFigure = () => {
        const text = drawText.trim();
        if (text === '' || pendingDrawRef.current !== null || drawFig.status === 'generating')
            return;
        stopRef.current = false;
        const targetId = drawFig.figureId;
        setDrawFig({ status: 'generating', figureId: targetId });
        void directRemote('customFigurePrompt', {
            request: { text, figureId: targetId, language, context: { blurbs: blurbsFromGraph() } },
        }).then(result => {
            if ('error' in result) {
                setDrawFig({ status: 'error', figureId: targetId, message: result.error });
                return;
            }
            pendingDrawRef.current = { figId: result.figId, figureId: result.figureId };
            setDrawFig({ status: 'generating', figureId: result.figureId });
            const fail = (reason) => {
                pendingDrawRef.current = null;
                setDrawFig({ status: 'error', figureId: result.figureId, message: reason instanceof Error ? reason.message : String(reason) });
            };
            try {
                void props.send(result.prompt).catch(fail);
            }
            catch (reason) {
                fail(reason);
            }
        }).catch((reason) => {
            setDrawFig({ status: 'error', figureId: targetId, message: reason instanceof Error ? reason.message : String(reason) });
        });
    };
    /** Fetch the in-memory custom figure (diagram + 概要) for the staged scene
     * after the turn ends, then refresh the scene list. The scene id is passed
     * explicitly — by the time the 400 ms refetch delay fires, the staged
     * pendingDrawRef slot has already been cleared by the turn-completion
     * effect, so reading it here would always miss (figure never rendered). */
    const loadDrawFigure = (figureId) => {
        if (figureId === '')
            return;
        void directRemote('customFigure', { request: { figureId } }).then(result => {
            if (result === null || 'error' in result) {
                setDrawFig(current => current.status === 'generating' ? { status: 'error', message: 'custom figure not found' } : current);
                return;
            }
            setDrawFig({ status: 'ready', figureId: result.figureId, title: result.title, diagram: result.diagram, summary: result.summary, text: result.text, saved: result.saved === true });
            refreshDrawFigures();
            setNotice(ui(language, 'drawDone'));
        }).catch((reason) => {
            setDrawFig(current => current.status === 'generating'
                ? { status: 'error', message: reason instanceof Error ? reason.message : String(reason) }
                : current);
        });
    };
    /** Refresh the scene list from the backend (saved disk scenes + memory). */
    const refreshDrawFigures = () => {
        void directRemote('customFigureList', {}).then(list => {
            if (!('error' in list))
                setDrawFigures(list);
        }).catch(() => { });
    };
    /** 新增场景动图: reset the active slot to a brand-new scene (its id is
     * allocated host-side on the next 画图). */
    const newDrawScene = () => {
        setDrawText('');
        setDrawFig({ status: 'idle' });
        setNotice(ui(language, 'drawSceneNew'));
    };
    /** Load ONE scene (查看): memory content first, else the saved disk file. */
    const selectDrawFigure = (figureId) => {
        void directRemote('customFigure', { request: { figureId } }).then(result => {
            if (result === null || 'error' in result)
                return;
            setDrawFig({ status: 'ready', figureId: result.figureId, title: result.title, diagram: result.diagram, summary: result.summary, text: result.text, saved: result.saved === true });
            setDrawText(result.text);
        }).catch(() => { });
    };
    /** Delete a scene by its figureId (disk tombstoned host-side; memory dropped). */
    const deleteDrawFigure = (figureId) => {
        void directRemote('customFigureDelete', { request: { figureId } }).then(result => {
            if ('error' in result) {
                setNotice(uiT(language, 'drawDeleteFailed', { msg: result.error }));
                return;
            }
            refreshDrawFigures();
            setDrawFig(current => current.figureId === figureId ? { status: 'idle' } : current);
            setNotice(uiT(language, 'drawDeleted', { id: figureId }));
        }).catch((reason) => {
            setNotice(uiT(language, 'drawDeleteFailed', { msg: reason instanceof Error ? reason.message : String(reason) }));
        });
    };
    /** 保存按钮: persist the ACTIVE scene under its locked figureId
     * (`index/.arch-lens-draw-<figureId>-<lang>.json`) — 保存当前的图-锁定图号. */
    const saveDrawFigure = () => {
        if (drawFig.status !== 'ready' || drawFig.figureId === undefined)
            return;
        const figureId = drawFig.figureId;
        void directRemote('saveCustomFigure', { request: { figureId, language } }).then(result => {
            if ('error' in result) {
                setNotice(uiT(language, 'drawSaveFailed', { msg: result.error }));
                return;
            }
            setDrawFig(current => current.figureId === figureId ? { ...current, saved: true } : current);
            refreshDrawFigures();
            setNotice(uiT(language, 'drawSaved', { path: result.path }));
        }).catch((reason) => {
            setNotice(uiT(language, 'drawSaveFailed', { msg: reason instanceof Error ? reason.message : String(reason) }));
        });
    };
    /**
     * 🎨 动态出图 recovery: after a page refresh or a desk reopen the panel's
     * pendingDrawRef is gone, but the backend still holds captured figures in
     * memory and saved scenes on disk. Refresh the scene list and, when the
     * panel is still idle, auto-select the newest figure (memory first, else the
     * newest saved one) so the figure comes back instead of an empty panel.
     * Race-safe: never overwrites a state that moved on (generating/ready/error).
     */
    const recoverDrawFigure = () => {
        if (drawFig.status !== 'idle')
            return;
        refreshDrawFigures();
        void directRemote('customFigure', { request: {} }).then(result => {
            if (result === null || 'error' in result)
                return; // nothing captured — stay idle
            setDrawFig(current => current.status === 'idle'
                ? { status: 'ready', figureId: result.figureId, title: result.title, diagram: result.diagram, summary: result.summary, text: result.text, saved: result.saved === true }
                : current);
        }).catch(() => { });
    };
    const submitQuestion = (text, target) => {
        explainQueueRef.current.push({ text, target });
        pumpExplainQueue();
    };
    /** Package id → one-line duty (blurb) for the pure-LLM overview prompt. */
    const blurbsFromGraph = () => {
        const map = {};
        if (graph === null)
            return map;
        for (const node of graph.nodes) {
            map[node.id] = language === DEFAULT_LANGUAGE ? (node.blurbZh ?? node.blurb) : node.blurb;
        }
        return map;
    };
    /** 架构概览子页签切换：AI 页签只读缓存（内存/磁盘），未命中保持空态不自动生成。 */
    const selectOverviewView = (view) => {
        setOverviewViewPersisted(view);
        if (view === 'ai') {
            requestDynamicFigure('overview', { stage: '总览' }, undefined, blurbsFromGraph(), false);
        }
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
        submitQuestion(eventQuestion(event.event, event.mode, event.producers, event.consumers, event.note, explainStyle, language, [{ label: '事件数据', ref: 'index/.arch-lens-events-<lang>.json（AI 结构化缓存）', text: `事件 ${event.event}（${event.mode}）生产者：${event.producers.join(', ')}；消费者：${event.consumers.join(', ')}；${event.note}` }]), `事件 ${event.event}`);
    };
    const explainData = (title, data, ref, basis) => {
        submitQuestion(dataQuestion(title, data, explainStyle, language, [{ label: '图数据', ref, text: JSON.stringify(data).slice(0, 1200) }], basis), `图 ${title}`);
    };
    /**
     * Explain the flow diagram in the chat. Doc flows cite the verbatim flow
     * block + anchor; induced flows declare themselves non-authoritative.
     */
    const explainFlow = () => {
        const flowState = flowMap[flowAngle]?.[flowView];
        if (flowState === undefined)
            return;
        const evidence = flowState.source === 'flow'
            ? [{ label: 'AI 归纳（项目无文档流程）', ref: 'code-index 运行流元数据（入口/依赖/实体）', text: '流程图由 LLM 从代码索引归纳（非权威，建议生成架构文档后复核）' }]
            : [{ label: '流程原文（逐字引用）', ref: flowState.ref ?? '架构文档', text: flowState.sourceText ?? flowState.mermaid }];
        submitQuestion(`请讲解流程图「${flowState.title}」（${flowView === 'method' ? '方法级' : '实体级'}）：\n\n${explainStyle}${evidenceClause(evidence, flowState.source === 'flow' ? 'LLM 推断查证数据' : undefined)}${languageClause(language)}`, `流程图 ${flowState.title}`);
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
        // rescan = 失效：AI 职责总结的前端内存缓存也必须清，否则旧总结
        // （可能已是另一语言/旧代码）会绕过后端版本化校验继续显示。
        cachedDutySummaries.clear();
        const generation = generationRef.current;
        void unwrapRemote(archLens.refresh()).then(result => {
            if (generation !== generationRef.current)
                return;
            if ('error' in result)
                setError(result.error);
            else {
                setGraph(result.graph);
                // Layer-1 change detection: no file moved since the last rescan — the
                // backend skipped the rebuild (caches were still valid).
                if (!result.changed)
                    setNotice(ui(language, 'rescanNoChange'));
                else if (result.changes !== null) {
                    // Selective invalidation: report the change facts so the user knows
                    // which figures were invalidated and can rebuild them on demand.
                    const files = result.changes.added.length + result.changes.modified.length + result.changes.removed.length;
                    setNotice(uiT(language, 'rescanChanged', { files: String(files), pkgs: String(result.changes.changedPackages.length) }));
                }
            }
            // Facts + metadata only; the active tab re-renders on demand. Force the
            // re-pull: clearFigures() above set the figure states to null, but the
            // closure still holds the pre-clear values until React re-renders, so
            // the ensure guards would wrongly skip the fetch.
            loadMetadata();
            ensureActiveTab(true);
        }).catch((reason) => setError(String(reason)));
    };
    /** 「🔁 全量重建」: regenerate the AI figures with smart incremental mode
     * (incremental=true): only figures whose cache is invalidated/missing are
     * redrawn, valid ones are skipped — rescan does the precise invalidation,
     * so this step just redraws the affected figures (zero LLM calls when
     * everything is up to date). On success the figure states are cleared and
     * re-pulled. */
    const regenerateAll = () => {
        if (allGenRunning)
            return;
        setAllGenRunning(true);
        setNotice(null);
        const generation = generationRef.current;
        void unwrapRemote(archLens.generateAll({ language, incremental: true })).then(result => {
            if (generation !== generationRef.current)
                return;
            setAllGenRunning(false);
            if ('error' in result) {
                setNotice(uiT(language, 'regenerateAllFailed', { msg: result.error }));
            }
            else {
                const rebuiltN = result.rebuilt?.length ?? 0;
                const skippedN = result.skipped?.length ?? 0;
                setNotice(rebuiltN === 0
                    ? ui(language, 'regenerateAllUpToDate')
                    : uiT(language, 'regenerateAllDone', { rebuilt: rebuiltN, skipped: skippedN }));
                clearFigures();
                cachedDutySummaries.clear();
                loadMetadata();
                // clearFigures() nulls the graph; refresh() restores it from the
                // rescan result, but generateAll has no graph payload — re-pull it.
                loadGraph();
                ensureActiveTab(true);
            }
        }).catch((reason) => {
            setAllGenRunning(false);
            setNotice(uiT(language, 'regenerateAllFailed', { msg: String(reason) }));
        });
    };
    /** 「⚡ 变动更新」: ONE chained pass — first refresh() (file-change detection
     * + new factsVersion + selective invalidation of the affected figure
     * caches), then generateAll(incremental) to redraw exactly the invalidated
     * figures. A single button completes "detect changes + repair figures";
     * previously it only ran generateAll, so without a prior rescan every
     * cache still matched the old factsVersion and everything was skipped. */
    const regenerateInvalidated = () => {
        if (allGenRunning)
            return;
        setAllGenRunning(true);
        setNotice(null);
        const generation = generationRef.current;
        void unwrapRemote(archLens.refresh()).then(refreshResult => {
            if (generation !== generationRef.current)
                return;
            if ('error' in refreshResult) {
                setAllGenRunning(false);
                setError(refreshResult.error);
                return;
            }
            setGraph(refreshResult.graph);
            // 注意：这里【不能】在 !changed 时提前返回——generateAll(incremental) 是
            // 按"缓存对当前 factsVersion 是否有效"逐图判定的（阶段2 语义）。文件没动
            // 不代表图都在：手动删过缓存 / v:0 失效过的图，恰恰需要这条链补画，
            // 而未失效的图增量判定是秒级零 LLM，跳过这步反而会造成"没效果"的假象。
            // 事实已重建（新 factsVersion）或本就新鲜：补画失效的图。
            void unwrapRemote(archLens.generateAll({ language, incremental: true })).then(genResult => {
                if (generation !== generationRef.current)
                    return;
                setAllGenRunning(false);
                if ('error' in genResult) {
                    setNotice(uiT(language, 'regenerateInvalidatedFailed', { msg: genResult.error }));
                }
                else {
                    const rebuiltN = genResult.rebuilt?.length ?? 0;
                    const skippedN = genResult.skipped?.length ?? 0;
                    setNotice(rebuiltN === 0
                        ? ui(language, 'regenerateAllUpToDate')
                        : uiT(language, 'regenerateAllDone', { rebuilt: rebuiltN, skipped: skippedN }));
                    clearFigures();
                    cachedDutySummaries.clear();
                    loadMetadata();
                    loadGraph();
                    ensureActiveTab(true);
                }
            }).catch((reason) => {
                setAllGenRunning(false);
                setNotice(uiT(language, 'regenerateInvalidatedFailed', { msg: String(reason) }));
            });
        }).catch((reason) => {
            setAllGenRunning(false);
            setError(String(reason));
        });
    };
    /** Fetch the core-flow subgraph (deps tab). */
    /** 依赖图核心子图 — 只读：拉取版本化 core 缓存；null（无缓存）→ 空态，
     * 提示点「🤖 AI 生成」建立（D1/D2：读路径不生成任何事实）。 */
    const fetchCore = () => {
        const generation = generationRef.current;
        setCoreDeps({ status: 'loading' });
        void directRemote('mermaidCore', { request: { kind: 'flowchart', language } }).then(result => {
            if (generation !== generationRef.current)
                return;
            if (result === null)
                setCoreDeps({ status: 'idle' });
            else if ('error' in result)
                setCoreDeps({ status: 'error', message: result.error });
            else
                setCoreDeps({ status: 'ready', source: result.source, core: result.core });
        }).catch((reason) => {
            if (generation !== generationRef.current)
                return;
            setCoreDeps({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
        });
    };
    /** 架构概览 (rule-built) — 只读：core 缓存 + 扫描图拼装；null → 空态
     * （D2：纯规则图同样点了扫描/AI 生成才有，读路径无规则兜底）。 */
    const fetchOverview = () => {
        const generation = generationRef.current;
        setOverviewFig({ status: 'loading' });
        void directRemote('overviewFigure', { request: { language } }).then(result => {
            if (generation !== generationRef.current)
                return;
            if (result === null)
                setOverviewFig({ status: 'idle' });
            else if ('error' in result)
                setOverviewFig({ status: 'error', message: result.error });
            else
                setOverviewFig({ status: 'ready', source: result.mermaid, core: result.core });
        }).catch((reason) => {
            if (generation !== generationRef.current)
                return;
            setOverviewFig({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
        });
    };
    /** Lazily fetch the core subgraph the first time a tab opens. */
    const loadCore = (force = false) => {
        if (force || coreDeps.status === 'idle')
            fetchCore();
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
        else if (id === 'deps') {
            loadCore();
        }
        else if (id === 'overview') {
            if (overviewFig.status === 'idle')
                fetchOverview();
            // Re-entering with the AI sub-tab active re-opens the cached AI figure
            // (memory/disk) instead of showing the empty hint.
            if (overviewView === 'ai')
                requestDynamicFigure('overview', { stage: '总览' }, undefined, blurbsFromGraph(), false);
        }
        else if (id === 'draw') {
            // Recover a custom figure the backend already captured (page refresh /
            // desk reopen lost the panel's pendingDrawRef) so 保存 still shows.
            recoverDrawFigure();
        }
    };
    /** 🔬 方法级 toggle for the ACTIVE tab: flip the persisted switch, then
     * reload the figure with the new granularity (method-level figures use
     * their own caches/LLM calls; the shared profile stays entity-level). */
    const toggleMethodLevel = () => {
        const on = !methodOn(tab);
        setMethodPersisted(tab, on);
        setNotice(uiT(language, 'methodToggle', { state: on ? ui(language, 'methodOn') : ui(language, 'methodOff') }));
        if (tab === 'concepts') {
            setConceptTreeState(null);
            ensureConcepts(true);
        }
        else if (tab === 'seq') {
            setSequenceCodeState(null);
            setSequenceFlowState(null);
            setCallGraphState(null);
            setCallGraphError(null);
            loadSequences(generationRef.current);
        }
        else if (tab === 'flow') {
            setFlowMap({});
            ensureFlow(generationRef.current, flowView, true);
        }
        else if (tab === 'interaction') {
            setEventsState(null);
            setEventsMethodsState(null);
            ensureEvents(true);
        }
        else if (tab === 'deps') {
            fetchCore();
        }
    };
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
        if (tab === 'overview') {
            // 架构概览的「🤖 AI 生成」= 纯 LLM 分支：会话里让 LLM 自己选核心包并
            // 画一张分层总览图，切到「AI 生成」子页签内联展示（不再是浮层）——与
            // 规则拼装的静态总览用页签切换对比。
            setOverviewViewPersisted('ai');
            requestDynamicFigure('overview', { stage: '总览' }, undefined, blurbsFromGraph());
            setAiGenRunning(false);
            return;
        }
        const kind = tab === 'concepts' ? 'concepts'
            : tab === 'seq' ? 'seq'
                : tab === 'flow' ? 'flow'
                    : tab === 'interaction' ? 'interaction'
                        : 'deps';
        const angle = tab === 'flow' ? flowAngle : undefined;
        const request = { kind, language };
        if (angle !== undefined)
            request.angle = angle;
        if (tab === 'flow')
            request.methodLevel = flowView === 'method';
        else if (METHOD_TABS.includes(tab))
            request.methodLevel = methodOn(tab);
        void directRemote('figurePrompt', { request }).then(result => {
            if (stopRef.current)
                return;
            if ('error' in result) {
                setAiGenRunning(false);
                setNotice(uiT(language, 'aiGenFailed', { msg: result.error }));
                return;
            }
            // Stage + send: the GUI streams the agent's work (SSE); the backend
            // caches the figure when the answer carries the figId.
            pendingFigureRef.current = { figId: result.figId, kind: tab };
            // 兜底轮询：页面自动刷新依赖 running 翻转（turn 结束），但本会话的
            // agent 回复 JSON 后 turn 往往还在继续（同一轮里还有别的工作），
            // running 一直 true → 翻转不触发 → 图生成了页面不更新。轮询每 2s
            // 强制重拉当前图（读缓存，非 null 才更新、不清空状态不闪烁），回复
            // 落缓存后几秒内即刷新，无需等 turn 结束；正常路径（running 翻转
            // refetch）消费 pendingFigureRef 后置 null，轮询自动停止；60s 兜底上限。
            const staged = { figId: result.figId, kind: tab };
            const poll = () => {
                if (pendingFigureRef.current?.figId !== staged.figId) {
                    window.clearInterval(handle);
                    return;
                }
                if (staged.kind === 'concepts')
                    ensureConcepts(true);
                else if (staged.kind === 'seq')
                    loadSequences(generationRef.current);
                else if (staged.kind === 'flow')
                    ensureFlow(generationRef.current, flowView, true);
                else if (staged.kind === 'interaction')
                    ensureEvents(true);
                else
                    fetchCore();
            };
            const handle = window.setInterval(poll, 2000);
            // 5 分钟兜底上限：agent 回复（读源码+生成）通常 1-3 分钟，turn 结束的
            // running flip 会消费 pendingFigureRef 提前停止轮询；只有会话 turn
            // 长期不结束（本会话持续工作）时才需要轮询撑满全程。
            window.setTimeout(() => window.clearInterval(handle), 300000);
            setNotice(uiT(language, 'figureSent', { tab: ui(language, FIGURE_TAB_LABEL[tab] ?? 'tabConcepts') }));
            try {
                void props.send(result.prompt).catch((reason) => {
                    pendingFigureRef.current = null;
                    setAiGenRunning(false);
                    setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }));
                });
            }
            catch (reason) {
                pendingFigureRef.current = null;
                setAiGenRunning(false);
                setNotice(uiT(language, 'aiGenFailed', { msg: reason instanceof Error ? reason.message : String(reason) }));
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
     *
     * Two kinds of work are stopped: BACKEND streams (llmText paths, via
     * cancelGeneration → abortGeneration) and SESSION TURNS (「🤖 AI 生成」
     * figures and「AI 讲解」run as agent turns in the GUI session — the backend
     * AbortSignal never reaches them, so the running turn is cancelled through
     * the session runtime, the same path the GUI's own stop action uses).
     */
    const stopGeneration = () => {
        stopRef.current = true;
        generationRef.current += 1;
        setAiGenRunning(false);
        setProgressRunning(false);
        // A session-driven figure/explain was staged: its turn must be cancelled
        // (not treated as a completed generation). Drop the staged refs so the
        // running-flip effect does not refetch a figure that was never produced.
        const stopSessionTurn = pendingFigureRef.current !== null
            || pendingDynamicRef.current !== null
            || pendingDrawRef.current !== null
            || explainingRef.current;
        pendingFigureRef.current = null;
        pendingDynamicRef.current = null;
        pendingDrawRef.current = null;
        explainQueueRef.current = [];
        explainingRef.current = false;
        sawRunningRef.current = false;
        if (dynamicFig?.status === 'generating') {
            setDynamicFig(current => current === null || current.status !== 'generating'
                ? current
                : { ...current, status: 'error', message: ui(language, 'genStopped') });
        }
        if (drawFig.status === 'generating') {
            setDrawFig({ status: 'error', message: ui(language, 'genStopped') });
        }
        try {
            void directRemote('cancelGeneration', {}).catch(() => { });
        }
        catch {
            // cancelGeneration remote unavailable (stale runtime) — the local
            // guards still drop pending results.
        }
        if (stopSessionTurn && props.sessionId !== null) {
            void props.cancel(props.sessionId).catch(() => { });
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
            // Concept tree follows the generated doc: the write path already rebuilt
            // the concept cache, so a plain cache read returns the fresh tree.
            void unwrapRemote(archLens.conceptTree({ language })).then(tree => {
                if (tree !== null && !('error' in tree))
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
        // 读路径（默认）只读版本化缓存；force（「🤖 AI 生成」）才触发 LLM 补齐。
        void unwrapRemote(archLens.summarizeDuties(force ? { language, force: true } : { language })).then(result => {
            if (stopRef.current)
                return;
            if (result === null) {
                // 只读路径：缓存缺失/不完整 → 空态（「暂无数据」），不是错误，不重试。
                setSummaries(null);
                return;
            }
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
        submitQuestion(`请讲解架构概念「${node.name}」：${node.desc}${node.inside !== undefined ? `\n内部机制：${node.inside}` : ''}\n\n${explainStyle}${codeInsightClause(insight)}${evidenceClause(evidence, node.source === 'flow' ? 'LLM 推断查证数据' : undefined)}${languageClause(language)}`, `概念 ${node.name}`);
    };
    /** Open the package detail popup for a clicked mermaid node/entity label. */
    const selectNodeByLabel = (label) => {
        const node = graph?.nodes.find(candidate => candidate.short === label);
        if (node !== undefined)
            setSelection({ kind: 'pkg', id: node.id });
    };
    /** 概览图节点点击 → 把包短名填入「🎨 动态出图」输入框（可继续手动追加文字），
     * 并切到动态出图 tab、聚焦输入框。label 可能是「短名」或「短名+职责」——
     * <br/> 在 textContent 里不产生分隔符（短名与职责直接粘连），所以除整串匹配
     * 外再做「最长前缀短名」匹配。 */
    const sendNodeToDraw = (label) => {
        const clean = label.trim();
        let text = clean;
        const node = graph?.nodes.find(candidate => candidate.short === clean || candidate.id === clean);
        if (node !== undefined) {
            text = node.short;
        }
        else if (graph !== null) {
            let best = '';
            for (const candidate of graph.nodes) {
                if ((clean.startsWith(candidate.short) || clean.startsWith(candidate.id)) && candidate.short.length > best.length) {
                    best = candidate.short;
                }
            }
            if (best !== '')
                text = best;
        }
        setDrawText(previous => {
            const base = previous.trim();
            if (base === '')
                return text;
            return `${base}\n${text}`;
        });
        selectTab('draw');
        requestAnimationFrame(() => {
            const el = drawTextareaRef.current;
            if (el === null)
                return;
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        });
    };
    /** 原地追问重画对话框状态：在哪个图上、预填的元素上下文、🔬 开关、是否运行中。 */
    const [followUpDlg, setFollowUpDlg] = useState(null);
    /** 右键任意图元素 → 打开本 tab 的追问重画对话框（预填该元素上下文）。
     * 交互图/流程图的粒度跟随当前子页签（实体级/方法级）；时序图跟 🔬；
     * 概念图/依赖图固定实体级。 */
    const openFollowUp = (kind, label, angle) => {
        const methods = kind === 'events' ? eventsView === 'method'
            : kind === 'flow' ? flowView === 'method'
                : kind === 'seq' ? methodOn('seq')
                    : false;
        setFollowUpDlg({ kind, angle, methods, label, running: false });
    };
    /** 提交追问 → figureFollowUp → 结果原地回填当前 tab 的主图。 */
    const runFollowUp = () => {
        const dlg = followUpDlg;
        if (dlg === null || dlg.running)
            return;
        const text = dlg.label.trim();
        if (text === '')
            return;
        const controller = new AbortController();
        followUpAbortRef.current = controller;
        setFollowUpDlg({ ...dlg, running: true });
        void directRemote('figureFollowUp', {
            request: {
                kind: dlg.kind,
                language,
                followUp: text,
                ...(dlg.angle === undefined ? {} : { angle: dlg.angle }),
                ...(dlg.methods ? { methodLevel: true } : {}),
            },
        }, controller.signal).then(result => {
            // Cancelled: the user closed the dialog mid-redraw — the backend aborts
            // the LLM stream (cache untouched); a result that still arrived is dropped.
            if (controller.signal.aborted)
                return;
            if ('error' in result) {
                setFollowUpDlg(current => current === null
                    ? null
                    : { ...current, running: false, error: uiT(language, 'followUpFailed', { msg: result.error }) });
                return;
            }
            setFollowUpDlg(null);
            applyFollowUp(dlg.kind, result, dlg.angle);
            setNotice(ui(language, 'followUpDone'));
        }).catch((reason) => {
            if (controller.signal.aborted)
                return;
            setFollowUpDlg(current => current === null
                ? null
                : { ...current, running: false, error: uiT(language, 'followUpFailed', { msg: reason instanceof Error ? reason.message : String(reason) }) });
        }).finally(() => {
            if (followUpAbortRef.current === controller)
                followUpAbortRef.current = null;
        });
    };
    /** 对话框里的「🗣 AI 讲解」：把输入内容（含右键元素上下文）作为讲解问题
     * 塞进主会话讲解队列（回答照旧走 ARCH-NOTES 沉淀），流程图页会随问题
     * 附上当前图的 mermaid 源作为事实依据。与「重画」的区别：只讲解、不改图，
     * 发送后直接关闭对话框。 */
    const askFollowUpExplain = () => {
        const dlg = followUpDlg;
        if (dlg === null || dlg.running)
            return;
        const text = dlg.label.trim();
        if (text === '')
            return;
        const source = dlg.kind === 'flow'
            ? flowMap[dlg.angle ?? flowAngle]?.[dlg.methods === true ? 'method' : 'entity']?.mermaid
            : undefined;
        const kindLabel = followUpKindLabel(dlg.kind);
        submitQuestion(`（针对${kindLabel}）${text}`
            + (source === undefined ? '' : `\n\n【当前图（mermaid 源）】\n${source}`)
            + `\n\n${explainStyle}${languageClause(language)}`, kindLabel);
        setFollowUpDlg(null);
    };
    /** 「取消」：重画中点击 = 终止后端生成 + 关闭对话框（图保持原样）；
     * 非重画中点击 = 直接关闭对话框。 */
    const cancelFollowUp = () => {
        const controller = followUpAbortRef.current;
        if (controller !== null) {
            followUpAbortRef.current = null;
            controller.abort();
            // Best-effort: tell the backend to stop the LLM stream so the cache is
            // never overwritten by the cancelled redraw.
            void directRemote('cancelFollowUp', {}).catch(() => { });
        }
        setFollowUpDlg(null);
    };
    /** 把 figureFollowUp 的结果回填到对应 tab 的状态（原地更新，不切 tab）。 */
    const applyFollowUp = (kind, value, angle) => {
        if (kind === 'flow' && angle !== undefined && 'mermaid' in value) {
            // 回填到当前子页签粒度对应的数据槽（实体级/方法级各自独立）。
            const granularity = flowView === 'method' ? 'method' : 'entity';
            setFlowMap(previous => ({ ...previous, [angle]: { ...previous[angle], [granularity]: value } }));
            return;
        }
        if (kind === 'seq' && 'messages' in value) {
            setSequenceFlowState(value);
            setSeqView('flow');
            return;
        }
        if (kind === 'concepts' && Array.isArray(value)) {
            setConceptTreeState(value);
            return;
        }
        if (kind === 'events' && Array.isArray(value)) {
            // 回填到当前子页签对应的数据槽（实体级/方法级各自独立）。
            // kind === 'events' 时后端只会回事件行（ArchLensEventRow[]，与 CoreEvent 同形）；联合类型在此不可分辨，同概念树处惯例做类型级收窄。
            if (eventsView === 'method')
                setEventsMethodsState(value);
            else
                setEventsState(value);
            return;
        }
        if (kind === 'core' && 'kind' in value && value.kind === 'flowchart') {
            setCoreDeps({ status: 'ready', source: value.source, core: value.core });
            return;
        }
        if (kind === 'overview') {
            const overviewValue = value;
            setDynamicFig({ key: `followup-${Date.now().toString(36)}`, kind: 'overview', title: overviewValue.title, diagram: overviewValue.diagram, status: 'ready' });
            selectOverviewView('ai');
        }
    };
    /** 对话框标题里的图类型名（本地化）。 */
    const followUpKindLabel = (kind) => {
        switch (kind) {
            case 'flow': return ui(language, 'tabFlow');
            case 'seq': return ui(language, 'tabSeq');
            case 'concepts': return ui(language, 'tabConcepts');
            case 'events': return ui(language, 'tabInteraction');
            case 'core': return ui(language, 'tabDeps');
            default: return ui(language, 'tabOverview');
        }
    };
    const toggleExpand = (id) => {
        setExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
    };
    const tabOrder = [
        { id: 'concepts', label: ui(language, 'tabConcepts') },
        { id: 'overview', label: ui(language, 'tabOverview') },
        { id: 'seq', label: ui(language, 'tabSeq') },
        { id: 'flow', label: ui(language, 'tabFlow') },
        { id: 'interaction', label: ui(language, 'tabInteraction') },
        { id: 'deps', label: ui(language, 'tabDeps') },
        { id: 'catalog', label: ui(language, 'tabCatalog') },
        { id: 'draw', label: ui(language, 'tabDraw') },
    ];
    const header = h('div', { className: css.header }, tabOrder.map(unit => h('button', {
        key: unit.id,
        className: `${css.tab} ${tab === unit.id ? css.tabActive : ''}`,
        onClick: () => selectTab(unit.id),
    }, unit.label)), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: runProgress, disabled: progressRunning }, progressRunning ? ui(language, 'progressWorking') : ui(language, 'btnProgress')), h('button', { className: css.btn, onClick: genDocs, disabled: aiGenRunning }, aiGenRunning ? ui(language, 'genDocWorking') : ui(language, 'btnGenDoc')), h('button', { className: css.btn, onClick: () => setEditorOpen(true) }, ui(language, 'btnPrompts')), h('button', { className: css.btn, onClick: refresh }, ui(language, 'btnRescan')), h('button', { className: css.btn, onClick: regenerateInvalidated, disabled: allGenRunning || aiGenRunning }, allGenRunning ? ui(language, 'regenerateInvalidatedWorking') : ui(language, 'btnRegenerateInvalidated')), h('button', { className: css.btn, onClick: regenerateAll, disabled: allGenRunning || aiGenRunning }, allGenRunning ? ui(language, 'regenerateAllWorking') : ui(language, 'btnRegenerateAll')), h('button', { className: `${css.btn} ${css.stopBtn}`, onClick: stopGeneration }, ui(language, 'btnStop')), h('button', {
        className: css.btn,
        onClick: () => { setLlmStatsOpen(value => !value); if (llmStats === null)
            refreshLlmStats(); },
    }, '⚡ LLM'));
    let body;
    if (error !== null) {
        body = h('div', { className: css.error }, h('div', null, uiT(language, 'loadFailed', { msg: error })), h('div', { className: css.section }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => loadGraph() }, ui(language, 'retry'))));
    }
    else if (graph === null) {
        // 无事实缓存：合法空态（从未 rescan / 缓存被 rescan 置无效）。只给引导，
        // 绝不在读路径自动扫盘或生成。
        body = h('div', { className: css.loading }, h('div', null, ui(language, 'noFactsTitle')), h('div', { className: css.section }, ui(language, 'noFactsHint')), h('div', { className: css.section }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: refresh }, ui(language, 'noFactsBtn'))));
    }
    else {
        const activeTip = (() => {
            switch (tab) {
                case 'concepts': return ui(language, 'tipConcepts');
                case 'seq': return ui(language, 'tipSeq');
                case 'flow': return ui(language, 'tipFlow');
                case 'interaction': return ui(language, 'tipInteraction');
                case 'deps': return ui(language, 'tipDeps');
                case 'overview': return ui(language, 'tipOverview');
                case 'draw': return ui(language, 'tipDraw');
                default: return uiT(language, 'tipCatalog', { count: String(graph.nodes.length) });
            }
        })();
        const explain = (() => {
            switch (tab) {
                case 'concepts': return () => explainData(ui(language, 'tabConcepts'), conceptTree, '概念树（架构文档提取或 AI 归纳，source: doc/flow）');
                case 'seq': {
                    // 讲解对象随子页签数据源：调用关系图 = 真实 import 引用边（代码索引，
                    // 非 AI）；主流程时序 = sequence 缓存（doc 逐字 / AI 归纳）。
                    const explainSeq = seqView === 'code'
                        ? callGraphState
                        : sequenceFlowState === null ? null : sequenceFlowState.messages;
                    const refText = explainSeq === null
                        ? (seqView === 'flow' ? '主流程时序（暂无数据：点击 🤖 AI 生成，从当前代码归纳核心主流程）' : '调用关系图（暂无数据：请先点击「↻ 重新扫描」生成代码索引）')
                        : seqView === 'code'
                            ? '调用关系图（真实 import 引用边，来自代码索引 index/.arch-lens-index.json，非 AI；边的顺序是遍历顺序，不代表执行时序）'
                            : sequenceFlowState?.source === 'doc'
                                ? `主流程时序（架构文档「## 时序」章节逐字提取：${sequenceFlowState.ref ?? '架构文档'}）`
                                : '主流程时序（AI 结构化缓存 index/.arch-lens-sequence-<lang>.json，非权威）';
                    return () => explainData(ui(language, 'tabSeq'), explainSeq === null ? [] : explainSeq, refText, seqView === 'flow' && sequenceFlowState?.source === 'flow' ? 'LLM 推断查证数据' : undefined);
                }
                case 'flow': return explainFlow;
                case 'interaction': {
                    // interaction 无方法级生成路径（METHOD_TABS 仅 seq）：讲解一律用
                    // 实体级数据（方法级缓存恒空，回退避免"暂无数据"）。
                    const events = eventsState ?? eventsMethodsState ?? null;
                    return () => explainData(ui(language, 'tabInteraction'), events ?? [], '交互数据（AI 结构化缓存 index/.arch-lens-events-<lang>.json，实体级）', 'LLM 推断查证数据');
                }
                case 'deps': return () => explainData(ui(language, 'tabDeps'), coreDeps.status === 'ready' ? coreDeps.source : '', '依赖图（核心子图：LLM 选包 + 源码 import 边）');
                case 'overview': {
                    // 当前子页签决定讲解对象：AI 生成图（AI 页签 + 就绪）讲解 AI 图，
                    // 否则讲解静态规则拼装图。
                    const aiOverview = overviewView === 'ai'
                        && dynamicFig !== null
                        && dynamicFig.kind === 'overview'
                        && dynamicFig.status === 'ready'
                        && dynamicFig.diagram !== undefined;
                    if (aiOverview) {
                        return () => explainData(`${ui(language, 'tabOverview')}（🤖 AI 生成）`, { title: dynamicFig.title ?? ui(language, 'tabOverview'), diagram: dynamicFig.diagram }, 'AI 生成的架构总览（纯 LLM：AI 选包 + 分层总览图）', 'LLM 推断查证数据');
                    }
                    return () => explainData(ui(language, 'tabOverview'), overviewFig.status === 'ready' ? overviewFig.source : '', '架构概览（核心包 + 一句话职责 + 源码 import 边；AI 选包 + 规则拼装，零 LLM）');
                }
                // 🎨 动态出图 explains the drawn figure (diagram + 概要) when ready —
                // but the tip-row buttons are hidden for this tab; this is defensive.
                case 'draw': return () => {
                    if (drawFig.status === 'ready' && drawFig.diagram !== undefined) {
                        explainData(`${ui(language, 'tabDraw')}（${drawFig.title ?? ''}）`, { title: drawFig.title ?? '', diagram: drawFig.diagram, summary: drawFig.summary ?? '' }, '动态出图（用户输入 + LLM 依据推断查证数据绘制；默认不保存）', 'LLM 推断查证数据');
                    }
                };
                default: return () => explainData(ui(language, 'tabCatalog'), graph.nodes.map(node => ({ path: node.group === '' ? `src/${node.short}` : `src/${node.group}/${node.short}`, duty: node.blurb })), '包目录（扫描 + README/description）');
            }
        })();
        // Dependency tab shows ONLY the core-flow subgraph (LLM-picked core
        // packages with rule-derived source-import edges) — the full mermaid
        // views were removed: the entity/package-level full diagrams added no
        // learning value over the scan/import projections.
        const renderGraphTab = () => {
            const core = coreDeps;
            const title = ui(language, 'tabDeps');
            const overview = core.status === 'ready'
                ? h('div', { className: css.flowWrap }, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, core.core.source === 'flow' ? ui(language, 'coreBadgeFlow') : ui(language, 'coreBadgeCurated')), h('span', { className: css.flowTitle }, ui(language, 'viewOverview')), core.core.ref !== undefined ? h('code', { className: css.flowRef }, core.core.ref) : null), h(MermaidView, { key: 'core-deps', source: core.source, onSelectNode: label => selectNodeByLabel(label), onNodeContext: label => openFollowUp('core', label) }))
                // Core not ready (读/写分离：rescan 后 core 缓存失效，直到点 AI 生成):
                // 只显示空态引导，不再用包分组树兜底（那看起来像包目录，语义混淆）。
                : core.status === 'error'
                    ? h('div', { className: css.loading }, uiT(language, 'failLoad', { t: title, msg: core.message }))
                    : h('div', { className: css.loading }, ui(language, 'noDataFigure'));
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
                    onAsk: label => openFollowUp('concepts', label),
                }),
            seq: h('div', { className: css.flowWrap }, h('div', { className: css.viewSwitch }, h('button', { className: `${css.btn} ${seqView === 'code' ? css.btnPrimary : ''}`, onClick: () => setSeqView('code') }, ui(language, 'viewCode')), h('button', { className: `${css.btn} ${seqView === 'flow' ? css.btnPrimary : ''}`, onClick: () => setSeqView('flow') }, ui(language, 'viewFlow')), 
            // 可见入口：基于当前时序图追问/重画（右键元素同样可用），结果原地更新本页。
            h('button', {
                className: css.btn,
                onClick: () => openFollowUp('seq', `当前${seqView === 'flow' ? ui(language, 'viewFlow') : ui(language, 'viewCode')}（${methodOn('seq') ? ui(language, 'viewMethod') : ui(language, 'viewEntity')}）`),
            }, ui(language, 'followUpBtn'))), 
            // 子页签区分渲染与数据源：调用关系图 = 真实 import 引用边（只读代码
            // 索引缓存，非 AI）；主流程时序 = sequence 缓存的泳道时序图。
            seqView === 'code'
                ? callGraphState !== null
                    ? h('div', null, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, ui(language, 'seqCodeBadge')), h('span', { className: css.flowTitle }, ui(language, 'callGraphSource'))), 
                    // 原生 mermaid flowchart 渲染（LR 自动布局）：包级引用边没有
                    // 方法级时序可下钻，故无「动态画图」；右键节点可追问包间关系。
                    h(MermaidView, {
                        key: 'callgraph',
                        source: callGraphToMermaid(callGraphState, language),
                        onNodeContext: label => openFollowUp('seq', label),
                    }))
                    : callGraphError !== null
                        ? h('div', { className: css.notice }, callGraphError)
                        : h('div', { className: css.loading }, ui(language, 'loadingFlow'))
                : sequenceFlowState === null
                    ? noData
                    : h('div', null, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, sequenceFlowState.source === 'code' ? ui(language, 'seqCodeBadge')
                        : sequenceFlowState.source === 'doc' ? ui(language, 'seqDocBadge')
                            : ui(language, 'seqAIBadge')), sequenceFlowState.ref !== undefined
                        ? h('span', { className: css.flowTitle }, sequenceFlowState.ref)
                        : null), h(SequenceGraph, {
                        result: sequenceFlowState,
                        language,
                        onDynamicRequest: message => requestDynamicFigure('seq-edge', { from: message.from, to: message.to, label: message.label }),
                        onAsk: label => openFollowUp('seq', label),
                    }))),
            flow: (() => {
                const flowState = flowMap[flowAngle]?.[flowView];
                // 视图切换（实体/方法 + 视角 + 追问）必须始终可见：即使当前视图无
                // 数据（方法级缓存未生成），也要能切回有数据的视图——之前切换按钮
                // 在 flowState 分支里，无数据时按钮消失导致"切不回去"。
                return h('div', { className: css.flowWrap }, h('div', { className: css.viewSwitch }, h('button', { className: `${css.btn} ${flowView === 'entity' ? css.btnPrimary : ''}`, onClick: () => selectFlowView('entity') }, ui(language, 'viewEntity')), h('button', { className: `${css.btn} ${flowView === 'method' ? css.btnPrimary : ''}`, onClick: () => selectFlowView('method') }, ui(language, 'viewMethod')), h('span', { className: css.angleLabel }, ui(language, 'flowAngleLabel')), FLOW_ANGLES.map(angle => h('button', {
                    key: angle,
                    className: `${css.btn} ${flowAngle === angle ? css.btnPrimary : ''}`,
                    // Instant local switch: both viewpoints are already loaded
                    // (generated together in one LLM call).
                    onClick: () => setFlowAnglePersisted(angle),
                }, ui(language, flowAngleKey(angle)))), 
                // 可见入口：基于当前流程图（视角×粒度）追问/重画（右键元素同样
                // 可用），结果原地更新本页图。
                h('button', {
                    className: css.btn,
                    onClick: () => openFollowUp('flow', `当前流程图（${ui(language, flowAngleKey(flowAngle))}，${flowView === 'method' ? ui(language, 'viewMethod') : ui(language, 'viewEntity')}）`, flowAngle),
                }, ui(language, 'followUpBtn'))), flowState === undefined
                    ? (flowTried.has(flowTriedKey(flowAngle, flowView))
                        ? h('div', { className: css.loading }, ui(language, 'noDataFigure'))
                        : h('div', { className: css.loading }, ui(language, 'loadingFlow')))
                    : h('div', null, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, flowState.source === 'doc' ? ui(language, 'flowDocBadge') : ui(language, 'flowAIBadge')), h('span', { className: css.flowTitle }, flowState.title), flowState.ref !== undefined ? h('code', { className: css.flowRef }, flowState.ref) : null), h(MermaidView, {
                        // key 绑定「视角/粒度」：切换时销毁旧实例，避免旧图渲染状态
                        // 残留导致"切换时旧图一闪而过"。
                        key: `${flowAngle}/${flowView}`,
                        source: flowState.mermaid,
                        onClusterAction: stage => requestDynamicFigure('flow-subgraph', { stage }, flowState.mermaid),
                        onNodeContext: label => openFollowUp('flow', label, flowAngle),
                    })));
            })(),
            interaction: (() => {
                // interaction 只做实体级（METHOD_TABS 仅 seq，方法级无生成路径、
                // 缓存恒空）：视图切换条只显示「实体级」，不提供方法级按钮。
                const events = eventsState ?? eventsMethodsState ?? null;
                return h('div', { className: css.flowWrap }, h('div', { className: css.viewSwitch }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => selectEventsView('entity') }, ui(language, 'viewEntity'))), events === null
                    ? noData
                    : h(InteractionGraph, { events, onSelectEvent: id => setSelection({ kind: 'event', id }), onAsk: label => openFollowUp('events', label) }));
            })(),
            deps: renderGraphTab(),
            overview: h('div', { className: css.flowWrap }, h('div', { className: css.viewSwitch }, h('button', { className: `${css.btn} ${overviewView === 'static' ? css.btnPrimary : ''}`, onClick: () => selectOverviewView('static') }, ui(language, 'viewStatic')), h('button', { className: `${css.btn} ${overviewView === 'ai' ? css.btnPrimary : ''}`, onClick: () => selectOverviewView('ai') }, ui(language, 'viewAi'))), overviewView === 'static'
                ? overviewFig.status === 'ready'
                    ? h('div', null, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, overviewFig.core.source === 'flow' ? ui(language, 'coreBadgeFlow') : ui(language, 'coreBadgeCurated')), h('span', { className: css.flowTitle }, ui(language, 'tabOverview'))), h(MermaidView, { key: 'overview', source: overviewFig.source, onSelectNode: sendNodeToDraw, onNodeContext: label => openFollowUp('overview', label) }))
                    : overviewFig.status === 'error'
                        ? h('div', { className: css.loading }, uiT(language, 'failLoad', { t: ui(language, 'tabOverview'), msg: overviewFig.message }))
                        : overviewFig.status === 'idle'
                            // 失效/从未生成 → 无数据空态（不是"正在加载"）：读路径不自动
                            // 生成，等用户点 🤖 AI 生成 或 🔁 全量重建。
                            ? noData
                            : h('div', { className: css.loading }, ui(language, 'loadingScan'))
                : dynamicFig !== null && dynamicFig.kind === 'overview' && dynamicFig.status === 'ready' && dynamicFig.diagram !== undefined
                    ? h('div', null, h('div', { className: css.flowMeta }, h('span', { className: css.badge }, ui(language, 'viewAiBadge')), h('span', { className: css.flowTitle }, dynamicFig.title ?? ui(language, 'tabOverview'))), h(MermaidView, { key: 'overview-ai', source: dynamicFig.diagram, onSelectNode: sendNodeToDraw, onNodeContext: label => openFollowUp('overview', label) }))
                    : dynamicFig !== null && dynamicFig.kind === 'overview' && dynamicFig.status === 'generating'
                        ? h('div', { className: css.loading }, ui(language, 'dynamicGenerating'))
                        : dynamicFig !== null && dynamicFig.kind === 'overview' && dynamicFig.status === 'error'
                            ? h('div', { className: css.loading }, uiT(language, 'dynamicFailed', { msg: dynamicFig.message ?? '' }))
                            : h('div', { className: css.loading }, ui(language, 'aiOverviewEmpty'))),
            // 包目录：AI 职责总结为空（未生成 / rescan 已失效）时显示空态引导，
            // 不再回退到英文 blurb（package.json description 是英文，且本仓库无
            // README.zh.md → blurbZh 为空，会误导为"英文总结"）。
            catalog: summaries === undefined || summaries === null
                ? noData
                : h(Catalog, {
                    graph,
                    onSelectPkg: id => setSelection({ kind: 'pkg', id }),
                    language,
                    summaries,
                }),
            draw: h('div', { className: css.flowWrap }, h('div', { className: css.drawBox }, h('div', { className: css.drawScenes }, h('button', {
                className: `${css.btn} ${drawFig.figureId === undefined ? css.btnPrimary : ''}`,
                onClick: newDrawScene,
            }, ui(language, 'drawNewScene')), h('span', { className: css.badge }, drawFig.figureId !== undefined ? uiT(language, 'drawSceneId', { id: drawFig.figureId }) : ui(language, 'drawSceneNew')), drawFig.saved === true && drawFig.figureId !== undefined
                ? h('span', { className: css.drawSavedBadge }, ui(language, 'drawSavedBadge'))
                : null), drawFigures.length > 0
                ? h('div', { className: css.drawSceneList }, drawFigures.map(item => h('div', {
                    key: item.figureId,
                    className: `${css.drawSceneRow} ${drawFig.figureId === item.figureId ? css.drawSceneActive : ''}`,
                }, h('button', {
                    className: `${css.btn} ${css.drawScenePick}`,
                    onClick: () => selectDrawFigure(item.figureId),
                    title: ui(language, 'drawView'),
                }, `${item.figureId}${item.title !== '' ? ` · ${item.title}` : ''}`), h('span', { className: `${css.drawSavedBadge} ${item.saved ? '' : css.drawUnsavedBadge}` }, item.saved ? ui(language, 'drawSavedBadge') : ui(language, 'drawUnsaved')), h('button', {
                    className: css.btn,
                    onClick: () => deleteDrawFigure(item.figureId),
                    title: ui(language, 'drawDelete'),
                }, ui(language, 'drawDelete')))))
                : null, h('textarea', {
                className: css.drawInput,
                ref: drawTextareaRef,
                value: drawText,
                onChange: (event) => setDrawText(event.target.value),
                placeholder: ui(language, 'drawPlaceholder'),
                rows: 3,
            }), h('div', { className: css.drawActions }, h('button', {
                className: `${css.btn} ${css.btnPrimary}`,
                onClick: drawFigure,
                disabled: drawText.trim() === '' || drawFig.status === 'generating',
            }, drawFig.status === 'generating'
                ? ui(language, 'drawWorking')
                : (drawFig.figureId !== undefined ? ui(language, 'drawFollowUp') : ui(language, 'drawBtn'))), drawFig.status === 'ready' && drawFig.saved !== true && drawFig.figureId !== undefined
                ? h('button', { className: css.btn, onClick: saveDrawFigure }, ui(language, 'drawSave'))
                : null)), drawFig.status === 'idle'
                ? h('div', { className: css.loading }, ui(language, 'drawEmpty'))
                : drawFig.status === 'generating'
                    ? h('div', { className: css.loading }, ui(language, 'drawGenerating'))
                    : drawFig.status === 'error'
                        ? h('div', { className: css.loading }, uiT(language, 'drawFailed', { msg: drawFig.message ?? '' }))
                        : h('div', null, drawFig.title !== undefined && drawFig.title !== ''
                            ? h('div', { className: css.flowMeta }, h('span', { className: css.badge }, ui(language, 'viewAiBadge')), h('span', { className: css.flowTitle }, drawFig.title))
                            : null, drawFig.diagram !== undefined
                            ? h(MermaidView, { key: `draw-${drawFig.figureId ?? 'x'}`, source: drawFig.diagram, onNodeContext: label => sendNodeToDraw(label) })
                            : null, drawFig.summary !== undefined && drawFig.summary !== ''
                            ? h('div', { className: css.drawSummary }, drawFig.summary)
                            : null, drawFig.saved === true && drawFig.figureId !== undefined
                            ? h('div', { className: css.drawSaved }, uiT(language, 'drawSceneSaved', { id: drawFig.figureId }))
                            : null)),
        };
        body = h('div', { className: css.pane }, h('div', { className: css.tip }, h('span', null, activeTip), h('span', { className: css.spacer }), METHOD_TABS.includes(tab)
            ? h('button', {
                className: `${css.btn} ${methodOn(tab) ? css.btnPrimary : ''}`,
                onClick: toggleMethodLevel,
                title: ui(language, 'methodHint'),
            }, `🔬 ${methodOn(tab) ? ui(language, 'methodOn') : ui(language, 'methodOff')}`)
            : null, 
        // 🎨 动态出图 has its own 画图 button — the tab-generic 🤖 AI 生成 /
        // 讲解此图 actions do not apply there.
        tab !== 'draw' ? h('button', { className: css.btn, onClick: aiGenerate, disabled: aiGenRunning }, aiGenRunning ? ui(language, 'aiGenWorking') : ui(language, 'btnAiGen')) : null, tab !== 'draw' ? h('button', { className: css.btn, onClick: explain }, tab === 'catalog' ? ui(language, 'btnExplainCatalog') : ui(language, 'btnExplainGraph')) : null), thinking !== null && thinking.reasoning !== ''
            ? h('div', { className: css.thinking }, h('button', {
                className: css.thinkingToggle,
                onClick: () => setThinkingOpen(value => !value),
                title: ui(language, 'thinkingHint'),
            }, `🧠 ${ui(language, 'thinkingLabel')} ${thinkingOpen ? '▾' : '▸'}`), thinkingOpen ? h('div', { className: css.thinkingBody }, thinking.reasoning) : null)
            : null, h('div', { className: css.body }, tabOrder.map(unit => h('div', {
            key: unit.id,
            className: css.unitPane,
            style: { display: tab === unit.id ? 'flex' : 'none' },
        }, unitBodies[unit.id])), 
        // 「动态画图」overlay: the generated detail diagram (seq-edge drill
        // down / flow-subgraph expansion), collapsible and closable; cached
        // results reopen instantly on later hovers. The AI-generated OVERVIEW
        // is NOT an overlay — it renders inline in the 架构概览「AI 生成」sub-tab.
        dynamicFig !== null && dynamicFig.kind !== 'overview'
            ? h('div', { className: css.dynOverlay }, h('div', { className: css.dynHead }, h('span', { className: css.dynTitle }, dynamicFig.status === 'generating'
                ? ui(language, 'dynamicGenerating')
                : dynamicFig.status === 'error'
                    ? uiT(language, 'dynamicFailed', { msg: dynamicFig.message ?? '' })
                    : (dynamicFig.title ?? ui(language, 'dynamicUntitled'))), 
            // 讲解弹层里的下钻图本身（与顶部「讲解此图」讲主图互不干扰）。
            dynamicFig.status === 'ready' && dynamicFig.diagram !== undefined
                ? h('button', {
                    className: css.btn,
                    onClick: () => explainData(uiT(language, 'dynamicExplainTitle', { t: dynamicFig.title ?? ui(language, 'dynamicUntitled') }), { title: dynamicFig.title ?? '', diagram: dynamicFig.diagram }, ui(language, 'dynamicExplainRef'), 'LLM 推断查证数据'),
                }, ui(language, 'dynamicExplain'))
                : null, h('button', {
                className: css.btn,
                onClick: () => setDynamicCollapsed(value => !value),
            }, dynamicCollapsed ? ui(language, 'dynamicExpand') : ui(language, 'dynamicCollapse')), h('button', { className: css.btn, onClick: () => setDynamicFig(null) }, '✕')), !dynamicCollapsed && dynamicFig.status === 'ready' && dynamicFig.diagram !== undefined
                ? h('div', { className: css.dynBody }, h(MermaidView, { key: `dyn-${dynamicFig.key}`, source: dynamicFig.diagram }))
                : !dynamicCollapsed && dynamicFig.status === 'generating'
                    ? h('div', { className: css.dynLoading }, ui(language, 'dynamicGenerating'))
                    : null)
            : null), h(NotesPanel, { notes, language, onLoad: loadNotes }));
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
    return h('div', { className: css.root }, header, 
    // 主面板提示条：所有 setNotice 结果（重新扫描 ✓、全量重建完成/失败、
    // 只读模式拒绝等）都必须在此可见——之前 notice 只在详情/事件 overlay
    // 里渲染，主面板操作的结果完全看不到（"没提示"）。
    notice !== null ? h('div', { className: css.notice }, notice) : null, llmStatsOpen && llmStats !== null
        ? h('div', { className: css.llmStats }, (() => {
            const hasUsage = llmStats.totalUsageInTokens > 0 || llmStats.totalUsageOutTokens > 0;
            return h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap', fontWeight: 600, marginBottom: 6 } }, h('span', null, `LLM 用量${hasUsage ? '（实际）' : '（估算）'}`), h('span', null, `${llmStats.totalCalls} 次调用`), h('span', null, hasUsage
                ? `输入 ${fmtTokens(llmStats.totalUsageInTokens)} tokens`
                : `输入 ${fmtTokens(llmStats.totalInTokens)} tokens`), h('span', null, hasUsage
                ? `输出 ${fmtTokens(llmStats.totalUsageOutTokens)} tokens`
                : `输出 ${fmtTokens(llmStats.totalOutTokens)} tokens`), h('span', null, `总耗时 ${(llmStats.totalMs / 1000).toFixed(1)}s`));
        })(), h('div', { style: { display: 'flex', gap: 6, marginBottom: 4 } }, h('button', { className: css.btn, onClick: () => setAllMethods(true) }, ui(language, 'methodAllOn')), h('button', { className: css.btn, onClick: () => setAllMethods(false) }, ui(language, 'methodAllOff')), h('span', { style: { fontSize: 10, color: '#888', alignSelf: 'center' } }, ui(language, 'methodHint'))), llmStats.records.map((record, index) => {
            const tokens = recordTokens(record);
            return h('div', { key: `${record.at}-${index}`, style: { display: 'flex', gap: 8, padding: '2px 0' } }, h('code', { style: { minWidth: 130 } }, record.label ?? record.kind), h('span', null, `${tokens.inText}→${tokens.outText} tokens${tokens.reasoning !== undefined ? ` +${tokens.reasoning} reasoning` : ''}${tokens.actual ? '' : '（估）'} · ${(record.ms / 1000).toFixed(1)}s · ${new Date(record.at).toLocaleTimeString()}`));
        }))
        : null, h('div', { className: css.body }, body), editorOpen
        ? h(PromptEditor, {
            archLens,
            config: promptConfig,
            base: config,
            onSave: next => { setPromptConfig(next); setEditorOpen(false); },
            onClose: () => setEditorOpen(false),
        })
        : null, followUpDlg !== null
        ? h('div', { className: css.followUpMask, onClick: () => { if (!followUpDlg.running)
                setFollowUpDlg(null); } }, h('div', { className: css.followUpCard, onClick: (event) => event.stopPropagation() }, h('div', { className: css.followUpTitle }, uiT(language, 'followUpTitle', { kind: followUpKindLabel(followUpDlg.kind) })), h('textarea', {
            className: css.followUpInput,
            value: followUpDlg.label,
            onChange: (event) => setFollowUpDlg(current => current === null ? null : { ...current, label: event.target.value, error: undefined }),
            placeholder: ui(language, 'followUpPlaceholder'),
            rows: 4,
            autoFocus: true,
        }), followUpDlg.error !== undefined
            ? h('div', { className: css.followUpError }, followUpDlg.error)
            : null, h('div', { className: css.followUpActions }, h('button', { className: css.btn, onClick: cancelFollowUp }, ui(language, followUpDlg.running ? 'followUpCancelRun' : 'followUpCancel')), h('button', {
            className: css.btn,
            onClick: askFollowUpExplain,
            disabled: followUpDlg.running || followUpDlg.label.trim() === '',
        }, ui(language, 'followUpExplain')), h('button', {
            className: `${css.btn} ${css.btnPrimary}`,
            onClick: runFollowUp,
            disabled: followUpDlg.running || followUpDlg.label.trim() === '',
        }, followUpDlg.running ? ui(language, 'followUpWorking') : ui(language, 'followUpRun')))))
        : null, overlay);
}
//# sourceMappingURL=arch-view.js.map