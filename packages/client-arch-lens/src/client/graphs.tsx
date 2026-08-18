/**
 * Pure-presentation SVG graph components for the Arch Lens units. These are
 * stateless renderers: all data and callbacks arrive through props, and layout
 * is a pure function of the input.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/graphs
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ArchLensGraph, ArchLensSequenceResult } from '@deepseek-ai/dsh-arch-lens-backend'
import type { ConceptNode, CoreEvent } from './arch-view.tsx'
import css from './graphs.module.css'

/**
 * Display label for a package group. `''` means a flat `packages/<pkg>`
 * layout (the node has no group directory); render it as `packages` so
 * overview entities never carry an empty label.
 * @param group - the node's group name ('' for flat layouts).
 * @returns the display label.
 */
function groupLabel(group: string): string {
  return group === '' ? 'packages' : group
}

/** Current pan/zoom transform of a graph canvas. */
interface ViewTransform {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.05
const MAX_SCALE = 8
const DRAG_THRESHOLD = 5

/**
 * Wrap an SVG graph in a pan/zoom canvas: wheel zooms around the cursor,
 * drag pans, double click resets to fit. The viewport clips (no scrollbars)
 * and fits the diagram on first layout.
 */
function PanZoom(props: { width: number; height: number; children?: React.ReactNode }): React.JSX.Element {
  const { width, height, children } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)

