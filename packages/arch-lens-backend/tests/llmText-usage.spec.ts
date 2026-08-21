/**
 * Unit test for the provider-usage capture inside llmText: the stream's
 * `usage` chunk must be recorded as the REAL token counts (estimate stays as
 * a fallback for adapters that do not emit one).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))
import type { Context } from '@deepseek-ai/cordis'
import { llmText } from '../src/docsgen.ts'
import { llmStatsSnapshot, clearLlmStats } from '../src/llm-stats.ts'

function fakeCtx(emitUsage: boolean): Context {
  return {
    get: (name: string) => {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      }
      if (name === 'llm') {
        return {
          prepareCall: async () => ({
            config: { provider: 'p', model: 'm' },
            stream: async function* () {
              if (emitUsage) {
                yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 20, reasoningTokens: 10 } }
              }
              yield { type: 'text-delta', text: '你好' }
              yield { type: 'finish', reason: { kind: 'stop' } }
            },
          }),
        }
      }
      return undefined
    },
  } as unknown as Context
}

beforeEach(() => {
  clearLlmStats()
})

describe('llmText usage capture', () => {
  it('records the provider usage chunk as real tokens', async () => {
    const out = await llmText(fakeCtx(true), 'prompt', 0.3, undefined, 'test-kind')
    expect(out).toBe('你好')
    const snapshot = llmStatsSnapshot()
    expect(snapshot.records[0]!.kind).toBe('test-kind')
    expect(snapshot.records[0]!.usage).toEqual({
      inTokens: 120, // 100 + 20 cache-read
      outTokens: 40,
      cacheReadTokens: 20,
      reasoningTokens: 10,
    })
    expect(snapshot.totalUsageInTokens).toBe(120)
    expect(snapshot.totalUsageOutTokens).toBe(40)
    // The estimate is still recorded as the fallback for usage-less calls.
    expect(snapshot.records[0]!.estInTokens).toBeGreaterThan(0)
  })

  it('falls back to the estimate when no usage chunk arrives', async () => {
    await llmText(fakeCtx(false), 'prompt', 0.3, undefined, 'no-usage')
    const snapshot = llmStatsSnapshot()
    expect(snapshot.records[0]!.usage).toBeUndefined()
    expect(snapshot.totalUsageInTokens).toBe(0)
    expect(snapshot.totalUsageOutTokens).toBe(0)
  })

  it('aborts the stream when the signal fires (⏹ 终止)', async () => {
    const controller = new AbortController()
    controller.abort()
    // An already-aborted signal must stop the call immediately: the stream
    // yields one chunk, the abort check throws before the loop continues,
    // and nothing is recorded as a completed call.
    await expect(llmText(fakeCtx(false), 'prompt', 0.3, undefined, 'aborted-kind', controller.signal))
      .rejects.toThrow('generation aborted')
    const snapshot = llmStatsSnapshot()
    expect(snapshot.records.find(record => record.kind === 'aborted-kind')).toBeUndefined()
  })

  it('aborts mid-stream when the signal fires during iteration', async () => {
    let resolveAbort!: () => void
    const controller = new AbortController()
    const ctx = {
      get: (name: string) => {
        if (name === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
        }
        if (name === 'llm') {
          return {
            prepareCall: async () => ({
              config: { provider: 'p', model: 'm' },
              stream: async function* () {
                yield { type: 'text-delta', text: 'a' }
                await new Promise<void>(resolve => { resolveAbort = resolve })
                yield { type: 'text-delta', text: 'b' }
                yield { type: 'finish', reason: { kind: 'stop' } }
              },
            }),
          }
        }
        return undefined
      },
    } as unknown as Context
    const pending = llmText(ctx, 'prompt', 0.3, undefined, 'mid-abort', controller.signal)
    // Let the first chunk through, then abort before the next one arrives.
    await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort()
    resolveAbort()
    await expect(pending).rejects.toThrow('generation aborted')
    const snapshot = llmStatsSnapshot()
    expect(snapshot.records.find(record => record.kind === 'mid-abort')).toBeUndefined()
  })
})
