/**
 * Arch Lens learning desk, browser half: registers a floating robot in the
 * shell overlay layer. The robot hosts the study units (concept tree, graphs,
 * catalog) and asks questions through the core conversation pipeline —
 * prompts go via `sessions.binding(id).session.prompt(...)`, so answers are
 * rendered by the main chat view with zero custom chat UI.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */
import z from '@deepseek-ai/schemastery';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export type { ArchViewConfig } from './arch-view.tsx';
export type { ArchLensRemote, unwrapRemote } from './remote.ts';
/** Required services: the slot registry and the archLens Remote namespace. */
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
}
/**
 * Client plugin body: register the floating robot in the shell overlay. The
 * registration rides the slot service's effect wrapper, so plugin unload
 * removes the robot.
 * @param ctx - client root context.
 * @param config - validated plugin config (icon overrides).
 */
export declare function apply(ctx: ClientContext, config?: Config): void;
//# sourceMappingURL=index.d.ts.map