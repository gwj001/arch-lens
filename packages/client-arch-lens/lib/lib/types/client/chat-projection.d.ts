/**
 * Same-page chat projection: the last few user/assistant messages of the
 * current session, read through the conversation snapshot — the UI is a pure
 * projection of the durable log, so answers appear here without switching tabs.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/chat-projection
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
/** One projected message row. */
interface ChatRow {
    role: 'user' | 'ai';
    text: string;
}
/** Extract text rows from the conversation snapshot (last 6, newest last). */
export declare function projectChatRows(nodes: ConversationSnapshot['nodes']): ChatRow[];
/**
 * Chat-projection props: the session snapshot hook plus nothing else.
 */
export interface ChatProjectionProps {
    useSession: ConvViewProps['useSession'];
}
/** Render the recent conversation projection. */
export declare function ChatProjection(props: ChatProjectionProps): React.JSX.Element;
export {};
//# sourceMappingURL=chat-projection.d.ts.map