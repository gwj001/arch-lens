/**
 * Mermaid diagram generation from the scanned workspace graph: a dependency
 * flowchart and an ER-style package relationship diagram. Both are pure
 * functions of the graph so the client can render any mermaid via the generic
 * renderer. Indexed variants derive edges from the code-index imports (real
 * source-level dependencies) instead of npm peerDependencies.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/mermaid
 */

import { groupLabel } from './types.ts'
import type { ArchLensGraph } from './types.ts'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'

/** Escape a mermaid node label. */
function label(text: string): string {
  return text.replace(/["\\]/g, '')
}

/**
 * Group label for the top-level ('' group) of a language-aware scan:
 * 'packages' is a npm-monorepo term, wrong for python/java/unknown graphs.
 * Non-empty groups keep their name in every layout (legacy scans have no
 * `lang` and keep the historical 'packages' label for '').
 */
function scanGroupLabel(graph: ArchLensGraph, group: string): string {
  if (graph.lang === undefined || group !== '') return groupLabel(group)
  if (graph.lang === 'java') return '模块'
  if (graph.lang === 'python') return '包'
  return '顶层'
}

/**
 * ER relationship lines are nearly invisible under the default theme (same
 * hue as the diagram background); pin a dark amber so the import/dependency
 * edges read clearly. The client renders with securityLevel 'loose', which
 * permits %%{init} directives.
 */
const ER_LINE_STYLE = '%%{init: {"themeVariables": {"er": {"lineColor": "#b45309", "stroke": "#b45309"}}}}%%'

/**
 * Aggregate code-index imports into package-level edges: package A → package B
 * when a source file of A imports a module that resolves to B (B's id is a
 * path segment of the import specifier, or B's entry imports land in A).
 * External modules (npm/python/java packages outside the workspace) are
 * dropped so the graph stays workspace-internal.
 * @param index - code index result.
 * @returns package id → package ids it imports.
 */
export function importEdges(index: CodeIndexResult): Map<string, string[]> {
  const byId = new Map<string, string>()
  for (const pkg of index.packages) byId.set(pkg.id, pkg.id)
  // Prefix map: match import specifiers against package ids/dirs.
  const prefixes: string[] = index.packages.map(pkg => pkg.id)
  const edges = new Map<string, Set<string>>()
  for (const pkg of index.packages) {
    const targets = new Set<string>()
    for (const imp of pkg.imports) {
      const spec = imp.to
      // Local relative imports: resolve against the importing file's dir
      // segments to find the owning package (same-package or another).
      if (spec.startsWith('.')) {
        const fromDir = imp.from.split('/').slice(0, -1)
        const resolved = [...fromDir, ...spec.split('/').filter(part => part !== '.' && part !== '..')].filter(Boolean)
        // Walk from longest suffix to find a package whose id is a path segment.
        for (const candidate of resolved.slice(1)) {
          if (candidate === undefined) continue
          if (byId.has(candidate) || byId.has(candidate.replace(/^dsh-/, ''))) {
            const id = candidate.replace(/^dsh-/, '')
            targets.add(id)
            break
          }
        }
        continue
      }
      // Bare specifiers: match a package id appearing as a path segment.
      // Specifier segments carry npm scope (`@deepseek-ai`) and a `dsh-`
      // prefix that package short ids drop — normalize both sides.
      for (const id of prefixes) {
        const parts = spec.split('/')
        const normalized = parts.map(part => part.replace(/^dsh-/, ''))
        const first = parts[0]
        if (normalized.includes(id) || first === id || (first !== undefined && first.startsWith(id))) {
          targets.add(id)
          break
        }
      }
    }
    if (targets.size > 0) edges.set(pkg.id, targets)
  }
  return new Map([...edges].map(([from, tos]) => [from, [...tos].filter(to => to !== from)]))
}

/**
 * Dependency flowchart over the code-index imports (source-level edges).
 * @param index - code index result.
 * @returns mermaid flowchart source.
 */
export function importFlowchart(index: CodeIndexResult): string {
  const lines: string[] = ['flowchart TD']
  const byLanguage = new Map<string, string[]>()
  for (const pkg of index.packages) {
    const list = byLanguage.get(pkg.language) ?? []
    list.push(pkg.id)
    byLanguage.set(pkg.language, list)
  }
  for (const [language, ids] of byLanguage) {
    lines.push(`  subgraph g_${label(language)}["${label(language)}"]`)
    for (const id of ids) lines.push(`    ${id}["${label(id)}"]`)
    lines.push('  end')
  }
  const seen = new Set<string>()
  for (const [from, tos] of importEdges(index)) {
    for (const to of tos) {
      const key = `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`  ${from} --> ${to}`)
    }
  }
  return lines.join('\n')
}

/**
 * ER-style package diagram over the code-index imports: packages as entities,
 * source-level import edges as relationships.
 * @param index - code index result.
 * @returns mermaid erDiagram source.
 */
export function entityErDiagram(index: CodeIndexResult): string {
  const lines: string[] = ['erDiagram']
  for (const pkg of index.packages) {
    lines.push(`  ${label(pkg.id)} {`)
    lines.push('    string language')
    const classCount = pkg.entities.filter(entity => entity.kind === 'class' || entity.kind === 'interface').length
    if (classCount > 0) lines.push(`    int classes "${classCount}"`)
    lines.push('  }')
  }
  const seen = new Set<string>()
  for (const [from, tos] of importEdges(index)) {
    for (const to of tos) {
      const key = `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`  ${label(from)} ||--o{ ${label(to)} : imports`)
    }
  }
  return `${ER_LINE_STYLE}\n${lines.join('\n')}`
}

/**
 * Dependency flowchart: one node per package, one edge per dsh-* peer
 * dependency, grouped by subgraph.
 * @param graph - scanned graph.
 * @returns mermaid flowchart source.
 */
export function dependencyFlowchart(graph: ArchLensGraph): string {
  const lines: string[] = ['flowchart TD']
  const byGroup = new Map<string, string[]>()
  for (const node of graph.nodes) {
    const list = byGroup.get(node.group) ?? []
    list.push(node.id)
    byGroup.set(node.group, list)
  }
  for (const [group, ids] of byGroup) {
    // The subgraph id must differ from node ids: a package named like its
    // group (acp, attachment, code-runtime, ...) would otherwise collide and
    // mermaid reports "Setting workspace as parent of workspace would create
    // a cycle".
    lines.push(`  subgraph g_${label(scanGroupLabel(graph, group))}["${label(scanGroupLabel(graph, group))}"]`)
    for (const id of ids) lines.push(`    ${id}["${label(id)}"]`)
    lines.push('  end')
  }
  const seen = new Set<string>()
  for (const edge of graph.edges) {
    const key = `${edge.from}>${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  ${edge.from} --> ${edge.to}`)
  }
  return lines.join('\n')
}

/**
 * ER-style package relationship diagram: packages as entities, dsh-*
 * peerDependencies as relationships. This is a package-dependency ER view —
 * useful for spotting coupling between package groups.
 * @param graph - scanned graph.
 * @returns mermaid erDiagram source.
 */
export function packageErDiagram(graph: ArchLensGraph): string {
  const lines: string[] = ['erDiagram']
  const emitted = new Set<string>()
  for (const node of graph.nodes) {
    lines.push(`  ${label(node.id)} {`)
    lines.push('    string name')
    lines.push(`    string group "${label(scanGroupLabel(graph, node.group))}"`)
    lines.push('  }')
    emitted.add(node.id)
  }
  const seen = new Set<string>()
  for (const edge of graph.edges) {
    const key = `${edge.from}>${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  ${label(edge.from)} ||--o{ ${label(edge.to)} : depends`)
  }
  return `${ER_LINE_STYLE}\n${lines.join('\n')}`
}

