/**
 * Chapter-based architecture doc generation (V1 docs write path).
 *
 * One chapter per DocKind, each an independent product with its OWN versioned
 * envelope cache and its OWN landed file (`docs/architecture-<kind>.generated.md`).
 * 「一键生成文档」 is the serial loop over the seven chapters: a fresh cache is
 * skipped, everything else regenerates independently (independent envelope,
 * independent failure). A chapter's prose is ONE direct host LLM call per
 * round (llmText — same channel as duty summaries; the interactive session is
 * reserved for explains/dynamic figures), grounded in a bounded fact block
 * packed from READ-ONLY figure caches + code facts, then validated by the
 * hallucination gate (doc-hallucination.ts) with ONE repair round before the
 * envelope stamp — faithful output is the only thing that gets cached.
 *
 * Chapters are PURE CONSUMERS: they never trigger figure generation. A
 * figure-driven chapter whose figure cache is missing is skipped with an
 * actionable reason (generate the figure in its tab first).
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docchapter
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { DocGroundTruth, DocViolation } from './doc-hallucination.ts';
import type { ArchLensConceptNode, ArchLensCoreGraph, ArchLensEventRow, ArchLensFlowResult, ArchLensGraph, ArchLensSequenceResult, DocChapterOutcome, DocChaptersOutcome, DocKind } from './types.ts';
/** The ONE chapter list (order = the comprehension spine, aligned with
 * FIGURE_SPECS: vocabulary → claims → skeleton → golden path → nouns →
 * reactions). Keys are the public DocKind boundary type. */
export declare const DOC_CHAPTER_KINDS: readonly DocKind[];
/** Spine `requires` per chapter (phase 2): every cache kind whose CONTENT the
 * chapter consumes — its embedded figure(s) AND its cascade-context inputs
 * (§4.2): er/catalog anchor on the core protagonists, flow/interaction carry
 * the golden path. Recorded in the envelope so an in-place regeneration of any
 * consumed cache cascades and invalidates the chapter. Duties is deliberately
 * NOT recorded: it is covered by the facts version and recording it would
 * over-invalidate every chapter. */
export declare const CHAPTER_REQUIRES: Record<DocKind, readonly string[]>;
/**
 * The explain envelope's `deps` (phase 3): the SAME fact scope the chapter
 * uses (V2① `chapterPackageDeps` subset logic), so an explain can never go
 * stale without being invalidated. Scope empty ⇒ undefined (legacy "depends
 * on every package" — any change invalidates, the safe direction).
 * Interaction/flow explains also cite the golden path, so their scope covers
 * the seq message endpoints too. No index is available at capture time, so
 * global-fact chapters (concepts/er/catalog, AI flows) degrade to undefined.
 */
export declare function chapterExplainDeps(fs: FileSystem, root: string, kind: DocKind, language: string): Promise<string[] | undefined>;
/** The AUTHORITATIVE chapter cache file name (CACHE_DIR-relative). */
export declare function chapterCacheName(kind: DocKind, language: string): string;
/** The AUTHORITATIVE landed doc path (workspace-relative). The `.generated.md`
 * suffix is the safety marker: the plugin only ever writes `*.generated.md`,
 * never the user's own `docs/*.md`. Regeneration overwrites its own file. */
export declare function chapterDocPath(kind: DocKind): string;
/** Chapter title in the role language. */
export declare function chapterTitle(kind: DocKind, language: string): string;
/** One chapter's cached payload. */
export interface DocChapterCache {
    markdown: string;
    generatedAt: number;
}
/**
 * Assemble the authoritative entity sets ONCE per round; the chapter prompt
 * and the hallucination gate must consume this SAME snapshot (re-reading
 * between the two could race a rescan).
 * @param index - code index facts.
 * @param graph - scanned graph facts.
 * @returns package/file/edge ground truth.
 */
export declare function buildGroundTruth(index: CodeIndexResult, graph: ArchLensGraph): DocGroundTruth;
/**
 * V2①: the packages a chapter's envelope depends on — the SAME packages its
 * fact block was scoped to (same-source ⇒ no under-invalidation). Chapters
 * whose facts are inherently global (catalog/concepts/flow) keep the full
 * roster: any change invalidates them, the safe direction.
 */
