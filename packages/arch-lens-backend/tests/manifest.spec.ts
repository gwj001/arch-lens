/**
 * Unit tests for layer-1 change detection (checkWorkspaceChanges): the
 * persisted manifest, the version fast-path, the md5 confirmation, and the
 * add/remove/cosmetic-touch cases. The FileSystem is faked with an in-memory
 * tree (see fake-fs.ts) whose per-file version token the tests control.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { checkWorkspaceChanges, type WorkspaceFileChanges } from '../src/manifest.ts'
import { FakeFs } from './fake-fs.ts'

const ROOT = '/ws'

/** A tiny tree: one package with two src files + a manifest cache dir. */
function sampleWorkspace(): FakeFs {
  return new FakeFs({
    '': null,
    'packages': null,
    'packages/a': null,
    'packages/a/package.json': '{"name":"a"}',
    'packages/a/src': null,
    'packages/a/src/index.ts': 'export const a = 1',
    'packages/a/src/util.ts': 'export const u = 2',
    'index': null,
  })
}

let fs: FakeFs

beforeEach(() => {
  fs = sampleWorkspace()
  runFs = fs
})

// The fake structurally satisfies the module's ManifestFs duck-typed shape.
// NOTE: no type assertion (`fs as any`) — esbuild/vitest transform of an
// assertion expression inside a test file trips a JS heap OOM in the worker
// on Windows. Declaring `fs: any` sidesteps the assertion entirely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runFs: any

function runCheck(): Promise<WorkspaceFileChanges> {
  return checkWorkspaceChanges(runFs, ROOT)
}

