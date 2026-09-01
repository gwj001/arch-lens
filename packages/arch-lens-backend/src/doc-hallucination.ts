/**
 * Hallucination gate for generated doc chapters (V1 docs write path).
 *
 * The facts fed to the chapter LLM are true (scan graph / code index); this
 * module verifies the OUTPUT stayed inside them. It never touches facts,
 * staleness or the model — only the prose-to-facts faithfulness diff:
 * fabricated package names, invented file paths, call edges that do not
 * exist (or run backwards). Pure function, zero IO, zero LLM — the same
 * "产物过检才入库" discipline as the figure render gate.
 *
 * Precision over recall: only high-confidence reference forms are checked
 * (backticked scoped packages, code-extension paths, `| 调用方 | 被调用方 |`
 * tables). Bare identifiers (function names…) and fenced code blocks are
 * never flagged — a false positive bounces a good chapter, which hurts more
 * than a missed fabrication.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/doc-hallucination
 */

/** Authoritative entity sets assembled once per generation round. */
export interface DocGroundTruth {
  /** Every legitimate package name form (graph node ids, index ids, npm names). */
  packages: ReadonlySet<string>
  /** Workspace-relative source file paths (normalized: `/` separators, no `./`). */
  files: ReadonlySet<string>
  /** Real import/call edges, keyed `from\0to`. */
  edges: ReadonlySet<string>
}

/** One reference in the prose that the facts do not back. */
export interface DocViolation {
  kind: 'package' | 'file' | 'edge'
  /** The offending token exactly as written. */
  token: string
  /** Human-readable reason (embedded into the repair prompt). */
  reason: string
  /** Closest real entity when cheaply computable (edit distance / reversal). */
  suggestion?: string
}

/** Cap on reported violations: the repair prompt must stay bounded. */
const MAX_VIOLATIONS = 30

/** Code-ish file extensions recognized in path references. */
const FILE_EXT = /\.(ts|tsx|js|mjs|cjs|jsx|py|java|json|md|ya?ml|toml|go|rs|kt|swift|c|cpp|h|hpp)\b/

/** Scoped npm-style package name (`@scope/name`). */
const SCOPED_PKG = /^@[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i

/** Path-shaped reference: `a/b…` with a code extension. */
function looksLikePath(token: string): boolean {
  return token.includes('/') && FILE_EXT.test(token)
}

/** Normalize a path reference the way the code index stores them. */
function normalizePath(token: string): string {
  let out = token.replace(/\\/g, '/')
  while (out.startsWith('./')) out = out.slice(2)
  return out
}

/** Levenshtein distance with an early exit (suggestions only, small sets). */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const curr: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1
      const value = Math.min((curr[j - 1] ?? cap + 1) + 1, (prev[j] ?? cap + 1) + 1, (prev[j - 1] ?? cap + 1) + cost)
      curr[j] = value
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > cap) return cap + 1
    prev = curr
  }
  return prev[b.length] ?? cap + 1
}

/** Closest known package (edit distance ≤ 2, else prefix hit) for a suggestion. */
function nearestPackage(token: string, packages: ReadonlySet<string>): string | undefined {
  let best: string | undefined
  let bestDist = 3
  for (const known of packages) {
    if (known === token) return known
    if (known.startsWith(token) || token.startsWith(known)) return known
    const dist = editDistance(token, known, 2)
    if (dist < bestDist) {
      bestDist = dist
      best = known
    }
  }
  return best
}

/** Case-tolerant file membership (Windows roots are case-insensitive). */
function fileKnown(path: string, files: ReadonlySet<string>): boolean {
  if (files.has(path)) return true
  const lower = path.toLowerCase()
  for (const known of files) {
    if (known.toLowerCase() === lower) return true
  }
  return false
}

/** Strip fenced code blocks: mermaid/ts examples carry arbitrary node ids. */
function stripFencedBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '')
}

/** Split one markdown table row into trimmed cells (backticks removed). */
function tableCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  return trimmed.replace(/^\|/, '').replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim().replace(/^`+|`+$/g, ''))
    .filter(cell => cell !== '')
}

