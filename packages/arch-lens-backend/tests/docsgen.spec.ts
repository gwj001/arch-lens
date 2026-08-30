/**
 * Doc assembly chain (阶段 4, D8): generateDocsFromFigures assembles
 * docs/architecture.generated.md PURELY from the figure caches — zero LLM by
 * default (the docsgen llmText boundary throws for any unexpected call),
 * missing/stale figures trigger their own registry build chains first (which
 * persist through the unified write path), and `withDescriptions` costs
 * exactly ONE batched call writing back into the SAME envelope (v/deps kept).
 * The user's docs/architecture.md is never written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))

const { llmTextSpy } = vi.hoisted(() => ({
  llmTextSpy: vi.fn(async (_ctx: unknown, prompt: string): Promise<string> => {
    // The ONE whitelisted call: the batched descriptions prompt (图清单).
    if (prompt.includes('图清单')) return '{"flow-event": "事件视角流程图：请求经协议层派发至后端组装。"}'
    throw new Error(`unexpected LLM call: ${prompt.slice(0, 60)}`)
  }),
}))
vi.mock('../src/docsgen.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/docsgen.ts')>()
  return { ...real, llmText: llmTextSpy }
})

import type { CodeIndexResult, CodePackage } from '@deepseek-ai/dsh-code-index'
import { generateDocsFromFigures, generateDocSection } from '../src/docbuild.ts'
import { writeFigure } from '../src/figures.ts'
import type { EntityFigureId } from '../src/figures.ts'
import type { ArchLensGraph } from '../src/types.ts'
import { FakeFs } from './fake-fs.ts'

const VERSION = 100
const GRAPH_FILE = 'index/.arch-lens-graph.json'
const DOC_FILE = 'docs/architecture.generated.md'

function workspace(init: Record<string, string> = {}): FakeFs {
  return new FakeFs({
    '': null,
    index: null,
    docs: null,
    [GRAPH_FILE]: JSON.stringify({ root: '/ws', generatedAt: VERSION, graph: { nodes: [], edges: [] } }),
    ...init,
  })
}

/** Packages a→b (bare specifier import) + b. */
function index(): CodeIndexResult {
  const pkg = (id: string, imports: Array<{ from: string; to: string; names: string[] }>): CodePackage => ({
    id,
    path: `/ws/packages/${id}`,
    language: 'typescript',
    deps: [],
    entities: [],
    imports,
    entryFiles: id === 'a' ? ['src/index.ts'] : [],
  })
  return {
    root: '/ws',
    language: 'typescript',
    packages: [
      pkg('a', [{ from: 'packages/a/src/index.ts', to: '@deepseek-ai/dsh-b/src/index.ts', names: [] }]),
      pkg('b', []),
    ],
  } as unknown as CodeIndexResult
}

const graph: ArchLensGraph = {
  root: '/ws',
  groups: [''],
  nodes: [
    { id: 'a', short: 'a', group: '', blurb: '协议入口', files: [], deps: ['b'], path: '/ws/packages/a', detail: {} },
    { id: 'b', short: 'b', group: '', blurb: '后端组装', files: [], deps: [], path: '/ws/packages/b', detail: {} },
  ] as unknown as ArchLensGraph['nodes'],
  edges: [{ from: 'a', to: 'b' }],
}

const ALL_FIGURES: Array<[EntityFigureId, unknown]> = [
  ['concepts', [{ id: 'c1', name: '协议层', desc: '类型契约', children: [{ id: 'c2', name: '后端', desc: '组装事实' }] }]],
  ['flow-event', { title: '事件流程', source: 'flow', angle: 'event', mermaid: 'flowchart TD\n  A --> B' }],
  ['flow-pipeline', { title: '管线流程', source: 'doc', ref: 'docs/x.md#管线', angle: 'pipeline', mermaid: 'flowchart LR\n  A --> B' }],
  ['seq', { source: 'flow', messages: [{ from: 'a', to: 'b', label: '调用' }] }],
  ['interaction', [{ event: '刷新', mode: 'emit', producers: ['a'], consumers: ['b'], note: '重读事实' }]],
  ['core', { ids: ['a', 'b'], source: 'flow' }],
  ['duties', { a: '协议与索引', b: '后端组装' }],
]

async function seed(fs: FakeFs, figures: Array<[EntityFigureId, unknown]> = ALL_FIGURES): Promise<void> {
  for (const [id, data] of figures) {
    await writeFigure(fs as never, '/ws', id, '中文', VERSION, data, { index: index() })
  }
}

const ctx = { get: () => undefined } as never

beforeEach(() => {
  llmTextSpy.mockClear()
})

async function assemble(fs: FakeFs, options: { withDescriptions?: boolean } = {}) {
  return await generateDocsFromFigures(ctx, fs as never, '/ws', index(), graph, '中文', undefined, options)
}

function envelope(fs: FakeFs, name: string): { v: number; deps?: string[]; data: Record<string, unknown> } {
  return JSON.parse(fs.files.get(name)!.content!) as ReturnType<typeof envelope>
}

