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

/** The shell-overlay floating robot. */
export function FloatingBot(props: FloatingBotProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null)
  const [language, setLanguage] = useState<string>(DEFAULT_LANGUAGE)
  // Desk zoom (0.5–2.5, step 0.25) and fullscreen toggle for the study panel.
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  // The desk always follows the sidebar: the target session IS the current
  // session, so no picker and no separate state — a sidebar switch re-renders
  // with the new current and ArchView re-points the data source on its own.
  const currentSessionId = props.useSessions(state => state.current)
  const sessionId = currentSessionId ?? null
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const fabDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null)

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

  // Explain-in-progress state shown on the robot button itself.
  const busy = props.useSessions(state =>
    sessionId === null ? false : (state.byId[sessionId as SessionId]?.running ?? false))

  const onBarDown = (event: React.MouseEvent): void => {
    if (pos === null || fullscreen) return
    dragRef.current = { startX: event.clientX, startY: event.clientY, origX: pos.x, origY: pos.y }
  }

  const onFabDown = (event: React.MouseEvent): void => {
    if (fabPos === null) return
    fabDragRef.current = { startX: event.clientX, startY: event.clientY, origX: fabPos.x, origY: fabPos.y, moved: false }
  }

  useEffect(() => {
    const move = (event: MouseEvent): void => {
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
          className: `${css.panel} ${fullscreen ? css.fullscreen : ''} ${zoom !== 1 ? css.panelZoomed : ''}`,
          style: fullscreen ? undefined : { left: pos.x, top: pos.y },
        },
          h('div', { className: css.bar, onMouseDown: onBarDown },
            h('span', { className: css.title }, ui(language, 'title')),
            h('span', { className: css.spacer }),
            h('button', { className: css.btn, onClick: () => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2))), title: '缩小' }, '缩小'),
            h('button', { className: css.btn, onClick: () => setZoom(z => Math.min(2.5, +(z + 0.25).toFixed(2))), title: '放大' }, '放大'),
            h('button', { className: `${css.btn} ${fullscreen ? css.btnActive : ''}`, onClick: () => setFullscreen(v => !v), title: fullscreen ? '退出满屏' : '满屏' }, '满屏'),
            h('button', { className: css.btn, onClick: () => setOpen(false) }, '✕'),
          ),
          // The bar stays at natural size; only the content zooms (scale from
          // the top-left), so 缩小/放大/满屏/✕ remain reachable at any zoom.
          h('div', { className: css.body },
            h('div', { className: css.zoomLayer, style: { transform: `scale(${zoom})`, transformOrigin: 'top left' } },
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
              })),
          ),
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
