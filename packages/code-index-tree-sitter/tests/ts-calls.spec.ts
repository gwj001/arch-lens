/**
 * Unit tests for the tree-sitter TypeScript call-edge extraction: every
 * call_expression inside a function/class body, globals skipped, caller
 * context attached.
 */
import { describe, it, expect } from 'vitest'
import { extractTs } from '../src/ts-adapter.ts'

describe('extractTs calls', () => {
  it('extracts cross-module call edges with the enclosing function as caller', () => {
    const source = [
      "import { indexWorkspace } from '@deepseek-ai/dsh-code-index'",
      'export function run(root: string) {',
      '  indexWorkspace(root)',
      '  console.log("done")',
      '}',
    ].join('\n')
    const { calls } = extractTs('src/index.ts', source)
    expect(calls).toContainEqual({ fromFile: 'src/index.ts', from: 'run', to: 'indexWorkspace', line: 3 })
    expect(calls.some(edge => edge.to === 'console')).toBe(false)
  })

  it('tags calls inside class methods with the method name', () => {
    const source = [
      'class Worker {',
      '  start() {',
      '    this.poll()',
      '    externalCall()',
      '  }',
      '}',
    ].join('\n')
    const { calls } = extractTs('src/worker.ts', source)
    expect(calls).toContainEqual({ fromFile: 'src/worker.ts', from: 'start', to: 'poll', line: 3 })
    expect(calls).toContainEqual({ fromFile: 'src/worker.ts', from: 'start', to: 'externalCall', line: 4 })
  })

  it('skips stdlib/global noise', () => {
    const source = [
      'export function noise() {',
      '  setTimeout(() => JSON.stringify({}), 0)',
      '  Math.max(1, 2)',
      '  Promise.resolve()',
      '}',
    ].join('\n')
    const { calls } = extractTs('src/noise.ts', source)
    expect(calls).toEqual([])
  })

  it('resolves member chains to the rightmost symbol (a.b.run → run)', () => {
    const source = [
      'import * as svc from "./svc"',
      'export function go() {',
      '  svc.inner.launch()',
      '}',
    ].join('\n')
    const { calls } = extractTs('src/go.ts', source)
    expect(calls).toContainEqual({ fromFile: 'src/go.ts', from: 'go', to: 'launch', line: 3 })
  })

  it('stays bounded per file', () => {
    const lines = ['export function big() {']
    for (let i = 0; i < 300; i += 1) lines.push(`  dep${i}()`)
    lines.push('}')
    const { calls } = extractTs('src/big.ts', lines.join('\n'))
    expect(calls.length).toBeLessThanOrEqual(200)
  })
})
