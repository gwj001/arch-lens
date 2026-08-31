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
 * The 追问重画 tray shares the SAME chip model: its scope is the tab's current
 * figure (kind+视角+粒度) instead of a scene figureId, so the composed block
 * names that scope (「当前流程图」) where the draw panel names 图号.
 * Pure leaf (no React) so the composition is unit-testable.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/draw-selection
 */
/** Chinese element name per kind (prompt-facing; the LLM consumes this). */
export const SELECTION_KIND_LABEL = {
    node: '节点',
    edge: '边',
    subgraph: '子图',
};
/** Compact chip glyph per kind (UI-facing only). */
export const selectionGlyph = (kind) => kind === 'node' ? '⬢' : kind === 'edge' ? '⇉' : '▣';
/** Append a target, deduped by kind+label (re-clicking the same element is a
 * no-op, so the chip list never grows duplicates from fidgety clicks). */
export const withSelection = (items, target) => items.some(item => item.kind === target.kind && item.label === target.label) ? items : [...items, target];
/** Remove one target (the chip's ✕). */
export const withoutSelection = (items, target) => items.filter(item => !(item.kind === target.kind && item.label === target.label));
/**
 * The TARGET half of the final intent, as a prompt block the model reads
 * before the user's words: 「选中目标（{scope}）：- 子图「…」」. `scope` names
 * the figure the chips belong to (🎨 出图：「图号 dynamic-2」；追问重画：
 * 「当前流程图」). Empty list → empty string (a plain draw without targets
 * composes byte-identical to the old behavior).
 */
export const composeSelectionBlock = (scope, items) => items.length === 0
    ? ''
    : `选中目标（${scope}）：\n${items.map(item => `- ${SELECTION_KIND_LABEL[item.kind]}「${item.label}」`).join('\n')}\n`;
/**
 * Fallback label for a right-click on a BARE flowchart edge line (no visible
 * label under the cursor). Mermaid 11 ids edge paths as `<renderId>-L_A_B_0`
 * (browser-probed on the app's own build) — tail-anchored, with a
 * non-alphanumeric boundary char before `L_`. Endpoints containing `_` make
 * the split ambiguous → return null (NO chip; a guessed label is worse than
 * silence — the conservative-by-design rule this leaf exists to centralize).
 */
export const edgeLabelFromPathId = (id) => {
    const match = /(?:^|[^A-Za-z0-9])L_([^_]+)_([^_]+)_\d+$/.exec(id);
    return match === null ? null : `${match[1]} → ${match[2]}`;
};
//# sourceMappingURL=draw-selection.js.map