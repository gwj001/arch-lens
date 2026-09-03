/**
 * Workspace repository scanning for the Arch Lens backend: language-aware
 * package/module discovery, README blurbs, source file lists, Spring 1a
 * annotation hints, and per-package detail projection.
 *
 * Language dispatch mirrors the code-index provider's detectLanguage order
 * (package.json → typescript, pyproject.toml/setup.py → python,
 * build.gradle(.kts)/pom.xml → java, else unknown) so the two pipelines
 * agree about what a workspace is. Layouts:
 *   - typescript + `packages/`: the historical npm monorepo scan — byte
 *     identical output (no `lang` field), with ONE addition: zero packages
 *     falls back to a root-level single node instead of erroring.
 *   - python: manifest-bearing dirs (≤3 deep, ALL collected — uv/pdm
 *     workspaces carry a root pyproject AND nested members). ≥2 code dists →
 *     one node per dist; a single code dist → split by its top-level import
 *     packages when a clear src/ or flat structure exposes ≥2 of them
 *     (agent-framework repos like openai-agents), else one node.
 *   - java (Spring 生态): pom dirs ≤3 deep (descending INTO aggregators).
 *     ≥2 code modules → one node per module; a single module → split by the
 *     first-level business packages under the application root package
 *     (the dir holding the @SpringBootApplication class), plus an entry node
 *     for root-level classes (the main class). Gradle-only repos fall back to
 *     src/main/java-based discovery. 1a pass stamps Spring stereotypes /
 *     feign targets / listener topics / endpoint paths onto nodes.
 *   - unknown: one root node — scanning NEVER fails on an exotic layout.
 *
 * Every directory access is stat-guarded (exists-first), so the scan behaves
 * identically against the real dsh-fs (missing dir ⇒ FS_NOT_FOUND) and the
 * in-memory FakeFs used by tests (missing dir ⇒ empty listing).
 * @module @deepseek-ai/dsh-arch-lens-backend/src/scan
 */

import type { FileSystem, FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import type {
  ArchLensComponentDetail,
  ArchLensFileRef,
  ArchLensFileRole,
  ArchLensGraph,
  ArchLensPackageNode,
  ArchLensScanLanguage,
  ArchLensSpringProfile,
} from './types.ts'

/** Max bytes read for a manifest / README / source file (guards huge files). */
const MAX_HEAD_BYTES = 262144
/** Max source file names kept per node (display bound, mirrors listSrc). */
const MAX_FILES_PER_NODE = 24
/** Max files whose full head is read by the java 1a annotation pass. */
const MAX_SPRING_SCAN_FILES = 24
/** Manifest walk depth (mirrors code-index discoverPackageRoots). */
const MAX_MANIFEST_DEPTH = 3

/** Directories never walked into (mirrors the code-index provider). */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.dsh',
  'venv', '.venv', 'target', 'generated', '.next', '.turbo', 'lib', 'site-packages',
])

/** Manifest files that mark a distribution/module root per language. */
const PYTHON_MANIFESTS = ['pyproject.toml', 'setup.py']
const JAVA_MANIFESTS = ['pom.xml']

/**
 * Compose a child display path under a base directory. The scan resolves
 * nested files with the COMPOSED path instead of `fs.resolve(name, {cwd})`:
 * the FakeFs test backend treats its tree top as the namespace root and maps
 * any path onto itself (cwd ignored), while the real dsh-fs accepts the
 * composed absolute key directly — one addressing style for both.
 * @param base - absolute directory display path ('' = tree top).
 * @param name - relative child path ('.' = the base itself).
 * @returns the composed display path.
 */
function childPath(base: string, name: string): string {
  if (name === '.') return base
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '')
  return b === '' ? name : `${b}/${name}`
}

/**
 * Read a JSON file next to a directory, bounded.
 * @param fs - the filesystem service.
 * @param base - absolute directory path (resolves `package.json` under it).
 * @returns parsed JSON, or null when absent/unreadable/oversized.
 */
