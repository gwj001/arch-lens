/**
 * Generic Mermaid renderer for the Arch Lens desk: renders ANY mermaid
 * diagram (flowchart / sequence / erDiagram / classDiagram / state / …) from
 * a text source. The source can be host-generated (dependency graph, ER) or
 * pasted by the user, so the desk is not limited to hand-written SVG units.
 *
 * Dense diagrams get a pan/zoom canvas: the SVG first fits the container
 * (full view), then the wheel zooms around the cursor, dragging pans, and a
 * double click resets to the fitted view.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/mermaid-view
 */

import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
// Shared repair leaf: the SAME implementation the backend capture uses, so a
// stale cache an older host wrote still renders, and no "two standards" drift
// is possible. It is a zero-import module (safe to inline into the browser
// bundle — only the service MAIN entry would drag the whole runtime in).
import { sanitizeMermaid } from '@deepseek-ai/dsh-arch-lens-backend/mermaid-fix'
import { edgeLabelFromPathId, type SelectionKind } from './draw-selection.ts'
import css from './mermaid-view.module.css'

// Large-repo diagrams exceed mermaid's defaults: 500 edges (dependency graph
// of 100+ packages) and 50k text chars (ER view of the same). These are
// secure configs, settable only here, never inside a diagram. useMaxWidth:false
// keeps the SVG at its natural pixel size so the zoom canvas has real content
// to scale (per-diagram config in mermaid 11).
//
// The base theme is restyled so every diagram reads cleanly on the desk:
// blue node fills with rounded corners, dark readable text (system font
// stack with CJK fallbacks), and visible edges.
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  maxEdges: 10000,
  maxTextSize: 1000000,
  theme: 'base',
  themeVariables: {
    primaryColor: '#e8f0fe',
    primaryBorderColor: '#5b8def',
    primaryTextColor: '#1f2d3d',
    secondaryColor: '#fdf3e3',
    tertiaryColor: '#e9f7ef',
    lineColor: '#5b6b8c',
    textColor: '#1f2d3d',
    titleColor: '#1f2d3d',
    fontSize: '14px',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    edgeLabelBackground: '#ffffff',
    clusterBkg: '#f5f8fc',
    clusterBorder: '#c8d4e8',
  },
  // flowchart 直线化：basis 样条不穿过控制点，枢纽扇形图里线会贴束、边标签
  // 白底互相叠压节点文字（「文字被挡住」的主因）。linear 弦 + 加宽间距让
  // 每条边各走各路，标签各占其位。
  flowchart: { useMaxWidth: false, curve: 'linear', nodeSpacing: 60, rankSpacing: 90, padding: 16 },
  er: { useMaxWidth: false },
})

