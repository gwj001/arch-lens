/**
 * Catalog unit: the flat `src/<pkg> # duty` listing over the scanned graph.
 * Duty text prefers the AI summary, then the localized README paragraph.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/catalog
 */

import { createElement as h } from 'react'
import type { ArchLensGraph } from '@deepseek-ai/dsh-arch-lens-backend'
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

/** Duty text for one node: AI summary first, then localized README text. */
export function dutyText(
  node: ArchLensGraph['nodes'][number],
  language: string,
  summaries?: Record<string, string>,
): string {
  const ai = summaries?.[node.id]
  if (ai !== undefined && ai !== '') return ai
  if (language === '中文' && node.blurbZh !== undefined && node.blurbZh !== '') return node.blurbZh
  return node.blurb
}

/** Render the package catalog grouped by packages/<group>. */
export function Catalog(props: CatalogProps): React.JSX.Element {
  const { graph, onSelectPkg, language, summaries } = props
  const byGroup = new Map<string, ArchLensGraph['nodes'][number][]>()
  for (const node of graph.nodes) {
    const list = byGroup.get(node.group) ?? []
    list.push(node)
    byGroup.set(node.group, list)
  }
  const groups = [...byGroup.keys()].sort()
  const rows: React.ReactNode[] = []
  for (const group of groups) {
    rows.push(h('div', { key: `g${group}`, className: css.group }, `packages/${group}/`))
    const nodes = byGroup.get(group) ?? []
    nodes.sort((a, b) => a.short.localeCompare(b.short))
    for (const node of nodes) {
      rows.push(
        h('div', { key: node.id, className: css.row, onClick: () => onSelectPkg(node.id) },
          h('span', { className: css.path }, `src/${node.short}`),
          h('span', { className: css.sep }, '#'),
          h('span', { className: css.desc }, dutyText(node, language, summaries) !== '' ? dutyText(node, language, summaries) : ui(language, 'noDesc')),
        ),
      )
    }
  }
  return h('div', { className: css.catalog }, rows)
}
