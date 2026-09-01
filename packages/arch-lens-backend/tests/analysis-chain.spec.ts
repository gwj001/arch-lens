/**
 * Chain-level quantified test for 方案 A+B: a COLD-START (no docs, no caches,
 * no static call edges) run across the five automatic chains must cost TWO
 * LLM calls total (structure + figures), with every chain consuming the same
 * shared profile — vs the legacy design's independent call per chain.
 *
 * The llmText mock records every prompt, so the test asserts both the call
 * COUNT and the total prompt CHARACTER budget (token proxy) against the
 * legacy baseline, plus the correctness invariants of each chain result.
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
      if (wants('"title": "流程标题"')) {
        // flow chain induction fallback (no doc, no profile hit) — its JSON
        // contract carries this literal; the shared figures call does not.
        return JSON.stringify({ title: '归纳流程', mermaid: 'flowchart TD\\n  pkg-2 --> pkg-3' })
      }
      if (wants('coreIds') && wants('conceptTree')) {
        return JSON.stringify({
          coreIds: ['pkg-0', 'pkg-1', 'pkg-2', 'pkg-3'],
          conceptTree: [
            { name: '运行核心', desc: '调度一切', inside: '主循环', children: [{ name: '入口', desc: '接收请求' }] },
            { name: '入口层', desc: '对外接口' },
          ],
        })
      }
      if (wants('flow') && wants('seqMessages')) {
        return JSON.stringify({
          flow: {
            event: { title: '主流程', mermaid: 'flowchart TD\\n  pkg-0 --> pkg-1' },
            pipeline: { title: '管道流程', mermaid: 'flowchart TD\\n  pkg-1 --> pkg-2' },
          },
          seqMessages: [
            { from: 'pkg-0', to: 'pkg-1', label: '调用 pkg-1' },
            { from: 'pkg-1', to: 'pkg-2', label: '调用 pkg-2' },
            { from: 'pkg-2', to: 'pkg-3', label: '调用 pkg-3' },
            { from: 'pkg-0', to: 'ghost', label: '编造的包' },
            { from: 'pkg-1', to: 'pkg-1', label: '自环' },
          ],
          events: [{ event: 'session/event', mode: 'waterfall', producers: ['pkg-1'], consumers: ['pkg-2'], note: '测试事件' }],
        })
      }
      throw new Error(`unexpected LLM call: ${prompt.slice(0, 80)}`)
    }),
  }
})

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { CodeIndexResult, CodePackage } from '@deepseek-ai/dsh-code-index'
import { conceptTree } from '../src/concept.ts'
import { flowDiagram } from '../src/flow.ts'
import { resolveSequence } from '../src/sequence.ts'
import { coreGraph } from '../src/core.ts'
import { indexSummary } from '../src/docsgen.ts'
import { clearAnalysisProfileCache } from '../src/analysis.ts'

/** Legacy automatic-path LLM calls the shared profile replaces: concept
 * induction, seq (code+flow views), flow induction, core pick = 5. */
const LEGACY_AUTO_LLM_CALLS = 5

/** 60-package index with realistic long deps, no calls (worst cold start). */
function largeIndex(): CodeIndexResult {
  const packages: CodePackage[] = []
  for (let i = 0; i < 60; i += 1) {
    const id = `pkg-${i}`
    packages.push({
      id,
      path: `/ws/packages/${id}`,
      language: 'typescript',
      deps: [`@deepseek-ai/dsh-very-long-package-name-${i}`, `@scope/reasonably-long-dep-${i}`],
      entities: ['Service', 'Runner', 'Store', 'Client', 'Handler', 'Engine', 'Parser', 'Resolver'].map(name => ({
        name, kind: 'class' as const, file: `packages/${id}/src/index.ts`, line: 1,
      })),
      imports: [],
      entryFiles: i === 0 ? [`packages/${id}/src/index.ts`] : [],
    })
  }
  return { root: '/ws', language: 'typescript', packages }
}

/** Minimal fake fs over an in-memory file map (paths are display paths). */
function fakeFs(files: Record<string, string> = {}): FileSystem {
  return {
    resolve: async (path: string) => ({ displayPath: path }) as never,
    stat: async (target: { displayPath: string }) => {
      const text = files[target.displayPath]
      return text === undefined ? undefined : { type: 'file', size: text.length }
    },
    readText: async (target: { displayPath: string }) => {
      const text = files[target.displayPath]
      if (text === undefined) throw new Error(`ENOENT: ${target.displayPath}`)
      return text
    },
    writeText: async () => ({}) as never,
    listDir: async (target: { displayPath: string }) => {
      const prefix = `${target.displayPath}/`
      const names = Object.keys(files).filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      return names.map(name => ({ name: name.slice(prefix.length), type: 'file' as const, target: { displayPath: name } as never }))
    },
  } as unknown as FileSystem
}

