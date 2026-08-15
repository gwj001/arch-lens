/**
 * Notes panel: read-only listing of the workspace ARCH-NOTES.md entries.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/notes-panel
 */
import { createElement as h } from 'react';
import css from './notes-panel.module.css';
/** Render the note listing, newest first. */
export function NotesPanel(props) {
    const { notes } = props;
    const rows = notes !== null && 'error' in notes === false ? notes.entries.slice(0, 30) : [];
    const path = notes !== null && 'error' in notes === false ? notes.path : 'ARCH-NOTES.md';
    return h('div', { className: css.notes }, h('div', { className: css.title }, `📓 架构笔记（${path}，回答完成后自动记录）`), notes !== null && 'error' in notes
        ? h('div', { className: css.error }, notes.error)
        : rows.length === 0
            ? h('div', { className: css.hint }, '暂无笔记——每次 AI 讲解（含回答）会自动追加到这里')
            : rows.map((row, index) => h('div', { key: index, className: css.row }, h('span', { className: css.time }, row.time), h('span', { className: css.target }, row.target), h('span', { className: css.text }, row.preview))));
}
//# sourceMappingURL=notes-panel.js.map