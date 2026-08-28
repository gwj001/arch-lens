/**
 * Doc assembly from figure caches (阶段 4，D8)：「一键生成文档」不再走六段
 * LLM 直写，而是【图缓存的唯一事实真相】的纯组装——每个章节对应注册表里的
 * 图种，先版本化读缓存；缺失/过期的图走该图自己的构建链（force=false，
 * 内部缓存复查 + 文档→档案→LLM 逐级兜底）补建并统一写回，然后零 LLM 渲染
 * 成章节。文档反过来【不】写任何图缓存（旧链路的"文档后补写结构化缓存/
 * 重建概念树"回灌已删）：图 → 文档是单向组装，无循环。
 *
 * The generated doc ALWAYS lands in docs/architecture.generated.md (see
 * docsgen.resolveDocTarget); docs/architecture.md is the user's own document
 * and is never written here either.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docbuild
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import { readFactVersion, readRawCache, readVersionedCache, writeVersionedCache } from './fact-cache.ts'
import { FIGURE_SPECS } from './figures.ts'
import type { EntityFigureId, FigureEnv } from './figures.ts'
import { coreErDiagramFromGraph, coreFlowchartFromGraph, importEdges } from './mermaid.ts'
import { llmText, mergeSection, resolveDocTarget, SECTION_TITLES, writeDoc } from './docsgen.ts'
import { ABORTED_MESSAGE, generationSignal } from './abort.ts'
import type { DocKind } from './types.ts'
import type {
  ArchLensConceptNode,
  ArchLensCoreGraph,
  ArchLensEventRow,
  ArchLensFlowResult,
  ArchLensGraph,
  ArchLensSequenceResult,
} from './types.ts'

/** Section order of the assembled doc (SECTION_TITLES is the title source). */
const DOC_SECTIONS: DocKind[] = ['concepts', 'flow', 'seq', 'interaction', 'deps', 'er', 'catalog']

/** Registry lookup (throws on unknown id — a programming error). */
function specOf(id: EntityFigureId) {
  const spec = FIGURE_SPECS.find(candidate => candidate.id === id)
  if (spec === undefined) throw new Error(`unknown figure id: ${id}`)
  return spec
}

/** Version-bound read of one figure's cache payload (null = miss/stale). */
async function readFigureData(
  fs: FileSystem,
  root: string,
  id: EntityFigureId,
  language: string,
  factsVersion: number,
): Promise<unknown | null> {
  try {
    const target = await fs.resolve(specOf(id).cacheName(language), { cwd: root })
    return await readVersionedCache<unknown>(fs, target, factsVersion)
  } catch {
    return null
  }
}

/**
 * The figure a doc section renders FROM: current-cache hit serves instantly
 * (zero LLM); a missing/stale figure triggers THAT figure's own rebuild chain
 * (`force = false` → the chain re-checks its cache, then doc → profile → LLM
 * stages, persisting through the unified write path). This is exactly the
 * user-facing semantic「哪个 tab 落后就触发哪个的变动更新；没有 tab 也先建」.
 * @returns the figure payload, or `{ error }` when it could not be produced.
 */
export async function ensureFigure(env: FigureEnv, id: EntityFigureId): Promise<{ data: unknown } | { error: string }> {
  const factsVersion = await readFactVersion(env.fs, env.root)
  const cached = await readFigureData(env.fs, env.root, id, env.language, factsVersion)
  if (cached !== null) return { data: cached }
  const built = await specOf(id).build(env, false)
  if (typeof built === 'object' && built !== null && 'error' in built) {
    return { error: `${id}: ${(built as { error: string }).error}` }
  }
  // The chain persists its own figure; prefer the freshly cached (canonical)
  // payload, fall back to the build result (facts moved mid-generation → the
  // cache may hold a newer stamp than this run's data).
  const fresh = await readFigureData(env.fs, env.root, id, env.language, await readFactVersion(env.fs, env.root))
  return { data: fresh ?? built }
}

/** ```mermaid fence. */
function fence(source: string): string {
  return `\`\`\`mermaid\n${source.trim()}\n\`\`\``
}

/** Provenance line under a rendered figure (doc = authoritative anchor, flow = AI). */
function sourceNote(source: string | undefined, ref?: string): string {
  if (source === 'doc') return ref !== undefined && ref !== '' ? `> 来源：架构文档（${ref}）` : '> 来源：架构文档'
  return '> 来源：AI 归纳（非权威）'
}

