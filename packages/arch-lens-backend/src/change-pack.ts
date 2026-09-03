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

/** A scanned node's id and absolute dir, for path-prefix change mapping. */
export interface ScanNodeRef {
  id: string
  path: string
}

/** Normalize a path for prefix comparison ('/' separators, no trailing slash). */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Extract the package id from a workspace-relative file path.
 *
 * Two resolvers, tried in order:
 *  1. The legacy npm layout, disambiguated against the KNOWN package ids:
 *     `packages/<pkg>/src/…` (flat) vs `packages/<group>/<pkg>/…` (grouped).
 *     The first segment is the package when it is a known id; otherwise the
 *     second segment is — `src/` is never a package, so a flat path can never
 *     misread as a group layout.
 *  2. Longest-prefix match over the scanned node dirs (python/java/unknown and
 *     TypeScript root-fallback scans, whose sources live outside `packages/`):
 *     the absolute file path is compared against every node dir and the node
 *     owning the deepest enclosing directory wins.
 */
function packageOfRel(
  rel: string,
  known: ReadonlySet<string>,
  nodes: readonly ScanNodeRef[] | undefined,
  root: string | undefined,
): string | null {
  const m = /^packages\/([^/]+)(?:\/([^/]+))?\//.exec(rel)
  if (m !== null) {
    const first = m[1]!
    const second = m[2]
    if (known.has(first)) return first
    if (second !== undefined && known.has(second)) return second
  }
  if (nodes !== undefined && root !== undefined && nodes.length > 0) {
    const rootNorm = norm(root)
    const abs = rel === '' ? rootNorm : `${rootNorm}/${norm(rel)}`
    let best: string | null = null
    let bestLen = -1
    for (const node of nodes) {
      const dir = norm(node.path)
      if (dir !== '' && (abs === dir || abs.startsWith(`${dir}/`)) && dir.length > bestLen) {
        best = node.id
        bestLen = dir.length
      }
    }
    if (best !== null) return best
  }
  return null
}

/** Extra context for resolving changed files outside the `packages/` layout. */
export interface ChangePackContext {
  /** Absolute workspace root (joins the relative file paths). */
  root?: string
  /** Scanned node id + dir pairs (python/java/fallback scans). */
  nodes?: readonly ScanNodeRef[]
}

/**
 * Compute the changed-package set from file changes and the old/new package
 * id sets. A package directory name is only counted when it matches a known
 * package id (old or new), so non-package paths (docs, root config) never
 * produce phantom packages. `context` carries the fresh scan's node dirs so
 * files under python/java module/layer dirs resolve to their node id too.
 */
export function computeChangedPackages(
  fileChanges: WorkspaceFileChanges,
  oldIds: string[],
  newIds: string[],
  context?: ChangePackContext,
): WorkspaceChanges {
  const known = new Set<string>([...oldIds, ...newIds])
  const changedPackages = new Set<string>()
  for (const rel of [...fileChanges.added, ...fileChanges.modified, ...fileChanges.removed]) {
    const pkg = packageOfRel(rel, known, context?.nodes, context?.root)
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