  // Fit the diagram into the viewport (full view first, no zoom-in by default).
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const cw = host.clientWidth
    const ch = host.clientHeight
    if (cw <= 0 || ch <= 0 || width <= 0 || height <= 0) return
    const scale = Math.min(cw / width, ch / height, 1)
    setView({ scale, x: (cw - width * scale) / 2, y: (ch - height * scale) / 2 })
  }, [width, height])

  const onWheel = (event: React.WheelEvent): void => {
    const host = hostRef.current
    if (host === null) return
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
    const rect = host.getBoundingClientRect()
    const mx = event.clientX - rect.left
    const my = event.clientY - rect.top
    setView(previous => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous.scale * factor))
      // Keep the point under the cursor stationary.
      const sx = (mx - previous.x) / previous.scale
      const sy = (my - previous.y) / previous.scale
      return { scale, x: mx - sx * scale, y: my - sy * scale }
    })
  }

  const onMouseDown = (event: React.MouseEvent): void => {
    dragRef.current = { startX: event.clientX, startY: event.clientY, origX: view.x, origY: view.y, moved: false }
  }

  const onMouseMove = (event: React.MouseEvent): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) drag.moved = true
    if (drag.moved) setView({ scale: view.scale, x: drag.origX + dx, y: drag.origY + dy })
  }

  const endDrag = (): void => { dragRef.current = null }

  const resetView = (): void => {
    const host = hostRef.current
    if (host === null) return
    const cw = host.clientWidth
    const ch = host.clientHeight
    if (cw <= 0 || ch <= 0) return
    const scale = Math.min(cw / width, ch / height, 1)
    setView({ scale, x: (cw - width * scale) / 2, y: (ch - height * scale) / 2 })
  }

  // A real drag must not reach the node click handlers.
  const onClickCapture = (event: React.MouseEvent): void => {
    if (dragRef.current?.moved === true) {
      event.stopPropagation()
      event.preventDefault()
      dragRef.current = null
    }
  }

  return h('div', {
    ref: hostRef,
    className: css.panzoom,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp: endDrag,
    onMouseLeave: endDrag,
    onDoubleClick: resetView,
    onClickCapture,
  },
    h('div', {
      className: css.canvas,
      style: { width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` },
    }, children))
}

/** One laid-out concept node. */
interface ConceptLayoutNode extends ConceptNode {
  depth: number
  open: boolean
  x: number
  y: number
}

/**
 * Build a group→package tree from the scanned graph for the lightweight
 * overview view of the dependency/ER tabs (groups as roots, packages as
 * leaves). Rendered by ConceptGraph, so the overview is always small and
 * fast even when the full mermaid diagram is huge.
 * @param graph - scanned graph.
 * @returns concept-tree roots, one per package group.
 */
export function buildGroupTree(graph: ArchLensGraph): ConceptNode[] {
  const byGroup = new Map<string, ArchLensGraph['nodes'][number][]>()
  for (const node of graph.nodes) {
    const list = byGroup.get(node.group) ?? []
    list.push(node)
    byGroup.set(node.group, list)
  }
  const roots: ConceptNode[] = []
  for (const group of [...byGroup.keys()].sort()) {
    const pkgs = byGroup.get(group) ?? []
    roots.push({
      id: `g:${group}`,
      name: groupLabel(group),
      desc: `${pkgs.length} 个包`,
      children: pkgs.map(pkg => ({
        id: `g:${group}:${pkg.id}`,
        name: pkg.short,
        desc: pkg.blurb.slice(0, 34),
        pkg: pkg.id,
      })),
    })
  }
  return roots
}

/**
 * Collect the visible concept-tree nodes with layout coordinates.
 * @param roots - concept tree roots.
 * @param expanded - expanded node ids.
 * @param columnWidth - x step per depth.
 * @param rowHeight - y step per row.
 * @returns visible nodes and total width/height.
 */
export function layoutConceptTree(
  roots: readonly ConceptNode[],
  expanded: readonly string[],
  columnWidth = 250,
  rowHeight = 46,
): { nodes: ConceptLayoutNode[]; width: number; height: number } {
  const nodes: ConceptLayoutNode[] = []
  let cursorY = 30
  const walk = (node: ConceptNode, depth: number): void => {
    const open = expanded.includes(node.id)
    nodes.push({ ...node, depth, open, x: depth * columnWidth + 10, y: cursorY })
    cursorY += rowHeight
    if (open && node.children !== undefined) {
      for (const child of node.children) walk(child, depth + 1)
    }
  }
  for (const root of roots) walk(root, 0)
  return { nodes, width: 6 * columnWidth + 20, height: cursorY + 10 }
}

/**
 * Concept-tree graph props.
 */
export interface ConceptGraphProps {
  graph: ArchLensGraph
  conceptTree: readonly ConceptNode[]
  expanded: readonly string[]
  selectedId: string | null
  onToggle: (id: string) => void
  onSelectPkg: (id: string) => void
  onExplainConcept?: (node: ConceptNode) => void
}

/** Render the concept hierarchy as an SVG tree. */
export function ConceptGraph(props: ConceptGraphProps): React.JSX.Element {
  const { graph, conceptTree, expanded, selectedId, onToggle, onSelectPkg, onExplainConcept } = props
  const { nodes, width, height } = layoutConceptTree(conceptTree, expanded)
  const links: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (const node of nodes) {
    if (node.children === undefined) continue
    for (const child of node.children) {
      const childNode = nodes.find(candidate => candidate.id === child.id)
      if (childNode === undefined) continue
      links.push({ x1: node.x + 110, y1: node.y + 34, x2: childNode.x + 110, y2: childNode.y })
    }
  }
  return h(PanZoom, { width, height },
    h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` },
      links.map((link, index) => h('path', {
        key: index,
        d: `M${link.x1} ${link.y1} C${link.x1} ${link.y1 + 12} ${link.x2} ${link.y2 - 12} ${link.x2} ${link.y2}`,
        className: css.edge,
      })),
      nodes.map(node => {
        const pkgNode = node.pkg === undefined ? undefined : graph.nodes.find(candidate => candidate.id === node.pkg)
        const hue = pkgNode === undefined ? 220 : 160
        const open = node.children !== undefined && node.children.length > 0 && node.open
        return h('g', {
          key: node.id,
          transform: `translate(${node.x},${node.y})`,
          className: css.nodeGroup,
          onClick: () => {
            // Expandable nodes (entity-tree packages with children) toggle
            // first; leaf package nodes open the detail popup.
            if (node.children !== undefined && node.children.length > 0) onToggle(node.id)
            else if (pkgNode !== undefined) onSelectPkg(pkgNode.id)
          },
        },
          h('rect', {
            width: 220,
            height: 34,
            rx: 7,
            fill: pkgNode !== undefined
              ? `hsl(${hue}, 45%, 90%)`
              : open
                ? `hsl(${hue}, 55%, 82%)`
                : `hsl(${hue}, 45%, 94%)`,
            stroke: selectedId === node.id ? `hsl(${hue}, 70%, 40%)` : `hsl(${hue}, 55%, 45%)`,
            strokeWidth: selectedId === node.id ? 2.5 : 1.2,
          }),
          h('text', { x: 8, y: 15, fontSize: 12, fontWeight: 600, fill: '#333' },
            `${node.children !== undefined && node.children.length > 0 ? (open ? '▾ ' : '▸ ') : ''}${node.name}`),
          h('text', { x: 8, y: 29, fontSize: 10, fill: '#666' },
            pkgNode !== undefined ? `${pkgNode.group}/${pkgNode.short}` : (node.desc.slice(0, 26))),
          // Package nodes open the detail popup instead; only pure concept
          // nodes get the explain button.
          onExplainConcept !== undefined && pkgNode === undefined
            ? h('text', {
                x: 204, y: 22, fontSize: 12, textAnchor: 'end', cursor: 'pointer',
                onClick: (event: React.MouseEvent) => {
                  event.stopPropagation()
                  onExplainConcept(node)
                },
              }, '🤖')
            : null,
        )
      }),
    ),
  )
}

/**
 * Interaction-graph props.
 */
export interface InteractionGraphProps {
  events: readonly CoreEvent[]
  onSelectEvent: (id: string) => void
}

