/**
 * Stage-2 unified write path (writeFigure / figureDeps):
 *  - every entity cache write lands in the registry's versioned envelope;
 *  - the new seq shape `{ source, messages }` and the legacy raw-array shape
 *    read back interchangeably through readSeqCache (disk files are NOT
 *    migrated);
 *  - the ONE deps rule table per figure kind;
 *  - D5 seq full chain: with a doc carrying a `## 时序` section, a forced
 *    rebuild serves the doc stage with ZERO LLM (an llm-less ctx would throw
 *    the moment any later stage were reached).
 */
import { describe, it, expect, vi } from 'vitest'
// Chain modules imported through figures.ts reach the external (uninstalled)
// harness LLM package at runtime; intercept it (same pattern as the other specs).
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))

import { writeFigure, figureDeps, FIGURE_SPECS } from '../src/figures.ts'
import type { FigureEnv } from '../src/figures.ts'
import { readSeqCache } from '../src/sequence.ts'
import { readStructuredCache } from '../src/docsgen.ts'
import { FakeFs } from './fake-fs.ts'

const VERSION = 100
const GRAPH = 'index/.arch-lens-graph.json'

function workspace(init: Record<string, string> = {}): FakeFs {
  return new FakeFs({
    '': null,
    index: null,
    [GRAPH]: JSON.stringify({ root: '/ws', generatedAt: VERSION, graph: { nodes: [], edges: [] } }),
    ...init,
  })
}

describe('figureDeps (the ONE dependency-package rule)', () => {
  const index = {
    root: '/ws',
    language: 'typescript' as const,
    packages: [
      { id: 'pkgA', path: '/ws/a', language: 'typescript' as const, deps: [], entities: [], imports: [], entryFiles: [] },
      { id: 'pkgB', path: '/ws/b', language: 'typescript' as const, deps: [], entities: [], imports: [], entryFiles: [] },
    ],
  }

  it('concepts depend on every package (absent index → legacy field-absent)', () => {
    expect(figureDeps('concepts', [], index)).toEqual(['pkgA', 'pkgB'])
    expect(figureDeps('concepts', [])).toBeUndefined()
  })

  it('flow: doc-sourced never invalidates, AI-induced depends on all', () => {
    expect(figureDeps('flow-event', { source: 'doc', mermaid: 'x' }, index)).toEqual([])
    expect(figureDeps('flow-pipeline', { source: 'flow', mermaid: 'x' }, index)).toEqual(['pkgA', 'pkgB'])
  })

  it('seq: distinct message endpoints (object AND legacy array shapes)', () => {
    expect(figureDeps('seq', { source: 'flow', messages: [{ from: 'pkgA', to: 'pkgB', label: 'x' }, { from: 'pkgB', to: 'pkgA', label: 'y' }] })).toEqual(['pkgA', 'pkgB'])
    expect(figureDeps('seq', [{ from: 'pkgA', to: 'ghost', label: 'x' }])).toEqual(['pkgA', 'ghost'])
    expect(figureDeps('seq', { source: 'flow', messages: [] }, index)).toEqual(['pkgA', 'pkgB'])
  })

  it('interaction: distinct producers/consumers, falling back to all', () => {
    expect(figureDeps('interaction', [{ producers: ['pkgA'], consumers: ['pkgB', 'pkgA'] }, { producers: [], consumers: ['pkgB'] }])).toEqual(['pkgA', 'pkgB'])
    expect(figureDeps('interaction', [], index)).toEqual(['pkgA', 'pkgB'])
  })

  it('core: the selected ids; duties: the summarized package ids', () => {
    expect(figureDeps('core', { ids: ['pkgB'], source: 'flow' })).toEqual(['pkgB'])
    expect(figureDeps('duties', { pkgA: '职责一', pkgB: '职责二' })).toEqual(['pkgA', 'pkgB'])
  })
})

describe('writeFigure (the ONE versioned write entry)', () => {
  it('seq round-trip: new object shape serves, legacy raw array normalizes', async () => {
    const fs = workspace()
    const messages = [{ from: 'pkgA', to: 'pkgB', label: '调用' }]
    await writeFigure(fs as never, '/ws', 'seq', '中文', VERSION, { source: 'flow', messages })
    expect(await readSeqCache(fs as never, '/ws', '中文')).toEqual({ source: 'flow', messages })
    // A cache written the OLD way (bare array under the same envelope) keeps
    // serving through the compatibility read — disk files are not migrated.
    fs.setFile('index/.arch-lens-sequence-default.json', JSON.stringify({ v: VERSION, deps: ['pkgA', 'pkgB'], data: messages }))
    expect(await readSeqCache(fs as never, '/ws', '中文')).toEqual({ source: 'flow', messages })
  })

  it('stamps deps from the registry rule and refuses an unknown version (v=0 → no file)', async () => {
    const fs = workspace()
    await writeFigure(fs as never, '/ws', 'core', '中文', VERSION, { ids: ['pkgA'], source: 'flow' })
    const envelope = JSON.parse(fs.files.get('index/.arch-lens-core-default.json')!.content!) as { v: number; deps?: string[] }
    expect(envelope.v).toBe(VERSION)
    expect(envelope.deps).toEqual(['pkgA'])
    await writeFigure(fs as never, '/ws', 'core', '中文', 0, { ids: ['pkgB'], source: 'flow' })
    expect(JSON.parse(fs.files.get('index/.arch-lens-core-default.json')!.content!).v).toBe(VERSION) // untouched
  })

  it('interaction array stays readable by readStructuredCache (write-side shape unchanged)', async () => {
    const fs = workspace()
    const events = [{ event: '刷新', mode: 'emit', producers: ['pkgA'], consumers: ['pkgB'], note: 'n' }]
    await writeFigure(fs as never, '/ws', 'interaction', '中文', VERSION, events)
    expect(await readStructuredCache(fs as never, '/ws', '中文', 'interaction')).toEqual(events)
  })
})

describe('D5 seq full chain (cache → doc → profile → LLM)', () => {
  it('a doc with a 时序 section answers a forced rebuild with ZERO LLM calls', async () => {
    const fs = workspace({
      'docs/architecture.zh.md': '# 架构\n\n## 时序\n\npkgA -> pkgB: 派发任务\npkgB -> pkgC: 汇报进度\npkgA -> pkgC: 交付结果\n\n## 附录\n无关\n',
    })
    const env: FigureEnv = {
      // ctx WITHOUT llm/agentDefaultModel: reaching any LLM stage throws —
      // passing this test PROVES the doc stage served first.
      ctx: { get: () => undefined } as never,
      fs: fs as never,
      root: '/ws',
      index: { root: '/ws', language: 'typescript', packages: [] } as never,
      graph: { root: '/ws', groups: [], nodes: [], edges: [] } as never,
      language: '中文',
    }
    const spec = FIGURE_SPECS.find(candidate => candidate.id === 'seq')!
    const built = await spec.build(env, true)
    expect(built).toMatchObject({ source: 'doc' })
    // The chain cached the doc figure under the unified envelope.
    const cached = await readSeqCache(fs as never, '/ws', '中文')
    expect(cached?.source).toBe('doc')
    expect(cached?.messages.length).toBe(3)
    const envelope = JSON.parse(fs.files.get('index/.arch-lens-sequence-default.json')!.content!) as { v: number; deps: string[] }
    expect(envelope.v).toBe(VERSION)
    expect(envelope.deps).toEqual(['pkgA', 'pkgB', 'pkgC'])
  })
})
