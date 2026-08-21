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
/**
 * DYNAMIC figure kinds (hover drill-down, 「动态画图」): a small detail
 * diagram for ONE sequence edge (the two packages' method-level call
 * sequence) or ONE flow subgraph (that stage expanded into a detailed
 * flowchart). Results are cached per target, so a generated detail opens
 * instantly on the next hover (no re-generation).
 */
export type DynamicFigureKind = 'seq-edge' | 'flow-subgraph';
/**
 * Stable djb2 hash → filesystem-safe suffix. The CLIENT keeps a local mirror
 * (arch-view.tsx) so hover caches line up between panel and backend.
 * @param text - the string to hash.
 * @returns a base-36 string of the unsigned 32-bit hash.
 */
export declare function hashString(text: string): string;
/**
 * Serialize one dynamic-figure target into a stable key (the client mirror
 * must produce the same string, so the same cache file is hit).
 * @param kind - the dynamic figure kind.
 * @param target - the hovered element: seq-edge → from/to/label, flow-subgraph → stage.
 * @returns the target key (embedded in cache names).
 */
export declare function dynamicTargetKey(kind: DynamicFigureKind, target: {
    from?: string;
    to?: string;
    label?: string;
    stage?: string;
}): string;
/** Cache file for one dynamic figure: `.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`. */
export declare function dynamicFigureCacheName(kind: DynamicFigureKind, targetKey: string, language: string): string;
/** One staged session-figure request, matched by figId in the answer. */
export interface PendingFigure {
    figId: string;
    kind: SessionFigureKind | DynamicFigureKind;
    language: string;
    angle?: FlowAngle;
    methodLevel?: boolean;
    sessionId: string | null;
    stagedAt: number;
    /** The code index the prompt was built from — the listener validates seq /
     * core endpoints against it WITHOUT re-indexing, so the cache lands
     * immediately (no re-read race with the panel's refetch). */
    index: CodeIndexResult;
    /** Session-driven DYNAMIC figure (edge/subgraph drill-down): written to its
     * own per-target cache file instead of the per-kind figure caches. */
    dynamic?: {
        kind: DynamicFigureKind;
        targetKey: string;
    };
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
/**
 * Build the session message that asks the agent to draw ONE dynamic detail
 * figure. Facts are embedded (the hovered edge's two packages with their
 * method-level summary + real call edges, or the flow subgraph's source
 * block + the code summary); the answer must be the strict JSON below.
 * @param kind - seq-edge (edge drill-down) or flow-subgraph (stage expansion).
 * @param index - code index result (fact source).
 * @param language - role language.
 * @param figId - unique marker the answer must echo.
 * @param target - the hovered element (from/to/label or stage).
 * @param mermaidSource - the current flow diagram source (flow-subgraph only).
 * @returns the user-message text.
 */
export declare function buildDynamicFigurePrompt(kind: DynamicFigureKind, index: CodeIndexResult, language: string, figId: string, target: {
    from?: string;
    to?: string;
    label?: string;
    stage?: string;
}, mermaidSource?: string): string;
/** Extract the diagram body from a dynamic answer ({title?, diagram}): strips
 * fences and stray prose, keeps the first diagram statement, repairs edge
 * labels. @returns the clean value, or undefined when unusable. */
export declare function extractDynamicDiagram(parsed: Record<string, unknown>): {
    title: string;
    diagram: string;
} | undefined;
/**
 * Persist one dynamic figure to its per-target cache file.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param kind - the dynamic figure kind.
 * @param targetKey - the serialized hover target (cache identity).
 * @param parsed - the answer JSON (figId matched already).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns `{ ok: true }` or `{ error }`.
 */
export declare function writeDynamicFigureCache(fs: FileSystem, root: string, kind: DynamicFigureKind, targetKey: string, parsed: Record<string, unknown>, language: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<{
    ok: true;
} | {
    error: string;
}>;
//# sourceMappingURL=session-figure.d.ts.map