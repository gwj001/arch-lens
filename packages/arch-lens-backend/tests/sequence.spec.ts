/**
 * Unit tests for the sequence-figure chain: static call-graph derivation
 * (source 'code'), doc section extraction (source 'doc'), and the section
 * parser. All pure functions — no fs, no LLM.
 */
import { describe, it, expect, vi } from 'vitest'
// The sequence module imports concept/docsgen, which import the host LLM
// runtime value (`@deepseek-ai/dsh-llm`, resolvable only inside the harness
// build). None of the tested functions touch it, so stub the value import.
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import { buildSequenceFromCalls, parseSequenceSection, sectionText } from '../src/sequence.ts'
import { seqInductionPrompt } from '../src/docsgen.ts'

/** Index with four packages: `a` (entry) imports `b` and `d`; `b` imports `c`. */
function threePackageIndex(): CodeIndexResult {
  return {
    root: '/ws',
    language: 'typescript',
    packages: [
      {
        id: 'a', path: '/ws/packages/a', language: 'typescript', deps: ['b'],
        entities: [{ name: 'run', kind: 'function', file: 'packages/a/src/index.ts', line: 1 }],
        imports: [
          { from: 'packages/a/src/index.ts', to: '@scope/pkg-b', names: ['doThing', 'helper'] },
          { from: 'packages/a/src/index.ts', to: 'pkg-d', names: ['external'] },
        ],
        entryFiles: ['packages/a/src/index.ts'],
      },
      {
        id: 'pkg-b', path: '/ws/packages/b', language: 'typescript', deps: ['c'],
        entities: [{ name: 'doThing', kind: 'function', file: 'packages/b/src/b.ts', line: 1 }],
        imports: [{ from: 'packages/b/src/b.ts', to: 'pkg-c', names: ['store'] }],
        entryFiles: [],
      },
      {
        id: 'pkg-c', path: '/ws/packages/c', language: 'typescript', deps: [],
        entities: [{ name: 'store', kind: 'function', file: 'packages/c/src/c.ts', line: 1 }],
        imports: [], entryFiles: [],
      },
      {
        id: 'pkg-d', path: '/ws/packages/d', language: 'typescript', deps: [],
        entities: [{ name: 'external', kind: 'function', file: 'packages/d/src/d.ts', line: 1 }],
        imports: [], entryFiles: [],
      },
    ],
    calls: [
      { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'doThing', line: 3 },
      { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'helper', line: 4 },
      { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'helper', line: 5 },
      { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'external', line: 6 },
      { fromFile: 'packages/b/src/b.ts', from: 'doThing', to: 'store', line: 7 },
      { fromFile: 'packages/b/src/b.ts', from: 'doThing', to: 'store', line: 8 },
    ],
  }
}

