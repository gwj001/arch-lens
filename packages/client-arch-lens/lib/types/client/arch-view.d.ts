/**
 * Arch Lens main view: unit tabs over the backend Remote, component/event
 * detail popups, same-page chat projection, and the notes panel. This is the
 * single registered conversation.view entry; units are plain tab bodies.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/arch-view
 */
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ArchLensRemote } from './remote.ts';
/** Configured prompts and unit order (defaults live here until Config arrives). */
export interface ArchViewConfig {
    units?: string[];
    overviewPrompt?: string;
    explainStyle?: string;
}
/**
 * The Arch Lens conversation view entry component.
 */
export declare function ArchView(props: ConvViewProps & {
    archLens: ArchLensRemote;
    config: ArchViewConfig;
}): React.JSX.Element;
//# sourceMappingURL=arch-view.d.ts.map