/**
 * Structural mirror of the session controller's client-side event feed
 * (`sessions.binding(id).eventSource`). Arch Lens consumes it to refresh a
 * session-driven figure the instant the agent's answer arrives — no polling.
 * Kept structural (no import of the harness controller package) to avoid the
 * host-side `Context.sessions` merge shadowing described in index.ts.
 * @module @deepseek-ai/dsh-client-arch-lens/client/session-events
 */
/** One session event, narrowed to the fields figure-refresh needs. */
export interface ClientSessionEvent {
    type: string;
    data?: {
        message?: {
            content?: Array<{
                type?: string;
                text?: string;
            }>;
        };
    };
}
/** One event-window entry (live events arrive as `{ type: 'event', event }`). */
export interface ClientSessionEventEntry {
    type: 'event' | 'chunks';
    event: ClientSessionEvent;
}
/** Exact delta that produced the latest window revision. */
export interface ClientSessionEventChange {
    kind: 'replace' | 'prepend' | 'append';
    entries: readonly ClientSessionEventEntry[];
}
/** Current contiguous event window and its latest delta. */
export interface ClientSessionEventWindow {
    entries: readonly ClientSessionEventEntry[];
    hasMore: boolean;
    revision: number;
    change: ClientSessionEventChange;
}
/** Observable event feed exposed by one Session binding (getSnapshot + subscribe). */
export interface ClientSessionEventSource {
    getSnapshot(): ClientSessionEventWindow;
    subscribe(listener: () => void): () => void;
}
/** Extract the plain text of an assistant/message entry ('' for anything else). */
export declare function eventAnswerText(entry: ClientSessionEventEntry): string;
//# sourceMappingURL=session-events.d.ts.map