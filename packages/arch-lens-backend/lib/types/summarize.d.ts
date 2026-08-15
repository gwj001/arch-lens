/**
 * AI duty summaries for the package catalog: one batched LLM call turns every
 * package's official description into a one-line summary in the configured
 * role language. Results are cached per workspace so rescans do not re-call
 * the model.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/summarize
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { ArchLensGraph } from './types.ts';
/**
 * Generate (or read cached) one-line AI duty summaries for every scanned
 * package, in the configured role language.
 * @param ctx - host context carrying llm and agentDefaultModel services.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param graph - scanned graph.
 * @param language - role language for the summaries (default '中文').
 * @returns id → summary map, or an error result.
 */
export declare function summarizeDuties(ctx: Context, fs: FileSystem, root: string, graph: ArchLensGraph, language: string): Promise<Record<string, string> | {
    error: string;
}>;
//# sourceMappingURL=summarize.d.ts.map