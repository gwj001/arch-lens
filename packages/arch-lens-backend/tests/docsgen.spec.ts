/**
 * Unit tests for the doc-target contract: the generator ALWAYS writes
 * docs/architecture.generated.md; docs/architecture.md is the user's own
 * file and is never touched (regardless of any marker it carries).
 */
import { describe, it, expect, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-llm', () => ({ createUserMessage: () => ({}) }))
import { resolveDocTarget } from '../src/docsgen.ts'

function fakeFs(): unknown {
  return {
    resolve: async (path: string) => ({ displayPath: path }),
  }
}

describe('resolveDocTarget', () => {
  it('always returns the AI variant, never the user architecture.md', async () => {
    const target = await resolveDocTarget(fakeFs() as never, '/ws')
    expect(target).toBe('docs/architecture.generated.md')
  })

  it('does not read or stat any file (user docs are never even inspected)', async () => {
    const fs = {
      resolve: async (path: string) => ({ displayPath: path }),
      stat: vi.fn(async () => { throw new Error('resolveDocTarget must not stat') }),
      readText: vi.fn(async () => { throw new Error('resolveDocTarget must not read') }),
    }
    const target = await resolveDocTarget(fs as never, '/ws')
    expect(target).toBe('docs/architecture.generated.md')
    expect(fs.stat).not.toHaveBeenCalled()
    expect(fs.readText).not.toHaveBeenCalled()
  })
})
