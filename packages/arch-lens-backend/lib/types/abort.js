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
const controllers = new Map();
const slots = new WeakMap();
/** Preview bound: keep only the tail of the streamed output. */
const PREVIEW_MAX = 300;
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
/** The status slot attached to one root's live signal (created on demand). */
function slotFor(signal) {
    let slot = slots.get(signal);
    if (slot === undefined) {
        slot = {
            startedAt: Date.now(),
            status: { active: false, stage: '', elapsedMs: 0, outputChars: 0, preview: '' },
        };
        slots.set(signal, slot);
    }
    return slot;
}
/**
 * Mark a generation as active for the given signal (a new LLM call started).
 * @param signal - the root's generation signal (optional callers skip status).
 * @param stage - human stage label (e.g. `LLM：analysis-figures`).
 */
export function beginGenerationStage(signal, stage) {
    if (signal === undefined)
        return;
    const slot = slotFor(signal);
    slot.startedAt = Date.now();
    slot.status = { active: true, stage, elapsedMs: 0, outputChars: 0, preview: '' };
}
/**
 * Update the live status while a generation streams.
 * @param signal - the root's generation signal.
 * @param outputChars - accumulated output characters of the current call.
 * @param preview - the preview tail (reasoning tail while thinking, else text).
 */
export function reportGeneration(signal, outputChars, preview) {
    if (signal === undefined)
        return;
    const slot = slotFor(signal);
    slot.status = {
        ...slot.status,
        active: true,
        elapsedMs: Date.now() - slot.startedAt,
        outputChars,
        preview: preview.slice(-PREVIEW_MAX),
    };
}
/** Mark the current generation finished (active=false keeps the last label). */
export function endGenerationStage(signal) {
    if (signal === undefined)
        return;
    const slot = slotFor(signal);
    slot.status = { ...slot.status, active: false, elapsedMs: Date.now() - slot.startedAt };
}
/** Tail helper for streaming callers: keep the last PREVIEW_MAX chars. */
export function tailPreview(accumulated, delta) {
    return `${accumulated}${delta}`.slice(-PREVIEW_MAX);
}
/**
 * The current live generation status of one workspace root (null when no
 * signal was ever created — nothing generated yet).
 * @param root - absolute workspace root.
 * @returns the status, or null.
 */
export function currentGenerationStatus(root) {
    const controller = controllers.get(root);
    if (controller === undefined)
        return null;
    const slot = slots.get(controller.signal);
    return slot === undefined ? null : slot.status;
}
//# sourceMappingURL=abort.js.map