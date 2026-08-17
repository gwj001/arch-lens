/**
 * Workspace repository scanning for the Arch Lens backend: package graph,
 * README blurbs, src file lists, and per-package detail projection.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/scan
 */
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { ArchLensComponentDetail, ArchLensFileRole, ArchLensGraph, ArchLensPackageNode } from './types.ts';
/**
 * First non-empty, non-heading, non-comment, non-language-switch paragraph of
 * a README head.
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
 * Scan the workspace `packages/<group>/<pkg>` tree into a graph. Each node
 * carries its precomputed popup detail, so the client can open package
 * details instantly without a second round trip.
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
 * @param node - the package node.
 * @param dependents - short ids of packages that depend on this one.
 * @returns the detail projection.
 */
export declare function componentDetail(fs: FileSystem, node: ArchLensPackageNode, dependents: readonly string[]): Promise<ArchLensComponentDetail>;
//# sourceMappingURL=scan.d.ts.map