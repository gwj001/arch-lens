/**
 * Catalog unit: the flat `src/<pkg> # duty` listing over the scanned graph.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/catalog
 */

import { createElement as h } from 'react'
import type { ArchLensGraph } from '@deepseek-ai/dsh-arch-lens-backend'
import css from './catalog.module.css'

/**
 * Catalog-unit props.
 */
export interface CatalogProps {
  graph: ArchLensGraph
  onSelectPkg: (id: string) => void
}

/** Render the package catalog grouped by packages/<group>. */
export function Catalog(props: CatalogProps): React.JSX.Element {
  const { graph, onSelectPkg } = props
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
          h('span', { className: css.desc }, node.blurb !== '' ? node.blurb : '（无描述，点击查看详情）'),
        ),
      )
    }
  }
  return h('div', { className: css.catalog }, rows)
}
