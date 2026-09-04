/**
 * Per-workspace LLM usage accounting for the Arch Lens backend: every model
 * call is recorded with its prompt/output sizes, a deterministic token
 * estimate, and — when the stream emits one — the PROVIDER-REPORTED token
 * usage, so token spend is observable per workspace instead of a black box.
 *
 * PER-ROOT ISOLATION: the ledger is keyed by workspace root. Two workspaces
 * generating concurrently (or a page closed mid-generation while another
 * workspace runs) never mix numbers — each root's snapshot and persisted
 * file contain ONLY that workspace's calls. Before the isolation (a single
 * process-global ledger) any workspace's `llmStats` read persisted the MIXED
 * totals into ITS OWN `index/.arch-lens-llm-stats.json`, cross-contaminating
 * both files; the keyed ledger removes that channel entirely.
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
/** Per-root ledgers, keyed by the resolved workspace root. */
const ledgers = new Map();
/** Per-root adoption gate: each workspace's persisted ledger file is folded
 * in at most ONCE per process (see hydrateLlmStats). */
const adoptedRoots = new Set();
/** Lazily create/return one root's ledger. */
function ledgerFor(root) {
    let ledger = ledgers.get(root);
    if (ledger === undefined) {
        ledger = {
            totalCalls: 0,
            totalInTokens: 0,
            totalOutTokens: 0,
            totalUsageInTokens: 0,
            totalUsageOutTokens: 0,
            totalMs: 0,
            records: [],
        };
        ledgers.set(root, ledger);
    }
    return ledger;
}
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
 * Record one model call in the WORKSPACE's ledger (newest first, capped).
 * The caller must know the workspace root it is generating for — every
 * arch-lens chain and session-driven capture resolves it (the chain's root
 * argument, or the answering session's cwd). Calls that cannot name a root
 * must not be recorded: a shared bucket would re-open the cross-workspace
 * mixing this ledger exists to prevent.
 * @param root - absolute workspace root the call is attributed to.
 * @param kind - call site kind (see {@link LlmCallRecord.kind}).
 * @param prompt - the full prompt text (input side).
 * @param output - the full model output text.
 * @param ms - wall time of the call.
 * @param usage - provider-reported usage, when the stream emitted one.
 * @param label - optional human-readable label (session-driven calls).
 */
export function recordLlmCall(root, kind, prompt, output, ms, usage, label) {
    const ledger = ledgerFor(root);
    ledger.totalCalls += 1;
    ledger.totalInTokens += estimateTokens(prompt);
    ledger.totalOutTokens += estimateTokens(output);
    if (usage !== undefined) {
        ledger.totalUsageInTokens += usage.inTokens;
        ledger.totalUsageOutTokens += usage.outTokens;
    }
    ledger.totalMs += ms;
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
    ledger.records.unshift(record);
    if (ledger.records.length > MAX_RECORDS)
        ledger.records.length = MAX_RECORDS;
}
/**
 * Fold a workspace's persisted snapshot into ITS ledger so totals and the
 * newest records SURVIVE a host restart. The disk file IS that workspace's
 * historical ledger: adoption folds it in ADDITIVELY and happens exactly
 * ONCE per process PER ROOT (`adoptedRoots` gate — a process that already
 * recorded calls for the workspace must still gain its past totals, and
 * repeated adoption from the panel's refresh loop must never double-count).
 * Records merge newest-first, capped.
 *
 * Migration note: files written before per-root isolation may contain the
 * OLD mixed cross-workspace totals; they are adopted as-is into the workspace
 * that owns the file (no way to attribute the mixed history retroactively).
 * @param root - absolute workspace root the snapshot belongs to.
 * @param disk - the snapshot previously persisted to that root's disk file,
 *   or null/undefined when absent.
 */
export function hydrateLlmStats(root, disk) {
    if (adoptedRoots.has(root) || disk === null || disk === undefined)
        return;
    adoptedRoots.add(root);
    const ledger = ledgerFor(root);
    ledger.totalCalls += disk.totalCalls;
    ledger.totalInTokens += disk.totalInTokens;
    ledger.totalOutTokens += disk.totalOutTokens;
    ledger.totalUsageInTokens += disk.totalUsageInTokens;
    ledger.totalUsageOutTokens += disk.totalUsageOutTokens;
    ledger.totalMs += disk.totalMs;
    if (Array.isArray(disk.records)) {
        ledger.records.push(...disk.records.slice(0, MAX_RECORDS));
        if (ledger.records.length > MAX_RECORDS)
            ledger.records.length = MAX_RECORDS;
    }
}
/** Whether the workspace's persisted ledger has already been adopted this
 * process (per-root gate; other workspaces are unaffected). */
export function llmStatsAdopted(root) {
    return adoptedRoots.has(root);
}
/**
 * Current in-memory accounting of ONE workspace (newest first). Totals cover
 * every recorded call of this root, not just the capped records list. Other
 * roots' numbers never appear here.
 * @param root - absolute workspace root.
 * @returns the snapshot.
 */
export function llmStatsSnapshot(root) {
    const ledger = ledgerFor(root);
    return {
        totalCalls: ledger.totalCalls,
        totalInTokens: ledger.totalInTokens,
        totalOutTokens: ledger.totalOutTokens,
        totalUsageInTokens: ledger.totalUsageInTokens,
        totalUsageOutTokens: ledger.totalUsageOutTokens,
        totalMs: ledger.totalMs,
        records: [...ledger.records],
    };
}
/** Empty snapshot: the shape `llmStats` serves when no workspace is bound
 * (nothing can be attributed, so nothing is shown). */
export function emptyLlmStatsSnapshot() {
    return {
        totalCalls: 0,
        totalInTokens: 0,
        totalOutTokens: 0,
        totalUsageInTokens: 0,
        totalUsageOutTokens: 0,
        totalMs: 0,
        records: [],
    };
}
/** Reset ALL accounting (tests only). */
export function clearLlmStats() {
    ledgers.clear();
    adoptedRoots.clear();
}
//# sourceMappingURL=llm-stats.js.map