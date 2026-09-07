/**
 * Floating robot: a draggable shell-overlay button that opens the Arch Lens
 * study desk panel. The panel hosts the study units (concept tree, graphs,
 * catalog) and sends questions into a selected session through the core
 * conversation pipeline — no chat UI of its own.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/floating-bot
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ArchLensRemote } from './remote.ts'
import { unwrapRemote } from './remote.ts'
import { ArchView } from './arch-view.tsx'
import type { ArchViewConfig } from './arch-view.tsx'
import { DEFAULT_LANGUAGE } from './explain.ts'
import { ui } from './i18n.ts'
import type { BotInjected } from './index.ts'
import css from './floating-bot.module.css'

/** Floating-robot props: shell-overlay runtime share + the send face + the desk config. */
export type FloatingBotProps = PropsRuntime<'shell.overlay'> & BotInjected & {
  archLens: ArchLensRemote
  config: ArchViewConfig
  /** Idle icon text/emoji (deployer-configurable). */
  icon?: string
  /** Busy icon text (deployer-configurable). */
  busyIcon?: string
}

const POS_KEY = 'arch-lens-bot-pos'
const FAB_KEY = 'arch-lens-fab-pos'
const SIZE_KEY = 'arch-lens-panel-size'
/** Default desk window size; 放大/缩小 step it and the corner/edge handles drag it. */
const BASE_SIZE = { w: 960, h: 640 }
const MIN_SIZE = { w: 320, h: 240 }

/** Clamp a window size into [MIN_SIZE, viewport - margin]. */
function clampSize(w: number, h: number): { w: number; h: number } {
  const maxW = Math.max(MIN_SIZE.w, window.innerWidth - 32)
  const maxH = Math.max(MIN_SIZE.h, window.innerHeight - 120)
  return {
    w: Math.round(Math.min(Math.max(w, MIN_SIZE.w), maxW)),
    h: Math.round(Math.min(Math.max(h, MIN_SIZE.h), maxH)),
  }
}

