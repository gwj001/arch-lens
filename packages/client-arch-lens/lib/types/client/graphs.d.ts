/**
 * Pure-presentation SVG graph components for the Arch Lens units. These are
 * stateless renderers: all data and callbacks arrive through props, and layout
 * is a pure function of the input.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/graphs
 */
import type { ArchLensGraph, ArchLensSequenceResult } from '@deepseek-ai/dsh-arch-lens-backend';
import type { ConceptNode, CoreEvent } from './arch-view.tsx';
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
    /** RIGHT-click a node → send its label to the 🎨 draw input (追问/重画). */
    onAsk?: (label: string) => void;
}
/** Render the concept hierarchy as an SVG tree. */
export declare function ConceptGraph(props: ConceptGraphProps): React.JSX.Element;
/**
 * Interaction-graph props.
 */
export interface InteractionGraphProps {
    events: readonly CoreEvent[];
    onSelectEvent: (id: string) => void;
    /** RIGHT-click an event/producer/consumer → send its label to 🎨 draw input. */
    onAsk?: (label: string) => void;
}
/** Render the producer → event → consumer interaction rows as SVG, with the
 * 中文 note（LLM 一句话概要）as its own rightmost column. */
export declare function InteractionGraph(props: InteractionGraphProps): React.JSX.Element;
/**
 * Call-graph props: the resolved figure (source + messages + optional node
 * roles). The provenance badge is rendered by the caller; this unit draws
 * the SVG. When node roles are present, lanes are colored by role
 * (entry / hub / leaf) so learners see the architecture shape at a glance.
 */
export interface SequenceGraphProps {
    result: ArchLensSequenceResult;
    /** Role label language ('English' → English role names, else Chinese). */
    language?: string;
    /** When set, hovering a message edge reveals a「🤖 动态画图」button that
     * calls this with the hovered message (drill-down generation). */
    onDynamicRequest?: (message: {
        from: string;
        to: string;
        label: string;
    }) => void;
    /** 右键参与者/消息 → 把上下文传给调用方（原地追问重画）。 */
    onAsk?: (label: string) => void;
}
/** Render the package call graph as an SVG: one lane per package, one
 * arrow per call edge. NOT a temporal sequence — lanes derive from first
 * appearance in the message data (traversal order for the code source). */
export declare function SequenceGraph(props: SequenceGraphProps): React.JSX.Element;
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
export declare function CallGraphView(props: SequenceGraphProps): React.JSX.Element;
export {};
//# sourceMappingURL=graphs.d.ts.map