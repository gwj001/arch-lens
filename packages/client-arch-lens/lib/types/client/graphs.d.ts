/**
 * Pure-presentation SVG graph components for the Arch Lens units. These are
 * stateless renderers: all data and callbacks arrive through props, and layout
 * is a pure function of the input.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/graphs
 */
import type { ArchLensGraph } from '@deepseek-ai/dsh-arch-lens-backend';
import type { ConceptNode, CoreEvent, SequenceMessage } from './curated.ts';
/** One laid-out concept node. */
interface ConceptLayoutNode extends ConceptNode {
    depth: number;
    open: boolean;
    x: number;
    y: number;
}
/**
 * Build a group→package tree from the scanned graph for the lightweight
 * overview view of the dependency/ER tabs (groups as roots, packages as
 * leaves). Rendered by ConceptGraph, so the overview is always small and
 * fast even when the full mermaid diagram is huge.
 * @param graph - scanned graph.
 * @returns concept-tree roots, one per package group.
 */
export declare function buildGroupTree(graph: ArchLensGraph): ConceptNode[];
/**
 * Collect the visible concept-tree nodes with layout coordinates.
 * @param roots - concept tree roots.
 * @param expanded - expanded node ids.
 * @param columnWidth - x step per depth.
 * @param rowHeight - y step per row.
 * @returns visible nodes and total width/height.
 */
export declare function layoutConceptTree(roots: readonly ConceptNode[], expanded: readonly string[], columnWidth?: number, rowHeight?: number): {
    nodes: ConceptLayoutNode[];
    width: number;
    height: number;
};
/**
 * Concept-tree graph props.
 */
export interface ConceptGraphProps {
    graph: ArchLensGraph;
    conceptTree: readonly ConceptNode[];
    expanded: readonly string[];
    selectedId: string | null;
    onToggle: (id: string) => void;
    onSelectPkg: (id: string) => void;
    onExplainConcept?: (node: ConceptNode) => void;
}
/** Render the concept hierarchy as an SVG tree. */
export declare function ConceptGraph(props: ConceptGraphProps): React.JSX.Element;
/**
 * Interaction-graph props.
 */
export interface InteractionGraphProps {
    events: readonly CoreEvent[];
    onSelectEvent: (id: string) => void;
}
/** Render the producer → event → consumer interaction rows as SVG. */
export declare function InteractionGraph(props: InteractionGraphProps): React.JSX.Element;
/**
 * Sequence-graph props.
 */
export interface SequenceGraphProps {
    sequence: readonly SequenceMessage[];
}
/** Render the turn flow as an SVG sequence diagram. */
export declare function SequenceGraph(props: SequenceGraphProps): React.JSX.Element;
export {};
//# sourceMappingURL=graphs.d.ts.map