/** The shell-overlay floating robot. */
export function FloatingBot(props: FloatingBotProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null)
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE)
  // Desk window size and fullscreen toggle. 放大/缩小 step the window size and
  // the corner/edge handles drag it; content stays at natural scale and reflows
  // inside the frame (no CSS zoom of text/diagrams), so nothing spills outside.
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    try {
      const raw = window.localStorage.getItem(SIZE_KEY)
      if (raw !== null) {
        const saved = JSON.parse(raw) as { w?: number; h?: number }
        if (typeof saved.w === 'number' && typeof saved.h === 'number' && saved.w > 0 && saved.h > 0) {
          return clampSize(saved.w, saved.h)
        }
      }
    } catch { /* corrupted saved size is ignored */ }
    return clampSize(BASE_SIZE.w, BASE_SIZE.h)
  })
  const [fullscreen, setFullscreen] = useState(false)
  // Current viewport: re-clamps an enlarged window when the browser resizes.
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  // The desk always follows the sidebar: the target session IS the current
  // session, so no picker and no separate state — a sidebar switch re-renders
  // with the new current and ArchView re-points the data source on its own.
  const currentSessionId = props.useSessions(state => state.current)
  const sessionId = currentSessionId ?? null
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const fabDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)
  const resizeRef = useRef<{
    startX: number
    startY: number
    origW: number
    origH: number
    mode: 'right' | 'bottom' | 'corner'
  } | null>(null)

  // Role language for panel copy (same source the desk uses). Runs once on
  // mount — the desk re-fetches it internally on its own effect.
  useEffect(() => {
    void unwrapRemote(props.archLens.promptConfig()).then(result => {
      setLanguage(result.config.language ?? DEFAULT_LANGUAGE)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Panel position: restore the saved spot, else top-right corner.
  useEffect(() => {
    if (pos !== null) return
    let saved: { x: number; y: number } | null = null
    try {
      const raw = window.localStorage.getItem(POS_KEY)
      if (raw !== null) saved = JSON.parse(raw) as { x: number; y: number }
    } catch { /* corrupted saved position is ignored */ }
    setPos(saved ?? { x: Math.max(16, window.innerWidth - 760), y: 72 })
  }, [pos])

  useEffect(() => {
    if (pos !== null) window.localStorage.setItem(POS_KEY, JSON.stringify(pos))
  }, [pos])

  // FAB position: saved spot, else bottom-right corner.
  useEffect(() => {
    if (fabPos !== null) return
    let saved: { x: number; y: number } | null = null
    try {
      const raw = window.localStorage.getItem(FAB_KEY)
      if (raw !== null) saved = JSON.parse(raw) as { x: number; y: number }
    } catch { /* corrupted saved position is ignored */ }
    setFabPos(saved ?? { x: Math.max(16, window.innerWidth - 92), y: Math.max(16, window.innerHeight - 96) })
  }, [fabPos])

  useEffect(() => {
    if (fabPos !== null) window.localStorage.setItem(FAB_KEY, JSON.stringify(fabPos))
  }, [fabPos])

  // Re-clamp the window size when the browser viewport changes.
  useEffect(() => {
    const onViewport = (): void => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onViewport)
    return () => window.removeEventListener('resize', onViewport)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(SIZE_KEY, JSON.stringify(size))
  }, [size])

  // Explain-in-progress state shown on the robot button itself.
  const busy = props.useSessions(state =>
    sessionId === null ? false : (state.byId[sessionId as SessionId]?.running ?? false))

  // Effective window size (clamped to the viewport) and position clamped so an
  // enlarged window never runs off the right/bottom edge of the screen.
  const eff = fullscreen ? null : clampSize(size.w, size.h)
  const left = eff === null ? 0 : Math.max(8, Math.min(pos?.x ?? 16, vp.w - eff.w - 8))
  const top = eff === null ? 0 : Math.max(8, Math.min(pos?.y ?? 72, vp.h - eff.h - 8))

  const onBarDown = (event: React.MouseEvent): void => {
    if (pos === null || fullscreen) return
    dragRef.current = { startX: event.clientX, startY: event.clientY, origX: pos.x, origY: pos.y }
  }

  const onResizeDown = (mode: 'right' | 'bottom' | 'corner', event: React.MouseEvent): void => {
    if (fullscreen || eff === null) return
    event.preventDefault()
    event.stopPropagation()
    resizeRef.current = { startX: event.clientX, startY: event.clientY, origW: eff.w, origH: eff.h, mode }
  }

  const onFabDown = (event: React.MouseEvent): void => {
    if (fabPos === null) return
    fabDragRef.current = { startX: event.clientX, startY: event.clientY, origX: fabPos.x, origY: fabPos.y, moved: false }
  }

  useEffect(() => {
    const move = (event: MouseEvent): void => {
      const resize = resizeRef.current
      if (resize !== null) {
        const dx = event.clientX - resize.startX
        const dy = event.clientY - resize.startY
        const w = resize.mode === 'right' || resize.mode === 'corner' ? resize.origW + dx : resize.origW
        const h = resize.mode === 'bottom' || resize.mode === 'corner' ? resize.origH + dy : resize.origH
        setSize(clampSize(w, h))
        event.preventDefault()
        return
      }
      const drag = dragRef.current
      if (drag !== null) {
        setPos({
          x: Math.max(0, drag.origX + event.clientX - drag.startX),
          y: Math.max(0, drag.origY + event.clientY - drag.startY),
        })
      }
      const fab = fabDragRef.current
      if (fab !== null) {
        const dx = event.clientX - fab.startX
        const dy = event.clientY - fab.startY
        if (!fab.moved && Math.hypot(dx, dy) > 5) fab.moved = true
        if (fab.moved) {
          setFabPos({
            x: Math.max(0, fab.origX + dx),
            y: Math.max(0, fab.origY + dy),
          })
        }
      }
    }
    const up = (): void => {
      dragRef.current = null
      resizeRef.current = null
      // The click event fires after mouseup, so the FAB drag verdict must
      // survive until the click handler has read it. Clear on a later task as
      // a fallback for releases outside the button, where no click fires.
      window.setTimeout(() => {
        fabDragRef.current = null
      }, 0)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  return h('div', { className: css.root },
    open && pos !== null
      ? h('div', {
          className: `${css.panel} ${fullscreen ? css.fullscreen : ''}`,
          style: fullscreen ? undefined : (eff === null ? undefined : { left, top, width: eff.w, height: eff.h }),
        },
          h('div', { className: css.bar, onMouseDown: onBarDown },
            h('span', { className: css.title }, ui(language, 'title')),
            h('span', { className: css.spacer }),
            h('button', { className: css.btn, onClick: () => setSize(s => clampSize(s.w * 0.8, s.h * 0.8)), title: '缩小窗口' }, '缩小'),
            h('button', { className: css.btn, onClick: () => setSize(s => clampSize(s.w * 1.25, s.h * 1.25)), title: '放大窗口' }, '放大'),
            h('button', { className: `${css.btn} ${fullscreen ? css.btnActive : ''}`, onClick: () => setFullscreen(v => !v), title: fullscreen ? '退出满屏' : '满屏' }, '满屏'),
            h('button', { className: css.btn, onClick: () => setOpen(false) }, '✕'),
          ),
          // Content renders at natural scale inside the sized window (no CSS
          // transform), so diagrams reflow with the frame instead of spilling
          // outside it. Drag the right/bottom edge or the corner to resize.
          h('div', { className: css.body },
            h(ArchView, {
              archLens: props.archLens,
              config: props.config,
              sessionId,
              useSessions: props.useSessions,
              send: (text: string) => {
                if (sessionId === null) return Promise.reject(new Error('未选择目标会话'))
                return props.send(sessionId, text)
              },
              cancel: (id: string) => props.cancel(id),
              sessionEvents: props.sessionEvents,
            })),
          !fullscreen && eff !== null
            ? [
                h('div', { className: css.resizeRight, onMouseDown: (event: React.MouseEvent) => onResizeDown('right', event) }),
                h('div', { className: css.resizeBottom, onMouseDown: (event: React.MouseEvent) => onResizeDown('bottom', event) }),
                h('div', { className: css.resizeCorner, onMouseDown: (event: React.MouseEvent) => onResizeDown('corner', event) }),
              ]
            : null,
        )
      : null,
    h('button', {
      className: `${css.fab} ${busy ? css.busy : ''}`,
      style: fabPos !== null ? { left: fabPos.x, top: fabPos.y } : undefined,
      title: busy ? ui(language, 'fabBusyTitle') : ui(language, 'fabTitle'),
      onMouseDown: onFabDown,
      onClick: () => {
        // A real drag must not toggle the panel; consume the verdict now.
        const fab = fabDragRef.current
        fabDragRef.current = null
        if (fab?.moved === true) return
        setOpen(value => !value)
      },
    }, busy
      ? h('span', { className: css.dots }, h('span', null), h('span', null), h('span', null))
      : (open ? '✕' : (props.icon ?? '🤖'))),
  )
}
