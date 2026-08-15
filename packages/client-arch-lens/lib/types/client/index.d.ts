/**
 * Arch Lens learning desk, browser half: registers the 'arch' entry in the
 * conversation view ring and renders the study units over the archLens Remote.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export type { ArchViewConfig } from './arch-view.tsx';
export type { ArchLensRemote, unwrapRemote } from './remote.ts';
/** Required services: the slot registry and the archLens Remote namespace. */
export declare const inject: string[];
/**
 * Client plugin body: register the 'arch' conversation view entry. The
 * registration rides the slot service's effect wrapper, so plugin unload
 * removes the tab.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map