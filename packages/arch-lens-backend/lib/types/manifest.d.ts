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
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
/** Per-rescan file-change classification (added / modified / removed). */
export interface WorkspaceFileChanges {
    changed: boolean;
    /** Newly discovered files (no prior manifest entry). */
    added: string[];
    /** Files whose content genuinely changed (version moved + md5 differs). */
    modified: string[];
    /** Files present in the old manifest but absent from the new walk. */
    removed: string[];
    /** added + modified + removed (kept for callers that only need a boolean). */
    changedFiles: string[];
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
export declare function checkWorkspaceChanges(fs: FileSystem, root: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<WorkspaceFileChanges>;
//# sourceMappingURL=manifest.d.ts.map