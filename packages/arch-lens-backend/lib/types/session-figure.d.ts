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
import type { EntityFigureId } from './figures.ts';
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
export type DynamicFigureKind = 'seq-edge' | 'flow-subgraph' | 'overview';
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
/** Cache file for one dynamic figure: `index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`. */
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
    /** Session tokenUsage snapshot when the request was staged (differential
     * attribution of the answering model call), or undefined when unavailable. */
    usageStart?: {
        uncachedInputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
    };
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
/** Session figure kind (+ flow viewpoint) → the registry entity id. */
export declare function entityFigureId(kind: SessionFigureKind, angle?: FlowAngle): EntityFigureId;
/**
 * Cache file name for one session figure kind — DELEGATED to the figure
 * registry (authoritative names, single source). Kept exported for the
 * session listener's logging; writes go through writeFigureCache/writeFigure.
 */
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
 * @param claims - 架构声称类文档（design/overview/architecture/concept…）的
 *   标题大纲，overview 分支注入为【文档声称】（预期，非结论）。
 * @returns the user-message text.
 */
export declare function buildDynamicFigurePrompt(kind: DynamicFigureKind, index: CodeIndexResult, language: string, figId: string, target: {
    from?: string;
    to?: string;
    label?: string;
    stage?: string;
}, mermaidSource?: string, blurbs?: Record<string, string>, existing?: {
    title?: string;
    diagram?: string;
    summary?: string;
}, claims?: string): string;
/** Extract the diagram body from a dynamic answer ({title?, diagram}): strips
 * fences and stray prose, keeps the first diagram statement, repairs edge
 * labels. @returns the clean value, or undefined when unusable. */
export declare function extractDynamicDiagram(parsed: Record<string, unknown>): {
    title: string;
    diagram: string;
} | undefined;
/**
 * Facts version + dependency packages a dynamic drill-down write must stamp
 * (§6.2, the ONE rule): seq-edge → the two endpoint packages parsed back out
 * of the target key; flow-subgraph → the parent flow envelope's deps (absent
 * or unreadable parent → all packages); overview → all packages.
 */
export declare function dynamicFigureWriteFacts(fs: FileSystem, root: string, dynamic: {
    kind: DynamicFigureKind;
    targetKey: string;
}, language: string, angle: FlowAngle | undefined, index: CodeIndexResult): Promise<{
    factsVersion: number;
    deps: string[];
}>;
/**
 * Persist one dynamic figure to its per-target cache file — versioned
 * envelope `{ v, deps, data }` (D1): an invalid/stale drill-down becomes
 * unreadable and the next hover regenerates it; selective invalidation
 * cascades it with its parent figure.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param kind - the dynamic figure kind.
 * @param targetKey - the serialized hover target (cache identity).
 * @param parsed - the answer JSON (figId matched already).
 * @param language - role language.
 * @param factsVersion - facts version to stamp (read at write time).
 * @param deps - dependency package ids (see dynamicFigureWriteFacts).
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns `{ ok: true }` or `{ error }`.
 */
export declare function writeDynamicFigureCache(fs: FileSystem, root: string, kind: DynamicFigureKind, targetKey: string, parsed: Record<string, unknown>, language: string, factsVersion: number, deps: string[], sandboxPolicy?: SandboxExecutionPolicy): Promise<{
    ok: true;
} | {
    error: string;
}>;
/**
 * Build the session message for the CUSTOM figure branch (「🎨 动态出图」): the
 * user types ANY request ("存图的逻辑，怎么存的，存哪、怎么读的…") and the agent
 * draws a matching diagram PLUS a short summary. Same evidence discipline as
 * the other session figures — the FULL scan facts (per-package one-line duties
 * + bounded index summary with deps and top-level entities) are embedded.
 * @param index - code index result (fact source).
 * @param text - the user's figure request (for a follow-up: the refinement
 *   instruction targeting the existing figure).
 * @param language - role language.
 * @param figId - unique marker the answer must echo.
 * @param blurbs - per-package one-line duties (graph blurbs).
 * @param existing - the figure of the SAME scene (follow-up): its diagram +
 *   title + summary are embedded so the LLM extends/redraws the details
 *   instead of starting from scratch. Undefined = brand-new scene.
 * @returns the user-message text.
 */
export declare function buildCustomFigurePrompt(index: CodeIndexResult, text: string, language: string, figId: string, blurbs: Record<string, string>, existing?: {
    title?: string;
    diagram?: string;
    summary?: string;
}): string;
/**
 * Sanitize a CUSTOM figure answer ({figId, title, diagram, summary}): diagram
 * via the same fence/statement extraction + label repair as the dynamic
 * branch; title and summary trimmed. @returns the clean value, or undefined
 * when no usable diagram.
 */
export declare function extractCustomFigure(parsed: Record<string, unknown>): {
    title: string;
    diagram: string;
    summary: string;
} | undefined;
/**
 * 「🔧 按报错修复重画」(L3 convergence): the browser's mermaid is the only
 * syntax authority, and its parse error is the IDEAL repair prompt — exact
 * line, offending token, expected alternatives. Feed the broken diagram + the
 * error verbatim back through the SAME figId session-turn capture pipeline:
 * a FRESH figId nonce (the scene's previous nonce was consumed by its
 * capture) under the SAME scene figureId, so the standard custom-figure
 * listener ingests the fix with zero capture changes.
 * Deliberately NO scan-facts replay: the facts already stand in the broken
 * diagram — replaying the index would burn tokens and invite the model to
 * "improve" content while it was only asked to fix syntax (semantic drift).
 * @param figureId - locked scene id (dynamic-N), echoed for context.
 * @param figId - the FRESH capture nonce the answer must echo.
 * @param diagram - the broken mermaid source (host-side copy, single source).
 * @param title - scene title (must be echoed unchanged).
 * @param summary - scene summary (must be echoed unchanged).
 * @param error - mermaid's own error text as reported by the renderer.
 * @returns the session prompt for the repair turn.
 */
export declare function buildFigureRepairPrompt(figureId: string, figId: string, diagram: string, title: string, summary: string, error: string): string;
//# sourceMappingURL=session-figure.d.ts.map