/**
 * Session-driven figure generation (「图生成走会话」): the backend stages a
 * figure prompt carrying a unique figId, the client sends it into the
 * session as a user message, and the backend matches the agent's answer by
 * figId and writes the SAME cache files the figure chains read — so a plain
 * refetch renders the fresh figure. This suite covers the pure parts:
 * cache naming, prompt building, answer extraction and cache writing.
 */
import { describe, it, expect, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))

import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { CodeIndexResult, CodePackage } from '@deepseek-ai/dsh-code-index'
import {
  buildCustomFigurePrompt,
  buildDynamicFigurePrompt,
  buildFigurePrompt,
  buildFigureRepairPrompt,
  dynamicFigureCacheName,
  dynamicFigureWriteFacts,
  dynamicTargetKey,
  extractDynamicDiagram,
  extractFigureJson,
  figureCacheName,
  hashString,
  writeDynamicFigureCache,
  writeFigureCache,
} from '../src/session-figure.ts'
import { FakeFs } from './fake-fs.ts'

/** Minimal code index: a/b/c/d packages, a is the entry, a→b/c deps. */
function index(): CodeIndexResult {
  const packages: CodePackage[] = ['a', 'b', 'c', 'd'].map(id => ({
    id,
    path: `/ws/packages/${id}`,
    language: 'typescript',
    deps: id === 'a' ? ['b', 'c'] : [],
    entities: [{
      name: 'Svc',
      kind: 'class' as const,
      file: `packages/${id}/src/index.ts`,
      line: 1,
      children: [{ name: 'handle', kind: 'method' as const, file: `packages/${id}/src/index.ts`, line: 10 }],
    }],
    imports: [],
    entryFiles: id === 'a' ? [`packages/${id}/src/index.ts`] : [],
  }))
  return { root: '/ws', language: 'typescript', packages }
}

/** Recording fs: resolve/writeText capture every cache target + content.
 * 提供扫描图（generatedAt=100）作为事实版本，否则版本化写入会被禁用
 * （v=0 不落盘）。写入内容为 {v, data} 包装，与读侧 readVersionedCache 一致。 */
function fakeFs(): { fs: FileSystem; written: Array<{ path: string; content: string }> } {
  const written: Array<{ path: string; content: string }> = []
  const fs = {
    resolve: async (path: string) => ({ displayPath: path }) as never,
    stat: async (target: { displayPath: string }) => target.displayPath === 'index/.arch-lens-graph.json'
      ? { type: 'file' as const, version: 'g1', size: 10 }
      : undefined,
    readText: async (target: { displayPath: string }) => {
      if (target.displayPath === 'index/.arch-lens-graph.json') {
        return JSON.stringify({ root: '/ws', generatedAt: 100, graph: { nodes: [], edges: [] } })
      }
      throw new Error('no file')
    },
    writeText: async (target: { displayPath: string }, content: string) => {
      written.push({ path: target.displayPath, content })
      return {} as never
    },
    listDir: async () => [],
  } as unknown as FileSystem
  return { fs, written }
}

describe('figureCacheName (delegated to the figure registry — the chains’ authoritative names)', () => {
  it('sanitizes the language and appends the method-level suffix', () => {
    expect(figureCacheName('concepts', '中文')).toBe('index/.arch-lens-concept-default.json')
    expect(figureCacheName('concepts', 'English')).toBe('index/.arch-lens-concept-English.json')
    expect(figureCacheName('seq', 'English', undefined, true)).toBe('index/.arch-lens-sequence-English-methods.json')
    expect(figureCacheName('interaction', '中文')).toBe('index/.arch-lens-events-default.json')
    expect(figureCacheName('core', 'English')).toBe('index/.arch-lens-core-English.json')
  })

  it('bakes the flow angle into the flow cache name', () => {
    expect(figureCacheName('flow', 'English', 'event')).toBe('index/.arch-lens-flow-English-event.json')
    expect(figureCacheName('flow', 'English', 'pipeline', true)).toBe('index/.arch-lens-flow-English-pipeline-methods.json')
    // 无视角 = event（与链默认视角一致）：旧手写镜像在这里产出过无后缀的
    // `.arch-lens-flow-default.json`，读侧永远 miss —— 注册表委托后修复。
    expect(figureCacheName('flow', '中文')).toBe('index/.arch-lens-flow-default-event.json')
  })
})