/** Optional natural-language figure description (D3 extension point). */
function descriptionNote(data: { description?: string }): string {
  return data.description !== undefined && data.description.trim() !== '' ? `\n\n${data.description.trim()}` : ''
}

/** concepts: the hierarchy tree → nested markdown bullets (+doc anchors). */
export function renderConcepts(tree: ArchLensConceptNode[]): string {
  const lines: string[] = []
  const walk = (nodes: ArchLensConceptNode[], depth: number): void => {
    for (const node of nodes) {
      const anchor = node.source === 'doc' && node.ref !== undefined && node.ref !== '' ? `（${node.ref}）` : ''
      const inside = node.inside !== undefined && node.inside !== '' ? `；内部：${node.inside}` : ''
      lines.push(`${'  '.repeat(depth)}- **${node.name}** — ${node.desc ?? ''}${inside}${anchor}`)
      if (Array.isArray(node.children) && node.children.length > 0) walk(node.children, depth + 1)
    }
  }
  walk(tree, 0)
  return lines.length > 0 ? lines.join('\n') : '（暂无概念层级）'
}

/** flow (D2a): one mermaid block per viewpoint + provenance. */
export function renderFlow(event: ArchLensFlowResult | null, pipeline: ArchLensFlowResult | null): string {
  const parts: string[] = []
  for (const [label, figure] of [['事件视角', event], ['管线视角', pipeline]] as const) {
    if (figure === null || typeof figure.mermaid !== 'string' || figure.mermaid === '') continue
    parts.push(`### ${label}：${figure.title ?? ''}\n\n${fence(figure.mermaid)}\n\n${sourceNote(figure.source, figure.ref)}${descriptionNote(figure)}`)
  }
  return parts.length > 0 ? parts.join('\n\n') : '（暂无流程图）'
}

/** seq: ordered `from → to：label` list + provenance (accepts the legacy
 * bare-array cache shape — normalized, disk files are never migrated). */
export function renderSeq(figure: ArchLensSequenceResult | ArchLensSequenceResult['messages']): string {
  const result: ArchLensSequenceResult = Array.isArray(figure) ? { source: 'flow', messages: figure } : figure
  const lines = result.messages.map((message, i) => `${i + 1}. \`${message.from}\` → \`${message.to}\`：${message.label}`)
  return `${lines.join('\n')}\n\n${sourceNote(result.source, result.ref)}${descriptionNote(result)}`
}

/** interaction: the event table. */
export function renderInteraction(events: ArchLensEventRow[]): string {
  const rows = events.map(event =>
    `| ${event.event ?? ''} | ${event.mode ?? ''} | ${(event.producers ?? []).join('、')} | ${(event.consumers ?? []).join('、')} | ${event.note ?? ''} |`)
  return `| 事件 | 模式 | 生产者 | 消费者 | 说明 |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}`
}

/** deps: the core subgraph flowchart + its real import edge list (rules, no LLM). */
export function renderDeps(core: ArchLensCoreGraph, graph: ArchLensGraph, index: CodeIndexResult): string {
  const selected = new Set(core.ids)
  const edges: string[] = []
  for (const [from, targets] of importEdges(index)) {
    if (!selected.has(from)) continue
    for (const to of new Set(targets)) {
      if (selected.has(to)) edges.push(`- \`${from}\` → \`${to}\``)
    }
    if (edges.length >= 120) break
  }
  const list = edges.length > 0 ? `\n\n${edges.slice(0, 120).join('\n')}` : ''
  return `${fence(coreFlowchartFromGraph(graph, core.ids))}\n\n核心包：${core.ids.map(id => `\`${id}\``).join('、')}${list}${descriptionNote(core)}`
}

/** er (D2b kept): package-level entity-relationship diagram of the core set. */
export function renderEr(core: ArchLensCoreGraph, graph: ArchLensGraph): string {
  return fence(coreErDiagramFromGraph(graph, core.ids))
}

/** catalog: package duties table. */
export function renderCatalog(duties: Record<string, string>): string {
  const rows = Object.entries(duties).map(([id, duty]) => `| \`${id}\` | ${duty} |`)
  return rows.length > 0
    ? `| 包 | 职责 |\n| --- | --- |\n${rows.join('\n')}`
    : '（暂无职责总结）'
}

