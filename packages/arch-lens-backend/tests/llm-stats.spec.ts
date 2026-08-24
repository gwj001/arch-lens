/**
 * Unit tests for the LLM usage accounting: the deterministic token estimate,
 * provider-usage normalization (real tokens win, estimate falls back), and
 * the record/snapshot behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  estimateTokens,
  normalizeUsage,
  recordLlmCall,
  llmStatsSnapshot,
  clearLlmStats,
} from '../src/llm-stats.ts'

beforeEach(() => {
  clearLlmStats()
})

describe('estimateTokens', () => {
  it('estimates ASCII at ~4 chars per token', () => {
    // 80 ASCII chars → 20 tokens
    expect(estimateTokens('a'.repeat(80))).toBe(20)
    expect(estimateTokens('a'.repeat(79))).toBe(20) // ceil(79/4) = 20
    expect(estimateTokens('a'.repeat(81))).toBe(21)
  })

  it('estimates CJK at ~1.5 chars per token', () => {
    // 30 CJK chars → 20 tokens (30 / 1.5)
    expect(estimateTokens('概念'.repeat(15))).toBe(20)
  })

  it('combines both sides for mixed text', () => {
    const mixed = `${'a'.repeat(80)}${'概念'.repeat(15)}` // 20 + 20 = 40
    expect(estimateTokens(mixed)).toBe(40)
  })

  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('normalizeUsage', () => {
  it('returns undefined when the stream emitted no usage chunk', () => {
    expect(normalizeUsage(undefined)).toBeUndefined()
  })

  it('bills input as uncached + cache-read + cache-write, keeps reasoning separate', () => {
    const usage = normalizeUsage({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      reasoningTokens: 10,
    })
    expect(usage).toEqual({
      inTokens: 125, // 100 + 20 + 5
      outTokens: 40,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      reasoningTokens: 10,
    })
  })

  it('omits optional fields when the provider did not report them', () => {
    const usage = normalizeUsage({ inputTokens: 10, outputTokens: 5 })
    expect(usage).toEqual({ inTokens: 10, outTokens: 5 })
  })
})

describe('recordLlmCall / llmStatsSnapshot', () => {
  it('records newest first with totals over every call', () => {
    recordLlmCall('concept', 'a'.repeat(40), 'b'.repeat(8), 100) // 10 in + 2 out
    recordLlmCall('analysis-structure', 'c'.repeat(80), 'd'.repeat(16), 200) // 20 in + 4 out
    const snapshot = llmStatsSnapshot()
    expect(snapshot.totalCalls).toBe(2)
    expect(snapshot.totalInTokens).toBe(30)
    expect(snapshot.totalOutTokens).toBe(6)
    expect(snapshot.totalMs).toBe(300)
    expect(snapshot.records[0]!.kind).toBe('analysis-structure')
    expect(snapshot.records[1]!.kind).toBe('concept')
  })

  it('accumulates provider-reported usage separately from estimates', () => {
    recordLlmCall('flow', 'a'.repeat(40), 'b'.repeat(8), 100, normalizeUsage({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 20,
      reasoningTokens: 10,
    }))
    recordLlmCall('seq', 'c'.repeat(80), 'd'.repeat(16), 200) // no usage chunk
    const snapshot = llmStatsSnapshot()
    expect(snapshot.totalUsageInTokens).toBe(120) // 100 + 20
    expect(snapshot.totalUsageOutTokens).toBe(40)
    expect(snapshot.records[0]!.usage).toBeUndefined() // no usage chunk
    expect(snapshot.records[1]!.usage).toEqual({
      inTokens: 120,
      outTokens: 40,
      cacheReadTokens: 20,
      reasoningTokens: 10,
    })
  })

  it('caps the records list at 10 but keeps totals', () => {
    for (let i = 0; i < 150; i += 1) recordLlmCall('llm', 'x', 'y', 1)
    const snapshot = llmStatsSnapshot()
    expect(snapshot.records.length).toBe(10)
    expect(snapshot.totalCalls).toBe(150)
    expect(snapshot.totalInTokens).toBe(150) // 1 char 'x' → ceil(1/4)=1 per call
  })
})
