/**
 * Language-aware display helpers shared by the desk units that render raw
 * graph data (catalog rows, explain evidence paths, overview trees).
 *
 * Rendering rule (review-confirmed): a graph WITHOUT `lang` is a legacy
 * TypeScript `packages/` scan (or an old disk cache) and keeps its historical
 * `packages/<group>/` headings + `src/<pkg>` row paths byte-for-byte. Graphs
 * WITH `lang` (python/java/unknown/TS-root-fallback scans) render the node
 * directory path relative to the workspace root instead of synthesizing
 * `packages/`/`src/` prefixes that do not exist in those layouts.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/display
 */
/** Whether a graph uses the modern (non-legacy) relative-path display. */
export declare function isModernLayout(graph: {
    lang?: string | undefined;
} | null | undefined): boolean;
/** Node directory path relative to the workspace root ('/' joined). When the
 * node IS the root (single-module / unknown scans), the root basename. */
export declare function relPathOf(graph: {
    root: string;
}, node: {
    path: string;
}): string;
/** Singular unit name for count copy, per scan language. */
export declare function scanUnitLabel(lang: string | undefined, pluralCount: number): string;
//# sourceMappingURL=display.d.ts.map