async function readJson(fs: FileSystem, base: string): Promise<Record<string, unknown> | null> {
  try {
    const target = await fs.resolve(childPath(base, 'package.json'))
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file' || (info.size !== undefined && info.size > MAX_HEAD_BYTES)) return null
    return JSON.parse(await fs.readText(target)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Read the head of a text file, bounded.
 * @param fs - the filesystem service.
 * @param base - absolute directory path.
 * @param name - relative file name.
 * @param max - max characters to keep.
 * @returns the head text, or '' when absent/unreadable/oversized.
 */
async function readHead(fs: FileSystem, base: string, name: string, max: number): Promise<string> {
  try {
    const target = await fs.resolve(childPath(base, name))
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file' || (info.size !== undefined && info.size > MAX_HEAD_BYTES)) return ''
    const text = await fs.readText(target)
    return text.slice(0, max)
  } catch {
    return ''
  }
}

/**
 * First non-empty, non-heading, non-comment, non-language-switch paragraph of
 * a README head.
 * @param text - the README head text.
 * @returns the trimmed first paragraph (bounded).
 */
export function firstParagraph(text: string): string {
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('<!--') && !line.startsWith('```'))
    .filter(line => !LANG_SWITCH_LINE.test(line))
  return lines[0] !== undefined ? lines[0].slice(0, 220) : ''
}

/** README language-switch rows like `English | [中文](README.zh.md)` or `[English](README.md) | 中文`. */
const LANG_SWITCH_LINE = /^(?:\[)?(English|中文|简体中文|繁体中文|日本語|한국어|Deutsch|Français|Español|Русский)(?:\]\([^)]*\))?\s*\|/

/**
 * List src/ file names of a package, bounded (legacy TypeScript layout).
 * @param fs - the filesystem service.
 * @param base - absolute package directory path.
 * @returns up to 24 file names.
 */
async function listSrc(fs: FileSystem, base: string): Promise<string[]> {
  try {
    const src = await fs.resolve(childPath(base, 'src'))
    const entries = await fs.listDir(src)
    return entries.filter(entry => entry.type === 'file').map(entry => entry.name).slice(0, MAX_FILES_PER_NODE)
  } catch {
    return []
  }
}

/**
 * Classify a src file name into a role (TypeScript layout).
 * @param name - file basename.
 * @returns the role label.
 */
export function roleOf(name: string): ArchLensFileRole {
  if (name === 'index.ts' || name === 'index.js') return 'entry'
  if (name === 'types.ts') return 'types'
  if (name === 'invariant.ts') return 'invariant'
  if (name === 'apply.ts') return 'assembly'
  if (name.endsWith('.spec.ts') || name.endsWith('.e2e.ts')) return 'test'
  return ''
}

/* ------------------------------------------------------------------ */
/* stat-guarded fs helpers (work on real dsh-fs AND the FakeFs fake)   */
/* ------------------------------------------------------------------ */

/** Resolve a name under a directory, or null when resolution fails. */
async function resolveOpt(fs: FileSystem, base: string, name: string): Promise<FsTarget | null> {
  try {
    return await fs.resolve(childPath(base, name))
  } catch {
    return null
  }
}

/** Whether a file exists under a directory. */
async function isFile(fs: FileSystem, base: string, name: string): Promise<boolean> {
  const target = await resolveOpt(fs, base, name)
  if (target === null) return false
  try {
    const info = await fs.stat(target)
    return info !== undefined && info.type === 'file'
  } catch {
    return false
  }
}

/** Whether a directory exists under a directory. */
async function isDir(fs: FileSystem, base: string, name: string): Promise<boolean> {
  const target = await resolveOpt(fs, base, name)
  if (target === null) return false
  try {
    const info = await fs.stat(target)
    return info !== undefined && info.type === 'directory'
  } catch {
    return false
  }
}

/** List a directory defensively (missing/unreadable ⇒ empty). */
async function listEntries(fs: FileSystem, dir: FsTarget): Promise<FsDirEntry[]> {
  try {
    return await fs.listDir(dir)
  } catch {
    return []
  }
}

/** Direct child directories of a target (defensive). */
async function childDirs(fs: FileSystem, dir: FsTarget): Promise<FsDirEntry[]> {
  const entries = await listEntries(fs, dir)
  return entries.filter(entry => entry.type === 'directory' && !SKIP_DIRS.has(entry.name))
}

/** Resolve a directory to its target, or null. */
async function dirTarget(fs: FileSystem, base: string, name: string): Promise<FsTarget | null> {
  const target = await resolveOpt(fs, base, name)
  if (target === null) return null
  try {
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'directory') return null
    return target
  } catch {
    return null
  }
}

/** `-`/`_`/`.`-normalized lowercase id, for cross-layout name matching. */
function normId(name: string): string {
  return name.toLowerCase().replace(/[._-]/g, '')
}

/** Last path segment of a display path. */
function basenameOf(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path
}

/** Path of `dir` relative to `root`, `/`-joined; '' when they are equal. */
function relUnder(root: string, dir: string): string {
  const a = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const b = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  if (b === a) return ''
  if (b.startsWith(`${a}/`)) return b.slice(a.length + 1)
  return b
}

/**
 * Collect every directory under root (≤ MAX_MANIFEST_DEPTH) that owns any of
 * `manifests`, WITHOUT stopping at the first hit — aggregator/workspace roots
 * coexist with nested members (maven root pom + modules, uv/poetry
 * workspaces, langchain-style multi-dist repos).
 */
async function collectManifestDirs(fs: FileSystem, root: string, manifests: readonly string[]): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: FsTarget, depth: number): Promise<void> => {
    if (depth > MAX_MANIFEST_DEPTH) return
    const entries = await listEntries(fs, dir)
    const names = new Set(entries.map(entry => entry.name))
    if (manifests.some(manifest => names.has(manifest))) out.push(dir.displayPath)
    for (const entry of entries) {
      if (entry.type !== 'directory' || SKIP_DIRS.has(entry.name)) continue
      await walk(entry.target, depth + 1)
    }
  }
  const target = await dirTarget(fs, root, '.')
  if (target !== null) await walk(target, 0)
  return out
}

/** Whether a directory (or a descendant ≤ `depth`) owns a `.py`/`.java` file. */
async function hasSourceFile(fs: FileSystem, dir: FsTarget, extension: '.py' | '.java', depth: number): Promise<boolean> {
  const entries = await listEntries(fs, dir)
  if (entries.some(entry => entry.type === 'file' && entry.name.endsWith(extension))) return true
  if (depth <= 0) return false
  for (const entry of entries) {
    if (entry.type !== 'directory' || SKIP_DIRS.has(entry.name)) continue
    if (await hasSourceFile(fs, entry.target, extension, depth - 1)) return true
  }
  return false
}

