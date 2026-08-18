/**
 * Arch Lens backend host service: workspace graph scanning, component detail
 * projection, and answer-level note recording. Read-only graph/component/notes
 * methods cross to the browser via Typert Remote; note file WRITES have exactly
 * one path — the session/event listener below. notePending only stages in-memory
 * question metadata; it never touches the file.
 * @module @deepseek-ai/dsh-arch-lens-backend
 */
import { Context, Service } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import s from '@deepseek-ai/schemastery';
import type { ArchLensCodeInsight, ArchLensComponentDetail, ArchLensConceptNode, ArchLensCoreGraph, ArchLensFlowResult, ArchLensGraph, ArchLensNotesResult, ArchLensProgressResult, ArchLensPromptConfig, ArchLensPromptConfigResult } from './types.ts';
export * from './types.ts';
/** Optional deployment configuration. */
export interface Config {
    /** Note file name in the workspace root (default ARCH-NOTES.md). */
    notesFile?: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        archLens: ArchLensService;
    }
}
/**
 * The Arch Lens backend Remote service (`ctx.archLens`).
 */
export declare class ArchLensService extends TypertRemoteService {
    static inject: string[];
    /** Loader validation for the optional note file name. */
    static Config: s<Config>;
    private readonly notesFile;
    /** Per-workspace scan cache: keyed by the resolved workspace root, so
     * re-loading the desk on the same workspace never rescans, while switching
     * to a different workspace rescans automatically on the next graph(). */
    private graphCaches;
    /** One in-flight scan (root + promise) so concurrent callers share one scan
     * per root; a scan of another root can run alongside without clobbering it. */
    private graphInFlight;
    private pending;
    /** Session whose cwd anchors the workspace root; null falls back to the sandbox policy. */
    private targetSessionId;
    /**
     * @param ctx - host context carrying fs and sandboxPolicy.
     * @param config - optional notes file name.
     */
    constructor(ctx: Context, config?: Config);
    /** Resolve the workspace root from the target session's cwd, else the sandbox policy. */
    private resolveRoot;
    /** Scan (with cache) the workspace package tree; concurrent callers share
     * one scan per root. Cache-first: a previously scanned workspace (any
     * session of it) resolves instantly; only a new root triggers a scan. */
    private graph;
    /**
     * The scanned workspace graph (cached until refresh).
     * @returns graph or error.
     */
    remoteGraph(): Promise<ArchLensGraph | {
        error: string;
    }>;
    /**
     * Rescan = REBUILD EVERY fact source: invalidate the scan graph, the
     * code-index (in-memory + disk), and the AI caches (concept tree /
     * sequence / events). The next read of any figure re-derives from current
     * code and docs — no stale fact may survive a rescan.
     * @returns the fresh scan graph or error.
     */
    remoteRefresh(): Promise<ArchLensGraph | {
        error: string;
    }>;
    /**
     * Refresh only the code-index facts (in-memory + disk invalidated). Used by
     * "refresh this figure": the figure then re-derives from a fresh index.
     * @returns acknowledgement.
     */
    remoteRefreshIndex(): Promise<{
        ok: true;
    }>;
    /**
     * Load the desk's data source for one session's workspace — a pure LOAD,
     * never an invalidation: only the target session id is set, and no cache is
     * touched. The scan cache is keyed by workspace root, so re-loading the
     * same workspace (reopening the panel, switching between its sessions) is
     * instant, while a different workspace rescans automatically on the next
     * graph() call. Explicit invalidation stays exclusively on refresh().
     * @param sessionId - target session id, or null for the policy root.
     * @returns acknowledgement.
     */
    remoteLoad(sessionId: string | null): Promise<{
        ok: true;
    }>;
    /** Invalidate the code-index for the workspace (no-op when unavailable). */
    private refreshCodeIndex;
    /** Remove the per-language AI caches (concept tree / sequence / events). */
    private removeAICaches;
    /**
     * Detail projection for one package. The graph carries precomputed details,
     * so this is a plain lookup (kept as a Remote for compatibility).
     * @param request - package id.
     * @returns detail or error.
     */
    remoteComponent(request: {
        id: string;
    }): Promise<ArchLensComponentDetail | {
        error: string;
    }>;
    /**
     * The note file listing, newest first.
     * @returns notes listing or an error.
     */
    remoteNotes(): Promise<ArchLensNotesResult | {
        error: string;
    }>;
    /**
     * Mermaid dependency flowchart for the scanned graph.
     * @returns flowchart source or an error.
     */
    remoteMermaidDeps(): Promise<{
        kind: 'flowchart';
        source: string;
    } | {
        error: string;
    }>;
    /**
     * Mermaid ER diagram of package relationships for the scanned graph.
     * @returns erDiagram source or an error.
     */
    remoteMermaidEr(): Promise<{
        kind: 'erDiagram';
        source: string;
    } | {
        error: string;
    }>;
    /**
     * Mermaid diagrams over the code-index imports: source-level dependency
     * edges (real imports) instead of npm peerDependencies. Falls back to the
     * scanned-graph variants when the codeIndex service or a language is absent.
     * @param request - diagram kind.
     * @returns mermaid source or an error.
     */
    remoteMermaidIndexed(request: {
        kind: 'flowchart' | 'erDiagram';
    }): Promise<{
        kind: 'flowchart' | 'erDiagram';
        source: string;
    } | {
        error: string;
    }>;
    /**
     * Core-flow diagram (deps/ER overview): the LLM-selected core packages with
     * rule-derived source-import edges. Returns the mermaid source plus the
     * selection provenance so the client can badge/explain it.
     * @param request - diagram kind, role language, and whether to force a new selection.
     * @returns mermaid source and core selection, or an error.
     */
    remoteMermaidCore(request: {
        kind: 'flowchart' | 'erDiagram';
        language?: string;
        force?: boolean;
    }): Promise<{
        kind: 'flowchart' | 'erDiagram';
        source: string;
        core: ArchLensCoreGraph;
    } | {
        error: string;
    }>;
    /** Shared codeIndex accessor for the concept/docs remotes. */
    private codeIndexService;
    /**
     * Session-scoped sandbox policy for every file write: the fs sandbox
     * derives its workspace-write root from the calling session's cwd — the
     * same root this service writes to — so passing it approves the writes.
     */
    private sessionPolicy;
    /**
     * Concept hierarchy via the one-way chain: architecture doc (extract +
     * LLM enhance) first, LLM-from-flow as fallback. Cached per language.
     * @param request - role language and whether to force regeneration.
     * @returns concept-tree nodes or an error.
     */
    remoteConceptTree(request: {
        language?: string;
        force?: boolean;
    }): Promise<ArchLensConceptNode[] | {
        error: string;
    }>;
    /**
     * Generate the complete architecture doc (global button): one LLM pass
     * writes concept/sequence/interaction/dependency/ER/catalog sections.
     * @param request - role language.
     * @returns the doc path or an error.
     */
    remoteGenerateDocs(request: {
        language?: string;
    }): Promise<{
        path: string;
    } | {
        error: string;
    }>;
    /**
     * Generate one doc section on demand (per-tab "AI generate"). Sequence and
     * interaction also refresh their structured caches.
     * @param request - section kind and role language.
     * @returns the doc path or an error.
     */
    remoteGenerateDocSection(request: {
        kind: 'concepts' | 'seq' | 'interaction' | 'deps' | 'er' | 'catalog';
        language?: string;
    }): Promise<{
        path: string;
    } | {
        error: string;
    }>;
    /**
     * Structured figure data for the sequence tab: LLM-generated from the code
     * index (cached per language); the client renders an empty state when this
     * this returns null.
     * @param request - role language.
     * @returns message array, null, or an error.
     */
    remoteSequence(request: {
        language?: string;
    }): Promise<Array<{
        from: string;
        to: string;
        label: string;
    }> | null | {
        error: string;
    }>;
    /**
     * Structured figure data for the interaction tab (cached per language).
     * @param request - role language.
     * @returns event array, null, or an error.
     */
    remoteEvents(request: {
        language?: string;
    }): Promise<Array<{
        event: string;
        mode: string;
        producers: string[];
        consumers: string[];
        note: string;
    }> | null | {
        error: string;
    }>;
    /**
     * Flow diagram via the dual chain: architecture doc flow block first
     * (verbatim mermaid, or LLM transcode of a pseudo-code block — both
     * `source: 'doc'` with an anchor), LLM induction from code metadata as the
     * fallback (`source: 'flow'`, non-authoritative). Cached per language.
     * @param request - role language and whether to force regeneration.
     * @returns the flow diagram or an error.
     */
    remoteFlow(request: {
        language?: string;
        force?: boolean;
    }): Promise<ArchLensFlowResult | {
        error: string;
    }>;
    /**
     * Code-derived insights: services/events/tools/remotes extracted from each
     * package's entry source. This is the "code-first" view — documentation is
     * a reference, but the analysis never depends on it.
     * @returns insight records or an error.
     */
    remoteAnalyze(): Promise<ArchLensCodeInsight[] | {
        error: string;
    }>;
    /**
     * AI one-line duty summaries for the package catalog, in the role language.
     * @param request - output language (default 中文).
     * @returns id → summary map, or an error.
     */
    remoteSummarizeDuties(request: {
        language?: string;
    }): Promise<Record<string, string> | {
        error: string;
    }>;
    /**
     * AI learning-progress summary: contrasts the note targets against the
     * scanned graph and appends a model-generated entry to the note file bottom.
     * @param request - role language and whether to force regeneration.
     * @returns progress stats plus the generated summary, or an error.
     */
    remoteProgress(request: {
        language?: string;
        force?: boolean;
    }): Promise<ArchLensProgressResult | {
        error: string;
    }>;
    /**
     * Read-only learning-progress statistics (no LLM call).
     * @returns asked/unasked lists and the coverage percentage.
     */
    remoteProgressStats(): Promise<{
        asked: string[];
        unasked: string[];
        total: number;
        progress: number;
    } | {
        error: string;
    }>;
    /**
     * Stage question metadata for the next assistant/message answer. Memory
     * only — the file write stays exclusively on the event path below.
     * @param request - target label, question text, and calling session id.
     * @returns acknowledgement.
     */
    remoteNotePending(request: {
        target: string;
        text: string;
        sessionId?: string;
    }): Promise<{
        ok: true;
    }>;
    /**
     * Clear any staged question metadata — called by the desk after a failed
     * explain send so no later ordinary assistant/message gets mis-recorded as
     * an explain. Memory only; the note write stays on the event path.
     * @returns acknowledgement.
     */
    remoteNotePendingClear(): Promise<{
        ok: true;
    }>;
    /**
     * Read the persisted per-workspace prompt configuration.
     * @returns the config and its storage path.
     */
    remotePromptConfig(): Promise<ArchLensPromptConfigResult>;
    /**
     * Persist the per-workspace prompt configuration.
     * @param request - config fields to store (absent fields keep their stored value).
     * @returns the stored config and its path.
     */
    remotePromptConfigSave(request: ArchLensPromptConfig): Promise<ArchLensPromptConfigResult | {
        error: string;
    }>;
    /** Register the single note-write path: assistant/message events. */
    protected [Service.init](): Promise<void>;
    /** Policy-derived workspace root, used only when the event session has no cwd. */
    private rootFromPolicy;
}
export default ArchLensService;
//# sourceMappingURL=index.d.ts.map