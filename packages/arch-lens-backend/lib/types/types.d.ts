/**
 * Wire types for the Arch Lens backend service.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/types
 */
/** One scanned package node of the workspace graph. */
export interface ArchLensPackageNode {
    /** Short package name (dsh- prefix stripped). */
    id: string;
    /** Same as id; kept for symmetry with the client view. */
    short: string;
    /** packages/<group> directory name ('' for flat packages/<pkg> layouts). */
    group: string;
    /** First README paragraph, trimmed. */
    blurb: string;
    /** First paragraph of README.zh.md, when present (localized duty text). */
    blurbZh?: string;
    /** src/ file names (bounded). */
    files: string[];
    /** dsh-* peer dependency short names. */
    deps: string[];
    /** Absolute package directory path. */
    path: string;
    /** Precomputed popup detail, sent with the graph so clicks open instantly. */
    detail: ArchLensComponentDetail;
}
/** One dependency edge between scanned nodes. */
export interface ArchLensEdge {
    from: string;
    to: string;
}
/**
 * Display label for a package group. `''` means a flat `packages/<pkg>`
 * layout (the node has no group directory); render it as `packages` so
 * subgraphs/entities never carry an empty label.
 * @param group - the node's group name ('' for flat layouts).
 * @returns the display label.
 */
export declare function groupLabel(group: string): string;
/** The complete scanned workspace graph. */
export interface ArchLensGraph {
    /** Absolute workspace root that was scanned. */
    root: string;
    /** Sorted group directory names. */
    groups: string[];
    nodes: ArchLensPackageNode[];
    edges: ArchLensEdge[];
}
/** Role classification of one src file. */
export type ArchLensFileRole = 'entry' | 'types' | 'invariant' | 'assembly' | 'test' | '';
/** One src file of a package with its role guess. */
export interface ArchLensFileRef {
    name: string;
    role: ArchLensFileRole;
}
/** Per-package detail projection for the client popup. */
export interface ArchLensComponentDetail {
    id: string;
    short: string;
    group: string;
    blurb: string;
    files: ArchLensFileRef[];
    /** dsh-* dependency short names. */
    deps: string[];
    /** Packages that depend on this one. */
    dependents: string[];
    /** Entry source head, condensed (bounded). */
    snippet: string;
    /** Registration lines extracted from the entry source. */
    keyLines: string[];
}
/** One recorded note entry, newest first. */
export interface ArchLensNoteEntry {
    time: string;
    target: string;
    preview: string;
}
/** The note file listing response. */
export interface ArchLensNotesResult {
    path: string;
    entries: ArchLensNoteEntry[];
}
/** Error result shape shared by all remote methods. */
export interface ArchLensError {
    error: string;
}
/** Editable prompt configuration, persisted per workspace. */
export interface ArchLensPromptConfig {
    /** Overview explain prompt template; `{root}`/`{core}` placeholders allowed. */
    overviewPrompt?: string;
    /** Unit explain style appended to component/event/data questions. */
    explainStyle?: string;
    /** Output language for all explanations and summaries (default '中文'). */
    language?: string;
    /** Use the per-language default templates instead of the saved overrides (default: inferred). */
    useDefaults?: boolean;
}
/** The persisted prompt configuration plus its storage path. */
export interface ArchLensPromptConfigResult {
    path: string;
    config: ArchLensPromptConfig;
}
/** One concept-tree node over the Remote boundary (recursive, fully constrained). */
export interface ArchLensConceptNode {
    id: string;
    name: string;
    desc: string;
    inside?: string;
    pkg?: string;
    children?: ArchLensConceptNode[];
    /** 'doc' = extracted from an architecture doc; 'flow' = LLM-induced from code metadata. */
    source?: 'doc' | 'flow';
    /** Source anchor: doc path + heading (e.g. "docs/architecture.md#Profiles-and-bundles"). */
    ref?: string;
    /** The section's full original text (bounded) — the evidence for explains. */
    sourceText?: string;
}
/**
 * Live generation status of the workspace (⚙️ 生成过程 box): what the LLM
 * is currently doing for the arch-lens figures. Written by every streaming
 * LLM call (llmText and the direct loops) into the per-root status slot and
 * delivered to the panel with push semantics (long-poll).
 */
export interface GenerationStatus {
    /** Whether a generation is streaming right now. */
    active: boolean;
    /** Human stage label (e.g. `LLM：analysis-figures`). */
    stage: string;
    /** Milliseconds since the current call started. */
    elapsedMs: number;
    /** Accumulated output characters of the current call. */
    outputChars: number;
    /** Tail of the streamed output (reasoning tail while the model is still
     * thinking, else the text tail) — bounded to ~300 chars. */
    preview: string;
    /** Monotonic change counter: every status mutation increments it, so a
     * long-poll push resumes from the last seen seq instead of polling on a
     * fixed interval (SSE-like latency, one in-flight request at a time). */
    seq: number;
}
/**
 * Flow-diagram generation viewpoints (profile `flow` field + flow chain).
 * Both viewpoints are generated together in ONE LLM call and served per
 * angle; doc flows stay angle-independent. ('overview' was dropped: it read
 * like the main-flow sequence and cost an extra call.)
 */
