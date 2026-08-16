/**
 * Concept-hierarchy generation for the Arch Lens backend, as a replaceable
 * one-way chain:
 *
 *   detectArchDocs(root) → extractDocTree(doc) → enhanceWithLLM(tree)
 *                                          ↘ (no doc) generateFromFlow(index)
 *   every stage writes/reads the per-language cache (.arch-lens-concept-<lang>.json)
 *
 * The chain order is FIXED today (docs first, LLM-from-flow as fallback) but
 * each stage is an independent function, so the strategy can be reordered or
 * swapped without touching consumers.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/concept
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import type { ArchLensConceptNode } from './types.ts'

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

/** Markdown heading levels that become tree depth. */
const HEADING_RE = /^(#{1,6})\s+(.+)$/

/** Keep cache file names filesystem-safe. */
function cacheName(language: string): string {
  const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `${CONCEPT_FILE_BASE}-${safe === '' ? 'default' : safe}.json`
}

/**
 * Stage 1: probe the workspace for architecture documentation. Returns the
 * first candidate that exists as a file (README last — it is the weakest
 * signal and also the fallback for blurbs).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @returns the doc's display path, or null when no candidate exists.
 */
export async function detectArchDocs(fs: FileSystem, root: string): Promise<string | null> {
  for (const candidate of DOC_CANDIDATES) {
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
 * hierarchy. Pure rule stage — zero LLM, deterministic.
 * @param fs - filesystem service.
 * @param docPath - display path of the doc.
 * @returns the extracted tree (may be empty when the doc has no headings).
 */
export async function extractDocTree(fs: FileSystem, docPath: string): Promise<ConceptTreeNode[]> {
  const info = await fs.stat(await fs.resolve(docPath))
  if (info === undefined || info.type !== 'file') return []
  const text = (await fs.readText(await fs.resolve(docPath))).slice(0, 262144)
  const roots: ConceptTreeNode[] = []
  const stack: Array<{ level: number; node: ConceptTreeNode }> = []
  let currentDesc = ''
  let pendingNode: ConceptTreeNode | null = null
  const flushDesc = (): void => {
    if (pendingNode !== null) {
      pendingNode.desc = currentDesc.trim().slice(0, 220)
      pendingNode = null
    }
    currentDesc = ''
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const heading = HEADING_RE.exec(trimmed)
    if (heading !== null) {
      flushDesc()
      const level = heading[1]!.length
      const name = heading[2]!.trim().replace(/[`*_]/g, '').slice(0, 60)
      const node: ConceptTreeNode = { id: `doc:${roots.length}-${stack.length}`, name, desc: '' }
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
    if (trimmed !== '' && pendingNode !== null && !trimmed.startsWith('<!--')) {
      currentDesc += (currentDesc === '' ? '' : ' ') + trimmed.slice(0, 200)
      if (currentDesc.length > 600) flushDesc()
    }
  }
  flushDesc()
  return roots
}

/**
 * Stage 3 (optional): LLM enhancement — polish node names and add `inside`
 * mechanism notes in the role language. Skips cleanly when the LLM services
 * are unavailable.
 * @param ctx - host context carrying llm and agentDefaultModel.
 * @param tree - extracted tree.
 * @param language - role language.
 * @returns the enhanced tree (unchanged on failure).
 */
export async function enhanceWithLLM(
  ctx: Context,
  tree: ConceptTreeNode[],
  language: string,
): Promise<ConceptTreeNode[]> {
  if (tree.length === 0) return tree
  const llm = ctx.get('llm') as LlmRuntime | undefined
  const defaultModel = ctx.get('agentDefaultModel') as
    | { currentSelection(): { provider: string; model: string } }
    | undefined
  if (llm === undefined || defaultModel === undefined) return tree
  try {
    const selection = defaultModel.currentSelection()
    const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature: 0.2, maxTokens: 2500 })
    const cfg = prepared.config
    const prompt = `你是架构文档润色助手。以下是某项目的架构文档提取出的概念层级（Markdown 列表）。\n`
      + `请为每个节点补充「机制说明」（一两句话讲清它在这个架构里干什么、怎么运作），并把含糊的标题润色为清晰的概念名。\n`
      + `输出语言：${language}。\n`
      + `严格输出 JSON 对象数组：[{ "id": "...", "name": "...", "desc": "...", "inside": "..." }]，id 必须与输入一致，不要输出其他内容。\n\n`
      + JSON.stringify(tree)
    let out = ''
    for await (const chunk of prepared.stream({
      provider: cfg.provider, model: cfg.model,
      ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
      ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
      ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
      ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
    })) {
      if (chunk.type === 'text-delta') out += chunk.text
    }
    const start = out.indexOf('[')
    const end = out.lastIndexOf(']')
    if (start < 0 || end <= start) return tree
    const parsed = JSON.parse(out.slice(start, end + 1)) as Array<{ id?: string; name?: string; desc?: string; inside?: string }>
    const byId = new Map(parsed.filter(item => item.id !== undefined).map(item => [item.id!, item]))
    const apply = (node: ConceptTreeNode): void => {
      const patch = byId.get(node.id)
      if (patch !== undefined) {
        if (typeof patch.name === 'string' && patch.name !== '') node.name = patch.name.slice(0, 60)
        if (typeof patch.desc === 'string' && patch.desc !== '') node.desc = patch.desc.slice(0, 220)
        if (typeof patch.inside === 'string' && patch.inside !== '') node.inside = patch.inside.slice(0, 400)
      }
      for (const child of node.children ?? []) apply(child)
    }
    for (const node of tree) apply(node)
    return tree
  } catch (error) {
    console.warn(`[arch-lens] concept enhance failed (keeping doc tree): ${error instanceof Error ? error.message : String(error)}`)
    return tree
  }
}

/**
 * Fallback stage: LLM induces a concept tree from the run-flow metadata
 * (entry files, imports, entities) — the "no architecture doc" path. Output
 * is the role language; the tree is bounded to keep the request small.
 * @param ctx - host context.
 * @param index - code index result.
 * @param language - role language.
 * @returns the induced tree (empty on failure).
 */
export async function generateFromFlow(
  ctx: Context,
  index: CodeIndexResult,
  language: string,
): Promise<ConceptTreeNode[]> {
  const llm = ctx.get('llm') as LlmRuntime | undefined
  const defaultModel = ctx.get('agentDefaultModel') as
    | { currentSelection(): { provider: string; model: string } }
    | undefined
  if (llm === undefined || defaultModel === undefined) return []
  try {
    const selection = defaultModel.currentSelection()
    const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature: 0.3, maxTokens: 3000 })
    const cfg = prepared.config
    const entryLines = index.packages
      .filter(pkg => pkg.entryFiles.length > 0)
      .slice(0, 30)
      .map(pkg => `- ${pkg.id}（入口：${pkg.entryFiles.slice(0, 3).join(', ')}，依赖：${pkg.deps.slice(0, 5).join(', ') || '无'}）`)
      .join('\n')
    const prompt = `你是代码架构分析师。以下是某项目的包入口与依赖元数据。\n`
      + `请归纳这个项目「是怎么运作的」：识别运行核心概念（如入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳，不要生搬硬套），组织成概念层级树。\n`
      + `输出语言：${language}。\n`
      + `严格输出 JSON 对象数组（最多 12 个根节点，每个节点含 name/desc/inside/children）：[{ "name": "...", "desc": "...", "inside": "...", "children": [] }]，不要输出其他内容。\n\n`
      + entryLines
    let out = ''
    for await (const chunk of prepared.stream({
      provider: cfg.provider, model: cfg.model,
      ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
      ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
      ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
      ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
    })) {
      if (chunk.type === 'text-delta') out += chunk.text
    }
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
 * The full concept-tree chain: cache → detect doc → extract → enhance →
 * (no doc) generate from flow. Every successful stage writes the language
 * cache; `force` bypasses the cache and regenerates.
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (for the flow fallback).
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @returns the concept tree, or an error result.
 */
export async function conceptTree(
  ctx: Context,
  fs: FileSystem,
  root: string,
  index: CodeIndexResult,
  language: string,
  force: boolean,
): Promise<ConceptTreeNode[] | { error: string }> {
  const cacheTarget = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null)
  if (!force && cacheTarget !== null) {
    try {
      const info = await fs.stat(cacheTarget)
      if (info !== undefined && info.type === 'file') {
        const cached = JSON.parse(await fs.readText(cacheTarget)) as ConceptTreeNode[]
        console.log(`[arch-lens] concept: served from cache (lang=${language})`)
        return cached
      }
    } catch {
      // stale/corrupt cache → regenerate
    }
  }
  const writeCache = async (tree: ConceptTreeNode[]): Promise<void> => {
    if (cacheTarget === null) return
    try {
      await fs.writeText(cacheTarget, JSON.stringify(tree))
    } catch {
      // cache write failures are non-fatal
    }
  }
  // Stage 1: docs first.
  const docPath = await detectArchDocs(fs, root)
  if (docPath !== null) {
    console.log(`[arch-lens] concept: doc chain (${docPath})`)
    let tree = await extractDocTree(fs, docPath)
    if (tree.length > 0) {
      tree = await enhanceWithLLM(ctx, tree, language)
      await writeCache(tree)
      return tree
    }
  }
  // Fallback: LLM from run-flow metadata.
  console.log('[arch-lens] concept: no usable doc headings — generating from flow')
  const tree = await generateFromFlow(ctx, index, language)
  if (tree.length === 0) return { error: 'concept generation failed: no doc and LLM flow generation returned nothing' }
  await writeCache(tree)
  return tree
}
