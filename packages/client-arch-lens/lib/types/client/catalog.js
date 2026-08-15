/**
 * Catalog unit: the flat `src/<pkg> # duty` listing over the scanned graph.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/catalog
 */
import { createElement as h } from 'react';
import css from './catalog.module.css';
/** Duty text for one node in the configured language. */
export function dutyText(node, language) {
    if (language === '中文' && node.blurbZh !== undefined && node.blurbZh !== '')
        return node.blurbZh;
    return node.blurb;
}
/** Render the package catalog grouped by packages/<group>. */
export function Catalog(props) {
    const { graph, onSelectPkg, language } = props;
    const byGroup = new Map();
    for (const node of graph.nodes) {
        const list = byGroup.get(node.group) ?? [];
        list.push(node);
        byGroup.set(node.group, list);
    }
    const groups = [...byGroup.keys()].sort();
    const rows = [];
    for (const group of groups) {
        rows.push(h('div', { key: `g${group}`, className: css.group }, `packages/${group}/`));
        const nodes = byGroup.get(group) ?? [];
        nodes.sort((a, b) => a.short.localeCompare(b.short));
        for (const node of nodes) {
            rows.push(h('div', { key: node.id, className: css.row, onClick: () => onSelectPkg(node.id) }, h('span', { className: css.path }, `src/${node.short}`), h('span', { className: css.sep }, '#'), h('span', { className: css.desc }, dutyText(node, language) !== '' ? dutyText(node, language) : '（无描述，点击查看详情）')));
        }
    }
    return h('div', { className: css.catalog }, rows);
}
//# sourceMappingURL=catalog.js.map