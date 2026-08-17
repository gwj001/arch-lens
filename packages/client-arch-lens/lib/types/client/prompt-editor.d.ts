/**
 * Prompt-config editor for the Arch Lens desk: edits the persisted overview
 * prompt and unit explain style, saved back through the backend Remote. A
 * mode switch chooses between "my prompts" (the saved overrides, editable)
 * and "default templates" (per-language built-ins, read-only, switched by
 * the role language). The editor always shows the EFFECTIVE prompt — when no
 * override exists, the defaults are filled in, so what you see is exactly
 * what will be used.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/prompt-editor
 */
import type { ArchLensPromptConfig } from '@deepseek-ai/dsh-arch-lens-backend';
import type { ArchLensRemote } from './remote.ts';
/** Deployment-level prompt defaults the editor falls back to in default mode. */
export interface PromptEditorBase {
    overviewPrompt?: string;
    explainStyle?: string;
}
/**
 * Prompt-editor props.
 */
export interface PromptEditorProps {
    archLens: ArchLensRemote;
    config: ArchLensPromptConfig;
    base: PromptEditorBase;
    onSave: (config: ArchLensPromptConfig) => void;
    onClose: () => void;
}
/** Edit and persist the explain prompts. The editor body is the effective prompt. */
export declare function PromptEditor(props: PromptEditorProps): React.JSX.Element;
//# sourceMappingURL=prompt-editor.d.ts.map