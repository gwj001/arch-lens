/**
 * Workspace file-change detection (增量重建的层 1): a persisted manifest of
 * every scanned file — `{ path → { version, size, md5 } }` — lets rescan
 * decide whether ANY fact source changed WITHOUT rebuilding everything.
 *
 * Compare flow (cheap first, precise second):
 *   1. stat every file: `FsInfo.version` (inode + size + mtime + ctime) is an
 *      opaque freshness token — identical version ⇒ unchanged, no read needed.
 *   2. version changed ⇒ read the file and md5 it: identical md5 ⇒ the change
 *      was cosmetic (same content, touched mtime) ⇒ still unchanged.
 *   3. otherwise (new file, removed file, or content genuinely changed) the
 *      workspace counts as CHANGED.
 *
 * The manifest itself lives under the cache dir (excluded from the walk), so
 * its own rewrite never triggers a rebuild. Downsides of a stale manifest are
 * benign: a missing/invalid manifest ⇒ "changed" ⇒ one full rebuild.
 *
 * @module @deepseek-ai/dsh-arch-lens-backend/src/manifest
 */
import { createHash } from 'node:crypto';
import { CACHE_DIR } from "./cache-dir.js";
const MANIFEST_FILE = `${CACHE_DIR}/.arch-lens-file-manifest.json`;
/** Directories excluded from the walk (vendored / VCS / the cache dir). */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', 'dist', 'out']);
/** Test-suite directory names, excluded by name at ANY depth (nodejs
 * `test/` `__tests__/`, python `tests/`, java `src/test/…` all surface as a
 * path segment named `test`/`tests`/…). Test code does not shape the
 * architecture facts, so its churn must not trigger a rescan rebuild. */
const SKIP_TEST_DIRS = new Set([
    'test', 'tests', '__tests__', '__mocks__', '__snapshots__',
    'spec', 'specs', 'testing', 'testdata', 'fixtures',
]);
/** Whether a file follows a test-suite naming convention (nodejs / python /
 * java). Matched on the file NAME only — `src/test` is already covered by
 * the directory rule above. */
function isTestFile(rel) {
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    // nodejs: foo.test.ts / foo.spec.jsx / foo.test.mjs …
    if (/\.(test|spec)\.(c|m)?[jt]sx?$/.test(base))
        return true;
    // python: test_foo.py / foo_test.py
    if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base))
        return true;
    // java (junit/testng): FooTest.java / FooTests.java / FooTestCase.java
    if (/(?:Test|Tests|TestCase)\.java$/.test(base))
        return true;
    return false;
}
/** Files larger than this are never md5'd (readText would be costly); their
 * version token alone decides change. */
const MAX_MD5_BYTES = 2 * 1024 * 1024;
/** Recursively list every file under the workspace root (excluding the skip
 * dirs and the cache dir), returning cache-relative paths. */
async function walk(fs, dirTarget, rel, out) {
    let entries;
    try {
        entries = await fs.listDir(dirTarget);
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const childRel = `${rel}${entry.name}`;
        if (entry.type === 'directory') {
            if (SKIP_DIRS.has(entry.name) || SKIP_TEST_DIRS.has(entry.name) || childRel === CACHE_DIR || childRel.startsWith(`${CACHE_DIR}/`))
                continue;
            await walk(fs, entry.target, `${childRel}/`, out);
        }
        else if (entry.type === 'file') {
            if (isTestFile(childRel))
                continue;
            out.push({ rel: childRel, target: entry.target });
        }
    }
}
/** Read the persisted manifest; null when absent or unreadable. */
async function readManifest(fs, root) {
    try {
        const target = await fs.resolve(MANIFEST_FILE, { cwd: root });
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return null;
        const parsed = JSON.parse(await fs.readText(target));
        if (typeof parsed.root !== 'string' || typeof parsed.files !== 'object' || parsed.files === null)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/** Persist the fresh manifest. */
async function writeManifest(fs, root, files, sandboxPolicy) {
    try {
        const manifest = { root, at: Date.now(), files };
        const target = await fs.resolve(MANIFEST_FILE, { cwd: root });
        await fs.writeText(target, JSON.stringify(manifest), undefined, undefined, sandboxPolicy);
    }
    catch {
        // best-effort: a missing manifest just means "changed" on the next scan
    }
}
/**
 * Decide whether ANY scanned file changed since the last rescan, and persist
 * the fresh manifest. Never throws — a comparison failure counts as changed
 * (safe direction: one unnecessary rebuild, never a missed one).
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param sandboxPolicy - session policy for the manifest WRITE (reads need
 *   none); without it the policy layer rejects the write and the manifest is
 *   never persisted, so every rescan rebuilds.
 * @returns whether the workspace changed, plus the changed file paths
 *   classified by CRUD (for selective AI-cache invalidation).
 */
export async function checkWorkspaceChanges(fs, root, sandboxPolicy) {
    const previous = await readManifest(fs, root);
    const walked = [];
    try {
        const rootTarget = await fs.resolve('.', { cwd: root });
        await walk(fs, rootTarget, '', walked);
    }
    catch {
        // Cannot even enumerate — treat as changed (rebuild) and persist nothing.
        return { changed: true, added: [], modified: [], removed: [], changedFiles: [] };
    }
    const previousFiles = previous?.files ?? {};
    const next = {};
    const added = [];
    const modified = [];
    const removed = [];
    let changed = false;
    for (const file of walked) {
        let info;
        try {
            info = await fs.stat(file.target);
        }
        catch {
            continue;
        }
        if (info === undefined || info.type !== 'file')
            continue;
        const prev = previousFiles[file.rel];
        if (prev !== undefined && prev.version === info.version) {
            // Unchanged (fast path): carry the entry forward untouched.
            next[file.rel] = prev;
            continue;
        }
        // Version moved: confirm with content md5 when affordable.
        let md5;
        if (info.size === undefined || info.size <= MAX_MD5_BYTES) {
            try {
                md5 = createHash('md5').update(await fs.readText(file.target)).digest('hex');
            }
            catch {
                md5 = undefined;
            }
        }
        if (prev !== undefined && md5 !== undefined && prev.md5 === md5) {
            // Same content (cosmetic touch): update the token, not a real change.
            next[file.rel] = { ...prev, version: info.version };
            continue;
        }
        changed = true;
        if (prev === undefined)
            added.push(file.rel);
        else
            modified.push(file.rel);
        next[file.rel] = {
            version: info.version,
            ...(info.size === undefined ? {} : { size: info.size }),
            ...(md5 === undefined ? {} : { md5 }),
        };
    }
    // Removed files: present in the old manifest, absent from the new walk.
    for (const rel of Object.keys(previousFiles)) {
        if (!(rel in next)) {
            changed = true;
            removed.push(rel);
        }
    }
    await writeManifest(fs, root, next, sandboxPolicy);
    return { changed, added, modified, removed, changedFiles: [...added, ...modified, ...removed] };
}
//# sourceMappingURL=manifest.js.map