/**
 * Notes panel: one summary line for the workspace ARCH-NOTES.md —
 * `笔记记录更新#N yymmdd:hh:ss` with the entry count and the last update
 * time. The full entries live in the note file; no list is shown.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/notes-panel
 */

import { createElement as h } from 'react'
import type { ArchLensNotesResult } from '@deepseek-ai/dsh-arch-lens-backend'
import { ui, uiT } from './i18n.ts'
import css from './notes-panel.module.css'

/**
 * Notes-panel props.
 */
export interface NotesPanelProps {
  notes: ArchLensNotesResult | { error: string } | null
  /** Role language for panel copy. */
  language: string
  /** Lazily load the notes summary (only called when the user asks). */
  onLoad: () => void
}

/** Convert `YYYY-MM-DD HH:MM[:SS]` to `yymmdd:hh:mm[:ss]`. */
export function shortTime(time: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time)
  if (match === null) return time
  const [, year, month, day, hour, minute, second] = match
  return `${year!.slice(2)}${month}${day}:${hour}:${minute}${second !== undefined ? `:${second}` : ''}`
}

/** Render the note summary line (loaded lazily — no automatic notes API call). */
export function NotesPanel(props: NotesPanelProps): React.JSX.Element {
  const { notes, language, onLoad } = props
  const ok = notes !== null && 'error' in notes === false
  const count = ok ? notes.entries.length : 0
  const lastTime = ok && notes.entries.length > 0 ? shortTime(notes.entries[0]!.time) : ''
  if (notes === null) {
    // Lazy: the notes API is only hit when the user clicks to view notes.
    return h('div', { className: css.notes },
      h('button', { className: css.loadBtn, onClick: onLoad }, ui(language, 'notesLoad')))
  }
  return h('div', { className: css.notes },
    notes !== null && 'error' in notes
      ? h('div', { className: css.error }, notes.error)
      : h('div', { className: css.summary },
          h('span', { className: css.title }, uiT(language, 'notesTitle', { count: String(count) })),
          lastTime !== '' ? h('span', { className: css.time }, lastTime) : null,
          h('span', { className: css.hint }, count === 0 ? ui(language, 'notesHintNone') : ui(language, 'notesHintSome')),
        ),
  )
}
