/**
 * readIndexFacts (the single version-bound reader of the code-index disk
 * cache): the file may only serve the CURRENT facts version. Legacy
 * unversioned files, foreign versions and an unknown facts version (0) all
 * return the existing "rescan first" error shapes — never stale edges. This
 * is the version check remoteCallGraph relies on.
 */
import { describe, it, expect, vi } from 'vitest'
// Chain modules imported through figures.ts reach the external (uninstalled)
// harness LLM package at runtime; intercept it (same pattern as the other specs).
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))

import { readIndexFacts } from '../src/figures.ts'
import { FakeFs } from './fake-fs.ts'

const VERSION = 100
const GRAPH = 'index/.arch-lens-graph.json'
const INDEX = 'index/.arch-lens-index.json'

const indexResult = {
  root: '/ws',
  language: 'typescript',
  packages: [{ id: 'pkg-a', path: '/ws/pkg-a', language: 'typescript', deps: [], entities: [], imports: [], entryFiles: [] }],
}

function workspace(init: Record<string, string>): FakeFs {
  return new FakeFs({ '': null, index: null, [GRAPH]: JSON.stringify({ root: '/ws', generatedAt: VERSION, graph: { nodes: [], edges: [] } }), ...init })
}

describe('readIndexFacts (version-bound index read)', () => {
  it('serves the envelope written for the CURRENT facts version', async () => {
    const fs = workspace({ [INDEX]: JSON.stringify({ v: VERSION, data: indexResult }) })
    const outcome = await readIndexFacts(fs as never, '/ws')
    expect(outcome).toEqual({ index: indexResult })
  })

  it('rejects a legacy unversioned file with the rescan error shape', async () => {
    const fs = workspace({ [INDEX]: JSON.stringify(indexResult) })
    const outcome = await readIndexFacts(fs as never, '/ws')
    expect('error' in outcome).toBe(true)
  })

  it('rejects a foreign facts version with the rescan error shape', async () => {
    const fs = workspace({ [INDEX]: JSON.stringify({ v: VERSION - 1, data: indexResult }) })
    const outcome = await readIndexFacts(fs as never, '/ws')
    expect('error' in outcome).toBe(true)
  })

  it('rejects when no facts version exists yet (never scanned)', async () => {
    const fs = new FakeFs({ '': null, index: null, [INDEX]: JSON.stringify({ v: VERSION, data: indexResult }) })
    const outcome = await readIndexFacts(fs as never, '/ws')
    expect('error' in outcome).toBe(true)
  })

  it('rejects a missing cache file with the rescan error shape', async () => {
    const fs = workspace({})
    const outcome = await readIndexFacts(fs as never, '/ws')
    expect('error' in outcome).toBe(true)
  })

  it('rejects an envelope with an empty package list', async () => {
    const fs = workspace({ [INDEX]: JSON.stringify({ v: VERSION, data: { ...indexResult, packages: [] } }) })
    const outcome = await readIndexFacts(fs as never, '/ws')
    expect(outcome).toEqual({ error: '代码索引为空，请先点击「↻ 重新扫描」' })
  })
})
