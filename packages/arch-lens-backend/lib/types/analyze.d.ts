/**
 * Code-first analysis for the Arch Lens backend: scans each package's entry
 * source for service registrations, event listeners, Remote methods, and tool
 * registrations, so the learning desk can derive architecture from CODE even
 * when documentation is missing or stale. The analysis is bounded (entry
 * source head only) and heuristic (regex over source text), and its results
 * are explicitly "code-derived insights" — not a substitute for curated data,
 * but a fallback and cross-check.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/analyze
 */
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { ArchLensCodeInsight, ArchLensGraph } from './types.ts';
/**
 * Analyze one package's entry source for code-derived insights.
 * @param fs - the filesystem service.
 * @param node - package node carrying its path and file list.
 * @returns the insight record (empty arrays when no entry source exists).
 */
export declare function analyzePackage(fs: FileSystem, node: ArchLensGraph['nodes'][number]): Promise<ArchLensCodeInsight>;
/**
 * Analyze every package in the graph (bounded parallel: runs over the entry
 * heads only, sequential per package to keep fs usage flat).
 * @param fs - the filesystem service.
 * @param graph - scanned graph.
 * @returns insight records for packages with any finding.
 */
export declare function analyzeWorkspace(fs: FileSystem, graph: ArchLensGraph): Promise<ArchLensCodeInsight[]>;
//# sourceMappingURL=analyze.d.ts.map