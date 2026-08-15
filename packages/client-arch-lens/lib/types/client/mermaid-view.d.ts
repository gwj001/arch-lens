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
}
/** Render one mermaid diagram into an inline, pan/zoomable SVG. */
export declare function MermaidView(props: MermaidViewProps): React.JSX.Element;
//# sourceMappingURL=mermaid-view.d.ts.map