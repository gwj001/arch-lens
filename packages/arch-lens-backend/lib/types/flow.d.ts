/**
 * Flow-diagram generation for the Arch Lens backend, dual path:
 *
 *   docCandidates(language) → extractFlowBlock(doc, root) over every existing doc
 *     ├─ verbatim mermaid flowchart block  → rendered as-is (source: 'doc')
 *     ├─ pseudo-code flow block (```text)  → LLM format-transcode (source: 'doc')
 *     └─ (no block in any doc)             → generateFlowFromCode(index)
 *                                            LLM-induced entity flow (source: 'flow')
 *   every stage writes/reads the per-language cache (.arch-lens-flow-<lang>.json)
 *
 * Doc flows are grounded: the mermaid source (or the pseudo-code original, for
 * transcoded ones) is kept as `sourceText` with a `#heading` anchor so explains
 * can cite verbatim evidence. Induced flows declare themselves non-authoritative
 * (`source: 'flow'`), matching the concept-tree fallback.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/flow
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { ArchLensFlowResult, FlowAngle } from './types.ts';
/** One flow block found in a doc: either verbatim mermaid or pseudo-code text. */
interface FlowBlock {
    /** Verbatim mermaid flowchart source (when the block was already mermaid). */
    mermaid?: string;
    /** Pseudo-code flow text that needs an LLM transcode (when not mermaid). */
    pseudo?: string;
    /** Source anchor: doc path + heading. */
    ref: string;
    /** Heading text (or a neutral title when the block sits outside a heading). */
    title: string;
}
/**
 * Stage: locate the first flow block in an architecture doc. A fenced
 * `mermaid` block whose body starts with `flowchart`/`graph` is returned
 * verbatim; a fenced `text`/`txt` block containing `->` arrows is returned as
 * pseudo-code for transcoding. The nearest preceding heading becomes the
 * source anchor. Pure rule stage — zero LLM, deterministic.
 * @param fs - filesystem service.
 * @param docPath - display path of the doc.
 * @param root - workspace root (refs are workspace-relative).
 * @returns the flow block, or null when the doc has none.
 */
export declare function extractFlowBlock(fs: FileSystem, docPath: string, root: string): Promise<FlowBlock | null>;
/**
 * Fallback stage: LLM induces a core flow (entity → entity) from the code
 * index metadata — the "no doc flow block" path, language-independent.
 * The requested viewpoint shapes the diagram: event (trigger/consumer story)
 * or pipeline (data-product flow). Result is `source: 'flow'` (non-authoritative).
 * @param ctx - host context.
 * @param index - code index result.
 * @param language - role language.
 * @param angle - flow generation viewpoint.
 * @param signal - optional cancellation (⏹ 终止).
 * @param methods - 🔬 方法级: feed the method-level summary (methods + real
 *   call edges with file:line) so labels can cite real functions.
 * @returns the induced flow, or null on failure.
 */
export declare function generateFlowFromCode(ctx: Context, index: CodeIndexResult, language: string, angle?: FlowAngle, signal?: AbortSignal, methods?: boolean): Promise<ArchLensFlowResult | null>;
/**
 * The full flow chain: cache → doc (verbatim mermaid, else LLM transcode of a
 * pseudo-code block) → shared analysis profile → LLM induction from code
 * metadata. `force` bypasses the cache and rebuilds the figure's facts.
 * The cache and the induced results are keyed by the requested viewpoint
 * (angle); doc flows are angle-independent and win whenever a doc carries a
 * flow block (documented authority order is unchanged).
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (for the induction fallback).
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @param angle - flow generation viewpoint (default 'event').
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @param methods - 🔬 方法级: skip the shared (entity-level) profile and
 *   induce from the method-level summary; caches get a `-methods` suffix so
 *   entity and method diagrams never collide.
 * @returns the flow diagram, or an error result.
 */
export declare function flowDiagram(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, force: boolean, angle?: FlowAngle, sandboxPolicy?: SandboxExecutionPolicy, methods?: boolean): Promise<ArchLensFlowResult | {
    error: string;
}>;
export {};
//# sourceMappingURL=flow.d.ts.map