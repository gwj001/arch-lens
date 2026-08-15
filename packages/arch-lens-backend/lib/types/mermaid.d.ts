/**
 * Mermaid diagram generation from the scanned workspace graph: a dependency
 * flowchart and an ER-style package relationship diagram. Both are pure
 * functions of the graph so the client can render any mermaid via the generic
 * renderer.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/mermaid
 */
import type { ArchLensGraph } from './types.ts';
/**
 * Dependency flowchart: one node per package, one edge per dsh-* peer
 * dependency, grouped by subgraph.
 * @param graph - scanned graph.
 * @returns mermaid flowchart source.
 */
export declare function dependencyFlowchart(graph: ArchLensGraph): string;
/**
 * ER-style package relationship diagram: packages as entities, dsh-*
 * peerDependencies as relationships. This is a package-dependency ER view —
 * useful for spotting coupling between package groups.
 * @param graph - scanned graph.
 * @returns mermaid erDiagram source.
 */
export declare function packageErDiagram(graph: ArchLensGraph): string;
//# sourceMappingURL=mermaid.d.ts.map