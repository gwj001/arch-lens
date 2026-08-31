/**
 * Unit tests for the draw-panel selection leaf (pure, no React): chip
 * accumulation semantics (dedupe, kind-sensitivity), the ✕ removal, and the
 * prompt-facing intent block — the 「图号+节点」 half of the final intent
 * (目标清单 + 用户语言可空 + 按钮动词).
 */
import { describe, it, expect } from 'vitest'
import {
  composeSelectionBlock,
  edgeLabelFromPathId,
  selectionGlyph,
  withSelection,
  withoutSelection,
  SELECTION_KIND_LABEL,
  type SelectionTarget,
} from '../src/client/draw-selection.ts'

const node = (label: string): SelectionTarget => ({ kind: 'node', label })
const edge = (label: string): SelectionTarget => ({ kind: 'edge', label })
const sub = (label: string): SelectionTarget => ({ kind: 'subgraph', label })

describe('withSelection — chip accumulation', () => {
  it('appends picks in click order', () => {
    let items: SelectionTarget[] = []
    items = withSelection(items, sub('落盘 · 各图独立缓存文件'))
    items = withSelection(items, node('D3'))
    expect(items.map(i => i.label)).toEqual(['落盘 · 各图独立缓存文件', 'D3'])
  })

  it('re-clicking the SAME kind+label is a no-op (fidgety clicks never duplicate)', () => {
    const once = withSelection([], node('A'))
    const twice = withSelection(once, node('A'))
    expect(twice).toBe(once) // same array identity → no re-render churn
  })

  it('same label with different kind is a distinct target (节点「A」 ≠ 边「A」)', () => {
    const items = withSelection(withSelection([], node('A')), edge('A'))
    expect(items).toHaveLength(2)
  })

  it('withoutSelection removes exactly the matched chip', () => {
    const items = [node('A'), edge('A'), node('B')]
    expect(withoutSelection(items, edge('A'))).toEqual([node('A'), node('B')])
    expect(withoutSelection(items, node('Z'))).toEqual(items)
  })
})

describe('composeSelectionBlock — the target half of the intent', () => {
  it('empty list composes to the empty string (plain draws stay byte-identical)', () => {
    expect(composeSelectionBlock('图号 dynamic-2', [])).toBe('')
  })

  it('carries the scope (scene id or 当前图) and typed labels, order preserved', () => {
    const block = composeSelectionBlock('图号 dynamic-2', [sub('落盘'), node('D3'), edge('B → C')])
    expect(block).toContain('选中目标（图号 dynamic-2）')
    expect(block).toContain(`- ${SELECTION_KIND_LABEL.subgraph}「落盘」`)
    expect(block).toContain(`- ${SELECTION_KIND_LABEL.node}「D3」`)
    expect(block).toContain(`- ${SELECTION_KIND_LABEL.edge}「B → C」`)
    expect(block.split('\n').filter(line => line.startsWith('- '))).toHaveLength(3)
  })

  it('follow-up redraw uses the tab figure as scope (当前流程图)', () => {
    expect(composeSelectionBlock('当前流程图', [node('附件持久化')])).toContain('选中目标（当前流程图）')
  })
})

describe('edgeLabelFromPathId — bare flowchart edge line fallback', () => {
  // Id shapes are BROWSER-PROBED facts of the app's mermaid 11.16.0: edge
  // paths carry `<renderId>-L_A_B_0` ids (render-id prefixed, not bare).
  it('parses render-id-prefixed edge paths', () => {
    expect(edgeLabelFromPathId('archLensDiagram-u1-L_A_B_0')).toBe('A → B')
    expect(edgeLabelFromPathId('x-L_R1_D3_12')).toBe('R1 → D3')
    expect(edgeLabelFromPathId('id-probe-L_a-b_backend_0')).toBe('a-b → backend')
  })

  it('stays SILENT on ambiguous or foreign ids (a guessed split is worse than no chip)', () => {
    expect(edgeLabelFromPathId('L_pkg_core_index_0')).toBeNull() // '_' in endpoints
    expect(edgeLabelFromPathId('SOMEL_A_B_0')).toBeNull()        // alnum glued to L_
    expect(edgeLabelFromPathId('')).toBeNull()
    expect(edgeLabelFromPathId('classField')).toBeNull()
  })
})

describe('selectionGlyph', () => {
  it('three kinds get three distinct glyphs', () => {
    expect(new Set(['node', 'edge', 'subgraph'].map(kind => selectionGlyph(kind as SelectionTarget['kind']))).size).toBe(3)
  })
})