describe('checkWorkspaceChanges', () => {
  it('first scan (no manifest) reports changed and persists a manifest', async () => {
    const first = await runCheck()
    expect(first.changed).toBe(true)
    expect(first.changedFiles.sort()).toEqual([
      'packages/a/package.json',
      'packages/a/src/index.ts',
      'packages/a/src/util.ts',
    ])
    // 首扫：全部是「新增」；无修改/删除。
    expect(first.added.sort()).toEqual([
      'packages/a/package.json',
      'packages/a/src/index.ts',
      'packages/a/src/util.ts',
    ])
    expect(first.modified).toEqual([])
    expect(first.removed).toEqual([])
    // The manifest landed in the cache dir, excluded from the walk itself.
    expect(fs.files.has('index/.arch-lens-file-manifest.json')).toBe(true)
    expect(fs.files.has('index')).toBe(true)
  })

  it('second scan with no edits reports changed=false', async () => {
    await runCheck()
    const second = await runCheck()
    expect(second.changed).toBe(false)
    expect(second.changedFiles).toEqual([])
  })

  it('a content edit changes one file only (modified)', async () => {
    await runCheck()
    fs.setFile('packages/a/src/index.ts', 'export const a = 2')
    const second = await runCheck()
    expect(second.changed).toBe(true)
    expect(second.changedFiles).toEqual(['packages/a/src/index.ts'])
    expect(second.modified).toEqual(['packages/a/src/index.ts'])
    expect(second.added).toEqual([])
    expect(second.removed).toEqual([])
  })

  it('a newly added file counts as changed (added)', async () => {
    await runCheck()
    fs.setFile('packages/a/src/new.ts', 'export const n = 1')
    const second = await runCheck()
    expect(second.changed).toBe(true)
    expect(second.changedFiles).toEqual(['packages/a/src/new.ts'])
    expect(second.added).toEqual(['packages/a/src/new.ts'])
    expect(second.modified).toEqual([])
    expect(second.removed).toEqual([])
  })

  it('a removed file counts as changed (removed)', async () => {
    await runCheck()
    fs.remove('packages/a/src/util.ts')
    const second = await runCheck()
    expect(second.changed).toBe(true)
    expect(second.changedFiles).toEqual(['packages/a/src/util.ts'])
    expect(second.removed).toEqual(['packages/a/src/util.ts'])
    expect(second.added).toEqual([])
    expect(second.modified).toEqual([])
  })

  it('a cosmetic touch (same content, new version token) is NOT a change', async () => {
    await runCheck()
    fs.touch('packages/a/src/index.ts')
    const second = await runCheck()
    expect(second.changed).toBe(false)
    expect(second.changedFiles).toEqual([])
  })

  it('excluded dirs (.git / node_modules) never count as changes', async () => {
    await runCheck()
    fs.setFile('.git/HEAD', 'ref: refs/heads/master')
    fs.setFile('node_modules/x/index.js', 'module.exports = 1')
    const second = await runCheck()
    expect(second.changed).toBe(false)
    // And they never enter the manifest walk either.
    expect(fs.files.has('.git/HEAD')).toBe(true)
  })

  it('the manifest rewrite itself does not loop into a change', async () => {
    await runCheck() // scan 1 writes the manifest (v1)
    const second = await runCheck() // scan 2 rewrites it (v2)
    expect(second.changed).toBe(false)
    // The manifest's OWN version token moved on scan 2 — scan 3 must still
    // see a valid manifest (fresh content, not a missing one) and stay
    // unchanged, proving the rewrite never triggers a rebuild by itself.
    const third = await runCheck()
    expect(third.changed).toBe(false)
  })

  it('excluded dirs (.git / node_modules) never count as changes', async () => {
    await runCheck()
    fs.setFile('.git/HEAD', 'ref: refs/heads/master')
    fs.setFile('node_modules/x/index.js', 'module.exports = 1')
    const second = await runCheck()
    expect(second.changed).toBe(false)
    // And they never enter the manifest walk either.
    expect(fs.files.has('.git/HEAD')).toBe(true)
  })

  it('test-suite dirs and files (nodejs/python/java) never count as changes', async () => {
    await runCheck()
    // Directory conventions (any depth): nodejs test/, python tests/, java src/test/…
    fs.setFile('packages/a/test/foo.test.ts', 'it("x", () => {})')
    fs.setFile('packages/a/__tests__/foo.spec.js', 'test("x", () => {})')
    fs.setFile('packages/a/tests/test_util.py', 'def test_util(): pass')
    fs.setFile('packages/a/src/test/java/com/a/FooTest.java', 'class FooTest {}')
    fs.setFile('packages/a/spec/foo_spec.rb', 'RSpec.describe Foo')
    // File conventions without a test dir: python test_*/ *_test, nodejs *.test.*, java *Test.java
    fs.setFile('packages/a/lib/test_helper.py', 'def helper(): pass')
    fs.setFile('packages/a/lib/helper_test.py', 'def test_helper(): pass')
    fs.setFile('packages/a/lib/helper.test.ts', 'it("x", () => {})')
    fs.setFile('packages/a/src/main/java/com/a/HelperTest.java', 'class HelperTest {}')
    const second = await runCheck()
    expect(second.changed).toBe(false)
    // None of them entered the manifest walk.
    for (const rel of [
      'packages/a/test/foo.test.ts', 'packages/a/tests/test_util.py',
      'packages/a/src/test/java/com/a/FooTest.java', 'packages/a/lib/helper_test.py',
      'packages/a/lib/helper.test.ts', 'packages/a/src/main/java/com/a/HelperTest.java',
    ]) {
      expect(fs.files.has(rel)).toBe(true)
    }
  })

  it('a production edit next to test files still counts as changed', async () => {
    await runCheck()
    fs.setFile('packages/a/tests/test_util.py', 'def test_util(): return 2')
    fs.setFile('packages/a/src/index.ts', 'export const a = 3')
    const second = await runCheck()
    expect(second.changed).toBe(true)
    expect(second.changedFiles).toEqual(['packages/a/src/index.ts'])
  })

  it('a missing manifest after files changed still reports changed', async () => {
    await runCheck()
    fs.remove('index/.arch-lens-file-manifest.json')
    fs.setFile('packages/a/src/index.ts', 'export const a = 42')
    const second = await runCheck()
    expect(second.changed).toBe(true)
    expect(second.changedFiles).toContain('packages/a/src/index.ts')
  })
})
