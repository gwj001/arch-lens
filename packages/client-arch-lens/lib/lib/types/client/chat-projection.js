/**
 * Same-page chat projection: the last few user/assistant messages of the
 * current session, read through the conversation snapshot — the UI is a pure
 * projection of the durable log, so answers appear here without switching tabs.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/chat-projection
 */
import { createElement as h } from 'react';
import css from './chat-projection.module.css';
/** Extract text rows from the conversation snapshot (last 6, newest last). */
export function projectChatRows(nodes) {
    const rows = [];
    for (const node of nodes) {
        let text = '';
        if (node.kind === 'user' || node.kind === 'steering' || node.kind === 'context') {
            text = node.content.filter(block => block.type === 'text').map(block => block.text).join('').slice(0, 240);
        }
        else if (node.kind === 'assistant') {
            text = node.blocks.filter(block => block.kind === 'text').map(block => block.text).join('').slice(0, 240);
        }
        if (text !== '') {
            rows.push({ role: node.kind === 'assistant' ? 'ai' : 'user', text });
            if (rows.length >= 6)
                break;
        }
    }
    return rows.reverse();
}
/** Render the recent conversation projection. */
export function ChatProjection(props) {
    const nodes = props.useSession(snapshot => snapshot.nodes);
    const rows = projectChatRows(nodes);
    return h('div', { className: css.chat }, h('div', { className: css.title }, '📋 最近对话（AI 回复实时显示在这里）'), rows.length === 0
        ? h('div', { className: css.hint }, '暂无消息——点「AI 讲解」后，回复会出现在这里')
        : rows.map((row, index) => h('div', {
            key: index,
            className: `${css.row} ${row.role === 'user' ? css.user : css.ai}`,
        }, h('div', { className: css.role }, row.role === 'user' ? '你' : 'AI'), h('div', { className: css.text }, row.text))));
}
//# sourceMappingURL=chat-projection.js.map