describe('buildFigurePrompt (facts embedded, figId echoed)', () => {
  it('asks for strict JSON, embeds the index summary and the figId', () => {
    const prompt = buildFigurePrompt('flow', index(), '中文', 'fig-abc', 'event')
    expect(prompt).toContain('figId=fig-abc')
    expect(prompt).toContain('只能是一个 JSON 对象')
    expect(prompt).toContain('"figId": "<figId>"')
    expect(prompt).toContain('事件驱动')
    expect(prompt).toContain('每条边必须有动作标签')
    expect(prompt).toContain('项目摘要')
    expect(prompt).toContain('- a（typescript）')
  })

  it('switches the flow mission with the viewpoint', () => {
    expect(buildFigurePrompt('flow', index(), '中文', 'fig-1', 'pipeline')).toContain('数据管道')
  })

  it('adds the method-level rule and method facts when enabled', () => {
    const prompt = buildFigurePrompt('concepts', index(), '中文', 'fig-2', undefined, true)
    expect(prompt).toContain('方法级')
    expect(prompt).toContain('Svc{handle}')
    expect(prompt).toContain('概念层级树')
  })

  it('uses the seq induction prompt with real entry/core constraints for seq', () => {
    const prompt = buildFigurePrompt('seq', index(), '中文', 'fig-3')
    expect(prompt).toContain('你是代码时序分析师')
    expect(prompt).toContain('调用顺序')
    expect(prompt).toContain('硬性约束：每条消息的 "from" / "to" 只能是摘要中列出的包 id')
  })
})

describe('extractFigureJson (tolerates prose and fences)', () => {
  it('parses a bare JSON answer', () => {
    const answer = '好的，这是结果：\n{"figId": "fig-x", "title": "t", "mermaid": "flowchart TD\\n  a --> b"}'
    expect(extractFigureJson(answer, 'fig-x')).toEqual({ figId: 'fig-x', title: 't', mermaid: 'flowchart TD\n  a --> b' })
  })

  it('parses a fenced ```json block with trailing prose', () => {
    const answer = '我读了源码，结论如下：\n```json\n{"figId": "fig-y", "seqMessages": [{"from": "a", "to": "b", "label": "调用"}]}\n```\n希望有帮助！'
    const parsed = extractFigureJson(answer, 'fig-y')
    expect(parsed).not.toBeNull()
    expect((parsed! as { seqMessages: unknown[] }).seqMessages).toHaveLength(1)
  })

  it('handles nested concept trees via brace balancing', () => {
    const answer = '{"figId": "fig-z", "conceptTree": [{"name": "运行核心", "desc": "调度", "children": [{"name": "入口", "desc": "接收"}]}]}'
    const parsed = extractFigureJson(answer, 'fig-z')
    expect(parsed).not.toBeNull()
    const tree = (parsed! as { conceptTree: Array<{ name: string; children: unknown[] }> }).conceptTree
    expect(tree[0]!.name).toBe('运行核心')
    expect(tree[0]!.children).toHaveLength(1)
  })

  it('parses answers with more than eight inner objects (regression: the outer object was skipped by the 8-start cap)', () => {
    // A real seq answer: 12 messages + the outer object = 13 `{` starts. The
    // old extractor only scanned the last 8 starts (all inner objects, whose
    // figId never matches) and never reached the outer `{` — the figure was
    // silently dropped. Whole-text parse + a 256-start scan both cover it.
    const messages = Array.from({ length: 12 }, (_, i) => `{"from": "a", "to": "b", "label": "消息${i}"}`)
    const answer = `{"figId": "fig-many", "seqMessages": [${messages.join(',')}]}`
    const parsed = extractFigureJson(answer, 'fig-many')
    expect(parsed).not.toBeNull()
    const seq = (parsed! as { seqMessages: unknown[] }).seqMessages
    expect(seq).toHaveLength(12)
  })

  it('parses a prose-wrapped multi-object answer via the start scan', () => {
    const answer = '好的，结果如下：{"figId": "fig-w", "seqMessages": [{"from": "a", "to": "b", "label": "x"}, {"from": "b", "to": "c", "label": "y"}]} 希望有帮助！'
    const parsed = extractFigureJson(answer, 'fig-w')
    expect(parsed).not.toBeNull()
    expect((parsed! as { seqMessages: unknown[] }).seqMessages).toHaveLength(2)
  })

  it('rejects answers whose figId does not match', () => {
    expect(extractFigureJson('{"figId": "fig-other", "title": "t"}', 'fig-mine')).toBeNull()
  })

  it('returns null for prose without any JSON object', () => {
    expect(extractFigureJson('抱歉，我无法完成这个任务。', 'fig-1')).toBeNull()
  })
})

