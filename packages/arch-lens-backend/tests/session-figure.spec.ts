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
  buildDynamicFigurePrompt,
  buildFigurePrompt,
  dynamicFigureCacheName,
  dynamicTargetKey,
  extractDynamicDiagram,
  extractFigureJson,
  figureCacheName,
  hashString,
  writeDynamicFigureCache,
  writeFigureCache,
} from '../src/session-figure.ts'

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

/** Recording fs: resolve/writeText capture every cache target + content. */
function fakeFs(): { fs: FileSystem; written: Array<{ path: string; content: string }> } {
  const written: Array<{ path: string; content: string }> = []
  const fs = {
    resolve: async (path: string) => ({ displayPath: path }) as never,
    stat: async () => undefined,
    readText: async () => { throw new Error('no file') },
    writeText: async (target: { displayPath: string }, content: string) => {
      written.push({ path: target.displayPath, content })
      return {} as never
    },
    listDir: async () => [],
  } as unknown as FileSystem
  return { fs, written }
}

describe('figureCacheName (must mirror the chains’ cache readers)', () => {
  it('sanitizes the language and appends the method-level suffix', () => {
    expect(figureCacheName('concepts', '中文')).toBe('.arch-lens-concept-default.json')
    expect(figureCacheName('concepts', 'English')).toBe('.arch-lens-concept-English.json')
    expect(figureCacheName('seq', 'English', undefined, true)).toBe('.arch-lens-sequence-English-methods.json')
    expect(figureCacheName('interaction', '中文')).toBe('.arch-lens-events-default.json')
    expect(figureCacheName('core', 'English')).toBe('.arch-lens-core-English.json')
  })

  it('bakes the flow angle into the flow cache name', () => {
    expect(figureCacheName('flow', 'English', 'event')).toBe('.arch-lens-flow-English-event.json')
    expect(figureCacheName('flow', 'English', 'pipeline', true)).toBe('.arch-lens-flow-English-pipeline-methods.json')
    expect(figureCacheName('flow', '中文')).toBe('.arch-lens-flow-default.json')
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
    expect(written[0]!.path).toBe('.arch-lens-flow-English-event.json')
    const value = JSON.parse(written[0]!.content) as { title: string; source: string; angle: string; mermaid: string }
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
    expect(written[0]!.path).toBe('.arch-lens-concept-default.json')
    const value = JSON.parse(written[0]!.content) as Array<{ name: string; source: string; children: unknown[] }>
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
    expect(written[0]!.path).toBe('.arch-lens-sequence-English.json')
    const value = JSON.parse(written[0]!.content) as { source: string; messages: Array<{ from: string; to: string }> }
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
    expect(written1[0]!.path).toBe('.arch-lens-events-English.json')
    expect(JSON.parse(written1[0]!.content)).toEqual([
      { event: 'E1', mode: 'serial', producers: ['a'], consumers: ['b'], note: 'n' },
    ])

    const { fs: fs2, written: written2 } = fakeFs()
    const core = await writeFigureCache(fs2, '/ws', index(), 'core', {
      figId: 'fig-k',
      core: ['a', 'b', 'ghost'],
    }, 'English')
    expect(core).toEqual({ ok: true })
    expect(written2[0]!.path).toBe('.arch-lens-core-English.json')
    expect(JSON.parse(written2[0]!.content)).toEqual({ ids: ['a', 'b'], source: 'flow' })
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

/** Index with real call edges for the seq-edge drill-down facts. */
function indexWithCalls(): CodeIndexResult {
  const idx = index()
  return {
    ...idx,
    calls: [
      { fromFile: 'packages/a/src/index.ts', from: 'Svc.handle', to: 'indexWorkspace', line: 41 },
      { fromFile: 'packages/a/src/index.ts', from: 'Svc.handle', to: 'buildTree', line: 42 },
      { fromFile: 'packages/b/src/other.ts', from: 'Other.run', to: 'collectSources', line: 9 },
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
    expect(dynamicFigureCacheName('flow-subgraph', key, '中文')).toBe(`.arch-lens-dynamic-flow-subgraph-${hashString(key)}-default.json`)
    expect(dynamicFigureCacheName('flow-subgraph', key, 'English')).toBe(`.arch-lens-dynamic-flow-subgraph-${hashString(key)}-English.json`)
  })
})

describe('buildDynamicFigurePrompt (edge / subgraph drill-down)', () => {
  it('embeds the edge packages, method-level summary and real call edges for seq-edge', () => {
    const prompt = buildDynamicFigurePrompt('seq-edge', indexWithCalls(), '中文', 'fig-d1', { from: 'a', to: 'b', label: '调 b()' })
    expect(prompt).toContain('figId=fig-d1')
    expect(prompt).toContain('sequenceDiagram')
    expect(prompt).toContain('a → b（调 b()）')
    expect(prompt).toContain('Svc{handle}') // method-level summary
    expect(prompt).toContain('Svc.handle → indexWorkspace（packages/a/src/index.ts:41）')
    expect(prompt).toContain('Svc.handle → buildTree（packages/a/src/index.ts:42）')
    // Both hovered packages' own call edges are included (the fact base);
    // the drill-down targets the a→b message, so a's edges dominate.
    expect(prompt).toContain('Other.run → collectSources（packages/b/src/other.ts:9）')
  })

  it('embeds the flow source and stage mission for flow-subgraph', () => {
    const mermaid = 'flowchart TD\n  subgraph 入口\n    A --> B\n  end'
    const prompt = buildDynamicFigurePrompt('flow-subgraph', index(), '中文', 'fig-d2', { stage: '入口' }, mermaid)
    expect(prompt).toContain('figId=fig-d2')
    expect(prompt).toContain('flowchart')
    expect(prompt).toContain('「入口」')
    expect(prompt).toContain(mermaid)
    expect(prompt).toContain('【推断】')
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

describe('writeDynamicFigureCache (per-target persistence)', () => {
  it('writes the sanitized diagram to the hashed cache file', async () => {
    const { fs, written } = fakeFs()
    const key = dynamicTargetKey('seq-edge', { from: 'a', to: 'b', label: '调 b()' })
    const result = await writeDynamicFigureCache(fs, '/ws', 'seq-edge', key, {
      figId: 'fig-w',
      title: 'a→b 调用时序',
      diagram: '```mermaid\nsequenceDiagram\n  participant A as a\n  A->>B: indexWorkspace()\n```',
    }, 'English')
    expect(result).toEqual({ ok: true })
    expect(written).toHaveLength(1)
    expect(written[0]!.path).toBe(`.arch-lens-dynamic-seq-edge-${hashString(key)}-English.json`)
    const value = JSON.parse(written[0]!.content) as { title: string; diagram: string; source: string; kind: string; targetKey: string }
    expect(value.title).toBe('a→b 调用时序')
    expect(value.diagram).toContain('A->>B: indexWorkspace()')
    expect(value.source).toBe('flow')
    expect(value.kind).toBe('seq-edge')
    expect(value.targetKey).toBe(key)
  })

  it('returns an error when the answer carries no usable diagram', async () => {
    const { fs } = fakeFs()
    const bad = await writeDynamicFigureCache(fs, '/ws', 'flow-subgraph', dynamicTargetKey('flow-subgraph', { stage: '入口' }), { figId: 'fig-v' }, 'English')
    expect('error' in bad).toBe(true)
  })
})
