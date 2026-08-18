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
