/**
 * Pure-presentation SVG graph components for the Arch Lens units. These are
 * stateless renderers: all data and callbacks arrive through props, and layout
 * is a pure function of the input.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/graphs
 */
import { createElement as h } from 'react';
import { SEQUENCE_ACTORS } from "./curated.js";
import css from './graphs.module.css';
/**
 * Collect the visible concept-tree nodes with layout coordinates.
 * @param roots - concept tree roots.
 * @param expanded - expanded node ids.
 * @param columnWidth - x step per depth.
 * @param rowHeight - y step per row.
 * @returns visible nodes and total width/height.
 */
export function layoutConceptTree(roots, expanded, columnWidth = 250, rowHeight = 46) {
    const nodes = [];
    let cursorY = 30;
    const walk = (node, depth) => {
        const open = expanded.includes(node.id);
        nodes.push({ ...node, depth, open, x: depth * columnWidth + 10, y: cursorY });
        cursorY += rowHeight;
        if (open && node.children !== undefined) {
            for (const child of node.children)
                walk(child, depth + 1);
        }
    };
    for (const root of roots)
        walk(root, 0);
    return { nodes, width: 6 * columnWidth + 20, height: cursorY + 10 };
}
/** Render the concept hierarchy as an SVG tree. */
export function ConceptGraph(props) {
    const { graph, conceptTree, expanded, selectedId, onToggle, onSelectPkg } = props;
    const { nodes, width, height } = layoutConceptTree(conceptTree, expanded);
    const links = [];
    for (const node of nodes) {
        if (node.children === undefined)
            continue;
        for (const child of node.children) {
            const childNode = nodes.find(candidate => candidate.id === child.id);
            if (childNode === undefined)
                continue;
            links.push({ x1: node.x + 110, y1: node.y + 34, x2: childNode.x + 110, y2: childNode.y });
        }
    }
    return h('div', { className: css.wrap }, h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, links.map((link, index) => h('path', {
        key: index,
        d: `M${link.x1} ${link.y1} C${link.x1} ${link.y1 + 12} ${link.x2} ${link.y2 - 12} ${link.x2} ${link.y2}`,
        className: css.edge,
    })), nodes.map(node => {
        const pkgNode = node.pkg === undefined ? undefined : graph.nodes.find(candidate => candidate.id === node.pkg);
        const hue = pkgNode === undefined ? 220 : 160;
        const open = node.children !== undefined && node.children.length > 0 && node.open;
        return h('g', {
            key: node.id,
            transform: `translate(${node.x},${node.y})`,
            className: css.nodeGroup,
            onClick: () => {
                if (pkgNode !== undefined)
                    onSelectPkg(pkgNode.id);
                else if (node.children !== undefined && node.children.length > 0)
                    onToggle(node.id);
            },
        }, h('rect', {
            width: 220,
            height: 34,
            rx: 7,
            fill: pkgNode !== undefined
                ? `hsl(${hue}, 45%, 90%)`
                : open
                    ? `hsl(${hue}, 55%, 82%)`
                    : `hsl(${hue}, 45%, 94%)`,
            stroke: selectedId === node.id ? `hsl(${hue}, 70%, 40%)` : `hsl(${hue}, 55%, 45%)`,
            strokeWidth: selectedId === node.id ? 2.5 : 1.2,
        }), h('text', { x: 8, y: 15, fontSize: 12, fontWeight: 600, fill: '#333' }, `${node.children !== undefined && node.children.length > 0 ? (open ? '▾ ' : '▸ ') : ''}${node.name}`), h('text', { x: 8, y: 29, fontSize: 10, fill: '#666' }, pkgNode !== undefined ? `${pkgNode.group}/${pkgNode.short}` : (node.desc.slice(0, 26))));
    })));
}
/** Render the producer → event → consumer interaction rows as SVG. */
export function InteractionGraph(props) {
    const { events, onSelectEvent } = props;
    const leftWidth = 110;
    const midWidth = 190;
    const rightWidth = 190;
    const rowHeight = 46;
    const width = leftWidth + midWidth + rightWidth + 30;
    const height = events.length * rowHeight + 26;
    const elements = [];
    events.forEach((event, index) => {
        const y = 18 + index * rowHeight;
        const midY = y + 16;
        elements.push(h('text', { key: `p${index}`, x: leftWidth - 8, y: midY + 4, fontSize: 11, textAnchor: 'end', fill: '#555' }, event.producers.join(', ')), h('line', { key: `l1${index}`, x1: leftWidth, y1: midY, x2: leftWidth + 12, y2: midY, stroke: '#999', strokeWidth: 1 }), h('g', { key: `m${index}`, className: css.eventGroup, onClick: () => onSelectEvent(event.event) }, h('rect', {
            x: leftWidth + 12, y, width: midWidth, height: 32, rx: 7,
            fill: 'hsl(30, 55%, 88%)', stroke: 'hsl(30, 60%, 45%)', strokeWidth: 1.2,
        }), h('text', { x: leftWidth + 20, y: y + 13, fontSize: 11, fontWeight: 600, fill: '#333' }, event.event), h('text', { x: leftWidth + 20, y: y + 26, fontSize: 9, fill: '#886' }, `mode: ${event.mode}`)), h('line', { key: `l2${index}`, x1: leftWidth + 12 + midWidth, y1: midY, x2: leftWidth + 22 + midWidth, y2: midY, stroke: '#999', strokeWidth: 1 }), h('text', { key: `c${index}`, x: leftWidth + 28 + midWidth, y: midY + 4, fontSize: 11, fill: '#555' }, event.consumers.join(', ')));
    });
    return h('div', { className: css.wrap }, h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, elements));
}
/** Render the turn flow as an SVG sequence diagram. */
export function SequenceGraph(props) {
    const { sequence } = props;
    const laneWidth = 150;
    const top = 64;
    const step = 46;
    const width = SEQUENCE_ACTORS.length * laneWidth + 20;
    const height = top + sequence.length * step + 20;
    const xOf = (name) => SEQUENCE_ACTORS.indexOf(name) * laneWidth + laneWidth / 2 + 10;
    const elements = [];
    SEQUENCE_ACTORS.forEach((actor, index) => {
        const x = xOf(actor);
        const hue = (index * 55) % 360;
        elements.push(h('rect', { key: `h${index}`, x: x - 62, y: 8, width: 124, height: 28, rx: 6, fill: `hsl(${hue}, 45%, 88%)`, stroke: `hsl(${hue}, 50%, 45%)` }), h('text', { key: `ht${index}`, x, y: 26, fontSize: 11, fontWeight: 600, textAnchor: 'middle', fill: '#333' }, actor), h('line', { key: `l${index}`, x1: x, y1: 40, x2: x, y2: height - 8, className: css.actorLane }));
    });
    sequence.forEach((message, index) => {
        const y = top + index * step;
        const x1 = xOf(message.from);
        const x2 = xOf(message.to);
        if (message.from === message.to) {
            elements.push(h('path', { key: `a${index}`, d: `M${x1} ${y} C${x1 + 34} ${y} ${x1 + 34} ${y + 16} ${x1} ${y + 16}`, fill: 'none', className: css.arrow }), h('polygon', { key: `ar${index}`, points: `${x1 - 4},${y + 16} ${x1 + 4},${y + 16} ${x1},${y + 20}`, className: css.arrowHead }), h('text', { key: `t${index}`, x: x1 + 40, y: y + 10, fontSize: 11, fill: '#445' }, message.label));
        }
        else {
            const direction = x1 < x2 ? 1 : -1;
            const endX = x2 - direction * 5;
            elements.push(h('line', { key: `a${index}`, x1, y1: y, x2: endX, y2: y, className: css.arrow }), h('polygon', { key: `ar${index}`, points: `${endX - direction * 5},${y - 4} ${endX - direction * 5},${y + 4} ${endX},${y}`, className: css.arrowHead }), h('text', { key: `t${index}`, x: direction > 0 ? x1 + 6 : x1 - message.label.length * 6.4 - 14, y: y - 5, fontSize: 11, fill: '#445' }, message.label.slice(0, 34)));
        }
    });
    return h('div', { className: css.wrap }, h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, elements));
}
//# sourceMappingURL=graphs.js.map