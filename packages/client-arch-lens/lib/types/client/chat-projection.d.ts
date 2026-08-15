/**
 * Same-page full conversation stream: every user/assistant message of the
 * current session, read through the conversation snapshot. Assistant text
 * renders with the same MarkdownText engine as the main chat view, including
 * the streaming tail. Historical rows are memoized per message node (stable
 * references), so each streaming chunk only re-renders the streaming tail —
 * long conversations stay smooth. The area is height-bounded and collapsible.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/chat-projection
 */
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
/**
 * Chat-projection props: the session snapshot hook plus nothing else.
 */
export interface ChatProjectionProps {
    useSession: ConvViewProps['useSession'];
}
/** Render the full conversation stream (collapsible, auto-scrolling). */
export declare function ChatProjection(props: ChatProjectionProps): React.JSX.Element;
//# sourceMappingURL=chat-projection.d.ts.map