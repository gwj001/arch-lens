/**
 * Size-guard regression for the native tree-sitter binding: 0.21.x throws
 * `Invalid argument` on any direct `parse(string)` past 32767 characters
 * (napi conversion bug), which used to crash whole-workspace indexing the
 * moment a repo contained one large source file. parse() must transparently
 * stream such files through the read-callback and lose nothing.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/tests/parser
 */
import { describe, expect, it } from 'vitest'
import { parse } from '../src/parser.ts'
import { extractTs } from '../src/ts-adapter.ts'

const head = 'import { boot } from "./boot"\nexport function main() { return boot(value1) }\n'
const filler = Array.from(
  { length: 1500 },
  (_, i) => `const value${i} = computeThing(${i}) // 中文注释 padding line to grow the file`,
)
const tail = '\nexport function lastFn() { return tailCall(1) }\n'
const source = head + filler.join('\n') + tail

describe('parse size guard (native 32767-byte string bug)', () => {
  it('parses a source beyond the direct-parse limit with exact fidelity', () => {
    expect(source.length).toBeGreaterThan(32767)
    const tree = parse('typescript', source)
    expect(tree.rootNode.type).toBe('program')
    expect(tree.rootNode.text).toBe(source)
  })

  it('keeps small sources on the direct path', () => {
    const tree = parse('typescript', 'const a = 1\n')
    expect(tree.rootNode.type).toBe('program')
    expect(tree.rootNode.text).toBe('const a = 1\n')
  })

  it('streams python and java too', () => {
    const many = Array.from({ length: 4000 }, (_, i) => i)
    const py = 'def f():\n    return 1\n' + many.map(i => `x${i} = compute(${i})  # 注释`).join('\n')
    expect(py.length).toBeGreaterThan(32767)
    expect(parse('python', py).rootNode.text).toBe(py)
    const java = 'class A { void f() {} }\n' + many.map(i => `  // 填充行 ${i}`).join('\n')
    expect(java.length).toBeGreaterThan(32767)
    expect(parse('java', java).rootNode.text).toBe(java)
  })

  it('extracts declarations positioned past the limit', () => {
    const { entities, imports } = extractTs('src/huge.ts', source)
    expect(imports.length).toBeGreaterThanOrEqual(1)
    expect(entities.some(e => e.name === 'lastFn')).toBe(true)
    expect(entities.some(e => e.name === 'main')).toBe(true)
  })
})
