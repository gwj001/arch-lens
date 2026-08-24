/**
 * Unit tests for computeChangedPackages: file CRUD paths map back to package
 * ids (flat and grouped layouts), package add/remove surfaces as
 * addedPackages/removedPackages, and non-package paths never phantom.
 */
import { describe, it, expect } from 'vitest'
import { computeChangedPackages } from '../src/change-pack.ts'
import type { WorkspaceFileChanges } from '../src/manifest.ts'

describe('computeChangedPackages', () => {
  it('maps file changes back to package ids and reports add/remove packages', () => {
    const fileChanges: WorkspaceFileChanges = {
      changed: true,
      added: ['packages/c/src/new.ts'],
      modified: ['packages/a/src/index.ts'],
      removed: ['packages/b/src/old.ts'],
      changedFiles: ['packages/c/src/new.ts', 'packages/a/src/index.ts', 'packages/b/src/old.ts'],
    }
    const changes = computeChangedPackages(fileChanges, ['a', 'b'], ['a', 'b', 'c'])
    expect(changes.changedPackages.sort()).toEqual(['a', 'b', 'c'])
    expect(changes.addedPackages).toEqual(['c'])
    expect(changes.removedPackages).toEqual([])
  })

  it('handles the grouped layout packages/<group>/<pkg>/…', () => {
    const fileChanges: WorkspaceFileChanges = {
      changed: true,
      added: ['packages/shared/util/src/index.ts'],
      modified: [],
      removed: [],
      changedFiles: ['packages/shared/util/src/index.ts'],
    }
    const changes = computeChangedPackages(fileChanges, ['util'], ['util'])
    expect(changes.changedPackages).toEqual(['util'])
  })

  it('package add/remove surfaces in changedPackages even without file hits', () => {
    const fileChanges: WorkspaceFileChanges = {
      changed: true,
      added: [],
      modified: [],
      removed: [],
      changedFiles: [],
    }
    const changes = computeChangedPackages(fileChanges, ['old-pkg'], ['new-pkg'])
    expect(changes.changedPackages.sort()).toEqual(['new-pkg', 'old-pkg'])
    expect(changes.addedPackages).toEqual(['new-pkg'])
    expect(changes.removedPackages).toEqual(['old-pkg'])
  })

  it('non-package paths (root docs) never produce phantom packages', () => {
    const fileChanges: WorkspaceFileChanges = {
      changed: true,
      added: ['README.md'],
      modified: [],
      removed: [],
      changedFiles: ['README.md'],
    }
    const changes = computeChangedPackages(fileChanges, ['a'], ['a'])
    expect(changes.changedPackages).toEqual([])
  })
})
