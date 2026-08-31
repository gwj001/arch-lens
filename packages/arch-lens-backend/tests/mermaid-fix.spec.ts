/**
 * mermaid-fix leaf: the conservative subgraph-title quoting repair born from
 * the real incident (dynamic figure `subgraph 增量IO[⚡ 变动更新 ·
 * generateAll(incremental) 输入→输出（代码实证）]` → mermaid 11 `Parse
 * error ... got 'PS'`, whole figure unrenderable). The suite pins the review
 * contract: repair ONLY the provably-safe shape, leave everything else
 * byte-identical, and stay idempotent — the validity judge is the browser's
 * mermaid, never this text pass.
 */
import { describe, expect, it } from 'vitest'
import { MERMAID_SYNTAX_RULE, quoteBareSubgraphTitles, sanitizeMermaid } from '../src/mermaid-fix.ts'

describe('quoteBareSubgraphTitles (incident repair, L2 v1)', () => {
  it('quotes the exact incident title (ASCII parens inside bare subgraph title)', () => {
    const line = '  subgraph 增量IO[⚡ 变动更新 · generateAll(incremental) 输入→输出（代码实证）]'
    expect(quoteBareSubgraphTitles(line)).toBe('  subgraph 增量IO["⚡ 变动更新 · generateAll(incremental) 输入→输出（代码实证）"]')
  })

  it('handles the space-before-bracket variant and preserves the id', () => {
    const line = 'subgraph s1 [构建(build)阶段]'
    expect(quoteBareSubgraphTitles(line)).toBe('subgraph s1 ["构建(build)阶段"]')
  })

  it('quotes nested-square-bracket titles containing parens (last-] extraction is unambiguous)', () => {
    const line = 'subgraph X[缓存[-lang](可选)]'
    expect(quoteBareSubgraphTitles(line)).toBe('subgraph X["缓存[-lang](可选)"]')
  })

  it('leaves already-quoted lines byte-identical (idempotent)', () => {
    const line = 'subgraph s1["阶段名<br/>（阶段职责）"]'
    expect(quoteBareSubgraphTitles(line)).toBe(line)
    const incident = '  subgraph 增量IO[⚡ 变动更新 · generateAll(incremental) 输入]'
    const once = quoteBareSubgraphTitles(incident)
    expect(quoteBareSubgraphTitles(once)).toBe(once)
  })

  it('skips titles carrying any quote character (rewrap would be ambiguous)', () => {
    expect(quoteBareSubgraphTitles('subgraph X[他说"生成"(done)]')).toBe('subgraph X[他说"生成"(done)]')
    expect(quoteBareSubgraphTitles("subgraph X[it's(fine)]")).toBe("subgraph X[it's(fine)]")
  })

  it('skips plain titles without ASCII parens (minimal-diff discipline)', () => {
    const line = '  subgraph s2[入口与校验]'
    expect(quoteBareSubgraphTitles(line)).toBe(line)
  })

  it('skips trailing-comment and trailing-edge lines (anchored match cannot guess)', () => {
    expect(quoteBareSubgraphTitles('subgraph X[a(b)] %% 备注')).toBe('subgraph X[a(b)] %% 备注')
    expect(quoteBareSubgraphTitles('subgraph X[a(b)] --> Y')).toBe('subgraph X[a(b)] --> Y')
  })

  it('skips id-less subgraphs (fabricating an id would rewrite edge endpoints)', () => {
    const line = 'subgraph [构建(build)阶段]'
    expect(quoteBareSubgraphTitles(line)).toBe(line)
  })

  it('never touches node-label lines, edges or other diagram types', () => {
    const source = [
      'flowchart TD',
      '  A[generateAll(incremental)] --> B',
      '  B -->|事件(evet)| C',
      '  C{"状态?"}',
    ].join('\n')
    // edge-label repair may widen the pipe label's parens, but the node label
    // and the diamond stay byte-identical:
    const out = quoteBareSubgraphTitles(source)
    expect(out).toBe(source)
  })

  it('sequenceDiagram sources are fully untouched', () => {
    const source = 'sequenceDiagram\n  A->>B: 调用 generateAll(incremental)\n  B-->>A: ok'
    expect(quoteBareSubgraphTitles(source)).toBe(source)
  })
})

describe('sanitizeMermaid (composition of both repairs)', () => {
  it('repairs edge labels AND bare subgraph titles in one pass', () => {
    const source = 'flowchart TD\n  subgraph 增量IO[变动更新 generateAll(incremental)]\n    A[x]\n  end\n  A -->|触发(emit)| B'
    const fixed = sanitizeMermaid(source)
    expect(fixed).toContain('subgraph 增量IO["变动更新 generateAll(incremental)"]')
    expect(fixed).toContain('-->|触发（emit）|')
  })

  it('is idempotent over the incident figure extract', () => {
    const source = 'flowchart TD\n  subgraph 增量IO[⚡ 变动更新 · generateAll(incremental) 输入→输出（代码实证）]\n    U2["x(a)"]\n  end\n  U2 -->|事实| U3'
    const once = sanitizeMermaid(source)
    expect(sanitizeMermaid(once)).toBe(once)
  })
})

describe('MERMAID_SYNTAX_RULE (prompt contract line)', () => {
  it('names the quoted subgraph form and the entity-escape exception', () => {
    expect(MERMAID_SYNTAX_RULE).toContain('subgraph id["标题"]')
    expect(MERMAID_SYNTAX_RULE).toContain('&lt; &gt;')
    expect(MERMAID_SYNTAX_RULE).toContain('若使用 flowchart')
  })
})
