/**
 * Notes panel: one summary line for the workspace ARCH-NOTES.md —
 * `笔记记录更新#N yymmdd:hh:ss` with the entry count and the last update
 * time. The full entries live in the note file; no list is shown.
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
    /** Role language for panel copy. */
    language: string;
    /** Lazily load the notes summary (only called when the user asks). */
    onLoad: () => void;
}
/** Convert `YYYY-MM-DD HH:MM[:SS]` to `yymmdd:hh:mm[:ss]`. */
export declare function shortTime(time: string): string;
/** Render the note summary line (loaded lazily — no automatic notes API call). */
export declare function NotesPanel(props: NotesPanelProps): React.JSX.Element;
//# sourceMappingURL=notes-panel.d.ts.map