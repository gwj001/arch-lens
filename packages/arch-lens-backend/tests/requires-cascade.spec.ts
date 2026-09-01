/**
 * Comprehension-spine phase 2 (spine `requires` accounting + cascade):
 *  - envelopes record `requires` (the cache kinds whose CONTENT they consumed)
 *    with backward-compatible reads (legacy ⇒ []);
 *  - invalidateRequiring tombstones exactly the caches requiring a node;
 *  - writeFigure cascades: an in-place figure write (no facts-version change)
 *    invalidates dependent chapter envelopes, while method-level writes don't.
 */
import { describe, it, expect } from 'vitest'
import { FakeFs, fsTarget } from './fake-fs.ts'
import { invalidateRequiring, readRawCache, writeVersionedCache } from '../src/fact-cache.ts'
import { writeFigure } from '../src/figures.ts'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'

const ROOT = '/ws'
const VERSION = 100

const index: CodeIndexResult = {
  root: ROOT,
  language: 'typescript',
  packages: [
    { id: 'gateway', path: `${ROOT}/packages/gateway`, language: 'typescript', deps: [], entities: [], imports: [], entryFiles: ['src/index.ts'] },
    { id: 'auth-core', path: `${ROOT}/packages/auth-core`, language: 'typescript', deps: [], entities: [], imports: [], entryFiles: ['src/token.ts'] },
  ],
}

function ws(): FakeFs {
  return new FakeFs({
    '': null,
    'index': null,
    'index/.arch-lens-graph.json': JSON.stringify({ root: ROOT, generatedAt: VERSION, graph: { nodes: [], edges: [] } }),
  })
}

describe('requires envelope accounting', () => {
  it('writeVersionedCache records requires; readRawCache round-trips it', async () => {
    const fs = ws()
    await writeVersionedCache(fs as never, fsTarget('index/.arch-lens-docchapter-seq-default.json'), { markdown: '## x' }, VERSION, undefined, ['gateway'], ['seq'])
    const raw = await readRawCache(fs as never, fsTarget('index/.arch-lens-docchapter-seq-default.json'))
    expect(raw?.requires).toEqual(['seq'])
    expect(raw?.deps).toEqual(['gateway'])
  })

  it('legacy envelopes (no requires field) read as [] — backward compatible', async () => {
    const fs = ws()
    fs.setFile('index/.arch-lens-core-default.json', JSON.stringify({ v: VERSION, deps: ['gateway'], data: { ids: ['gateway'] } }))
    const raw = await readRawCache(fs as never, fsTarget('index/.arch-lens-core-default.json'))
    expect(raw?.requires).toEqual([])
  })

  it('duplicate requires are de-duplicated at write', async () => {
    const fs = ws()
    await writeVersionedCache(fs as never, fsTarget('index/.arch-lens-docchapter-flow-default.json'), { markdown: '## x' }, VERSION, undefined, undefined, ['flow-event', 'flow-event', 'flow-pipeline'])
    const raw = await readRawCache(fs as never, fsTarget('index/.arch-lens-docchapter-flow-default.json'))
    expect(raw?.requires).toEqual(['flow-event', 'flow-pipeline'])
  })
})

describe('invalidateRequiring (spine cascade)', () => {
  it('tombstones exactly the caches requiring the node, leaves the rest', async () => {
    const fs = ws()
    // Chapter envelopes: one requires seq, one requires core, one requires both flow angles.
    fs.setFile('index/.arch-lens-docchapter-seq-default.json', JSON.stringify({ v: VERSION, deps: ['gateway'], requires: ['seq'], data: { markdown: '## 时序' } }))
    fs.setFile('index/.arch-lens-docchapter-deps-default.json', JSON.stringify({ v: VERSION, deps: ['gateway'], requires: ['core'], data: { markdown: '## 依赖' } }))
    fs.setFile('index/.arch-lens-docchapter-flow-default.json', JSON.stringify({ v: VERSION, deps: ['gateway'], requires: ['flow-event', 'flow-pipeline'], data: { markdown: '## 流程' } }))
    // A figure cache without requires is never touched by the cascade.
    fs.setFile('index/.arch-lens-sequence-default.json', JSON.stringify({ v: VERSION, deps: ['gateway'], data: { source: 'flow', messages: [] } }))

    const moved = await invalidateRequiring(fs as never, ROOT, 'seq')
    expect(moved).toEqual(['.arch-lens-docchapter-seq-default.json'])
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-docchapter-seq-default.json')))?.v).toBe(0)
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-docchapter-deps-default.json')))?.v).toBe(VERSION)
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-docchapter-flow-default.json')))?.v).toBe(VERSION)
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-sequence-default.json')))?.v).toBe(VERSION)
  })

  it('never touches skip-set files, draw assets or existing tombstones', async () => {
    const fs = ws()
    fs.setFile('index/.arch-lens-llm-stats.json', JSON.stringify({ v: VERSION, requires: ['seq'], data: { calls: 1 } }))
    fs.setFile('index/.arch-lens-draw-fig1-English.json', JSON.stringify({ v: VERSION, requires: ['seq'], data: { title: 'mine' } }))
    fs.setFile('index/.arch-lens-docchapter-seq-default.json', JSON.stringify({ v: 0 }))
    const moved = await invalidateRequiring(fs as never, ROOT, 'seq')
    expect(moved).toEqual([])
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-llm-stats.json')))?.v).toBe(VERSION)
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-draw-fig1-English.json')))?.v).toBe(VERSION)
  })
})

describe('writeFigure cascade (figure regenerated in place ⇒ dependent chapters stale)', () => {
  it('writing an entity figure tombstones chapter envelopes requiring it', async () => {
    const fs = ws()
    fs.setFile('index/.arch-lens-docchapter-seq-default.json', JSON.stringify({ v: VERSION, deps: ['gateway'], requires: ['seq'], data: { markdown: '## 时序（旧图时代的正文）' } }))
    fs.setFile('index/.arch-lens-docchapter-deps-default.json', JSON.stringify({ v: VERSION, deps: ['gateway'], requires: ['core'], data: { markdown: '## 依赖' } }))

    await writeFigure(fs as never, ROOT, 'seq', '中文', VERSION, { source: 'flow', messages: [{ from: 'gateway', to: 'auth-core', label: '校验' }] }, { index })

    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-docchapter-seq-default.json')))?.v).toBe(0)
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-docchapter-deps-default.json')))?.v).toBe(VERSION)
    // The figure itself landed fresh against the current facts version.
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-sequence-default.json')))?.v).toBe(VERSION)
  })

  it('method-level figure writes do NOT cascade entity chapters', async () => {
    const fs = ws()
    fs.setFile('index/.arch-lens-docchapter-seq-default.json', JSON.stringify({ v: VERSION, deps: ['gateway'], requires: ['seq'], data: { markdown: '## 时序' } }))
    await writeFigure(fs as never, ROOT, 'seq', '中文', VERSION, { source: 'flow', messages: [] }, { index, methods: true })
    expect((await readRawCache(fs as never, fsTarget('index/.arch-lens-docchapter-seq-default.json')))?.v).toBe(VERSION)
  })
})
