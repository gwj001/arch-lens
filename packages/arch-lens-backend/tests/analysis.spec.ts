/**
 * Unit tests for the shared analysis profile sanitizers — the accuracy rules
 * of 方案 A. All pure functions: a garbage or fabricated LLM output must
 * never reach a figure, so every rule here is a correctness guarantee.
 */
import { describe, it, expect, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import {
  sanitizeCoreIds,
  sanitizeEvents,
  sanitizeFlow,
  sanitizeSeqMessages,
  buildProfileConceptTree,
  parseProfileObject,
  profileFromText,
  PROFILE_VERSION,
} from '../src/analysis.ts'

function smallIndex(): CodeIndexResult {
  return {
    root: '/ws', language: 'typescript',
    packages: ['a', 'b', 'c', 'd'].map(id => ({
      id, path: `/ws/packages/${id}`, language: 'typescript' as const,
      deps: [], entities: [], imports: [], entryFiles: [],
    })),
  }
}

describe('sanitizeCoreIds', () => {
  it('keeps only ids that exist in the index (anti-fabrication)', () => {
    const ids = sanitizeCoreIds(smallIndex(), ['a', 'ghost', 3, 'b', 'a'])
    expect(ids).toEqual(['a', 'b'])
  })

  it('caps the selection at 25 ids', () => {
    const index: CodeIndexResult = {
      root: '/ws', language: 'typescript',
      packages: Array.from({ length: 40 }, (_, i) => ({
        id: `p${i}`, path: `/ws/p${i}`, language: 'typescript' as const,
        deps: [], entities: [], imports: [], entryFiles: [],
      })),
    }
    const ids = sanitizeCoreIds(index, Array.from({ length: 40 }, (_, i) => `p${i}`))
    expect(ids.length).toBe(25)
  })

  it('returns an empty list for non-array input', () => {
    expect(sanitizeCoreIds(smallIndex(), 'a')).toEqual([])
    expect(sanitizeCoreIds(smallIndex(), undefined)).toEqual([])
  })
})

describe('buildProfileConceptTree', () => {
  it('builds source:flow nodes with required names and bounded text', () => {
    const tree = buildProfileConceptTree([
      { name: '  运行核心  ', desc: '调度一切', inside: '主循环', children: [{ name: '入口', desc: 'x'.repeat(500) }] },
      { desc: '没有名字的节点必须被丢弃' },
      'not an object',
    ], 'analysis')
    expect(tree.length).toBe(1)
    expect(tree[0]).toMatchObject({ id: 'analysis-0-0', name: '运行核心', desc: '调度一切', inside: '主循环', source: 'flow' })
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children![0]!.desc.length).toBeLessThanOrEqual(220)
  })

  it('caps roots at 12 and depth at 3', () => {
    const deep: { name: string; children?: unknown } = { name: 'n' }
    deep.children = [deep] as unknown // never used beyond depth 3 anyway; keep shapes simple
    const raw = Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, children: [{ name: 'l2', children: [{ name: 'l3', children: [{ name: 'l4' }] }] }] }))
    const tree = buildProfileConceptTree(raw, 'analysis')
    expect(tree.length).toBe(12)
    const l3 = tree[0]!.children![0]!.children![0]!
    expect(l3.children).toBeUndefined() // depth 4 dropped
  })
})

describe('sanitizeFlow', () => {
  it('cleans a fenced mermaid answer and bounds the title', () => {
    const flow = sanitizeFlow({ title: '  主流程  ', mermaid: '```mermaid\nflowchart TD\n  a --> b\n```' }, 'event')
    expect(flow).toEqual({ title: '主流程', angle: 'event', mermaid: 'flowchart TD\n  a --> b' })
  })

  it('accepts bare flowchart source and defaults the title', () => {
    const flow = sanitizeFlow({ mermaid: 'flowchart LR\n  a --> b' }, 'pipeline')
    expect(flow!.title).toBe('核心流程')
    expect(flow!.angle).toBe('pipeline')
    expect(flow!.mermaid).toBe('flowchart LR\n  a --> b')
  })

  it('rejects anything without real flowchart source', () => {
    expect(sanitizeFlow({ title: 'x', mermaid: 'sequenceDiagram' }, 'event')).toBeUndefined()
    expect(sanitizeFlow({ title: 'x' }, 'event')).toBeUndefined()
    expect(sanitizeFlow('garbage', 'event')).toBeUndefined()
  })
})

describe('sanitizeSeqMessages', () => {
  const coreIds = ['a', 'b', 'c']

  it('drops messages whose endpoints are not core ids (cross-check)', () => {
    const messages = sanitizeSeqMessages([
      { from: 'a', to: 'b', label: '调用 b()' },
      { from: 'a', to: 'ghost', label: '调用不存在' },
      { from: 'ghost', to: 'b', label: '不存在调用' },
    ], coreIds)
    expect(messages).toEqual([{ from: 'a', to: 'b', label: '调用 b()' }])
  })

  it('drops self-loops and empty labels; caps at 16', () => {
    const raw = [
      { from: 'a', to: 'a', label: '自环' },
      { from: 'a', to: 'b', label: '   ' },
      ...Array.from({ length: 20 }, (_, i) => ({ from: 'a', to: 'b', label: `m${i}` })),
    ]
    const messages = sanitizeSeqMessages(raw, coreIds)
    expect(messages.length).toBe(16)
    expect(messages.every(m => m.from !== m.to && m.label !== '')).toBe(true)
  })
})

describe('sanitizeEvents', () => {
  it('restricts mode to the four cordis dispatch modes', () => {
    const events = sanitizeEvents([
      { event: 'e1', mode: 'waterfall', producers: ['a'], consumers: ['b'], note: 'n' },
      { event: 'e2', mode: 'invented', producers: [], consumers: [], note: '' },
    ])
    expect(events[0]!.mode).toBe('waterfall')
    expect(events[1]!.mode).toBe('emit')
  })

  it('drops nameless events and filters non-string producers/consumers', () => {
    const events = sanitizeEvents([
      { event: '  ', mode: 'emit', producers: [], consumers: [], note: '' },
      { event: 'ok', mode: 'emit', producers: ['a', 3, null], consumers: [undefined], note: 9 },
    ])
    expect(events.length).toBe(1)
    expect(events[0]!.producers).toEqual(['a'])
    expect(events[0]!.consumers).toEqual([])
  })

  it('caps at 14 events', () => {
    const events = sanitizeEvents(Array.from({ length: 20 }, (_, i) => ({ event: `e${i}`, mode: 'emit', producers: [], consumers: [], note: '' })))
    expect(events.length).toBe(14)
  })
})

describe('parseProfileObject / profileFromText', () => {
  it('extracts the outermost JSON object from prose', () => {
    const parsed = parseProfileObject('好的，结果如下：\n{"coreIds": ["a"], "conceptTree": []}\n完成。')
    expect(parsed).toEqual({ coreIds: ['a'], conceptTree: [] })
  })

  it('returns null for garbage', () => {
    expect(parseProfileObject('no json here')).toBeNull()
  })

  it('accepts only the current profile version', () => {
    const ok = profileFromText(JSON.stringify({ version: PROFILE_VERSION, generatedAt: 0, language: '中文', coreIds: ['a'] }))
    expect(ok).not.toBeNull()
    const stale = profileFromText(JSON.stringify({ version: 99, coreIds: ['a'] }))
    expect(stale).toBeNull()
    expect(profileFromText('not json')).toBeNull()
  })
})
