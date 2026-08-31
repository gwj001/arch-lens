import { describe, it, expect, beforeEach } from 'vitest'
import { FakeFs, fsTarget } from './fake-fs.ts'
import { readFactVersion, readVersionedCache, writeVersionedCache, sweepLegacyCaches } from '../src/fact-cache.ts'

describe('fact-cache (versioned AI caches)', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs({
      '': null,
      'index': null,
      'packages': null,
      'packages/a': null,
      'packages/a/src/index.ts': 'export const a = 1',
    })
  })

  async function makeGraph(generatedAt: number): Promise<void> {
    await fs.writeText(fsTarget('index/.arch-lens-graph.json'), JSON.stringify({ root: '/ws', generatedAt, graph: { nodes: [], edges: [] } }))
  }

  it('readFactVersion: 0 when the graph is missing or unreadable', async () => {
    expect(await readFactVersion(fs as never, '/ws')).toBe(0)
  })

  it('readFactVersion: returns generatedAt when present', async () => {
    await makeGraph(12345)
    expect(await readFactVersion(fs as never, '/ws')).toBe(12345)
  })

  it('versioned cache: same version round-trips; mismatch returns null', async () => {
    await makeGraph(100)
    const target = fsTarget('index/.arch-lens-concept-default.json')
    await writeVersionedCache(fs as never, target, [{ name: 'x' }], 100)
    expect(await readVersionedCache<unknown[]>(fs as never, target, 100)).toEqual([{ name: 'x' }])
    // Facts moved on: the old cache must be refused.
    await makeGraph(200)
    expect(await readVersionedCache<unknown[]>(fs as never, target, 200)).toBeNull()
  })

  it('versioned cache: legacy unversioned files are refused (regenerate)', async () => {
    await makeGraph(100)
    const target = fsTarget('index/.arch-lens-concept-default.json')
    await fs.writeText(target, JSON.stringify([{ name: 'legacy' }]))
    expect(await readVersionedCache<unknown[]>(fs as never, target, 100)).toBeNull()
  })

  it('version 0 disables both read and write (never serves or persists)', async () => {
    const target = fsTarget('index/.arch-lens-concept-default.json')
    await writeVersionedCache(fs as never, target, [{ name: 'x' }], 0)
    expect(fs.files.has('index/.arch-lens-concept-default.json')).toBe(false)
    expect(await readVersionedCache<unknown[]>(fs as never, target, 0)).toBeNull()
  })
})

describe('sweepLegacyCaches (tombstone cleanup at the rescan tail)', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs({ '': null, 'index': null })
  })

  const file = (name: string, content: string): void => {
    fs.setFile(`index/${name}`, content)
  }

  it('removes unversioned figure leftovers the current readers can never serve', async () => {
    // Pre-versioning era orphan (angle-less flow name) + a corrupt envelope.
    file('.arch-lens-flow-default.json', JSON.stringify({ title: 'legacy' }))
    file('.arch-lens-dynamic-seq-edge-abc123-default.json', 'not json at all')
    const removed = await sweepLegacyCaches(fs as never, '/ws', async target => { fs.remove(target.displayPath) })
    expect(removed.sort()).toEqual(['.arch-lens-dynamic-seq-edge-abc123-default.json', '.arch-lens-flow-default.json'])
    expect(fs.files.has('index/.arch-lens-flow-default.json')).toBe(false)
    expect(fs.files.has('index/.arch-lens-dynamic-seq-edge-abc123-default.json')).toBe(false)
  })

  it('keeps versioned caches AND managed `{v:0}` invalidation graves', async () => {
    file('.arch-lens-concept-default.json', JSON.stringify({ v: 100, deps: ['a'], data: {} }))
    file('.arch-lens-sequence-default.json', JSON.stringify({ v: 0 }))
    const removed = await sweepLegacyCaches(fs as never, '/ws', async target => { fs.remove(target.displayPath) })
    expect(removed).toEqual([])
    expect(fs.files.has('index/.arch-lens-concept-default.json')).toBe(true)
    expect(fs.files.has('index/.arch-lens-sequence-default.json')).toBe(true)
  })

  it('never touches user assets, plain-JSON system files, or foreign files', async () => {
    file('.arch-lens-draw-dynamic-1-default.json', JSON.stringify({ figureId: 'dynamic-1' }))
    file('.arch-lens-progress-default.json', JSON.stringify({ summary: 'x' }))
    file('.arch-lens-progress-English.json', JSON.stringify({ summary: 'y' }))
    file('.arch-lens-graph.json', JSON.stringify({ root: '/ws', generatedAt: 1, graph: {} }))
    file('.arch-lens-llm-stats.json', JSON.stringify({ totalCalls: 0 }))
    file('other-tool.json', 'plain')
    const removed = await sweepLegacyCaches(fs as never, '/ws', async target => { fs.remove(target.displayPath) })
    expect(removed).toEqual([])
    expect(fs.files.size).toBe(8) // '' + 'index' dirs + 6 files, all intact
  })

  it('a failing removal is skipped without aborting the sweep', async () => {
    file('.arch-lens-flow-default.json', '{}')
    file('.arch-lens-core-default.json', '{}')
    const removed = await sweepLegacyCaches(fs as never, '/ws', async target => {
      if (target.displayPath.includes('core')) throw new Error('locked')
      fs.remove(target.displayPath)
    })
    expect(removed).toEqual(['.arch-lens-flow-default.json'])
    expect(fs.files.has('index/.arch-lens-core-default.json')).toBe(true)
  })
})
