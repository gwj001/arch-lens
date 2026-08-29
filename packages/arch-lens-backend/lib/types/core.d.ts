/**
 * Core-flow package selection for the Arch Lens backend: pick the packages
 * that form the project's core flow. The LLM selects ids from the index
 * summary (validated against the index — unknown ids are dropped); a
 * deterministic fallback (entry packages plus their source-import neighbors,
 * depth 1) covers LLM failure so the figure never renders empty. Edges are
 * derived by rules elsewhere (mermaid.ts importEdges); this module owns only
 * the selection and its provenance.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/core
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { ArchLensCoreGraph } from './types.ts';
/**
 * The AUTHORITATIVE core cache file name, exported for the figure registry
 * (`figures.ts`): consumers must never re-spell cache names.
 * @param language - role language.
 * @param methods - 🔬 method-level variant.
 * @returns the CACHE_DIR-relative cache file name.
 */
export declare function coreCacheName(language: string, methods?: boolean): string;
/**
 * READ-ONLY core selection: serve the versioned cache when its facts version
 * matches; null when absent/stale. NEVER generates (no profile, no LLM pick,
 * no deterministic fallback, no cache write) — generation is owned by the
 * write paths (AI 生成 / regenerate). D2: 架构概览 has no rule fallback on
 * read — facts appear only after a rescan plus the user's generate action.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @param methods - 🔬 方法级 cache variant.
 * @returns the cached selection, or null when no matching cache exists.
 */
export declare function readCore(fs: FileSystem, root: string, language: string, methods?: boolean): Promise<ArchLensCoreGraph | null>;
/**
 * The full core-selection chain: cache → LLM pick (validated) → deterministic
 * fallback. `force` bypasses the cache and rebuilds the selection facts.
 * WRITE path only: reads happen through readCore().
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @returns the core selection, or an error result.
 */
export declare function coreGraph(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, force: boolean, sandboxPolicy?: SandboxExecutionPolicy, methods?: boolean): Promise<ArchLensCoreGraph | {
    error: string;
}>;
//# sourceMappingURL=core.d.ts.map