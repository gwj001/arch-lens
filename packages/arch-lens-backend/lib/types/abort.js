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
 * the reasoning tail) into a slot keyed by the signal object. Status changes
 * bump a per-slot seq counter and wake registered waiters, so the panel
 * receives pushes with SSE-like latency via ONE long-poll request at a time
 * (no fixed-interval polling, zero idle traffic) — all inside the RPC
 * channel, no harness changes.
 *
 * A controller is replaced automatically after it aborts, so the next
 * generation for the same root gets a fresh signal (and a fresh slot).
 * @module @deepseek-ai/dsh-arch-lens-backend/src/abort
 */
const controllers = new Map();
const slots = new WeakMap();
const waiters = new Map();
/** Preview bound: keep only the tail of the streamed output. */
const PREVIEW_MAX = 300;
/** Push throttle: at most one waiter wakeup per this interval per signal
 * (the provider streams per-token; the panel needs a smooth cadence, not
 * every delta). */
const NOTIFY_MIN_INTERVAL_MS = 150;
/** Default long-poll hold: how long a status request waits for a change
 * before returning the current snapshot (client re-issues immediately). */
export const STATUS_POLL_TIMEOUT_MS = 20000;
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
            seq: 0,
            lastNotify: 0,
            status: { active: false, stage: '', elapsedMs: 0, outputChars: 0, preview: '', seq: 0 },
        };
        slots.set(signal, slot);
    }
    return slot;
}
/** Wake the signal's long-poll waiters (throttled to the push cadence). */
function notify(signal) {
    const slot = slots.get(signal);
    if (slot === undefined)
        return;
    const now = Date.now();
    if (now - slot.lastNotify < NOTIFY_MIN_INTERVAL_MS)
        return;
    slot.lastNotify = now;
    const list = waiters.get(signal);
    if (list === undefined)
        return;
    for (const waiter of [...list])
        waiter();
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
    slot.seq += 1;
    slot.status = { active: true, stage, elapsedMs: 0, outputChars: 0, preview: '', seq: slot.seq };
    notify(signal);
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
    slot.seq += 1;
    slot.status = {
        ...slot.status,
        active: true,
        elapsedMs: Date.now() - slot.startedAt,
        outputChars,
        preview: preview.slice(-PREVIEW_MAX),
        seq: slot.seq,
    };
    notify(signal);
}
/** Mark the current generation finished (active=false keeps the last label). */
export function endGenerationStage(signal) {
    if (signal === undefined)
        return;
    const slot = slotFor(signal);
    slot.seq += 1;
    slot.status = { ...slot.status, active: false, elapsedMs: Date.now() - slot.startedAt, seq: slot.seq };
    notify(signal);
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
/**
 * LONG-POLL push: resolve with the status snapshot whose seq differs from
 * `since` — immediately when one already exists, otherwise when the next
 * status mutation arrives (throttled cadence), or after `timeoutMs` with the
 * current snapshot (the client re-issues right away, so the only cost is a
 * reconnect). One in-flight request at a time = SSE-like delivery inside the
 * RPC channel.
 * @param root - absolute workspace root.
 * @param since - the client's last seen seq.
 * @param timeoutMs - max hold before returning the current snapshot.
 * @returns `{ status, seq }`, or null when nothing was ever generated.
 */
export async function waitForGenerationStatus(root, since, timeoutMs = STATUS_POLL_TIMEOUT_MS) {
    const controller = controllers.get(root);
    if (controller === undefined)
        return null;
    const signal = controller.signal;
    // Create the slot on demand: a waiter may register BEFORE the first
    // status mutation (the whole point of waiting for the next change).
    const slot = slotFor(signal);
    if (slot.seq !== since)
        return { status: slot.status, seq: slot.seq };
    return await new Promise(resolve => {
        const onUpdate = () => {
            cleanup();
            resolve({ status: slot.status, seq: slot.seq });
        };
        const onTimeout = () => {
            cleanup();
            resolve({ status: slot.status, seq: slot.seq });
        };
        const cleanup = () => {
            clearTimeout(timer);
            const list = waiters.get(signal);
            if (list !== undefined) {
                const index = list.indexOf(onUpdate);
                if (index >= 0)
                    list.splice(index, 1);
            }
        };
        const timer = setTimeout(onTimeout, timeoutMs);
        let list = waiters.get(signal);
        if (list === undefined) {
            list = [];
            waiters.set(signal, list);
        }
        list.push(onUpdate);
    });
}
//# sourceMappingURL=abort.js.map