/** Render the producer → event → consumer interaction rows as SVG. */
export function InteractionGraph(props: InteractionGraphProps): React.JSX.Element {
  const { events, onSelectEvent } = props
  const leftWidth = 110
  const midWidth = 190
  const rightWidth = 190
  const rowHeight = 46
  const width = leftWidth + midWidth + rightWidth + 30
  const height = events.length * rowHeight + 26
  const elements: React.ReactNode[] = []
  events.forEach((event, index) => {
    const y = 18 + index * rowHeight
    const midY = y + 16
    elements.push(
      h('text', { key: `p${index}`, x: leftWidth - 8, y: midY + 4, fontSize: 11, textAnchor: 'end', fill: '#555' },
        event.producers.join(', ')),
      h('line', { key: `l1${index}`, x1: leftWidth, y1: midY, x2: leftWidth + 12, y2: midY, stroke: '#999', strokeWidth: 1 }),
      h('g', { key: `m${index}`, className: css.eventGroup, onClick: () => onSelectEvent(event.event) },
        h('rect', {
          x: leftWidth + 12, y, width: midWidth, height: 32, rx: 7,
          fill: 'hsl(30, 55%, 88%)', stroke: 'hsl(30, 60%, 45%)', strokeWidth: 1.2,
        }),
        h('text', { x: leftWidth + 20, y: y + 13, fontSize: 11, fontWeight: 600, fill: '#333' }, event.event),
        h('text', { x: leftWidth + 20, y: y + 26, fontSize: 9, fill: '#886' }, `mode: ${event.mode}`),
      ),
      h('line', { key: `l2${index}`, x1: leftWidth + 12 + midWidth, y1: midY, x2: leftWidth + 22 + midWidth, y2: midY, stroke: '#999', strokeWidth: 1 }),
      h('text', { key: `c${index}`, x: leftWidth + 28 + midWidth, y: midY + 4, fontSize: 11, fill: '#555' },
        event.consumers.join(', ')),
    )
  })
  return h(PanZoom, { width, height },
    h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, elements))
}

/**
 * Sequence-graph props: the resolved figure (source + ordered messages).
 * The provenance badge is rendered by the caller; this unit draws the SVG.
 */
export interface SequenceGraphProps {
  result: ArchLensSequenceResult
}

/** Render the turn flow as an SVG sequence diagram. */
export function SequenceGraph(props: SequenceGraphProps): React.JSX.Element {
  const { result } = props
  const sequence = result.messages
  // Lanes are derived from the message data (static call graph / doc section
  // / AI structured cache), keeping first-appearance order; there is no
  // curated participant list.
  const actors: string[] = []
  for (const message of sequence) {
    if (!actors.includes(message.from)) actors.push(message.from)
    if (!actors.includes(message.to)) actors.push(message.to)
  }
  const laneWidth = 150
  const top = 64
  const step = 46
  const width = actors.length * laneWidth + 20
  const height = top + sequence.length * step + 20
  const xOf = (name: string): number => actors.indexOf(name) * laneWidth + laneWidth / 2 + 10
  const elements: React.ReactNode[] = []
  actors.forEach((actor, index) => {
    const x = xOf(actor)
    const hue = (index * 55) % 360
    elements.push(
      h('rect', { key: `h${index}`, x: x - 62, y: 8, width: 124, height: 28, rx: 6, fill: `hsl(${hue}, 45%, 88%)`, stroke: `hsl(${hue}, 50%, 45%)` }),
      h('text', { key: `ht${index}`, x, y: 26, fontSize: 11, fontWeight: 600, textAnchor: 'middle', fill: '#333' }, actor),
      h('line', { key: `l${index}`, x1: x, y1: 40, x2: x, y2: height - 8, className: css.actorLane }),
    )
  })
  sequence.forEach((message, index) => {
    const y = top + index * step
    const x1 = xOf(message.from)
    const x2 = xOf(message.to)
    if (message.from === message.to) {
      elements.push(
        h('path', { key: `a${index}`, d: `M${x1} ${y} C${x1 + 34} ${y} ${x1 + 34} ${y + 16} ${x1} ${y + 16}`, fill: 'none', className: css.arrow }),
        h('polygon', { key: `ar${index}`, points: `${x1 - 4},${y + 16} ${x1 + 4},${y + 16} ${x1},${y + 20}`, className: css.arrowHead }),
        h('text', { key: `t${index}`, x: x1 + 40, y: y + 10, fontSize: 11, fill: '#445' }, message.label),
      )
    } else {
      const direction = x1 < x2 ? 1 : -1
      const endX = x2 - direction * 5
      elements.push(
        h('line', { key: `a${index}`, x1, y1: y, x2: endX, y2: y, className: css.arrow }),
        h('polygon', { key: `ar${index}`, points: `${endX - direction * 5},${y - 4} ${endX - direction * 5},${y + 4} ${endX},${y}`, className: css.arrowHead }),
        h('text', { key: `t${index}`, x: direction > 0 ? x1 + 6 : x1 - message.label.length * 6.4 - 14, y: y - 5, fontSize: 11, fill: '#445' },
          message.label.slice(0, 34)),
      )
    }
  })
  return h(PanZoom, { width, height },
    h('svg', { className: css.svg, style: { minWidth: width, minHeight: height }, viewBox: `0 0 ${width} ${height}` }, elements))
}
