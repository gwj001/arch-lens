/**
 * Workspace repository scanning for the Arch Lens backend: language-aware
 * package/module discovery, README blurbs, source file lists, Spring 1a
 * annotation hints, and per-package detail projection.
 *
 * Language dispatch mirrors the code-index provider's detectLanguage order
 * (package.json → typescript, pyproject.toml/setup.py → python,
 * build.gradle(.kts)/pom.xml → java, else unknown) so the two pipelines
 * agree about what a workspace is. Layouts:
 *   - typescript + `packages/`: the historical npm monorepo scan — byte
 *     identical output (no `lang` field), with ONE addition: zero packages
 *     falls back to a root-level single node instead of erroring.
 *   - python: manifest-bearing dirs (≤3 deep, ALL collected — uv/pdm
 *     workspaces carry a root pyproject AND nested members). ≥2 code dists →
 *     one node per dist; a single code dist → split by its top-level import
 *     packages when a clear src/ or flat structure exposes ≥2 of them
 *     (agent-framework repos like openai-agents), else one node.
 *   - java (Spring 生态): pom dirs ≤3 deep (descending INTO aggregators).
 *     ≥2 code modules → one node per module; a single module → split by the
 *     first-level business packages under the application root package
 *     (the dir holding the @SpringBootApplication class), plus an entry node
 *     for root-level classes (the main class). Gradle-only repos fall back to
 *     src/main/java-based discovery. 1a pass stamps Spring stereotypes /
 *     feign targets / listener topics / endpoint paths onto nodes.
 *   - unknown: one root node — scanning NEVER fails on an exotic layout.
 *
 * Every directory access is stat-guarded (exists-first), so the scan behaves
 * identically against the real dsh-fs (missing dir ⇒ FS_NOT_FOUND) and the
 * in-memory FakeFs used by tests (missing dir ⇒ empty listing).
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
 * Classify a src file name into a role (TypeScript layout).
 * @param name - file basename.
 * @returns the role label.
 */
export declare function roleOf(name: string): ArchLensFileRole;
/**
 * Project one package into its detail view (language-aware entry detection).
 * @param fs - the filesystem service.
 * @param node - the package node.
 * @param dependents - short ids of packages that depend on this one.
 * @returns the detail projection.
 */
export declare function componentDetail(fs: FileSystem, node: ArchLensPackageNode, dependents: readonly string[]): Promise<ArchLensComponentDetail>;
/**
 * Scan the workspace package tree, language-aware.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @returns the graph, or an error result (unexpected IO faults only — exotic
 * layouts never error; they fall back to a root node or an empty graph).
 */
export declare function scanWorkspace(fs: FileSystem, root: string): Promise<ArchLensGraph | {
    error: string;
}>;
//# sourceMappingURL=scan.d.ts.map