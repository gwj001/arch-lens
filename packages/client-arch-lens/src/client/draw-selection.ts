/**
 * Draw-panel selection model — the structured targets behind the 「🎨 动态出图」
 * intent assembly. A RIGHT-click on a rendered figure no longer injects bare
 * text into the textarea (that lost the scene, overwrote prior picks, and
 * mixed targets with the user's words); each click becomes a CHIP carrying
 * `{kind, label}`, scoped to ONE scene figureId:
 *
 *   最终意图 = 图号+节点清单(chips，可多选、✕删) + 用户语言指令(可空) + 按钮指令
 *
 * Scope discipline (user decision): NOT cross-tab, NOT cross-figureId — the
 * list belongs to the figure currently shown in the draw panel; selecting in
 * another scene replaces the list. After a successful send the list CLEARS
 * (an intent is one-shot; stale targets must not leak into the next turn).
 * Pure leaf (no React) so the composition is unit-testable.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/draw-selection
 */

/** What kind of figure element a chip refers to (right-click hit-test kind). */
export type SelectionKind = 'node' | 'edge' | 'subgraph'

/** One selected target: element kind + the VISIBLE label text. */
export interface SelectionTarget {
  kind: SelectionKind
  label: string
}

/** Chinese element name per kind (prompt-facing; the LLM consumes this). */
export const SELECTION_KIND_LABEL: Record<SelectionKind, string> = {
  node: '节点',
  edge: '边',
  subgraph: '子图',
}

/** Compact chip glyph per kind (UI-facing only). */
export const selectionGlyph = (kind: SelectionKind): string =>
  kind === 'node' ? '⬢' : kind === 'edge' ? '⇉' : '▣'

/** Append a target, deduped by kind+label (re-clicking the same element is a
 * no-op, so the chip list never grows duplicates from fidgety clicks). */
export const withSelection = (items: SelectionTarget[], target: SelectionTarget): SelectionTarget[] =>
  items.some(item => item.kind === target.kind && item.label === target.label) ? items : [...items, target]

/** Remove one target (the chip's ✕). */
export const withoutSelection = (items: SelectionTarget[], target: SelectionTarget): SelectionTarget[] =>
  items.filter(item => !(item.kind === target.kind && item.label === target.label))

/**
 * The TARGET half of the final intent, as a prompt block the model reads
 * before the user's words: 「选中目标（图号 X）：- 子图「…」」. Empty list →
 * empty string (a plain draw without targets composes byte-identical to the
 * old behavior).
 */
export const composeSelectionBlock = (figureId: string, items: SelectionTarget[]): string =>
  items.length === 0
    ? ''
    : `选中目标（图号 ${figureId}）：\n${items.map(item => `- ${SELECTION_KIND_LABEL[item.kind]}「${item.label}」`).join('\n')}\n`

/**
 * Fallback label for a right-click on a BARE flowchart edge line (no visible
 * label under the cursor). Mermaid 11 ids edge paths as `<renderId>-L_A_B_0`
 * (browser-probed on the app's own build) — tail-anchored, with a
 * non-alphanumeric boundary char before `L_`. Endpoints containing `_` make
 * the split ambiguous → return null (NO chip; a guessed label is worse than
 * silence — the conservative-by-design rule this leaf exists to centralize).
 */
export const edgeLabelFromPathId = (id: string): string | null => {
  const match = /(?:^|[^A-Za-z0-9])L_([^_]+)_([^_]+)_\d+$/.exec(id)
  return match === null ? null : `${match[1]} → ${match[2]}`
}
