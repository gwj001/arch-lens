/**
 * LLM usage accounting for the Arch Lens backend: every model call is
 * recorded with its prompt/output sizes, a deterministic token estimate,
 * and — when the stream emits one — the PROVIDER-REPORTED token usage, so
 * token spend is observable per workspace instead of a black box.
 *
 * Estimation rule (documented, exported, unit-tested):
 *   - ASCII chars ≈ 4 chars per token;
 *   - non-ASCII (CJK etc.) ≈ 1.5 chars per token.
 * `estimateTokens(text) = ceil(ascii / 4 + nonAscii / 1.5)`.
 * The estimate is the fallback when the adapter does not emit a `usage`
 * chunk (some providers omit it); provider-reported numbers win when present.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/llm-stats
 */
import type { LlmStatsSnapshot, LlmUsageRecord } from './types.ts';
/**
 * Estimate the token count of a text from its character mix:
 * ASCII ≈ 4 chars/token, non-ASCII (CJK…) ≈ 1.5 chars/token.
 * @param text - the text to estimate.
 * @returns the estimated token count.
 */
export declare function estimateTokens(text: string): number;
/**
 * Normalize a provider `usage` chunk (dsh-llm TokenUsage) into the compact
 * record shape. Billed input = uncached input + cache-read + cache-write;
 * output stays the completion count; reasoning is reported separately.
 * @param usage - the raw stream usage chunk, or undefined.
 * @returns the normalized record, or undefined when absent.
 */
export declare function normalizeUsage(usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
} | undefined): LlmUsageRecord | undefined;
/**
 * Record one model call in memory (newest first, capped).
 * @param kind - call site kind (see {@link LlmCallRecord.kind}).
 * @param prompt - the full prompt text (input side).
 * @param output - the full model output text.
 * @param ms - wall time of the call.
 * @param usage - provider-reported usage, when the stream emitted one.
 */
export declare function recordLlmCall(kind: string, prompt: string, output: string, ms: number, usage?: LlmUsageRecord): void;
/**
 * Current in-memory accounting (newest first). Totals cover every recorded
 * call, not just the capped records list.
 * @returns the snapshot.
 */
export declare function llmStatsSnapshot(): LlmStatsSnapshot;
/** Reset accounting (tests). */
export declare function clearLlmStats(): void;
//# sourceMappingURL=llm-stats.d.ts.map