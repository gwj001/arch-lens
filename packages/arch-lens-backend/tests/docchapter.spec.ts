/**
 * V1 chapter doc-generation tests: registry/fact packing/prompt contract,
 * extraction, the hallucination gate with its one repair round, envelope
 * caching and the serial chapter loop (skip fresh / skip figure-missing /
 * generate code-fact chapters).
 *
 * The LLM boundary is mocked at docsgen.llmText (the same seam every other
 * generation-chain spec uses): responses come from a per-test queue so each
 * scenario scripts the draft (and the repair round) exactly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))

const llmCalls: string[] = []
let llmResponses: string[] = []
vi.mock('../src/docsgen.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/docsgen.ts')>()
  return {
    ...actual,
    llmText: vi.fn(async (_ctx: unknown, prompt: string) => {
      llmCalls.push(prompt)
      const next = llmResponses.shift()
      if (next === undefined) throw new Error(`unexpected LLM call: ${prompt.slice(0, 80)}`)
      return next
    }),
  }
})

import { FakeFs, fsTarget } from './fake-fs.ts'
import { readRawCache, readVersionedCache, writeVersionedCache } from '../src/fact-cache.ts'
import { writeExplainCache } from '../src/explain-cache.ts'
import {
  DOC_CHAPTER_KINDS, buildGroundTruth, chapterCacheName, chapterDocPath, chapterFigureBlocks,
  chapterPrompt, chapterRepairPrompt, chapterRevisePrompt, chapterTitle, extractChapterMarkdown,
  generateDocChapter, generateDocChapters, packChapterFacts, readChapterCache,
} from '../src/docchapter.ts'
import type { DocChapterCache } from '../src/docchapter.ts'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import type { ArchLensGraph } from '../src/types.ts'

const FACTS_VERSION = 100
const ROOT = '/ws'

function makeIndex(): CodeIndexResult {
  return {
    root: ROOT,
    language: 'typescript',
    packages: [
      {
        id: 'gateway',
        path: `${ROOT}/packages/gateway`,
        language: 'typescript',
        deps: ['auth-core'],
        entities: [
          { name: 'Gateway', kind: 'class', file: 'packages/gateway/src/index.ts', line: 1 },
          { name: 'start', kind: 'method', file: 'packages/gateway/src/index.ts', line: 5 },
        ],
        imports: [{ from: 'packages/gateway/src/index.ts', to: 'auth-core', names: [] }],
        entryFiles: ['src/index.ts'],
      },
      {
        id: 'auth-core',
        path: `${ROOT}/packages/auth-core`,
        language: 'typescript',
        deps: [],
        entities: [{ name: 'Token', kind: 'class', file: 'packages/auth-core/src/token.ts', line: 1 }],
        imports: [],
        entryFiles: ['src/token.ts'],
      },
    ],
  }
}

function makeGraph(): ArchLensGraph {
  const detail = (id: string, blurb: string) => ({
    id, short: id, group: '', blurb, files: [], deps: [], dependents: [], snippet: '', keyLines: [],
  })
  return {
    root: ROOT,
    groups: [''],
    nodes: [
      { id: 'gateway', short: 'gateway', group: '', blurb: '入口网关', files: [], deps: ['auth-core'], path: `${ROOT}/packages/gateway`, detail: detail('gateway', '入口网关') },
      { id: 'auth-core', short: 'auth-core', group: '', blurb: '令牌校验', files: [], deps: [], path: `${ROOT}/packages/auth-core`, detail: detail('auth-core', '令牌校验') },
    ],
    edges: [{ from: 'gateway', to: 'auth-core' }],
  }
}

async function seedGraphCache(fs: FakeFs, generatedAt: number): Promise<void> {
  await fs.writeText(fsTarget('index/.arch-lens-graph.json'), JSON.stringify({ root: ROOT, generatedAt }))
}

describe('docchapter registry', () => {
  it('seven chapters keyed by DocKind, in comprehension-spine order', () => {
    expect(DOC_CHAPTER_KINDS).toEqual(['catalog', 'concepts', 'deps', 'seq', 'flow', 'er', 'interaction'])
  })

  it('landing paths always carry the .generated.md safety suffix', () => {
    for (const kind of DOC_CHAPTER_KINDS) {
      expect(chapterDocPath(kind)).toBe(`docs/architecture-${kind}.generated.md`)
    }
  })

  it('cache names are per chapter and per language', () => {
    expect(chapterCacheName('seq', '中文')).toBe('index/.arch-lens-docchapter-seq-default.json')
    expect(chapterCacheName('seq', 'English')).toBe('index/.arch-lens-docchapter-seq-English.json')
  })

  it('titles follow the role language', () => {
    expect(chapterTitle('er', '中文')).toBe('实体关系')
    expect(chapterTitle('er', 'English')).toBe('Entity Relationships')
  })
})

describe('buildGroundTruth (same snapshot for prompt and gate)', () => {
  it('unions packages, collects index files, and keys real edges', () => {
    const truth = buildGroundTruth(makeIndex(), makeGraph())
    expect(truth.packages.has('gateway')).toBe(true)
    expect(truth.packages.has('auth-core')).toBe(true)
    // Entity files + rebased entry files + call fromFiles.
    expect(truth.files.has('packages/gateway/src/index.ts')).toBe(true)
    expect(truth.files.has('packages/auth-core/src/token.ts')).toBe(true)
    expect(truth.edges.has('gateway\0auth-core')).toBe(true)
    expect(truth.edges.has('auth-core\0gateway')).toBe(false)
  })
})

describe('packChapterFacts (pure consumer of figure caches)', () => {
  it('figure-driven chapters yield null without their figure cache', async () => {
    const empty = { concepts: null, seq: null, flowEvent: null, flowPipeline: null, interaction: null, core: null, duties: null }
    for (const kind of ['concepts', 'seq', 'flow', 'interaction'] as const) {
      expect(await packChapterFacts(kind, makeIndex(), makeGraph(), empty)).toBeNull()
    }
  })

  it('code-fact chapters always pack (roster + real edge table)', async () => {
    const empty = { concepts: null, seq: null, flowEvent: null, flowPipeline: null, interaction: null, core: null, duties: null }
    const deps = await packChapterFacts('deps', makeIndex(), makeGraph(), empty)
    expect(deps).toContain('包清单')
    expect(deps).toContain('| gateway | auth-core |')
    expect(deps).toContain('入口网关')
    const er = await packChapterFacts('er', makeIndex(), makeGraph(), empty)
    expect(er).toContain('Token（class）@ auth-core/')
    const catalog = await packChapterFacts('catalog', makeIndex(), makeGraph(), empty)
    expect(catalog).toContain('entry: src/index.ts')
    expect(catalog).toContain('deps: auth-core')
  })

  it('cascade context (§4.2): upstream core selection anchors the figure-less chapters', async () => {
    const core = { ids: ['gateway', 'auth-core'], source: 'flow' as const }
    const base = { concepts: null, seq: null, flowEvent: null, flowPipeline: null, interaction: null, duties: null }
    // Code-fact chapters (er/catalog) gain the protagonists line.
    const er = await packChapterFacts('er', makeIndex(), makeGraph(), { ...base, core })
    expect(er).toContain('■ 主干核心包（上游结论，source=flow）')
    expect(er).toContain('gateway, auth-core')
    const catalog = await packChapterFacts('catalog', makeIndex(), makeGraph(), { ...base, core })
    expect(catalog).toContain('■ 主干核心包（上游结论，source=flow）')
    // deps IS the core-flow chapter: it keeps its dedicated block, no shared line.
    const deps = await packChapterFacts('deps', makeIndex(), makeGraph(), { ...base, core })
    expect(deps).not.toContain('■ 主干核心包')
    expect(deps).toContain('■ 核心流包（图缓存，source=flow）')
    expect(deps).toContain('gateway, auth-core')
    // Figure-driven chapters keep their own figure essence (no protagonists
    // line — that keeps the `core` cascade narrow): flow/interaction get the
    // golden path instead (covered below).
    const concepts = await packChapterFacts('concepts', makeIndex(), makeGraph(), { ...base, core, concepts: [{ id: 'c', name: 'x', desc: '' }] })
    expect(concepts).not.toContain('■ 主干核心包')
  })

  it('no core figure ⇒ no protagonists line (graceful, unchanged facts)', async () => {
    const empty = { concepts: null, seq: null, flowEvent: null, flowPipeline: null, interaction: null, core: null, duties: null }
    for (const kind of ['er', 'catalog', 'deps'] as const) {
      const facts = await packChapterFacts(kind, makeIndex(), makeGraph(), empty)
      expect(facts).not.toContain('主干核心包')
    }
    // An empty core selection also injects nothing.
    const er = await packChapterFacts('er', makeIndex(), makeGraph(), { ...empty, core: { ids: [], source: 'flow' as const } })
    expect(er).not.toContain('主干核心包')
  })

  it('cascade context (§4.2): golden path flows into the flow & interaction chapters', async () => {
    const seq = { source: 'flow' as const, messages: [{ from: 'gateway', to: 'auth-core', label: '校验令牌' }] }
    const base = { concepts: null, seq: null, flowEvent: null, flowPipeline: null, interaction: null, core: null, duties: null }
    const flow = await packChapterFacts('flow', makeIndex(), makeGraph(), { ...base, seq, flowEvent: { title: 't', source: 'flow' as const, mermaid: 'flowchart TD' } })
    expect(flow).toContain('■ 黄金路径（上游时序结论，source=flow）')
    expect(flow).toContain('gateway → auth-core：校验令牌')
    const interaction = await packChapterFacts('interaction', makeIndex(), makeGraph(), { ...base, seq, interaction: [{ event: 'e', mode: 'emit', producers: ['gateway'], consumers: ['auth-core'], note: '' }] })
    expect(interaction).toContain('■ 黄金路径（上游时序结论，source=flow）')
    // Chapters not downstream of the golden path do not receive it.
    const catalog = await packChapterFacts('catalog', makeIndex(), makeGraph(), { ...base, seq })
    expect(catalog).not.toContain('黄金路径')
    // No seq figure ⇒ no golden-path block.
    const flowNoSeq = await packChapterFacts('flow', makeIndex(), makeGraph(), { ...base, seq: null, flowEvent: { title: 't', source: 'flow' as const, mermaid: 'flowchart TD' } })
    expect(flowNoSeq).not.toContain('黄金路径')
  })
})

describe('prompts and extraction', () => {
  it('the prompt embeds the facts and the strict JSON contract', () => {
    const zh = chapterPrompt('deps', '中文', '■ 包清单（2）')
    expect(zh).toContain('【事实】')
    expect(zh).toContain('{"markdown"')
    expect(zh).toContain('只能使用')
    const en = chapterPrompt('deps', 'English', 'FACT BLOCK')
    expect(en).toContain('[FACTS]')
    expect(en).toContain('FACT BLOCK')
  })

  it('the repair prompt lists violations and forbids semantic changes', () => {
    const prompt = chapterRepairPrompt('中文', [{ kind: 'package', token: '@app/ghost', reason: '事实中不存在该包', suggestion: 'gateway' }], '## 旧章节')
    expect(prompt).toContain('@app/ghost')
    expect(prompt).toContain('禁止改动其余语义与结构')
    expect(prompt).toContain('## 旧章节')
  })

  it('extractChapterMarkdown tolerates wrapping prose, rejects garbage', () => {
    expect(extractChapterMarkdown('{"markdown": "## 正文"}')).toBe('## 正文')
    expect(extractChapterMarkdown('好的：{"markdown": "## 正文"} 完毕')).toBe('## 正文')
    expect(extractChapterMarkdown('完全没有 JSON')).toBeNull()
    expect(extractChapterMarkdown('{"markdown": "   "}')).toBeNull()
    expect(extractChapterMarkdown('{"other": 1}')).toBeNull()
  })

  it('the revision prompt composes preamble + prior + the chapter contract', () => {
    const zh = chapterRevisePrompt('deps', '中文', '■ 事实块', '## 旧稿正文')
    expect(zh).toContain('上一版')
    expect(zh).toContain('【上一版章节】')
    expect(zh).toContain('## 旧稿正文')
    expect(zh).toContain('【事实】\n■ 事实块')
    expect(zh).toContain('{"markdown"') // same strict JSON contract
    expect(zh).toContain('只能使用')     // same facts-only rule
    const en = chapterRevisePrompt('deps', 'English', 'FACTS', 'old body')
    expect(en).toContain('PRIOR DRAFT')
    expect(en).toContain('old body')
    expect(en).toContain('[FACTS]')
  })
})

describe('chapter envelope cache', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs({ '': null, 'index': null })
    llmCalls.length = 0
    llmResponses = []
  })

  it('round-trips on the current facts version, refuses stale', async () => {
    await seedGraphCache(fs, FACTS_VERSION)
    const target = fsTarget(chapterCacheName('deps', '中文'))
    await writeVersionedCache(fs as never, target, { markdown: '## 依赖', generatedAt: 1 }, FACTS_VERSION)
    expect(await readChapterCache(fs as never, ROOT, 'deps', '中文')).toMatchObject({ markdown: '## 依赖' })
    await seedGraphCache(fs, FACTS_VERSION + 1)
    expect(await readChapterCache(fs as never, ROOT, 'deps', '中文')).toBeNull()
  })
})

describe('chapterFigureBlocks (zero-LLM figure embedding at landing)', () => {
  const empty = { concepts: null, seq: null, flowEvent: null, flowPipeline: null, interaction: null, core: null, duties: null }

  it('flow: verbatim mermaid fences per angle under the figure section', () => {
    const blocks = chapterFigureBlocks('flow', {
      ...empty,
      flowEvent: { title: '主流程', source: 'flow' as const, mermaid: 'flowchart TD\n  gateway --> auth-core' },
      flowPipeline: { title: '管道', source: 'doc' as const, mermaid: 'flowchart LR\n  auth-core --> gateway' },
    }, makeGraph(), '中文')
    expect(blocks).toContain('## 图示')
    expect(blocks).toContain('### 主流程')
    expect(blocks).toContain('```mermaid\nflowchart TD\n  gateway --> auth-core\n```')
    expect(blocks).toContain('```mermaid\nflowchart LR\n  auth-core --> gateway\n```')
    expect(chapterFigureBlocks('flow', empty, makeGraph(), '中文')).toBe('')
  })

  it('seq: rule-built sequenceDiagram with first-seen participants', () => {
    const blocks = chapterFigureBlocks('seq', {
      ...empty,
      seq: {
        source: 'flow' as const,
        messages: [
          { from: 'gateway', to: 'auth-core', label: '校验令牌' },
          { from: 'auth-core', to: 'gateway', label: '返回结果' },
        ],
      },
    }, makeGraph(), '中文')
    expect(blocks).toContain('sequenceDiagram')
    expect(blocks).toContain('participant gateway')
    expect(blocks).toContain('participant auth-core')
    expect(blocks).toContain('gateway->>auth-core: 校验令牌')
    // Participants appear once, in first-seen order.
    expect(blocks.split('participant gateway')).toHaveLength(2)
  })

  it('deps/er: rule mermaid from the core selection; no core cache → no block', () => {
    const cache = { ...empty, core: { ids: ['gateway', 'auth-core'], source: 'flow' as const } }
    expect(chapterFigureBlocks('deps', cache, makeGraph(), '中文')).toContain('```mermaid')
    expect(chapterFigureBlocks('er', cache, makeGraph(), '中文')).toContain('```mermaid')
    expect(chapterFigureBlocks('deps', empty, makeGraph(), '中文')).toBe('')
    expect(chapterFigureBlocks('er', empty, makeGraph(), '中文')).toBe('')
  })

  it('concepts: nested list; interaction: event table; catalog: never a block', () => {
    const concepts = chapterFigureBlocks('concepts', {
      ...empty,
      concepts: [{ id: 'c1', name: '运行核心', desc: '调度一切', children: [{ id: 'c2', name: '入口', desc: '接收请求' }] }],
    }, makeGraph(), '中文')
    expect(concepts).toContain('- **运行核心** — 调度一切')
    expect(concepts).toContain('  - **入口** — 接收请求')
    const interaction = chapterFigureBlocks('interaction', {
      ...empty,
      interaction: [{ event: 'session/event', mode: 'waterfall', producers: ['gateway'], consumers: ['auth-core'], note: '' }],
    }, makeGraph(), '中文')
    expect(interaction).toContain('| 事件 | 模式 | 生产者 | 消费者 | 说明 |')
    expect(interaction).toContain('| session/event | waterfall | gateway | auth-core |  |')
    expect(chapterFigureBlocks('catalog', cacheWithEverything(), makeGraph(), '中文')).toBe('')

    function cacheWithEverything() {
      return {
        concepts: [{ id: 'c', name: 'x', desc: '' }],
        seq: { source: 'flow' as const, messages: [{ from: 'a', to: 'b', label: 'l' }] },
        flowEvent: { title: 't', source: 'flow' as const, mermaid: 'flowchart TD' },
        flowPipeline: null,
        interaction: [{ event: 'e', mode: 'emit', producers: ['a'], consumers: ['b'], note: '' }],
        core: { ids: ['a'], source: 'flow' as const },
        duties: null,
      }
    }
  })

  it('English uses the Figures heading', () => {
    const blocks = chapterFigureBlocks('seq', {
      ...empty,
      seq: { source: 'flow' as const, messages: [{ from: 'gateway', to: 'auth-core', label: 'check' }] },
    }, makeGraph(), 'English')
    expect(blocks).toContain('## Figures')
  })
})

describe('generateDocChapter (one chapter end to end)', () => {
  let fs: FakeFs
  beforeEach(async () => {
    fs = new FakeFs({ '': null, 'index': null })
    await seedGraphCache(fs, FACTS_VERSION)
    llmCalls.length = 0
    llmResponses = []
  })

  const args = () => {
    const index = makeIndex()
    const graph = makeGraph()
    return {
      index, graph,
      facts: '■ 包清单（2）\n- gateway — 入口网关\n- auth-core — 令牌校验',
      truth: buildGroundTruth(index, graph),
      ids: ['gateway', 'auth-core'],
    }
  }

  it('faithful prose: lands the doc, stamps the envelope, one LLM call', async () => {
    const { facts, truth, ids } = args()
    llmResponses = [JSON.stringify({ markdown: '## 依赖\n\n`gateway` 依赖 `auth-core`（见 `packages/auth-core/src/token.ts`）。' })]
    const blocks = '## 图示\n\n```mermaid\nflowchart TD\n  gateway --> auth-core\n```'
    const outcome = await generateDocChapter({} as never, fs as never, ROOT, 'deps', '中文', facts, truth, FACTS_VERSION, ids, blocks)
    expect(outcome.state).toBe('generated')
    expect(outcome.degraded).toBeUndefined()
    expect(outcome.violations).toBe(0)
    expect(llmCalls).toHaveLength(1)
    // Landed file: provenance header + chapter body + figure block.
    const doc = await fs.readText(fsTarget('docs/architecture-deps.generated.md'))
    expect(doc).toContain('arch-lens generated · chapter=deps')
    expect(doc).toContain('# 依赖')
    expect(doc).toContain('`gateway` 依赖 `auth-core`')
    expect(doc).toContain('```mermaid\nflowchart TD\n  gateway --> auth-core\n```')
    // Envelope: current version + package deps.
    const cached = await readVersionedCache<DocChapterCache>(fs as never, fsTarget(chapterCacheName('deps', '中文')), FACTS_VERSION)
    expect(cached?.markdown).toContain('## 依赖')
    const raw = JSON.parse(await fs.readText(fsTarget(chapterCacheName('deps', '中文')))) as { deps?: string[] }
    expect(raw.deps).toEqual(['gateway', 'auth-core'])
  })

  it('a violating draft gets one repair round; the fixed prose is cached', async () => {
    const { facts, truth, ids } = args()
    llmResponses = [
      JSON.stringify({ markdown: '## 依赖\n\n会话交给 `@app/session-store` 持久化。' }),
      JSON.stringify({ markdown: '## 依赖\n\n`gateway` 依赖 `auth-core`。' }),
    ]
    const outcome = await generateDocChapter({} as never, fs as never, ROOT, 'deps', '中文', facts, truth, FACTS_VERSION, ids)
    expect(outcome.state).toBe('generated')
    expect(outcome.degraded).toBeUndefined()
    expect(outcome.violations).toBe(1) // first-draft count, repaired afterwards
    expect(llmCalls).toHaveLength(2)
    expect(llmCalls[1]).toContain('@app/session-store') // repair prompt carries the violation
    const cached = await readVersionedCache<DocChapterCache>(fs as never, fsTarget(chapterCacheName('deps', '中文')), FACTS_VERSION)
    expect(cached?.markdown).toContain('`gateway` 依赖 `auth-core`')
  })

  it('still violating after repair: lands with a warning, NO cache', async () => {
    const { facts, truth, ids } = args()
    const bad = JSON.stringify({ markdown: '## 依赖\n\n会话交给 `@app/session-store` 持久化。' })
    llmResponses = [bad, bad]
    const outcome = await generateDocChapter({} as never, fs as never, ROOT, 'deps', '中文', facts, truth, FACTS_VERSION, ids)
    expect(outcome.state).toBe('generated')
    expect(outcome.degraded).toBe(true)
    expect(llmCalls).toHaveLength(2)
    const doc = await fs.readText(fsTarget('docs/architecture-deps.generated.md'))
    expect(doc).toContain('⚠️')
    expect(fs.files.has(chapterCacheName('deps', '中文'))).toBe(false)
  })

  it('a draft without the JSON contract fails the chapter', async () => {
    const { facts, truth, ids } = args()
    llmResponses = ['这一轮模型只回了散文，没有 JSON。']
    const outcome = await generateDocChapter({} as never, fs as never, ROOT, 'deps', '中文', facts, truth, FACTS_VERSION, ids)
    expect(outcome.state).toBe('failed')
    expect(outcome.reason).toContain('JSON')
    expect(fs.files.has('docs/architecture-deps.generated.md')).toBe(false)
  })

  it('a prior draft switches the first call to the revision prompt', async () => {
    const { facts, truth, ids } = args()
    llmResponses = [JSON.stringify({ markdown: '## 依赖\n\n`gateway` 依赖 `auth-core`。' })]
    const outcome = await generateDocChapter(
      {} as never, fs as never, ROOT, 'deps', '中文', facts, truth, FACTS_VERSION, ids,
      '', undefined, '## 依赖（旧稿）\n\n旧事实下的正文。',
    )
    expect(outcome.state).toBe('generated')
    expect(llmCalls).toHaveLength(1)
    expect(llmCalls[0]).toContain('【上一版章节】')
    expect(llmCalls[0]).toContain('旧事实下的正文')
    expect(llmCalls[0]).toContain('【事实】') // facts still authoritative
    // The revised faithful prose still lands the envelope.
    const cached = await readVersionedCache<DocChapterCache>(fs as never, fsTarget(chapterCacheName('deps', '中文')), FACTS_VERSION)
    expect(cached?.markdown).toContain('`gateway` 依赖 `auth-core`')
  })
})

describe('generateDocChapters (the serial one-click loop)', () => {
  let fs: FakeFs
  beforeEach(async () => {
    fs = new FakeFs({ '': null, 'index': null })
    await seedGraphCache(fs, FACTS_VERSION)
    llmCalls.length = 0
    llmResponses = []
  })

  const faithful = (title: string) => JSON.stringify({ markdown: `## ${title}\n\n正文。` })

  it('skips figure-driven chapters (pure consumer) and generates code-fact chapters', async () => {
    llmResponses = [faithful('依赖'), faithful('实体关系'), faithful('包目录职责')]
    const result = await generateDocChapters({} as never, fs as never, ROOT, makeIndex(), makeGraph(), '中文')
    const byKind = new Map(result.outcomes.map(outcome => [outcome.kind, outcome]))
    for (const kind of ['concepts', 'seq', 'flow', 'interaction'] as const) {
      expect(byKind.get(kind)?.state).toBe('skipped')
      expect(byKind.get(kind)?.reason).toContain('figure-missing')
    }
    for (const kind of ['deps', 'er', 'catalog'] as const) {
      expect(byKind.get(kind)?.state).toBe('generated')
    }
    expect(llmCalls).toHaveLength(3)
    expect(fs.files.has('docs/architecture-deps.generated.md')).toBe(true)
    expect(fs.files.has('docs/architecture-er.generated.md')).toBe(true)
    expect(fs.files.has('docs/architecture-catalog.generated.md')).toBe(true)
  })

  it('fresh caches are skipped — re-clicking only fills the gaps', async () => {
    await writeVersionedCache(
      fs as never, fsTarget(chapterCacheName('deps', '中文')),
      { markdown: '## 依赖（旧）', generatedAt: 1 }, FACTS_VERSION,
    )
    llmResponses = [faithful('实体关系'), faithful('包目录职责')]
    const result = await generateDocChapters({} as never, fs as never, ROOT, makeIndex(), makeGraph(), '中文')
    const deps = result.outcomes.find(outcome => outcome.kind === 'deps')
    expect(deps?.state).toBe('skipped')
    expect(deps?.reason).toBe('cache-fresh')
    expect(llmCalls).toHaveLength(2)
  })

  it('a stale envelope becomes the prior draft for revision (not a fresh skip, not blank)', async () => {
    // Written against an OLDER facts version: the fresh read refuses it, the
    // prior read serves it as a revision draft.
    await writeVersionedCache(
      fs as never, fsTarget(chapterCacheName('deps', '中文')),
      { markdown: '## 依赖（旧事实稿）', generatedAt: 1 }, FACTS_VERSION - 1,
    )
    llmResponses = [faithful('包目录职责'), faithful('依赖'), faithful('实体关系')]
    const result = await generateDocChapters({} as never, fs as never, ROOT, makeIndex(), makeGraph(), '中文')
    const deps = result.outcomes.find(outcome => outcome.kind === 'deps')
    expect(deps?.state).toBe('generated')
    expect(llmCalls).toHaveLength(3)
    // Generation order is the comprehension spine: catalog → deps → er. Only
    // the middle call (deps) carries the prior draft.
    expect(llmCalls[0]).not.toContain('上一版章节')
    expect(llmCalls[1]).toContain('【上一版章节】')
    expect(llmCalls[1]).toContain('## 依赖（旧事实稿）')
    expect(llmCalls[2]).not.toContain('上一版章节')
    // The revised chapter re-caches against the CURRENT facts version.
    const cached = await readVersionedCache<DocChapterCache>(fs as never, fsTarget(chapterCacheName('deps', '中文')), FACTS_VERSION)
    expect(cached).not.toBeNull()
  })

  it('landed envelopes record the spine `requires` of the figures they embed', async () => {
    // Seed every figure cache so all seven chapters generate.
    fs.setFile('index/.arch-lens-concept-default.json', JSON.stringify({ v: FACTS_VERSION, deps: [], data: [{ id: 'c', name: 'x', desc: '' }] }))
    fs.setFile('index/.arch-lens-sequence-default.json', JSON.stringify({ v: FACTS_VERSION, deps: [], data: { source: 'flow', messages: [{ from: 'gateway', to: 'auth-core', label: '校验' }] } }))
    fs.setFile('index/.arch-lens-flow-default-event.json', JSON.stringify({ v: FACTS_VERSION, deps: [], data: { title: 't', source: 'flow', mermaid: 'flowchart TD\nA-->B' } }))
    fs.setFile('index/.arch-lens-events-default.json', JSON.stringify({ v: FACTS_VERSION, deps: [], data: [{ event: 'e', mode: 'emit', producers: ['gateway'], consumers: ['auth-core'], note: '' }] }))
    fs.setFile('index/.arch-lens-core-default.json', JSON.stringify({ v: FACTS_VERSION, deps: [], data: { ids: ['gateway', 'auth-core'], source: 'flow' } }))
    llmResponses = [
      faithful('包目录职责'), faithful('概念层级'), faithful('依赖'), faithful('时序'),
      faithful('流程图'), faithful('实体关系'), faithful('核心交互'),
    ]
    const result = await generateDocChapters({} as never, fs as never, ROOT, makeIndex(), makeGraph(), '中文')
    expect(result.outcomes.every(outcome => outcome.state === 'generated')).toBe(true)
    // Chapters require every cache whose content they consume: their embedded
    // figure(s) plus cascade-context inputs — flow/interaction carry the golden
    // path (seq), er/catalog anchor on the core protagonists.
    const requires = async (kind: 'concepts' | 'seq' | 'flow' | 'interaction' | 'deps' | 'er' | 'catalog') =>
      (await readRawCache(fs as never, fsTarget(chapterCacheName(kind, '中文'))))?.requires
    expect(await requires('concepts')).toEqual(['concepts'])
    expect(await requires('seq')).toEqual(['seq'])
    expect(await requires('flow')).toEqual(['flow-event', 'flow-pipeline', 'seq'])
    expect(await requires('interaction')).toEqual(['interaction', 'seq'])
    expect(await requires('deps')).toEqual(['core'])
    expect(await requires('er')).toEqual(['core'])
    expect(await requires('catalog')).toEqual(['core'])
  })

  it('phase 3: a fresh explain lands the chapter with ZERO extra LLM calls', async () => {
    await writeExplainCache(
      fs as never, ROOT, 'catalog', '中文',
      { markdown: '## 包目录职责\n\n`gateway` 是入口网关。', target: '包目录', question: '请讲解', at: 1 },
      FACTS_VERSION, undefined, ['core'],
    )
    llmResponses = [faithful('依赖'), faithful('实体关系')] // only deps/er still need LLM
    const result = await generateDocChapters({} as never, fs as never, ROOT, makeIndex(), makeGraph(), '中文')
    const catalog = result.outcomes.find(outcome => outcome.kind === 'catalog')
    expect(catalog?.state).toBe('generated')
    expect(llmCalls).toHaveLength(2)
    expect(llmCalls.every(prompt => !prompt.includes('包目录职责'))).toBe(true) // catalog: zero LLM
    expect(fs.files.has('docs/architecture-catalog.generated.md')).toBe(true)
    // The landed chapter is cached like any other: re-clicking skips it.
    const cached = await readVersionedCache<DocChapterCache>(fs as never, fsTarget(chapterCacheName('catalog', '中文')), FACTS_VERSION)
    expect(cached?.markdown).toContain('`gateway` 是入口网关')
    expect((await readRawCache(fs as never, fsTarget(chapterCacheName('catalog', '中文'))))?.requires).toEqual(['core'])
  })

  it('phase 3: a stale explain is not fresh — the normal LLM chain runs', async () => {
    await writeExplainCache(
      fs as never, ROOT, 'catalog', '中文',
      { markdown: '## 包目录职责（旧学习）', target: '包目录', question: '请讲解', at: 1 },
      FACTS_VERSION - 1, undefined, ['core'],
    )
    llmResponses = [faithful('依赖'), faithful('实体关系'), faithful('包目录职责')]
    const result = await generateDocChapters({} as never, fs as never, ROOT, makeIndex(), makeGraph(), '中文')
    expect(result.outcomes.find(outcome => outcome.kind === 'catalog')?.state).toBe('generated')
    expect(llmCalls).toHaveLength(3)
  })

  it('phase 3: an explain that fails the hallucination gate falls back to LLM', async () => {
    await writeExplainCache(
      fs as never, ROOT, 'catalog', '中文',
      { markdown: '## 包目录职责\n\n`@deepseek-ai/fake-pkg` 不存在。', target: '包目录', question: '请讲解', at: 1 },
      FACTS_VERSION, undefined, ['core'],
    )
    llmResponses = [faithful('依赖'), faithful('实体关系'), faithful('包目录职责')]
    const result = await generateDocChapters({} as never, fs as never, ROOT, makeIndex(), makeGraph(), '中文')
    expect(result.outcomes.find(outcome => outcome.kind === 'catalog')?.state).toBe('generated')
    expect(llmCalls).toHaveLength(3) // the violating explain never shipped
  })
})
