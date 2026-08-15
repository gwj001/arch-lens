/**
 * Workspace repository scanning for the Arch Lens backend: package graph,
 * README blurbs, src file lists, and per-package detail projection.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/scan
 */
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { ArchLensComponentDetail, ArchLensFileRole, ArchLensGraph, ArchLensPackageNode } from './types.ts';
/**
 * First non-empty, non-heading, non-comment paragraph of a README head.
 * @param text - the README head text.
 * @returns the trimmed first paragraph (bounded).
 */
export declare function firstParagraph(text: string): string;
/**
 * Classify a src file name into a role.
 * @param name - file basename.
 * @returns the role label.
 */
export declare function roleOf(name: string): ArchLensFileRole;
/**
 * Scan the workspace `packages/<group>/<pkg>` tree into a graph.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @returns the graph, or an error result.
 */
export declare function scanWorkspace(fs: FileSystem, root: string): Promise<ArchLensGraph | {
    error: string;
}>;
/**
 * Project one package into its detail view.
 * @param fs - the filesystem service.
 * @param graph - the scanned graph.
 * @param node - the package node.
 * @returns the detail projection.
 */
export declare function componentDetail(fs: FileSystem, graph: ArchLensGraph, node: ArchLensPackageNode): Promise<ArchLensComponentDetail>;
//# sourceMappingURL=scan.d.ts.map