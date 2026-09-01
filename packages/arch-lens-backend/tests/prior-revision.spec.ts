/**
 * Comprehension-spine phase 1 (prior-draft incremental revision):
 *  - readStalePrior serves a STALE envelope as a revision draft while never
 *    serving fresh/tombstone/missing/legacy/data-less caches;
 *  - priorRevisionPreamble carries the bilingual revision contract;
 *  - writeStructuredCache embeds the prior draft into the induction prompt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the prompt at the dsh-llm message factory: writeStructuredCache
// lives INSIDE docsgen.ts, so its internal llmText call uses the module's own
// binding — a vi.mock seam on docsgen would never intercept it. The real
// llmText runs against a fake ctx below (the llmText-usage.spec pattern).
const prompts: string[] = []
vi.mock('@deepseek-ai/dsh-llm', () => ({
  createUserMessage: (message: { content: Array<{ text?: string }> }) => {
    prompts.push(message.content.map(part => part.text ?? '').join(''))
    return {}
  },
}))

import type { Context } from '@deepseek-ai/cordis'
import { FakeFs, fsTarget } from './fake-fs.ts'
import { readStalePrior, writeVersionedCache } from '../src/fact-cache.ts'
import { priorRevisionPreamble, writeStructuredCache } from '../src/docsgen.ts'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'

const ROOT = '/ws'
const VERSION = 100
const CACHE = 'index/.arch-lens-test-prior.json'

function envelope(v: number, data: unknown): string {
  return JSON.stringify({ v, deps: ['gateway'], data })
}

describe('readStalePrior', () => {
  async function withFile(content: string | null): Promise<FakeFs> {
    const fs = new FakeFs({ '': null, 'index': null, ...(content === null ? {} : { [CACHE]: content }) })
    return fs
  }

  it('a stale envelope yields its data as the prior draft', async () => {
    const fs = await withFile(envelope(VERSION - 1, { markdown: '## 旧稿' }))
    const prior = await readStalePrior<{ markdown: string }>(fs as never, fsTarget(CACHE), VERSION)
    expect(prior?.markdown).toBe('## 旧稿')
  })

  it('a fresh cache is NOT a prior (the fresh read serves it)', async () => {
    const fs = await withFile(envelope(VERSION, { markdown: '## 新稿' }))
    expect(await readStalePrior(fs as never, fsTarget(CACHE), VERSION)).toBeNull()
  })

  it('the v=0 invalidation tombstone is never a prior', async () => {
    const fs = await withFile(JSON.stringify({ v: 0 }))
    expect(await readStalePrior(fs as never, fsTarget(CACHE), VERSION)).toBeNull()
  })

  it('missing, legacy-unversioned and data-less envelopes are null', async () => {
    expect(await readStalePrior((await withFile(null)) as never, fsTarget(CACHE), VERSION)).toBeNull()
    expect(await readStalePrior((await withFile('{"data": {"a": 1}}')) as never, fsTarget(CACHE), VERSION)).toBeNull()
    expect(await readStalePrior((await withFile(envelope(VERSION - 1, null))) as never, fsTarget(CACHE), VERSION)).toBeNull()
  })

  it('an unknown facts version (0) disables prior reads entirely', async () => {
    const fs = await withFile(envelope(VERSION - 1, { a: 1 }))
    expect(await readStalePrior(fs as never, fsTarget(CACHE), 0)).toBeNull()
  })

  it('round-trips with writeVersionedCache across a facts-version bump', async () => {
    const fs = new FakeFs({ '': null, 'index': null })
    await writeVersionedCache(fs as never, fsTarget(CACHE), { messages: [1, 2] }, VERSION, undefined, ['gateway'])
    // Same version → fresh, not a prior.
    expect(await readStalePrior(fs as never, fsTarget(CACHE), VERSION)).toBeNull()
    // Facts moved on → the same envelope is now a prior draft.
    const prior = await readStalePrior<{ messages: number[] }>(fs as never, fsTarget(CACHE), VERSION + 1)
    expect(prior?.messages).toEqual([1, 2])
  })
})

describe('priorRevisionPreamble', () => {
  it('states the revision contract in both role languages', () => {
    const zh = priorRevisionPreamble('中文')
    expect(zh).toContain('上一版')
    expect(zh).toContain('删除新事实中已不存在的内容')
    expect(zh).toContain('不是事实来源')
    const en = priorRevisionPreamble('English')
    expect(en).toContain('prior draft')
    expect(en).toContain('DELETE anything the new facts no longer contain')
  })
})

describe('writeStructuredCache prior wiring', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs({ '': null, 'index': null })
    prompts.length = 0
  })

  /** Fake host ctx for the REAL llmText (llmText-usage.spec pattern). */
  function fakeCtx(): Context {
    return {
      get: (name: string) => {
        if (name === 'agentDefaultModel') {
          return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
        }
        if (name === 'llm') {
          return {
            prepareCall: async () => ({
              config: { provider: 'p', model: 'm' },
              stream: async function* () {
                yield { type: 'text-delta', text: '[{ "from": "gateway", "to": "auth-core", "label": "校验令牌" }]' }
                yield { type: 'finish', reason: { kind: 'stop' } }
              },
            }),
          }
        }
        return undefined
      },
    } as unknown as Context
  }

  const index: CodeIndexResult = {
    root: ROOT,
    language: 'typescript',
    packages: [
      {
        id: 'gateway', path: `${ROOT}/packages/gateway`, language: 'typescript', deps: [],
        entities: [{ name: 'Gateway', kind: 'class', file: 'packages/gateway/src/index.ts', line: 1 }],
        imports: [], entryFiles: ['src/index.ts'],
      },
      {
        id: 'auth-core', path: `${ROOT}/packages/auth-core`, language: 'typescript', deps: [],
        entities: [{ name: 'Token', kind: 'class', file: 'packages/auth-core/src/token.ts', line: 1 }],
        imports: [], entryFiles: ['src/token.ts'],
      },
    ],
  }

  it('a prior draft is embedded before the induction prompt', async () => {
    fs.setFile('index/.arch-lens-graph.json', JSON.stringify({ root: ROOT, generatedAt: VERSION }))
    const prior = [{ from: 'gateway', to: 'old-pkg', label: '旧步骤' }]
    const out = await writeStructuredCache(fakeCtx(), fs as never, ROOT, index, '中文', 'seq', undefined, false, prior)
    expect(Array.isArray(out)).toBe(true)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain(priorRevisionPreamble('中文'))
    expect(prompts[0]).toContain('【上一版】')
    expect(prompts[0]).toContain('old-pkg')
    // The chain's own output contract still closes the prompt.
    expect(prompts[0]).toContain('严格输出 JSON 数组')
  })

  it('no prior → the plain induction prompt (unchanged shape)', async () => {
    fs.setFile('index/.arch-lens-graph.json', JSON.stringify({ root: ROOT, generatedAt: VERSION }))
    await writeStructuredCache(fakeCtx(), fs as never, ROOT, index, '中文', 'seq', undefined, false, null)
    expect(prompts[0]).not.toContain('上一版')
    expect(prompts[0]).toContain('你是代码时序分析师')
  })
})
