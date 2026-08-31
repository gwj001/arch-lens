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
/**
 * Mermaid-view props: the diagram source text.
 */
export interface MermaidViewProps {
    /** Mermaid diagram source (a full diagram, without the ```mermaid fence). */
    source: string;
    /** Called when the user clicks a node/entity; the node label text is passed. */
    onSelectNode?: (label: string) => void;
    /** Called when the user clicks the「🤖 动态画图」button that appears while
     * hovering a flowchart SUBGRAPH title; the subgraph label is passed. */
    onClusterAction?: (label: string) => void;
    /** Called on RIGHT-click of a node/entity/subgraph title; the element's
     * label text is passed (arch-lens sends it into the 🎨 draw input). */
    onNodeContext?: (label: string) => void;
    /** Render settled OK (fresh mermaid render or synced SVG cache hit). */
    onRendered?: () => void;
    /** Render FAILED — mermaid's own parse/render error, verbatim. The browser
     * IS the validator (the host has no DOM), so downstream gates (save
     * blocked, broken cache invalidated) consume this signal, never a
     * host-side "valid" stamp. */
    onRenderError?: (message: string) => void;
}
/** Render one mermaid diagram into an inline, pan/zoomable SVG. */
export declare function MermaidView(props: MermaidViewProps): React.JSX.Element;
//# sourceMappingURL=mermaid-view.d.ts.map