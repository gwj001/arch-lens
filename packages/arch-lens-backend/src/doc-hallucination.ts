/**
 * 生成式文档章节的幻觉门禁（V1 文档写路径）。
 *
 * 喂给章节 LLM 的事实是真实的（扫描图 / 代码索引）；本模块校验的是
 * 输出是否仍留在这些事实之内。它从不触碰事实、过期状态或模型——只做
 * 「散文 → 事实」的忠实度差异检查：编造的包名、虚构的文件路径、
 * 不存在（或方向画反）的调用边。纯函数、零 IO、零 LLM——与图渲染门禁
 * 同样的「产物过检才入库」纪律。
 *
 * 精确优先于召回：只检查高置信的引用形态（反引号 scoped 包名、带代码
 * 扩展名的路径、`| 调用方 | 被调用方 |` 表格）。裸标识符（函数名…）与
 * fenced 代码块永不标记——误报会打回一篇好章节，比漏报一处编造更伤。
 * @module @deepseek-ai/dsh-arch-lens-backend/src/doc-hallucination
 */

/** 每轮生成时一次性组装的权威实体集合。 */
export interface DocGroundTruth {
  /** 全部合法的包名形态（扫描图节点 id、索引 id、npm 名）。 */
  packages: ReadonlySet<string>
  /** 工作区相对源码路径（已归一化：`/` 分隔、无 `./`）。 */
  files: ReadonlySet<string>
  /** 真实的 import/调用边，键为 `from\0to`。 */
  edges: ReadonlySet<string>
}

/** 散文里一处事实无法背书的引用。 */
export interface DocViolation {
  kind: 'package' | 'file' | 'edge'
  /** 违规 token，按原文原样记录。 */
  token: string
  /** 人类可读的原因（会嵌入修复 prompt）。 */
  reason: string
  /** 可低成本计算时给出最接近的真实实体（编辑距离 / 反向边）。 */
  suggestion?: string
}

/** 违规上报条数上限：修复 prompt 必须保持有界。 */
const MAX_VIOLATIONS = 30

/** 路径引用中可识别的代码类扩展名。 */
const FILE_EXT = /\.(ts|tsx|js|mjs|cjs|jsx|py|java|json|md|ya?ml|toml|go|rs|kt|swift|c|cpp|h|hpp)\b/

/** npm 风格 scoped 包名（`@scope/name`）。 */
const SCOPED_PKG = /^@[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i

/** 路径形状的引用：`a/b…` 且带代码扩展名。 */
function looksLikePath(token: string): boolean {
  return token.includes('/') && FILE_EXT.test(token)
}

/** 按代码索引存储路径的方式归一化路径引用。 */
function normalizePath(token: string): string {
  let out = token.replace(/\\/g, '/')
  while (out.startsWith('./')) out = out.slice(2)
  return out
}

/** 带提前退出的 Levenshtein 距离（仅用于建议，集合很小）。 */
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

/** 找最接近的已知包（编辑距离 ≤ 2，否则前缀命中）用作建议。 */
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

/** 文件是否属于已知集合（大小写容错：Windows 根不区分大小写）。 */
function fileKnown(path: string, files: ReadonlySet<string>): boolean {
  if (files.has(path)) return true
  const lower = path.toLowerCase()
  for (const known of files) {
    if (known.toLowerCase() === lower) return true
  }
  return false
}

/** 剥掉 fenced 代码块：mermaid/ts 示例会携带任意节点 id。 */
function stripFencedBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '')
}

/** 将一个 markdown 表格行切成单元格（去反引号后 trim）。 */
function tableCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  return trimmed.replace(/^\|/, '').replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim().replace(/^`+|`+$/g, ''))
    .filter(cell => cell !== '')
}

/**
 * 找出唯一的「调用关系」表格（表头同时具备两个端点）并逐行校验
 * 其是否落在真实边集合中。表头不符的表格一律忽略（那是排版布局，
 * 不是声明）。
 * @param prose - 已剥掉 fenced 代码块的文本。
 * @param truth - 权威事实集合。
 * @param push - 有界违规收集器。
 */
