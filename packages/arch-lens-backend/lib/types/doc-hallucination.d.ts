/**
 * Hallucination gate for generated doc chapters (V1 docs write path).
 *
 * The facts fed to the chapter LLM are true (scan graph / code index); this
 * module verifies the OUTPUT stayed inside them. It never touches facts,
 * staleness or the model — only the prose-to-facts faithfulness diff:
 * fabricated package names, invented file paths, call edges that do not
 * exist (or run backwards). Pure function, zero IO, zero LLM — the same
 * "产物过检才入库" discipline as the figure render gate.
 *
 * Precision over recall: only high-confidence reference forms are checked
 * (backticked scoped packages, code-extension paths, `| 调用方 | 被调用方 |`
 * tables). Bare identifiers (function names…) and fenced code blocks are
 * never flagged — a false positive bounces a good chapter, which hurts more
 * than a missed fabrication.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/doc-hallucination
 */
/** Authoritative entity sets assembled once per generation round. */
export interface DocGroundTruth {
    /** Every legitimate package name form (graph node ids, index ids, npm names). */
    packages: ReadonlySet<string>;
    /** Workspace-relative source file paths (normalized: `/` separators, no `./`). */
    files: ReadonlySet<string>;
    /** Real import/call edges, keyed `from\0to`. */
    edges: ReadonlySet<string>;
}
/** One reference in the prose that the facts do not back. */
export interface DocViolation {
    kind: 'package' | 'file' | 'edge';
    /** The offending token exactly as written. */
    token: string;
    /** Human-readable reason (embedded into the repair prompt). */
    reason: string;
    /** Closest real entity when cheaply computable (edit distance / reversal). */
    suggestion?: string;
}
/**
 * Backticked package references in a text that ARE real (intersected with the
 * ground-truth package set). The SAME extraction the gate checks. Used as the
 * deps-union defense: whatever real package the prose cites must be in the
 * envelope `deps`, so a change to it invalidates the chapter even when a prior
 * draft (or an explain) kept a reference outside the scoped fact block — the
 * DELETE-gone-names contract is prompt-level, this is the deterministic backstop.
 * @param text - the chapter/explain markdown.
 * @param truth - ground-truth package set (same snapshot as the gate).
 * @returns the cited real packages (de-duplicated, order of first mention).
 */
export declare function citedPackages(text: string, truth: DocGroundTruth): string[];
/**
 * Validate one generated chapter body against the ground-truth sets.
 * @param text - the chapter markdown (as the model returned it).
 * @param truth - facts the chapter prompt was built from (same snapshot).
 * @returns violations (bounded to MAX_VIOLATIONS); empty = the prose is faithful.
 */
export declare function checkDocProse(text: string, truth: DocGroundTruth): DocViolation[];
/** Format violations for the repair prompt (bounded, one line each). */
export declare function formatViolations(violations: readonly DocViolation[]): string;
//# sourceMappingURL=doc-hallucination.d.ts.map