/**
 * Find the single call-relations table (header names both endpoints) and
 * validate every row against the real edge set. Tables with any other
 * header are ignored (they are prose layout, not claims).
 * @param prose - fenced blocks already removed.
 * @param truth - ground truth sets.
 * @param push - bounded violation sink.
 */
function checkEdgeTables(prose: string, truth: DocGroundTruth, push: (violation: DocViolation) => void): void {
  const lines = prose.split('\n')
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = tableCells(lines[i] ?? '')
    if (header.length < 2) continue
    const fromCol = header.findIndex(cell => /调用方|caller|from/i.test(cell))
    const toCol = header.findIndex(cell => /被调用方|callee|to/i.test(cell))
    if (fromCol < 0 || toCol < 0 || fromCol === toCol) continue
    // A real table must be followed by a separator row (`| --- | --- |`).
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) continue
    for (let row = i + 2; row < lines.length; row += 1) {
      const cells = tableCells(lines[row] ?? '')
      if (cells.length < 2) break // table ended
      const from = cells[fromCol]
      const to = cells[toCol]
      if (from === undefined || to === undefined) continue
      if (truth.edges.has(`${from}\0${to}`)) continue
      const reversed = truth.edges.has(`${to}\0${from}`)
      push({
        kind: 'edge',
        token: `${from} → ${to}`,
        reason: reversed ? '调用方向与事实相反' : '事实中不存在这条调用关系',
        ...(reversed ? { suggestion: `${to} → ${from}` } : {}),
      })
    }
  }
}

/**
 * Validate one generated chapter body against the ground-truth sets.
 * @param text - the chapter markdown (as the model returned it).
 * @param truth - facts the chapter prompt was built from (same snapshot).
 * @returns violations (bounded to MAX_VIOLATIONS); empty = the prose is faithful.
 */
export function checkDocProse(text: string, truth: DocGroundTruth): DocViolation[] {
  const violations: DocViolation[] = []
  const push = (violation: DocViolation): void => {
    if (violations.length < MAX_VIOLATIONS) violations.push(violation)
  }
  const prose = stripFencedBlocks(text)

  // 1) Backticked references: scoped package names and path-shaped tokens.
  for (const match of prose.matchAll(/`([^`\n]+)`/g)) {
    const token = (match[1] ?? '').trim()
    if (token === '') continue
    if (looksLikePath(token)) {
      const path = normalizePath(token)
      if (!fileKnown(path, truth.files)) {
        push({ kind: 'file', token, reason: '事实中不存在该文件' })
      }
    } else if (SCOPED_PKG.test(token)) {
      if (!truth.packages.has(token)) {
        push({
          kind: 'package',
          token,
          reason: '事实中不存在该包',
          ...((): { suggestion?: string } => {
            const near = nearestPackage(token, truth.packages)
            return near === undefined ? {} : { suggestion: near }
          })(),
        })
      }
    }
    // Bare identifiers (functions, variables) are deliberately never flagged.
  }

  // 2) Bare path-like tokens written in flowing prose.
  for (const match of prose.matchAll(/[\w@.-]+(?:\/[\w@.-]+)+\.(?:ts|tsx|js|mjs|cjs|jsx|py|java|json|md|ya?ml|toml|go|rs|kt|swift|c|cpp|h|hpp)\b/g)) {
    const raw = match[0] ?? ''
    if (raw === '') continue
    const path = normalizePath(raw)
    if (!fileKnown(path, truth.files)) {
      push({ kind: 'file', token: raw, reason: '事实中不存在该文件' })
    }
  }

  // 3) Call-relations tables (the only machine-checkable edge form).
  checkEdgeTables(prose, truth, push)

  // De-duplicate identical reports (same token can match multiple rules).
  const seen = new Set<string>()
  return violations.filter(violation => {
    const key = `${violation.kind}\0${violation.token}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Format violations for the repair prompt (bounded, one line each). */
export function formatViolations(violations: readonly DocViolation[]): string {
  return violations.map(violation =>
    `- 「${violation.token}」（${violation.kind}）：${violation.reason}${violation.suggestion === undefined ? '' : `，事实中最接近的是 ${violation.suggestion}`}`).join('\n')
}