function fakeCtx(): Context {
  return { get: () => undefined } as unknown as Context
}

beforeEach(() => {
  llmCalls.length = 0
  vi.clearAllMocks()
  // The analysis profile's single-flight map is module state: clear it so
  // every test starts from a cold profile (and its own LLM-call budget).
  clearAnalysisProfileCache()
})

describe('cold start without docs (shared analysis profile)', () => {
  it('runs FIVE chains on TWO shared LLM calls and keeps every chain result valid', async () => {
    const index = largeIndex()
    const fs = fakeFs()
    const ctx = fakeCtx()

    // ① 概念树 → profile.conceptTree（source 'flow'）
    const tree = await conceptTree(ctx, fs, '/ws', index, '中文', false)
    expect(Array.isArray(tree)).toBe(true)
    const concept = tree as Array<{ name: string; source: string }>
    expect(concept.length).toBeGreaterThan(0)
    expect(concept[0]!.name).toBe('运行核心')
    expect(concept[0]!.source).toBe('flow')

    // ② 流程图 → profile.flow
    const flow = await flowDiagram(ctx, fs, '/ws', index, '中文', false)
    expect(!('error' in flow)).toBe(true)
    expect('source' in flow && flow.source).toBe('flow')
    expect('mermaid' in flow && flow.mermaid).toContain('pkg-0 --> pkg-1')

    // ③④ 时序双视图 → profile.seqMessages（无 calls、无文档、无缓存）
    const codeView = await resolveSequence(ctx, fs, '/ws', index, '中文', undefined, 'code')
    const flowView = await resolveSequence(ctx, fs, '/ws', index, '中文', undefined, 'flow')
    expect(codeView).not.toBeNull()
    expect(codeView!.source).toBe('flow')
    expect(flowView!.source).toBe('flow')
    // 编造的 ghost 与自环被 coreIds 交叉校验丢弃
    expect(codeView!.messages.map(m => `${m.from}>${m.to}`)).toEqual(['pkg-0>pkg-1', 'pkg-1>pkg-2', 'pkg-2>pkg-3'])

    // ⑤ 核心选包 → profile.coreIds（索引校验后）
    const core = await coreGraph(ctx, fs, '/ws', index, '中文', false)
    expect(!('error' in core)).toBe(true)
    expect('ids' in core && core.ids).toEqual(['pkg-0', 'pkg-1', 'pkg-2', 'pkg-3'])
    expect('source' in core && core.source).toBe('flow')

    // ── 量化：调用次数与 prompt 字符预算（token 代理）──
    expect(llmCalls.length).toBe(2)
    expect(llmCalls[0]).toContain('coreIds')
    expect(llmCalls[0]).not.toContain('依赖:') // 方案 B：结构调用不带依赖字段
    expect(llmCalls[1]).toContain('seqMessages')
    expect(llmCalls[1]).toContain('核心包摘要')

    const fullChars = indexSummary(index).length
    const sharedChars = llmCalls[0]!.length + llmCalls[1]!.length
    const legacyChars = LEGACY_AUTO_LLM_CALLS * fullChars
    // eslint-disable-next-line no-console
    console.log(`[chain-budget] full-summary=${fullChars} chars; legacy≈${legacyChars} chars over ${LEGACY_AUTO_LLM_CALLS} calls`)
    // eslint-disable-next-line no-console
    console.log(`[chain-budget] shared=${sharedChars} chars over ${llmCalls.length} calls; calls ${LEGACY_AUTO_LLM_CALLS}→${llmCalls.length}, input saving=${Math.round((1 - sharedChars / legacyChars) * 100)}%`)
    expect(sharedChars).toBeLessThan(legacyChars * 0.5)
  })

  it('keeps the docs-first authority: a documented workspace costs ZERO LLM calls', async () => {
    const index = largeIndex()
    // One zh doc (probed first for non-English roles) carries every
    // authoritative stage: concept headings, a 时序 section, and a mermaid
    // flow block — so concept/flow/seq all resolve from the doc, never LLM.
    // (The doc-section parser excludes '-' in names, so the fixture lines
    // use hyphen-free participants.)
    const doc = [
      '# 架构',
      '## 概念层级',
      '### 运行核心',
      '#### 调度',
      '### 入口层',
      '## 时序',
      '前端 -> 后端: 调用 后端',
      '后端 -> 存储: 调用 存储',
      '存储 -> 前端: 返回结果',
      '## 主流程',
      '```mermaid',
      'flowchart TD',
      '  pkg-0 --> pkg-1',
      '```',
    ].join('\n')
    const fs = fakeFs({ 'docs/architecture.zh.md': doc })
    const ctx = fakeCtx()

    const tree = await conceptTree(ctx, fs, '/ws', index, '中文', false)
    expect(Array.isArray(tree)).toBe(true)
    expect((tree as Array<{ source: string }>)[0]!.source).toBe('doc')

    const flow = await flowDiagram(ctx, fs, '/ws', index, '中文', false)
    expect('source' in flow && flow.source).toBe('doc')

    const seq = await resolveSequence(ctx, fs, '/ws', index, '中文', undefined, 'flow')
    expect(seq!.source).toBe('doc')

    expect(llmCalls.length).toBe(0)
  })

  it('n×n: a doc flow block anchors entity×event only — pipeline and method cells resolve independently', async () => {
    const index = largeIndex()
    const doc = [
      '# 架构',
      '## 主流程',
      '```mermaid',
      'flowchart TD',
      '  pkg-0 --> pkg-1',
      '```',
    ].join('\n')
    const fs = fakeFs({ 'docs/architecture.zh.md': doc })
    const ctx = fakeCtx()

    // entity × event: the doc claim wins (zero LLM).
    const event = await flowDiagram(ctx, fs, '/ws', index, '中文', false, 'event')
    expect('source' in event && event.source).toBe('doc')
    expect(llmCalls.length).toBe(0)

    // entity × pipeline: the doc does NOT apply — the shared profile's
    // pipeline projection serves it (still zero per-cell LLM).
    const pipeline = await flowDiagram(ctx, fs, '/ws', index, '中文', false, 'pipeline')
    expect(!('error' in pipeline)).toBe(true)
    expect('source' in pipeline && pipeline.source).toBe('flow')
    expect('angle' in pipeline && pipeline.angle).toBe('pipeline')
    expect('mermaid' in pipeline && pipeline.mermaid).toContain('pkg-1 --> pkg-2')
    expect(llmCalls.length).toBe(2) // shared profile only

    // method × event: the doc does NOT apply either — own method-level induction.
    const methodEvent = await flowDiagram(ctx, fs, '/ws', index, '中文', false, 'event', undefined, true)
    expect(!('error' in methodEvent)).toBe(true)
    expect('source' in methodEvent && methodEvent.source).toBe('flow')
    expect('mermaid' in methodEvent && methodEvent.mermaid).toContain('pkg-2 --> pkg-3')
    expect(llmCalls.length).toBe(3) // profile (2) + method induction (1)
  })

  it('concept tree skips the README hub: a README-only workspace falls through to the profile', async () => {
    const index = largeIndex()
    // The README hierarchy (安装/使用/界面速查) is a usage TOC, not an
    // architecture claim — the concept chain excludes it and falls through.
    const fs = fakeFs({ 'README.md': '# 项目\n## 安装\n## 使用\n### 界面速查\n' })
    const ctx = fakeCtx()

    const tree = await conceptTree(ctx, fs, '/ws', index, '中文', false)
    expect(Array.isArray(tree)).toBe(true)
    const nodes = tree as Array<{ source: string; name: string }>
    expect(nodes[0]!.source).toBe('flow')
    expect(nodes[0]!.name).toBe('运行核心')
    expect(llmCalls.length).toBe(2) // shared profile only (no README extraction)
  })

  it('falls through a too-shallow doc tree (single heading) to the shared profile', async () => {
    const index = largeIndex()
    // A doc with ONE heading is not a hierarchy: the concept tree must fall
    // through to the profile's 8-node LLM tree instead of rendering a single
    // isolated box, while flow/seq still resolve from the doc.
    const shallow = [
      '## 时序',
      '前端 -> 后端: 调用 后端',
      '后端 -> 存储: 调用 存储',
      '存储 -> 前端: 返回结果',
    ].join('\n')
    // A usage doc (non-claim) with a single flat section: no concept section,
    // no claim docs → the profile wins.
    const fs = fakeFs({ 'docs/usage.zh.md': shallow })
    const ctx = fakeCtx()

    const tree = await conceptTree(ctx, fs, '/ws', index, '中文', false)
    expect(Array.isArray(tree)).toBe(true)
    const nodes = tree as Array<{ source: string; name: string; children?: unknown[] }>
    // Profile concept tree wins (its structure call is part of the shared
    // 2-call profile generation, so llmCalls stays at 2): a real hierarchy
    // with 2 roots, instead of the doc's single isolated heading.
    expect(nodes.length).toBe(2)
    expect(nodes[0]!.source).toBe('flow')
    expect(nodes[0]!.name).toBe('运行核心')
    expect(nodes[0]!.children?.length).toBe(1)

    // flow: the shallow doc carries no mermaid flow block, so it correctly
    // falls back to the shared profile (no extra LLM call — profile cached).
    const flow = await flowDiagram(ctx, fs, '/ws', index, '中文', false)
    expect('source' in flow && flow.source).toBe('flow')
    // seq: the doc's 时序 section is still authoritative.
    const seq = await resolveSequence(ctx, fs, '/ws', index, '中文', undefined, 'flow')
    expect(seq!.source).toBe('doc')

    expect(llmCalls.length).toBe(2) // shared profile only: structure + figures
  })
})
