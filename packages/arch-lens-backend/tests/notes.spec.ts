/**
 * Unit tests for the note-file logic: parsing, duplicate suppression,
 * trimming, and the single append path (with an in-memory fake fs).
 */
import { describe, it, expect } from 'vitest'
import { appendNote, isDuplicate, MAX_NOTE_ENTRIES, parseNotes, trimToLimit } from '../src/notes.ts'
import { fsTarget } from './fake-fs.ts'

/** Minimal in-memory FileSystem double for the append/write path. The append
 * path resolves SHORT names, so resolve concats the workspace root — the
 * shared FakeFs resolves full paths verbatim and is not used here. */
function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  return {
    resolve: async (name: string, opts?: { cwd?: string }) =>
      fsTarget(`${opts?.cwd ?? '.'}/${name}`),
    stat: async (target: { displayPath: string }) => {
      const text = files.get(target.displayPath)
      if (text === undefined) return undefined
      return { type: 'file', version: 'v1', size: text.length }
    },
    readText: async (target: { displayPath: string }) => files.get(target.displayPath) ?? '',
    writeText: async (target: { displayPath: string }, text: string) => { files.set(target.displayPath, text) },
  }
}

describe('parseNotes', () => {
  it('parses one entry heading and body', () => {
    const entries = parseNotes('## [2026-08-18 10:00:00] (组件 core) 问句头\n\n**问**：问句头\n\n**答**：内容\n')
    expect(entries).toHaveLength(1)
    const [time, target, rest] = entries[0]!.heading.split('|')
    expect(time).toBe('2026-08-18 10:00:00')
    expect(target).toBe('组件 core')
    expect(rest).toBe('问句头')
    expect(entries[0]!.body).toContain('**问**：问句头')
  })

  it('ignores text outside entries', () => {
    const entries = parseNotes('# 架构笔记（ARCH-NOTES）\n\n说明文字\n')
    expect(entries).toHaveLength(0)
  })

  it('parses multiple entries in order', () => {
    const entries = parseNotes('## [2026-08-18 09:00:00] (A) q1\nx\n## [2026-08-18 10:00:00] (B) q2\ny\n')
    expect(entries.map(e => e.heading.split('|')[1])).toEqual(['A', 'B'])
  })
})

describe('isDuplicate', () => {
  const text = '## [2026-08-18 10:00:00] (组件 core) 什么是 core\n\n**问**：什么是 core\n\n**答**：…\n'

  it('true when target and question head match', () => {
    expect(isDuplicate(text, '组件 core', '什么是 core')).toBe(true)
  })

  it('false when the question differs (new angle)', () => {
    expect(isDuplicate(text, '组件 core', 'core 怎么调度别人')).toBe(false)
  })

  it('false when the target differs', () => {
    expect(isDuplicate(text, '事件 agent/request', '什么是 core')).toBe(false)
  })

  it('falls back to the heading rest when no 问 body exists', () => {
    const headless = '## [2026-08-18 10:00:00] (组件 core) 老条目\n正文\n'
    expect(isDuplicate(headless, '组件 core', '老条目')).toBe(true)
    expect(isDuplicate(headless, '组件 core', '别的问句')).toBe(false)
  })
})

describe('trimToLimit', () => {
  it('returns the text unchanged within the limit', () => {
    const text = '## [2026-08-18 10:00:00] (A) q\n'
    expect(trimToLimit(text)).toBe(text)
  })

  it('keeps the header and the newest entries when over the limit', () => {
    const header = '# 架构笔记\n\n'
    let text = header
    for (let i = 1; i <= MAX_NOTE_ENTRIES + 5; i++) {
      text += `## [2026-08-18 10:${String(i % 60).padStart(2, '0')}:00] (C${i}) q${i}\n`
    }
    const trimmed = trimToLimit(text)
    expect(trimmed.startsWith(header)).toBe(true)
    const count = (trimmed.match(/^## \[/gm) ?? []).length
    expect(count).toBe(MAX_NOTE_ENTRIES)
    expect(trimmed).toContain(`C${MAX_NOTE_ENTRIES + 5}`)
    expect(trimmed).not.toContain('(C1)') // the oldest entry is dropped
    expect(trimmed).not.toContain('(C5)')
  })
})

describe('appendNote', () => {
  it('creates the file with a header when absent', async () => {
    const fs = fakeFs()
    const result = await appendNote(fs as never, '/ws', { target: '组件 core', question: '什么是 core', answer: 'core 是…' }, 'ARCH-NOTES.md')
    expect(result).toEqual({ ok: true })
    const text = await fs.readText(fsTarget('/ws/ARCH-NOTES.md'))
    expect(text.startsWith('# 架构笔记（ARCH-NOTES）')).toBe(true)
    expect(text).toContain('**问**：什么是 core')
    expect(text).toContain('**答**：core 是…')
  })

  it('appends to an existing file', async () => {
    const fs = fakeFs({ '/ws/ARCH-NOTES.md': '# 架构笔记（ARCH-NOTES）\n\n## [2026-08-18 09:00:00] (A) q1\n\n**问**：q1\n\n**答**：a1\n' })
    await appendNote(fs as never, '/ws', { target: '组件 core', question: '什么是 core', answer: 'core 是…' }, 'ARCH-NOTES.md')
    const text = await fs.readText(fsTarget('/ws/ARCH-NOTES.md'))
    expect(text).toContain('**答**：core 是…')
    expect(parseNotes(text)).toHaveLength(2)
  })

  it('skips a duplicate question (same target + head)', async () => {
    const fs = fakeFs({ '/ws/ARCH-NOTES.md': '# 架构笔记\n\n## [2026-08-18 10:00:00] (组件 core) 什么是 core\n\n**问**：什么是 core\n\n**答**：已有\n' })
    const result = await appendNote(fs as never, '/ws', { target: '组件 core', question: '什么是 core', answer: '再来一次' }, 'ARCH-NOTES.md')
    expect(result).toEqual({ ok: true, skipped: true })
    const text = await fs.readText(fsTarget('/ws/ARCH-NOTES.md'))
    expect(text).not.toContain('再来一次')
  })

  it('caps the answer at 600 chars and the question head at 100', async () => {
    const fs = fakeFs()
    const longAnswer = 'x'.repeat(900)
    const longQuestion = 'y'.repeat(150)
    await appendNote(fs as never, '/ws', { target: '组件 core', question: longQuestion, answer: longAnswer }, 'ARCH-NOTES.md')
    const text = await fs.readText(fsTarget('/ws/ARCH-NOTES.md'))
    expect(text).toContain('x'.repeat(600))
    expect(text).not.toContain('x'.repeat(601))
    expect(text).toContain('y'.repeat(100))
    expect(text).not.toContain('y'.repeat(101))
  })
})
