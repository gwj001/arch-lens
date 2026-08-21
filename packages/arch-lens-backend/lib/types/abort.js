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
const controllers = new Map();
/**
 * The active abort signal for one workspace root (created on first use;
 * a fresh controller is allocated after a previous abort).
 * @param root - absolute workspace root.
 * @returns the live AbortSignal.
 */
export function generationSignal(root) {
    const existing = controllers.get(root);
    if (existing !== undefined && !existing.signal.aborted)
        return existing.signal;
    const next = new AbortController();
    controllers.set(root, next);
    return next.signal;
}
/**
 * Abort every in-flight generation for one workspace root.
 * @param root - absolute workspace root.
 * @returns whether an active controller was aborted.
 */
export function abortGeneration(root) {
    const existing = controllers.get(root);
    if (existing === undefined)
        return false;
    existing.abort();
    return true;
}
/** Sentinel error message for aborted generations (callers surface it as-is). */
export const ABORTED_MESSAGE = 'generation aborted';
//# sourceMappingURL=abort.js.map