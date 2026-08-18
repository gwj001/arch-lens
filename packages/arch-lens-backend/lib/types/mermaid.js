/**
 * Mermaid diagram generation from the scanned workspace graph: a dependency
 * flowchart and an ER-style package relationship diagram. Both are pure
 * functions of the graph so the client can render any mermaid via the generic
 * renderer. Indexed variants derive edges from the code-index imports (real
 * source-level dependencies) instead of npm peerDependencies.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/mermaid
 */
/** Escape a mermaid node label. */
function label(text) {
    return text.replace(/["\\]/g, '');
}
/**
 * Aggregate code-index imports into package-level edges: package A → package B
 * when a source file of A imports a module that resolves to B (B's id is a
 * path segment of the import specifier, or B's entry imports land in A).
 * External modules (npm/python/java packages outside the workspace) are
 * dropped so the graph stays workspace-internal.
 * @param index - code index result.
 * @returns package id → package ids it imports.
 */
export function importEdges(index) {
    const byId = new Map();
    for (const pkg of index.packages)
        byId.set(pkg.id, pkg.id);
    // Prefix map: match import specifiers against package ids/dirs.
    const prefixes = index.packages.map(pkg => pkg.id);
    const edges = new Map();
    for (const pkg of index.packages) {
        const targets = new Set();
        for (const imp of pkg.imports) {
            const spec = imp.to;
            // Local relative imports: resolve against the importing file's dir
            // segments to find the owning package (same-package or another).
            if (spec.startsWith('.')) {
                const fromDir = imp.from.split('/').slice(0, -1);
                const resolved = [...fromDir, ...spec.split('/').filter(part => part !== '.' && part !== '..')].filter(Boolean);
                // Walk from longest suffix to find a package whose id is a path segment.
                for (const candidate of resolved.slice(1)) {
                    if (candidate === undefined)
                        continue;
                    if (byId.has(candidate) || byId.has(candidate.replace(/^dsh-/, ''))) {
                        const id = candidate.replace(/^dsh-/, '');
                        targets.add(id);
                        break;
                    }
                }
                continue;
            }
            // Bare specifiers: match a package id appearing as a path segment.
            // Specifier segments carry npm scope (`@deepseek-ai`) and a `dsh-`
            // prefix that package short ids drop — normalize both sides.
            for (const id of prefixes) {
                const parts = spec.split('/');
                const normalized = parts.map(part => part.replace(/^dsh-/, ''));
                const first = parts[0];
                if (normalized.includes(id) || first === id || (first !== undefined && first.startsWith(id))) {
                    targets.add(id);
                    break;
                }
            }
        }
        if (targets.size > 0)
            edges.set(pkg.id, targets);
    }
    return new Map([...edges].map(([from, tos]) => [from, [...tos].filter(to => to !== from)]));
}
/**
 * Dependency flowchart over the code-index imports (source-level edges).
 * @param index - code index result.
 * @returns mermaid flowchart source.
 */
export function importFlowchart(index) {
    const lines = ['flowchart TD'];
    const byLanguage = new Map();
    for (const pkg of index.packages) {
        const list = byLanguage.get(pkg.language) ?? [];
        list.push(pkg.id);
        byLanguage.set(pkg.language, list);
    }
    for (const [language, ids] of byLanguage) {
        lines.push(`  subgraph g_${label(language)}["${label(language)}"]`);
        for (const id of ids)
            lines.push(`    ${id}["${label(id)}"]`);
        lines.push('  end');
    }
    const seen = new Set();
    for (const [from, tos] of importEdges(index)) {
        for (const to of tos) {
            const key = `${from}>${to}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            lines.push(`  ${from} --> ${to}`);
        }
    }
    return lines.join('\n');
}
/**
 * ER-style package diagram over the code-index imports: packages as entities,
 * source-level import edges as relationships.
 * @param index - code index result.
 * @returns mermaid erDiagram source.
 */
export function entityErDiagram(index) {
    const lines = ['erDiagram'];
    for (const pkg of index.packages) {
        lines.push(`  ${label(pkg.id)} {`);
        lines.push('    string language');
        const classCount = pkg.entities.filter(entity => entity.kind === 'class' || entity.kind === 'interface').length;
        if (classCount > 0)
            lines.push(`    int classes "${classCount}"`);
        lines.push('  }');
    }
    const seen = new Set();
    for (const [from, tos] of importEdges(index)) {
        for (const to of tos) {
            const key = `${from}>${to}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            lines.push(`  ${label(from)} ||--o{ ${label(to)} : imports`);
        }
    }
    return lines.join('\n');
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
        const groupLabel = group === '' ? 'packages' : group;
        lines.push(`  subgraph g_${label(groupLabel)}["${label(groupLabel)}"]`);
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
        lines.push(`    string group "${label(node.group === '' ? 'packages' : node.group)}"`);
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
/**
 * Core-flow dependency flowchart: only the packages selected as core (by the
 * LLM picker or the deterministic fallback), with edges restricted to
 * source-level imports between selected packages. Pure function of the index.
 * @param index - code index result.
 * @param ids - selected core package ids.
 * @returns mermaid flowchart source (may be near-empty when the set is tiny).
 */
export function coreFlowchart(index, ids) {
    const idSet = new Set(ids);
    const lines = ['flowchart TD'];
    const byLanguage = new Map();
    for (const pkg of index.packages) {
        if (!idSet.has(pkg.id))
            continue;
        const list = byLanguage.get(pkg.language) ?? [];
        list.push(pkg.id);
        byLanguage.set(pkg.language, list);
    }
    for (const [language, pkgIds] of byLanguage) {
        lines.push(`  subgraph g_${label(language)}["${label(language)}"]`);
        for (const id of pkgIds)
            lines.push(`    ${id}["${label(id)}"]`);
        lines.push('  end');
    }
    const seen = new Set();
    for (const [from, tos] of importEdges(index)) {
        if (!idSet.has(from))
            continue;
        for (const to of tos) {
            if (!idSet.has(to))
                continue;
            const key = `${from}>${to}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            lines.push(`  ${from} --> ${to}`);
        }
    }
    return lines.join('\n');
}
/**
 * Core-flow ER diagram: selected packages as entities, source-level import
 * edges between selected packages as relationships.
 * @param index - code index result.
 * @param ids - selected core package ids.
 * @returns mermaid erDiagram source.
 */
export function coreErDiagram(index, ids) {
    const idSet = new Set(ids);
    const lines = ['erDiagram'];
    for (const pkg of index.packages) {
        if (!idSet.has(pkg.id))
            continue;
        lines.push(`  ${label(pkg.id)} {`);
        lines.push('    string language');
        const classCount = pkg.entities.filter(entity => entity.kind === 'class' || entity.kind === 'interface').length;
        if (classCount > 0)
            lines.push(`    int classes "${classCount}"`);
        lines.push('  }');
    }
    const seen = new Set();
    for (const [from, tos] of importEdges(index)) {
        if (!idSet.has(from))
            continue;
        for (const to of tos) {
            if (!idSet.has(to))
                continue;
            const key = `${from}>${to}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            lines.push(`  ${label(from)} ||--o{ ${label(to)} : imports`);
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=mermaid.js.map