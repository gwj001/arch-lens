/**
 * Change-detection unit check run with `pnpm exec tsx tests/manifest.check.ts`.
 *
 * WHY NOT vitest: on this Windows box, esbuild/vitest transform of the
 * manifest spec (a test file importing src modules that use `node:crypto`)
 * dies in the worker with "JavaScript heap out of memory" at import time,
 * regardless of pool (forks/threads/vmForks) or heap size. The vitest spec
 * `manifest.spec.ts` stays for healthy environments; this script performs the
 * SAME assertions through tsx, which loads the real manifest.ts fine.
 */
import { checkWorkspaceChanges } from '../src/manifest.ts'
import { FakeFs } from './fake-fs.ts'

const ROOT = '/ws'

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

let failed = 0
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { console.error(`  ✗ ${label}`); failed += 1 }
}
async function scenario(name: string, fn: (fs: FakeFs) => Promise<void>): Promise<void> {
  console.log(name)
  await fn(sampleWorkspace())
}

await scenario('1. first scan reports changed + persists manifest', async fs => {
  const first = await checkWorkspaceChanges(fs as never, ROOT)
  assert(first.changed === true, 'changed=true on first scan')
  assert(JSON.stringify(first.changedFiles.sort()) === JSON.stringify(
    ['packages/a/package.json', 'packages/a/src/index.ts', 'packages/a/src/util.ts']), 'changedFiles lists every file')
  assert(fs.files.has('index/.arch-lens-file-manifest.json'), 'manifest persisted under index/')
})

await scenario('2. second scan with no edits reports unchanged', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT)
  const second = await checkWorkspaceChanges(fs as never, ROOT)
  assert(second.changed === false, 'changed=false when nothing moved')
  assert(second.changedFiles.length === 0, 'changedFiles empty')
})

await scenario('3. a content edit changes one file only', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT)
  fs.setFile('packages/a/src/index.ts', 'export const a = 2')
  const second = await checkWorkspaceChanges(fs as never, ROOT)
  assert(second.changed === true, 'changed=true after edit')
  assert(JSON.stringify(second.changedFiles) === JSON.stringify(['packages/a/src/index.ts']), 'only the edited file listed')
})

await scenario('4. a newly added file counts as changed', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT)
  fs.setFile('packages/a/src/new.ts', 'export const n = 1')
  const second = await checkWorkspaceChanges(fs as never, ROOT)
  assert(second.changed === true && JSON.stringify(second.changedFiles) === JSON.stringify(['packages/a/src/new.ts']), 'new file detected')
})

await scenario('5. a removed file counts as changed', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT)
  fs.remove('packages/a/src/util.ts')
  const second = await checkWorkspaceChanges(fs as never, ROOT)
  assert(second.changed === true && JSON.stringify(second.changedFiles) === JSON.stringify(['packages/a/src/util.ts']), 'removed file detected')
})

await scenario('6. cosmetic touch (same content, new version) is NOT a change', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT)
  fs.touch('packages/a/src/index.ts')
  const second = await checkWorkspaceChanges(fs as never, ROOT)
  assert(second.changed === false, 'touched-but-identical content ignored')
})

await scenario('7. excluded dirs (.git / node_modules) never count', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT)
  fs.setFile('.git/HEAD', 'ref: refs/heads/master')
  fs.setFile('node_modules/x/index.js', 'module.exports = 1')
  const second = await checkWorkspaceChanges(fs as never, ROOT)
  assert(second.changed === false, 'excluded-dir edits ignored')
})

await scenario('7b. test dirs/files (nodejs/python/java) never count', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT)
  fs.setFile('packages/a/test/foo.test.ts', 'it("x", () => {})')
  fs.setFile('packages/a/__tests__/foo.spec.js', 'test("x", () => {})')
  fs.setFile('packages/a/tests/test_util.py', 'def test_util(): pass')
  fs.setFile('packages/a/src/test/java/com/a/FooTest.java', 'class FooTest {}')
  fs.setFile('packages/a/lib/helper_test.py', 'def test_helper(): pass')
  fs.setFile('packages/a/lib/helper.test.ts', 'it("x", () => {})')
  fs.setFile('packages/a/src/main/java/com/a/HelperTest.java', 'class HelperTest {}')
  const second = await checkWorkspaceChanges(fs as never, ROOT)
  assert(second.changed === false, 'test-only edits ignored')
})

await scenario('8. the manifest rewrite itself does not loop', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT) // scan 1 writes the manifest (v1)
  const second = await checkWorkspaceChanges(fs as never, ROOT) // scan 2 rewrites it (v2)
  assert(second.changed === false, 'scan 2 unchanged')
  // The manifest's OWN version token moved on scan 2 — scan 3 must still see
  // a valid manifest (fresh content, not a missing one) and stay unchanged.
  const third = await checkWorkspaceChanges(fs as never, ROOT)
  assert(third.changed === false, 'scan 3 still unchanged (rewrite does not loop)')
})

await scenario('9. missing manifest after edits still reports changed', async fs => {
  await checkWorkspaceChanges(fs as never, ROOT)
  fs.remove('index/.arch-lens-file-manifest.json')
  fs.setFile('packages/a/src/index.ts', 'export const a = 42')
  const second = await checkWorkspaceChanges(fs as never, ROOT)
  assert(second.changed === true, 'changed detected even without a manifest')
})

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
