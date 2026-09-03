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
/** A scanned node's id and absolute dir, for path-prefix change mapping. */
export interface ScanNodeRef {
    id: string;
    path: string;
}
/** Extra context for resolving changed files outside the `packages/` layout. */
export interface ChangePackContext {
    /** Absolute workspace root (joins the relative file paths). */
    root?: string;
    /** Scanned node id + dir pairs (python/java/fallback scans). */
    nodes?: readonly ScanNodeRef[];
}
/**
 * Compute the changed-package set from file changes and the old/new package
 * id sets. A package directory name is only counted when it matches a known
 * package id (old or new), so non-package paths (docs, root config) never
 * produce phantom packages. `context` carries the fresh scan's node dirs so
 * files under python/java module/layer dirs resolve to their node id too.
 */
export declare function computeChangedPackages(fileChanges: WorkspaceFileChanges, oldIds: string[], newIds: string[], context?: ChangePackContext): WorkspaceChanges;
//# sourceMappingURL=change-pack.d.ts.map