/** Collect relative source file names under a dir, bounded, sorted. */
async function collectFiles(
  fs: FileSystem,
  dir: FsTarget,
  extension: '.py' | '.java',
  maxDepth: number,
): Promise<string[]> {
  const out: string[] = []
  const base = dir.displayPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const walk = async (current: FsTarget, depth: number): Promise<void> => {
    if (out.length >= MAX_SOURCE_COLLECT || depth > maxDepth) return
    const entries = await listEntries(fs, current)
    for (const entry of entries) {
      if (out.length >= MAX_SOURCE_COLLECT) return
      if (entry.type === 'file') {
        if (entry.name.endsWith(extension)) out.push(relUnder(base, entry.target.displayPath))
      } else if (entry.type === 'directory' && !SKIP_DIRS.has(entry.name)) {
        await walk(entry.target, depth + 1)
      }
    }
  }
  await walk(dir, 0)
  return out.sort()
}

/** Cap on collected source names (display bound; entries beyond are dropped). */
const MAX_SOURCE_COLLECT = 200

/* ------------------------------------------------------------------ */
/* language detection                                                  */
/* ------------------------------------------------------------------ */

/** Probe manifests at the workspace root — mirrors code-index ordering. */
async function detectScanLanguage(fs: FileSystem, root: string): Promise<ArchLensScanLanguage> {
  if (await isFile(fs, root, 'package.json')) return 'typescript'
  for (const manifest of PYTHON_MANIFESTS) {
    if (await isFile(fs, root, manifest)) return 'python'
  }
  for (const manifest of JAVA_MANIFESTS) {
    if (await isFile(fs, root, manifest)) return 'java'
  }
  // Gradle java projects: no root pom — probe the gradle manifests too so a
  // gradle-only repo is not misread as `unknown` (code-index treats it java).
  if (await isFile(fs, root, 'build.gradle') || await isFile(fs, root, 'build.gradle.kts')) return 'java'
  return 'unknown'
}

/* ------------------------------------------------------------------ */
/* shared node building                                                */
/* ------------------------------------------------------------------ */

/** Placeholder detail until the graph-wide pass fills it in. */
function emptyDetail(id: string, group: string, blurb: string): ArchLensComponentDetail {
  return { id, short: id, group, blurb, files: [], deps: [], dependents: [], snippet: '', keyLines: [] }
}

/** README-based blurb pair for a node dir (no package.json description tier). */
async function readmeBlurb(fs: FileSystem, dir: string): Promise<{ blurb: string; blurbZh: string }> {
  const readme = await readHead(fs, dir, 'README.md', 400)
  const readmeZh = await readHead(fs, dir, 'README.zh.md', 400)
  return { blurb: firstParagraph(readme), blurbZh: firstParagraph(readmeZh) }
}

