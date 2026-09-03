/**
 * Answer-level ARCH-NOTES.md recording for the Arch Lens backend: the single
 * writer path (host event listener) appends one question/answer entry per
 * completed assistant message and bounds the file.
 *
 * 【已退役 · 机制存档】2026-09 起笔记系整体废弃（index.ts NOTES_FEATURE_OFF=true）：
 * 讲解会话历史本身就是笔记，ARCH-NOTES.md 只是抄录问答的有损子集（图记不住），
 * 抄录不再执行。本模块全部导出（MAX_NOTE_ENTRIES / appendNote / isDuplicate /
 * trimToLimit / parseNotes / readNotes）仅作存档保留，供未来复用决策参考，勿当
 * 活跃机制；「讲解即记录」由会话历史 + 章讲解版本化（explain-cache.ts）承担。
 * @module @deepseek-ai/dsh-arch-lens-backend/src/notes
 */
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { ArchLensNotesResult } from './types.ts';
/** [已退役] Max note entries kept in the file; older entries are trimmed from the head. */
export declare const MAX_NOTE_ENTRIES = 200;
/** One parsed note entry from the file. */
interface ParsedEntry {
    heading: string;
    body: string[];
}
/**
 * [已退役] Append one note entry to `ARCH-NOTES.md` under the workspace root and bound
 * the file to {@link MAX_NOTE_ENTRIES} entries. This is the only write path.
 * Duplicate questions are skipped: an entry whose target AND question head
 * (first line, first 100 chars) both match an existing entry is not written,
 * so repeating the same explain button never duplicates, while follow-ups
 * from a different angle (different question) still record.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param input - target label, question head, and answer text.
 * @param notesFile - note file name (default ARCH-NOTES.md).
 * @returns success (possibly skipped) or error result.
 */
export declare function appendNote(fs: FileSystem, root: string, input: {
    target: string;
    question: string;
    answer: string;
}, notesFile: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<{
    ok: true;
    skipped?: boolean;
} | {
    error: string;
}>;
/**
 * [已退役] Whether the note file already holds an entry for the same target and
 * question head — the "same question" duplicate rule. Different questions
 * about the same target (new angles) are NOT duplicates.
 * @param text - existing note file text.
 * @param target - the new entry's target label.
 * @param questionHead - the new entry's question head.
 * @returns true when a matching entry exists.
 */
export declare function isDuplicate(text: string, target: string, questionHead: string): boolean;
/**
 * [已退役] Trim a note file to at most {@link MAX_NOTE_ENTRIES} `## [` headings,
 * keeping the file header (everything before the first entry) and the most
 * recent entries.
 * @param text - full note file text.
 * @returns text with old entries removed from the head.
 */
export declare function trimToLimit(text: string): string;
/**
 * [已退役] Parse the note file into listing entries, newest first.
 * @param text - note file text.
 * @returns parsed entries.
 */
export declare function parseNotes(text: string): ParsedEntry[];
/**
 * [已退役] Read the note file into the client listing shape, newest first.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param notesFile - note file name.
 * @returns the listing result.
 */
export declare function readNotes(fs: FileSystem, root: string, notesFile: string): Promise<ArchLensNotesResult | {
    error: string;
}>;
export {};
//# sourceMappingURL=notes.d.ts.map