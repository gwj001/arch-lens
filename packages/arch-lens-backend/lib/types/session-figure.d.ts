/**
 * Session-driven figure generation (「图生成走会话」): the panel asks the
 * BACKEND for a figure-generation PROMPT (with the code facts embedded), the
 * CLIENT sends it into the current session as a user message — the GUI's own
 * conversation stream then shows the agent working in real time (thinking,
 * code reading, output) with zero custom push plumbing. When the agent
 * answers, the backend's assistant/message listener matches the answer by a
 * unique figId, sanitizes the figure data and writes the same caches the
 * figure chains read, so a plain refetch renders the fresh figure.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/session-figure
 */
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { FlowAngle } from './types.ts';
/** Figure kinds the session turn can produce (wire kinds mapped to cache kinds). */
export type SessionFigureKind = 'concepts' | 'seq' | 'flow' | 'interaction' | 'core';
/** One staged session-figure request, matched by figId in the answer. */
export interface PendingFigure {
    figId: string;
    kind: SessionFigureKind;
    language: string;
    angle?: FlowAngle;
    methodLevel?: boolean;
    sessionId: string | null;
    stagedAt: number;
    /** The code index the prompt was built from — the listener validates seq /
     * core endpoints against it WITHOUT re-indexing, so the cache lands
     * immediately (no re-read race with the panel's refetch). */
    index: CodeIndexResult;
}
/** Keep cache file names filesystem-safe (language + angle + method level). */
export declare function figureCacheName(kind: SessionFigureKind, language: string, angle?: FlowAngle, methodLevel?: boolean): string;
/**
 * Build the session message that asks the agent to produce ONE figure.
 * The code facts (index summary, entity- or method-level) are embedded so
 * the agent is grounded; it MAY read source files with its tools to verify,
 * but its final answer must be the strict JSON below (echoing the figId).
 * @param kind - the figure kind.
 * @param index - code index result (fact source).
 * @param language - role language.
 * @param figId - unique marker the answer must echo.
 * @param angle - flow viewpoint (flow only).
 * @param methodLevel - 🔬 method-level summary (methods + call edges).
 * @returns the user-message text.
 */
export declare function buildFigurePrompt(kind: SessionFigureKind, index: CodeIndexResult, language: string, figId: string, angle?: FlowAngle, methodLevel?: boolean): string;
/**
 * Find the answer's JSON object that carries the expected figId. Tolerates
 * prose, fenced ```json blocks and multiple JSON candidates (scans the last
 * balanced brace groups first).
 * @param answer - the assistant's full answer text.
 * @param figId - the expected marker.
 * @returns the parsed object, or null.
 */
export declare function extractFigureJson(answer: string, figId: string): Record<string, unknown> | null;
/**
 * Sanitize the parsed answer into the figure's cache shape and persist it to
 * the same file the chain reads, so a plain refetch renders the fresh figure.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (id validation for seq/core answers).
 * @param kind - the figure kind.
 * @param parsed - the answer JSON (figId matched already).
 * @param language - role language.
 * @param angle - flow viewpoint (flow only).
 * @param methodLevel - cache suffix.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns `{ ok: true }` or `{ error }`.
 */
export declare function writeFigureCache(fs: FileSystem, root: string, index: CodeIndexResult, kind: SessionFigureKind, parsed: Record<string, unknown>, language: string, angle?: FlowAngle, methodLevel?: boolean, sandboxPolicy?: SandboxExecutionPolicy): Promise<{
    ok: true;
} | {
    error: string;
}>;
//# sourceMappingURL=session-figure.d.ts.map