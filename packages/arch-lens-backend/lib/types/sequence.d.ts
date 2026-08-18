/**
 * Sequence-diagram data for the Arch Lens backend, as a replaceable chain:
 *
 *   buildSequenceFromCalls(index)   — real static call graph (source 'code')
 *   readSeqCache(root, language)    — cached doc/LLM result
 *   extractSequenceFromDoc(root)    — verbatim doc section (source 'doc')
 *   writeStructuredCache('seq')     — LLM induction (source 'flow')
 *
 * Resolution order is FIXED: real call edges first (the only authoritative
 * source — static analysis of what the code can call), then the cached
 * doc/LLM result, then a fresh doc extraction, then LLM induction. Every
 * stage is an independent function, so the strategy can be reordered without
 * touching consumers.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/sequence
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { ArchLensSequenceResult, ArchLensSequenceMessage } from './types.ts';
/**
 * Stage 1 (code): derive ordered messages from real source-level call edges.
 * Edges are resolved symbol → import → module → package; only cross-package
 * edges become messages. Traversal starts at entry packages (BFS, bounded),
 * so the result reads as "entry → … → leaf" flow.
 * @param index - code index result with raw call edges.
 * @param language - role language (label wording).
 * @returns the code-sourced figure, or null when unusable.
 */
export declare function buildSequenceFromCalls(index: CodeIndexResult, language: string): ArchLensSequenceResult | null;
/**
 * Extract the doc's `## 时序` (sequence) section verbatim and parse it into
 * messages. Pure rule stage — zero LLM, deterministic. Supports mermaid
 * `sequenceDiagram` blocks (with `participant X as 别名` aliases) and plain
 * `A -> B: label` / `A→B: label` lines.
 * @param text - the section text (or whole doc; heading scan is cheap).
 * @returns parsed messages, possibly empty.
 */
export declare function parseSequenceSection(text: string): ArchLensSequenceMessage[];
/**
 * Stage 2 (doc): locate the architecture doc, extract its `## 时序` section,
 * and parse it verbatim into messages.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (doc candidate ordering).
 * @returns the doc-sourced figure, or null when no usable section exists.
 */
export declare function extractSequenceFromDoc(fs: FileSystem, root: string, language: string): Promise<ArchLensSequenceResult | null>;
/** Extract the level-2 section with the given title (until the next ≤2 heading). */
export declare function sectionText(text: string, title: string): string | null;
/** Read the sequence cache: object format, legacy raw arrays map to 'flow'. */
export declare function readSeqCache(fs: FileSystem, root: string, language: string): Promise<ArchLensSequenceResult | null>;
/** Persist a doc-sourced figure so subsequent reads skip the doc scan. */
export declare function writeSeqCache(fs: FileSystem, root: string, language: string, result: ArchLensSequenceResult, sandboxPolicy?: SandboxExecutionPolicy): Promise<void>;
/**
 * The resolution chain: code call graph → cached result → doc section →
 * LLM induction. The LLM stage writes its own cache (raw array) via
 * writeStructuredCache; the doc stage caches the parsed object here.
 * @param ctx - host context (llm services for the fallback stage).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (raw call edges for stage 1).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for cache writes.
 * @returns the figure, or null when no stage produced usable data.
 */
export declare function resolveSequence(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, language: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<ArchLensSequenceResult | null>;
//# sourceMappingURL=sequence.d.ts.map