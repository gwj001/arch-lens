/**
 * Aggregate a per-file change classification into per-package facts: which
 * packages changed (files CRUD + package add/remove), and the added/removed
 * package ids. This is the "变动的事实依据" the selective invalidation and
 * the client change notice consume.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/change-pack
 */
import type { WorkspaceFileChanges } from './manifest.ts';
import type { WorkspaceChanges } from './types.ts';
export type { WorkspaceChanges };
/**
 * Compute the changed-package set from file changes and the old/new package
 * id sets. A package directory name is only counted when it matches a known
 * package id (old or new), so non-package paths (docs, root config) never
 * produce phantom packages.
 */
export declare function computeChangedPackages(fileChanges: WorkspaceFileChanges, oldIds: string[], newIds: string[]): WorkspaceChanges;
//# sourceMappingURL=change-pack.d.ts.map