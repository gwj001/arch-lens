import { describe, it, expect, beforeEach } from 'vitest'
import { FakeFs, fsTarget } from './fake-fs.ts'
import { readFactVersion, readVersionedCache, writeVersionedCache } from '../src/fact-cache.ts'

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