/** Current pan/zoom transform of the diagram canvas. */
interface ViewTransform {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.05
const MAX_SCALE = 8
const DRAG_THRESHOLD = 5

// Rendered-SVG cache keyed by source text: the arch view remounts when the
// user switches conversation tabs, and re-running mermaid on the same source
// is wasted work — the cached SVG is reused and only explicit refreshes
// (which change the source identity) force a re-render.
const svgCache = new Map<string, string>()

/** Resolve a mermaid element's label. Mermaid 11 renders flowchart node and
 * subgraph labels inside <foreignObject><div> (NOT <text>), so a plain
 * `querySelector('text')` silently misses them. Returns the label carrier
 * element (for rect math) plus the normalized label text. */
function labelOf(element: Element): { label: string; el: Element | null } {
  const text = element.querySelector('text')
  if (text !== null) {
    const label = (text.textContent ?? '').trim()
    return { label, el: label === '' ? null : text }
  }
  const div = element.querySelector('foreignObject div')
  if (div !== null) {
    const label = (div.textContent ?? '').replace(/\s+/g, ' ').trim()
    return { label, el: label === '' ? null : div }
  }
  const raw = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  return raw === '' ? { label: '', el: null } : { label: raw, el: element }
}

/**
 * Mermaid-view props: the diagram source text.
 */
export interface MermaidViewProps {
  /** Mermaid diagram source (a full diagram, without the ```mermaid fence). */
  source: string
  /** Called when the user clicks a node/entity; the node label text is passed. */
  onSelectNode?: (label: string) => void
  /** Called when the user clicks the「🤖 动态画图」button that appears while
   * hovering a flowchart SUBGRAPH title; the subgraph label is passed. */
  onClusterAction?: (label: string) => void
  /** Called on RIGHT-click of a node/entity/edge/subgraph title; the element's
   * label text AND its kind are passed — arch-lens turns the pick into a
   * selection CHIP (multi-select, scoped to this figure, ✕ to remove). */
  onNodeContext?: (label: string, kind: SelectionKind) => void
  /** Render settled OK (fresh mermaid render or synced SVG cache hit). */
  onRendered?: () => void
  /** Render FAILED — mermaid's own parse/render error, verbatim. The browser
   * IS the validator (the host has no DOM), so downstream gates (save
   * blocked, broken cache invalidated) consume this signal, never a
   * host-side "valid" stamp. */
  onRenderError?: (message: string) => void
}

/** Render one mermaid diagram into an inline, pan/zoomable SVG. */
export function MermaidView(props: MermaidViewProps): React.JSX.Element {
  const { source, onSelectNode, onClusterAction, onNodeContext, onRendered, onRenderError } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  // Callbacks kept in refs: the render effect must NOT restart when a parent
  // re-creates the handler closures each render (would re-run mermaid.render
  // and re-fire the settled signal). Read latest via ref.
  const onRenderedRef = useRef(onRendered)
  const onRenderErrorRef = useRef(onRenderError)
  onRenderedRef.current = onRendered
  onRenderErrorRef.current = onRenderError
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 })
  // Bumped every time a rendered SVG lands in the host (sync cache hit or
  // async mermaid render). The fit effect depends on it: on mount the render
  // effect starts ASYNC (mermaid.render) while the fit/apply effects already
  // ran with svgRef still null and bailed — without this tick they would never
  // re-run, leaving the SVG at natural size (a giant invisible fragment inside
  // a small pane = the「图一闪而过」/「看不到」regression).
  const [fitTick, setFitTick] = useState(0)
  // Host stays invisible until the first fit lands: the injected SVG renders
  // at its natural size (scale=1) before the fit effect shrinks it — without
  // this gate every view switch flashes the diagram enlarged-then-shrunk.
  const [ready, setReady] = useState(false)
  const [clusterBtn, setClusterBtn] = useState<{ label: string; x: number; y: number } | null>(null)
  // True while the pointer sits on the floating button itself: host-side
  // hide paths must not unmount the button underneath the cursor.
  const btnHoverRef = useRef(false)
  // Shared grace timer: the host's mouseleave and the pointer's journey onto
  // the button race each other, so hiding is always deferred a beat and the
  // button's mouseenter calls it off. (Component-scoped: effect AND button
  // handlers both need it.)
  const hideTimerRef = useRef<number | null>(null)
  const cancelBtnHide = (): void => {
    if (hideTimerRef.current !== null) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }
  const scheduleBtnHide = (): void => {
    cancelBtnHide()
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      if (!btnHoverRef.current) setClusterBtn(null)
    }, 150)
  }
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  // Unique per mount: mermaid render ids must not collide across remounts or
  // retries, otherwise mermaid can fail or hang looking up a stale node.
  const idBase = useId().replace(/[^a-zA-Z0-9-]/g, '')

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    let alive = true
    setError(null)
    // Last-line syntax repair: LLM-generated sources (and stale caches) may
    // carry edge labels the flowchart grammar rejects (e.g. 触发(emit)) —
    // fixing here means a page refresh alone renders them again.
    const safeSource = sanitizeMermaid(source)
    const cached = svgCache.get(safeSource)
    if (cached !== undefined) {
      host.innerHTML = cached
      svgRef.current = host.querySelector('svg')
      setFitTick(t => t + 1)
      onRenderedRef.current?.()
      return () => { alive = false }
    }
    const run = async (): Promise<void> => {
      try {
        const { svg } = await mermaid.render(`archLensDiagram-${idBase}-${attempt}`, safeSource)
        if (!alive) return
        host.innerHTML = svg
        svgRef.current = host.querySelector('svg')
        svgCache.set(safeSource, svg)
        setFitTick(t => t + 1)
        onRenderedRef.current?.()
      } catch (reason) {
        if (!alive) return
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(message)
        onRenderErrorRef.current?.(message)
      }
    }
    void run()
    return () => { alive = false }
  }, [source, idBase, attempt])

  // Fit the freshly rendered SVG into the container: full view first. Runs
  // again after every fitTick (the SVG may land asynchronously after mount)
  // and whenever the host is resized (the desk's unit panes flip
  // display none→flex, so a figure mounted inside a hidden pane must re-fit
  // once it becomes visible).
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const fit = (): void => {
      const svg = svgRef.current
      if (host === null || svg === null) return
      const vb = svg.viewBox.baseVal
      if (vb.width <= 0 || vb.height <= 0) return
      const cw = host.clientWidth
      if (cw <= 0) return
      // The host div grows to fit the rendered SVG, so its own height is the
      // diagram height, not the visible area. Walk up to the first ancestor
      // whose height actually constrains the diagram (the desk's unit pane,
      // the drill overlay) so the whole figure fits inside it instead of
      // needing vertical scrolling.
      let viewport: HTMLElement | null = host
      while (viewport !== null) {
        const h = viewport.clientHeight
        if (h > 0 && h < vb.height) break
        viewport = viewport.parentElement
      }
      const ch = viewport !== null && viewport.clientHeight > 0 ? viewport.clientHeight : host.clientHeight
      if (ch <= 0) return
      const scale = Math.min(cw / vb.width, ch / vb.height, 1)
      setView({
        scale,
        x: (cw - vb.width * scale) / 2,
        y: (ch - vb.height * scale) / 2,
      })
      setReady(true)
    }
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { fit() }) : null
    if (ro !== null) ro.observe(host)
    return () => {
      if (ro !== null) ro.disconnect()
    }
  }, [source, attempt, fitTick])

  // Apply the pan/zoom transform to the injected SVG.
  useEffect(() => {
    const svg = svgRef.current
    if (svg === null) return
    svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    svg.style.transformOrigin = '0 0'
  }, [view])

  // Node/entity click delegation: flowchart nodes are g.node, ER entities are
  // g.entity; the first <text> inside is the node label (package short name).
  // Drags over a node must not count as clicks.
  useEffect(() => {
    const host = hostRef.current
    if (host === null || onSelectNode === undefined) return
    const onClick = (event: MouseEvent): void => {
      if (dragRef.current?.moved === true) return
      const target = event.target
      if (!(target instanceof Element)) return
      const node = target.closest('g.node, g.entity')
      if (node === null) return
      const { label } = labelOf(node)
      if (label !== '') onSelectNode(label)
    }
    host.addEventListener('click', onClick)
    return () => { host.removeEventListener('click', onClick) }
  }, [hostRef, onSelectNode])

  // RIGHT-click on a node/entity/EDGE/subgraph title: prevent the browser menu
  // and hand the label + KIND to the caller — arch-lens accumulates the pick
  // as a selection CHIP (multi-select for this scene; the composed intent =
  // chips + user text + button verb). Node > cluster > edge priority, first
  // hit wins.
  useEffect(() => {
    const host = hostRef.current
    if (host === null || onNodeContext === undefined) return
    // An edge hit yields its VISIBLE label: flowchart `g.edgeLabel` div text,
    // sequence `text.messageText`; a bare LINE (no label under the cursor)
    // resolves to its paired message text (DOM order pairing) or, for
    // flowchart paths, the unambiguous `L_from_to_n` id (only when from/to
    // themselves hold no `_` — a guessed split is worse than no chip).
    const edgeLabelOf = (target: Element): string | null => {
      const seqText = target.closest('text.messageText')
      if (seqText !== null) return (seqText.textContent ?? '').trim() || null
      const edgeG = target.closest('g.edgeLabel')
      if (edgeG !== null) {
        const { label } = labelOf(edgeG)
        return label !== '' ? label : null
      }
      const line = target.closest('line[class^="messageLine"]')
      if (line !== null) {
        const root: Element = line instanceof SVGElement ? line.ownerSVGElement ?? host : host
        const lines = Array.from(root.querySelectorAll('line[class^="messageLine"]'))
        const texts = Array.from(root.querySelectorAll('text.messageText'))
        const index = lines.indexOf(line)
        const paired = index >= 0 ? (texts[index]?.textContent ?? '').trim() : ''
        return paired !== '' ? paired : null
      }
      // Bare flowchart edge line → parse its `<renderId>-L_A_B_0` id via the
      // shared leaf (golden-cased in tests; ambiguous splits yield no chip).
      const path = target.closest('path')
      return path !== null ? edgeLabelFromPathId(path.id ?? '') : null
    }
    const onContext = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const node = target.closest('g.node, g.entity')
      if (node !== null) {
        const { label } = labelOf(node)
        if (label !== '') {
          event.preventDefault()
          onNodeContext(label, 'node')
        }
        return
      }
      const cluster = target.closest('g.cluster')
      if (cluster !== null) {
        const { label } = labelOf(cluster)
        if (label !== '') {
          event.preventDefault()
          onNodeContext(label, 'subgraph')
        }
        return
      }
      const edge = edgeLabelOf(target)
      if (edge !== null) {
        event.preventDefault()
        onNodeContext(edge, 'edge')
      }
    }
    host.addEventListener('contextmenu', onContext)
    return () => { host.removeEventListener('contextmenu', onContext) }
  }, [hostRef, onNodeContext])

  // Subgraph hover: while the pointer is over a flowchart SUBGRAPH TITLE, the
  //「🤖 动态画图」button floats above it. Detection is GEOMETRIC — pointer vs
  // each cluster title's bounding rect — because DOM-target hit-testing broke
  // whenever an edge label or curve rendered ON TOP of the title swallowed
  // the event (hover flickered exactly where the text was occluded). The
  // button lives OUTSIDE the host div: moving onto it fires the host's
  // mouseleave, so hiding goes through a short grace timer that the button's
  // own mouseenter cancels (previously it unmounted under the cursor mid-
  // click — 「一会出现一会不出现」). Hovering cluster child nodes must not
  // trigger it: only title rectangles count.
  useEffect(() => {
    const host = hostRef.current
    if (host === null || onClusterAction === undefined) return
    const margin = 14
    const onMove = (event: MouseEvent): void => {
      const svg = svgRef.current
      if (svg === null) return
      const clusters = Array.from(svg.querySelectorAll('g.cluster'))
      for (const cluster of clusters) {
        const { label, el } = labelOf(cluster)
        if (el === null || label === '') continue
        const rect = el.getBoundingClientRect()
        if (event.clientX >= rect.left - margin && event.clientX <= rect.right + margin
          && event.clientY >= rect.top - margin && event.clientY <= rect.bottom + margin) {
          cancelBtnHide()
          const hostRect = host.getBoundingClientRect()
          setClusterBtn({ label, x: rect.right - hostRect.left, y: rect.top - hostRect.top - 4 })
          return
        }
      }
      if (!btnHoverRef.current) setClusterBtn(null)
    }
    host.addEventListener('mousemove', onMove)
    host.addEventListener('mouseleave', scheduleBtnHide)
    return () => {
      cancelBtnHide()
      btnHoverRef.current = false
      host.removeEventListener('mousemove', onMove)
      host.removeEventListener('mouseleave', scheduleBtnHide)
    }
  }, [hostRef, onClusterAction])

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
      // Keep the point under the cursor stationary: the cursor maps to the
      // same SVG coordinate before and after the scale.
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
    const svg = svgRef.current
    if (host === null || svg === null) return
    const vb = svg.viewBox.baseVal
    if (vb.width <= 0 || vb.height <= 0) return
    const scale = Math.min(host.clientWidth / vb.width, host.clientHeight / vb.height, 1)
    setView({
      scale,
      x: (host.clientWidth - vb.width * scale) / 2,
      y: (host.clientHeight - vb.height * scale) / 2,
    })
  }

  return h('div', {
    className: css.view,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp: endDrag,
    onMouseLeave: endDrag,
    onDoubleClick: resetView,
  },
    h('div', {
      ref: hostRef,
      className: `${css.host} ${dragRef.current?.moved === true ? css.grabbing : css.grab}`,
      // Hidden until the first fit lands (see `ready`): never show the SVG at
      // natural scale before the container fit shrinks it.
      style: { opacity: ready ? 1 : 0 },
    }),
    clusterBtn !== null && onClusterAction !== undefined
      ? h('button', {
          className: css.dynBtn,
          style: { left: clusterBtn.x, top: clusterBtn.y },
          // The button keeps its own hover truth so the host-side grace timer
          // can defer hiding while the pointer travels onto it; leaving it
          // hides immediately (moving back over a title re-shows via move).
          onMouseEnter: (): void => { btnHoverRef.current = true; cancelBtnHide() },
          onMouseLeave: (): void => { btnHoverRef.current = false; setClusterBtn(null) },
          onClick: (): void => { btnHoverRef.current = false; setClusterBtn(null); onClusterAction(clusterBtn.label) },
        }, '🤖 动态画图')
      : null,
    error !== null
      ? h('div', { className: css.error },
          h('div', null, `Mermaid 渲染失败：${error}`),
          h('button', { className: css.btn, onClick: () => setAttempt(value => value + 1) }, '↻ 重试'),
        )
      : null,
  )
}
