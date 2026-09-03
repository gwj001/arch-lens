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
interface ManifestEntry {
    /** Freshness token from the last scan (FsInfo.version). */
    version: string;
    /** Byte size at the last scan. */
    size?: number;
    /** md5 of the content at the last scan, when computed. */
    md5?: string;
}
/**
 * Per-rescan file-change classification (added / modified / removed).
 */
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
 * Read-only comparison result: the CRUD classification plus the fresh
 * manifest entries to persist ONLY after the caller's rebuild succeeded.
 * `next` is null when the walk itself failed — there is nothing to persist,
 * and the caller must NOT commit (the stale manifest keeps the next rescan
 * honest: it still sees the previous state as "changed").
 */
export interface WorkspaceCompare {
    fileChanges: WorkspaceFileChanges;
    /** Fresh manifest entries; commit after a successful rebuild. */
    next: Record<string, ManifestEntry> | null;
}
/**
 * Compare the workspace against the persisted manifest WITHOUT writing.
 * Never throws — a comparison failure counts as changed (safe direction:
 * one unnecessary rebuild, never a missed one), with `next: null` so the
 * caller knows there is nothing to commit.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 */
export declare function compareWorkspaceChanges(fs: FileSystem, root: string): Promise<WorkspaceCompare>;
/** Persist the fresh manifest (commit point of a successful rescan). */
export declare function commitWorkspaceManifest(fs: FileSystem, root: string, files: Record<string, ManifestEntry>, sandboxPolicy?: SandboxExecutionPolicy): Promise<void>;
/**
 * Decide whether ANY scanned file changed since the last rescan, AND persist
 * the fresh manifest immediately. Compare-and-commit in one step: fine for
 * callers with no rebuild afterwards (tests); rescan itself must use
 * compareWorkspaceChanges + commitWorkspaceManifest so the manifest lands
 * only AFTER a successful rebuild (a failed rescan must not stamp the new
 * manifest — the next rescan would then see "no change" and skip the
 * rebuild that never happened).
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @param sandboxPolicy - session policy for the manifest WRITE (reads need
 *   none); without it the policy layer rejects the write and the manifest is
 *   never persisted, so every rescan rebuilds.
 * @returns whether the workspace changed, plus the changed file paths
 *   classified by CRUD (for selective AI-cache invalidation).
 */
export declare function checkWorkspaceChanges(fs: FileSystem, root: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<WorkspaceFileChanges>;
export {};
//# sourceMappingURL=manifest.d.ts.map