/**
 * Generic Mermaid renderer for the Arch Lens desk: renders ANY mermaid
 * diagram (flowchart / sequence / erDiagram / classDiagram / state / …) from
 * a text source. The source can be host-generated (dependency graph, ER) or
 * pasted by the user, so the desk is not limited to hand-written SVG units.
 *
 * Dense diagrams get a pan/zoom canvas: the SVG first fits the container
 * (full view), then the wheel zooms around the cursor, dragging pans, and a
 * double click resets to the fitted view.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/mermaid-view
 */
import { createElement as h, useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import css from './mermaid-view.module.css';
/**
 * Repair mermaid syntax the LLM tends to break: half-width parentheses /
 * semicolons inside edge labels (`-->|触发(emit)|`) are rejected by the
 * flowchart grammar. Full-width forms preserve the semantics. This is a local
 * mirror of the backend's flow-angle.ts sanitizeMermaid — the client must NOT
 * import values from the backend main entry (it would pull the whole service
 * bundle into the browser module table). Applied before every render, so
 * stale/broken cached sources draw again after a plain page refresh.
 * @param source - mermaid flowchart source.
 * @returns the repaired source.
 */
const sanitizeMermaid = (source) => source.replace(/(-\.->|-->|==>)\|([^|\n]*)\|/g, (_all, arrow, label) => {
    const clean = label.replace(/[();]/g, ch => ch === '(' ? '（' : ch === ')' ? '）' : '；');
    return `${arrow}|${clean}|`;
});
// Large-repo diagrams exceed mermaid's defaults: 500 edges (dependency graph
// of 100+ packages) and 50k text chars (ER view of the same). These are
// secure configs, settable only here, never inside a diagram. useMaxWidth:false
// keeps the SVG at its natural pixel size so the zoom canvas has real content
// to scale (per-diagram config in mermaid 11).
//
// The base theme is restyled so every diagram reads cleanly on the desk:
// blue node fills with rounded corners, dark readable text (system font
// stack with CJK fallbacks), and visible edges.
mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    maxEdges: 10000,
    maxTextSize: 1000000,
    theme: 'base',
    themeVariables: {
        primaryColor: '#e8f0fe',
        primaryBorderColor: '#5b8def',
        primaryTextColor: '#1f2d3d',
        secondaryColor: '#fdf3e3',
        tertiaryColor: '#e9f7ef',
        lineColor: '#5b6b8c',
        textColor: '#1f2d3d',
        titleColor: '#1f2d3d',
        fontSize: '14px',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
        edgeLabelBackground: '#ffffff',
        clusterBkg: '#f5f8fc',
        clusterBorder: '#c8d4e8',
    },
    flowchart: { useMaxWidth: false, curve: 'basis', nodeSpacing: 42, rankSpacing: 48, padding: 12 },
    er: { useMaxWidth: false },
});
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 5;
// Rendered-SVG cache keyed by source text: the arch view remounts when the
// user switches conversation tabs, and re-running mermaid on the same source
// is wasted work — the cached SVG is reused and only explicit refreshes
// (which change the source identity) force a re-render.
const svgCache = new Map();
/** Render one mermaid diagram into an inline, pan/zoomable SVG. */
export function MermaidView(props) {
    const { source, onSelectNode, onClusterAction } = props;
    const hostRef = useRef(null);
    const svgRef = useRef(null);
    const [error, setError] = useState(null);
    const [attempt, setAttempt] = useState(0);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const [clusterBtn, setClusterBtn] = useState(null);
    const dragRef = useRef(null);
    // Unique per mount: mermaid render ids must not collide across remounts or
    // retries, otherwise mermaid can fail or hang looking up a stale node.
    const idBase = useId().replace(/[^a-zA-Z0-9-]/g, '');
    useEffect(() => {
        const host = hostRef.current;
        if (host === null)
            return;
        let alive = true;
        setError(null);
        // Last-line syntax repair: LLM-generated sources (and stale caches) may
        // carry edge labels the flowchart grammar rejects (e.g. 触发(emit)) —
        // fixing here means a page refresh alone renders them again.
        const safeSource = sanitizeMermaid(source);
        const cached = svgCache.get(safeSource);
        if (cached !== undefined) {
            host.innerHTML = cached;
            svgRef.current = host.querySelector('svg');
            return () => { alive = false; };
        }
        const run = async () => {
            try {
                const { svg } = await mermaid.render(`archLensDiagram-${idBase}-${attempt}`, safeSource);
                if (!alive)
                    return;
                host.innerHTML = svg;
                svgRef.current = host.querySelector('svg');
                svgCache.set(safeSource, svg);
            }
            catch (reason) {
                if (!alive)
                    return;
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        };
        void run();
        return () => { alive = false; };
    }, [source, idBase, attempt]);
    // Fit the freshly rendered SVG into the container: full view first.
    useEffect(() => {
        const host = hostRef.current;
        const svg = svgRef.current;
        if (host === null || svg === null)
            return;
        const vb = svg.viewBox.baseVal;
        if (vb.width <= 0 || vb.height <= 0)
            return;
        const cw = host.clientWidth;
        const ch = host.clientHeight;
        if (cw <= 0 || ch <= 0)
            return;
        const scale = Math.min(cw / vb.width, ch / vb.height, 1);
        setView({
            scale,
            x: (cw - vb.width * scale) / 2,
            y: (ch - vb.height * scale) / 2,
        });
    }, [source, attempt]);
    // Apply the pan/zoom transform to the injected SVG.
    useEffect(() => {
        const svg = svgRef.current;
        if (svg === null)
            return;
        svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
        svg.style.transformOrigin = '0 0';
    }, [view]);
    // Node/entity click delegation: flowchart nodes are g.node, ER entities are
    // g.entity; the first <text> inside is the node label (package short name).
    // Drags over a node must not count as clicks.
    useEffect(() => {
        const host = hostRef.current;
        if (host === null || onSelectNode === undefined)
            return;
        const onClick = (event) => {
            if (dragRef.current?.moved === true)
                return;
            const target = event.target;
            if (!(target instanceof Element))
                return;
            const node = target.closest('g.node, g.entity');
            if (node === null)
                return;
            const text = node.querySelector('text');
            const label = text !== null ? (text.textContent ?? '').trim() : '';
            if (label !== '')
                onSelectNode(label);
        };
        host.addEventListener('click', onClick);
        return () => { host.removeEventListener('click', onClick); };
    }, [hostRef, onSelectNode]);
    // Subgraph hover: while the pointer is over a flowchart SUBGRAPH TITLE, the
    //「🤖 动态画图」button floats above it (position from the title's bounding
    // box, already in final viewport coordinates — subtract the host rect).
    // Hovering elsewhere in the cluster (its child nodes) must not trigger it.
    useEffect(() => {
        const host = hostRef.current;
        if (host === null || onClusterAction === undefined)
            return;
        const onMove = (event) => {
            const target = event.target;
            if (!(target instanceof Element))
                return;
            const cluster = target.closest('g.cluster');
            if (cluster === null) {
                setClusterBtn(null);
                return;
            }
            const text = cluster.querySelector('text');
            if (text === null) {
                setClusterBtn(null);
                return;
            }
            const label = (text.textContent ?? '').trim();
            if (label === '') {
                setClusterBtn(null);
                return;
            }
            const textRect = text.getBoundingClientRect();
            const margin = 14;
            const overTitle = event.clientX >= textRect.left - margin && event.clientX <= textRect.right + margin
                && event.clientY >= textRect.top - margin && event.clientY <= textRect.bottom + margin;
            if (!overTitle) {
                setClusterBtn(null);
                return;
            }
            const hostRect = host.getBoundingClientRect();
            setClusterBtn({ label, x: textRect.right - hostRect.left, y: textRect.top - hostRect.top - 4 });
        };
        const onLeave = () => setClusterBtn(null);
        host.addEventListener('mousemove', onMove);
        host.addEventListener('mouseleave', onLeave);
        return () => {
            host.removeEventListener('mousemove', onMove);
            host.removeEventListener('mouseleave', onLeave);
        };
    }, [hostRef, onClusterAction]);
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
            // Keep the point under the cursor stationary: the cursor maps to the
            // same SVG coordinate before and after the scale.
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
        const svg = svgRef.current;
        if (host === null || svg === null)
            return;
        const vb = svg.viewBox.baseVal;
        if (vb.width <= 0 || vb.height <= 0)
            return;
        const scale = Math.min(host.clientWidth / vb.width, host.clientHeight / vb.height, 1);
        setView({
            scale,
            x: (host.clientWidth - vb.width * scale) / 2,
            y: (host.clientHeight - vb.height * scale) / 2,
        });
    };
    return h('div', {
        className: css.view,
        onWheel,
        onMouseDown,
        onMouseMove,
        onMouseUp: endDrag,
        onMouseLeave: endDrag,
        onDoubleClick: resetView,
    }, h('div', {
        ref: hostRef,
        className: `${css.host} ${dragRef.current?.moved === true ? css.grabbing : css.grab}`,
    }), clusterBtn !== null && onClusterAction !== undefined
        ? h('button', {
            className: css.dynBtn,
            style: { left: clusterBtn.x, top: clusterBtn.y },
            onClick: () => onClusterAction(clusterBtn.label),
        }, '🤖 动态画图')
        : null, error !== null
        ? h('div', { className: css.error }, h('div', null, `Mermaid 渲染失败：${error}`), h('button', { className: css.btn, onClick: () => setAttempt(value => value + 1) }, '↻ 重试'))
        : null);
}
//# sourceMappingURL=mermaid-view.js.map