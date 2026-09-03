/**
 * Structural mirror of the session controller's client-side event feed
 * (`sessions.binding(id).eventSource`). Arch Lens consumes it to refresh a
 * session-driven figure the instant the agent's answer arrives — no polling.
 * Kept structural (no import of the harness controller package) to avoid the
 * host-side `Context.sessions` merge shadowing described in index.ts.
 * @module @deepseek-ai/dsh-client-arch-lens/client/session-events
 */
/** Extract the plain text of an assistant/message entry ('' for anything else). */
export function eventAnswerText(entry) {
    if (entry.type !== 'event' || entry.event.type !== 'assistant/message')
        return '';
    let text = '';
    for (const block of entry.event.data?.message?.content ?? []) {
        if (block.type === 'text')
            text += block.text ?? '';
    }
    return text;
}
//# sourceMappingURL=session-events.js.map