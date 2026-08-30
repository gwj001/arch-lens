/**
 * resolveDocSet — the shared doc-set resolver (whitelist + one-hop link
 * following + language-variant merge) — and its sequence-chain integration:
 * a thin hub doc that only LINKS the detail file must still land the doc
 * chain, and every logical doc must be read exactly once per language.
 * @module tests/docset
 */

import { describe, expect, it } from 'vitest'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { resolveDocSet } from '../src/concept.ts'
import { extractSequenceFromDoc } from '../src/sequence.ts'

/** Minimal fake fs over an in-memory file map (paths are display paths). */
function fakeFs(files: Record<string, string> = {}): FileSystem {
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
    listDir: async () => [],
  } as unknown as FileSystem
}

describe('resolveDocSet — link following', () => {
  it('follows one inline .md link from a hub doc and keeps hub-first order', async () => {
    const fs = fakeFs({
      'README.md': 'See [the deep dive](docs/deep-dive.md) and [setup](docs/setup.md).',
      'docs/deep-dive.md': '# deep',
      'docs/setup.md': '# setup',
    })
    expect(await resolveDocSet(fs, '/ws', 'English')).toEqual(['README.md', 'docs/deep-dive.md', 'docs/setup.md'])
  })

  it('stops at one hop: links inside followed docs are NOT expanded', async () => {
    const fs = fakeFs({
      'README.md': '[detail](docs/a.md)',
      'docs/a.md': '[deeper](docs/b.md)',
      'docs/b.md': '# never reached',
    })
    expect(await resolveDocSet(fs, '/ws', 'English')).toEqual(['README.md', 'docs/a.md'])
  })

  it('skips external schemes, anchors, images and missing targets', async () => {
    const fs = fakeFs({
      'README.md': `[x](https://example.com/a.md) [y](#top) ![i](pic.png) [z](docs/ghost.md) [ok](docs/real.md)`,
      'docs/real.md': '# real',
    })
    expect(await resolveDocSet(fs, '/ws', 'English')).toEqual(['README.md', 'docs/real.md'])
  })

  it('resolves relative targets against the LINKING doc directory', async () => {
    const fs = fakeFs({
      'docs/ARCHITECTURE.md': '[../root note](../NOTE.md) [sibling](deep/x.md)',
      'NOTE.md': '# note',
      'docs/deep/x.md': '# x',
    })
    expect(await resolveDocSet(fs, '/ws', 'English')).toEqual(['docs/ARCHITECTURE.md', 'NOTE.md', 'docs/deep/x.md'])
  })

  it('caps the logical-doc count at eight', async () => {
    const links = Array.from({ length: 12 }, (_, i) => `[d${i}](docs/d${i}.md)`).join(' ')
    const files: Record<string, string> = { 'README.md': links }
    for (let i = 0; i < 12; i += 1) files[`docs/d${i}.md`] = '# x'
    const docs = await resolveDocSet(fakeFs(files), '/ws', 'English')
    expect(docs).toHaveLength(8)
    expect(docs[0]).toBe('README.md')
  })
})

describe('resolveDocSet — language-variant merge (one read per logical doc)', () => {
  it('merges suffix variants: Chinese role reads only the .zh.md, English only the primary', async () => {
    const files = { 'docs/architecture.md': '# en', 'docs/architecture.zh.md': '# zh' }
    expect(await resolveDocSet(fakeFs(files), '/ws', '中文')).toEqual(['docs/architecture.zh.md'])
    expect(await resolveDocSet(fakeFs(files), '/ws', 'English')).toEqual(['docs/architecture.md'])
  })

  it('merges directory variants (docs/x.md vs docs/zh/x.md) reached through hub links', async () => {
    const files = {
      'README.md': '[指南](docs/zh/guide.md) [guide](docs/guide.md)',
      'docs/guide.md': '# en',
      'docs/zh/guide.md': '# zh',
    }
    expect(await resolveDocSet(fakeFs(files), '/ws', '中文')).toEqual(['README.md', 'docs/zh/guide.md'])
    expect(await resolveDocSet(fakeFs(files), '/ws', 'English')).toEqual(['README.md', 'docs/guide.md'])
  })

  it('a README language-switch row does NOT double-read: primary + .zh link collapse to one doc', async () => {
    const files = {
      'README.md': 'English | [中文](README.zh.md)',
      'README.zh.md': '[English](README.md) | 中文',
    }
    const zh = await resolveDocSet(fakeFs(files), '/ws', '中文')
    expect(zh).toEqual(['README.zh.md'])
    expect(await resolveDocSet(fakeFs(files), '/ws', 'English')).toEqual(['README.md'])
  })

  it('falls back to an existing variant when the role language has none', async () => {
    const files = { 'docs/architecture.zh.md': '# zh only' }
    expect(await resolveDocSet(fakeFs(files), '/ws', 'English')).toEqual(['docs/architecture.zh.md'])
  })
})

describe('sequence doc chain over the resolved set', () => {
  const SEQ_DOC = [
    '# 时序详解',
    '',
    '## 时序',
    '',
    '```mermaid',
    'sequenceDiagram',
    '    participant U as 用户',
    '    participant W as Web',
    '    U->>W: 提问',
    '    W->>U: 回答',
    '    U->>W: 追问',
    '    W->>U: 应答',
    '```',
  ].join('\n')

  it('lands the doc chain THROUGH a thin hub link and anchors the real file', async () => {
    const fs = fakeFs({ 'README.md': '时序详见 [时序明细](docs/sequence.md)。', 'docs/sequence.md': SEQ_DOC })
    const result = await extractSequenceFromDoc(fs, '/ws', '中文')
    expect(result).not.toBeNull()
    expect(result!.source).toBe('doc')
    expect(result!.ref).toBe('docs/sequence.md#时序')
    expect(result!.messages.length).toBeGreaterThanOrEqual(3)
  })

  it('never re-reads a language variant twice: zh role gets zh section, English gets primary', async () => {
    const en = SEQ_DOC.replace('## 时序', '## 时序').replace('提问', 'ask')
    const fs = fakeFs({
      'docs/architecture.md': en,
      'docs/architecture.zh.md': SEQ_DOC,
    })
    const zhResult = await extractSequenceFromDoc(fs, '/ws', '中文')
    expect(zhResult!.ref).toBe('docs/architecture.zh.md#时序')
    const enResult = await extractSequenceFromDoc(fs, '/ws', 'English')
    expect(enResult!.ref).toBe('docs/architecture.md#时序')
  })

  it('hub without the section still finds it in a followed doc', async () => {
    const fs = fakeFs({
      'docs/architecture.md': '# 架构\n\n概念见 [明细](concepts.md)，时序见 [明细](sequence.md)。',
      'docs/concepts.md': '# 概念\n\n无时序。',
      'docs/sequence.md': SEQ_DOC,
    })
    const result = await extractSequenceFromDoc(fs, '/ws', 'English')
    expect(result!.ref).toBe('docs/sequence.md#时序')
  })
})
