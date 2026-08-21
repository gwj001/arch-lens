/**
 * Generation abort registry: one AbortController per workspace root, created
 * lazily. Every LLM call of the arch-lens chains (llmText and the direct
 * prepareCall loops) receives `generationSignal(root)` and honors it between
 * stream chunks; the client's「⏹ 终止」button calls the cancelGeneration
 * remote, which aborts the active controller — the provider stream is
 * cancelled promptly instead of burning tokens until it finishes.
 *
 * A controller is replaced automatically after it aborts, so the next
 * generation for the same root gets a fresh signal.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/abort
 */
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
//# sourceMappingURL=abort.d.ts.map