export type FlowAngle = 'event' | 'pipeline';
/**
 * One flow diagram over the Remote boundary: mermaid flowchart source plus
 * provenance for explains. source 'doc' means the diagram came from the
 * architecture doc (verbatim mermaid block, or an LLM format-transcode of a
 * pseudo-code flow block — semantics unchanged); 'flow' means the LLM induced
 * it from code metadata and it is non-authoritative.
 */
export interface ArchLensFlowResult {
    /** Diagram title (doc heading for doc flows, LLM title for induced flows). */
    title: string;
    /** 'doc' = from the architecture doc; 'flow' = LLM-induced from code. */
    source: 'doc' | 'flow';
    /** Source anchor: doc path + heading (doc flows only). */
    ref?: string;
    /** The flow block's original text (bounded) — verbatim evidence for explains. */
    sourceText?: string;
    /** Generation viewpoint of induced flows (absent for doc flows). */
    angle?: FlowAngle;
    /** Mermaid flowchart source rendered by the figure. */
    mermaid: string;
    /** D3 extension point: an optional natural-language description of what
     * this figure shows (LLM-authored later; the doc renders it below the
     * figure when present). Absent = no description yet. */
    description?: string;
}
/** One call message (from → to, with a short action label). */
export interface ArchLensSequenceMessage {
    from: string;
    to: string;
    label: string;
    /** The full set of called symbols on this edge (beyond the label's cap),
     * as evidence for explains. */
    syms?: string[];
    /** Sample caller source file (workspace-relative), as evidence for explains. */
    file?: string;
}
/** Role classification of one package in the call-graph figure. */
export type ArchLensSequenceRole = 'entry' | 'hub' | 'leaf';
/** One package node of the call-graph figure with role metadata. */
export interface ArchLensSequenceNode {
    id: string;
    /** 'entry' = cited by nobody and orchestrating ≥2 packages (flow source);
     * 'hub' = cited by ≥2 packages (shared service); 'leaf' = everything else. */
    role: ArchLensSequenceRole;
    /** How many distinct packages cite this one within the figure (in-degree). */
    citedBy: number;
    /** How many distinct packages this one cites within the figure (out-degree). */
    cites: number;
    /** Workspace-relative sample path (entry file, or first source file). */
    path: string;
}
/**
 * One call-graph figure over the Remote boundary: messages plus provenance.
 * source 'code' = derived from real source-level call edges (static call
 * graph, authoritative for what the code CAN call — NOT a temporal
 * sequence); 'doc' = verbatim extraction from the architecture doc's
 * sequence section (a main-flow sequence); 'flow' = LLM-induced from code
 * metadata (a main-flow sequence, non-authoritative).
 */
export interface ArchLensSequenceResult {
    /** 'code' = static call graph; 'doc' = doc section extraction; 'flow' = LLM-induced. */
    source: 'code' | 'doc' | 'flow';
    /** Messages (from → to, with a short action label). */
    messages: ArchLensSequenceMessage[];
    /** Per-package role metadata for the packages appearing in the figure
     * (present on the code-sourced figure). */
    nodes?: ArchLensSequenceNode[];
    /** Source anchor: doc path + heading (doc source only). */
    ref?: string;
    /** D3 extension point (see ArchLensFlowResult.description). */
    description?: string;
}
/**
 * The core-flow package selection over the Remote boundary: which packages
 * form the project's core flow, plus provenance. The diagram edges are
 * derived by rules (source-level imports) over the selected ids, so only the
 * selection itself carries a source. 'flow' = LLM-picked (non-authoritative);
 * 'curated' = deterministic fallback (entry packages plus their import
 * neighbors) when the LLM pick fails.
 */
export interface ArchLensCoreGraph {
    /** Selected core package ids (validated against the index). */
    ids: string[];
    /** 'flow' = LLM-picked; 'curated' = deterministic rule fallback. */
    source: 'flow' | 'curated';
    /** Optional provenance note (e.g. the fallback rule), for explains. */
    ref?: string;
    /** D3 extension point (see ArchLensFlowResult.description). */
    description?: string;
}
/** AI learning-progress summary over the note file, appended to it on generation. */
export interface ArchLensProgressResult {
    /** Note file name (ARCH-NOTES.md). */
    path: string;
    /** The generated progress summary text (role language). */
    summary: string;
    /** Targets already explained (note targets). */
    asked: string[];
    /** Package ids not yet explained. */
    unasked: string[];
    /** Total explainable packages. */
    total: number;
    /** Percentage of packages explained (0-100). */
    progress: number;
}
/** One code-derived insight for a package. */
export interface ArchLensCodeInsight {
    /** Package short id. */
    id: string;
    /** Services this package provides (ctx.provide / extends Service / TypertRemoteService). */
    provides: string[];
    /** Events this package listens to (ctx.on / @Remote / on(...)). */
    listens: string[];
    /** Tools this package registers (tools.register / defineTool). */
    tools: string[];
    /** Remote method export names. */
    remotes: string[];
}
/** Provider-reported token usage, normalized from the LLM stream's `usage`
 * chunk (dsh-llm TokenUsage). Present only when the adapter emits one. */
