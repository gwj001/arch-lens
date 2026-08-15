/**
 * Same-page full conversation stream: every user/assistant message of the
 * current session, read through the conversation snapshot. Assistant text
 * renders with the same MarkdownText engine as the main chat view, including
 * the streaming tail. Historical rows are memoized per message node (stable
 * references), so each streaming chunk only re-renders the streaming tail —
 * long conversations stay smooth. The area is height-bounded and collapsible.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/chat-projection
 */

import { createElement as h, Component, memo, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './chat-projection.module.css'

/**
 * Chat-projection props: the session snapshot hook plus nothing else.
 */
export interface ChatProjectionProps {
  useSession: ConvViewProps['useSession']
}

/** Text of one user-side node (user/steering/context), unfiltered. */
function userText(node: ConversationSnapshot['nodes'][number]): string {
  if (node.kind !== 'user' && node.kind !== 'steering' && node.kind !== 'context') return ''
  return node.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Text of one assistant node, unfiltered. */
function assistantText(node: ConversationSnapshot['nodes'][number]): string {
  if (node.kind !== 'assistant') return ''
  return node.blocks.filter(block => block.kind === 'text').map(block => block.text).join('')
}

/**
 * One settled message row. Memoized on the node reference: message objects in
 * the snapshot are stable across streaming chunk updates, so historical rows
 * never re-render while a new answer is typing.
 */
const MessageRow = memo(function MessageRow({ node }: { node: ConversationSnapshot['nodes'][number] }): React.JSX.Element {
  if (node.kind === 'user' || node.kind === 'steering' || node.kind === 'context') {
    const text = userText(node)
    if (text === '') return h('span', null)
    return h('div', { className: css.rowUser },
      h('div', { className: css.role }, '你'),
      h('div', { className: `${css.bubble} ${css.bubbleUser}` }, text))
  }
  if (node.kind === 'assistant') {
    const text = assistantText(node)
    if (text === '') return h('span', null)
    return h('div', { className: css.rowAi },
      h('div', { className: css.role }, 'AI'),
      h('div', { className: `${css.bubble} ${css.bubbleAi}` }, h(MarkdownText, { text })))
  }
  return h('span', null)
})

/** Streaming tail row: re-renders per chunk, MarkdownText streams incrementally. */
function PartialRow(props: { blocks: ConversationSnapshot['partial'] }): React.JSX.Element | null {
  const { blocks } = props
  const text = useMemo(() => blocks !== null
    ? blocks.blocks.filter(block => block.kind === 'text').map(block => block.text).join('')
    : '', [blocks])
  if (text === '') return null
  return h('div', { className: css.rowAi },
    h('div', { className: css.role }, 'AI'),
    h('div', { className: `${css.bubble} ${css.bubbleAi}` }, h(MarkdownText, { text, streaming: true })))
}

/** Error boundary: a single broken message must not kill the whole arch view. */
class ChatBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): React.ReactNode {
    return this.state.failed ? h('div', { className: css.hint }, '对话渲染失败，已折叠（不影响其他功能）') : this.props.children
  }
}

/** Render the full conversation stream (collapsible, auto-scrolling). */
export function ChatProjection(props: ChatProjectionProps): React.JSX.Element {
  const nodes = props.useSession(snapshot => snapshot.nodes)
  const partial = props.useSession(snapshot => snapshot.partial)
  const [collapsed, setCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [nodes, partial, collapsed])

  const rows = useMemo(() => nodes.map(node => h(MessageRow, { key: node.seq, node })), [nodes])

  return h(ChatBoundary, null,
    h('div', { className: collapsed ? `${css.chat} ${css.collapsed}` : css.chat },
      h('div', { className: css.bar },
        h('span', { className: css.title }, '📋 当前对话（与主对话同一会话，AI 回复实时显示）'),
        h('span', { className: css.spacer }),
        h('button', { className: css.btn, onClick: () => setCollapsed(value => !value) }, collapsed ? '展开' : '收起'),
      ),
      h('div', { ref: scrollRef, className: css.scroll },
        rows.length === 0 && partial === null
          ? h('div', { className: css.hint }, '暂无消息——点「🤖 讲解」后，回复会出现在这里')
          : h('div', null, rows, h(PartialRow, { blocks: partial })),
      ),
    ),
  )
}