/**
 * One figure (or figure pair) → its doc section body. A figure that could not
 * be produced skips its section (error recorded by the caller).
 */
async function renderSection(kind: DocKind, env: FigureEnv, graph: ArchLensGraph): Promise<{ body: string } | { error: string }> {
  switch (kind) {
    case 'concepts': {
      const figure = await ensureFigure(env, 'concepts')
      if ('error' in figure) return figure
      return { body: renderConcepts(figure.data as ArchLensConceptNode[]) }
    }
    case 'flow': {
      const eventFigure = await ensureFigure(env, 'flow-event')
      const pipelineFigure = await ensureFigure(env, 'flow-pipeline')
      const event = 'error' in eventFigure ? null : (eventFigure.data as ArchLensFlowResult)
      const pipeline = 'error' in pipelineFigure ? null : (pipelineFigure.data as ArchLensFlowResult)
      if (event === null && pipeline === null) {
        return { error: `flow: ${'error' in eventFigure ? eventFigure.error : ''}${'error' in pipelineFigure ? ` ${pipelineFigure.error}` : ''}`.trim() }
      }
      return { body: renderFlow(event, pipeline) }
    }
    case 'seq': {
      const figure = await ensureFigure(env, 'seq')
      if ('error' in figure) return figure
      return { body: renderSeq(figure.data as ArchLensSequenceResult) }
    }
    case 'interaction': {
      const figure = await ensureFigure(env, 'interaction')
      if ('error' in figure) return figure
      return { body: renderInteraction(figure.data as ArchLensEventRow[]) }
    }
    case 'deps':
    case 'er': {
      const figure = await ensureFigure(env, 'core')
      if ('error' in figure) return figure
      const core = figure.data as ArchLensCoreGraph
      return { body: kind === 'deps' ? renderDeps(core, graph, env.index) : renderEr(core, graph) }
    }
    case 'catalog': {
      const figure = await ensureFigure(env, 'duties')
      if ('error' in figure) return figure
      return { body: renderCatalog(figure.data as Record<string, string>) }
    }
  }
}

/**
 * D3 (optional, off by default): ONE batched LLM call writes a natural-language
 * description for every object-shaped figure still missing one, then each
 * description is read-modify-written back into the SAME versioned envelope
 * (original `v` and `deps` preserved — a description must never re-stamp or
 * invalidate a figure). Failures are non-fatal: the doc still assembles.
 */
async function describeFigures(env: FigureEnv, errors: string[]): Promise<void> {
  const factsVersion = await readFactVersion(env.fs, env.root)
  const pending: Array<{ id: EntityFigureId; data: Record<string, unknown> }> = []
  for (const id of ['flow-event', 'flow-pipeline', 'seq', 'core'] as const) {
    const data = await readFigureData(env.fs, env.root, id, env.language, factsVersion)
    if (data === null || typeof data !== 'object' || Array.isArray(data)) continue
    const figure = data as { description?: unknown }
    if (typeof figure.description === 'string' && figure.description.trim() !== '') continue
    pending.push({ id, data: data as Record<string, unknown> })
  }
  if (pending.length === 0) return
  const brief = pending
    .map(({ id, data }) => `- ${id}：${JSON.stringify({ ...data, sourceText: undefined }).slice(0, 700)}`)
    .join('\n')
  const prompt = `你是代码架构讲解者。下面是同一个项目的几张架构图（mermaid/时序/核心包选择）的原始数据。为每张图各写一句不超过 80 字的说明（description），概括这张图【在讲什么主线】，只依据数据本身，禁止编造。\n输出语言：${env.language}。\n严格输出 JSON 对象：{"<图id>": "<说明>"}，不要其他内容。\n\n图清单：\n${brief}`
  try {
    // llmText itself reports the live generation status (begin/report/end), so
    // this call site adds none of its own.
    const text = await llmText(env.ctx, prompt, 0.3, undefined, 'docs-descriptions', generationSignal(env.root))
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) {
      errors.push('descriptions: no JSON object in model output')
      return
    }
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    for (const { id } of pending) {
      const note = parsed[id]
      if (typeof note !== 'string' || note.trim() === '') continue
      const target = await env.fs.resolve(specOf(id).cacheName(env.language), { cwd: env.root })
      const raw = await readRawCache(env.fs, target)
      // 同信封 read-modify-write：保留原 v 与 deps（说明不是新事实，不得重盖章）。
      if (raw === null || raw.v !== factsVersion || !Number.isFinite(raw.v) || raw.v <= 0) continue
      await writeVersionedCache(env.fs, target, { ...(raw.data as object), description: note.trim() }, raw.v, env.policy, raw.depsPresent ? raw.deps : undefined)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === ABORTED_MESSAGE) throw error
    errors.push(`descriptions: ${message}`)
  }
}

