/**
 * Floating robot: a draggable shell-overlay button that opens the Arch Lens
 * study desk panel. The panel hosts the study units (concept tree, graphs,
 * catalog) and sends questions into a selected session through the core
 * conversation pipeline — no chat UI of its own.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/floating-bot
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ArchLensRemote } from './remote.ts';
import type { ArchViewConfig } from './arch-view.tsx';
import type { BotInjected } from './index.ts';
/** Floating-robot props: shell-overlay runtime share + the send face + the desk config. */
export type FloatingBotProps = PropsRuntime<'shell.overlay'> & BotInjected & {
    archLens: ArchLensRemote;
    config: ArchViewConfig;
    /** Idle icon text/emoji (deployer-configurable). */
    icon?: string;
    /** Busy icon text (deployer-configurable). */
    busyIcon?: string;
};
/** The shell-overlay floating robot. */
export declare function FloatingBot(props: FloatingBotProps): React.JSX.Element;
//# sourceMappingURL=floating-bot.d.ts.map