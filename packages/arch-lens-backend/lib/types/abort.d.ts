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
import type { GenerationStatus } from './types.ts';
/** Default long-poll hold: how long a status request waits for a change
 * before returning the current snapshot (client re-issues immediately). */
export declare const STATUS_POLL_TIMEOUT_MS = 20000;
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
export declare function waitForGenerationStatus(root: string, since: number, timeoutMs?: number): Promise<{
    status: GenerationStatus;
    seq: number;
} | null>;
//# sourceMappingURL=abort.d.ts.map