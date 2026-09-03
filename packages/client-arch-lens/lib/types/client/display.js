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
export function isModernLayout(graph) {
    return graph !== null && graph !== undefined && graph.lang !== undefined;
}
/** Node directory path relative to the workspace root ('/' joined). When the
 * node IS the root (single-module / unknown scans), the root basename. */
export function relPathOf(graph, node) {
    const root = graph.root.replace(/\\/g, '/').replace(/\/+$/, '');
    const path = node.path.replace(/\\/g, '/').replace(/\/+$/, '');
    if (path === root || root === '')
        return root.split('/').filter(Boolean).at(-1) ?? path;
    if (path.startsWith(`${root}/`))
        return path.slice(root.length + 1);
    return path;
}
/** Singular unit name for count copy, per scan language. */
export function scanUnitLabel(lang, pluralCount) {
    if (lang === 'java')
        return `${pluralCount} 个模块`;
    if (lang === 'python')
        return `${pluralCount} 个包`;
    return `${pluralCount} 个包`;
}
//# sourceMappingURL=display.js.map