/**
 * Concept-hierarchy generation for the Arch Lens backend, as a replaceable
 * one-way chain:
 *
 *   detectArchDocs(root) → extractDocTree(doc, root)
 *                      ↘ (no doc) generateFromFlow(index)
 *   every stage writes/reads the per-language cache (.arch-lens-concept-<lang>.json)
 *
 * Doc extraction is VERBATIM (no LLM enhancement): nodes carry the original
 * section text and a source anchor so explains can cite evidence. The chain
 * order is FIXED today (docs first, LLM-from-flow as fallback) but each stage
 * is an independent function, so the strategy can be reordered or swapped
 * without touching consumers.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/concept
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import { CACHE_DIR } from './cache-dir.ts'
import { readFactVersion, readVersionedCache } from './fact-cache.ts'
import { writeFigure } from './figures.ts'
import { workspaceRelative } from './paths.ts'
import type { ArchLensConceptNode } from './types.ts'
import { ensureAnalysisProfile } from './analysis.ts'
import { normalizeUsage, recordLlmCall } from './llm-stats.ts'
import { ABORTED_MESSAGE, beginGenerationStage, endGenerationStage, generationSignal, reportGeneration, tailPreview } from './abort.ts'

/** One concept-tree node (wire type from types.ts). */
export type ConceptTreeNode = ArchLensConceptNode

/** Cache file base name; the role language is appended (sanitized). */
const CONCEPT_FILE_BASE = '.arch-lens-concept'

/** Candidate architecture-doc files, relative to the workspace root. */
const DOC_CANDIDATES: string[] = [
  'docs/architecture.md',
  'docs/architecture.zh.md',
  'ARCHITECTURE.md',
  'docs/ARCHITECTURE.md',
  'docs/design.md',
  'docs/overview.md',
  'README.md',
]

/**
 * Language-ordered doc candidates: non-English roles read the zh translation
 * first (docs/architecture.zh.md), English keeps the primary doc first.
 * @param language - role language ('English' or a non-English default).
 * @returns the candidate list in probe order.
 */
export function docCandidates(language?: string): string[] {
  if (language === 'English') return DOC_CANDIDATES
  const [primary, zh, ...rest] = DOC_CANDIDATES
  return [zh!, primary!, ...rest]
}

