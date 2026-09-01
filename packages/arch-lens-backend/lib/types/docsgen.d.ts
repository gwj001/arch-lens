/**
 * Shared doc/LLM plumbing for the Arch Lens backend: the bounded index
 * summary, the streaming `llmText` call (usage accounting + live status),
 * the structured seq/interaction induction, and the seq induction prompt.
 * Doc generation (V1 chapter write path) lives in docchapter.ts; the old
 * zero-LLM assembly chain (docbuild.ts) and its doc-target helpers were
 * removed with it — docs land per-chapter as `*.generated.md` there.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docsgen
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
/** The route's advertised reasoning capability (detached shape, testable). */
export interface ReasoningCapability {
    /** Supported efforts in adapter-preferred display order. */
    efforts: readonly {
        id: ReasoningEffortId;
        name: string;
    }[];
    /** Adapter-configured default materialized when callers omit an effort. */
    defaultEffort?: ReasoningEffortId;
}
/**
 * Pick the cheapest reasoning effort worth proposing for a bounded
 * structured-output call. ONLY ids advertised by the route are eligible:
 * dsh-llm rejects unsupported efforts before provider I/O (no clamping, no
 * aliasing), so proposing anything off-list would fail the whole call.
 * @param reasoning - the route's capability (`resolveModelInfo(...).reasoning`),
 * or undefined when the route exposes none.
 * @returns the effort id to propose, or undefined to keep the adapter
 * default (no capability / empty list / the cheapest IS the default).
 */
export declare function lowestReasoningEffort(reasoning: ReasoningCapability | undefined): ReasoningEffortId | undefined;
/**
 * The AUTHORITATIVE sequence / interaction cache file names, exported for the
 * figure registry (`figures.ts`): consumers must never re-spell cache names.
 * @param language - role language.
 * @param methods - 🔬 method-level variant.
 * @returns the CACHE_DIR-relative cache file name.
 */
export declare function seqCacheName(language: string, methods?: boolean): string;
/** See `seqCacheName`. @param language - role language. @param methods - method-level variant. @returns the cache file name. */
export declare function eventsCacheName(language: string, methods?: boolean): string;
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