/** Detail pass shared by every language: dependents, then per-language entry. */
async function finalizeDetails(fs: FileSystem, nodes: ArchLensPackageNode[]): Promise<void> {
  for (const node of nodes) {
    const dependents = nodes.filter(candidate => candidate.deps.includes(node.short)).map(candidate => candidate.short)
    try {
      node.detail = await componentDetail(fs, node, dependents)
    } catch (error) {
      node.detail = { ...node.detail, deps: node.deps.slice(0, 40), dependents: dependents.slice(0, 40) }
      console.warn(`arch-lens: detail failed for ${node.short}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * Project one package into its detail view (language-aware entry detection).
 * @param fs - the filesystem service.
 * @param node - the package node.
 * @param dependents - short ids of packages that depend on this one.
 * @returns the detail projection.
 */
export async function componentDetail(
  fs: FileSystem,
  node: ArchLensPackageNode,
  dependents: readonly string[],
): Promise<ArchLensComponentDetail> {
  const lang = node.lang
  const files: ArchLensFileRef[] = node.files.map(name => ({
    name,
    role: roleOf(name),
  }))
  let snippet = ''
  const keyLines: string[] = []
  const entryName = entryOf(node, lang)
  if (entryName !== undefined && node.files.includes(entryName)) {
    // Legacy TypeScript files live under src/; python/java entries are named
    // relative to the node dir already (java module files keep the
    // src/main/java prefix, layer/entry files are direct names).
    const readName = lang === undefined || lang === 'typescript' ? `src/${entryName}` : entryName
    const head = await readHead(fs, node.path, readName, 12000)
    snippet = head.split('\n').slice(0, 90)
      .map(line => line.length > 140 ? `${line.slice(0, 137)}…` : line)
      .join('\n')
    // Key lines: TypeScript keeps the Cordis registration regex; python/java
    // sample annotation/decorator lines (Spring 注解、Flask/FastAPI 路由等).
    const pattern = lang === 'typescript' || lang === undefined
      ? /(ctx\.(on|provide|effect|emit|waterfall|serial|parallel|inject)\(|\.register\(|harness\.(handle|registerTool)\(|@Remote\()/
      : /^\s*@[A-Za-z]/
    for (const line of head.split('\n')) {
      if (pattern.test(line)) keyLines.push(line.trim().slice(0, 120))
      if (keyLines.length >= 18) break
    }
    const entryRef = files.find(file => file.name === entryName)
    if (entryRef !== undefined) entryRef.role = 'entry'
  }
  const dependentsList = dependents.slice(0, 40)
  return {
    id: node.short,
    short: node.short,
    group: node.group,
    blurb: node.blurb,
    files,
    deps: node.deps.slice(0, 40),
    dependents: dependentsList,
    snippet,
    keyLines,
  }
}

/** Pick the entry source name of a node per language. */
function entryOf(node: ArchLensPackageNode, lang: ArchLensScanLanguage | undefined): string | undefined {
  if (lang === undefined || lang === 'typescript') {
    const names = node.files
    if (names.includes('index.ts')) return 'index.ts'
    if (names.includes('index.js')) return 'index.js'
    return names[0]
  }
  if (lang === 'python') {
    for (const preferred of ['main.py', 'app.py', 'cli.py', '__init__.py']) {
      const hit = node.files.find(name => basenameOf(name) === preferred)
      if (hit !== undefined) return hit
    }
    return node.files[0]
  }
  if (lang === 'java') {
    const main = node.spring?.main
    if (main !== undefined) {
      const hit = node.files.find(name => basenameOf(name).replace(/\.java$/, '') === main)
      if (hit !== undefined) return hit
    }
    const hit = node.files.find(name => /(Application|Main|App|Launcher)\.java$/.test(name))
    if (hit !== undefined) return hit
    return node.files[0]
  }
  return node.files[0]
}

/* ------------------------------------------------------------------ */
/* TypeScript (legacy monorepo layout + root fallback)                 */
/* ------------------------------------------------------------------ */

/**
 * Scan the TypeScript workspace package tree. `packages/<group>/<pkg>` and
 * flat `packages/<pkg>` layouts produce the EXACT historical output (no
 * `lang` field — byte-identical disk JSON). Zero packages falls back to a
 * root-level node instead of erroring: root package.json when present, else
 * a `src/`-owning root.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @returns the graph.
 */
async function scanTypeScript(fs: FileSystem, root: string): Promise<ArchLensGraph> {
  const nodes: ArchLensPackageNode[] = []
  const edges: ArchLensGraph['edges'] = []
  const groups = new Set<string>()
  const addPackage = async (base: string, groupName: string, meta: Record<string, unknown>): Promise<void> => {
    if (typeof meta.name !== 'string' || meta.name.length === 0) return
    const short = meta.name.replace(/^@deepseek-ai\/dsh-/, '')
    const deps = typeof meta.peerDependencies === 'object' && meta.peerDependencies !== null
      ? Object.keys(meta.peerDependencies as Record<string, unknown>)
          .filter(key => key.startsWith('@deepseek-ai/dsh-'))
          .map(key => key.replace(/^@deepseek-ai\/dsh-/, ''))
      : []
    for (const dep of deps) edges.push({ from: short, to: dep })
    const description = typeof meta.description === 'string' ? meta.description.trim() : ''
    const readme = await readHead(fs, base, 'README.md', 400)
    const blurb = description !== '' ? description.slice(0, 220) : firstParagraph(readme)
    const readmeZh = await readHead(fs, base, 'README.zh.md', 400)
    const blurbZh = firstParagraph(readmeZh)
    const files = await listSrc(fs, base)
    nodes.push({
      id: short, short, group: groupName, blurb, files, deps, path: base,
      ...(blurbZh !== '' ? { blurbZh } : {}),
      detail: emptyDetail(short, groupName, blurb),
    })
  }
  if (await isDir(fs, root, 'packages')) {
    const packagesTarget = (await dirTarget(fs, root, 'packages'))!
    const groupEntries = (await listEntries(fs, packagesTarget)).filter(entry => entry.type === 'directory')
    for (const group of groupEntries) {
      const flatMeta = await readJson(fs, group.target.displayPath)
      if (flatMeta !== null) {
        await addPackage(group.target.displayPath, '', flatMeta)
        continue
      }
      groups.add(group.name)
      const pkgEntries = (await listEntries(fs, group.target)).filter(entry => entry.type === 'directory')
      for (const pkg of pkgEntries) {
        const meta = await readJson(fs, pkg.target.displayPath)
        if (meta === null) continue
        await addPackage(pkg.target.displayPath, group.name, meta)
      }
    }
  }
  if (nodes.length === 0) {
    // Root fallback (previously a hard "scan failed"): single-module npm
    // repos, or a src/-owning root. lang is set so the client uses the modern
    // relative-path display (these are NEW nodes — nothing to keep identical).
    const rootMeta = await readJson(fs, root)
    if (rootMeta !== null) {
      await addPackage(root, '', rootMeta)
    } else if (await isDir(fs, root, 'src')) {
      const id = basenameOf(root)
      const { blurb, blurbZh } = await readmeBlurb(fs, root)
      nodes.push({
        id, short: id, group: '', blurb, files: await listSrc(fs, root), deps: [], path: root,
        lang: 'typescript', ...(blurbZh !== '' ? { blurbZh } : {}),
        detail: emptyDetail(id, '', blurb),
      })
    }
    for (const node of nodes) node.lang = 'typescript'
    // Fallback scans are NOT the legacy packages/ layout — mark the graph so
    // the client renders the modern relative-path rows.
    return { root, groups: [], nodes, edges, lang: 'typescript' }
  }
  await finalizeDetails(fs, nodes)
  return { root, groups: [...groups].sort(), nodes, edges }
}

/* ------------------------------------------------------------------ */
/* python                                                              */
/* ------------------------------------------------------------------ */

/** Parse the distribution name from a pyproject (`[project]`/`[tool.poetry]`). */
function pyprojectName(text: string): string | null {
  let section = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1).trim()
      continue
    }
    if (section !== 'project' && section !== 'tool.poetry') continue
    const match = /^name\s*=\s*["']([^"']+)["']/.exec(line)
    if (match !== null) return match[1]!
  }
  return null
}

/** Distribution name of a python unit dir: pyproject name, else dir basename. */
async function distName(fs: FileSystem, dir: string): Promise<string> {
  const pyproject = await readHead(fs, dir, 'pyproject.toml', MAX_HEAD_BYTES)
  const name = pyproject !== '' ? pyprojectName(pyproject) : null
  return name ?? basenameOf(dir)
}

/** The dirs a single python dist should be split into ([] = keep one node):
 * top-level import packages under the dist's src/ layout or flat layout. */
async function pythonSplitCandidates(fs: FileSystem, distDir: FsTarget): Promise<FsDirEntry[]> {
  const srcTarget = await dirTarget(fs, distDir.displayPath, 'src')
  const topLevel: FsDirEntry[] = []
  if (srcTarget !== null) {
    for (const entry of await childDirs(fs, srcTarget)) {
      if (await hasSourceFile(fs, entry.target, '.py', 1)) topLevel.push(entry)
    }
  } else {
    for (const entry of await childDirs(fs, distDir)) {
      if (await hasSourceFile(fs, entry.target, '.py', 1)) topLevel.push(entry)
    }
  }
  if (topLevel.length === 1) {
    // One top import package: its own import-package children are the units
    // (openai-agents: src/agents/{models,run,tools,…}).
    const importChildren = (await childDirs(fs, topLevel[0]!.target))
      .filter(entry => entry.name !== '__pycache__')
    const coded: FsDirEntry[] = []
    for (const child of importChildren) {
      if (await hasSourceFile(fs, child.target, '.py', 1)) coded.push(child)
    }
    if (coded.length >= 2) return coded
    return []
  }
  if (topLevel.length >= 2) return topLevel
  return []
}

/** Scan a python workspace. */
async function scanPython(fs: FileSystem, root: string): Promise<ArchLensGraph> {
  const dists = await collectManifestDirs(fs, root, PYTHON_MANIFESTS)
  const nodes: ArchLensPackageNode[] = []
  // Code-owning units: a dist owns code when a .py file sits within 2 levels
  // (uv/poetry workspace roots carry only tooling config + member dirs).
  const codeDists: string[] = []
  for (const dir of dists) {
    const target = await dirTarget(fs, dir, '.')
    if (target !== null && await hasSourceFile(fs, target, '.py', 2)) codeDists.push(dir)
  }
  const unitDirs: FsDirEntry[] = []
  if (codeDists.length >= 2 || (codeDists.length === 1 && codeDists[0] !== root)) {
    for (const dir of codeDists) {
      const target = await dirTarget(fs, dir, '.')
      if (target !== null) unitDirs.push({ name: basenameOf(dir), type: 'directory', target })
    }
  } else if (codeDists.length === 1) {
    const distTarget = await dirTarget(fs, root, '.')
    if (distTarget !== null) {
      const split = await pythonSplitCandidates(fs, distTarget)
      if (split.length > 0) unitDirs.push(...split)
      else unitDirs.push({ name: basenameOf(root), type: 'directory', target: distTarget })
    }
  } else {
    // Manifest but no reachable code: keep one root node rather than empty.
    const distTarget = await dirTarget(fs, root, '.')
    if (distTarget !== null) unitDirs.push({ name: basenameOf(root), type: 'directory', target: distTarget })
  }
  for (const unit of unitDirs) {
    const dir = unit.target.displayPath
    const id = await distName(fs, dir)
    const files = (await collectFiles(fs, unit.target, '.py', 8)).slice(0, MAX_FILES_PER_NODE)
    const { blurb, blurbZh } = await readmeBlurb(fs, dir)
    nodes.push({
      id, short: id, group: '', blurb, files, deps: [], path: dir,
      lang: 'python', ...(blurbZh !== '' ? { blurbZh } : {}),
      detail: emptyDetail(id, '', blurb),
    })
  }
  await finalizeDetails(fs, nodes)
  return { root, groups: [], nodes, edges: [], lang: 'python' }
}

/* ------------------------------------------------------------------ */
/* java (Spring 生态, maven-first)                                     */
/* ------------------------------------------------------------------ */

/** Own artifactId: strip the <parent> block, then the first <artifactId>. */
function pomOwnArtifact(text: string): string | null {
  const cleaned = text.replace(/<parent>[\s\S]*?<\/parent>/, '')
  const match = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(cleaned)
  return match !== null ? match[1]!.trim() : null
}

/** Dependency artifactIds inside <dependencies> blocks (plugins/BOM/parent excluded). */
function pomDependencyIds(text: string): string[] {
  const cleaned = text.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '')
  const ids = new Set<string>()
  const block = /<dependencies>[\s\S]*?<\/dependencies>/g
  let match: RegExpExecArray | null
  while ((match = block.exec(cleaned)) !== null) {
    const artifact = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/g
    let inner: RegExpExecArray | null
    while ((inner = artifact.exec(match[0])) !== null) ids.add(inner[1]!.trim())
  }
  return [...ids]
}

/** Java file names (relative to `dir`) under its src/main/java subtree. */
async function javaFiles(fs: FileSystem, dir: FsTarget): Promise<string[]> {
  const names = await collectFiles(fs, dir, '.java', 12)
  const srcMain = 'src/main/java/'
  // When the node dir CONTAINS the maven layout, keep only its main sources
  // (tests live under src/test/java and must not leak into the catalog).
  const prefixed = names.filter(name => name.startsWith(srcMain))
  const relevant = prefixed.length > 0 ? prefixed : names
  return relevant.slice(0, MAX_FILES_PER_NODE)
}

/** Read a file's FULL text (bounded); '' when missing/oversized. */
async function readWhole(fs: FileSystem, base: string, name: string): Promise<string> {
  try {
    const target = await fs.resolve(childPath(base, name))
    const info = await fs.stat(target)
    if (info === undefined || info.type !== 'file' || (info.size !== undefined && info.size > MAX_HEAD_BYTES)) return ''
    return await fs.readText(target)
  } catch {
    return ''
  }
}

const JAVA_STEREOTYPE = /@(SpringBootApplication|RestController|Controller|RestControllerAdvice|ControllerAdvice|Service|Component|Repository|Configuration|ConfigurationProperties|Scheduled|FeignClient|KafkaListener|RabbitListener|StreamListener|EventListener|TransactionalEventListener|Async|EnableFeignClients|EnableEurekaClient|Mapper)\b/

/** Bounded 1a annotation pass over a java node dir: stereotypes, feign
 * targets, listener topics/queues, endpoint path samples. Reads whole source
 * files (≤ MAX_HEAD_BYTES each, ≤ MAX_SPRING_SCAN_FILES per node) — method
 * annotations live anywhere in a file, so head-only reads would miss them. */
async function springProfile(fs: FileSystem, dir: string, files: readonly string[]): Promise<ArchLensSpringProfile> {
  const profile: ArchLensSpringProfile = { stereotypes: [], feignClients: [], listeners: [], endpoints: [] }
  const priority = [...files].sort((a, b) => {
    const aPri = /(Application|Controller|Service|Client|Listener|Consumer|Producer|Config)\.java$/.test(a) ? 0 : 1
    const bPri = /(Application|Controller|Service|Client|Listener|Consumer|Producer|Config)\.java$/.test(b) ? 0 : 1
    return aPri - bPri || a.localeCompare(b)
  })
  let scanned = 0
  const stereotypes = new Set<string>()
  for (const name of priority) {
    if (scanned >= MAX_SPRING_SCAN_FILES) break
    scanned += 1
    const text = await readWhole(fs, dir, name)
    if (text === '') continue
    const base = basenameOf(name).replace(/\.java$/, '')
    if (profile.main === undefined && text.includes('@SpringBootApplication')) profile.main = base
    for (const line of text.split('\n')) {
      const match = JAVA_STEREOTYPE.exec(line)
      if (match !== null) stereotypes.add(match[1]!)
    }
    // Feign: @FeignClient("svc") / @FeignClient(name="svc", …) / @FeignClient(value="…")
    const feign = /@FeignClient\s*\(([\s\S]*?)\)/.exec(text)
    if (feign !== null) {
      const args = feign[1]!
      const nameArg = /name\s*=\s*["']([^"']+)["']/.exec(args) ?? /value\s*=\s*["']([^"']+)["']/.exec(args)
      const bare = /^\s*["']([^"']+)["']/.exec(args)
      const target = nameArg?.[1] ?? bare?.[1]
      if (target !== undefined && target !== '') profile.feignClients.push(target)
    }
    // Kafka/Rabbit listener target strings.
    for (const regex of [/@KafkaListener\s*\(([\s\S]*?)\)/g, /@RabbitListener\s*\(([\s\S]*?)\)/g]) {
      let listener: RegExpExecArray | null
      while ((listener = regex.exec(text)) !== null) {
        const strings = listener[1]!.match(/["']([^"']+)["']/g)
        if (strings !== null) {
          for (const s of strings.slice(0, 4)) profile.listeners.push(s.slice(1, -1))
        }
      }
    }
    // Endpoint mapping paths.
    const mappings = /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*["']([^"']+)["']/g
    let endpoint: RegExpExecArray | null
    while ((endpoint = mappings.exec(text)) !== null) profile.endpoints.push(endpoint[1]!)
    if (profile.endpoints.length >= 6) break
    if (profile.feignClients.length >= 4 && profile.listeners.length >= 4 && profile.endpoints.length >= 4) break
  }
  profile.stereotypes = [...stereotypes].slice(0, 12)
  profile.feignClients = [...new Set(profile.feignClients)].slice(0, 8)
  profile.listeners = [...new Set(profile.listeners)].slice(0, 8)
  profile.endpoints = [...new Set(profile.endpoints)].slice(0, 8)
  return profile
}

/** Locate the application root package dir inside src/main/java: the dir that
 * holds the @SpringBootApplication class. Filename-prioritized (per review:
 * the main-class file must not be gated behind the annotation-file budget);
 * a bounded head read confirms the annotation. Falls back to the branch-point
 * heuristic when no annotated class is found. */
async function findAppRootDir(fs: FileSystem, srcMainJava: FsTarget): Promise<FsTarget | null> {
  const all = await collectFiles(fs, srcMainJava, '.java', 12)
  if (all.length === 0) return null
  const heads: Record<string, string> = {}
  const readHeadOf = async (rel: string): Promise<string> => {
    if (heads[rel] === undefined) heads[rel] = await readHead(fs, srcMainJava.displayPath, rel, 65536)
    return heads[rel]!
  }
  const named = all.filter(rel => /(Application|Main|App|Launcher)\.java$/.test(rel))
  for (const rel of [...named, ...all.filter(rel => !named.includes(rel))]) {
    const text = await readHeadOf(rel)
    if (text.includes('@SpringBootApplication')) {
      const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      const target = await dirTarget(fs, srcMainJava.displayPath, dirRel === '' ? '.' : dirRel)
      if (target !== null) return target
    }
    if (named.length === 0 && Object.keys(heads).length >= 120) break
  }
  // Branch-point fallback: descend the single-child package chain; the first
  // dir with direct .java files (or a multi-dir split) is the app root.
  let current = srcMainJava
  for (let depth = 0; depth < 10; depth += 1) {
    const entries = await listEntries(fs, current)
    const directFiles = entries.filter(entry => entry.type === 'file' && entry.name.endsWith('.java'))
    const dirs = entries.filter(entry => entry.type === 'directory' && !SKIP_DIRS.has(entry.name))
    if (directFiles.length > 0 || dirs.length !== 1) return current
    current = dirs[0]!.target
  }
  return current
}

/** Build java nodes for one code module dir (module-level node or single-app split). */
async function javaNodesForModule(fs: FileSystem, moduleDir: string): Promise<{ nodes: ArchLensPackageNode[]; edges: ArchLensGraph['edges'] }> {
  const nodes: ArchLensPackageNode[] = []
  const srcMainJava = await dirTarget(fs, moduleDir, 'src/main/java')
  if (srcMainJava === null) return { nodes, edges: [] }
  const moduleId = basenameOf(moduleDir)
  const appRoot = await findAppRootDir(fs, srcMainJava)
  if (appRoot === null) {
    // No java sources at all — caller filtered for code, so this is defensive.
    return { nodes, edges: [] }
  }
  const layerCandidates = (await childDirs(fs, appRoot)).filter(entry => entry.name !== 'src')
  const layerDirs: FsDirEntry[] = []
  for (const candidate of layerCandidates) {
    if (await hasSourceFile(fs, candidate.target, '.java', 3)) layerDirs.push(candidate)
  }
  // Root-level classes of the app root (the main class etc.) → entry node.
  const appRootEntries = await listEntries(fs, appRoot)
  const directJava = appRootEntries.filter(entry => entry.type === 'file' && entry.name.endsWith('.java'))
  if (directJava.length > 0) {
    const files = directJava.map(entry => entry.name).slice(0, MAX_FILES_PER_NODE)
    const profile = await springProfile(fs, appRoot.displayPath, files)
    const { blurb, blurbZh } = await readmeBlurb(fs, moduleDir)
    const id = moduleId
    nodes.push({
      id, short: id, group: '', blurb, files, deps: [], path: appRoot.displayPath,
      lang: 'java', spring: profile, ...(blurbZh !== '' ? { blurbZh } : {}),
      detail: emptyDetail(id, '', blurb),
    })
  }
  // When there ARE clear first-level business packages, they are the granular
  // nodes (single-module monoliths); otherwise the module itself stays one node.
  if (layerDirs.length >= 2 || (layerDirs.length === 1 && directJava.length === 0)) {
    for (const layer of layerDirs) {
      const dir = layer.target.displayPath
      const id = layer.name
      const files = await javaFiles(fs, layer.target)
      const profile = await springProfile(fs, dir, files)
      const { blurb, blurbZh } = await readmeBlurb(fs, dir)
      nodes.push({
        id, short: id, group: '', blurb, files, deps: [], path: dir,
        lang: 'java', spring: profile, ...(blurbZh !== '' ? { blurbZh } : {}),
        detail: emptyDetail(id, '', blurb),
      })
    }
  } else if (nodes.length === 0) {
    // Module with no direct main-class files and no layer dirs (rare flat
    // layout): the whole module is one node.
    const id = moduleId
    const files = await javaFiles(fs, srcMainJava)
    const profile = await springProfile(fs, srcMainJava.displayPath, files)
    const { blurb, blurbZh } = await readmeBlurb(fs, moduleDir)
    nodes.push({
      id, short: id, group: '', blurb, files, deps: [], path: srcMainJava.displayPath,
      lang: 'java', spring: profile, ...(blurbZh !== '' ? { blurbZh } : {}),
      detail: emptyDetail(id, '', blurb),
    })
  }
  return { nodes, edges: [] }
}

/** Scan a java (Spring) workspace: maven modules, or single-app layers. */
async function scanJava(fs: FileSystem, root: string): Promise<ArchLensGraph> {
  // Module dirs: pom owners (descending into aggregators), else any dir (≤2)
  // that itself owns src/main/java (gradle multi-project repos).
  const pomDirs = await collectManifestDirs(fs, root, JAVA_MANIFESTS)
  let moduleDirs: string[] = []
  if (pomDirs.length > 0) {
    for (const dir of pomDirs) {
      if (await isDir(fs, dir, 'src/main/java')) moduleDirs.push(dir)
    }
    // Gradle-only java repos have no pom at all.
  } else {
    const walk = async (dir: FsTarget, depth: number): Promise<void> => {
      if (depth > 2) return
      if (await isDir(fs, dir.displayPath, 'src/main/java')) moduleDirs.push(dir.displayPath)
      for (const entry of await childDirs(fs, dir)) await walk(entry.target, depth + 1)
    }
    const rootTarget = await dirTarget(fs, root, '.')
    if (rootTarget !== null) await walk(rootTarget, 0)
    moduleDirs = [...new Set(moduleDirs)]
  }
  const nodes: ArchLensPackageNode[] = []
  const edges: ArchLensGraph['edges'] = []
  // artifactId ↔ dir-basename aliases per module, for dependency edges.
  const artifactAliases = new Map<string, string[]>() // nodeId → own artifactIds
  if (moduleDirs.length >= 2) {
    for (const dir of moduleDirs) {
      const srcMainJava = await dirTarget(fs, dir, 'src/main/java')
      if (srcMainJava === null) continue
      const moduleTarget = await dirTarget(fs, dir, '.')
      if (moduleTarget === null) continue
      const id = basenameOf(dir)
      const pomText = await readWhole(fs, dir, 'pom.xml')
      if (pomText !== '') {
        const own = pomOwnArtifact(pomText)
        if (own !== null && own !== '') artifactAliases.set(id, [...(artifactAliases.get(id) ?? []), own])
      }
      const files = await javaFiles(fs, moduleTarget)
      if (files.length === 0) continue
      // Files are relative to the MODULE dir (they keep the src/main/java
      // prefix) — the profile pass must read under that same base.
      const profile = await springProfile(fs, dir, files)
      const { blurb, blurbZh } = await readmeBlurb(fs, dir)
      nodes.push({
        id, short: id, group: '', blurb, files, deps: [], path: dir,
        lang: 'java', spring: profile, ...(blurbZh !== '' ? { blurbZh } : {}),
        detail: emptyDetail(id, '', blurb),
      })
    }
    // pom dependency edges between workspace modules.
    for (const dir of moduleDirs) {
      const fromId = basenameOf(dir)
      const pomText = await readWhole(fs, dir, 'pom.xml')
      if (pomText === '') continue
      for (const dep of pomDependencyIds(pomText)) {
        const targetId = nodeIdForArtifact(dep, nodes, artifactAliases)
        if (targetId !== null && targetId !== fromId) {
          const fromNode = nodes.find(node => node.id === fromId)
          if (fromNode !== undefined && !fromNode.deps.includes(targetId)) {
            fromNode.deps.push(targetId)
            edges.push({ from: fromId, to: targetId })
          }
        }
      }
    }
  } else if (moduleDirs.length === 1) {
    const moduleDir = moduleDirs[0]!
    const built = await javaNodesForModule(fs, moduleDir)
    nodes.push(...built.nodes)
  } else {
    // No pom and no src/main/java anywhere (plain java sources? defensive):
    // fall back to a generic root node, mirroring the unknown branch.
    const id = basenameOf(root)
    const { blurb, blurbZh } = await readmeBlurb(fs, root)
    nodes.push({
      id, short: id, group: '', blurb, files: [], deps: [], path: root,
      lang: 'java', ...(blurbZh !== '' ? { blurbZh } : {}),
      detail: emptyDetail(id, '', blurb),
    })
  }
  // Feign → workspace-service edges (1a best effort).
  if (nodes.length > 0) {
    for (const node of nodes) {
      const targets = node.spring?.feignClients ?? []
      if (targets.length === 0) continue
      for (const target of targets) {
        const match = nodes.find(candidate =>
          candidate.id !== node.id && (normId(candidate.id) === normId(target) || normId(basenameOf(candidate.path)) === normId(target)))
        if (match !== undefined && !edges.some(edge => edge.from === node.id && edge.to === match.id)) {
          edges.push({ from: node.id, to: match.id })
        }
      }
    }
  }
  await finalizeDetails(fs, nodes)
  return { root, groups: [], nodes, edges, lang: 'java' }
}

/** Resolve a pom artifactId to a workspace module node id (aliases included). */
function nodeIdForArtifact(
  artifact: string,
  nodes: readonly ArchLensPackageNode[],
  aliases: ReadonlyMap<string, string[]>,
): string | null {
  const want = normId(artifact)
  for (const node of nodes) {
    if (normId(node.id) === want) return node.id
    for (const alias of aliases.get(node.id) ?? []) {
      if (normId(alias) === want) return node.id
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* unknown                                                             */
/* ------------------------------------------------------------------ */

/** Scan a workspace with no recognized manifest: one root node, never error. */
async function scanUnknown(fs: FileSystem, root: string): Promise<ArchLensGraph> {
  const id = basenameOf(root)
  const { blurb, blurbZh } = await readmeBlurb(fs, root)
  const nodes: ArchLensPackageNode[] = [{
    id, short: id, group: '', blurb, files: [], deps: [], path: root,
    lang: 'unknown', ...(blurbZh !== '' ? { blurbZh } : {}),
    detail: emptyDetail(id, '', blurb),
  }]
  await finalizeDetails(fs, nodes)
  return { root, groups: [], nodes, edges: [], lang: 'unknown' }
}

/* ------------------------------------------------------------------ */
/* entry                                                               */
/* ------------------------------------------------------------------ */

/**
 * Scan the workspace package tree, language-aware.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @returns the graph, or an error result (unexpected IO faults only — exotic
 * layouts never error; they fall back to a root node or an empty graph).
 */
export async function scanWorkspace(fs: FileSystem, root: string): Promise<ArchLensGraph | { error: string }> {
  try {
    const lang = await detectScanLanguage(fs, root)
    switch (lang) {
      case 'typescript':
        return await scanTypeScript(fs, root)
      case 'python':
        return await scanPython(fs, root)
      case 'java':
        return await scanJava(fs, root)
      default:
        return await scanUnknown(fs, root)
    }
  } catch (error) {
    return { error: `scan failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