/**
 * Core-flow dependency flowchart: only the packages selected as core (by the
 * LLM picker or the deterministic fallback), with edges restricted to
 * source-level imports between selected packages. Pure function of the index.
 * @param index - code index result.
 * @param ids - selected core package ids.
 * @returns mermaid flowchart source (may be near-empty when the set is tiny).
 */
export function coreFlowchart(index: CodeIndexResult, ids: string[]): string {
  const idSet = new Set(ids)
  const lines: string[] = ['flowchart TD']
  const byLanguage = new Map<string, string[]>()
  for (const pkg of index.packages) {
    if (!idSet.has(pkg.id)) continue
    const list = byLanguage.get(pkg.language) ?? []
    list.push(pkg.id)
    byLanguage.set(pkg.language, list)
  }
  for (const [language, pkgIds] of byLanguage) {
    lines.push(`  subgraph g_${label(language)}["${label(language)}"]`)
    for (const id of pkgIds) lines.push(`    ${id}["${label(id)}"]`)
    lines.push('  end')
  }
  const seen = new Set<string>()
  for (const [from, tos] of importEdges(index)) {
    if (!idSet.has(from)) continue
    for (const to of tos) {
      if (!idSet.has(to)) continue
      const key = `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`  ${from} --> ${to}`)
    }
  }
  return lines.join('\n')
}

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
export function overviewFigureFromGraph(graph: ArchLensGraph, ids: string[], blurbOf: (id: string) => string): string {
  const idSet = new Set(ids)
  const lines: string[] = ['flowchart TD']
  for (const node of graph.nodes) {
    if (!idSet.has(node.id)) continue
    const blurb = blurbOf(node.id).trim()
    const text = blurb === ''
      ? label(node.id)
      : `${label(node.id)}<br/><small>${label(blurb.slice(0, 40))}</small>`
    lines.push(`  ${node.id}["${text}"]`)
  }
  const seen = new Set<string>()
  for (const edge of graph.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue
    const key = `${edge.from}>${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  ${edge.from} -->|import| ${edge.to}`)
  }
  return lines.join('\n')
}

/**
 * Core-flow flowchart, READ path (graph-only): selected packages grouped by
 * scan group, with dependency edges from the scan graph. Zero LLM, zero I/O.
 * @param graph - scanned workspace graph.
 * @param ids - selected core package ids.
 * @returns mermaid flowchart source.
 */
export function coreFlowchartFromGraph(graph: ArchLensGraph, ids: string[]): string {
  const idSet = new Set(ids)
  const lines: string[] = ['flowchart TD']
  const byGroup = new Map<string, string[]>()
  for (const node of graph.nodes) {
    if (!idSet.has(node.id)) continue
    const list = byGroup.get(node.group) ?? []
    list.push(node.id)
    byGroup.set(node.group, list)
  }
  for (const [group, pkgIds] of byGroup) {
    lines.push(`  subgraph g_${label(group)}["${label(scanGroupLabel(graph, group))}"]`)
    for (const id of pkgIds) lines.push(`    ${id}["${label(id)}"]`)
    lines.push('  end')
  }
  const seen = new Set<string>()
  for (const edge of graph.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue
    const key = `${edge.from}>${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  ${edge.from} --> ${edge.to}`)
  }
  return lines.join('\n')
}

/**
 * Core-flow ER diagram, READ path (graph-only): selected packages as
 * entities, dependency edges between selected packages as relationships.
 * Zero LLM, zero I/O.
 * @param graph - scanned workspace graph.
 * @param ids - selected core package ids.
 * @returns mermaid erDiagram source.
 */
export function coreErDiagramFromGraph(graph: ArchLensGraph, ids: string[]): string {
  const idSet = new Set(ids)
  const lines: string[] = ['erDiagram']
  for (const node of graph.nodes) {
    if (!idSet.has(node.id)) continue
    lines.push(`  ${label(node.id)} {`)
    lines.push('    string group')
    lines.push(`    string blurb "${label((node.blurbZh ?? node.blurb).slice(0, 40))}"`)
    lines.push('  }')
  }
  const seen = new Set<string>()
  for (const edge of graph.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue
    const key = `${edge.from}>${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  ${label(edge.from)} ||--o{ ${label(edge.to)} : imports`)
  }
  return lines.join('\n')
}

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
export function overviewFigure(index: CodeIndexResult, ids: string[], blurbOf: (id: string) => string): string {
  const idSet = new Set(ids)
  const lines: string[] = ['flowchart TD']
  for (const pkg of index.packages) {
    if (!idSet.has(pkg.id)) continue
    const blurb = blurbOf(pkg.id).trim()
    const text = blurb === ''
      ? label(pkg.id)
      : `${label(pkg.id)}<br/><small>${label(blurb.slice(0, 40))}</small>`
    lines.push(`  ${pkg.id}["${text}"]`)
  }
  const seen = new Set<string>()
  for (const [from, tos] of importEdges(index)) {
    if (!idSet.has(from)) continue
    for (const to of tos) {
      if (!idSet.has(to)) continue
      const key = `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`  ${from} -->|import| ${to}`)
    }
  }
  return lines.join('\n')
}

/**
 * Core-flow ER diagram: selected packages as entities, source-level import
 * edges between selected packages as relationships.
 * @param index - code index result.
 * @param ids - selected core package ids.
 * @returns mermaid erDiagram source.
 */
export function coreErDiagram(index: CodeIndexResult, ids: string[]): string {
  const idSet = new Set(ids)
  const lines: string[] = ['erDiagram']
  for (const pkg of index.packages) {
    if (!idSet.has(pkg.id)) continue
    lines.push(`  ${label(pkg.id)} {`)
    lines.push('    string language')
    const classCount = pkg.entities.filter(entity => entity.kind === 'class' || entity.kind === 'interface').length
    if (classCount > 0) lines.push(`    int classes "${classCount}"`)
    lines.push('  }')
  }
  const seen = new Set<string>()
  for (const [from, tos] of importEdges(index)) {
    if (!idSet.has(from)) continue
    for (const to of tos) {
      if (!idSet.has(to)) continue
      const key = `${from}>${to}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`  ${label(from)} ||--o{ ${label(to)} : imports`)
    }
  }
  return `${ER_LINE_STYLE}\n${lines.join('\n')}`
}
