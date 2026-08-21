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

import type { LlmCallRecord, LlmStatsSnapshot, LlmUsageRecord } from './types.ts'

const MAX_RECORDS = 100
const records: LlmCallRecord[] = []
/** Running totals over EVERY recorded call (records list is capped). */
let totalCalls = 0
let totalInTokens = 0
let totalOutTokens = 0
let totalUsageInTokens = 0
let totalUsageOutTokens = 0
let totalMs = 0

/**
 * Estimate the token count of a text from its character mix:
 * ASCII ≈ 4 chars/token, non-ASCII (CJK…) ≈ 1.5 chars/token.
 * @param text - the text to estimate.
 * @returns the estimated token count.
 */
export function estimateTokens(text: string): number {
  let ascii = 0
  let other = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 4 + other / 1.5)
}

/**
 * Normalize a provider `usage` chunk (dsh-llm TokenUsage) into the compact
 * record shape. Billed input = uncached input + cache-read + cache-write;
 * output stays the completion count; reasoning is reported separately.
 * @param usage - the raw stream usage chunk, or undefined.
 * @returns the normalized record, or undefined when absent.
 */
export function normalizeUsage(usage: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
} | undefined): LlmUsageRecord | undefined {
  if (usage === undefined) return undefined
  const record: LlmUsageRecord = {
    inTokens: usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    outTokens: usage.outputTokens,
  }
  if (usage.cacheReadTokens !== undefined) record.cacheReadTokens = usage.cacheReadTokens
  if (usage.cacheWriteTokens !== undefined) record.cacheWriteTokens = usage.cacheWriteTokens
  if (usage.reasoningTokens !== undefined) record.reasoningTokens = usage.reasoningTokens
  return record
}

/**
 * Record one model call in memory (newest first, capped).
 * @param kind - call site kind (see {@link LlmCallRecord.kind}).
 * @param prompt - the full prompt text (input side).
 * @param output - the full model output text.
 * @param ms - wall time of the call.
 * @param usage - provider-reported usage, when the stream emitted one.
 */
export function recordLlmCall(kind: string, prompt: string, output: string, ms: number, usage?: LlmUsageRecord): void {
  totalCalls += 1
  totalInTokens += estimateTokens(prompt)
  totalOutTokens += estimateTokens(output)
  if (usage !== undefined) {
    totalUsageInTokens += usage.inTokens
    totalUsageOutTokens += usage.outTokens
  }
  totalMs += ms
  const record: LlmCallRecord = {
    kind,
    at: Date.now(),
    inChars: prompt.length,
    outChars: output.length,
    estInTokens: estimateTokens(prompt),
    estOutTokens: estimateTokens(output),
    ms,
  }
  if (usage !== undefined) record.usage = usage
  records.unshift(record)
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS
}

/**
 * Current in-memory accounting (newest first). Totals cover every recorded
 * call, not just the capped records list.
 * @returns the snapshot.
 */
export function llmStatsSnapshot(): LlmStatsSnapshot {
  return {
    totalCalls,
    totalInTokens,
    totalOutTokens,
    totalUsageInTokens,
    totalUsageOutTokens,
    totalMs,
    records: [...records],
  }
}

/** Reset accounting (tests). */
export function clearLlmStats(): void {
  records.length = 0
  totalCalls = 0
  totalInTokens = 0
  totalOutTokens = 0
  totalUsageInTokens = 0
  totalUsageOutTokens = 0
  totalMs = 0
}
