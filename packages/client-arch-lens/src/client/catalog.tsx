/**
 * Catalog unit: the flat listing over the scanned graph — legacy TypeScript
 * monorepos render `src/<pkg> # duty` rows under `packages/<group>/`
 * headings; python/java/unknown scans render the node directory path
 * relative to the workspace root (no synthesized `packages/`/`src/` prefixes).
 * Duty text prefers the AI summary, then the localized README paragraph.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/catalog
 */

import { createElement as h } from 'react'
import type { ArchLensGraph } from '@deepseek-ai/dsh-arch-lens-backend'
// Same leaf the HOST uses to assemble figure-prompt duty facts: one priority
// chain, no "two standards" between the table and the prompt (mermaid-fix
// precedent — a zero-import module is safe to inline into the browser bundle).
import { dutyForNode } from '@deepseek-ai/dsh-arch-lens-backend/duty-facts'
import { isModernLayout, relPathOf } from './display.ts'
import { ui } from './i18n.ts'
import css from './catalog.module.css'

/**
 * Catalog-unit props.
 */
export interface CatalogProps {
  graph: ArchLensGraph
  onSelectPkg: (id: string) => void
  /** Output language ('中文' prefers README.zh.md duty text). */
  language: string
  /** AI duty summaries (id → one-line summary), when generated. */
  summaries?: Record<string, string>
}

/** Duty text for one node — delegated to the shared duty-facts leaf:
 * AI summary → blurbZh (README.zh.md, 中文 only) → blurb (package.json
 * description, README paragraph as scan-time fallback). */
export function dutyText(
  node: ArchLensGraph['nodes'][number],
  language: string,
  summaries?: Record<string, string> | null,
): string {
  return dutyForNode(node.id, node, language, summaries)
}

/** Render the package catalog. */
export function Catalog(props: CatalogProps): React.JSX.Element {
  const { graph, onSelectPkg, language, summaries } = props
  const rows: React.ReactNode[] = []
  if (isModernLayout(graph)) {
    // Language-aware scans: rows show the real node dir path relative to the
    // root; no packages/<group> headings (those layouts have no such tree).
    const nodes = [...graph.nodes].sort((a, b) => relPathOf(graph, a).localeCompare(relPathOf(graph, b)))
    for (const node of nodes) {
      const duty = dutyText(node, language, summaries)
      rows.push(
        h('div', { key: node.id, className: css.row, onClick: () => onSelectPkg(node.id) },
          h('span', { className: css.path }, relPathOf(graph, node)),
          h('span', { className: css.sep }, '#'),
          h('span', { className: css.desc }, duty !== '' ? duty : ui(language, 'noDesc')),
        ),
      )
    }
    return h('div', { className: css.catalog }, rows)
  }
  // Legacy TypeScript monorepo display: grouped by packages/<group>.
  const byGroup = new Map<string, ArchLensGraph['nodes'][number][]>()
  for (const node of graph.nodes) {
    const list = byGroup.get(node.group) ?? []
    list.push(node)
    byGroup.set(node.group, list)
  }
  const groups = [...byGroup.keys()].sort()
  for (const group of groups) {
    rows.push(h('div', { key: `g${group}`, className: css.group }, group === '' ? 'packages/' : `packages/${group}/`))
    const nodes = byGroup.get(group) ?? []
    nodes.sort((a, b) => a.short.localeCompare(b.short))
    for (const node of nodes) {
      const duty = dutyText(node, language, summaries)
      rows.push(
        h('div', { key: node.id, className: css.row, onClick: () => onSelectPkg(node.id) },
          h('span', { className: css.path }, `src/${node.short}`),
          h('span', { className: css.sep }, '#'),
          h('span', { className: css.desc }, duty !== '' ? duty : ui(language, 'noDesc')),
        ),
      )
    }
  }
  return h('div', { className: css.catalog }, rows)
}
