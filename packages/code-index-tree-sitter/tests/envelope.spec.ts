/**
 * Facts-version binding of the code-index disk cache (envelope.ts): a cache
 * file may only serve the exact facts version it was written against; legacy
 * unversioned files, foreign versions, wrong languages and unknown versions
 * (0) all miss so the provider rebuilds, and an unknown version can never be
 * persisted.
 */
import { describe, it, expect } from 'vitest'
import { wrapIndexEnvelope, unwrapIndexEnvelope } from '../src/envelope.ts'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'

const result: CodeIndexResult = {
  root: '/ws',
  language: 'typescript',
  packages: [{
    id: 'pkg-a',
    path: '/ws/pkg-a',
    language: 'typescript',
    deps: [],
    entities: [],
    imports: [],
    entryFiles: [],
  }],
}

describe('index cache envelope (facts-version binding)', () => {
  it('round-trips through the { v, data } envelope', () => {
    expect(unwrapIndexEnvelope(wrapIndexEnvelope(100, result), 100, 'typescript')).toEqual(result)
  })

  it('legacy unversioned file (raw index JSON) never serves → one rebuild', () => {
    expect(unwrapIndexEnvelope(JSON.stringify(result), 100, 'typescript')).toBeNull()
  })

  it('foreign facts version never serves', () => {
    expect(unwrapIndexEnvelope(wrapIndexEnvelope(99, result), 100, 'typescript')).toBeNull()
  })

  it('language mismatch never serves', () => {
    expect(unwrapIndexEnvelope(wrapIndexEnvelope(100, result), 100, 'python')).toBeNull()
  })

  it('unknown facts version never reads and can never be persisted', () => {
    expect(unwrapIndexEnvelope(wrapIndexEnvelope(100, result), 0, 'typescript')).toBeNull()
    expect(() => wrapIndexEnvelope(0, result)).toThrow(/positive facts version/)
  })

  it('corrupt file is a miss, not a crash', () => {
    expect(unwrapIndexEnvelope('{not json', 100, 'typescript')).toBeNull()
    expect(unwrapIndexEnvelope('', 100, 'typescript')).toBeNull()
  })
})
