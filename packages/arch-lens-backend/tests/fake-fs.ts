/**
 * In-memory FileSystem fake for manifest tests. Lives in its own module:
 * a large class + vitest imports in ONE file trips an esbuild/vitest heap
 * blowup on Windows (worker dies with JS heap out of memory at import time).
 * The public surface mirrors the @deepseek-ai/dsh-fs shapes (FsTarget /
 * FsInfo / FsDirEntry) so specs can pass the fake without `as never`.
 */
import { FsTargetKey, FsVersion, type FsDirEntry, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'

/** Build a stable target for a fake path — the fake backend's "realpath" is the display path itself. */
export function fsTarget(displayPath: string): FsTarget {
  return { targetKey: FsTargetKey(displayPath), displayPath }
}

export interface FakeNode {
  type: 'file' | 'directory'
  content?: string
  version?: FsVersion
  size?: number
}

export class FakeFs {
  files = new Map<string, FakeNode>()
  private counter = 0

  constructor(init: Record<string, string | null>) {
    for (const [rel, content] of Object.entries(init)) {
      if (content === null) this.files.set(rel, { type: 'directory' })
      else this.putFile(rel, content)
    }
  }

  private putFile(rel: string, content: string): void {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    if (dir !== '') {
      const parent = this.files.get(dir)
      if (parent === undefined || parent.type !== 'directory') this.files.set(dir, { type: 'directory' })
    }
    this.counter += 1
    this.files.set(rel, { type: 'file', content, version: FsVersion(`v${this.counter}`), size: content.length })
  }

  setFile(rel: string, content: string): void { this.putFile(rel, content) }

  touch(rel: string): void {
    const node = this.files.get(rel)
    if (node === undefined) throw new Error(`no file ${rel}`)
    this.counter += 1
    node.version = FsVersion(`v${this.counter}`)
  }

  remove(rel: string): void { this.files.delete(rel) }

  async resolve(path: string, _opts?: { cwd?: string }): Promise<FsTarget> {
    return fsTarget(path === '.' ? '' : path)
  }

  async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    // Normalize the prefix to end with '/' so a direct child (`a/b` under
    // `a/`) is distinguished from deeper paths (`a/b/c`): walk hands us
    // targets WITHOUT the trailing slash.
    const raw = target.displayPath
    const prefix = raw === '' || raw.endsWith('/') ? raw : `${raw}/`
    const out: FsDirEntry[] = []
    for (const rel of this.files.keys()) {
      const node = this.files.get(rel)
      if (node === undefined || rel === '') continue // the root key is not a child
      if (prefix === '') {
        if (rel.includes('/')) continue
        out.push({ type: node.type, name: rel, target: fsTarget(rel) })
      } else if (rel.startsWith(prefix)) {
        const rest = rel.slice(prefix.length)
        if (rest === '' || rest.includes('/')) continue
        out.push({ type: node.type, name: rest, target: fsTarget(rel) })
      }
    }
    return out
  }

  async stat(target: FsTarget): Promise<FsInfo | undefined> {
    const node = this.files.get(target.displayPath)
    if (node === undefined) return undefined
    if (node.type === 'directory') return { type: 'directory', version: FsVersion('') }
    const info: FsInfo = { type: 'file', version: node.version ?? FsVersion('') }
    if (node.size !== undefined) info.size = node.size
    return info
  }

  async readText(target: FsTarget): Promise<string> {
    const node = this.files.get(target.displayPath)
    if (node === undefined || node.content === undefined) throw new Error(`no content for ${target.displayPath}`)
    return node.content
  }

  async writeText(target: FsTarget, text: string): Promise<void> {
    this.putFile(target.displayPath, text)
  }
}