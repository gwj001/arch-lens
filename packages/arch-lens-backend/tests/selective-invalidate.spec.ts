/**
 * Unit tests for selective invalidation (selectiveInvalidate): a rescan with
 * changes must invalidate ONLY the figure caches whose deps intersect the
 * changed packages, re-stamp the unaffected ones to the new facts version,
 * never touch the skip-set files, and treat a legacy cache (no deps field) as
 * depending on every package while an explicit empty deps (doc-sourced) is
 * never invalidated.
 */
import { describe, it, expect } from 'vitest'
import { selectiveInvalidate, readRawCache } from '../src/fact-cache.ts'
import { FakeFs } from './fake-fs.ts'

const ROOT = '/ws'

/** Workspace with a graph + a set of versioned figure caches (v=100). */
function wsWithCaches(): FakeFs {
  const fs = new FakeFs({
    '': null,
    'index': null,
    'index/.arch-lens-graph.json': JSON.stringify({ root: '/ws', generatedAt: 100, graph: { nodes: [], edges: [] } }),
    // concept: depends on a+b → invalidated by a.
    'index/.arch-lens-concept-default.json': JSON.stringify({ v: 100, deps: ['a', 'b'], data: [{ name: 'x' }] }),
    // flow: depends only on b → re-stamped, kept.
    'index/.arch-lens-flow-default-event.json': JSON.stringify({ v: 100, deps: ['b'], data: { title: 't', mermaid: 'flowchart TD\nA-->B' } }),
    // legacy cache (written before deps existed) → depends on everything.
    'index/.arch-lens-sequence-default.json': JSON.stringify({ v: 100, data: { source: 'flow', messages: [] } }),
    // doc-sourced flow with EXPLICIT empty deps → never invalidated.
    'index/.arch-lens-flow-default-pipeline.json': JSON.stringify({ v: 100, deps: [], data: { title: 'doc', source: 'doc' } }),
    // skip-set files must be untouched.
    'index/.arch-lens-llm-stats.json': JSON.stringify({ v: 100, data: { calls: 1 } }),
  })
  return fs
}

describe('selectiveInvalidate', () => {
  it('invalidates deps-hit caches, re-stamps the rest, skips skip-set files', async () => {
    const fs = wsWithCaches()
    await selectiveInvalidate(fs as never, ROOT, new Set(['a']), 200)

    const concept = await readRawCache(fs as never, { displayPath: 'index/.arch-lens-concept-default.json' })
    expect(concept).toEqual({ v: 0, deps: [], depsPresent: false, data: undefined })

    const flow = await readRawCache(fs as never, { displayPath: 'index/.arch-lens-flow-default-event.json' })
    expect(flow).toEqual({ v: 200, deps: ['b'], depsPresent: true, data: { title: 't', mermaid: 'flowchart TD\nA-->B' } })

    const legacy = await readRawCache(fs as never, { displayPath: 'index/.arch-lens-sequence-default.json' })
    expect(legacy).toEqual({ v: 0, deps: [], depsPresent: false, data: undefined })

    const doc = await readRawCache(fs as never, { displayPath: 'index/.arch-lens-flow-default-pipeline.json' })
    expect(doc).toEqual({ v: 200, deps: [], depsPresent: true, data: { title: 'doc', source: 'doc' } })

    // Skip-set file untouched: still v=100 with its data.
    const stats = await readRawCache(fs as never, { displayPath: 'index/.arch-lens-llm-stats.json' })
    expect(stats).toEqual({ v: 100, deps: [], depsPresent: false, data: { calls: 1 } })
  })

  it('an unrelated change set re-stamps every deps-bearing cache', async () => {
    const fs = wsWithCaches()
    await selectiveInvalidate(fs as never, ROOT, new Set(['zzz']), 300)
    const flow = await readRawCache(fs as never, { displayPath: 'index/.arch-lens-flow-default-event.json' })
    expect(flow?.v).toBe(300)
    expect(flow?.deps).toEqual(['b'])
    // Legacy still invalidated (depends on everything, zzz is unknown to it).
    const legacy = await readRawCache(fs as never, { displayPath: 'index/.arch-lens-sequence-default.json' })
    expect(legacy?.v).toBe(0)
  })

  it('non-versioned files (dynamic figures) are left untouched', async () => {
    const fs = wsWithCaches()
    fs.setFile('index/.arch-lens-dynamic-seq-edge-h1-default.json', JSON.stringify({ title: 'd', diagram: 'flowchart TD\nA-->B', source: 'flow' }))
    await selectiveInvalidate(fs as never, ROOT, new Set(['a']), 200)
    const content = await fs.readText({ displayPath: 'index/.arch-lens-dynamic-seq-edge-h1-default.json' })
    expect(JSON.parse(content)).toEqual({ title: 'd', diagram: 'flowchart TD\nA-->B', source: 'flow' })
  })
})
