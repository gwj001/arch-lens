/**
 * Generation abort registry: one AbortController per workspace root, created
 * lazily. Every LLM call of the arch-lens chains (llmText and the direct
 * prepareCall loops) receives `generationSignal(root)` and honors it between
 * stream chunks; the client's「⏹ 终止」button calls the cancelGeneration
 * remote, which aborts the active controller — the provider stream is
 * cancelled promptly instead of burning tokens until it finishes.
 *
 * The same per-root signal carries the LIVE GENERATION STATUS (⚙️ 生成过程):
 * each streaming call writes its stage / elapsed / output preview (including
 * the reasoning tail) into a slot keyed by the signal object, and the
 * generationStatus remote reads the current root's slot. Keying by signal
 * (WeakMap) means llmText never needs to know the root.
 *
 * A controller is replaced automatically after it aborts, so the next
 * generation for the same root gets a fresh signal (and a fresh slot).
 * @module @deepseek-ai/dsh-arch-lens-backend/src/abort
 */
import type { GenerationStatus } from './types.ts';
/**
 * The active abort signal for one workspace root (created on first use;
 * a fresh controller is allocated after a previous abort).
 * @param root - absolute workspace root.
 * @returns the live AbortSignal.
 */
export declare function generationSignal(root: string): AbortSignal;
/**
 * Abort every in-flight generation for one workspace root.
 * @param root - absolute workspace root.
 * @returns whether an active controller was aborted.
 */
export declare function abortGeneration(root: string): boolean;
/** Sentinel error message for aborted generations (callers surface it as-is). */
export declare const ABORTED_MESSAGE = "generation aborted";
/**
 * Mark a generation as active for the given signal (a new LLM call started).
 * @param signal - the root's generation signal (optional callers skip status).
 * @param stage - human stage label (e.g. `LLM：analysis-figures`).
 */
export declare function beginGenerationStage(signal: AbortSignal | undefined, stage: string): void;
/**
 * Update the live status while a generation streams.
 * @param signal - the root's generation signal.
 * @param outputChars - accumulated output characters of the current call.
 * @param preview - the preview tail (reasoning tail while thinking, else text).
 */
export declare function reportGeneration(signal: AbortSignal | undefined, outputChars: number, preview: string): void;
/** Mark the current generation finished (active=false keeps the last label). */
export declare function endGenerationStage(signal: AbortSignal | undefined): void;
/** Tail helper for streaming callers: keep the last PREVIEW_MAX chars. */
export declare function tailPreview(accumulated: string, delta: string): string;
/**
 * The current live generation status of one workspace root (null when no
 * signal was ever created — nothing generated yet).
 * @param root - absolute workspace root.
 * @returns the status, or null.
 */
export declare function currentGenerationStatus(root: string): GenerationStatus | null;
//# sourceMappingURL=abort.d.ts.map