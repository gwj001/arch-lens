/**
 * Arch Lens learning desk, browser half: registers a floating robot in the
 * shell overlay layer. The robot hosts the study units (concept tree, graphs,
 * catalog) and asks questions through the core conversation pipeline —
 * prompts go via `sessions.binding(id).session.prompt(...)`, so answers are
 * rendered by the main chat view with zero custom chat UI.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export type { ArchViewConfig } from './arch-view.tsx';
export type { ArchLensRemote, unwrapRemote } from './remote.ts';
/** Required services: the slot registry and the archLens Remote namespace. */
export declare const inject: string[];
/**
 * The robot's injected face: one send verb bound to a target session. The
 * prompt rides the core session pipeline (`queue` mode), so the main chat
 * view renders the question and its streaming answer.
 */
export interface BotInjected {
    /** Send one prompt into the target session (queued turn). */
    send: (sessionId: string, text: string) => Promise<void>;
}
/**
 * Client plugin body: register the floating robot in the shell overlay. The
 * registration rides the slot service's effect wrapper, so plugin unload
 * removes the robot.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map