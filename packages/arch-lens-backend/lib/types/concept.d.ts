/**
 * Concept-hierarchy generation for the Arch Lens backend, as a replaceable
 * one-way chain:
 *
 *   detectArchDocs(root) → extractDocTree(doc, root)
 *                      ↘ (no doc) generateFromFlow(index)
 *   every stage writes/reads the per-language cache (.arch-lens-concept-<lang>.json)
 *
 * Doc extraction is VERBATIM (no LLM enhancement): nodes carry the original
 * section text and a source anchor so explains can cite evidence. The chain
 * order is FIXED today (docs first, LLM-from-flow as fallback) but each stage
 * is an independent function, so the strategy can be reordered or swapped
 * without touching consumers.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/concept
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { ArchLensConceptNode } from './types.ts';
/** One concept-tree node (wire type from types.ts). */
export type ConceptTreeNode = ArchLensConceptNode;
/**
 * Language-ordered doc candidates: non-English roles read the zh translation
 * first (docs/architecture.zh.md), English keeps the primary doc first.
 * @param language - role language ('English' or a non-English default).
 * @returns the candidate list in probe order.
 */
export declare function docCandidates(language?: string): string[];
/** Markdown heading levels that become tree depth (shared with flow.ts). */
export declare const HEADING_RE: RegExp;
/**
 * The AUTHORITATIVE concept cache file name, exported for the figure
 * registry (`figures.ts`): consumers must never re-spell cache names.
 * @param language - role language.
 * @param methods - 🔬 method-level variant.
 * @returns the CACHE_DIR-relative cache file name.
 */
export declare function conceptCacheName(language: string, methods?: boolean): string;
/**
 * Stage 1: probe the workspace for architecture documentation. Returns the
 * first candidate that exists as a file (README last — it is the weakest
 * signal and also the fallback for blurbs). Non-English roles probe the zh
 * translation first.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language ('English' or a non-English default).
 * @returns the doc's display path, or null when no candidate exists.
 */
export declare function detectArchDocs(fs: FileSystem, root: string, language?: string): Promise<string | null>;
/**
 * Stage 2: extract a concept tree from a Markdown doc by its heading
 * hierarchy. Pure rule stage — zero LLM, deterministic. Every node carries
 * its source anchor (`ref`: doc path + heading) and the section's full
 * original text (`sourceText`, bounded) so explains can cite verbatim
 * evidence instead of paraphrase.
 * @param fs - filesystem service.
 * @param docPath - display path of the doc.
 * @param root - workspace root (refs are workspace-relative).
 * @returns the extracted tree (may be empty when the doc has no headings).
 */
export declare function extractDocTree(fs: FileSystem, docPath: string, root: string): Promise<ConceptTreeNode[]>;
/**
 * Fallback stage: LLM induces a concept tree from the run-flow metadata
 * (entry files, imports, entities) — the "no architecture doc" path. Output
 * is the role language; the tree is bounded to keep the request small.
 * @param ctx - host context.
 * @param index - code index result.
 * @param language - role language.
 * @param signal - optional cancellation (⏹ 终止).
 * @param methods - 🔬 方法级: append per-class method names so concept
 *   descriptions can cite real functions.
 * @returns the induced tree (empty on failure).
 */
export declare function generateFromFlow(ctx: Context, index: CodeIndexResult, language: string, signal?: AbortSignal, methods?: boolean): Promise<ConceptTreeNode[]>;
/**
 * READ-ONLY concept tree: serve the versioned cache when its facts version
 * matches; null when absent/stale. NEVER generates (no doc extraction, no
 * LLM, no cache write) — generation is owned by the write paths (AI 生成 /
 * rescan-dependent regenerate).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @param methods - 🔬 方法级 cache variant.
 * @returns the cached tree, or null when no matching cache exists.
 */
export declare function readConceptTree(fs: FileSystem, root: string, language: string, methods?: boolean): Promise<ConceptTreeNode[] | null>;
/**
 * The full concept-tree chain: cache → detect doc → extract (verbatim, with
 * source anchors) → shared profile → (no doc) generate from flow. No LLM
 * enhancement — nodes carry the document's original text so explains can cite
 * evidence. Every successful stage writes the language cache; `force`
 * bypasses it. WRITE path only: reads happen through readConceptTree().
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (for the flow fallback).
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @param methods - 🔬 方法级: skip the shared (entity-level) profile and
 *   induce from the method-level summary (methods + call edges).
 * @returns the concept tree, or an error result.
 */
export declare function conceptTree(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, force: boolean, sandboxPolicy?: SandboxExecutionPolicy, methods?: boolean): Promise<ConceptTreeNode[] | {
    error: string;
}>;
/**
 * Whether an extracted doc tree is a usable hierarchy: at least two roots,
 * or at least one node with children. A single flat heading is not a
 * "concept hierarchy" — the figure would show one isolated box.
 * @param tree - the extracted doc tree.
 * @returns whether the tree is worth rendering as the doc authority.
 */
export declare function isUsableDocTree(tree: readonly ConceptTreeNode[]): boolean;
//# sourceMappingURL=concept.d.ts.map