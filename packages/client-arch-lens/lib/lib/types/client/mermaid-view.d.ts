/**
 * Generic Mermaid renderer for the Arch Lens desk: renders ANY mermaid
 * diagram (flowchart / sequence / erDiagram / classDiagram / state / …) from
 * a text source. The source can be host-generated (dependency graph, ER) or
 * pasted by the user, so the desk is not limited to hand-written SVG units.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/mermaid-view
 */
/**
 * Mermaid-view props: the diagram source text.
 */
export interface MermaidViewProps {
    /** Mermaid diagram source (a full diagram, without the ```mermaid fence). */
    source: string;
}
/** Render one mermaid diagram into an inline SVG. */
export declare function MermaidView(props: MermaidViewProps): React.JSX.Element;
//# sourceMappingURL=mermaid-view.d.ts.map