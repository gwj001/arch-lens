/**
 * Code-derived insights panel: services/events/tools/remotes extracted from
 * package source. Shown per package in the detail popup when code analysis is
 * enabled — the "code-first" view that never depends on documentation.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/insights-panel
 */
import { createElement as h } from 'react';
import css from './insights-panel.module.css';
/** Render one package's code-derived insights. */
export function InsightsPanel(props) {
    const { insight } = props;
    if (insight === undefined) {
        return h('div', { className: css.panel }, h('div', { className: css.title }, '🔍 代码解析（从源码提取）'), h('div', { className: css.hint }, '无解析结果'));
    }
    const rows = [];
    const add = (label, values) => {
        if (values.length === 0)
            return;
        rows.push(h('div', { key: label, className: css.row }, h('span', { className: css.kind }, label), h('span', { className: css.values }, values.join(', '))));
    };
    add('提供服务', insight.provides);
    add('监听事件', insight.listens);
    add('Remote 方法', insight.remotes);
    add('注册工具', insight.tools);
    if (rows.length === 0) {
        return h('div', { className: css.panel }, h('div', { className: css.title }, '🔍 代码解析（从源码提取）'), h('div', { className: css.hint }, '入口源码中未发现服务/事件/工具注册'));
    }
    return h('div', { className: css.panel }, h('div', { className: css.title }, '🔍 代码解析（从源码提取）'), rows);
}
//# sourceMappingURL=insights-panel.js.map