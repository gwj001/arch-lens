/**
 * Arch Lens study desk: unit tabs over the backend Remote, component/event
 * detail popups, notes summary, and the explain queue. Rendered inside the
 * floating robot panel; questions go through the core conversation pipeline
 * (props.send → session.prompt), so answers appear in the main chat view.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/arch-view
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ArchLensRemote } from './remote.ts';
/** Configured prompts and unit order (defaults live here until Config arrives). */
export interface ArchViewConfig {
    units?: string[];
    overviewPrompt?: string;
    explainStyle?: string;
}
/**
 * The study-desk props: the backend Remote, the desk config, the target
 * session id, the session-list hook (busy state), and a send verb bound to
 * the target session by the floating robot.
 */
export interface ArchViewProps {
    archLens: ArchLensRemote;
    config: ArchViewConfig;
    sessionId: string | null;
    send: (text: string) => void;
    useSessions: PropsRuntime<'shell.overlay'>['useSessions'];
}
/**
 * The Arch Lens study desk entry component.
 */
export declare function ArchView(props: ArchViewProps): React.JSX.Element;
//# sourceMappingURL=arch-view.d.ts.map