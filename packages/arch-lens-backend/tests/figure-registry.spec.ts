/**
 * Stage-0 figure registry semantics (figures.ts):
 *  - every spec's AUTHORITATIVE cache name lines up with the real file names
 *    the chains write (regression for the historical flow bug where
 *    generateAll spelled ".arch-lens-flow-event-default.json" while flow.ts
 *    writes ".arch-lens-flow-default-event.json" → flow could NEVER be
 *    skipped in incremental mode and was force-redrawn on every pass);
 *  - an incremental pass skips every figure whose cache is valid against the
 *    current facts version and rebuilds ONLY the stale/missing ones;
 *  - a non-incremental pass force-redraws everything (旧「无条件全部重绘」).
 */
import { describe, it, expect, vi } from 'vitest'
// The harness LLM package is external (not installed in this workspace): the
// chain modules import it at runtime, so the module must be intercepted
// before any figures.ts import resolves (same pattern as analysis-chain.spec).
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))

import { FIGURE_SPECS, runEntityFigurePass } from '../src/figures.ts'
import type { FigureEnv, FigureKindSpec } from '../src/figures.ts'
import { FakeFs } from './fake-fs.ts'

const ROOT = '/ws'
const VERSION = 100

/** The seven real cache files (language 中文 sanitizes to 'default'). */
const REAL_CACHES: Record<string, string> = {
  concepts: 'index/.arch-lens-concept-default.json',
  'flow-event': 'index/.arch-lens-flow-default-event.json',
  'flow-pipeline': 'index/.arch-lens-flow-default-pipeline.json',
  seq: 'index/.arch-lens-sequence-default.json',
  interaction: 'index/.arch-lens-events-default.json',
  core: 'index/.arch-lens-core-default.json',
  duties: 'index/.arch-lens-summaries-default.json',
}

function envelope(v: number): string {
  return JSON.stringify({ v, deps: [], data: { title: 't', mermaid: 'flowchart TD\nA-->B' } })
}

/** Workspace with the current facts version and (by default) ALL seven real
 * figure caches valid against it. LLM-less ctx: any accidental build would
 * surface as an error entry, so "skipped" assertions also prove zero work. */
function wsAllValid(): { fs: FakeFs; env: FigureEnv } {
  const fs = new FakeFs({
    '': null,
    'index': null,
    'index/.arch-lens-graph.json': JSON.stringify({ root: ROOT, generatedAt: VERSION, graph: { nodes: [], edges: [] } }),
    ...Object.fromEntries(Object.values(REAL_CACHES).map(name => [name, envelope(VERSION)])),
  })
  const env: FigureEnv = {
    ctx: { get: () => undefined } as never,
    fs: fs as never,
    root: ROOT,
    index: { root: ROOT, language: 'typescript', packages: [] } as never,
    graph: { root: ROOT, groups: [], nodes: [], edges: [] } as never,
    language: '中文',
  }
  return { fs, env }
}

describe('figure registry cache names (flow bug regression)', () => {
  it('every spec delegates to its chain and matches the real written file', () => {
    expect(FIGURE_SPECS.map(spec => spec.cacheName('中文'))).toEqual(Object.values(REAL_CACHES))
  })
})

describe('runEntityFigurePass (incremental)', () => {
  it('all caches valid → skips all seven figures, no build runs', async () => {
    const { env } = wsAllValid()
    const outcome = await runEntityFigurePass(env, true)
    expect(outcome.skipped).toEqual(Object.keys(REAL_CACHES))
    expect(outcome.rebuilt).toEqual([])
    expect(outcome.errors).toEqual([])
  })

  it('one stale + one missing cache → rebuilds ONLY those two, skips the rest', async () => {
    const { fs, env } = wsAllValid()
    fs.setFile(REAL_CACHES['flow-event'] as string, envelope(VERSION - 1)) // stale
    fs.remove(REAL_CACHES.core as string) // missing
    const built: string[] = []
    const specs: FigureKindSpec[] = FIGURE_SPECS.map(spec => ({
      ...spec,
      build: async (_e: FigureEnv, force: boolean): Promise<unknown> => {
        built.push(`${spec.id}:${String(force)}`)
        return { ok: true }
      },
    }))
    const outcome = await runEntityFigurePass(env, true, specs)
    expect(outcome.skipped).toEqual(Object.keys(REAL_CACHES).filter(id => id !== 'flow-event' && id !== 'core'))
    expect(built).toEqual(['flow-event:true', 'core:true'])
    expect(outcome.rebuilt).toEqual(['flow-event', 'core'])
    expect(outcome.errors).toEqual([])
  })

  it('non-incremental force-redraws every figure even when all are valid', async () => {
    const { env } = wsAllValid()
    let builds = 0
    const specs: FigureKindSpec[] = FIGURE_SPECS.map(spec => ({
      ...spec,
      build: async (): Promise<unknown> => {
        builds += 1
        return []
      },
    }))
    const outcome = await runEntityFigurePass(env, false, specs)
    expect(builds).toBe(7)
    expect(outcome.skipped).toEqual([])
    expect(outcome.rebuilt).toEqual(Object.keys(REAL_CACHES))
  })

  it('a chain error is collected and does not stop the pass', async () => {
    const { env } = wsAllValid()
    const specs: FigureKindSpec[] = [
      { id: 'seq', cacheName: language => FIGURE_SPECS.find(s => s.id === 'seq')!.cacheName(language), build: async () => ({ error: 'boom' }) },
    ]
    // The cache IS valid → still skipped: errors only come from rebuilt steps.
    const skip = await runEntityFigurePass(env, true, specs)
    expect(skip.skipped).toEqual(['seq'])
    const pass = await runEntityFigurePass(env, false, specs)
    expect(pass.errors).toEqual(['seq: boom'])
    expect(pass.rebuilt).toEqual([])
  })
})