/** Markdown heading levels that become tree depth (shared with flow.ts). */
export const HEADING_RE = /^(#{1,6})\s+(.+)$/

/** Keep cache file names filesystem-safe (language + method level). */
function cacheName(language: string, methods = false): string {
  const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `${CACHE_DIR}/${CONCEPT_FILE_BASE}-${safe === '' ? 'default' : safe}${methods ? '-methods' : ''}.json`
}

/**
 * The AUTHORITATIVE concept cache file name, exported for the figure
 * registry (`figures.ts`): consumers must never re-spell cache names.
 * @param language - role language.
 * @param methods - 🔬 method-level variant.
 * @returns the CACHE_DIR-relative cache file name.
 */
export function conceptCacheName(language: string, methods = false): string {
  return cacheName(language, methods)
}

/**
 * Stage 1: probe the workspace for architecture documentation. Returns the
 * first candidate that exists as a file (README last — it is the weakest
 * signal and also the fallback for blurbs). Non-English roles probe the zh
 * translation first.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language ('English' or a non-English default).
 * @returns the doc's display path, or null when no candidate exists.
 */
export async function detectArchDocs(fs: FileSystem, root: string, language?: string): Promise<string | null> {
  for (const candidate of docCandidates(language)) {
    try {
      const target = await fs.resolve(candidate, { cwd: root })
      const info = await fs.stat(target)
      if (info !== undefined && info.type === 'file') return target.displayPath
    } catch {
      // absent candidate — keep probing
    }
  }
  return null
}

/**
 * Stage 2: extract a concept tree from a Markdown doc by its heading
 * hierarchy. Pure rule stage — zero LLM, deterministic. Every node carries
 * its source anchor (`ref`: doc path + heading) and the section's full
 * original text (`sourceText`, bounded) so explains can cite verbatim
 * evidence instead of paraphrase.
 * @param fs - filesystem service.
 * @param docPath - display path of the doc.
 * @param root - workspace root (refs are workspace-relative).
 * @returns the extracted tree (may be empty when the doc has no headings).
 */
export async function extractDocTree(fs: FileSystem, docPath: string, root: string): Promise<ConceptTreeNode[]> {
  const info = await fs.stat(await fs.resolve(docPath))
  if (info === undefined || info.type !== 'file') return []
  const text = (await fs.readText(await fs.resolve(docPath))).slice(0, 262144)
  const roots: ConceptTreeNode[] = []
  const stack: Array<{ level: number; node: ConceptTreeNode }> = []
  let currentDesc = ''
  let currentText: string[] = []
  let pendingNode: ConceptTreeNode | null = null
  // Monotonic id: the old `doc:${roots.length}-${stack.length}` produced the
  // SAME id for every sibling at a given depth, so React saw seven nodes with
  // one key (duplicated/corrupted rendering in the concept graph).
  let seq = 0
  const flush = (): void => {
    if (pendingNode !== null) {
      pendingNode.desc = currentDesc.trim().slice(0, 220)
      const full = currentText.join('\n').trim()
      if (full !== '') pendingNode.sourceText = full.slice(0, 2000)
      pendingNode = null
    }
    currentDesc = ''
    currentText = []
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const heading = HEADING_RE.exec(trimmed)
    if (heading !== null) {
      flush()
      const level = heading[1]!.length
      const name = heading[2]!.trim().replace(/[`*_]/g, '').slice(0, 60)
      const node: ConceptTreeNode = {
        id: `doc:${seq}`,
        name,
        desc: '',
        source: 'doc',
        ref: `${workspaceRelative(root, docPath)}#${heading[2]!.trim().replace(/\s+/g, '-')}`,
      }
      seq += 1
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
      if (stack.length === 0) {
        roots.push(node)
      } else {
        const parent = stack[stack.length - 1]!.node
        if (parent.children === undefined) parent.children = []
        parent.children.push(node)
      }
      stack.push({ level, node })
      pendingNode = node
      continue
    }
    if (trimmed === '' || trimmed.startsWith('<!--')) {
      if (pendingNode !== null && currentText.length > 0) currentText.push('')
      continue
    }
    if (pendingNode !== null) {
      const content = trimmed.slice(0, 400)
      currentText.push(content)
      currentDesc += (currentDesc === '' ? '' : ' ') + content
      if (currentDesc.length > 600) {
        currentDesc = currentDesc.slice(0, 600)
      }
    }
  }
  flush()
  return roots
}

/**
 * Fallback stage: LLM induces a concept tree from the run-flow metadata
 * (entry files, imports, entities) — the "no architecture doc" path. Output
 * is the role language; the tree is bounded to keep the request small.
 * @param ctx - host context.
 * @param index - code index result.
 * @param language - role language.
 * @param signal - optional cancellation (⏹ 终止).
 * @param methods - 🔬 方法级: append per-class method names so concept
 *   descriptions can cite real functions.
 * @returns the induced tree (empty on failure).
 */
export async function generateFromFlow(
  ctx: Context,
  index: CodeIndexResult,
  language: string,
  signal?: AbortSignal,
  methods = false,
): Promise<ConceptTreeNode[]> {
  const llm = ctx.get('llm') as LlmRuntime | undefined
  const defaultModel = ctx.get('agentDefaultModel') as
    | { currentSelection(): { provider: string; model: string } }
    | undefined
  if (llm === undefined || defaultModel === undefined) return []
  try {
    const selection = defaultModel.currentSelection()
    // No hard-coded maxTokens (same reasoning as docsgen.llmText): a local
    // literal (3000) can be fully consumed by reasoning under high reasoning
    // levels, leaving zero output text to parse as JSON.
    const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature: 0.3 }, signal)
    const cfg = prepared.config
    const entryLines = index.packages
      .filter(pkg => pkg.entryFiles.length > 0)
      .slice(0, 30)
      .map(pkg => {
        const base = `- ${pkg.id}（入口：${pkg.entryFiles.slice(0, 3).join(', ')}，依赖：${pkg.deps.slice(0, 3).join(', ') || '无'}`
        if (!methods) return `${base}）`
        const methodLines: string[] = []
        for (const entity of pkg.entities) {
          if (entity.kind === 'class' && Array.isArray(entity.children)) {
            const names = entity.children
              .filter(child => child.kind === 'method' || child.kind === 'function')
              .slice(0, 6)
              .map(child => child.name)
            if (names.length > 0) methodLines.push(`${entity.name}{${names.join(', ')}}`)
            if (methodLines.length >= 4) break
          }
        }
        return `${base}；方法：${methodLines.join('；') || '无'}）`
      })
      .join('\n')
    const prompt = `你是代码架构分析师。以下是某项目的包入口与依赖元数据${methods ? '（含类方法，🔬方法级）' : ''}。\n`
      + `请归纳这个项目「是怎么运作的」：识别运行核心概念（如入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳，不要生搬硬套），组织成概念层级树。\n`
      + `输出语言：${language}。\n`
      + `严格输出 JSON 对象数组（最多 12 个根节点，每个节点含 name/desc/inside/children）：[{ "name": "...", "desc": "...", "inside": "...", "children": [] }]，不要输出其他内容。\n\n`
      + entryLines
    const started = Date.now()
    let out = ''
    let usage: TokenUsage | undefined
    // ⚙️ live generation status (same mechanism as llmText).
    beginGenerationStage(signal, 'LLM：concept')
    let textTail = ''
    for await (const chunk of prepared.stream({
      provider: cfg.provider, model: cfg.model,
      ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
      ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
      ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
      ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
      ...(signal === undefined ? {} : { signal }),
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
    })) {
      if (signal?.aborted === true) {
        endGenerationStage(signal)
        throw new Error(ABORTED_MESSAGE)
      }
      if (chunk.type === 'text-delta') {
        out += chunk.text
        textTail = tailPreview(textTail, chunk.text)
        reportGeneration(signal, out.length, textTail)
      }
      if (chunk.type === 'usage') usage = chunk.usage
    }
    if (signal?.aborted === true) {
      endGenerationStage(signal)
      throw new Error(ABORTED_MESSAGE)
    }
    endGenerationStage(signal)
    recordLlmCall('concept', prompt, out, Date.now() - started, normalizeUsage(usage))
    const start = out.indexOf('[')
    const end = out.lastIndexOf(']')
    if (start < 0 || end <= start) return []
    const parsed = JSON.parse(out.slice(start, end + 1)) as Array<{ name?: string; desc?: string; inside?: string; children?: unknown[] }>
    const build = (item: { name?: string; desc?: string; inside?: string; children?: unknown[] }, idPrefix: string, depth: number): ConceptTreeNode | null => {
      if (typeof item.name !== 'string' || item.name === '') return null
      const node: ConceptTreeNode = {
        id: `${idPrefix}-${depth}`,
        name: item.name.slice(0, 60),
        desc: typeof item.desc === 'string' ? item.desc.slice(0, 220) : '',
        source: 'flow',
      }
      if (typeof item.inside === 'string' && item.inside !== '') node.inside = item.inside.slice(0, 400)
      if (Array.isArray(item.children) && depth < 3) {
        const children = item.children
          .map((child, i) => build(child as { name?: string; desc?: string; inside?: string; children?: unknown[] }, `${idPrefix}-${depth}-${i}`, depth + 1))
          .filter((child): child is ConceptTreeNode => child !== null)
        if (children.length > 0) node.children = children
      }
      return node
    }
    return parsed.map((item, i) => build(item, `flow-${i}`, 0)).filter((node): node is ConceptTreeNode => node !== null)
  } catch (error) {
    console.warn(`[arch-lens] concept flow generation failed: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

/**
 * READ-ONLY concept tree: serve the versioned cache when its facts version
 * matches; null when absent/stale. NEVER generates (no doc extraction, no
 * LLM, no cache write) — generation is owned by the write paths (AI 生成 /
 * rescan-dependent regenerate).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @param methods - 🔬 方法级 cache variant.
 * @returns the cached tree, or null when no matching cache exists.
 */
export async function readConceptTree(
  fs: FileSystem,
  root: string,
  language: string,
  methods = false,
): Promise<ConceptTreeNode[] | null> {
  const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null)
  if (cacheTarget === null) return null
  const factsVersion = await readFactVersion(fs, root)
  const cached = await readVersionedCache<ConceptTreeNode[]>(fs, cacheTarget, factsVersion)
  if (cached !== null) console.log(`[arch-lens] concept: served from cache (read-only, lang=${language})`)
  return cached
}

/**
 * The full concept-tree chain: cache → detect doc → extract (verbatim, with
 * source anchors) → shared profile → (no doc) generate from flow. No LLM
 * enhancement — nodes carry the document's original text so explains can cite
 * evidence. Every successful stage writes the language cache; `force`
 * bypasses it. WRITE path only: reads happen through readConceptTree().
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (for the flow fallback).
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @param methods - 🔬 方法级: skip the shared (entity-level) profile and
 *   induce from the method-level summary (methods + call edges).
 * @returns the concept tree, or an error result.
 */
export async function conceptTree(
  ctx: Context,
  fs: FileSystem,
  root: string,
  index: CodeIndexResult,
  language: string,
  force: boolean,
  sandboxPolicy?: SandboxExecutionPolicy,
  methods = false,
): Promise<ConceptTreeNode[] | { error: string }> {
  const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null)
  const factsVersion = await readFactVersion(fs, root)
  if (!force && cacheTarget !== null) {
    const cached = await readVersionedCache<ConceptTreeNode[]>(fs, cacheTarget, factsVersion)
    if (cached !== null) {
      console.log(`[arch-lens] concept: served from cache (lang=${language})`)
      return cached
    }
  }
  // 统一写入口（注册表文件名 + deps 规则单一来源）：概念树是全局归纳，
  // 依赖所有包；写失败抛出，由调用方决定成败。
  const writeCache = async (tree: ConceptTreeNode[]): Promise<void> => {
    await writeFigure(fs, root, 'concepts', language, factsVersion, tree, { index, methods, policy: sandboxPolicy })
  }
  // Stage 1: docs first (verbatim extraction, no LLM touching the text).
  // A doc tree is only authoritative when it is an actual HIERARCHY: a doc
  // with a single heading (or only flat siblings) would render as one lonely
  // box, so a too-shallow extraction falls through to the profile/induction.
  const docPath = await detectArchDocs(fs, root, language)
  if (docPath !== null) {
    console.log(`[arch-lens] concept: doc chain (${docPath})`)
    const tree = await extractDocTree(fs, docPath, root)
    if (isUsableDocTree(tree)) {
      await writeCache(tree)
      return tree
    }
    console.log(`[arch-lens] concept: doc tree too shallow (${tree.length} roots) — falling through`)
  }
  // Stage 1.5: shared analysis profile (one LLM pass across all chains —
  // consumed AFTER docs, BEFORE the chain-own LLM fallback). Skipped in
  // method-level mode: the shared profile is entity-level by design.
  if (!methods) {
    const profile = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy)
    if (profile.conceptTree !== undefined && profile.conceptTree.length > 0) {
      console.log('[arch-lens] concept: shared analysis profile')
      await writeCache(profile.conceptTree)
      return profile.conceptTree
    }
  }
  // Fallback: LLM from run-flow metadata (nodes carry source: 'flow').
  console.log(`[arch-lens] concept: no usable doc headings — generating from flow${methods ? ' (method-level)' : ''}`)
  const tree = await generateFromFlow(ctx, index, language, generationSignal(root), methods)
  if (tree.length === 0) return { error: 'concept generation failed: no doc and LLM flow generation returned nothing' }
  await writeCache(tree)
  return tree
}

/**
 * Whether an extracted doc tree is a usable hierarchy: at least two roots,
 * or at least one node with children. A single flat heading is not a
 * "concept hierarchy" — the figure would show one isolated box.
 * @param tree - the extracted doc tree.
 * @returns whether the tree is worth rendering as the doc authority.
 */
export function isUsableDocTree(tree: readonly ConceptTreeNode[]): boolean {
  if (tree.length >= 2) return true
  return tree.some(node => node.children !== undefined && node.children.length > 0)
}
