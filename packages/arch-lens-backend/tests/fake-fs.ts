/**
 * In-memory FileSystem fake for manifest tests. Lives in its own module:
 * a large class + vitest imports in ONE file trips an esbuild/vitest heap
 * blowup on Windows (worker dies with JS heap out of memory at import time).
 */
export interface FakeNode {
  type: 'file' | 'directory'
  content?: string
  version?: string
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
    this.files.set(rel, { type: 'file', content, version: `v${this.counter}`, size: content.length })
  }

  setFile(rel: string, content: string): void { this.putFile(rel, content) }

  touch(rel: string): void {
    const node = this.files.get(rel)
    if (node === undefined) throw new Error(`no file ${rel}`)
    this.counter += 1
    node.version = `v${this.counter}`
  }

  remove(rel: string): void { this.files.delete(rel) }

  async resolve(path: string): Promise<{ displayPath: string }> {
    return { displayPath: path === '.' ? '' : path }
  }

  async listDir(target: { displayPath: string }): Promise<Array<{ type: string; name: string; target: { displayPath: string } }>> {
    // Normalize the prefix to end with '/' so a direct child (`a/b` under
    // `a/`) is distinguished from deeper paths (`a/b/c`): walk hands us
    // targets WITHOUT the trailing slash.
    const raw = target.displayPath
    const prefix = raw === '' || raw.endsWith('/') ? raw : `${raw}/`
    const out: Array<{ type: string; name: string; target: { displayPath: string } }> = []
    for (const rel of this.files.keys()) {
      const node = this.files.get(rel)
      if (node === undefined || rel === '') continue // the root key is not a child
      if (prefix === '') {
        if (rel.includes('/')) continue
        out.push({ type: node.type, name: rel, target: { displayPath: rel } })
      } else if (rel.startsWith(prefix)) {
        const rest = rel.slice(prefix.length)
        if (rest === '' || rest.includes('/')) continue
        out.push({ type: node.type, name: rest, target: { displayPath: rel } })
      }
    }
    return out
  }

  async stat(target: { displayPath: string }): Promise<{ type: string; version: string; size?: number } | undefined> {
    const node = this.files.get(target.displayPath)
    if (node === undefined) return undefined
    if (node.type === 'directory') return { type: 'directory', version: '' }
    return { type: 'file', version: node.version ?? '', size: node.size }
  }

  async readText(target: { displayPath: string }): Promise<string> {
    const node = this.files.get(target.displayPath)
    if (node === undefined || node.content === undefined) throw new Error(`no content for ${target.displayPath}`)
    return node.content
  }

  async writeText(target: { displayPath: string }, text: string): Promise<void> {
    this.putFile(target.displayPath, text)
  }
}
