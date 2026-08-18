/**
 * Arch Lens study desk: unit tabs over the backend Remote, component/event
 * detail popups, notes summary, and the explain queue. Rendered inside the
 * floating robot panel; questions go through the core conversation pipeline
 * (props.send → session.prompt), so answers appear in the main chat view.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/arch-view
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ArchLensRemote } from './remote.ts';
/** One concept-tree node (wire shape of the backend concept chain). */
export interface ConceptNode {
    id: string;
    name: string;
    desc: string;
    inside?: string;
    pkg?: string;
    children?: ConceptNode[];
    /** 'doc' = extracted from an architecture doc; 'flow' = AI-induced. */
    source?: 'doc' | 'flow';
    /** Source anchor: doc path + heading (evidence for explains). */
    ref?: string;
    /** The section's full original text (evidence for explains). */
    sourceText?: string;
}
/** One sequence message (AI structured cache `.arch-lens-sequence-<lang>.json`). */
export interface SequenceMessage {
    from: string;
    to: string;
    label: string;
}
/** One core interaction row (AI structured cache `.arch-lens-events-<lang>.json`). */
export interface CoreEvent {
    event: string;
    mode: string;
    producers: string[];
    consumers: string[];
    note: string;
}
/** Configured prompts (defaults live here until Config arrives). */
export interface ArchViewConfig {
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
    send: (text: string) => Promise<void>;
    useSessions: PropsRuntime<'shell.overlay'>['useSessions'];
}
/**
 * The Arch Lens study desk entry component.
 */
export declare function ArchView(props: ArchViewProps): React.JSX.Element;
//# sourceMappingURL=arch-view.d.ts.map