export interface LlmUsageRecord {
    /** Billed input: uncached input + cache-read + cache-write tokens. */
    inTokens: number;
    /** Output tokens (completion). */
    outTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    /** Reasoning/thinking tokens, when the provider reports them separately. */
    reasoningTokens?: number;
}
/** One recorded LLM usage entry (see llm-stats.ts for the estimation rule). */
export interface LlmCallRecord {
    /** Call site kind: concept / flow / flow-transcode / seq / events / core /
     * duties / progress / docs-section / docs-full / analysis-structure /
     * analysis-figures / llm (default). Session-driven kinds: figure
     * (🤖 AI 生成 / 动态下钻), draw (🎨 动态出图), explain (讲解), followup
     * (追问重画 — direct llmText). */
    kind: string;
    /** Human-readable label for session-driven calls (e.g. 「AI 生成」); absent
     * for plain direct calls. */
    label?: string;
    /** Epoch milliseconds when the call finished. */
    at: number;
    inChars: number;
    outChars: number;
    estInTokens: number;
    estOutTokens: number;
    /** Provider-reported usage, when the stream emitted a `usage` chunk. */
    usage?: LlmUsageRecord;
    /** Wall time of the call in milliseconds. */
    ms: number;
}
/** LLM usage accounting snapshot: totals plus the newest records. */
export interface LlmStatsSnapshot {
    totalCalls: number;
    totalInTokens: number;
    totalOutTokens: number;
    /** Provider-reported input/output totals (0 when no usage chunks arrived). */
    totalUsageInTokens: number;
    totalUsageOutTokens: number;
    totalMs: number;
    /** Newest first, capped at 10 (totals above cover EVERY recorded call,
     * persisted across restarts so history is never lost). */
    records: LlmCallRecord[];
}
/** One interaction event row (shared by the events figure and the profile). */
export interface ArchLensEventRow {
    event: string;
    mode: string;
    producers: string[];
    consumers: string[];
    note: string;
}
/** Figure kinds that support in-place follow-up redraw (原地追问重画). */
export type FollowUpKind = 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview';
/**
 * Supported doc sections (one per figure/tab dimension). Public boundary
 * type (typert requires Remote param types on a public type subpath).
 * 'flow' (D2a) renders BOTH registry viewpoints in one section.
 */
export type DocKind = 'concepts' | 'flow' | 'seq' | 'interaction' | 'deps' | 'er' | 'catalog';
/** 原地追问重画的结果：与各 tab 正常 RPC 返回形状一致，客户端直接回填 tab 状态。 */
export type FollowUpResult = ArchLensFlowResult | ArchLensSequenceResult | ArchLensConceptNode[] | ArchLensEventRow[] | {
    kind: 'flowchart';
    source: string;
    core: ArchLensCoreGraph;
} | {
    title: string;
    diagram: string;
    kind: 'overview';
    targetKey: string;
};
/**
 * Per-tab "AI generate" result: the regenerated shared-profile field for one
 * figure. Each tab regenerates ONLY its own field (one trimmed-summary LLM
 * call); the client renders the returned data directly. The flow field
 * regenerates BOTH viewpoints in that one call (they are generated together
 * everywhere, so switching angles is instant).
 */
export type RegenerateFigureResult = {
    kind: 'concepts';
    tree: ArchLensConceptNode[];
} | {
    kind: 'seq';
    messages: ArchLensSequenceMessage[];
} | {
    kind: 'flow';
    flows: Partial<Record<FlowAngle, ArchLensFlowResult>>;
} | {
    kind: 'interaction';
    events: ArchLensEventRow[];
} | {
    kind: 'core';
    core: ArchLensCoreGraph;
};
/** Per-rescan workspace change facts (files + packages), returned by refresh
 * when a rebuild ran — the "变动的事实依据" the client shows and the
 * selective invalidation consumed server-side. */
export interface WorkspaceChanges {
    /** Newly discovered file paths (workspace-relative). */
    added: string[];
    /** Files whose content genuinely changed. */
    modified: string[];
    /** Files removed since the last rescan. */
    removed: string[];
    /** Package short ids affected by file changes OR package add/remove. */
    changedPackages: string[];
    /** Package ids present in the new graph but not the old. */
    addedPackages: string[];
    /** Package ids present in the old graph but not the new. */
    removedPackages: string[];
}
//# sourceMappingURL=types.d.ts.map