describe('writeFigureCache (persists the SAME shape the chains read)', () => {
  it('writes a sanitized flow cache with the angle stamped', async () => {
    const { fs, written } = fakeFs()
    const result = await writeFigureCache(fs, '/ws', index(), 'flow', {
      figId: 'fig-f',
      title: '主流程',
      mermaid: 'flowchart TD\n  E1 -->|触发(emit)| E2',
    }, 'English', 'event')
    expect(result).toEqual({ ok: true })
    expect(written).toHaveLength(1)
    expect(written[0]!.path).toBe('index/.arch-lens-flow-English-event.json')
    const wrapped = JSON.parse(written[0]!.content) as { v: number; data: { title: string; source: string; angle: string; mermaid: string } }
    // 版本化写入：v 必须等于扫描图 factsVersion（读侧只认这个）。
    expect(wrapped.v).toBe(100)
    const value = wrapped.data
    expect(value.source).toBe('flow')
    expect(value.angle).toBe('event')
    expect(value.title).toBe('主流程')
    expect(value.mermaid).toContain('-->|触发（emit）|')
    expect(value.mermaid).not.toContain('(')
  })

  it('writes the concept tree array with flow-source nodes', async () => {
    const { fs, written } = fakeFs()
    const result = await writeFigureCache(fs, '/ws', index(), 'concepts', {
      figId: 'fig-c',
      conceptTree: [{ name: '运行核心', desc: '调度', children: [{ name: '入口', desc: '接收' }] }],
    }, '中文')
    expect(result).toEqual({ ok: true })
    expect(written[0]!.path).toBe('index/.arch-lens-concept-default.json')
    const value = (JSON.parse(written[0]!.content) as { data: Array<{ name: string; source: string; children: unknown[] }> }).data
    expect(value[0]!.name).toBe('运行核心')
    expect(value[0]!.source).toBe('flow')
    expect(value[0]!.children).toHaveLength(1)
  })

  it('writes the seq messages validated against real package ids', async () => {
    const { fs, written } = fakeFs()
    const result = await writeFigureCache(fs, '/ws', index(), 'seq', {
      figId: 'fig-s',
      seqMessages: [
        { from: 'a', to: 'b', label: '调用 b()' },
        { from: 'a', to: 'ghost', label: '编造边' }, // unknown id dropped
      ],
    }, 'English')
    expect(result).toEqual({ ok: true })
    expect(written[0]!.path).toBe('index/.arch-lens-sequence-English.json')
    const value = (JSON.parse(written[0]!.content) as { data: { source: string; messages: Array<{ from: string; to: string }> } }).data
    expect(value.source).toBe('flow')
    expect(value.messages).toHaveLength(1)
    expect(value.messages[0]).toEqual({ from: 'a', to: 'b', label: '调用 b()' })
  })

  it('writes interaction events and core ids with the flow source marker', async () => {
    const { fs: fs1, written: written1 } = fakeFs()
    const events = await writeFigureCache(fs1, '/ws', index(), 'interaction', {
      figId: 'fig-e',
      events: [{ event: 'E1', mode: 'serial', producers: ['a'], consumers: ['b'], note: 'n' }],
    }, 'English')
    expect(events).toEqual({ ok: true })
    expect(written1[0]!.path).toBe('index/.arch-lens-events-English.json')
    expect((JSON.parse(written1[0]!.content) as { data: unknown }).data).toEqual([
      { event: 'E1', mode: 'serial', producers: ['a'], consumers: ['b'], note: 'n' },
    ])

    const { fs: fs2, written: written2 } = fakeFs()
    const core = await writeFigureCache(fs2, '/ws', index(), 'core', {
      figId: 'fig-k',
      core: ['a', 'b', 'ghost'],
    }, 'English')
    expect(core).toEqual({ ok: true })
    expect(written2[0]!.path).toBe('index/.arch-lens-core-English.json')
    expect((JSON.parse(written2[0]!.content) as { data: unknown }).data).toEqual({ ids: ['a', 'b'], source: 'flow' })
  })

  it('returns an error when the answer carries no usable figure data', async () => {
    const { fs } = fakeFs()
    const bad = await writeFigureCache(fs, '/ws', index(), 'flow', { figId: 'fig-x', title: '无图' }, 'English', 'event')
    expect('error' in bad).toBe(true)
    const empty = await writeFigureCache(fs, '/ws', index(), 'concepts', { figId: 'fig-y' }, 'English')
    expect('error' in empty).toBe(true)
  })
})

