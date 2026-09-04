/**
 * Unit test for the provider-usage capture inside llmText: the stream's
 * `usage` chunk must be recorded as the REAL token counts (estimate stays as
 * a fallback for adapters that do not emit one).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))
import type { Context } from '@deepseek-ai/cordis'
import { llmText, lowestReasoningEffort } from '../src/docsgen.ts'
import type { ReasoningCapability } from '../src/docsgen.ts'
import { llmStatsSnapshot, clearLlmStats } from '../src/llm-stats.ts'
import { beginGenerationStage, currentGenerationStatus, endGenerationStage, generationSignal, waitForGenerationStatus } from '../src/abort.ts'

/** The workspace root every llmText call is attributed to (per-root ledger). */
const ROOT = '/ws/llmtext'

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

describe('lowestReasoningEffort (docs thinking-tier throttle)', () => {
  const id = (value: string) => value as never as import('@deepseek-ai/dsh-llm').ReasoningEffortId

  it('no capability or empty list → keep the adapter default', () => {
    expect(lowestReasoningEffort(undefined)).toBeUndefined()
    expect(lowestReasoningEffort({ efforts: [] })).toBeUndefined()
  })

  it('prefers an effort advertising itself as minimal', () => {
    const capability: ReasoningCapability = {
      efforts: [{ id: id('high'), name: 'High' }, { id: id('low'), name: 'Low' }],
    }
    expect(lowestReasoningEffort(capability)).toBe('low')
  })

  it('falls back to the adapter-first effort when no name matches', () => {
    const capability: ReasoningCapability = {
      efforts: [{ id: id('e1'), name: '标准' }, { id: id('e2'), name: '深度' }],
    }
    expect(lowestReasoningEffort(capability)).toBe('e1')
  })

  it('proposing the default changes nothing → undefined', () => {
    const capability: ReasoningCapability = {
      efforts: [{ id: id('only'), name: 'Low' }],
      defaultEffort: id('only'),
    }
    expect(lowestReasoningEffort(capability)).toBeUndefined()
  })
})

describe('llmText effort proposal wiring', () => {
  function probingCtx(reasoning: unknown, capture: { config?: Record<string, unknown>; probed?: boolean }): Context {
    return {
      get: (name: string) => {
        if (name === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
        }
        if (name === 'llm') {
          return {
            resolveModelInfo: async () => {
              capture.probed = true
              return { provider: 'p', model: 'm', reasoning }
            },
            prepareCall: async (config: Record<string, unknown>) => {
              capture.config = config
              return {
                config: { provider: 'p', model: 'm' },
                stream: async function* () {
                  yield { type: 'text-delta', text: 'ok' }
                  yield { type: 'finish', reason: { kind: 'stop' } }
                },
              }
            },
          }
        }
        return undefined
      },
    } as unknown as Context
  }

  it('docs kind proposes the cheapest advertised effort', async () => {
    const capture: { config?: Record<string, unknown>; probed?: boolean } = {}
    await llmText(probingCtx({ efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }] }, capture), ROOT, 'prompt', 0.2, undefined, 'docs')
    expect(capture.probed).toBe(true)
    expect(capture.config?.reasoningEffort).toBe('low')
  })

  it('non-bounded kinds never probe and keep the adapter default', async () => {
    const capture: { config?: Record<string, unknown>; probed?: boolean } = {}
    await llmText(probingCtx({ efforts: [{ id: 'low', name: 'Low' }] }, capture), ROOT, 'prompt', 0.2, undefined, 'flow')
    expect(capture.probed).toBeUndefined()
    expect(capture.config?.reasoningEffort).toBeUndefined()
  })

  it('a failing capability probe never blocks generation', async () => {
    const ctx = {
      get: (name: string) => {
        if (name === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
        }
        if (name === 'llm') {
          return {
            resolveModelInfo: async () => { throw new Error('capability lookup down') },
            prepareCall: async () => ({
              config: { provider: 'p', model: 'm' },
              stream: async function* () {
                yield { type: 'text-delta', text: 'ok' }
                yield { type: 'finish', reason: { kind: 'stop' } }
              },
            }),
          }
        }
        return undefined
      },
    } as unknown as Context
    await expect(llmText(ctx, ROOT, 'prompt', 0.2, undefined, 'docs')).resolves.toBe('ok')
  })
})

