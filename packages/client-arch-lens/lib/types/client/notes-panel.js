/**
 * Notes panel: one summary line for the workspace ARCH-NOTES.md —
 * `笔记记录更新#N yymmdd:hh:ss` with the entry count and the last update
 * time. The full entries live in the note file; no list is shown.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/notes-panel
 */
import { createElement as h } from 'react';
import css from './notes-panel.module.css';
/** Convert `YYYY-MM-DD HH:MM[:SS]` to `yymmdd:hh:mm[:ss]`. */
export function shortTime(time) {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    if (match === null)
        return time;
    const [, year, month, day, hour, minute, second] = match;
    return `${year.slice(2)}${month}${day}:${hour}:${minute}${second !== undefined ? `:${second}` : ''}`;
}
/** Render the note summary line. */
export function NotesPanel(props) {
    const { notes } = props;
    const ok = notes !== null && 'error' in notes === false;
    const count = ok ? notes.entries.length : 0;
    const lastTime = ok && notes.entries.length > 0 ? shortTime(notes.entries[0].time) : '';
    return h('div', { className: css.notes }, notes !== null && 'error' in notes
        ? h('div', { className: css.error }, notes.error)
        : h('div', { className: css.summary }, h('span', { className: css.title }, `📓 笔记记录更新#${count}`), lastTime !== '' ? h('span', { className: css.time }, lastTime) : null, h('span', { className: css.hint }, count === 0 ? '（每次 AI 讲解后自动记录）' : '（详情见工作区 ARCH-NOTES.md）')));
}
//# sourceMappingURL=notes-panel.js.map