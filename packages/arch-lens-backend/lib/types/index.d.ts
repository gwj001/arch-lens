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
import type { ArchLensCodeInsight, ArchLensComponentDetail, ArchLensGraph, ArchLensNotesResult, ArchLensPromptConfig, ArchLensPromptConfigResult } from './types.ts';
export type * from './types.ts';
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
    private graphCache;
    private graphInFlight;
    private pending;
    /**
     * @param ctx - host context carrying fs and sandboxPolicy.
     * @param config - optional notes file name.
     */
    constructor(ctx: Context, config?: Config);
    /** Resolve the workspace root from the session sandbox policy. */
    private resolveRoot;
    /** Scan (with cache) the workspace package tree; concurrent callers share one scan. */
    private graph;
    /**
     * The scanned workspace graph (cached until refresh).
     * @returns graph or error.
     */
    remoteGraph(): Promise<ArchLensGraph | {
        error: string;
    }>;
    /**
     * Invalidate the graph cache and rescan.
     * @returns the fresh graph or error.
     */
    remoteRefresh(): Promise<ArchLensGraph | {
        error: string;
    }>;
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
     * Code-derived insights: services/events/tools/remotes extracted from each
     * package's entry source. This is the "code-first" view — documentation is
     * a reference, but the analysis never depends on it.
     * @returns insight records or an error.
     */
    remoteAnalyze(): Promise<ArchLensCodeInsight[] | {
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