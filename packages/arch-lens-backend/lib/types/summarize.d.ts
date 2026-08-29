/**
 * AI duty summaries for the package catalog: one batched LLM call turns every
 * package's official description into a one-line summary in the configured
 * role language. Results are cached per workspace so rescans do not re-call
 * the model.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/summarize
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { ArchLensGraph } from './types.ts';
/**
 * The AUTHORITATIVE duty-summaries cache file name, exported for the figure
 * registry (`figures.ts`): consumers must never re-spell cache names.
 * @param language - role language.
 * @returns the CACHE_DIR-relative cache file name.
 */
export declare function summariesCacheName(language: string): string;
/**
 * READ-ONLY duty summaries: serve the versioned cache (facts version must
 * match); null when absent/stale. NEVER generates — generation is owned by
 * the write paths (「🤖 AI 生成」 on the catalog tab).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @returns the cached id → summary map (possibly partial), or null when the
 *   cache file is missing, stale or corrupt.
 */
export declare function readDutySummaries(fs: FileSystem, root: string, language: string): Promise<Record<string, string> | null>;
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
export declare function summarizeDuties(ctx: Context, fs: FileSystem, root: string, graph: ArchLensGraph, language: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<Record<string, string> | {
    error: string;
}>;
//# sourceMappingURL=summarize.d.ts.map