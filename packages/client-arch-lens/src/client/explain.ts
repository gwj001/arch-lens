/**
 * Explain-prompt assembly for the Arch Lens learning desk. Prompts stay
 * learning-object-agnostic: the scanned graph injects the repository identity
 * and core components, so the same templates serve any workspace.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/explain
 */

import type { ArchLensGraph } from '@deepseek-ai/dsh-arch-lens-backend'

/** Default unit explain style (Config.explainStyle may replace it). */
export const DEFAULT_EXPLAIN_STYLE =
  '按以下理念讲解：1) 只讲流程与职责，这个组件/事件/图表达什么、关键节点是什么；'
  + '2) 它如何被调度、又如何调度其他组件（服务/事件/消息）；'
  + '3) 用自然语言翻译核心机制，不要贴大段代码；'
  + '4) 给出关键文件路径；'
  + '5) 最后给一条学习路径建议（接下来看什么）。'

/** Default overview prompt (Config.overviewPrompt may replace it). */
export const DEFAULT_OVERVIEW_PROMPT =
  '请从上帝视角讲解代码库「{root}」的整体架构。\n\n'
  + '【参考模板】参考架构学习台的概念层级模板组织讲解：先讲运行框架/基座，再讲核心层，再讲各能力模块，最后讲外部接入。\n'
  + '【设计理念】识别并讲解这个系统的核心设计理念（如插件化、事件驱动、不可变日志、分层、fail-closed 等——从代码和文档中判断，不要生搬硬套）。\n'
  + '【结构与交互】1) 核心组件有哪些（参考：被依赖最多的组件：{core}）；2) 核心组件之间怎么交互（服务调用 vs 事件/消息，谁调度谁）；3) 整体如何装配/启动；4) 一次典型的主流程。\n'
  + '【安全】如有沙箱/权限/审批机制，讲解其构成与执行路径。\n'
  + '【输出要求】只讲流程与职责，用自然语言翻译核心机制，不要贴大段代码；给出关键文件路径；最后给一条学习路径建议。\n\n'
  + '工作区：{root}'

/**
 * Repository display name from the graph root path.
 * @param root - absolute workspace root.
 * @returns last path segment, or a fallback.
 */
export function repoName(root: string): string {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.at(-1) ?? '当前代码库'
}

/**
 * The most-depended-upon package ids (core candidate heuristic).
 * @param graph - scanned graph.
 * @param limit - how many to return.
 * @returns short ids ordered by in-degree descending.
 */
export function coreCandidates(graph: ArchLensGraph, limit = 8): string[] {
  const inDegree = new Map<string, number>()
  for (const edge of graph.edges) inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
  return [...graph.nodes]
    .map(node => ({ id: node.id, degree: inDegree.get(node.id) ?? 0 }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, limit)
    .map(entry => entry.id)
}

/**
 * Assemble the overview explain request for a workspace graph.
 * @param graph - scanned graph.
 * @param overviewPrompt - configured or default template.
 * @returns the question text.
 */
export function overviewQuestion(graph: ArchLensGraph, overviewPrompt: string): string {
  const root = repoName(graph.root)
  return overviewPrompt
    .replaceAll('{root}', root)
    .replaceAll('{core}', coreCandidates(graph).join('、'))
}

/**
 * Assemble the per-component explain request.
 * @param id - package short id.
 * @param group - package group.
 * @param blurb - README first paragraph.
 * @param files - src file names.
 * @param explainStyle - configured or default style.
 * @returns the question text.
 */
export function componentQuestion(
  id: string,
  group: string,
  blurb: string,
  files: string[],
  explainStyle: string,
): string {
  const fileList = files.length > 0 ? files.join(', ') : id
  return `讲解组件 ${id}（${group}）：\n\n${blurb === '' ? '' : `${blurb}\n\n`}核心文件：${fileList}\n\n${explainStyle}`
}

/**
 * Assemble the per-event explain request.
 * @param event - event name.
 * @param mode - dispatch mode.
 * @param producers - producer names.
 * @param consumers - consumer names.
 * @param note - event note.
 * @param explainStyle - configured or default style.
 * @returns the question text.
 */
export function eventQuestion(
  event: string,
  mode: string,
  producers: string[],
  consumers: string[],
  note: string,
  explainStyle: string,
): string {
  return `讲解核心事件 ${event}（模式 ${mode}）：\n生产者：${producers.join(', ')}；消费者：${consumers.join(', ')}。\n${note}\n\n${explainStyle}`
}

/**
 * Assemble a unit-data explain request (figure/catalog).
 * @param title - unit title.
 * @param data - unit data JSON.
 * @param explainStyle - configured or default style.
 * @returns the question text.
 */
export function dataQuestion(title: string, data: unknown, explainStyle: string): string {
  let body = ''
  try {
    body = JSON.stringify(data).slice(0, 3500)
  } catch {
    body = String(data)
  }
  return `请讲解这张图「${title}」：\n\n${body}\n\n${explainStyle}`
}