export declare function chapterPackageDeps(kind: DocKind, cache: FigureFactsCache, graph: ArchLensGraph, index?: CodeIndexResult): string[];
/** All fact blocks the figure caches can serve (READ ONLY — never generates). */
interface FigureFactsCache {
    concepts: ArchLensConceptNode[] | null;
    seq: ArchLensSequenceResult | null;
    flowEvent: ArchLensFlowResult | null;
    flowPipeline: ArchLensFlowResult | null;
    interaction: ArchLensEventRow[] | null;
    core: ArchLensCoreGraph | null;
    duties: Record<string, string> | null;
}
/**
 * Pack one chapter's bounded fact block.
 * @returns the fact text, or null when a figure-driven chapter has no figure.
 */
export declare function packChapterFacts(kind: DocKind, index: CodeIndexResult, graph: ArchLensGraph, cache: FigureFactsCache): Promise<string | null>;
/** The chapter-writer prompt (role language, strict JSON contract). */
export declare function chapterPrompt(kind: DocKind, language: string, facts: string): string;
/** One-shot repair prompt: fix ONLY the listed violations, keep everything else. */
export declare function chapterRepairPrompt(language: string, violations: readonly DocViolation[], markdown: string): string;
/**
 * Prior-draft revision prompt (comprehension-spine phase 1): revise a STALE
 * chapter against fresh facts instead of writing from scratch. Composes the
 * shared revision preamble + the prior draft + the ordinary chapter prompt,
 * so the five writing rules and the strict JSON contract apply unchanged and
 * the hallucination gate downstream re-checks the result. The prior is a
 * shape hint only — facts stay authoritative.
 * @param kind - chapter key.
 * @param language - role language.
 * @param facts - the CURRENT ground-truth facts block.
 * @param prior - the stale chapter markdown (prior draft).
 * @returns the revision prompt.
 */
export declare function chapterRevisePrompt(kind: DocKind, language: string, facts: string, prior: string): string;
/** Pull the markdown out of the model answer (tolerating wrapping prose). */
export declare function extractChapterMarkdown(text: string): string | null;
/** Chapter envelope cache read: only a current-version cache is served. */
export declare function readChapterCache(fs: FileSystem, root: string, kind: DocKind, language: string): Promise<DocChapterCache | null>;
/**
 * Zero-LLM figure section for the landed doc: deterministic renders of the
 * SAME versioned figure caches the tabs show (flow mermaid verbatim —
 * readFlow sanitizes on read; rule-built mermaid for seq/deps/er; list/table
 * for concepts/interaction). '' when the chapter's figures are absent — the
 * prose still lands alone. Figures are cache-derived facts, so the
 * hallucination gate does not apply to them.
 */
export declare function chapterFigureBlocks(kind: DocKind, cache: FigureFactsCache, graph: ArchLensGraph, language: string): string;
/**
 * Generate ONE chapter end to end: facts → prompt → LLM → extract →
 * hallucination gate (one repair round) → envelope cache + landed file.
 * Faithful prose is the only prose that gets cached; a still-violating draft
 * lands with a warning but is NOT cached (the next round retries it).
 * @param priorMarkdown - phase 1 prior draft: a STALE chapter's markdown to
 *   revise instead of writing from scratch ('' = blank generation).
 * @param requires - phase 2 spine deps: figure-cache kinds this chapter
 *   embeds, recorded in the envelope for cascade invalidation.
 * @returns the chapter outcome.
 */
export declare function generateDocChapter(ctx: Context, fs: FileSystem, root: string, kind: DocKind, language: string, facts: string, truth: DocGroundTruth, factsVersion: number, allPackageIds: string[], figureBlocks?: string, sandboxPolicy?: SandboxExecutionPolicy, priorMarkdown?: string, requires?: readonly string[]): Promise<DocChapterOutcome>;
/**
 * 「一键生成文档」 V1: the serial chapter loop. Fresh caches are skipped;
 * everything else regenerates with an independent envelope and independent
 * failure. An abort between chapters stops the round cleanly.
 * @param ctx - host context (llm services).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index facts.
 * @param graph - scanned graph facts.
 * @param language - role language.
 * @param sandboxPolicy - session-scoped write policy.
 * @returns per-chapter outcomes, or a round-level error.
 */
export declare function generateDocChapters(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, graph: ArchLensGraph, language: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<DocChaptersOutcome>;
export {};
//# sourceMappingURL=docchapter.d.ts.map