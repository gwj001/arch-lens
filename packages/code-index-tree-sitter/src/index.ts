/**
 * tree-sitter provider for the code-index seam: detects the workspace
 * language, discovers packages, and extracts entities/imports per language.
 * Cached per workspace root; a fresh call re-indexes.
 * @module @deepseek-ai/dsh-code-index-tree-sitter
 */

import type { Context } from '@deepseek-ai/cordis'
import { CodeIndex } from '@deepseek-ai/dsh-code-index'
import type { CodeIndexResult, CodeLanguage, CodePackage } from '@deepseek-ai/dsh-code-index'
import type { CallEdge, CodeEntity, CodeImport } from '@deepseek-ai/dsh-code-index'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import {
  collectSources,
  detectLanguage,
  discoverPackageRoots,
  manifestDeps,
  readSmall,
  relPath,
} from './discover.ts'
import { extractJava } from './java-adapter.ts'
import { extractPython } from './python-adapter.ts'
import { extractTs } from './ts-adapter.ts'

/** Disk cache file under the shared workspace cache directory (`index/`,
 * mirrored from the arch-lens backend's CACHE_DIR so all artifacts land in
 * one place; the cross-package constant is unreachable at runtime because
 * `@deepseek-ai/dsh-code-index` resolves to the harness copy). */
const INDEX_CACHE_FILE = 'index/.arch-lens-index.json'
/** Max packages indexed concurrently (fs IO is the bottleneck). */
const CONCURRENCY = 8

/** Service required before indexing can read files. */
export const inject = ['fs']

/**
 * The tree-sitter provider body: provide the codeIndex service.
 * @param ctx - host context.
 */
export function apply(ctx: Context): void {
  const fs = ctx.get('fs') as FileSystem | undefined
  if (fs === undefined) throw new Error('code-index-tree-sitter requires the fs service')
  new CodeIndexTreeSitter(ctx, fs)
}

/** Extract one source file into imports, entities, and calls by language. */
function extractFile(
  rel: string,
  source: string,
  language: Exclude<CodeLanguage, 'unknown'>,
): { imports: CodeImport[]; entities: CodeEntity[]; calls?: CallEdge[] } {
  switch (language) {
    case 'typescript':
      return extractTs(rel, source)
    case 'python':
      return extractPython(rel, source)
    case 'java':
      return extractJava(rel, source)
  }
}

/** Run `work` over items with bounded concurrency. */
async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      out[index] = await work(items[index]!)
    }
  })
  await Promise.all(workers)
  return out
}

/** The provider implementation. */
class CodeIndexTreeSitter extends CodeIndex {
  private readonly fs: FileSystem
  private readonly cache = new Map<string, Promise<CodeIndexResult>>()

  constructor(ctx: Context, fs: FileSystem) {
    super(ctx)
    this.fs = fs
  }