function checkEdgeTables(prose: string, truth: DocGroundTruth, push: (violation: DocViolation) => void): void {
  const lines = prose.split('\n')
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = tableCells(lines[i] ?? '')
    if (header.length < 2) continue
    const fromCol = header.findIndex(cell => /调用方|caller|from/i.test(cell))
    const toCol = header.findIndex(cell => /被调用方|callee|to/i.test(cell))
    if (fromCol < 0 || toCol < 0 || fromCol === toCol) continue
    // 真正的表格其后必须跟分隔行（`| --- | --- |`）。
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) continue
    for (let row = i + 2; row < lines.length; row += 1) {
      const cells = tableCells(lines[row] ?? '')
      if (cells.length < 2) break // 表格已结束
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
 * 文本中被反引号包裹、且确实为真实包（与权威包集合求交）的包引用。
 * 与门禁校验使用的是同一套抽取逻辑。用作 deps 并集防御：散文引用了
 * 哪个真实包，该包就必须进入信封 `deps`，于是即使 prior 稿（或讲解）
 * 保留了作用域事实块之外的引用，该包的变动也必然让章节失效——
 * 「已删除的名字不再出现」只是 prompt 级契约，这里是确定性兜底。
 * @param text - 章节/讲解的 markdown。
 * @param truth - 权威包集合（与门禁同一快照）。
 * @returns 被引用的真实包（去重，按首次出现顺序）。
 */
export function citedPackages(text: string, truth: DocGroundTruth): string[] {
  const out: string[] = []
  for (const match of stripFencedBlocks(text).matchAll(/`([^`\n]+)`/g)) {
    const token = (match[1] ?? '').trim()
    if (token === '') continue
    if (truth.packages.has(token) && !out.includes(token)) out.push(token)
  }
  return out
}

/**
 * 校验一篇生成的章节正文是否落在权威事实集合内。
 * @param text - 章节 markdown（模型原样返回的内容）。
 * @param truth - 章节 prompt 所依据的事实（同一快照）。
 * @returns 违规列表（上限 MAX_VIOLATIONS）；为空 = 散文忠实可信。
 */
export function checkDocProse(text: string, truth: DocGroundTruth): DocViolation[] {
  const violations: DocViolation[] = []
  const push = (violation: DocViolation): void => {
    if (violations.length < MAX_VIOLATIONS) violations.push(violation)
  }
  const prose = stripFencedBlocks(text)

  // 1) 反引号引用：scoped 包名与路径形状的 token。
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
    // 裸标识符（函数、变量）刻意永不标记。
  }

  // 2) 写在流畅正文里的裸路径形 token。
  for (const match of prose.matchAll(/[\w@.-]+(?:\/[\w@.-]+)+\.(?:ts|tsx|js|mjs|cjs|jsx|py|java|json|md|ya?ml|toml|go|rs|kt|swift|c|cpp|h|hpp)\b/g)) {
    const raw = match[0] ?? ''
    if (raw === '') continue
    const path = normalizePath(raw)
    if (!fileKnown(path, truth.files)) {
      push({ kind: 'file', token: raw, reason: '事实中不存在该文件' })
    }
  }

  // 3) 调用关系表格（唯一可机器校验的边形态）。
  checkEdgeTables(prose, truth, push)

  // 对完全相同的报告去重（同一 token 可能命中多条规则）。
  const seen = new Set<string>()
  return violations.filter(violation => {
    const key = `${violation.kind}\0${violation.token}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 将违规格式化为修复 prompt 的输入（有上限，一行一条）。 */
export function formatViolations(violations: readonly DocViolation[]): string {
  return violations.map(violation =>
    `- 「${violation.token}」（${violation.kind}）：${violation.reason}${violation.suggestion === undefined ? '' : `，事实中最接近的是 ${violation.suggestion}`}`).join('\n')
}
