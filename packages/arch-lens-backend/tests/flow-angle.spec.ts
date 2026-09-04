/**
 * Angle-aware flow chain tests: BOTH viewpoints (event / pipeline) are
 * generated together in the shared profile's figures call and served per
 * angle from the map — switching angles never costs another LLM call. A
 * missing angle falls through to a fresh angle-specific induction, and the
 * induction itself stamps the angle on its result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))

const llmCalls: string[] = []
vi.mock('../src/docsgen.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/docsgen.ts')>()
  return {
    ...actual,
    llmText: vi.fn(async (_ctx: unknown, _root: string, prompt: string) => {
      llmCalls.push(prompt)
      const wants = (needle: string): boolean => prompt.includes(needle)
      if (wants('coreIds') && wants('conceptTree')) {
        return JSON.stringify({
          coreIds: ['a', 'b', 'c', 'd'],
          conceptTree: [{ name: '运行核心', desc: '调度', children: [{ name: '入口', desc: '接收' }] }],
        })
      }
      if (wants('flow') && wants('seqMessages') && wants('events')) {
        // Full profile generation: BOTH flow viewpoints in one call.
        return JSON.stringify({
          flow: {
            event: { title: '事件流', mermaid: 'flowchart TD\n  a --> b' },
            pipeline: { title: '数据管道', mermaid: 'flowchart TD\n  a --> c' },
          },
          seqMessages: [{ from: 'a', to: 'b', label: '调 b' }],
          events: [{ event: 'E1', mode: 'emit', producers: ['a'], consumers: ['b'], note: 'n' }],
        })
      }
      if (wants('flow') && wants('{"title"')) {
        // Chain-own induction output schema: a bare {title, mermaid} object.
        return JSON.stringify({ title: '角度流程', mermaid: 'flowchart LR\n  x --> y' })
      }
      if (wants('flow')) {
        // Profile field output schema: { flow: { <angle>: {...} } }.
        return JSON.stringify({
          flow: {
            event: { title: '事件流', mermaid: 'flowchart TD\n  a --> b' },
            pipeline: { title: '数据管道', mermaid: 'flowchart TD\n  a --> c' },
          },
        })
      }
      throw new Error(`unexpected LLM call: ${prompt.slice(0, 80)}`)
    }),
  }
})

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { CodeIndexResult, CodePackage } from '@deepseek-ai/dsh-code-index'
import { flowDiagram, generateFlowFromCode } from '../src/flow.ts'
import { clearAnalysisProfileCache } from '../src/analysis.ts'

function index(): CodeIndexResult {
  const packages: CodePackage[] = ['a', 'b', 'c', 'd'].map(id => ({
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

describe('flow generation viewpoints (angle)', () => {
  it('serves BOTH angles from the shared profile with ZERO extra LLM calls', async () => {
    const ctx = fakeCtx()
    const fs = fakeFs()
    const idx = index()

    // Requesting each angle costs only the shared profile's 2 calls — the
    // map carries both, so switching angles is instant.
    const event = await flowDiagram(ctx, fs, '/ws', idx, '中文', false, 'event')
    expect(!('error' in event)).toBe(true)
    expect('source' in event && event.source).toBe('flow')
    expect('angle' in event && event.angle).toBe('event')
    expect('mermaid' in event && event.mermaid).toContain('a --> b')
    expect(llmCalls.length).toBe(2)

    const pipeline = await flowDiagram(ctx, fs, '/ws', idx, '中文', false, 'pipeline')
    expect(!('error' in pipeline)).toBe(true)
    expect('angle' in pipeline && pipeline.angle).toBe('pipeline')
    expect('mermaid' in pipeline && pipeline.mermaid).toContain('a --> c')
    expect(llmCalls.length).toBe(2) // still no extra call
  })

  it('still serves the profile flow on a forced request (cache bypass only skips the per-angle cache)', async () => {
    const ctx = fakeCtx()
    const fs = fakeFs()
    const idx = index()

    // force=true bypasses the per-angle disk cache but NOT the shared
    // profile: the pipeline diagram comes from the profile map, so a forced
    // request costs no extra LLM call.
    const flow = await flowDiagram(ctx, fs, '/ws', idx, '中文', true, 'pipeline')
    expect(!('error' in flow)).toBe(true)
    expect('source' in flow && flow.source).toBe('flow')
    expect('angle' in flow && flow.angle).toBe('pipeline')
    expect('mermaid' in flow && flow.mermaid).toContain('a --> c')
    expect(llmCalls.length).toBe(2) // shared profile only
    // The profile figures call carried both angles' rules.
    expect(llmCalls[1]).toContain('数据管道')
    expect(llmCalls[1]).toContain('每条边必须有动作标签')
  })

  it('induces directly with the requested angle and stamps it on the result', async () => {
    const ctx = fakeCtx()
    const idx = index()

    const induced = await generateFlowFromCode(ctx, idx, '中文', 'event')
    expect(induced).not.toBeNull()
    expect(induced!.source).toBe('flow')
    expect(induced!.angle).toBe('event')
    expect(llmCalls.length).toBe(1)
    expect(llmCalls[0]).toContain('事件驱动')
    expect(llmCalls[0]).toContain('subgraph 按【阶段】分组')
  })
})

describe('sanitizeMermaid (LLM syntax repair)', () => {
  it('replaces half-width parentheses/semicolons inside edge labels', async () => {
    const { sanitizeMermaid } = await import('../src/flow-angle.ts')
    const source = 'flowchart TD\n  E1 -->|触发(emit)| E2\n  E2 -.->|调用(serial);重试| E3\n  E3 ==>|返回(ok)| E4'
    const fixed = sanitizeMermaid(source)
    expect(fixed).toContain('-->|触发（emit）|')
    expect(fixed).toContain('-.->|调用（serial）；重试|')
    expect(fixed).toContain('==>|返回（ok）|')
    expect(fixed).not.toContain('(')
  })

  it('leaves already-valid labels untouched', async () => {
    const { sanitizeMermaid } = await import('../src/flow-angle.ts')
    const source = 'flowchart TD\n  A -->|触发| B\n  B --> C'
    expect(sanitizeMermaid(source)).toBe(source)
  })
})