describe('buildSequenceFromCalls', () => {
  it('derives a code-sourced figure from real cross-package call edges', () => {
    const result = buildSequenceFromCalls(threePackageIndex(), '中文')
    expect(result).not.toBeNull()
    expect(result!.source).toBe('code')
    expect(result!.messages.length).toBeGreaterThanOrEqual(3)
    expect(result!.messages[0]!.from).toBe('a')
    expect(result!.messages[0]!.to).toBe('pkg-b')
    expect(result!.messages[0]!.label).toContain('doThing')
  })

  it('labels in English when the role language is English', () => {
    const result = buildSequenceFromCalls(threePackageIndex(), 'English')
    expect(result!.messages[0]!.label).toContain('calls')
  })

  it('merges repeated symbols into one message and caps the label', () => {
    const result = buildSequenceFromCalls(threePackageIndex(), '中文')
    const label = result!.messages[0]!.label
    expect(label).toContain('doThing')
    expect(label).toContain('helper')
  })

  it('resolves namespace-import calls via the call-target root', () => {
    const index = threePackageIndex()
    // b imports c through a namespace alias; the call site uses the alias.
    index.packages[1]!.imports = [{ from: 'packages/b/src/b.ts', to: 'pkg-c', names: ['storeNs'] }]
    index.calls = [
      ...index.calls!,
      { fromFile: 'packages/b/src/b.ts', from: 'doThing', to: 'store', root: 'storeNs', line: 9 },
    ]
    const result = buildSequenceFromCalls(index, '中文')
    expect(result).not.toBeNull()
    const bToC = result!.messages.find(m => m.from === 'pkg-b' && m.to === 'pkg-c')
    expect(bToC).toBeDefined()
  })

  it('resolves npm-style package specifiers to directory-short package ids', () => {
    // Package ids are directory short names ('session'); workspace imports
    // use npm names ('@deepseek-ai/dsh-session').
    const index = threePackageIndex()
    index.packages[1]!.id = 'session'
    index.packages[0]!.imports[0] = { from: 'packages/a/src/index.ts', to: '@deepseek-ai/dsh-session', names: ['doThing', 'helper'] }
    const result = buildSequenceFromCalls(index, '中文')
    expect(result).not.toBeNull()
    const aToSession = result!.messages.find(m => m.from === 'a' && m.to === 'session')
    expect(aToSession).toBeDefined()
  })

  it('normalizes ./ segments inside relative import resolution', () => {
    const index = threePackageIndex()
    // The import specifier carries a mid-path './' segment.
    index.packages[1]!.imports = [{ from: 'packages/b/src/./b.ts', to: 'pkg-c', names: ['store'] }]
    index.calls = [
      ...index.calls!,
      { fromFile: 'packages/b/src/./b.ts', from: 'doThing', to: 'store', line: 9 },
    ]
    const result = buildSequenceFromCalls(index, '中文')
    expect(result).not.toBeNull()
    const bToC = result!.messages.find(m => m.from === 'pkg-b' && m.to === 'pkg-c')
    expect(bToC).toBeDefined()
  })

  it('returns null when there are no call edges', () => {
    const index = threePackageIndex()
    index.calls = []
    expect(buildSequenceFromCalls(index, '中文')).toBeNull()
  })

  it('returns null when no edge resolves across packages', () => {
    const index = threePackageIndex()
    index.calls = [{ fromFile: 'packages/a/src/index.ts', from: 'run', to: 'internalOnly', line: 1 }]
    expect(buildSequenceFromCalls(index, '中文')).toBeNull()
  })

  it('starts from an entry package; falls back to the most-cited package', () => {
    const index = threePackageIndex()
    index.packages[0]!.entryFiles = []
    const result = buildSequenceFromCalls(index, '中文')
    expect(result).not.toBeNull()
    // No entry packages: traversal starts at the most-cited package (pkg-b,
    // cited by a) and covers the whole graph (b→c, a→b, a→d).
    expect(result!.messages.length).toBeGreaterThanOrEqual(3)
    expect(result!.messages[0]!.from).toBe('pkg-b')
  })

  it('returns null when fewer than 3 messages can be derived', () => {
    const index = threePackageIndex()
    index.calls = [{ fromFile: 'packages/a/src/index.ts', from: 'run', to: 'doThing', line: 3 }]
    expect(buildSequenceFromCalls(index, '中文')).toBeNull()
  })

  it('annotates every package with role, degrees, and a workspace-relative path', () => {
    const result = buildSequenceFromCalls(threePackageIndex(), '中文')
    expect(result!.nodes).toBeDefined()
    // a is the entry package; its edges appear first, so it leads the nodes.
    const a = result!.nodes![0]!
    expect(a).toEqual({
      id: 'a', role: 'entry', citedBy: 0, cites: 2,
      path: 'packages/a/src/index.ts',
    })
    // Leaf packages: cited once, path falls back to the first source file.
    const c = result!.nodes!.find(node => node.id === 'pkg-c')!
    expect(c.role).toBe('leaf')
    expect(c.citedBy).toBe(1)
    expect(c.path).toBe('packages/c/src/c.ts')
  })

  it('classifies packages cited by ≥2 callers as hubs (shared services)', () => {
    const index: CodeIndexResult = {
      root: '/ws', language: 'typescript',
      packages: [
        {
          id: 'a', path: '/ws/packages/a', language: 'typescript', deps: [],
          entities: [{ name: 'run', kind: 'function', file: 'packages/a/src/index.ts', line: 1 }],
          imports: [{ from: 'packages/a/src/index.ts', to: 'shared', names: ['svc'] }],
          entryFiles: ['packages/a/src/index.ts'],
        },
        {
          id: 'b', path: '/ws/packages/b', language: 'typescript', deps: [],
          entities: [{ name: 'runB', kind: 'function', file: 'packages/b/src/index.ts', line: 1 }],
          imports: [{ from: 'packages/b/src/index.ts', to: 'shared', names: ['svc'] }],
          entryFiles: ['packages/b/src/index.ts'],
        },
        {
          id: 'c', path: '/ws/packages/c', language: 'typescript', deps: [],
          entities: [{ name: 'runC', kind: 'function', file: 'packages/c/src/index.ts', line: 1 }],
          imports: [{ from: 'packages/c/src/index.ts', to: 'shared', names: ['svc'] }],
          entryFiles: ['packages/c/src/index.ts'],
        },
        {
          id: 'shared', path: '/ws/packages/shared', language: 'typescript', deps: [],
          entities: [{ name: 'svc', kind: 'function', file: 'packages/shared/src/svc.ts', line: 1 }],
          imports: [], entryFiles: [],
        },
      ],
      calls: [
        { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'svc', line: 2 },
        { fromFile: 'packages/b/src/index.ts', from: 'runB', to: 'svc', line: 2 },
        { fromFile: 'packages/c/src/index.ts', from: 'runC', to: 'svc', line: 2 },
      ],
    }
    const result = buildSequenceFromCalls(index, '中文')
    const shared = result!.nodes!.find(node => node.id === 'shared')!
    expect(shared.role).toBe('hub')
    expect(shared.citedBy).toBe(3)
    expect(shared.cites).toBe(0)
    // Uncited single-target callers are leaves under the pure graph rule —
    // having an entry file no longer makes a package an entry.
    const a = result!.nodes!.find(node => node.id === 'a')!
    expect(a.role).toBe('leaf')
  })

  it('classifies uncited orchestrators of ≥2 packages as entries without entry files', () => {
    const index = threePackageIndex()
    index.packages[0]!.entryFiles = []
    const result = buildSequenceFromCalls(index, '中文')
    const a = result!.nodes!.find(node => node.id === 'a')!
    expect(a.role).toBe('entry')
    expect(a.citedBy).toBe(0)
    expect(a.cites).toBe(2)
  })

  it('drops call edges from test files so fixture calls do not inflate the graph', () => {
    const index = threePackageIndex()
    index.calls = [
      ...index.calls!,
      { fromFile: 'packages/a/tests/a.spec.ts', from: 'run', to: 'doThing', line: 2 },
      { fromFile: 'packages/a/__tests__/harness.ts', from: 'run', to: 'external', line: 3 },
      { fromFile: 'packages/b/test/b.test.ts', from: 'doThing', to: 'store', line: 4 },
    ]
    const result = buildSequenceFromCalls(index, '中文')
    // Production edges only: a→pkg-b, a→pkg-d, pkg-b→pkg-c.
    expect(result!.messages.length).toBe(3)
    const aNode = result!.nodes!.find(node => node.id === 'a')!
    expect(aNode.cites).toBe(2)
    expect(aNode.citedBy).toBe(0)
    // No message carries a test file as its sample caller.
    expect(result!.messages.every(message => !/tests?\/|__tests__\/|\.spec\.|\.test\./.test(message.file ?? ''))).toBe(true)
  })

  it('records the caller file and the full symbol list beyond the label cap', () => {
    const index = threePackageIndex()
    index.packages[0]!.imports[0] = {
      from: 'packages/a/src/index.ts', to: '@scope/pkg-b',
      names: ['doThing', 'helper', 'extra1', 'extra2', 'extra3', 'extra4'],
    }
    index.calls = [
      ...index.calls!,
      { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'extra1', line: 10 },
      { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'extra2', line: 11 },
      { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'extra3', line: 12 },
      { fromFile: 'packages/a/src/index.ts', from: 'run', to: 'extra4', line: 13 },
    ]
    const result = buildSequenceFromCalls(index, '中文')
    const aToB = result!.messages.find(m => m.from === 'a' && m.to === 'pkg-b')!
    // Label shows the first symbols plus the total; syms keeps the evidence.
    expect(aToB.label).toContain('等 6 个')
    expect(aToB.syms).toEqual(['doThing', 'helper', 'extra1', 'extra2', 'extra3', 'extra4'])
    expect(aToB.file).toBe('packages/a/src/index.ts')
  })

  it('omits syms when the label already shows every symbol', () => {
    const result = buildSequenceFromCalls(threePackageIndex(), '中文')
    const aToB = result!.messages.find(m => m.from === 'a' && m.to === 'pkg-b')!
    expect(aToB.syms).toBeUndefined()
    expect(aToB.label).not.toContain('等')
  })
})

