/**
 * Pure-presentation SVG graph components for the Arch Lens units. These are
 * stateless renderers: all data and callbacks arrive through props, and layout
 * is a pure function of the input.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/graphs
 */
import { createElement as h, useEffect, useRef, useState } from 'react';
import css from './graphs.module.css';
/**
 * Display label for a package group. `''` means a flat `packages/<pkg>`
 * layout (the node has no group directory); render it as `packages` so
 * overview entities never carry an empty label.
 * @param group - the node's group name ('' for flat layouts).
 * @returns the display label.
 */
function groupLabel(group) {
    return group === '' ? 'packages' : group;
}
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 5;
/**
 * Wrap an SVG graph in a pan/zoom canvas: wheel zooms around the cursor,
 * drag pans, double click resets to fit. The viewport clips (no scrollbars)
 * and fits the diagram on first layout.
 */
function PanZoom(props) {
    const { width, height, children } = props;
    const hostRef = useRef(null);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const dragRef = useRef(null);
    // Fit the diagram into the viewport (full view first, no zoom-in by default).
    useEffect(() => {
        const host = hostRef.current;
        if (host === null)
            return;
        const cw = host.clientWidth;
        const ch = host.clientHeight;
        if (cw <= 0 || ch <= 0 || width <= 0 || height <= 0)
            return;
        const scale = Math.min(cw / width, ch / height, 1);
        setView({ scale, x: (cw - width * scale) / 2, y: (ch - height * scale) / 2 });
    }, [width, height]);
    const onWheel = (event) => {
        const host = hostRef.current;
        if (host === null)
            return;
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        const rect = host.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        setView(previous => {
            const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous.scale * factor));
            // Keep the point under the cursor stationary.
            const sx = (mx - previous.x) / previous.scale;
            const sy = (my - previous.y) / previous.scale;
            return { scale, x: mx - sx * scale, y: my - sy * scale };
        });
    };
    const onMouseDown = (event) => {
        dragRef.current = { startX: event.clientX, startY: event.clientY, origX: view.x, origY: view.y, moved: false };
    };
    const onMouseMove = (event) => {
        const drag = dragRef.current;
        if (drag === null)
            return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD)
            drag.moved = true;
        if (drag.moved)
            setView({ scale: view.scale, x: drag.origX + dx, y: drag.origY + dy });
    };
    const endDrag = () => { dragRef.current = null; };
    const resetView = () => {
        const host = hostRef.current;
        if (host === null)
            return;
        const cw = host.clientWidth;
        const ch = host.clientHeight;
        if (cw <= 0 || ch <= 0)
            return;
        const scale = Math.min(cw / width, ch / height, 1);
        setView({ scale, x: (cw - width * scale) / 2, y: (ch - height * scale) / 2 });
    };
    // A real drag must not reach the node click handlers.
    const onClickCapture = (event) => {
        if (dragRef.current?.moved === true) {
            event.stopPropagation();
            event.preventDefault();
            dragRef.current = null;
        }
    };
    return h('div', {
        ref: hostRef,
        className: css.panzoom,
        onWheel,
        onMouseDown,
        onMouseMove,
        onMouseUp: endDrag,
        onMouseLeave: endDrag,
        onDoubleClick: resetView,
        onClickCapture,
    }, h('div', {
        className: css.canvas,
        style: { width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` },
    }, children));
}
/**
 * Build a group→package tree from the scanned graph for the lightweight
 * overview view of the dependency/ER tabs (groups as roots, packages as
 * leaves). Rendered by ConceptGraph, so the overview is always small and
 * fast even when the full mermaid diagram is huge.
 * @param graph - scanned graph.
 * @returns concept-tree roots, one per package group.
 */
export function buildGroupTree(graph) {
    const byGroup = new Map();
    for (const node of graph.nodes) {
        const list = byGroup.get(node.group) ?? [];
        list.push(node);
        byGroup.set(node.group, list);
    }
    const roots = [];
    for (const group of [...byGroup.keys()].sort()) {
        const pkgs = byGroup.get(group) ?? [];
        roots.push({
            id: `g:${group}`,
            name: groupLabel(group),
            desc: `${pkgs.length} 个包`,
            children: pkgs.map(pkg => ({
                id: `g:${group}:${pkg.id}`,
                name: pkg.short,
                desc: pkg.blurb.slice(0, 34),
                pkg: pkg.id,
            })),
        });
    }
    return roots;
}
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
    const { graph, conceptTree, expanded, selectedId, onToggle, onSelectPkg, onExplainConcept, onAsk } = props;
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
    return h(PanZoom, { width, height }, h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, links.map((link, index) => h('path', {
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
                // Expandable nodes (entity-tree packages with children) toggle
                // first; leaf package nodes open the detail popup.
                if (node.children !== undefined && node.children.length > 0)
                    onToggle(node.id);
                else if (pkgNode !== undefined)
                    onSelectPkg(pkgNode.id);
            },
            onContextMenu: (event) => {
                if (onAsk === undefined)
                    return;
                event.preventDefault();
                event.stopPropagation();
                onAsk(pkgNode !== undefined ? `组件 ${pkgNode.short}` : `概念 ${node.name}`);
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
        }), h('text', { x: 8, y: 15, fontSize: 12, fontWeight: 600, fill: '#333' }, `${node.children !== undefined && node.children.length > 0 ? (open ? '▾ ' : '▸ ') : ''}${node.name}`), h('text', { x: 8, y: 29, fontSize: 10, fill: '#666' }, pkgNode !== undefined ? `${pkgNode.group}/${pkgNode.short}` : (node.desc.slice(0, 26))), 
        // Package nodes open the detail popup instead; only pure concept
        // nodes get the explain button.
        onExplainConcept !== undefined && pkgNode === undefined
            ? h('text', {
                x: 204, y: 22, fontSize: 12, textAnchor: 'end', cursor: 'pointer',
                onClick: (event) => {
                    event.stopPropagation();
                    onExplainConcept(node);
                },
            }, '🤖')
            : null);
    })));
}
/** Render the producer → event → consumer interaction rows as SVG, with the
 * 中文 note（LLM 一句话概要）as its own rightmost column. */
export function InteractionGraph(props) {
    const { events, onSelectEvent, onAsk } = props;
    const ask = (label) => (event) => {
        if (onAsk === undefined)
            return;
        event.preventDefault();
        event.stopPropagation();
        onAsk(label);
    };
    // Approximate rendered text width (11px font): ASCII ≈ 6.2px, CJK ≈ 11.5px.
    const textWidth = (text) => {
        let width = 0;
        for (const ch of text)
            width += ch.charCodeAt(0) < 128 ? 6.2 : 11.5;
        return width;
    };
    // Truncate with an ellipsis so long producers/consumers/notes never spill
    // into the neighboring column or outside the viewport.
    const truncate = (text, maxPx) => {
        if (textWidth(text) <= maxPx)
            return text;
        let out = '';
        for (const ch of text) {
            if (textWidth(out + ch) > maxPx - 12)
                break;
            out += ch;
        }
        return `${out}…`;
    };
    const producerTexts = events.map(event => event.producers.join(', '));
    const consumerTexts = events.map(event => event.consumers.join(', '));
    const noteTexts = events.map(event => event.note.trim());
    // Column widths follow the content (bounded so dense rows stay visible).
    // The bounds are generous: method-level rows carry long real call labels
    // (e.g. `Svc.handle（api.ts:41）`), and every cell also exposes the full
    // text via an SVG <title> hover tooltip.
    const maxOf = (items) => items.length > 0 ? Math.max(...items.map(textWidth)) : 0;
    const leftWidth = Math.min(480, Math.max(110, Math.ceil(maxOf(producerTexts) + 18)));
    const rightWidth = Math.min(560, Math.max(190, Math.ceil(maxOf(consumerTexts) + 18)));
    const noteWidth = Math.min(600, Math.max(130, Math.ceil(maxOf(noteTexts) + 18)));
    const midWidth = 260;
    const rowHeight = 48;
    const width = leftWidth + midWidth + rightWidth + noteWidth + 34;
    const height = events.length * rowHeight + 26;
    const elements = [];
    events.forEach((event, index) => {
        const y = 18 + index * rowHeight;
        const midY = y + 16;
        const producerText = producerTexts[index] ?? '';
        const consumerText = consumerTexts[index] ?? '';
        const note = noteTexts[index] ?? '';
        const noteX = leftWidth + midWidth + rightWidth + 26;
        // 「消费结果」段高亮：note 若含该标记（核心事件流的生成提示词要求），
        // 标记后的部分加粗深绿渲染，让「谁生产→谁消费→消费结果」三要素一目了然；
        // 两段按比例各自截断，避免拼接溢出列宽。
        const markIdx = note.indexOf('消费结果');
        const hasMark = markIdx >= 0;
        const noteMax = noteWidth - 18;
        let noteHead = note;
        let noteTail = '';
        if (hasMark) {
            noteHead = note.slice(0, markIdx).trim();
            noteTail = note.slice(markIdx).trim();
            const headMax = Math.floor(noteMax * 0.55);
            const tailMax = noteMax - Math.min(textWidth(noteHead), headMax);
            noteHead = truncate(noteHead, headMax);
            noteTail = truncate(noteTail, tailMax);
        }
        else {
            noteHead = truncate(note, noteMax);
        }
        elements.push(h('text', {
            key: `p${index}`, x: leftWidth - 8, y: midY + 4, fontSize: 11, textAnchor: 'end', fill: '#555',
            onContextMenu: ask(`组件 ${producerText}`),
        }, h('title', null, producerText), truncate(producerText, leftWidth - 18)), h('line', { key: `l1${index}`, x1: leftWidth, y1: midY, x2: leftWidth + 12, y2: midY, stroke: '#999', strokeWidth: 1 }), h('g', { key: `m${index}`, className: css.eventGroup, onClick: () => onSelectEvent(event.event), onContextMenu: ask(`事件 ${event.event}`) }, h('rect', {
            x: leftWidth + 12, y, width: midWidth, height: 32, rx: 7,
            fill: 'hsl(30, 55%, 88%)', stroke: 'hsl(30, 60%, 45%)', strokeWidth: 1.2,
        }), h('text', { x: leftWidth + 20, y: y + 13, fontSize: 11, fontWeight: 600, fill: '#333' }, h('title', null, event.event), truncate(event.event, midWidth - 30)), h('text', { x: leftWidth + 20, y: y + 26, fontSize: 9, fill: '#886' }, `mode: ${event.mode}`)), h('line', { key: `l2${index}`, x1: leftWidth + 12 + midWidth, y1: midY, x2: leftWidth + 22 + midWidth, y2: midY, stroke: '#999', strokeWidth: 1 }), h('text', { key: `c${index}`, x: leftWidth + 28 + midWidth, y: midY + 4, fontSize: 11, fill: '#555', onContextMenu: ask(`组件 ${consumerText}`) }, h('title', null, consumerText), truncate(consumerText, rightWidth - 20)), h('text', {
            key: `n${index}`, x: noteX, y: midY + 4, fontSize: 11, fill: '#4a6741',
        }, h('title', null, note), noteHead, hasMark ? h('tspan', { fontWeight: 700, fill: '#2e7d32' }, noteTail) : null));
    });
    return h(PanZoom, { width, height }, h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, elements));
}
/** Role accent hue: entry = green, hub = orange, leaf = blue-gray. */
const ROLE_HUE = { entry: 140, hub: 30, leaf: 220 };
/** Render the package call graph as an SVG: one lane per package, one
 * arrow per call edge. NOT a temporal sequence — lanes derive from first
 * appearance in the message data (traversal order for the code source). */
export function SequenceGraph(props) {
    const { result, onDynamicRequest, onAsk } = props;
    const [hovered, setHovered] = useState(null);
    const sequence = result.messages;
    const nodeById = new Map();
    for (const node of result.nodes ?? [])
        nodeById.set(node.id, node);
    /** 右键上下文：preventDefault + 把 label 交给调用方。 */
    const ask = (label) => (event) => {
        if (onAsk === undefined)
            return;
        event.preventDefault();
        event.stopPropagation();
        onAsk(label);
    };
    // Lanes are derived from the message data (static call graph / doc section
    // / AI structured cache), keeping first-appearance order; there is no
    // curated participant list.
    const actors = [];
    for (const message of sequence) {
        if (!actors.includes(message.from))
            actors.push(message.from);
        if (!actors.includes(message.to))
            actors.push(message.to);
    }
    const laneWidth = 150;
    const top = 64;
    const step = 46;
    const width = actors.length * laneWidth + 20;
    const height = top + sequence.length * step + 20;
    const xOf = (name) => actors.indexOf(name) * laneWidth + laneWidth / 2 + 10;
    const elements = [];
    actors.forEach((actor, index) => {
        const x = xOf(actor);
        const node = nodeById.get(actor);
        const role = node?.role ?? 'leaf';
        const hue = ROLE_HUE[role];
        elements.push(h('rect', {
            key: `h${index}`, x: x - 62, y: 8, width: 124, height: 28, rx: 6,
            fill: `hsl(${hue}, 45%, 88%)`, stroke: `hsl(${hue}, 50%, 45%)`,
            title: node === undefined ? actor : `${actor}（${node.path}）：被 ${node.citedBy} 调用 · 调用 ${node.cites}`,
            onContextMenu: ask(`组件 ${actor}`),
        }), h('text', { key: `ht${index}`, x, y: 26, fontSize: 11, fontWeight: 600, textAnchor: 'middle', fill: '#333', onContextMenu: ask(`组件 ${actor}`) }, actor), h('line', { key: `l${index}`, x1: x, y1: 44, x2: x, y2: height - 8, className: css.actorLane }));
    });
    sequence.forEach((message, index) => {
        const y = top + index * step;
        const x1 = xOf(message.from);
        const x2 = xOf(message.to);
        const onEnter = () => setHovered(index);
        const onLeave = () => setHovered(previous => (previous === index ? null : previous));
        if (message.from === message.to) {
            elements.push(h('path', { key: `a${index}`, d: `M${x1} ${y} C${x1 + 34} ${y} ${x1 + 34} ${y + 16} ${x1} ${y + 16}`, fill: 'none', className: css.arrow, onMouseEnter: onEnter, onMouseLeave: onLeave, onContextMenu: ask(`时序消息 ${message.from} → ${message.to}（${message.label}）`) }), h('polygon', { key: `ar${index}`, points: `${x1 - 4},${y + 16} ${x1 + 4},${y + 16} ${x1},${y + 20}`, className: css.arrowHead, onContextMenu: ask(`时序消息 ${message.from} → ${message.to}（${message.label}）`) }), h('text', { key: `t${index}`, x: x1 + 40, y: y + 10, fontSize: 11, fill: '#445', onMouseEnter: onEnter, onMouseLeave: onLeave, onContextMenu: ask(`时序消息 ${message.from} → ${message.to}（${message.label}）`) }, message.label));
        }
        else {
            const direction = x1 < x2 ? 1 : -1;
            const endX = x2 - direction * 5;
            const msgAsk = ask(`时序消息 ${message.from} → ${message.to}（${message.label}）`);
            elements.push(h('line', { key: `a${index}`, x1, y1: y, x2: endX, y2: y, className: css.arrow, onMouseEnter: onEnter, onMouseLeave: onLeave, onContextMenu: msgAsk }), h('polygon', { key: `ar${index}`, points: `${endX - direction * 5},${y - 4} ${endX - direction * 5},${y + 4} ${endX},${y}`, className: css.arrowHead, onContextMenu: msgAsk }), h('text', { key: `t${index}`, x: direction > 0 ? x1 + 6 : x1 - message.label.length * 6.4 - 14, y: y - 5, fontSize: 11, fill: '#445', onMouseEnter: onEnter, onMouseLeave: onLeave, onContextMenu: msgAsk }, message.label.slice(0, 34)));
        }
        // 「🤖 动态画图」: revealed while hovering this edge, above its label.
        if (hovered === index && onDynamicRequest !== undefined) {
            elements.push(h('text', {
                key: `dy${index}`,
                x: (x1 + x2) / 2,
                y: y - (message.from === message.to ? 2 : 14),
                fontSize: 12,
                fontWeight: 600,
                textAnchor: 'middle',
                fill: '#3f6fd8',
                cursor: 'pointer',
                style: { userSelect: 'none' },
                onClick: () => onDynamicRequest({ from: message.from, to: message.to, label: message.label }),
                onMouseEnter: onEnter,
                onMouseLeave: onLeave,
            }, '🤖 动态画图'));
        }
    });
    return h(PanZoom, { width, height }, h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, elements));
}
/**
 * 「调用关系图」: static call-graph view of the SAME sequence cache — every
 * message (from → to) is one static call edge; duplicate pairs are merged.
 * Roles are derived HERE from the message degrees (the cache stores messages
 * only, no node metadata): citedBy ≥ 2 → hub (shared service); cited by
 * nobody and citing ≥ 2 → entry; else leaf. Nodes are laid out in three role
 * columns; a column that grows beyond 5 rows wraps to a second x offset so
 * nodes never overlap. Edge labels shift right on near-vertical edges so they
 * never cover nodes. Interaction is identical to SequenceGraph (hover an edge
 * → 🤖 动态画图; right-click → ask).
 */
export function CallGraphView(props) {
    const { result, onDynamicRequest, onAsk } = props;
    const [hovered, setHovered] = useState(null);
    const sequence = result.messages;
    const ask = (label) => (event) => {
        if (onAsk === undefined)
            return;
        event.preventDefault();
        event.stopPropagation();
        onAsk(label);
    };
    // Actors = packages that appear in any call edge, in first-appearance order.
    const actors = [];
    for (const message of sequence) {
        if (!actors.includes(message.from))
            actors.push(message.from);
        if (!actors.includes(message.to))
            actors.push(message.to);
    }
    // Degrees + roles from the messages themselves (matches backend rules:
    // hub = cited by ≥ 2, entry = cited by none and citing ≥ 2, else leaf).
    const inDeg = new Map();
    const outDeg = new Map();
    for (const message of sequence) {
        inDeg.set(message.to, (inDeg.get(message.to) ?? 0) + 1);
        outDeg.set(message.from, (outDeg.get(message.from) ?? 0) + 1);
    }
    const roleOf = (actor) => {
        const citedBy = inDeg.get(actor) ?? 0;
        const cites = outDeg.get(actor) ?? 0;
        return citedBy >= 2 ? 'hub' : citedBy === 0 && cites >= 2 ? 'entry' : 'leaf';
    };
    // Unique static edges (from→to merged, first label kept).
    const edgeKey = (message) => `${message.from}\u0000${message.to}`;
    const edges = [];
    const edgeSeen = new Set();
    for (const message of sequence) {
        const key = edgeKey(message);
        if (edgeSeen.has(key))
            continue;
        edgeSeen.add(key);
        edges.push({ from: message.from, to: message.to, label: message.label });
    }
    // Layout: ring for ≤ 8 actors (chords connect rim to rim and never cross
    // other nodes — the earlier single-role column made same-column edges run
    // straight through intermediate nodes, which looked like a mess); grid
    // layout beyond that. Roles stay visible via node colour + the legend.
    const nodeCount = actors.length;
    const ringLayout = nodeCount <= 8;
    let ringCx = 340;
    let ringCy = 190;
    let pos = {};
    let width;
    let height;
    if (ringLayout) {
        const R = 150;
        actors.forEach((actor, index) => {
            const angle = -Math.PI / 2 + (index * 2 * Math.PI) / nodeCount;
            pos[actor] = { x: ringCx + R * Math.cos(angle), y: ringCy + R * Math.sin(angle) };
        });
        width = (ringCx + R + 80) * 2;
        height = (ringCy + R + 70) * 2;
    }
    else {
        const cols = Math.ceil(Math.sqrt(nodeCount));
        actors.forEach((actor, index) => {
            pos[actor] = { x: 90 + (index % cols) * 180, y: 70 + Math.floor(index / cols) * 110 };
        });
        width = 90 + cols * 180;
        height = 90 + Math.ceil(nodeCount / cols) * 110;
    }
    const elements = [];
    // Legend (bottom): role colours + labels.
    const legend = [
        { role: 'entry', label: '入口（调用方）' },
        { role: 'hub', label: '共享服务（被调用）' },
        { role: 'leaf', label: '其他' },
    ];
    legend.forEach((item, index) => {
        const x = 30 + index * 230;
        const y = height - 30;
        elements.push(h('rect', { key: `lg${index}`, x, y: y - 10, width: 16, height: 16, rx: 3, fill: `hsl(${ROLE_HUE[item.role]}, 45%, 88%)`, stroke: `hsl(${ROLE_HUE[item.role]}, 50%, 45%)` }), h('text', { key: `lgt${index}`, x: x + 22, y, fontSize: 11, fill: '#667' }, item.label));
    });
    // Nodes.
    actors.forEach((actor, index) => {
        // 上方布局循环为每个 actor 都写入过坐标（环/网格两分支之一），读取恒存在。
        const { x, y } = pos[actor];
        const role = roleOf(actor);
        const hue = ROLE_HUE[role];
        const citedBy = inDeg.get(actor) ?? 0;
        const cites = outDeg.get(actor) ?? 0;
        elements.push(h('rect', {
            key: `n${index}`, x: x - 62, y: y - 14, width: 124, height: 28, rx: 6,
            fill: `hsl(${hue}, 45%, 88%)`, stroke: `hsl(${hue}, 50%, 45%)`,
            title: `${actor}：被 ${citedBy} 个包调用 · 调用 ${cites} 个包`,
            onContextMenu: ask(`组件 ${actor}`),
        }), h('text', { key: `nt${index}`, x, y: y + 4, fontSize: 11, fontWeight: 600, textAnchor: 'middle', fill: '#333', onContextMenu: ask(`组件 ${actor}`) }, actor));
    });
    // Edges (arrow from caller to callee).
    edges.forEach((edge, index) => {
        const a = pos[edge.from];
        const b = pos[edge.to];
        if (a === undefined || b === undefined)
            return;
        const onEnter = () => setHovered(index);
        const onLeave = () => setHovered(previous => (previous === index ? null : previous));
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const ux = dx / len;
        const uy = dy / len;
        // Stop the arrow 34px short of the target so it doesn't cover the node.
        const endX = b.x - ux * 34;
        const endY = b.y - uy * 34;
        const startX = a.x + ux * 34;
        const startY = a.y + uy * 34;
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        // Edge label placement. Ring layout: 30% along the chord, pushed 14px
        // away from the ring centre so labels leave the chord-crossing area
        // (labels used to pile up near the middle of the ring). Grid layout:
        // midpoint; near-vertical edges put the label to the right.
        let labelX;
        let labelY;
        let anchor = 'middle';
        if (ringLayout) {
            const tLabel = 0.3;
            let lx = a.x + (b.x - a.x) * tLabel;
            let ly = a.y + (b.y - a.y) * tLabel;
            const rdx = lx - ringCx;
            const rdy = ly - ringCy;
            const rl = Math.max(Math.sqrt(rdx * rdx + rdy * rdy), 1);
            labelX = lx + (rdx / rl) * 14;
            labelY = ly + (rdy / rl) * 14;
        }
        else {
            const vertical = Math.abs(dx) < 40;
            labelX = vertical ? midX + 18 : midX;
            labelY = vertical ? midY : midY - 5;
            anchor = vertical ? 'start' : 'middle';
        }
        const edgeAsk = ask(`调用 ${edge.from} → ${edge.to}（${edge.label}）`);
        elements.push(h('line', { key: `e${index}`, x1: startX, y1: startY, x2: endX, y2: endY, className: css.arrow, onMouseEnter: onEnter, onMouseLeave: onLeave, onContextMenu: edgeAsk }), h('polygon', { key: `eh${index}`, points: `${endX - ux * 9 - uy * 5},${endY - uy * 9 + ux * 5} ${endX - ux * 9 + uy * 5},${endY - uy * 9 - ux * 5} ${endX},${endY}`, className: css.arrowHead, onContextMenu: edgeAsk }), h('text', {
            key: `et${index}`, x: labelX, y: labelY,
            fontSize: 10, fill: '#445', textAnchor: anchor,
            style: { paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: 3 },
            onMouseEnter: onEnter, onMouseLeave: onLeave, onContextMenu: edgeAsk,
        }, edge.label.slice(0, 26)), 
        // 「🤖 动态画图」: revealed while hovering this edge, above its label.
        hovered === index && onDynamicRequest !== undefined
            ? h('text', {
                key: `dy${index}`,
                x: labelX, y: labelY - 15,
                fontSize: 12, fontWeight: 600, textAnchor: anchor, fill: '#3f6fd8',
                cursor: 'pointer', style: { userSelect: 'none' },
                onClick: () => onDynamicRequest({ from: edge.from, to: edge.to, label: edge.label }),
                onMouseEnter: onEnter, onMouseLeave: onLeave,
            }, '🤖 动态画图')
            : null);
    });
    return h(PanZoom, { width, height }, h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, elements));
}
//# sourceMappingURL=graphs.js.map