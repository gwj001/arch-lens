/**
 * Shared analysis profile: ONE LLM pass (two serial calls) produces every
 * AI-derived figure fact from ONE index summary, so concept/flow/seq/events/
 * core share a single context instead of six independent ones re-sending the
 * same summary. Each chain consumes the profile AFTER its authoritative stage
 * (docs / static call graph) and BEFORE its own LLM fallback, so authority
 * order never changes: cache → docs/code → profile → chain-own LLM.
 *
 *   ensureAnalysisProfile(ctx, fs, root, index, language, policy)
 *     ├─ call 1 (structure): { coreIds, conceptTree }   — trimmed summary
 *     │    （id+实体+入口，无依赖字段：方案 B）
 *     └─ call 2 (figures): { flow, seqMessages, events } — core-only summary
 *          （只发送 coreIds 子集，seq 的 from/to 由 coreIds 交叉校验）
 *
 * In-memory single-flight per root+language: concurrent chains share one
 * generation. The profile lands in `.arch-lens-analysis-<lang>.json` and is
 * invalidated by `removeAICaches` together with the other AI caches; the
 * single-flight map is cleared by `clearAnalysisProfileCache()`.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/analysis
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { ArchLensSequenceMessage, FlowAngle } from './types.ts';
import type { ConceptTreeNode } from './concept.ts';
/** Cache file base name; the role language is appended (sanitized). */
export declare const ANALYSIS_FILE_BASE = ".arch-lens-analysis";
/** Profile schema version: readers ignore other versions (regenerate).
 * v2: the `flow` field is a per-viewpoint map ({ event, pipeline }) instead
 * of a single diagram — old v1 profiles are regenerated with both angles. */
export declare const PROFILE_VERSION = 2;
/** One interaction event row of the profile. */
export interface AnalysisEvent {
    event: string;
    mode: string;
    producers: string[];
    consumers: string[];
    note: string;
}
/** One flow diagram of the profile. */
export interface AnalysisFlow {
    title: string;
    /** Generation viewpoint (event / pipeline). */
    angle: FlowAngle;
    mermaid: string;
}
/** The persisted shared analysis profile. */
export interface ArchLensAnalysisProfile {
    version: number;
    generatedAt: number;
    language: string;
    /** Validated core package ids (subset of the index). */
    coreIds: string[];
    /** LLM-induced concept tree (nodes carry source:'flow'). */
    conceptTree?: ConceptTreeNode[];
    /** Flow diagrams per viewpoint — BOTH are generated together in one call. */
    flow?: Partial<Record<FlowAngle, AnalysisFlow>>;
    seqMessages?: ArchLensSequenceMessage[];
    events?: AnalysisEvent[];
}
/** Keep cache file names filesystem-safe. */
export declare function cacheName(language: string): string;
/** Drop every in-flight profile and mutation (rescan invalidates the
 * analysis layer too). */
export declare function clearAnalysisProfileCache(): void;
/**
 * Resolve the shared analysis profile: memory → disk cache → generate
 * (single-flight). Returns a profile whose missing fields mean "this chain
 * must fall back to its own LLM"; it never throws.
 * @param ctx - host context (llm / agentDefaultModel services).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (summary source).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns the profile (possibly with empty/missing fields).
 */
export declare function ensureAnalysisProfile(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<ArchLensAnalysisProfile>;
/** Parse a persisted profile, validating only what readers rely on. */
export declare function profileFromText(text: string): ArchLensAnalysisProfile | null;
/** Pull the outermost JSON object out of a model answer, tolerating prose. */
export declare function parseProfileObject(text: string): Record<string, unknown> | null;
/**
 * Validate and bound an LLM id list against the indexed packages:
 * strings only, must exist in the index, deduplicated, capped at 25.
 * Mirrors core.ts `validateIds` so the profile's coreIds obey the same rule.
 * @param index - code index result.
 * @param raw - the raw `coreIds` field of a model answer.
 * @returns the sanitized id list.
 */
export declare function sanitizeCoreIds(index: CodeIndexResult, raw: unknown): string[];
/**
 * Build concept-tree nodes from a raw model array: names required (trimmed),
 * bounded text, depth ≤3, at most 12 roots. Nodes carry source:'flow' like
 * the chain-own induction fallback.
 * @param raw - raw `conceptTree` field of a model answer.
 * @param idPrefix - node id prefix (unique per profile).
 * @returns the sanitized tree (possibly empty).
 */
export declare function buildProfileConceptTree(raw: unknown, idPrefix: string): ConceptTreeNode[];
/**
 * Sanitize a raw flow object: mermaid source required (cleaned), title
 * bounded with a neutral default. The generation viewpoint is stamped from
 * the caller (the model never chooses it).
 * @param raw - raw `flow.<angle>` field of a model answer.
 * @param angle - the requested generation viewpoint.
 * @returns the sanitized flow, or undefined.
 */
export declare function sanitizeFlow(raw: unknown, angle: FlowAngle): AnalysisFlow | undefined;
/**
 * Sanitize raw sequence messages: strings only, from/to must be core ids,
 * no self-loops, label bounded, capped at 16.
 * @param raw - raw `seqMessages` field of a model answer.
 * @param coreIds - the profile's validated core ids (the only legal endpoints).
 * @returns the sanitized messages.
 */
export declare function sanitizeSeqMessages(raw: unknown, coreIds: readonly string[]): ArchLensSequenceMessage[];
/**
 * Sanitize raw interaction events: event name required, mode restricted to
 * the four cordis dispatch modes, producers/consumers bounded, capped at 14.
 * @param raw - raw `events` field of a model answer.
 * @returns the sanitized events.
 */
export declare function sanitizeEvents(raw: unknown): AnalysisEvent[];
/**
 * Per-tab "AI generate": regenerate ONE profile field with one trimmed-summary
 * LLM call, update the shared profile in memory and on disk, and return it.
 * Serialized per root+language so concurrent tab generations never interleave.
 *
 * Regenerating the core selection INVALIDATES flow/seq/events: their
 * endpoints are cross-checked against coreIds, so after a new selection the
 * old figures could reference dropped packages. They are cleared and
 * re-generated on demand when their tabs are opened.
 *
 * A field whose regeneration produced nothing throws (the profile keeps its
 * previous value — no stale data is frozen in).
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param kind - the profile field to regenerate.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns the updated profile.
 */
export declare function regenerateProfileField(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, kind: 'concept' | 'core' | 'flow' | 'seq' | 'events', sandboxPolicy?: SandboxExecutionPolicy): Promise<ArchLensAnalysisProfile>;
//# sourceMappingURL=analysis.d.ts.map