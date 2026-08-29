/**
 * Entity-level figure registry: one spec per tab figure owning its
 * AUTHORITATIVE cache file name (delegated to the chain module that writes
 * it — the historical generateAll bug hand-spelled cache names and the flow
 * name never matched flow.ts's real file, so flow figures could never be
 * skipped in incremental mode), its dependency rule (`figureDeps`) and its
 * unified build entry. The write paths (generateAll, every chain's cache
 * write via `writeFigure`) consume this registry so there is exactly ONE
 * list of figures, ONE name source, ONE deps rule and ONE force semantic.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/figures
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { ArchLensGraph } from './types.ts';
/** Entity-level figure ids (wire-stable step labels of generateAll). */
export type EntityFigureId = 'concepts' | 'flow-event' | 'flow-pipeline' | 'seq' | 'interaction' | 'core' | 'duties';
/** Everything a figure chain needs for one build; shared by all specs. */
export interface FigureEnv {
    ctx: Context;
    fs: FileSystem;
    root: string;
    /** Code index facts (every chain except duties). */
    index: CodeIndexResult;
    /** Scanned graph facts (duties). */
    graph: ArchLensGraph;
    /** Role language (cache key + output language). */
    language: string;
    /** Session-scoped sandbox policy for cache writes. */
    policy?: SandboxExecutionPolicy;
}
/** One registered entity-level figure. */
export interface FigureKindSpec {
    id: EntityFigureId;
    /**
     * The AUTHORITATIVE cache file name (CACHE_DIR-relative) for this figure at
     * a role language. MUST delegate to the owning chain module — never
     * re-spell the name here, or incremental validity checks silently break.
     * @param language - role language.
     * @param methods - 🔬 method-level cache variant (`-methods` suffix).
     * @returns the cache file name.
     */
    cacheName(language: string, methods?: boolean): string;
    /**
     * Shared build entry: chain order is cache → docs → shared profile → LLM
     * (each module's own). `force` bypasses the chain's leading cache read
     * (used once the caller already knows the cache is missing/stale).
     * @param env - the figure environment.
     * @param force - regenerate even when the chain's own cache check would hit.
     * @returns the figure data, or an `{ error }` result.
     */
    build(env: FigureEnv, force: boolean): Promise<unknown>;
}
/** The ONE entity-level figure list (order = historical generateAll steps). */
export declare const FIGURE_SPECS: readonly FigureKindSpec[];
/** The AUTHORITATIVE cache file name for one kind. */
export declare function specCacheName(kind: EntityFigureId, language: string, methods?: boolean): string;
/** The ONE dependency-package rule for every figure cache write. */
export declare function figureDeps(kind: EntityFigureId, data: unknown, index?: CodeIndexResult): string[] | undefined;
/**
 * The ONE versioned write entry for every tab figure cache: resolves the
 * authoritative file name through the registry and delegates to
 * `writeVersionedCache` — a failed write THROWS by design (callers decide
 * whether persistence failure is fatal). `factsVersion` is the version read
 * AT THE START of the generation (never re-read after the LLM call: facts
 * that moved mid-generation must not get stamped as current). `deps` defaults
 * to the registry rule (`figureDeps`).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param kind - the figure kind (registry key).
 * @param language - role language (cache key).
 * @param factsVersion - the facts version the data was generated against.
 * @param data - the figure payload (chain's canonical shape).
 * @param options - index for the deps rule, method-level variant, explicit
 *   deps override, session sandbox policy.
 */
export declare function writeFigure(fs: FileSystem, root: string, kind: EntityFigureId, language: string, factsVersion: number, data: unknown, options?: {
    index?: CodeIndexResult | undefined;
    methods?: boolean;
    deps?: string[];
    policy?: SandboxExecutionPolicy | undefined;
}): Promise<void>;
/**
 * Whether a figure cache exists and was written against the CURRENT facts
 * version (a versioned envelope with `v === factsVersion`; legacy/corrupt/
 * invalidated files and an unknown facts version all read as invalid).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param cacheFile - the CACHE_DIR-relative file name from a spec.
 * @param factsVersion - the current facts version (0 = unknown ⇒ never valid).
 * @returns whether the cached figure may be served.
 */
export declare function isFigureCacheValid(fs: FileSystem, root: string, cacheFile: string, factsVersion: number): Promise<boolean>;
/** Outcome of reading the code-index facts from disk. */
export type IndexFactsOutcome = {
    index: CodeIndexResult;
} | {
    error: string;
};
/**
 * READ-ONLY code-index facts: parse the versioned `{ v, data }` envelope of
 * `index/.arch-lens-index.json` (written by the codeIndex provider during
 * 「↻ 重新扫描」) and refuse anything that is not the CURRENT facts version —
 * legacy unversioned files, foreign versions and missing files all return the
 * "rescan first" error (same shape as before the envelope existed). No index
 * service call, no LLM.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @returns the current index, or a user-facing error string.
 */
export declare function readIndexFacts(fs: FileSystem, root: string): Promise<IndexFactsOutcome>;
/** Outcome of one entity-figure rebuild pass. */
export interface EntityFigurePassOutcome {
    rebuilt: string[];
    skipped: string[];
    errors: string[];
}
/**
 * The generateAll loop shared by「🔁 全量重建」/「⚡ 变动更新」(behavior
 * unchanged from the hand-rolled steps): incremental mode skips every figure
 * whose cache is valid against the current facts version and force-redraws
 * only the missing/stale ones; non-incremental force-redraws everything.
 * Every step runs even when one fails; the caller formats `errors`.
 * @param env - the figure environment.
 * @param incremental - smart-incremental mode (frontend default: true).
 * @param specs - the figure list (defaults to the registry; parameterized for tests).
 * @returns the rebuilt/skipped ids and collected errors.
 */
export declare function runEntityFigurePass(env: FigureEnv, incremental: boolean, specs?: readonly FigureKindSpec[]): Promise<EntityFigurePassOutcome>;
//# sourceMappingURL=figures.d.ts.map