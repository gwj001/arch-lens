/**
 * AI learning-progress summary for the Arch Lens backend: reads the note
 * file, contrasts explained targets against the scanned graph, and appends
 * one model-generated progress entry (understanding level, unasked packages,
 * learning suggestions) to the bottom of ARCH-NOTES.md. Cached per language;
 * `force` regenerates and appends a fresh entry.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/progress
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import { parseNotes } from './notes.ts';
import type { ArchLensGraph, ArchLensProgressResult } from './types.ts';
/**
 * Generate (or read cached) an AI learning-progress summary and append it to
 * the note file. The summary contrasts already-explained targets against the
 * scanned packages and asks the model for understanding level, gaps, and
 * next-step suggestions in the role language.
 * @param ctx - host context carrying llm and agentDefaultModel services.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param graph - scanned graph.
 * @param notesFile - note file name.
 * @param language - role language for the summary (default '中文').
 * @param force - regenerate even when a cached summary exists.
 * @returns the progress result, or an error result.
 */
export declare function summarizeProgress(ctx: Context, fs: FileSystem, root: string, graph: ArchLensGraph, notesFile: string, language: string, force: boolean, sandboxPolicy?: SandboxExecutionPolicy): Promise<ArchLensProgressResult | {
    error: string;
}>;
/** Parse-only export so the Remote method can report asked/unasked without LLM. */
export declare function progressStats(fs: FileSystem, root: string, graph: ArchLensGraph, notesFile: string): Promise<{
    asked: string[];
    unasked: string[];
    total: number;
    progress: number;
} | {
    error: string;
}>;
/** Re-export for callers that want the parsed entries directly. */
export { parseNotes };
//# sourceMappingURL=progress.d.ts.map