  indexWorkspace(root: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<CodeIndexResult> {
    let run = this.cache.get(root)
    if (run === undefined) {
      run = this.index(root, sandboxPolicy)
      this.cache.set(root, run)
    }
    return run
  }

  /**
   * Force-invalidate: drop the in-memory run and blank the on-disk cache (an
   * unparseable file reads back as "no cache", so the next indexWorkspace
   * re-indexes from current sources). Used by rescan and "refresh this
   * figure" — a stale index after code changed is never legal.
   * @param root - absolute workspace root.
   * @param sandboxPolicy - session-scoped policy for the disk write.
   */
  async refresh(root: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<void> {
    this.cache.delete(root)
    try {
      const target = await this.resolveCacheFile(root)
      if (target !== null) await this.fs.writeText(target, '', undefined, undefined, sandboxPolicy)
    } catch {
      // best-effort disk invalidation; a missing cache is just a re-index
    }
    console.log(`[code-index] refresh: index invalidated for ${root}`)
  }

  private async index(root: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<CodeIndexResult> {
    const language = await detectLanguage(this.fs, root)
    if (language === 'unknown') return { root, language, packages: [] }
    // Disk cache: a finished index survives process restarts, so the 30s RPC
    // budget never has to re-run a multi-minute first index.
    const cacheFile = await this.resolveCacheFile(root)
    const cached = cacheFile === null ? null : await this.readCache(cacheFile, language)
    if (cached !== null) {
      console.log(`[code-index] serving disk cache (${cached.packages.length} packages)`)
      return cached
    }
    const packageRoots = await discoverPackageRoots(this.fs, root, language)
    const results = await mapLimit(packageRoots, CONCURRENCY, pkgDir => this.indexPackage(root, pkgDir, language))
    const packages = results.filter((pkg): pkg is CodePackage => pkg !== undefined)
    const calls = packages.flatMap(pkg => pkg.calls ?? [])
    const result: CodeIndexResult = { root, language, packages, ...(calls.length > 0 ? { calls } : {}) }
    if (cacheFile !== null) {
      try {
        await this.fs.writeText(cacheFile, JSON.stringify(result), undefined, undefined, sandboxPolicy)
        console.log(`[code-index] disk cache written (${packages.length} packages)`)
      } catch (error) {
        console.warn(`[code-index] cache write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return result
  }

  /** Resolve the cache file target under the workspace root, or null. */
  private async resolveCacheFile(root: string): Promise<FsTarget | null> {
    try {
      return await this.fs.resolve(INDEX_CACHE_FILE, { cwd: root })
    } catch {
      return null
    }
  }

  /** Read a cache file whose language matches; stale languages re-index. */
  private async readCache(target: FsTarget, language: CodeLanguage): Promise<CodeIndexResult | null> {
    try {
      const info = await this.fs.stat(target)
      if (info === undefined || info.type !== 'file') return null
      const text = await this.fs.readText(target)
      const parsed = JSON.parse(text) as CodeIndexResult
      if (parsed.language !== language) return null
      return parsed
    } catch {
      return null
    }
  }

  private async indexPackage(
    root: string,
    pkgDir: string,
    language: Exclude<CodeLanguage, 'unknown'>,
  ): Promise<CodePackage | undefined> {
    const files = await collectSources(this.fs, pkgDir, language)
    if (files.length === 0) return undefined
    const deps = await manifestDeps(this.fs, pkgDir, language)
    const entities: CodePackage['entities'] = []
    const imports: CodePackage['imports'] = []
    const calls: CodePackage['calls'] = []
    const entryFiles: string[] = []
    for (const file of files) {
      const rel = relPath(root, file.displayPath)
      const source = await readSmall(this.fs, file)
      if (source === null) continue
      const extracted = extractFile(rel, source, language)
      entities.push(...extracted.entities)
      imports.push(...extracted.imports)
      calls.push(...(extracted.calls ?? []))
      if (isEntryFile(rel, language)) entryFiles.push(rel)
    }
    return {
      id: shortId(pkgDir, language),
      path: pkgDir,
      language,
      deps,
      entities,
      imports,
      entryFiles,
      ...(calls.length > 0 ? { calls } : {}),
    }
  }
}

/** Whether a relative file looks like an entry point for the language. */
function isEntryFile(rel: string, language: Exclude<CodeLanguage, 'unknown'>): boolean {
  const name = rel.split('/').at(-1) ?? ''
  if (language === 'typescript') return name === 'index.ts' || name === 'index.tsx' || name === 'index.js'
  if (language === 'python') return name === '__init__.py' || name === 'main.py' || name === 'cli.py'
  return /(Main|Application|App|Launcher)\.java$/.test(name)
}

/** Short package id: last path segment, npm scope stripped. */
function shortId(pkgDir: string, language: Exclude<CodeLanguage, 'unknown'>): string {
  const last = pkgDir.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? pkgDir
  if (language === 'typescript') return last.replace(/^@[^/]+\//, '')
  return last
}
