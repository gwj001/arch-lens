/**
 * Floating robot: a draggable shell-overlay button that opens the Arch Lens
 * study desk panel. The panel hosts the study units (concept tree, graphs,
 * catalog) and sends questions into a selected session through the core
 * conversation pipeline — no chat UI of its own.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/floating-bot
 */

import { createElement as h, useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArchLensRemote } from './remote.ts'
import { ArchView } from './arch-view.tsx'
import type { ArchViewConfig } from './arch-view.tsx'
import type { BotInjected } from './index.ts'
import css from './floating-bot.module.css'

/** Floating-robot props: shell-overlay runtime share + the send face + the desk config. */
export type FloatingBotProps = PropsRuntime<'shell.overlay'> & BotInjected & {
  archLens: ArchLensRemote
  config: ArchViewConfig
}

const POS_KEY = 'arch-lens-bot-pos'

/** The shell-overlay floating robot. */
export function FloatingBot(props: FloatingBotProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionList = props.useSessions(state => ({ ids: state.ids, current: state.current }))
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

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

  // Default target session: the currently selected one.
  useEffect(() => {
    if (sessionId === null && sessionList.current !== undefined) setSessionId(sessionList.current)
  }, [sessionList.current, sessionId])

  const onBarDown = (event: React.MouseEvent): void => {
    if (pos === null) return
    dragRef.current = { startX: event.clientX, startY: event.clientY, origX: pos.x, origY: pos.y }
  }

  useEffect(() => {
    const move = (event: MouseEvent): void => {
      const drag = dragRef.current
      if (drag === null) return
      setPos({
        x: Math.max(0, drag.origX + event.clientX - drag.startX),
        y: Math.max(0, drag.origY + event.clientY - drag.startY),
      })
    }
    const up = (): void => { dragRef.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  return h('div', { className: css.root },
    open && pos !== null
      ? h('div', { className: css.panel, style: { left: pos.x, top: pos.y } },
          h('div', { className: css.bar, onMouseDown: onBarDown },
            h('span', { className: css.title }, '🧭 架构学习台'),
            h('select', {
              className: css.session,
              value: sessionId ?? '',
              title: '讲解目标会话（回复渲染在所选会话的主对话中）',
              onClick: (event: React.MouseEvent) => event.stopPropagation(),
              onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setSessionId(event.target.value === '' ? null : event.target.value),
            },
              h('option', { value: '', disabled: true }, '选择会话…'),
              sessionList.ids.map(id => h('option', { key: id, value: id }, id))),
            h('button', { className: css.btn, onClick: () => setOpen(false) }, '✕'),
          ),
          h('div', { className: css.body },
            h(ArchView, {
              archLens: props.archLens,
              config: props.config,
              sessionId,
              useSessions: props.useSessions,
              send: (text: string) => {
                if (sessionId !== null) void props.send(sessionId, text).catch(() => {})
              },
            })),
        )
      : null,
    h('button', {
      className: css.fab,
      title: open ? '收起架构学习台' : '打开架构学习台（可拖动面板）',
      onClick: () => setOpen(value => !value),
    }, open ? '✕' : '🤖'),
  )
}
