/**
 * The duty-facts leaf is the single priority chain shared by the host figure
 * prompt assembly (dutyFactsForFigure) and the browser catalog (dutyText) —
 * these tests pin the chain and the LEGACY-fallback semantics: clientBlurbs
 * may fill holes, never override facts.
 */
import { describe, it, expect } from 'vitest'
import { dutyForNode, mergeDutyFacts, type DutyNodeFacts } from '../src/duty-facts.ts'

const node = (id: string, blurb = '', blurbZh?: string): DutyNodeFacts =>
  blurbZh === undefined ? { id, blurb } : { id, blurb, blurbZh }

describe('dutyForNode — the priority chain', () => {
  it('AI summary wins even when a scanned blurb exists', () => {
    expect(dutyForNode('a', node('a', 'readme text'), '中文', { a: 'AI 职责' })).toBe('AI 职责')
  })

  it('empty AI string is skipped, not served blank', () => {
    expect(dutyForNode('a', node('a', 'scanned'), '中文', { a: '' })).toBe('scanned')
  })

  it('blurbZh only participates under 中文 UI', () => {
    expect(dutyForNode('a', node('a', 'english', '中文段落'), '中文')).toBe('中文段落')
    expect(dutyForNode('a', node('a', 'english', '中文段落'), 'English')).toBe('english')
  })

  it('full absence → empty string (the prompt layer renders （无职责描述）)', () => {
    expect(dutyForNode('a', node('a', ''), 'English', null)).toBe('')
  })
})

describe('mergeDutyFacts — host assembly semantics', () => {
  it('per-package merge: covered ids get AI, uncovered ids fall to the scan chain', () => {
    const nodes = [node('a', 'desc a', '甲段'), node('b', 'desc b'), node('c', '')]
    const merged = mergeDutyFacts({ a: 'AI 甲' }, nodes, '中文')
    expect(merged).toEqual({ a: 'AI 甲', b: 'desc b', c: '' })
  })

  it('clientBlurbs only fills holes — never overrides AI or scanned text', () => {
    const nodes = [node('a', 'scan a'), node('b', '')]
    const merged = mergeDutyFacts({ a: 'AI a' }, nodes, '中文', { a: 'client a', b: 'client b' })
    expect(merged.a).toBe('AI a')
    expect(merged.b).toBe('client b') // scan side empty → legacy value fills
  })

  it('graph unreadable (no nodes) → legacy map stands in, AI still wins', () => {
    const merged = mergeDutyFacts({ a: 'AI a' }, [], 'English', { a: 'client a', b: 'client b' })
    expect(merged).toEqual({ a: 'AI a', b: 'client b' })
  })

  it('ids only the client knows stay absent (same as pre-fix bytes when graph exists)', () => {
    const merged = mergeDutyFacts(null, [node('a', 'scan a')], '中文', { ghost: 'x' })
    expect('ghost' in merged).toBe(false)
  })
})
