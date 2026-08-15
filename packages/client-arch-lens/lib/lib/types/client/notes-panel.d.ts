/**
 * Notes panel: read-only listing of the workspace ARCH-NOTES.md entries.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/notes-panel
 */
import type { ArchLensNotesResult } from '@deepseek-ai/dsh-arch-lens-backend';
/**
 * Notes-panel props.
 */
export interface NotesPanelProps {
    notes: ArchLensNotesResult | {
        error: string;
    } | null;
}
/** Render the note listing, newest first. */
export declare function NotesPanel(props: NotesPanelProps): React.JSX.Element;
//# sourceMappingURL=notes-panel.d.ts.map