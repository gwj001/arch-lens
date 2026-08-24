import { describe, it, expect, beforeEach, vi } from 'vitest'
// Chain modules import @deepseek-ai/dsh-llm at the top level; the tests only
// exercise the READ functions, so a stub keeps the import graph resolvable.
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))
import { FakeFs } from './fake-fs.ts'
import { readFactVersion, writeVersionedCache } from '../src/fact-cache.ts'
import { readConceptTree } from '../src/concept.ts'
import { readFlow } from '../src/flow.ts'
import { readSequence } from '../src/sequence.ts'
import { readCore } from '../src/core.ts'
import { readDutySummaries } from '../src/summarize.ts'

/**
 * 读/写分离核心语义（用户拍板）：
 * 读请求（打开面板 / 切 tab / rescan 后重拉）= 纯缓存，零 LLM、零写盘、
 * 零扫盘、零 doc 提取；事实只能由写请求（rescan / AI 生成）建立。
 * 这些测试证明每个 readXxx 只做缓存命中判定：v 匹配 → 返回缓存；
 * v 不匹配/缺失 → null；且绝不写任何文件。
 */
describe('read-only figure readers (cache-only, no generation, no writes)', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs({
      '': null,
      'index': null,
      'packages': null,
      'packages/a/src/index.ts': 'export const a = 1',
    })
  })

  async function makeGraph(generatedAt: number): Promise<void> {
    await fs.writeText({ displayPath: 'index/.arch-lens-graph.json' }, JSON.stringify({ root: '/ws', generatedAt, graph: { nodes: [], edges: [] } }))
  }

  /** Snapshot the file set so tests can assert the reader wrote nothing. */
  function fileSet(): Set<string> { return new Set(fs.files.keys()) }

  it('readConceptTree: cache hit returns the tree, mismatch/missing return null, never writes', async () => {
    await makeGraph(100)
    // No cache file yet.
    expect(await readConceptTree(fs as never, '/ws', '中文')).toBeNull()
    // Facts version matches → serve.
    await writeVersionedCache(fs as never, { displayPath: 'index/.arch-lens-concept-default.json' }, [{ id: 'a', name: 'A', desc: 'd' }], 100)
    const before = fileSet()
    const tree = await readConceptTree(fs as never, '/ws', '中文')
    expect(tree).toEqual([{ id: 'a', name: 'A', desc: 'd' }])
    // Facts moved on (rescan) → refuse the stale cache.
    await makeGraph(200)
    expect(await readConceptTree(fs as never, '/ws', '中文')).toBeNull()
    expect(fileSet()).toEqual(before)
  })

  it('readFlow: cache hit returns the diagram (sanitized), mismatch returns null, never writes', async () => {
    await makeGraph(100)
    await writeVersionedCache(fs as never, { displayPath: 'index/.arch-lens-flow-default-event.json' }, { mermaid: 'flowchart TD\n  a["raw \\"quote\\""]\n  a -->|触发(emit)| b', source: 'flow' as const, angle: 'event' as const }, 100)
    const before = fileSet()
    const flow = await readFlow(fs as never, '/ws', '中文', 'event')
    expect(flow).not.toBeNull()
    // Read side repairs LLM-broken edge labels (sanitize) but leaves the rest.
    expect(flow!.mermaid).toBe('flowchart TD\n  a["raw \\"quote\\""]\n  a -->|触发（emit）| b')
    await makeGraph(200)
    expect(await readFlow(fs as never, '/ws', '中文', 'event')).toBeNull()
    expect(fileSet()).toEqual(before)
  })

  it('readSequence: cache hit returns the figure, mismatch returns null, never writes', async () => {
    await makeGraph(100)
    await writeVersionedCache(fs as never, { displayPath: 'index/.arch-lens-sequence-default.json' }, { source: 'doc' as const, messages: [{ from: 'a', to: 'b', label: '调用' }], notes: [] }, 100)
    const before = fileSet()
    const seq = await readSequence(fs as never, '/ws', '中文')
    expect(seq).toEqual({ source: 'doc', messages: [{ from: 'a', to: 'b', label: '调用' }] })
    await makeGraph(200)
    expect(await readSequence(fs as never, '/ws', '中文')).toBeNull()
    expect(fileSet()).toEqual(before)
  })

  it('readCore: cache hit returns the selection, mismatch returns null, never writes (no rule fallback)', async () => {
    await makeGraph(100)
    await writeVersionedCache(fs as never, { displayPath: 'index/.arch-lens-core-default.json' }, { ids: ['a', 'b'], source: 'flow' as const }, 100)
    const before = fileSet()
    const core = await readCore(fs as never, '/ws', '中文')
    expect(core).toEqual({ ids: ['a', 'b'], source: 'flow' })
    // Facts moved on → null. D2: NO deterministic fallback on read — facts
    // appear only after a rescan plus the user's generate action.
    await makeGraph(200)
    expect(await readCore(fs as never, '/ws', '中文')).toBeNull()
    expect(fileSet()).toEqual(before)
  })

  it('readDutySummaries: cache hit returns the map, mismatch returns null, never writes', async () => {
    await makeGraph(100)
    await writeVersionedCache(fs as never, { displayPath: 'index/.arch-lens-summaries-default.json' }, { a: '包 A' }, 100)
    const before = fileSet()
    expect(await readDutySummaries(fs as never, '/ws', '中文')).toEqual({ a: '包 A' })
    await makeGraph(200)
    expect(await readDutySummaries(fs as never, '/ws', '中文')).toBeNull()
    expect(fileSet()).toEqual(before)
  })

  it('graph version 0 (no facts yet) disables every reader', async () => {
    // No graph file at all → factsVersion 0 → nothing is served.
    const targets = [
      'index/.arch-lens-concept-default.json',
      'index/.arch-lens-flow-default-event.json',
      'index/.arch-lens-sequence-default.json',
      'index/.arch-lens-core-default.json',
      'index/.arch-lens-summaries-default.json',
    ]
    for (const rel of targets) {
      await writeVersionedCache(fs as never, { displayPath: rel }, { anything: true }, 0)
    }
    expect(await readFactVersion(fs as never, '/ws')).toBe(0)
    expect(await readConceptTree(fs as never, '/ws', '中文')).toBeNull()
    expect(await readFlow(fs as never, '/ws', '中文', 'event')).toBeNull()
    expect(await readSequence(fs as never, '/ws', '中文')).toBeNull()
    expect(await readCore(fs as never, '/ws', '中文')).toBeNull()
    expect(await readDutySummaries(fs as never, '/ws', '中文')).toBeNull()
  })
})
