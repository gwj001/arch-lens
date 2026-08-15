/**
 * Mermaid diagram generation from the scanned workspace graph: a dependency
 * flowchart and an ER-style package relationship diagram. Both are pure
 * functions of the graph so the client can render any mermaid via the generic
 * renderer.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/mermaid
 */
/** Escape a mermaid node label. */
function label(text) {
    return text.replace(/["\\]/g, '');
}
/**
 * Dependency flowchart: one node per package, one edge per dsh-* peer
 * dependency, grouped by subgraph.
 * @param graph - scanned graph.
 * @returns mermaid flowchart source.
 */
export function dependencyFlowchart(graph) {
    const lines = ['flowchart TD'];
    const byGroup = new Map();
    for (const node of graph.nodes) {
        const list = byGroup.get(node.group) ?? [];
        list.push(node.id);
        byGroup.set(node.group, list);
    }
    for (const [group, ids] of byGroup) {
        // The subgraph id must differ from node ids: a package named like its
        // group (acp, attachment, code-runtime, ...) would otherwise collide and
        // mermaid reports "Setting workspace as parent of workspace would create
        // a cycle".
        lines.push(`  subgraph g_${label(group)}["${label(group)}"]`);
        for (const id of ids)
            lines.push(`    ${id}["${label(id)}"]`);
        lines.push('  end');
    }
    const seen = new Set();
    for (const edge of graph.edges) {
        const key = `${edge.from}>${edge.to}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        lines.push(`  ${edge.from} --> ${edge.to}`);
    }
    return lines.join('\n');
}
/**
 * ER-style package relationship diagram: packages as entities, dsh-*
 * peerDependencies as relationships. This is a package-dependency ER view —
 * useful for spotting coupling between package groups.
 * @param graph - scanned graph.
 * @returns mermaid erDiagram source.
 */
export function packageErDiagram(graph) {
    const lines = ['erDiagram'];
    const emitted = new Set();
    for (const node of graph.nodes) {
        lines.push(`  ${label(node.id)} {`);
        lines.push('    string name');
        lines.push(`    string group "${label(node.group)}"`);
        lines.push('  }');
        emitted.add(node.id);
    }
    const seen = new Set();
    for (const edge of graph.edges) {
        const key = `${edge.from}>${edge.to}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        lines.push(`  ${label(edge.from)} ||--o{ ${label(edge.to)} : depends`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=mermaid.js.map