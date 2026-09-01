/**
 * Hallucination gate tests: the prose-to-facts faithfulness diff. Precision
 * over recall — every "must NOT flag" case below is as important as the
 * catches (a false positive bounces a good chapter).
 */
import { describe, it, expect } from 'vitest'
import { checkDocProse, citedPackages, formatViolations } from '../src/doc-hallucination.ts'
import type { DocGroundTruth } from '../src/doc-hallucination.ts'

const truth: DocGroundTruth = {
  packages: new Set(['gateway', 'auth-core', 'storage-driver', '@app/auth-core']),
  files: new Set(['packages/gateway/src/index.ts', 'packages/auth-core/src/token.ts']),
  edges: new Set(['gateway\0auth-core', 'gateway\0storage-driver']),
}

describe('checkDocProse (hallucination gate)', () => {
  it('faithful prose passes clean', () => {
    const text = '请求由 `gateway` 接收（入口 `packages/gateway/src/index.ts`），'
      + '再交给 `auth-core` 校验。\n\n'
      + '| 调用方 | 被调用方 | 动作 |\n| --- | --- | --- |\n| gateway | auth-core | 校验 |\n'
    expect(checkDocProse(text, truth)).toEqual([])
  })

  it('flags a fabricated scoped package', () => {
    const violations = checkDocProse('会话持久化交给 `@app/session-store`。', truth)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('package')
    expect(violations[0]?.token).toBe('@app/session-store')
  })

  it('offers the nearest real package for a misspelling', () => {
    const violations = checkDocProse('校验由 `@app/auth-crue` 完成。', truth)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.suggestion).toBe('@app/auth-core')
  })

  it('known scoped packages pass', () => {
    expect(checkDocProse('校验由 `@app/auth-core` 完成。', truth)).toEqual([])
  })

  it('flags unknown file references (backticked and bare)', () => {
    const backticked = checkDocProse('见 `packages/auth-core/src/session.ts`。', truth)
    expect(backticked).toHaveLength(1)
    expect(backticked[0]?.kind).toBe('file')
    const bare = checkDocProse('配置在 config/prod.yaml 里。', truth)
    expect(bare).toHaveLength(1)
    expect(bare[0]?.kind).toBe('file')
  })

  it('normalizes ./ prefixes and backslashes before checking', () => {
    expect(checkDocProse('入口 `./packages/gateway/src/index.ts`。', truth)).toEqual([])
    expect(checkDocProse('入口 `packages\\gateway\\src\\index.ts`。', truth)).toEqual([])
    expect(checkDocProse('入口 ./packages/gateway/src/index.ts。', truth)).toEqual([])
  })

  it('never flags bare identifiers (functions, kebab concepts)', () => {
    const text = '`runFast` 是入口函数；read-only 是设计约束；`session-store` 只是散文里的名字。'
    expect(checkDocProse(text, truth)).toEqual([])
  })

  it('skips fenced code blocks (mermaid examples carry arbitrary ids)', () => {
    const text = '```mermaid\nflowchart TD\n  A["@evil/pkg"] --> B["fake/file.ts"]\n```\n正文无引用。'
    expect(checkDocProse(text, truth)).toEqual([])
  })

  it('validates call tables: fabricated and reversed rows are caught', () => {
    const text = '| 调用方 | 被调用方 | 动作 |\n| --- | --- | --- |\n'
      + '| gateway | auth-core | 校验 |\n'
      + '| gateway | ghost-pkg | 编造 |\n'
      + '| storage-driver | gateway | 反向 |\n'
    const violations = checkDocProse(text, truth)
    expect(violations).toHaveLength(2)
    const fabricated = violations.find(v => v.token === 'gateway → ghost-pkg')
    expect(fabricated?.reason).toContain('不存在')
    const reversed = violations.find(v => v.token === 'storage-driver → gateway')
    expect(reversed?.reason).toContain('方向')
    expect(reversed?.suggestion).toBe('gateway → storage-driver')
  })

  it('ignores tables that are not call relations', () => {
    const text = '| 模块 | 说明 |\n| --- | --- |\n| ghost-pkg | 随便写的表 |\n'
    expect(checkDocProse(text, truth)).toEqual([])
  })

  it('de-duplicates identical reports', () => {
    const text = '`@app/session-store` 与 `@app/session-store` 重复出现。'
    expect(checkDocProse(text, truth)).toHaveLength(1)
  })

  it('formatViolations renders one bounded line per violation', () => {
    const violations = checkDocProse('`@app/auth-crue` 见 `fake/missing.ts`。', truth)
    const formatted = formatViolations(violations)
    expect(formatted).toContain('@app/auth-crue')
    expect(formatted).toContain('fake/missing.ts')
    expect(formatted.split('\n')).toHaveLength(violations.length)
  })
})

describe('citedPackages (deps-union defense)', () => {
  it('extracts backticked real packages (scoped and bare), ignoring fabricated tokens and paths', () => {
    const text = '由 `gateway` 接收，交给 `@app/auth-core`；`@app/session-store` 是编造的，`packages/gateway/src/index.ts` 是路径。'
    expect(citedPackages(text, truth)).toEqual(['gateway', '@app/auth-core'])
  })

  it('de-duplicates and never reads inside fenced code blocks', () => {
    const text = '正文提 `gateway`。\n\n```\n`auth-core`\n```\n\n结尾再提 `gateway`。'
    expect(citedPackages(text, truth)).toEqual(['gateway'])
  })
})