describe('generateDocsFromFigures (纯组装，默认零 LLM)', () => {
  it('renders every section from the caches, in order, with zero LLM calls', async () => {
    const fs = workspace()
    await seed(fs)
    const result = await assemble(fs)
    expect(result).toMatchObject({ errors: [] })
    expect('path' in result && result.path).toBe(DOC_FILE)

    const doc = fs.files.get(DOC_FILE)!.content!
    expect(doc.startsWith('<!-- arch-lens generated -->')).toBe(true)
    const titles = ['概念层级', '流程图', '时序', '核心交互', '依赖', '实体关系', '包目录职责']
    let cursor = -1
    for (const title of titles) {
      const at = doc.indexOf(`## ${title}`)
      expect(at, `section 缺少或乱序：${title}`).toBeGreaterThan(cursor)
      cursor = at
    }
    // 内容全部来自图缓存（规则渲染）。
    expect(doc).toContain('- **协议层** — 类型契约')
    expect(doc).toContain('  - **后端** — 组装事实')
    expect(doc).toContain('### 事件视角：事件流程')
    expect(doc).toContain('> 来源：AI 归纳（非权威）')
    expect(doc).toContain('### 管线视角：管线流程')
    expect(doc).toContain('> 来源：架构文档（docs/x.md#管线）')
    expect(doc).toContain('1. `a` → `b`：调用')
    expect(doc).toContain('| 刷新 | emit | a | b | 重读事实 |')
    expect(doc).toContain('flowchart TD')
    expect(doc).toContain('核心包：`a`、`b`')
    expect(doc).toContain('- `a` → `b`')
    expect(doc).toContain('erDiagram')
    expect(doc).toContain('| `a` | 协议与索引 |')
    // 全程零 LLM；用户文档一个字节都没碰。
    expect(llmTextSpy).not.toHaveBeenCalled()
    expect(fs.files.has('docs/architecture.md')).toBe(false)
  })

  it('a missing figure triggers ITS OWN build chain (doc stage, no LLM) and the cache lands', async () => {
    const fs = workspace({
      'docs/architecture.zh.md': '# 架构\n\n## 时序\n\na -> b: 派发\nb -> a: 回包\na -> b: 确认\n\n## 其他\n无关\n',
    })
    await seed(fs, ALL_FIGURES.filter(([id]) => id !== 'seq'))
    const result = await assemble(fs)
    expect('error' in result).toBe(false)
    const doc = fs.files.get(DOC_FILE)!.content!
    expect(doc).toContain('## 时序')
    expect(doc).toContain('1. `a` → `b`：派发')
    expect(doc).toContain('> 来源：架构文档')
    // 补建的图落进统一缓存（版本化信封、deps = 端点包）。
    const env = envelope(fs, 'index/.arch-lens-sequence-default.json')
    expect(env.v).toBe(VERSION)
    expect(env.data).toMatchObject({ source: 'doc' })
    expect(env.deps).toEqual(['a', 'b'])
    expect(llmTextSpy).not.toHaveBeenCalled()
  })

  it('never writes docs/architecture.md even when the user doc exists', async () => {
    const fs = workspace({ 'docs/architecture.md': '# 用户自己的架构文档\n' })
    await seed(fs)
    await assemble(fs)
    expect(fs.files.get('docs/architecture.md')!.content).toBe('# 用户自己的架构文档\n')
  })
})

describe('D3 withDescriptions (一次批量、同信封回写)', () => {
  it('calls the LLM exactly once and keeps v/deps while adding the description', async () => {
    const fs = workspace()
    await seed(fs)
    const result = await assemble(fs, { withDescriptions: true })
    expect('error' in result).toBe(false)
    expect(llmTextSpy).toHaveBeenCalledTimes(1)

    const flowEvent = envelope(fs, 'index/.arch-lens-flow-default-event.json')
    expect(flowEvent.v).toBe(VERSION)
    expect(flowEvent.deps).toEqual(['a', 'b']) // 规则不变：AI 归纳依赖全部包
    expect(flowEvent.data.description).toBe('事件视角流程图：请求经协议层派发至后端组装。')
    expect(flowEvent.data.mermaid).toContain('flowchart TD')
    // 模型只回了一个 id：其余图保持无 description（不做第二次调用）。
    expect(envelope(fs, 'index/.arch-lens-sequence-default.json').data.description).toBeUndefined()
    // 说明段落渲染进文档。
    expect(fs.files.get(DOC_FILE)!.content).toContain('事件视角流程图：请求经协议层派发至后端组装。')
  })
})

describe('generateDocSection (单节组装版)', () => {
  it('regenerates ONE heading in place from its figure cache', async () => {
    const fs = workspace()
    await seed(fs)
    const result = await generateDocSection(ctx, fs as never, '/ws', index(), graph, '中文', 'er')
    expect('error' in result).toBe(false)
    const doc = fs.files.get(DOC_FILE)!.content!
    expect(doc).toContain('## 实体关系')
    expect(doc).toContain('erDiagram')
    // 其余节不存在也正常：单节只 merge 自己。
    expect(doc).not.toContain('## 概念层级')
    expect(llmTextSpy).not.toHaveBeenCalled()
  })
})