describe('seqInductionPrompt', () => {
  it('targets the project-core main flow with the entry → core → capability structure', () => {
    const prompt = seqInductionPrompt(threePackageIndex(), '中文')
    expect(prompt).toContain('项目核心')
    expect(prompt).toContain('入口包')
    expect(prompt).toContain('核心循环')
    expect(prompt).toContain('10-16 条')
    // Hard constraints: ids must come from the summary, no fabrication.
    expect(prompt).toContain('禁止编造')
    // The index summary is embedded (real package ids reach the model).
    expect(prompt).toContain('pkg-b')
  })

  it('pins the main line by name: entry packages start it, most-imported packages form its core', () => {
    const prompt = seqInductionPrompt(threePackageIndex(), '中文')
    expect(prompt).toContain('主线约束')
    expect(prompt).toContain('a') // the only package with entry files in the fixture
    expect(prompt).toContain('pkg-b') // most-imported package (cited by a)
    expect(prompt).toContain('禁止以客户端 UI 包或测试包作为主线起点')
  })
})

describe('parseSequenceSection', () => {
  it('parses a mermaid sequenceDiagram block with participant aliases', () => {
    const text = [
      '```mermaid',
      'sequenceDiagram',
      '  participant FE as 前端',
      '  participant BE as 后端',
      '  FE->>BE: 发起分析',
      '  BE-->>FE: 返回结果',
      '  Note over FE: 等待',
      '  loop 重试',
      '    FE->>BE: 重试',
      '  end',
      '```',
    ].join('\n')
    const messages = parseSequenceSection(text)
    expect(messages).toEqual([
      { from: '前端', to: '后端', label: '发起分析' },
      { from: '后端', to: '前端', label: '返回结果' },
      { from: '前端', to: '后端', label: '重试' },
    ])
  })

  it('parses plain text message lines without a mermaid block', () => {
    const text = [
      '1. 前端 -> 后端: 发起请求',
      '2. 后端 → 存储: 写入数据',
      '3. 存储 --> 后端: 确认',
    ].join('\n')
    const messages = parseSequenceSection(text)
    expect(messages.length).toBe(3)
    expect(messages[0]).toEqual({ from: '前端', to: '后端', label: '发起请求' })
    expect(messages[1]!.from).toBe('后端')
    expect(messages[1]!.to).toBe('存储')
  })

  it('skips self-messages and blank lines', () => {
    const messages = parseSequenceSection('A->>A: 自调用\n\nB->>C: 正常')
    expect(messages).toEqual([{ from: 'B', to: 'C', label: '正常' }])
  })

  it('caps at 16 messages', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `A${i % 3}->>B${(i + 1) % 3}: 消息 ${i}`)
    expect(parseSequenceSection(lines.join('\n')).length).toBe(16)
  })
})

describe('sectionText', () => {
  it('extracts the level-2 时序 section up to the next heading', () => {
    const doc = [
      '# 架构',
      '## 概念层级',
      '概念内容',
      '## 时序',
      '前端 -> 后端: 发起',
      '## 交互',
      '交互内容',
    ].join('\n')
    expect(sectionText(doc, '时序')).toBe('前端 -> 后端: 发起')
  })

  it('returns null when the section is absent', () => {
    expect(sectionText('# 只有标题', '时序')).toBeNull()
  })
})
