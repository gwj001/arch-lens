/**
 * Arch Lens learning desk, browser half: registers a floating robot in the
 * shell overlay layer. The robot hosts the study units (concept tree, graphs,
 * catalog) and asks questions through the core conversation pipeline —
 * prompts go via `sessions.binding(id).session.prompt(...)`, so answers are
 * rendered by the main chat view with zero custom chat UI.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */
import z from '@deepseek-ai/schemastery';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { ClientSessionEventSource } from './session-events.ts';
export type { ArchViewConfig } from './arch-view.tsx';
export type { ArchLensRemote, unwrapRemote } from './remote.ts';
/** Required services: the slot registry, the Remote mount seat, and sessions. */
export declare const inject: string[];
/**
 * Plugin config. The robot icon is a configurable surface: deployers (or
 * fork maintainers) change it in their cordis.yml without touching code.
 */
export interface Config {
    /** Floating-robot icon text/emoji shown when idle (default '🤖'). */
    botIcon?: string;
    /** Floating-robot icon shown while the explainer is busy (default '…' with a pulse animation). */
    busyIcon?: string;
}
export declare const Config: z<Config>;
/**
 * The robot's injected face: one send verb bound to a target session. The
 * prompt rides the core session pipeline (`queue` mode), so the main chat
 * view renders the question and its streaming answer.
 */
export interface BotInjected {
    /** Send one prompt into the target session (queued turn). */
    send: (sessionId: string, text: string) => Promise<void>;
    /** Cancel the target session's running turn (the same path the GUI's own
     * stop action uses — reaches the running agent, not just the backend's
     * AbortController). */
    cancel: (sessionId: string) => Promise<void>;
    /** The target session's live event feed (getSnapshot + subscribe). */
    sessionEvents: (sessionId: string) => ClientSessionEventSource | undefined;
}
/**
 * Client plugin body: mount the generated archLens Remote contribution, then
 * register the floating robot in the shell overlay. The Remote namespace does
 * not exist at plugin activation — the release harness no longer mounts it —
 * so the UI waits for it in a nested fiber, and activation never blocks boot.
 * The registration rides the slot service's effect wrapper, so plugin unload
 * removes the robot.
 * @param ctx - client root context.
 * @param config - validated plugin config (icon overrides).
 * @returns disposer unwinding the Remote namespace and the overlay registration.
 */
export declare function apply(ctx: ClientContext, config?: Config): Promise<() => Promise<void>>;
//# sourceMappingURL=index.d.ts.map