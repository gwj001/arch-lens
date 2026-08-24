/**
 * Aggregate a per-file change classification into per-package facts: which
 * packages changed (files CRUD + package add/remove), and the added/removed
 * package ids. This is the "变动的事实依据" the selective invalidation and
 * the client change notice consume.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/change-pack
 */
import type { WorkspaceFileChanges } from './manifest.ts'
import type { WorkspaceChanges } from './types.ts'

export type { WorkspaceChanges }

/**
 * Extract the package id from a workspace-relative file path, disambiguating
 * the two layouts against the KNOWN package ids: `packages/<pkg>/src/…`
 * (flat) vs `packages/<group>/<pkg>/…` (grouped). The first segment is the
 * package when it is a known id; otherwise the second segment is — `src/` is
 * never a package, so a flat path can never misread as a group layout.
 */
function packageOfRel(rel: string, known: ReadonlySet<string>): string | null {
  const m = /^packages\/([^/]+)(?:\/([^/]+))?\//.exec(rel)
  if (m === null) return null
  const first = m[1]!
  const second = m[2]
  if (known.has(first)) return first
  if (second !== undefined && known.has(second)) return second
  return null
}

/**
 * Compute the changed-package set from file changes and the old/new package
 * id sets. A package directory name is only counted when it matches a known
 * package id (old or new), so non-package paths (docs, root config) never
 * produce phantom packages.
 */
export function computeChangedPackages(
  fileChanges: WorkspaceFileChanges,
  oldIds: string[],
  newIds: string[],
): WorkspaceChanges {
  const known = new Set<string>([...oldIds, ...newIds])
  const changedPackages = new Set<string>()
  for (const rel of [...fileChanges.added, ...fileChanges.modified, ...fileChanges.removed]) {
    const pkg = packageOfRel(rel, known)
    if (pkg !== null) changedPackages.add(pkg)
  }
  const oldSet = new Set(oldIds)
  const newSet = new Set(newIds)
  const addedPackages = newIds.filter(id => !oldSet.has(id))
  const removedPackages = oldIds.filter(id => !newSet.has(id))
  for (const id of addedPackages) changedPackages.add(id)
  for (const id of removedPackages) changedPackages.add(id)
  return {
    added: fileChanges.added,
    modified: fileChanges.modified,
    removed: fileChanges.removed,
    changedPackages: [...changedPackages].sort(),
    addedPackages,
    removedPackages,
  }
}
