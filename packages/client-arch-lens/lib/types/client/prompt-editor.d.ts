/**
 * Prompt-config editor for the Arch Lens desk: edits the persisted overview
 * prompt and unit explain style, saved back through the backend Remote. The
 * editor always shows the EFFECTIVE prompt — defaults are filled in when no
 * override exists, so what you see is exactly what will be used.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/prompt-editor
 */
import type { ArchLensPromptConfig } from '@deepseek-ai/dsh-arch-lens-backend';
import type { ArchLensRemote } from './remote.ts';
/**
 * Prompt-editor props.
 */
export interface PromptEditorProps {
    archLens: ArchLensRemote;
    config: ArchLensPromptConfig;
    onSave: (config: ArchLensPromptConfig) => void;
    onClose: () => void;
}
/** Edit and persist the explain prompts. The editor body is the effective prompt. */
export declare function PromptEditor(props: PromptEditorProps): React.JSX.Element;
//# sourceMappingURL=prompt-editor.d.ts.map