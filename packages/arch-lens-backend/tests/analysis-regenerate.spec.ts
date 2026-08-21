/**
 * Unit tests for the per-tab "AI generate" (分离方案): regenerateProfileField
 * updates exactly ONE shared-profile field with one trimmed-summary LLM call,
 * keeps the other fields, and invalidates flow/seq/events when the core
 * selection changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))

const llmCalls: string[] = []
vi.mock('../src/docsgen.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/docsgen.ts')>()
  return {
    ...actual,
    llmText: vi.fn(async (_ctx: unknown, prompt: string) => {
      llmCalls.push(prompt)
      const wants = (needle: string): boolean => prompt.includes(needle)
      if (wants('coreIds') && wants('conceptTree')) {
        return JSON.stringify({
          coreIds: ['a', 'b', 'c', 'd'],
          conceptTree: [{ name: '运行核心', desc: 'd', children: [{ name: '入口', desc: 'e' }] }],
        })
      }
      if (wants('coreIds')) {
        return JSON.stringify({ coreIds: ['c', 'd', 'e', 'f'] })
      }
      if (wants('conceptTree')) {
        return JSON.stringify({ conceptTree: [{ name: '新概念', desc: 'x' }] })
      }
      if (wants('flow') && wants('seqMessages') && wants('events')) {
        return JSON.stringify({
          flow: {
            event: { title: '主流程-事件', mermaid: 'flowchart TD\n  a --> b' },
            pipeline: { title: '主流程-管道', mermaid: 'flowchart TD\n  a --> c' },
          },
          seqMessages: [
            { from: 'a', to: 'b', label: '调 b' },
            { from: 'b', to: 'c', label: '调 c' },
            { from: 'c', to: 'd', label: '调 d' },
          ],
          events: [{ event: 'E1', mode: 'emit', producers: ['a'], consumers: ['b'], note: 'n' }],
        })
      }
      if (wants('flow')) {
        return JSON.stringify({
          flow: {
            event: { title: '新流程-事件', mermaid: 'flowchart LR\n  c --> d' },
            pipeline: { title: '新流程-管道', mermaid: 'flowchart LR\n  c --> e' },
          },
        })
      }
      if (wants('seqMessages')) {
        return JSON.stringify({
          seqMessages: [
            { from: 'c', to: 'd', label: '调 d' },
            { from: 'd', to: 'e', label: '调 e' },
            { from: 'e', to: 'f', label: '调 f' },
          ],
        })
      }
      if (wants('events')) {
        return JSON.stringify({}) // events-only regeneration FAILS
      }
      throw new Error(`unexpected prompt: ${prompt.slice(0, 60)}`)
    }),
  }
})

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { CodeIndexResult, CodePackage } from '@deepseek-ai/dsh-code-index'
import { ensureAnalysisProfile, regenerateProfileField, clearAnalysisProfileCache } from '../src/analysis.ts'

function index(): CodeIndexResult {
  const packages: CodePackage[] = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({
    id, path: `/ws/packages/${id}`, language: 'typescript',
    deps: [], entities: [{ name: 'Svc', kind: 'class' as const, file: `packages/${id}/src/index.ts`, line: 1 }],
    imports: [], entryFiles: id === 'a' ? [`packages/${id}/src/index.ts`] : [],
  }))
  return { root: '/ws', language: 'typescript', packages }
}

function fakeFs(): FileSystem {
  return {
    resolve: async (path: string) => ({ displayPath: path }) as never,
    stat: async () => undefined,
    readText: async () => { throw new Error('no file') },
    writeText: async () => ({}) as never,
    listDir: async () => [],
  } as unknown as FileSystem
}

function fakeCtx(): Context {
  return { get: () => undefined } as unknown as Context
}

beforeEach(() => {
  llmCalls.length = 0
  vi.clearAllMocks()
  clearAnalysisProfileCache()
})

describe('regenerateProfileField (per-tab AI generate)', () => {
  it('regenerates ONE field and keeps the others untouched', async () => {
    const ctx = fakeCtx()
    const fs = fakeFs()
    const idx = index()

    const base = await ensureAnalysisProfile(ctx, fs, '/ws', idx, '中文')
    expect(llmCalls.length).toBe(2) // full generation: structure + figures
    expect(base.flow?.event?.title).toBe('主流程-事件')
    expect(base.flow?.pipeline?.title).toBe('主流程-管道')

    const updated = await regenerateProfileField(ctx, fs, '/ws', idx, '中文', 'flow')
    expect(llmCalls.length).toBe(3) // exactly one more call, flow-only
    expect(updated.flow?.event?.title).toBe('新流程-事件') // field replaced
    expect(updated.flow?.pipeline?.title).toBe('新流程-管道') // BOTH viewpoints in one call
    expect(updated.flow?.event?.angle).toBe('event')
    expect(updated.flow?.pipeline?.angle).toBe('pipeline')
    expect(updated.conceptTree).toBeDefined() // others untouched
    expect(updated.seqMessages?.length).toBe(3)
    expect(updated.events?.length).toBe(1)
    expect(updated.coreIds).toEqual(['a', 'b', 'c', 'd'])
  })

  it('asks the model for BOTH flow viewpoints in the one figures call', async () => {
    const ctx = fakeCtx()
    const fs = fakeFs()
    const idx = index()

    await ensureAnalysisProfile(ctx, fs, '/ws', idx, '中文')
    expect(llmCalls.length).toBe(2)
    // The full figures prompt requests both angles together…
    expect(llmCalls[1]).toContain('flow.event')
    expect(llmCalls[1]).toContain('flow.pipeline')
    expect(llmCalls[1]).toContain('事件驱动')
    expect(llmCalls[1]).toContain('数据管道')

    const updated = await regenerateProfileField(ctx, fs, '/ws', idx, '中文', 'flow')
    expect(llmCalls.length).toBe(3) // one flow-only call regenerates both
    expect(llmCalls[2]).toContain('flow.event')
    expect(llmCalls[2]).toContain('flow.pipeline')
    expect(updated.flow?.event?.angle).toBe('event')
    expect(updated.flow?.pipeline?.angle).toBe('pipeline')
    // Unrelated fields stay untouched.
    expect(updated.seqMessages?.length).toBe(3)
    expect(updated.events?.length).toBe(1)
  })

  it('invalidates flow/seq/events when the core selection is regenerated', async () => {
    const ctx = fakeCtx()
    const fs = fakeFs()
    const idx = index()

    const base = await ensureAnalysisProfile(ctx, fs, '/ws', idx, '中文')
    expect(base.flow).toBeDefined()

    const updated = await regenerateProfileField(ctx, fs, '/ws', idx, '中文', 'core')
    expect(llmCalls.length).toBe(3) // one core-only structure call
    expect(updated.coreIds).toEqual(['c', 'd', 'e', 'f']) // new selection
    // Old figure endpoints may no longer be core ids — they are cleared.
    expect(updated.flow).toBeUndefined()
    expect(updated.seqMessages).toBeUndefined()
    expect(updated.events).toBeUndefined()
    expect(updated.conceptTree).toBeDefined() // concept is independent
  })

  it('throws when a field regeneration produces nothing (profile keeps its value)', async () => {
    const ctx = fakeCtx()
    const fs = fakeFs()
    const idx = index()

    await ensureAnalysisProfile(ctx, fs, '/ws', idx, '中文')
    await expect(regenerateProfileField(ctx, fs, '/ws', idx, '中文', 'events')).rejects.toThrow(/events regeneration/)
    // The failed regeneration must not have corrupted the profile.
    const after = await ensureAnalysisProfile(ctx, fs, '/ws', idx, '中文')
    expect(after.events?.length).toBe(1)
  })
})
