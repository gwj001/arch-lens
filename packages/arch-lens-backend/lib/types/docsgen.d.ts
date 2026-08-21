/**
 * Architecture-doc generation for the Arch Lens backend. Two entry points:
 *   - generateFullDocs: one LLM pass writes a complete architecture doc
 *     (concept / sequence / interaction / dependency / ER / catalog sections).
 *   - generateDocSection: one dimension regenerated on demand (per-tab "AI
 *     generate"); sequence/interaction also write structured caches the
 *     figures render directly.
 * The generated doc ALWAYS lands in docs/architecture.generated.md and is
 * overwritten on every generation. docs/architecture.md is the USER'S OWN
 * document and the generator never writes it — users adopt a generated doc
 * by renaming/copying it into place (dropping the "generated" suffix).
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docsgen
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
/** Section titles per dimension, used as `##` headings in the doc. */
export declare const SECTION_TITLES: Record<DocKind, string>;
/** Supported doc sections (one per figure/tab dimension). */
export type DocKind = 'concepts' | 'seq' | 'interaction' | 'deps' | 'er' | 'catalog';
/**
 * Resolve the doc target: ALWAYS `docs/architecture.generated.md`.
 * `docs/architecture.md` belongs to the user and is never written, whether it
 * carries a generated marker or not. Every generation overwrites the AI
 * variant (per-section merge for generateDocSection, full rewrite for
 * generateFullDocs). Users adopt a generated doc by renaming/copying it over
 * `architecture.md` (dropping the "generated" suffix) — the generator keeps
 * writing the AI variant afterwards.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @returns the AI variant display path.
 */
export declare function resolveDocTarget(fs: FileSystem, root: string): Promise<string>;
/** Field selection for the bounded index summary (方案 B：按需裁剪摘要). */
export interface IndexSummaryOptions {
    /** Only include these package ids (unknown ids are skipped). */
    packages?: readonly string[];
    /** Per-package fields to include; each defaults to true. */
    fields?: {
        deps?: boolean;
        entities?: boolean;
        entryFiles?: boolean;
    };
    /** METHOD-level detail (🔬 方法级 switch, opt-in per figure): include
     * class children (method names) and the real call edges with file:line.
     * NEVER enabled on the shared profile summary — method facts multiply
     * tokens, so they are assembled only for the figure that asked. */
    methods?: boolean;
    /** Max packages included (default 60). */
    maxPackages?: number;
    /** Max deps listed per package (default 6). */
    maxDeps?: number;
}
/**
 * Bounded summary lines of the code index for prompts (shared with flow.ts
 * and analysis.ts). Each caller picks only the fields its task needs —
 * e.g. core selection never reads edges, so it drops the `deps` field.
 * With `methods: true` the summary also lists per-class method names and a
 * capped block of real call edges (`from → to（file:line）`) — the fact
 * source for method-level figures.
 * @param index - code index result.
 * @param options - field / package / bound selection.
 * @returns the summary lines.
 */
export declare function indexSummary(index: CodeIndexResult, options?: IndexSummaryOptions): string;
/**
 * One LLM generation call with the standard config contract (shared with
 * flow.ts). The output cap is optional: omitted, the request inherits the
 * adapter's Config-owned default maxTokens instead of a local literal.
 * Every call is recorded in the LLM usage accounting (see llm-stats.ts).
 * An optional AbortSignal cancels the provider stream promptly (the「⏹ 终止」
 * button); an aborted call throws `ABORTED_MESSAGE` and is not recorded.
 * @param ctx - host context carrying llm and agentDefaultModel services.
 * @param prompt - the full prompt text.
 * @param temperature - sampling temperature.
 * @param maxTokens - optional output cap.
 * @param kind - accounting kind for llm-stats.ts.
 * @param signal - optional cancellation for this call.
 * @returns the model output text.
 */
export declare function llmText(ctx: Context, prompt: string, temperature: number, maxTokens?: number, kind?: string, signal?: AbortSignal): Promise<string>;
/**
 * Generate one doc section on demand (per-tab "AI generate"). Sequence and
 * interaction also write structured caches for their figures.
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param kind - section dimension.
 * @returns the doc target path, or an error.
 */
export declare function generateDocSection(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, kind: DocKind, sandboxPolicy?: SandboxExecutionPolicy): Promise<{
    path: string;
} | {
    error: string;
}>;
/**
 * Generate the complete architecture doc in one pass (global button).
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @returns the doc target path, or an error.
 */
export declare function generateFullDocs(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<{
    path: string;
} | {
    error: string;
}>;
/**
 * Build the LLM induction prompt for the main-flow sequence figure: the
 * project-core main flow, entry → core loop → key capabilities → output.
 * The main line is pinned by name: entry packages (with entry files) start
 * the flow and the most-imported packages (in-degree over source imports)
 * form the core it must pass through. Every from/to must be a real package
 * id from the index summary (the anti-fabrication clause), so the figure
 * stays code-grounded.
 * @param index - code index result.
 * @param language - output language.
 * @param summary - the summary lines to embed (entity-level by default,
 *   method-level when the 🔬 switch is on — callers choose the granularity).
 * @returns the prompt text.
 */
export declare function seqInductionPrompt(index: CodeIndexResult, language: string, summary?: string): string;
/**
 * Structured figure data for the sequence/interaction tabs, generated by LLM
 * from the code index and cached per language.
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param kind - 'seq' or 'interaction'.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @param methodLevel - 🔬 方法级: feed the method-level summary (methods +
 *   real call edges with file:line) instead of the entity-level one.
 * @returns the parsed structured data, or an error.
 */
export declare function writeStructuredCache(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, kind: 'seq' | 'interaction', sandboxPolicy?: SandboxExecutionPolicy, methodLevel?: boolean): Promise<unknown[] | {
    error: string;
}>;
/**
 * Read the structured figure cache for a language, if present.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language.
 * @param kind - 'seq' or 'interaction'.
 * @returns the cached array, or null.
 */
export declare function readStructuredCache(fs: FileSystem, root: string, language: string, kind: 'seq' | 'interaction', methods?: boolean): Promise<unknown[] | null>;
//# sourceMappingURL=docsgen.d.ts.map