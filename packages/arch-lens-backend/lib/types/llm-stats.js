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
const MAX_RECORDS = 10;
const records = [];
/** Running totals over EVERY recorded call (records list is capped). */
let totalCalls = 0;
let totalInTokens = 0;
let totalOutTokens = 0;
let totalUsageInTokens = 0;
let totalUsageOutTokens = 0;
let totalMs = 0;
/**
 * Estimate the token count of a text from its character mix:
 * ASCII ≈ 4 chars/token, non-ASCII (CJK…) ≈ 1.5 chars/token.
 * @param text - the text to estimate.
 * @returns the estimated token count.
 */
export function estimateTokens(text) {
    let ascii = 0;
    let other = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) < 128)
            ascii += 1;
        else
            other += 1;
    }
    return Math.ceil(ascii / 4 + other / 1.5);
}
/**
 * Normalize a provider `usage` chunk (dsh-llm TokenUsage) into the compact
 * record shape. Billed input = uncached input + cache-read + cache-write;
 * output stays the completion count; reasoning is reported separately.
 * @param usage - the raw stream usage chunk, or undefined.
 * @returns the normalized record, or undefined when absent.
 */
export function normalizeUsage(usage) {
    if (usage === undefined)
        return undefined;
    const record = {
        inTokens: usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
        outTokens: usage.outputTokens,
    };
    if (usage.cacheReadTokens !== undefined)
        record.cacheReadTokens = usage.cacheReadTokens;
    if (usage.cacheWriteTokens !== undefined)
        record.cacheWriteTokens = usage.cacheWriteTokens;
    if (usage.reasoningTokens !== undefined)
        record.reasoningTokens = usage.reasoningTokens;
    return record;
}
/**
 * Record one model call in memory (newest first, capped).
 * @param kind - call site kind (see {@link LlmCallRecord.kind}).
 * @param prompt - the full prompt text (input side).
 * @param output - the full model output text.
 * @param ms - wall time of the call.
 * @param usage - provider-reported usage, when the stream emitted one.
 * @param label - optional human-readable label (session-driven calls).
 */
export function recordLlmCall(kind, prompt, output, ms, usage, label) {
    totalCalls += 1;
    totalInTokens += estimateTokens(prompt);
    totalOutTokens += estimateTokens(output);
    if (usage !== undefined) {
        totalUsageInTokens += usage.inTokens;
        totalUsageOutTokens += usage.outTokens;
    }
    totalMs += ms;
    const record = {
        kind,
        at: Date.now(),
        inChars: prompt.length,
        outChars: output.length,
        estInTokens: estimateTokens(prompt),
        estOutTokens: estimateTokens(output),
        ms,
    };
    if (label !== undefined)
        record.label = label;
    if (usage !== undefined)
        record.usage = usage;
    records.unshift(record);
    if (records.length > MAX_RECORDS)
        records.length = MAX_RECORDS;
}
/**
 * Fold a persisted snapshot into the running accounting so totals and the
 * newest records SURVIVE a host restart. The disk file IS the historical
 * ledger: adoption folds it in ADDITIVELY and happens exactly ONCE per
 * process (`adopted` gate — a process that already recorded calls must still
 * gain its workspace's past totals, and repeated adoption from the panel's
 * refresh loop must never double-count). Records merge newest-first, capped.
 * @param disk - the snapshot previously persisted to disk, or null.
 */
let adopted = false;
export function hydrateLlmStats(disk) {
    if (adopted || disk === null || disk === undefined)
        return;
    adopted = true;
    totalCalls += disk.totalCalls;
    totalInTokens += disk.totalInTokens;
    totalOutTokens += disk.totalOutTokens;
    totalUsageInTokens += disk.totalUsageInTokens;
    totalUsageOutTokens += disk.totalUsageOutTokens;
    totalMs += disk.totalMs;
    if (Array.isArray(disk.records)) {
        records.push(...disk.records.slice(0, MAX_RECORDS));
        if (records.length > MAX_RECORDS)
            records.length = MAX_RECORDS;
    }
}
/** Whether the persisted ledger has already been adopted this process. */
export function llmStatsAdopted() {
    return adopted;
}
/**
 * Current in-memory accounting (newest first). Totals cover every recorded
 * call, not just the capped records list.
 * @returns the snapshot.
 */
export function llmStatsSnapshot() {
    return {
        totalCalls,
        totalInTokens,
        totalOutTokens,
        totalUsageInTokens,
        totalUsageOutTokens,
        totalMs,
        records: [...records],
    };
}
/** Reset accounting (tests). */
export function clearLlmStats() {
    records.length = 0;
    totalCalls = 0;
    totalInTokens = 0;
    totalOutTokens = 0;
    totalUsageInTokens = 0;
    totalUsageOutTokens = 0;
    totalMs = 0;
    adopted = false;
}
//# sourceMappingURL=llm-stats.js.map