/* ---------------------------------------------------------------------------
 * DYNAMIC figures (hover drill-down): target identity, prompt building,
 * diagram extraction and per-target cache writing.
 * ------------------------------------------------------------------------- */

/** Index with real call edges for the seq-edge drill-down facts. fromFile is
 * ABSOLUTE (the real indexer's form) — the attribution must use the package's
 * absolute path prefix, not a relative one (regression guard). */
function indexWithCalls(): CodeIndexResult {
  const idx = index()
  return {
    ...idx,
    calls: [
      { fromFile: '/ws/packages/a/src/index.ts', from: 'Svc.handle', to: 'indexWorkspace', line: 41 },
      { fromFile: '/ws/packages/a/src/index.ts', from: 'Svc.handle', to: 'buildTree', line: 42 },
      { fromFile: '/ws/packages/b/src/other.ts', from: 'Other.run', to: 'collectSources', line: 9 },
    ],
  }
}

describe('dynamic figure identity (hash + target key, client mirror contract)', () => {
  it('hashes stably and serializes targets deterministically', () => {
    expect(hashString('seq:a|b|调 b()')).toBe(hashString('seq:a|b|调 b()'))
    expect(hashString('')).toBe(hashString(''))
    expect(dynamicTargetKey('seq-edge', { from: 'a', to: 'b', label: '调 b()' })).toBe('seq:a|b|调 b()')
    expect(dynamicTargetKey('flow-subgraph', { stage: '入口' })).toBe('flow:入口')
    // The same target must always map to the same cache file.
    expect(dynamicFigureCacheName('seq-edge', dynamicTargetKey('seq-edge', { from: 'a', to: 'b', label: '调 b()' }), 'English'))
      .toBe(dynamicFigureCacheName('seq-edge', dynamicTargetKey('seq-edge', { from: 'a', to: 'b', label: '调 b()' }), 'English'))
  })

  it('derives the per-kind/per-language dynamic cache name', () => {
    const key = dynamicTargetKey('flow-subgraph', { stage: '入口' })
    expect(dynamicFigureCacheName('flow-subgraph', key, '中文')).toBe(`index/.arch-lens-dynamic-flow-subgraph-${hashString(key)}-default.json`)
    expect(dynamicFigureCacheName('flow-subgraph', key, 'English')).toBe(`index/.arch-lens-dynamic-flow-subgraph-${hashString(key)}-English.json`)
  })

  it('maps the overview target to its own kind key and cache file (read path must not coerce it to flow-subgraph)', () => {
    // The 架构概览「🤖 AI 生成」branch stages a DYNAMIC overview figure
    // (kind 'overview', targetKey 'overview:all'). The reader
    // (remoteDynamicFigure) must look up the SAME file the writer
    // (writeDynamicFigureCache) produced — coercing 'overview' to
    // 'flow-subgraph' would miss the cache and re-generate every time.
    expect(dynamicTargetKey('overview', { stage: '总览' })).toBe('overview:all')
    expect(dynamicFigureCacheName('overview', 'overview:all', '中文'))
      .toBe(`index/.arch-lens-dynamic-overview-${hashString('overview:all')}-default.json`)
    expect(dynamicFigureCacheName('overview', 'overview:all', 'English'))
      .toBe(`index/.arch-lens-dynamic-overview-${hashString('overview:all')}-English.json`)
  })
})

