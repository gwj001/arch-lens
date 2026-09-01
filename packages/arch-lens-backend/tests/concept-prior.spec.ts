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
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { conceptTree, generateFromFlow } from '../src/concept.ts'
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
  })

  it('claim outlines are injected as 【文档声称】', async () => {
    const claims = '【docs/design.md】\n# 设计备忘\n## 认知序\n'
    const tree = await generateFromFlow(fakeCtx(), index, '中文', undefined, false, null, claims)
    expect(tree.length).toBe(1)
    expect(prompts[0]).toContain('【文档声称】')
    expect(prompts[0]).toContain('docs/design.md')
    expect(prompts[0]).toContain('## 认知序')
  })

  it('empty claims → no 文档声称 block', async () => {
    await generateFromFlow(fakeCtx(), index, '中文', undefined, false, null, '')
    expect(prompts[0]).not.toContain('【文档声称】')
  })
})

/** Minimal fake fs (docset-style) supporting the conceptTree write path. */
function fakeFs(files: Record<string, string>): FileSystem {
  return {
    resolve: async (path: string) => ({ displayPath: path }) as never,
    stat: async (target: { displayPath: string }) => {
      const text = files[target.displayPath]
      return text === undefined ? undefined : { type: 'file', size: text.length }
    },
    readText: async (target: { displayPath: string }) => {
      const text = files[target.displayPath]
      if (text === undefined) throw new Error(`ENOENT: ${target.displayPath}`)
      return text
    },
    writeText: async () => ({}) as never,
    listDir: async (target: { displayPath: string }) => {
      const prefix = `${target.displayPath}/`
      const names = Object.keys(files).filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      return names.map(name => ({ name: name.slice(prefix.length), type: 'file' as const, target: { displayPath: name } as never }))
    },
  } as unknown as FileSystem
}

describe('conceptTree claim synthesis (claims → induction)', () => {
  beforeEach(() => {
    prompts.length = 0
  })

  it('a claim doc WITHOUT a concept section skips the profile and injects its outline', async () => {
    const fs = fakeFs({
      'index/.arch-lens-graph.json': JSON.stringify({ generatedAt: 100 }),
      'docs/design.md': '# 设计备忘\n## 认知序\n### 主干\n',
    })
    const tree = await conceptTree(fakeCtx(), fs as never, '/ws', index, '中文', false)
    expect(Array.isArray(tree)).toBe(true)
    expect((tree as ConceptTreeNode[])[0]?.name).toBe('入口')
    expect(prompts.length).toBe(1)
    expect(prompts[0]).toContain('【文档声称】')
    expect(prompts[0]).toContain('docs/design.md')
    expect(prompts[0]).toContain('## 认知序')
  })

  it('a doc WITH a 「概念层级」section stays verbatim (zero LLM) over claims', async () => {
    const fs = fakeFs({
      'index/.arch-lens-graph.json': JSON.stringify({ generatedAt: 100 }),
      'docs/design.md': '# 设计备忘\n## 概念层级\n### 运行核心\n#### 调度\n### 入口层\n',
    })
    const tree = await conceptTree(fakeCtx(), fs as never, '/ws', index, '中文', false)
    expect(Array.isArray(tree)).toBe(true)
    const nodes = tree as ConceptTreeNode[]
    expect(nodes[0]?.source).toBe('doc')
    expect(nodes[0]?.name).toBe('运行核心')
    expect(nodes[1]?.name).toBe('入口层')
    expect(prompts.length).toBe(0) // verbatim extraction, no LLM
  })
})
