/**
 * Comprehension-spine phase 3 (explain versioning): the per-chapter explain
 * envelope round-trips with facts-version freshness, dies under the same
 * spine cascade as a chapter (`requires`), and `chapterExplainDeps` derives
 * the explain's package deps from the chapter's figure caches.
 */
import { describe, it, expect } from 'vitest'
import { FakeFs, fsTarget } from './fake-fs.ts'
import { readRawCache } from '../src/fact-cache.ts'
import { explainCacheName, readExplainCache, writeExplainCache } from '../src/explain-cache.ts'
import { chapterExplainDeps } from '../src/docchapter.ts'
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

const payload = { markdown: '## 时序正文\n\n`gateway` 调 `auth-core`。', target: '时序', question: '请讲解', at: 123 }

describe('explain envelope (phase 3)', () => {
  it('round-trips a fresh explain; stale/missing read as null', async () => {
    const fs = ws()
    await writeExplainCache(fs as never, ROOT, 'seq', '中文', payload, VERSION, ['gateway', 'auth-core'], ['seq'])
    const fresh = await readExplainCache(fs as never, ROOT, 'seq', '中文', VERSION)
    expect(fresh?.markdown).toContain('`gateway` 调 `auth-core`')
    expect(fresh?.target).toBe('时序')
    // Stale (older facts version) is not fresh — the gradient falls back.
    expect(await readExplainCache(fs as never, ROOT, 'seq', '中文', VERSION + 1)).toBeNull()
    // Other kinds/languages untouched.
    expect(await readExplainCache(fs as never, ROOT, 'seq', 'English', VERSION)).toBeNull()
    expect(await readExplainCache(fs as never, ROOT, 'deps', '中文', VERSION)).toBeNull()
  })

  it('unknown facts version (0) never reads fresh', async () => {
    const fs = ws()
    await writeExplainCache(fs as never, ROOT, 'seq', '中文', payload, VERSION, undefined, ['seq'])
    expect(await readExplainCache(fs as never, ROOT, 'seq', '中文', 0)).toBeNull()
  })

  it('empty markdown is not a usable explain', async () => {
    const fs = ws()
    await writeExplainCache(fs as never, ROOT, 'seq', '中文', { ...payload, markdown: '   ' }, VERSION, undefined, ['seq'])
    expect(await readExplainCache(fs as never, ROOT, 'seq', '中文', VERSION)).toBeNull()
  })

  it('an in-place figure regeneration cascades and tombstones the explain', async () => {
    const fs = ws()
    await writeExplainCache(fs as never, ROOT, 'flow', '中文', payload, VERSION, ['gateway'], ['flow-event', 'flow-pipeline', 'seq'])
    await writeExplainCache(fs as never, ROOT, 'concepts', '中文', payload, VERSION, undefined, ['concepts'])
    await writeFigure(fs as never, ROOT, 'seq', '中文', VERSION, { source: 'flow', messages: [{ from: 'gateway', to: 'auth-core', label: '校验' }] }, { index })
    // flow's explain consumed the golden path ⇒ tombstoned; concepts untouched.
    const raw = await readRawCache(fs as never, fsTarget(explainCacheName('flow', '中文')))
    expect(raw?.v).toBe(0)
    expect((await readRawCache(fs as never, fsTarget(explainCacheName('concepts', '中文'))))?.v).toBe(VERSION)
    expect(await readExplainCache(fs as never, ROOT, 'flow', '中文', VERSION)).toBeNull()
  })
})

describe('chapterExplainDeps (explain deps = the chapter figure deps)', () => {
  it('seq/flow/interaction derive from their figure caches, er/catalog explain code facts (undefined)', async () => {
    const fs = ws()
    fs.setFile('index/.arch-lens-sequence-default.json', JSON.stringify({ v: VERSION, deps: [], data: { source: 'flow', messages: [{ from: 'gateway', to: 'auth-core', label: 'x' }] } }))
    fs.setFile('index/.arch-lens-flow-default-event.json', JSON.stringify({ v: VERSION, deps: [], data: { title: 't', source: 'flow', mermaid: 'flowchart TD' } }))
    fs.setFile('index/.arch-lens-flow-default-pipeline.json', JSON.stringify({ v: VERSION, deps: [], data: { title: 'p', source: 'flow', mermaid: 'flowchart TD' } }))
    fs.setFile('index/.arch-lens-events-default.json', JSON.stringify({ v: VERSION, deps: [], data: [{ event: 'e', mode: 'emit', producers: ['gateway'], consumers: ['auth-core'], note: '' }] }))
    expect(await chapterExplainDeps(fs as never, ROOT, 'seq', '中文')).toEqual(['gateway', 'auth-core'])
    expect(await chapterExplainDeps(fs as never, ROOT, 'interaction', '中文')).toEqual(['gateway', 'auth-core'])
    expect(await chapterExplainDeps(fs as never, ROOT, 'er', '中文')).toBeUndefined()
    expect(await chapterExplainDeps(fs as never, ROOT, 'catalog', '中文')).toBeUndefined()
  })

  it('deps derives from the core selection; flow unions both angles; missing figures degrade to undefined', async () => {
    const fs = ws()
    fs.setFile('index/.arch-lens-core-default.json', JSON.stringify({ v: VERSION, deps: [], data: { ids: ['gateway'], source: 'flow' } }))
    expect(await chapterExplainDeps(fs as never, ROOT, 'deps', '中文')).toEqual(['gateway'])
    // No flow figures at all ⇒ no deps (conservative "every package" legacy).
    expect(await chapterExplainDeps(fs as never, ROOT, 'flow', '中文')).toBeUndefined()
    fs.setFile('index/.arch-lens-flow-default-event.json', JSON.stringify({ v: VERSION, deps: [], data: { title: 't', source: 'flow', mermaid: 'flowchart TD' } }))
    fs.setFile('index/.arch-lens-flow-default-pipeline.json', JSON.stringify({ v: VERSION, deps: [], data: { title: 'p', source: 'doc', mermaid: 'flowchart TD' } }))
    // event(source=flow) → all-packages fallback (undefined); pipeline(source=doc) → []
    const deps = await chapterExplainDeps(fs as never, ROOT, 'flow', '中文')
    expect(deps).toBeUndefined()
  })
})
