/**
 * Workspace discovery for the code-index provider: detect the primary
 * language, locate package/module roots, and collect source files per
 * language, plus manifest-level dependency extraction. File operations flow
 * through the fs service's FsTarget identities; display paths cross the
 * boundary only for reporting.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/discover
 */
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs';
import type { CodeLanguage } from '@deepseek-ai/dsh-code-index';
/** Detect the primary language of a workspace by probing manifests. */
export declare function detectLanguage(fs: FileSystem, root: string): Promise<CodeLanguage>;
/**
 * Discover package roots for a workspace of one language.
 * TypeScript: `packages/<group>/<pkg>` dirs (plus a root package with source).
 * Python/Java: manifest-bearing dirs up to depth 3.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - primary language.
 * @returns absolute package root display paths.
 */
export declare function discoverPackageRoots(fs: FileSystem, root: string, language: CodeLanguage): Promise<string[]>;
/** Relative path of a file under the workspace root, `/`-separated. */
export declare function relPath(root: string, file: string): string;
/**
 * Collect source files of a package (bounded, skip dirs excluded).
 * @param fs - filesystem service.
 * @param pkgDir - absolute package root display path.
 * @param language - package language.
 * @returns resolved source file targets.
 */
export declare function collectSources(fs: FileSystem, pkgDir: string, language: Exclude<CodeLanguage, 'unknown'>): Promise<FsTarget[]>;
/** Read a small text file via its target, or return null. */
export declare function readSmall(fs: FileSystem, target: FsTarget, maxBytes?: number): Promise<string | null>;
/**
 * Package-level dependencies from the manifest, best-effort per language.
 * @param fs - filesystem service.
 * @param pkgDir - absolute package root display path.
 * @param language - package language.
 * @returns dependency names.
 */
export declare function manifestDeps(fs: FileSystem, pkgDir: string, language: Exclude<CodeLanguage, 'unknown'>): Promise<string[]>;
//# sourceMappingURL=discover.d.ts.map