describe('llmText usage capture', () => {
  it('records the provider usage chunk as real tokens', async () => {
    const out = await llmText(fakeCtx(true), ROOT, 'prompt', 0.3, undefined, 'test-kind')
    expect(out).toBe('你好')
    const snapshot = llmStatsSnapshot(ROOT)
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
    await llmText(fakeCtx(false), ROOT, 'prompt', 0.3, undefined, 'no-usage')
    const snapshot = llmStatsSnapshot(ROOT)
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
    await expect(llmText(fakeCtx(false), ROOT, 'prompt', 0.3, undefined, 'aborted-kind', controller.signal))
      .rejects.toThrow('generation aborted')
    const snapshot = llmStatsSnapshot(ROOT)
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
    const pending = llmText(ctx, ROOT, 'prompt', 0.3, undefined, 'mid-abort', controller.signal)
    // Let the first chunk through, then abort before the next one arrives.
    await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort()
    resolveAbort()
    await expect(pending).rejects.toThrow('generation aborted')
    const snapshot = llmStatsSnapshot(ROOT)
    expect(snapshot.records.find(record => record.kind === 'mid-abort')).toBeUndefined()
  })

  it('reports the live generation status while streaming (⚙️ 生成过程)', async () => {
    const signal = generationSignal('/ws')
    await llmText(fakeCtx(false), '/ws', 'prompt', 0.3, undefined, 'status-kind', signal)
    const status = currentGenerationStatus('/ws')
    expect(status).not.toBeNull()
    expect(status!.stage).toBe('LLM：status-kind')
    expect(status!.outputChars).toBe(2) // '你好'
    expect(status!.preview).toContain('你好')
    // finished: active false but the last label stays readable
    expect(status!.active).toBe(false)
    // the monotonic seq advanced with every mutation (begin + deltas + end)
    expect(status!.seq).toBeGreaterThan(0)
  })

  it('long-polls: waits for the next status change and resumes from seq (push semantics)', async () => {
    // A dedicated root: the status slot is per-root module state, and other
    // tests already advanced '/ws' — a fresh root starts at seq 0 so the
    // waiter really waits for the first mutation.
    const signal = generationSignal('/lp')
    // ① a waiter registered BEFORE any mutation holds until the change
    //    arrives (woken by the throttled push, not by the hold timeout).
    const waiting = waitForGenerationStatus('/lp', 0, 5000)
    beginGenerationStage(signal, 'LLM：push-test')
    const pushed = await waiting
    expect(pushed).not.toBeNull()
    expect(pushed!.seq).toBe(1)
    expect(pushed!.status.stage).toBe('LLM：push-test')
    expect(pushed!.status.active).toBe(true)

    // ② resume with the last seen seq: a change that lands AFTER the push
    //    throttle window wakes the next waiter immediately (seq advances).
    await new Promise(resolve => setTimeout(resolve, 200)) // clear throttle window
    const waiting2 = waitForGenerationStatus('/lp', pushed!.seq, 5000)
    endGenerationStage(signal)
    const pushed2 = await waiting2
    expect(pushed2!.seq).toBe(2)
    expect(pushed2!.status.active).toBe(false)

    // ③ a waiter with a future seq holds until the hold timeout returns the
    //    current snapshot (the client re-issues right away).
    const timedOut = await waitForGenerationStatus('/lp', 9999, 60)
    expect(timedOut!.seq).toBe(2)
  }, 8000)
})
