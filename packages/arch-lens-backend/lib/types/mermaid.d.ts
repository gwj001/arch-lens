/**
 * Mermaid diagram generation from the scanned workspace graph: a dependency
 * flowchart and an ER-style package relationship diagram. Both are pure
 * functions of the graph so the client can render any mermaid via the generic
 * renderer. Indexed variants derive edges from the code-index imports (real
 * source-level dependencies) instead of npm peerDependencies.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/mermaid
 */
import type { ArchLensGraph } from './types.ts';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
/**
 * Aggregate code-index imports into package-level edges: package A → package B
 * when a source file of A imports a module that resolves to B (B's id is a
 * path segment of the import specifier, or B's entry imports land in A).
 * External modules (npm/python/java packages outside the workspace) are
 * dropped so the graph stays workspace-internal.
 * @param index - code index result.
 * @returns package id → package ids it imports.
 */
export declare function importEdges(index: CodeIndexResult): Map<string, string[]>;
/**
 * Dependency flowchart over the code-index imports (source-level edges).
 * @param index - code index result.
 * @returns mermaid flowchart source.
 */
export declare function importFlowchart(index: CodeIndexResult): string;
/**
 * ER-style package diagram over the code-index imports: packages as entities,
 * source-level import edges as relationships.
 * @param index - code index result.
 * @returns mermaid erDiagram source.
 */
export declare function entityErDiagram(index: CodeIndexResult): string;
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
/**
 * Core-flow dependency flowchart: only the packages selected as core (by the
 * LLM picker or the deterministic fallback), with edges restricted to
 * source-level imports between selected packages. Pure function of the index.
 * @param index - code index result.
 * @param ids - selected core package ids.
 * @returns mermaid flowchart source (may be near-empty when the set is tiny).
 */
export declare function coreFlowchart(index: CodeIndexResult, ids: string[]): string;
/**
 * 架构概览 flowchart, READ path (graph-only): the core packages with their
 * one-line duty (blurb) under the name, and dependency edges between core
 * packages from the SCAN GRAPH (not the code index — the read path never
 * walks source). Pure function of structured facts (zero LLM, zero I/O).
 * @param graph - scanned workspace graph.
 * @param ids - selected core package ids.
 * @param blurbOf - one-line duty per package id (graph blurb), '' when absent.
 * @returns mermaid flowchart source.
 */
export declare function overviewFigureFromGraph(graph: ArchLensGraph, ids: string[], blurbOf: (id: string) => string): string;
/**
 * Core-flow flowchart, READ path (graph-only): selected packages grouped by
 * scan group, with dependency edges from the scan graph. Zero LLM, zero I/O.
 * @param graph - scanned workspace graph.
 * @param ids - selected core package ids.
 * @returns mermaid flowchart source.
 */
export declare function coreFlowchartFromGraph(graph: ArchLensGraph, ids: string[]): string;
/**
 * Core-flow ER diagram, READ path (graph-only): selected packages as
 * entities, dependency edges between selected packages as relationships.
 * Zero LLM, zero I/O.
 * @param graph - scanned workspace graph.
 * @param ids - selected core package ids.
 * @returns mermaid erDiagram source.
 */
export declare function coreErDiagramFromGraph(graph: ArchLensGraph, ids: string[]): string;
/**
 * 架构概览 flowchart: the core packages with their one-line duty (blurb)
 * under the name, and source-level import edges between core packages —
 * a "what the project is made of + what each part does + how they connect"
 * overview built purely from structured facts (zero LLM). Replaces the ER
 * view, which duplicated the dependency graph with no extra information.
 * @param index - code index result.
 * @param ids - selected core package ids.
 * @param blurbOf - one-line duty per package id (graph blurb), '' when absent.
 * @returns mermaid flowchart source.
 */
export declare function overviewFigure(index: CodeIndexResult, ids: string[], blurbOf: (id: string) => string): string;
/**
 * Core-flow ER diagram: selected packages as entities, source-level import
 * edges between selected packages as relationships.
 * @param index - code index result.
 * @param ids - selected core package ids.
 * @returns mermaid erDiagram source.
 */
export declare function coreErDiagram(index: CodeIndexResult, ids: string[]): string;
//# sourceMappingURL=mermaid.d.ts.map