/**
 * The「📄 一键生成文档」core chain (D8): assemble the architecture doc purely
 * from the figure caches, rebuilding only figures that are missing/stale
 * (through their own chains, unified write path) — zero LLM for the doc body
 * itself. Overwrites docs/architecture.generated.md only.
 * @param ctx - host context (only figure chains / optional descriptions call LLM).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index facts.
 * @param graph - scanned workspace graph facts (deps/er rendering).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for cache/doc writes.
 * @param options - `withDescriptions`: ONE batched LLM pass fills figure
 *   `description` fields first (D3, default off → fully deterministic).
 * @returns `{ path, errors }` (per-section errors collected, doc still
 *   written with the sections that could render), or one fatal `{ error }`.
 */
export async function generateDocsFromFigures(
  ctx: Context,
  fs: FileSystem,
  root: string,
  index: CodeIndexResult,
  graph: ArchLensGraph,
  language: string,
  sandboxPolicy?: SandboxExecutionPolicy,
  options: { withDescriptions?: boolean } = {},
): Promise<{ path: string; errors: string[] } | { error: string }> {
  const env: FigureEnv = { ctx, fs, root, index, graph, language, ...(sandboxPolicy === undefined ? {} : { policy: sandboxPolicy }) }
  const errors: string[] = []
  const sections: Array<{ title: string; body: string }> = []
  try {
    if (options.withDescriptions === true) await describeFigures(env, errors)
    for (const kind of DOC_SECTIONS) {
      const rendered = await renderSection(kind, env, graph)
      if ('error' in rendered) {
        errors.push(`${kind}: ${rendered.error}`)
        continue
      }
      sections.push({ title: SECTION_TITLES[kind], body: rendered.body })
    }
    if (sections.length === 0) return { error: `doc assembly produced no sections: ${errors.join('; ')}` }
    const header = `# 架构文档\n\n> 由 Arch Lens 从图缓存组装生成（零 LLM 正文；缺失/过期的图先经各自的构建链补齐再组装）。共 ${sections.length} 节。\n`
    let body = header
    for (const section of sections) body = mergeSection(body, section.title, section.body)
    const targetPath = await resolveDocTarget(fs, root)
    await writeDoc(fs, targetPath, body, sandboxPolicy)
    return { path: targetPath, errors }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === ABORTED_MESSAGE) return { error: message }
    return { error: `doc assembly failed: ${message}` }
  }
}

/**
 * Regenerate ONE doc section (per-tab「AI 生成」) from the figure caches:
 * ensure the section's figure(s) (missing/stale → that figure's own chain),
 * render, merge into docs/architecture.generated.md under its `## 标题`
 * (every stale copy of the heading is replaced — same rule as the full doc).
 * Zero LLM for the section body itself.
 * @returns `{ path }` or `{ error }`.
 */
export async function generateDocSection(
  ctx: Context,
  fs: FileSystem,
  root: string,
  index: CodeIndexResult,
  graph: ArchLensGraph,
  language: string,
  kind: DocKind,
  sandboxPolicy?: SandboxExecutionPolicy,
): Promise<{ path: string } | { error: string }> {
  const env: FigureEnv = { ctx, fs, root, index, graph, language, ...(sandboxPolicy === undefined ? {} : { policy: sandboxPolicy }) }
  try {
    const rendered = await renderSection(kind, env, graph)
    if ('error' in rendered) return { error: `doc section failed: ${rendered.error}` }
    const targetPath = await resolveDocTarget(fs, root)
    const target = await fs.resolve(targetPath)
    const info = await fs.stat(target).catch(() => undefined)
    const existing = info !== undefined && info.type === 'file' ? await fs.readText(target) : ''
    await writeDoc(fs, targetPath, mergeSection(existing, SECTION_TITLES[kind], rendered.body), sandboxPolicy)
    return { path: targetPath }
  } catch (error) {
    return { error: `doc section failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
