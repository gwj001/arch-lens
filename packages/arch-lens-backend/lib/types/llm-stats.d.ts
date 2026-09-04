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
export declare function recordLlmCall(root: string, kind: string, prompt: string, output: string, ms: number, usage?: LlmUsageRecord, label?: string): void;
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
export declare function hydrateLlmStats(root: string, disk: LlmStatsSnapshot | null | undefined): void;
/** Whether the workspace's persisted ledger has already been adopted this
 * process (per-root gate; other workspaces are unaffected). */
export declare function llmStatsAdopted(root: string): boolean;
/**
 * Current in-memory accounting of ONE workspace (newest first). Totals cover
 * every recorded call of this root, not just the capped records list. Other
 * roots' numbers never appear here.
 * @param root - absolute workspace root.
 * @returns the snapshot.
 */
export declare function llmStatsSnapshot(root: string): LlmStatsSnapshot;
/** Empty snapshot: the shape `llmStats` serves when no workspace is bound
 * (nothing can be attributed, so nothing is shown). */
export declare function emptyLlmStatsSnapshot(): LlmStatsSnapshot;
/** Reset ALL accounting (tests only). */
export declare function clearLlmStats(): void;
//# sourceMappingURL=llm-stats.d.ts.map