describe('buildDynamicFigurePrompt (edge / subgraph drill-down)', () => {
  it('embeds ONLY the call edges matching symbols in the hovered label for seq-edge', () => {
    // The label names `indexWorkspace` → only edges whose from/to IS that
    // symbol are embedded (not the whole package edge table).
    const prompt = buildDynamicFigurePrompt('seq-edge', indexWithCalls(), '中文', 'fig-d1', { from: 'a', to: 'b', label: '调用 indexWorkspace()' })
    expect(prompt).toContain('figId=fig-d1')
    expect(prompt).toContain('sequenceDiagram')
    expect(prompt).toContain('a → b（调用 indexWorkspace()）')
    expect(prompt).toContain('涉及包的类方法（供引用真实方法名）：')
    expect(prompt).toContain('- a（typescript）方法：Svc{handle}')
    expect(prompt).toContain('Svc.handle → indexWorkspace（src/index.ts:41）')
    // Not mentioned by the label → stays out (token discipline).
    expect(prompt).not.toContain('buildTree')
    expect(prompt).not.toContain('Other.run')
  })

  it('renders third-package caller paths workspace-relative, root stated once', () => {
    // The hovered pair is a↔b, but this edge's caller lives in a THIRD
    // package — its path must read workspace-relative (`packages/...`), never
    // the raw absolute path, and the absolute root appears exactly once.
    const idx = indexWithCalls()
    idx.calls!.push({ fromFile: '/ws/packages/backend/src/index.ts', from: 'remoteFlow', to: 'indexWorkspace', line: 814 })
    const prompt = buildDynamicFigurePrompt('seq-edge', idx, '中文', 'fig-d6', { from: 'a', to: 'b', label: '调用 indexWorkspace()' })
    expect(prompt).toContain('remoteFlow → indexWorkspace（packages/backend/src/index.ts:814）')
    expect(prompt).not.toContain('/ws/packages/backend')
    expect(prompt).toContain('工作区根：/ws')
  })

  it('falls back to the two packages’ own edges when the label has no symbols', () => {
    const prompt = buildDynamicFigurePrompt('seq-edge', indexWithCalls(), '中文', 'fig-d5', { from: 'a', to: 'b', label: '调 b()' })
    expect(prompt).toContain('Svc.handle → indexWorkspace（src/index.ts:41）')
    expect(prompt).toContain('Other.run → collectSources（src/other.ts:9）')
    expect(prompt).not.toContain('无调用边记录')
  })

  it('embeds ONLY the hovered subgraph block plus stage list and touching edges for flow-subgraph', () => {
    const mermaid = 'flowchart TD\n  subgraph 入口\n    A --> B\n  end\n  subgraph 出口\n    C --> D\n  end\n  B --> C'
    const prompt = buildDynamicFigurePrompt('flow-subgraph', index(), '中文', 'fig-d2', { stage: '入口' }, mermaid)
    expect(prompt).toContain('figId=fig-d2')
    expect(prompt).toContain('flowchart')
    expect(prompt).toContain('「入口」')
    expect(prompt).toContain('subgraph 入口\n    A --> B\n  end')
    expect(prompt).not.toContain('subgraph 出口') // other stages' BODIES stay out
    // …but the stage list and the cross-stage handoff are included.
    expect(prompt).toContain('- 出口')
    expect(prompt).toContain('B --> C')
    expect(prompt).toContain('【推断】')
  })

  it('falls back to the whole source when the subgraph block cannot be isolated', () => {
    const mermaid = 'flowchart TD\n  A --> B'
    const prompt = buildDynamicFigurePrompt('flow-subgraph', index(), '中文', 'fig-d4', { stage: '入口' }, mermaid)
    expect(prompt).toContain(mermaid)
  })

  it('attributes edges when pkg.path uses Windows backslash separators (regression: native separators vs normalized fromFile)', () => {
    // Real Windows workspace: pkg.path is `D:\dev\...\packages\a` (backslashes)
    // while CallEdge.fromFile is normalized to `/`. The prefix must normalize.
    const win = indexWithCalls()
    win.packages = win.packages.map(pkg => ({ ...pkg, path: pkg.path.replace(/\//g, '\\') }))
    const prompt = buildDynamicFigurePrompt('seq-edge', win, '中文', 'fig-d3', { from: 'a', to: 'b', label: '调 b()' })
    expect(prompt).toContain('Svc.handle → indexWorkspace（src/index.ts:41）')
    expect(prompt).toContain('Other.run → collectSources（src/other.ts:9）')
    expect(prompt).not.toContain('无调用边记录')
  })
})

describe('extractDynamicDiagram (answer → {title, diagram})', () => {
  it('accepts a fenced diagram and strips the fence', () => {
    const value = extractDynamicDiagram({ figId: 'fig-x', title: '入口细节', diagram: '```mermaid\nsequenceDiagram\n  A->>B: x\n```' })
    expect(value).toEqual({ title: '入口细节', diagram: 'sequenceDiagram\n  A->>B: x' })
  })

  it('accepts a bare diagram and repairs edge labels', () => {
    const value = extractDynamicDiagram({ figId: 'fig-y', diagram: 'flowchart TD\n  E1 -->|触发(emit)| E2' })
    expect(value).not.toBeUndefined()
    expect(value!.diagram).toContain('-->|触发（emit）|')
  })

  it('rejects answers without a diagram', () => {
    expect(extractDynamicDiagram({ figId: 'fig-z', title: '无图' })).toBeUndefined()
    expect(extractDynamicDiagram({ figId: 'fig-z', diagram: '这是文字，不是图' })).toBeUndefined()
  })
})

describe('writeDynamicFigureCache (per-target persistence, versioned envelope)', () => {
  it('writes the sanitized diagram into a { v, deps, data } envelope at the hashed cache file', async () => {
    const { fs, written } = fakeFs()
    const key = dynamicTargetKey('seq-edge', { from: 'a', to: 'b', label: '调 b()' })
    const result = await writeDynamicFigureCache(fs, '/ws', 'seq-edge', key, {
      figId: 'fig-w',
      title: 'a→b 调用时序',
      diagram: '```mermaid\nsequenceDiagram\n  participant A as a\n  A->>B: indexWorkspace()\n```',
    }, 'English', 100, ['a', 'b'])
    expect(result).toEqual({ ok: true })
    expect(written).toHaveLength(1)
    expect(written[0]!.path).toBe(`index/.arch-lens-dynamic-seq-edge-${hashString(key)}-English.json`)
    const envelope = JSON.parse(written[0]!.content) as { v: number; deps: string[]; data: { title: string; diagram: string; source: string; kind: string; targetKey: string } }
    expect(envelope.v).toBe(100)
    expect(envelope.deps).toEqual(['a', 'b'])
    const value = envelope.data
    expect(value.title).toBe('a→b 调用时序')
    expect(value.diagram).toContain('A->>B: indexWorkspace()')
    expect(value.source).toBe('flow')
    expect(value.kind).toBe('seq-edge')
    expect(value.targetKey).toBe(key)
  })

  it('returns an error when the answer carries no usable diagram', async () => {
    const { fs } = fakeFs()
    const bad = await writeDynamicFigureCache(fs, '/ws', 'flow-subgraph', dynamicTargetKey('flow-subgraph', { stage: '入口' }), { figId: 'fig-v' }, 'English', 100, [])
    expect('error' in bad).toBe(true)
  })
})

describe('dynamicFigureWriteFacts (§6.2 下钻图 deps 规则)', () => {
  /** Workspace with a graph at facts version 100. */
  function ws(init: Record<string, string> = {}): FakeFs {
    return new FakeFs({
      '': null,
      index: null,
      'index/.arch-lens-graph.json': JSON.stringify({ root: '/ws', generatedAt: 100, graph: { nodes: [], edges: [] } }),
      ...init,
    })
  }

  it('seq-edge: the two endpoint packages serialized in the target key', async () => {
    const key = dynamicTargetKey('seq-edge', { from: 'a', to: 'c', label: '调 c()' })
    expect(await dynamicFigureWriteFacts(ws() as never, '/ws', { kind: 'seq-edge', targetKey: key }, 'English', undefined, index())).toEqual({ factsVersion: 100, deps: ['a', 'c'] })
  })

  it('flow-subgraph: the parent flow envelope deps; absent parent → all packages', async () => {
    const withParent = ws({ 'index/.arch-lens-flow-English-event.json': JSON.stringify({ v: 100, deps: ['b'], data: { title: 't', mermaid: 'flowchart TD\nA-->B' } }) })
    const stageKey = dynamicTargetKey('flow-subgraph', { stage: '入口' })
    expect(await dynamicFigureWriteFacts(withParent as never, '/ws', { kind: 'flow-subgraph', targetKey: stageKey }, 'English', 'event', index())).toEqual({ factsVersion: 100, deps: ['b'] })
    // 无视角 = event（与链默认视角一致）；父缓存缺失 → 保守取全部包。
    expect(await dynamicFigureWriteFacts(ws() as never, '/ws', { kind: 'flow-subgraph', targetKey: stageKey }, 'English', undefined, index())).toEqual({ factsVersion: 100, deps: ['a', 'b', 'c', 'd'] })
  })

  it('overview: all packages (whole-workspace view invalidates with any change)', async () => {
    expect(await dynamicFigureWriteFacts(ws() as never, '/ws', { kind: 'overview', targetKey: 'overview:all' }, 'English', undefined, index())).toEqual({ factsVersion: 100, deps: ['a', 'b', 'c', 'd'] })
  })
})

describe('figure syntax contract (L1)', () => {
  it('flow-producing prompts carry the quoted-subgraph syntax rule; seq-edge does not', () => {
    const flow = buildDynamicFigurePrompt('flow-subgraph', index(), '中文', 'fig-l1', { stage: '入口' }, 'flowchart TD\n  subgraph 入口\n    A --> B\n  end')
    expect(flow).toContain('subgraph id["标题"]')
    const overview = buildDynamicFigurePrompt('overview', index(), '中文', 'fig-l1o', { stage: '总览' })
    expect(overview).toContain('subgraph id["标题"]')
    const seq = buildDynamicFigurePrompt('seq-edge', indexWithCalls(), '中文', 'fig-l1s', { from: 'a', to: 'b', label: '调用 indexWorkspace()' })
    expect(seq).not.toContain('subgraph id["标题"]')
  })
})

describe('buildFigureRepairPrompt (L3 按报错修复重画)', () => {
  const broken = 'flowchart TD\n  subgraph 增量IO[⚡ 变动更新 · generateAll(incremental) 输入→输出（代码实证）]\n    A[x]\n  end'
  const parseError = 'Parse error on line 2:\n... 增量IO[⚡ 变动更新 · generateAll(incremental) 输...\nExpecting ... got \'PS\''

  it('feeds the renderer error and the broken source verbatim, grammar-only', () => {
    const prompt = buildFigureRepairPrompt('dynamic-2', 'fig-repair-1', broken, '职责流程', '概要文字', parseError)
    expect(prompt).toContain(parseError.trim())
    expect(prompt).toContain(broken)
    expect(prompt).toContain('只修复 mermaid 语法')
    expect(prompt).toContain('严禁改变节点、边、标签文字')
    // The syntax contract rides along so the model fixes toward the safe form.
    expect(prompt).toContain('subgraph id["标题"]')
  })

  it('keeps the custom-figure JSON contract with the FRESH nonce and echoes title/summary verbatim', () => {
    const prompt = buildFigureRepairPrompt('dynamic-2', 'fig-repair-1', broken, '带"引号"的标题', '概要', parseError)
    expect(prompt).toContain('figId=fig-repair-1')
    expect(prompt).toContain('"figId": "fig-repair-1"')
    // Quote-bearing titles are JSON-escaped into the echo contract.
    expect(prompt).toContain(JSON.stringify('带"引号"的标题'))
    expect(prompt).toContain('dynamic-2')
  })

  it('replays NO scan facts (grammar-only round: no index summary section)', () => {
    const prompt = buildFigureRepairPrompt('dynamic-2', 'fig-repair-1', broken, '标题', '概要', parseError)
    expect(prompt).not.toContain('代码摘要（扫描数据')
    expect(prompt).not.toContain('各包职责')
  })
})

describe('duty section token caps (24 lines × 60 chars — the review ledger pins)', () => {
  function wideIndex(n: number): CodeIndexResult {
    const packages: CodePackage[] = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      path: `/ws/packages/p${i}`,
      language: 'typescript',
      deps: [],
      entities: [],
      imports: [],
      entryFiles: [],
    }))
    return { root: '/ws', language: 'typescript', packages }
  }

  it('caps the overview duty section at 24 package lines regardless of workspace size', () => {
    const blurbs: Record<string, string> = {}
    for (let i = 0; i < 30; i++) blurbs[`p${i}`] = `职责${i}`
    const prompt = buildDynamicFigurePrompt('overview', wideIndex(30), '中文', 'fig-caps-1', { stage: '总览' }, undefined, blurbs)
    const dutyLines = prompt.split('\n').filter(line => /^- p\d+：/.test(line))
    expect(dutyLines).toHaveLength(24)
    expect(prompt).toContain('- p23：职责23')
    expect(prompt).not.toContain('- p29：')
  })

  it('truncates every custom-branch duty line at 60 chars (AI duties included)', () => {
    const prompt = buildCustomFigurePrompt(wideIndex(1), '测试请求', '中文', 'fig-caps-2', { p0: '长'.repeat(100) })
    expect(prompt).toContain(`- p0：${'长'.repeat(60)}`)
    expect(prompt).not.toContain('长'.repeat(61))
  })
})
