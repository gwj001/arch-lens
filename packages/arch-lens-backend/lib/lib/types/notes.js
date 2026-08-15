/**
 * Answer-level ARCH-NOTES.md recording for the Arch Lens backend: the single
 * writer path (host event listener) appends one question/answer entry per
 * completed assistant message and bounds the file.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/notes
 */
/** Max note entries kept in the file; older entries are trimmed from the head. */
export const MAX_NOTE_ENTRIES = 200;
/** Timestamp format for note headings. */
function timestamp(now) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
        + `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
/**
 * Append one note entry to `ARCH-NOTES.md` under the workspace root and bound
 * the file to {@link MAX_NOTE_ENTRIES} entries. This is the only write path.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param input - target label, question head, and answer text.
 * @param notesFile - note file name (default ARCH-NOTES.md).
 * @returns success or error result.
 */
export async function appendNote(fs, root, input, notesFile) {
    try {
        const target = await fs.resolve(notesFile, { cwd: root });
        const info = await fs.stat(target);
        const questionHead = input.question.split('\n')[0]?.slice(0, 100) ?? '架构讲解';
        const answer = input.answer.trim().slice(0, 600) || '（回答为空）';
        const entry = `\n## [${timestamp(new Date())}] (${input.target}) ${questionHead}\n\n**问**：${questionHead}\n\n**答**：${answer}\n`;
        if (info === undefined || info.type !== 'file') {
            const header = '# 架构笔记（ARCH-NOTES）\n\n由架构学习台自动维护：每次 AI 讲解（含回答）追加一条记录。\n';
            await fs.writeText(target, header + entry);
            return { ok: true };
        }
        const existing = await fs.readText(target);
        const trimmed = trimToLimit(existing + entry);
        await fs.writeText(target, trimmed);
        return { ok: true };
    }
    catch (error) {
        return { error: `note write failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
/**
 * Trim a note file to at most {@link MAX_NOTE_ENTRIES} `## [` headings,
 * keeping the file header and the most recent entries.
 * @param text - full note file text.
 * @returns text with old entries removed from the head.
 */
export function trimToLimit(text) {
    const lines = text.split('\n');
    const heads = lines.map((line, index) => ({ line, index }))
        .filter(({ line }) => /^## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/.test(line));
    if (heads.length <= MAX_NOTE_ENTRIES)
        return text;
    const keepFrom = heads[heads.length - MAX_NOTE_ENTRIES].index;
    return lines.slice(keepFrom).join('\n');
}
/**
 * Parse the note file into listing entries, newest first.
 * @param text - note file text.
 * @returns parsed entries.
 */
export function parseNotes(text) {
    const entries = [];
    let current = null;
    for (const line of text.split('\n')) {
        const match = /^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((.*?)\)(.*)$/.exec(line);
        if (match !== null) {
            const [, time, target, rest] = match;
            current = { heading: `${time ?? ''}|${target ?? ''}|${(rest ?? '').trim()}`, body: [] };
            entries.push(current);
        }
        else if (current !== null) {
            current.body.push(line);
        }
    }
    return entries;
}
/**
 * Read the note file into the client listing shape, newest first.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param notesFile - note file name.
 * @returns the listing result.
 */
export async function readNotes(fs, root, notesFile) {
    try {
        const target = await fs.resolve(notesFile, { cwd: root });
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return { path: notesFile, entries: [] };
        const text = await fs.readText(target);
        const entries = parseNotes(text)
            .map(entry => {
            const [time, targetName, rest] = entry.heading.split('|');
            return {
                time: time ?? '',
                target: targetName ?? '',
                preview: rest !== undefined && rest.length > 0 ? rest.slice(0, 80) : '(讲解)',
            };
        })
            .reverse();
        return { path: notesFile, entries };
    }
    catch (error) {
        return { error: `note read failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
//# sourceMappingURL=notes.js.map