/**
 * Comprehension-spine phase 1 tail: the concept chain's own streaming
 * induction accepts a stale prior draft (same revision contract as the
 * llmText-based chains). The prompt is captured at the dsh-llm message
 * factory; the real generateFromFlow runs against a fake llm service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prompts: string[] = []
vi.mock('@deepseek-ai/dsh-llm', () => ({
  createUserMessage: (message: { content: Array<{ text?: string }> }) => {
    prompts.push(message.content.map(part => part.text ?? '').join(''))
    return {}
  },
}))

import type { Context } from '@deepseek-ai/cordis'
import { generateFromFlow } from '../src/concept.ts'
import type { ConceptTreeNode } from '../src/concept.ts'
import { priorRevisionPreamble } from '../src/docsgen.ts'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'

const ROOT = '/ws'

/** Fake llm service answering with one concept-tree root. */
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
              yield { type: 'text-delta', text: '[{ "name": "入口", "desc": "网关", "inside": "", "children": [] }]' }
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
      entities: [], imports: [], entryFiles: ['src/index.ts'],
    },
  ],
}

describe('generateFromFlow prior wiring (concept chain tail)', () => {
  beforeEach(() => {
    prompts.length = 0
  })

  it('a prior tree is embedded under the shared revision contract', async () => {
    const prior: ConceptTreeNode[] = [{ id: 'flow-0-0', name: '旧核心', desc: '旧事实下的概念', source: 'flow' }]
    const tree = await generateFromFlow(fakeCtx(), index, '中文', undefined, false, prior)
    expect(tree.length).toBe(1)
    expect(tree[0]?.name).toBe('入口')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain(priorRevisionPreamble('中文'))
    expect(prompts[0]).toContain('【上一版概念树】')
    expect(prompts[0]).toContain('旧核心')
    // The chain's own output contract still closes the prompt.
    expect(prompts[0]).toContain('严格输出 JSON 对象数组')
  })

  it('no prior → the plain induction prompt (unchanged shape)', async () => {
    const tree = await generateFromFlow(fakeCtx(), index, '中文', undefined, false, null)
    expect(tree.length).toBe(1)
    expect(prompts[0]).not.toContain('上一版')
    expect(prompts[0]).toContain('你是代码架构分析师')
  })
})
