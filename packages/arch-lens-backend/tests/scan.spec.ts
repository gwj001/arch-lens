/**
 * Unit tests for workspace scanning helpers: src-file role classification and
 * README first-paragraph extraction (both pure functions).
 */
import { describe, it, expect } from 'vitest'
import { firstParagraph, roleOf } from '../src/scan.ts'

describe('roleOf', () => {
  it('classifies entry/types/invariant/assembly/test files', () => {
    expect(roleOf('index.ts')).toBe('entry')
    expect(roleOf('index.js')).toBe('entry')
    expect(roleOf('types.ts')).toBe('types')
    expect(roleOf('invariant.ts')).toBe('invariant')
    expect(roleOf('apply.ts')).toBe('assembly')
    expect(roleOf('foo.spec.ts')).toBe('test')
    expect(roleOf('foo.e2e.ts')).toBe('test')
    expect(roleOf('analyze.ts')).toBe('')
    expect(roleOf('scan.ts')).toBe('')
    expect(roleOf('index.css')).toBe('')
  })
})

describe('firstParagraph', () => {
  it('skips headings, comments, fence markers, and language-switch rows', () => {
    const text = [
      '# Title',
      '',
      '<!-- comment -->',
      '```',
      'English | [中文](README.zh.md)',
      '',
      'First real paragraph here.',
      'Second line ignored.',
    ].join('\n')
    expect(firstParagraph(text)).toBe('First real paragraph here.')
  })

  it('returns the first non-empty line when no filtering applies', () => {
    expect(firstParagraph('直接开头的一段话')).toBe('直接开头的一段话')
  })

  it('returns empty string for empty or heading-only input', () => {
    expect(firstParagraph('')).toBe('')
    expect(firstParagraph('# 只有标题')).toBe('')
  })

  it('caps the paragraph at 220 chars', () => {
    expect(firstParagraph('x'.repeat(300))).toHaveLength(220)
  })
})
