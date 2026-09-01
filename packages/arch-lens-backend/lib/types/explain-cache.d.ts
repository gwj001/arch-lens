/**
 * Explain versioning (comprehension-spine phase 3, memo §五).
 *
 * An explain turn (学习桌「讲解」) is captured into a per-chapter versioned
 * envelope `.arch-lens-explain-<章>-<语言>.json`. The chapter resolution
 * gradient gains one rung: a FRESH explain lands the chapter with ZERO extra
 * LLM calls (the explain was written in document register on the learning
 * path — the doc comes for free).
 *
 * Envelope semantics match every other cache: `v` = factsVersion at capture;
 * `deps` = the chapter's figure deps (a code change that invalidates the
 * figure also invalidates the explain); `requires` = the chapter's spine
 * requires (an in-place figure regeneration cascades and tombstones the
 * explain through `invalidateRequiring`). Missing/stale explains fall back to
 * the normal host-direct generation chain — one-click docs always complete.
 *
 * This module is a LEAF: it only reads/writes envelopes and never imports
 * docchapter (docchapter computes the chapter deps and imports this).
 * @module @deepseek-ai/dsh-arch-lens-backend/src/explain-cache
 */
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { DocKind } from './types.ts';
/** Cache file base shared by every explain envelope (CACHE_DIR-relative). */
export declare const EXPLAIN_CACHE_BASE = ".arch-lens-explain";
/** The AUTHORITATIVE explain envelope file name (CACHE_DIR-relative). */
export declare function explainCacheName(kind: DocKind, language: string): string;
/** One explain turn's captured payload. */
export interface ExplainCache {
    /** The explain's answer, written in document register. */
    markdown: string;
    /** The desk's explain target label (e.g. 「时序」「组件 gateway」). */
    target: string;
    /** The question text that produced it. */
    question: string;
    /** Capture timestamp. */
    at: number;
}
/**
 * Read a FRESH explain envelope for a chapter: `v === factsVersion` and a
 * non-empty markdown. A tombstone (`{v:0}`), stale or absent envelope reads
 * as null — the caller falls back to the normal generation chain.
 * @param factsVersion - the CURRENT facts version (0 = unknown ⇒ never fresh).
 */
export declare function readExplainCache(fs: FileSystem, root: string, kind: DocKind, language: string, factsVersion: number): Promise<ExplainCache | null>;
/**
 * Persist one explain turn into its per-chapter envelope. `deps` is computed
 * by the caller from the chapter's figure cache (docchapter.chapterExplainDeps)
 * so a code change invalidates the explain exactly when it invalidates the
 * figure; `requires` carries the chapter's spine requires so an in-place
 * figure regeneration cascades (invalidateRequiring) and tombstones it.
 */
export declare function writeExplainCache(fs: FileSystem, root: string, kind: DocKind, language: string, payload: ExplainCache, factsVersion: number, deps: string[] | undefined, requires: readonly string[], sandboxPolicy?: SandboxExecutionPolicy): Promise<void>;
//# sourceMappingURL=explain-cache.d.ts.map