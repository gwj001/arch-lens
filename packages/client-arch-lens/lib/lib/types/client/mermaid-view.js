/**
 * Generic Mermaid renderer for the Arch Lens desk: renders ANY mermaid
 * diagram (flowchart / sequence / erDiagram / classDiagram / state / …) from
 * a text source. The source can be host-generated (dependency graph, ER) or
 * pasted by the user, so the desk is not limited to hand-written SVG units.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/mermaid-view
 */
import { createElement as h, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import css from './mermaid-view.module.css';
mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
/** Render one mermaid diagram into an inline SVG. */
export function MermaidView(props) {
    const { source } = props;
    const hostRef = useRef(null);
    const [error, setError] = useState(null);
    const [renderKey, setRenderKey] = useState(0);
    useEffect(() => {
        const host = hostRef.current;
        if (host === null)
            return;
        let alive = true;
        setError(null);
        const run = async () => {
            try {
                const { svg } = await mermaid.render(`archLensDiagram-${renderKey}`, source);
                if (!alive)
                    return;
                host.innerHTML = svg;
            }
            catch (reason) {
                if (!alive)
                    return;
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        };
        void run();
        return () => { alive = false; };
    }, [source, renderKey]);
    return h('div', { className: css.view }, h('div', { ref: hostRef, className: css.host }), error !== null
        ? h('div', { className: css.error }, h('div', null, `Mermaid 渲染失败：${error}`), h('button', { className: css.btn, onClick: () => setRenderKey(value => value + 1) }, '↻ 重试'))
        : null);
}
//# sourceMappingURL=mermaid-view.js.map