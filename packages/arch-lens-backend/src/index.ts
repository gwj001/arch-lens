/**
 * Arch Lens backend host service: workspace graph scanning, component detail
 * projection, and answer-level note recording. Read-only graph/component/notes
 * methods cross to the browser via Typert Remote; note file WRITES have exactly
 * one path — the session/event listener below. notePending only stages in-memory
 * question metadata; it never touches the file.
 * @module @deepseek-ai/dsh-arch-lens-backend
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { unlink } from 'node:fs/promises'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import s from '@deepseek-ai/schemastery'
import { appendNote, readNotes } from './notes.ts'
import { scanWorkspace } from './scan.ts'
import { summarizeDuties, readDutySummaries } from './summarize.ts'
import { mergeDutyFacts } from './duty-facts.ts'
import { progressStats, summarizeProgress } from './progress.ts'
import { analyzeWorkspace } from './analyze.ts'
import { generateFromFlow, readConceptTree } from './concept.ts'
import { flowDiagram, readFlow } from './flow.ts'
import { readStructuredCache, writeStructuredCache } from './docsgen.ts'
import { generateDocSection, generateDocsFromFigures } from './docbuild.ts'
import { readSequence } from './sequence.ts'
import { dependencyFlowchart, entityErDiagram, importEdges, importFlowchart, packageErDiagram, coreFlowchartFromGraph, coreErDiagramFromGraph, overviewFigureFromGraph } from './mermaid.ts'
import { coreGraph, readCore } from './core.ts'
import { clearAnalysisProfileCache, regenerateProfileField } from './analysis.ts'
import type { AnalysisFlow } from './analysis.ts'
import { llmStatsAdopted, llmStatsSnapshot, hydrateLlmStats, recordLlmCall } from './llm-stats.ts'
import { checkWorkspaceChanges, type WorkspaceFileChanges } from './manifest.ts'
import { selectiveInvalidate, sweepLegacyCaches, readFactVersion, readRawCache, readVersionedCache } from './fact-cache.ts'
import { runEntityFigurePass, readIndexFacts } from './figures.ts'
import { computeChangedPackages } from './change-pack.ts'
import { abortGeneration, currentGenerationStatus, generationSignal, waitForGenerationStatus } from './abort.ts'
import {
  buildCustomFigurePrompt,
  buildDynamicFigurePrompt,
  buildFigurePrompt,
  buildFigureRepairPrompt,
  dynamicFigureCacheName,
  dynamicFigureWriteFacts,
  dynamicTargetKey,
  extractCustomFigure,
  extractFigureJson,
  writeDynamicFigureCache,
  writeFigureCache,
} from './session-figure.ts'
import type { DynamicFigureKind, PendingFigure, SessionFigureKind } from './session-figure.ts'
import { sanitizeMermaid } from './flow-angle.ts'
import { figureFollowUp } from './followup.ts'
import type { DocKind, FollowUpKind, FollowUpResult } from './types.ts'
import { sessionPolicy as resolveSessionPolicy } from './policy.ts'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import { CACHE_DIR } from './cache-dir.ts'
import type {
  ArchLensCodeInsight,
  ArchLensComponentDetail,
  ArchLensConceptNode,
  ArchLensCoreGraph,
  ArchLensEventRow,
  ArchLensFlowResult,
  ArchLensGraph,
  ArchLensNotesResult,
  ArchLensProgressResult,
  ArchLensPromptConfig,
  ArchLensPromptConfigResult,
  ArchLensSequenceMessage,
  ArchLensSequenceResult,
  FlowAngle,
  GenerationStatus,
  LlmStatsSnapshot,
  LlmUsageRecord,
  RegenerateFigureResult,
  WorkspaceChanges,
} from './types.ts'

// Export the wire types AND the shared runtime helper (groupLabel) — the
// client bundle imports it as a value.
export * from './types.ts'

/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = 'ARCH-NOTES.md'

/**
 * 功能下线开关（2026-09，暂时屏蔽；代码与既有数据文件全部保留，翻回 false
 * 即恢复）。client 侧（arch-view.tsx）有同名开关同步隐藏入口按钮，这里的
 * host 守卫是兜底：旧页面/直接 RPC 调用拿到明确错误而不是静默错行为。
 * - 笔记系（notes/progress/progressStats + 讲解完成后的 appendNote）：
 *   讲解会话历史本身就是笔记——问答、生成的图、追问过程全在会话里，
 *   ARCH-NOTES.md 只是抄录问答的有损子集（图记不住），整体废弃不补。
 *   覆盖度徽章/教练总结都以笔记文件为数据源，一并下线。
 * - 文档系（generateDocs/generateDocSection）：零 LLM 模板组装正文达不到
 *   可交付质量。参照 DSH 自身的做法——docs 是仓库资产（手写正文 +
 *   scripts 生成辅图 + website 发布），面板内无运行时生成按钮；重做方向
 *   （agent 会话轮写文档）另议。
 * 不受影响：时序/流程图对既有 docs/architecture*.md 的「逐字提取」是读
 * 路径（文件在就照常工作）；讲解功能本身照常（会话回合 + LLM 记账）。
 */
const NOTES_FEATURE_OFF = true
const DOCS_FEATURE_OFF = true

/** Persisted scan-graph cache under the workspace `index/` cache directory
 * (reopening after a host restart must not re-walk the filesystem; refresh()
 * invalidates it). */
const GRAPH_CACHE_FILE = `${CACHE_DIR}/.arch-lens-graph.json`

/** Persisted code-index cache written by the codeIndex provider under the same
 * `index/` directory, now as a versioned `{ v, data }` envelope (v = the facts
 * version it was built against; see code-index-tree-sitter/src/envelope.ts). */
const INDEX_CACHE_FILE = `${CACHE_DIR}/.arch-lens-index.json`

/** How long a rescan waits inline for a code-index rebuild before letting it
 * finish in the background (kept under the desk's ~30s RPC budget). */
const INDEX_ENVELOPE_TIMEBOX_MS = 20000

/** Per-workspace prompt configuration file under the same cache directory. */
const PROMPT_CONFIG_FILE = `${CACHE_DIR}/.arch-lens-prompts.json`

/** Optional deployment configuration. */
export interface Config {
  /** Note file name in the workspace root (default ARCH-NOTES.md). */
  notesFile?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    archLens: ArchLensService
  }
}

/**
 * A read of the session's cumulative token-usage projection
 * (`sessionProjections.snapshot(session).values.tokenUsage`). The delta
 * between two snapshots around one staged request attributes that request's
 * provider-reported spend to the arch-lens action (AI 生成 / 动态出图 /
 * 讲解), so token usage shows up in the 📊 LLM 用量 panel even though those
 * calls run inside the session's own agent turn.
 */
interface SessionUsageSnapshot {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** In-memory staged question metadata, consumed by the next matching answer. */
interface PendingNote {
  target: string
  question: string
  sessionId: string | null
  stagedAt: number
  /** Session tokenUsage snapshot when the request was staged (differential
   * attribution of the answering model call), or undefined when unavailable. */
  usageStart?: SessionUsageSnapshot
}

/**
 * The Arch Lens backend Remote service (`ctx.archLens`).
 */
export class ArchLensService extends TypertRemoteService {
  static inject = ['fs', 'sandboxPolicy']

  /** Loader validation for the optional note file name. */
  static Config: s<Config> = s.object({
    notesFile: s.string(),
  })

  private readonly notesFile: string
  /** Per-workspace scan cache: keyed by the resolved workspace root, so
   * re-loading the desk on the same workspace never rescans, while switching
   * to a different workspace rescans automatically on the next graph(). */
  private graphCaches = new Map<string, ArchLensGraph | { error: string }>()
  /** One in-flight read (root + promise) so concurrent callers share one
   * cache read per root; a read of another root can run alongside. */
  private graphInFlight: { root: string; promise: Promise<ArchLensGraph | null | { error: string }> } | null = null
  private pending: PendingNote | null = null
  /** One staged session-driven figure request (🤖 AI 生成 via 会话回合):
   * matched by figId in the agent's answer, written to the figure cache. */
  private pendingFigure: PendingFigure | null = null
  /** One staged CUSTOM figure request (🎨 动态出图): matched by figId in the
   * agent's answer, captured into customFigures[figureId]. `figureId` is the
   * stable scene id (`dynamic-N`, per-workspace counter) the panel locks on
   * save; a follow-up re-uses it, a new scene allocates a fresh one. */
  private pendingCustomFigure: { figId: string; figureId: string; text: string; language: string; stagedAt: number; usageStart?: SessionUsageSnapshot } | null = null
  /** All custom figures known this session, keyed by scene id: generated by
   * the panel OR restored from disk. `saved` reflects whether the CURRENT
   * content is persisted (a follow-up re-render flips it back to false). */
  private customFigures = new Map<string, { figureId: string; title: string; diagram: string; summary: string; text: string; at: number; saved: boolean }>()
  /** In-flight code-index load per root: CONCURRENT figure RPCs share ONE
   * indexWorkspace call instead of each re-loading/re-parsing the workspace
   * (the disk cache already avoids re-scanning source; this dedups the load). */
  private indexInFlight: { root: string; promise: Promise<CodeIndexResult> } | null = null

  /** Shared workspace index load: concurrent calls for the SAME root await the
   * same in-flight promise (dedup); sequential calls behave exactly like a
   * plain indexWorkspace. The on-disk index cache is bound to the current
   * facts version (「↻ 重新扫描」's generatedAt): an unknown version (0) makes
   * the provider neither read nor persist, and a mismatched envelope on disk
   * triggers exactly one forced rebuild (defense in depth).
   * @throws when the codeIndex service is unavailable. */
  private async indexWorkspaceShared(root: string): Promise<CodeIndexResult> {
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) throw new Error('codeIndex service unavailable')
    const inFlight = this.indexInFlight
    if (inFlight !== null && inFlight.root === root) return inFlight.promise
    const promise = (async (): Promise<CodeIndexResult> => {
      const factsVersion = await readFactVersion(this.ctx.fs, root)
      const policy = this.sessionPolicy()
      const index = await codeIndex.indexWorkspace(root, policy, factsVersion)
      const target = await this.ctx.fs.resolve(INDEX_CACHE_FILE, { cwd: root }).catch(() => null)
      if (target === null || factsVersion === 0) return index
      const envelope = await readRawCache(this.ctx.fs, target)
      if (envelope !== null && envelope.v !== factsVersion) {
        await codeIndex.refresh(root, policy)
        return codeIndex.indexWorkspace(root, policy, factsVersion)
      }
      return index
    })().finally(() => {
      if (this.indexInFlight?.root === root) this.indexInFlight = null
    })
    this.indexInFlight = { root, promise }
    return promise
  }
  /** Session whose cwd anchors the workspace root; null falls back to the sandbox policy. */
  private targetSessionId: string | null = null

  /**
   * @param ctx - host context carrying fs and sandboxPolicy.
   * @param config - optional notes file name.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'archLens')
    this.notesFile = config.notesFile ?? DEFAULT_NOTES_FILE
  }

  /** Resolve the workspace root from the target session's cwd, else the sandbox policy. */
  private resolveRoot(): string | { error: string } {
    const target = this.targetSessionId
    if (target !== null) {
      const session = this.ctx.get('sessions')?.get(target as SessionId)
      const cwd = session?.header.cwd
      if (cwd !== undefined) return cwd
    }
    const sandboxPolicy = this.ctx.get('sandboxPolicy')
    const root = sandboxPolicy?.workspaceRoot
    if (root === undefined) return { error: 'cannot resolve workspace root (sandboxPolicy.workspaceRoot missing)' }
    return root
  }

  /** Snapshot the session's cumulative token usage (the tokenUsage projection
   * from token-meter), or undefined when the session or projection is
   * unavailable. The delta between two snapshots around one staged request
   * attributes that request's provider-reported spend to the arch-lens
   * action (AI 生成 / 动态出图 / 讲解 run inside the session's agent turn). */
  private sessionUsageSnapshot(sessionId: string | null | undefined): SessionUsageSnapshot | undefined {
    if (sessionId === null || sessionId === undefined) return undefined
    const session = this.ctx.get('sessions')?.get(sessionId as SessionId)
    if (session === undefined) return undefined
    const projections = this.ctx.get('sessionProjections') as
      | { snapshot(s: unknown): { values: Record<string, SessionUsageSnapshot> } }
      | undefined
    return projections?.snapshot(session).values.tokenUsage
  }

  /** Attribute one staged session-driven request's token spend (delta between
   * the staged and the current session tokenUsage) to the LLM ledger. */
  private recordSessionUsage(kind: string, label: string, stagedAt: number, usageStart: SessionUsageSnapshot | undefined, sessionId: string | null): void {
    const end = this.sessionUsageSnapshot(sessionId)
    if (usageStart === undefined || end === undefined) return
    const delta: SessionUsageSnapshot = {
      uncachedInputTokens: Math.max(0, end.uncachedInputTokens - usageStart.uncachedInputTokens),
      outputTokens: Math.max(0, end.outputTokens - usageStart.outputTokens),
      cacheReadTokens: Math.max(0, end.cacheReadTokens - usageStart.cacheReadTokens),
      cacheWriteTokens: Math.max(0, end.cacheWriteTokens - usageStart.cacheWriteTokens),
    }
    if (delta.uncachedInputTokens === 0 && delta.outputTokens === 0
      && delta.cacheReadTokens === 0 && delta.cacheWriteTokens === 0) return
    const usage: LlmUsageRecord = {
      inTokens: delta.uncachedInputTokens + delta.cacheReadTokens + delta.cacheWriteTokens,
      outTokens: delta.outputTokens,
    }
    if (delta.cacheReadTokens > 0) usage.cacheReadTokens = delta.cacheReadTokens
    if (delta.cacheWriteTokens > 0) usage.cacheWriteTokens = delta.cacheWriteTokens
    recordLlmCall(kind, '', '', Math.max(0, Date.now() - stagedAt), usage, label)
  }

  /** In-flight follow-up redraw AbortControllers per workspace root: the
   * panel's「取消」button (while a redraw is running) aborts the matching
   * controller so the LLM stream stops and the cache is never overwritten. */
  private followUpAbort = new Map<string, AbortController>()

  /** In-flight full-docs generation per workspace root: repeated「📄 一键生成
   * 文档」clicks (or parallel RPCs) while one is running reuse the SAME
   * promise — the LLM work runs exactly once per root, later calls share its
   * result instead of re-generating. */
  private docInFlight: { root: string; promise: Promise<{ path: string } | { error: string }> } | null = null

  /** Scan (with cache) the workspace package tree; concurrent callers share
   * one scan per root. Cache-first: a previously scanned workspace (any
   * session of it) resolves instantly; only a new root triggers a scan.
   * The scan graph is ALSO persisted to `index/.arch-lens-graph.json` under the
   * workspace root, so reopening the desk after a host restart serves the
   * cached graph instead of re-walking the filesystem. refresh() marks the
   * disk copy invalid before it rescans (the FileSystem has no delete).
   * READ-ONLY: never scans. Facts (scan graph + code index) are built ONLY
   * by rescan (refresh) — opening the panel / switching tabs never walks the
   * filesystem. No disk cache ⇒ returns null.
   */
  private graph(): Promise<ArchLensGraph | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return Promise.resolve(root)
    const cached = this.graphCaches.get(root)
    if (cached !== undefined) return Promise.resolve(cached)
    if (this.graphInFlight !== null && this.graphInFlight.root === root) return this.graphInFlight.promise
    const promise = this.graphFromDisk(root).then(fromDisk => {
      if (fromDisk !== null) {
        console.log(`[arch-lens] graph: served from disk cache (root=${root})`)
        this.graphCaches.set(root, fromDisk)
        return fromDisk
      }
      console.log(`[arch-lens] graph: no disk cache (root=${root}) — null; facts are built by rescan`)
      return null
    })
    this.graphInFlight = { root, promise }
    return promise
  }

  /** Read the persisted scan graph; null when absent, invalidated or foreign. */
  private async graphFromDisk(root: string): Promise<ArchLensGraph | null> {
    try {
      const fs = this.ctx.fs
      const target = await fs.resolve(GRAPH_CACHE_FILE, { cwd: root }).catch(() => null)
      if (target === null) return null
      const info = await fs.stat(target).catch(() => undefined)
      if (info === undefined || info.type !== 'file') return null
      const parsed = JSON.parse(await fs.readText(target)) as { root?: unknown; graph?: unknown }
      if (typeof parsed !== 'object' || parsed === null) return null
      if (parsed.root !== root) return null
      const graph = parsed.graph as ArchLensGraph | undefined
      if (typeof graph !== 'object' || graph === null || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null
      return graph
    } catch {
      return null
    }
  }

  /** Persist a fresh scan graph (non-fatal on failure) and return the new
   * facts version (generatedAt) written, or 0 when the write failed. */
  private async writeGraphDisk(root: string, graph: ArchLensGraph): Promise<number> {
    const generatedAt = Date.now()
    try {
      const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root })
      await this.ctx.fs.writeText(
        target,
        JSON.stringify({ root, generatedAt, graph }),
        undefined, undefined, this.sessionPolicy(),
      )
      return generatedAt
    } catch {
      return 0
    }
  }

  /** Graph read for internal consumers: null (no facts built yet) collapses
   * to an error so callers never touch undefined nodes/edges. */
  private async requireGraph(): Promise<ArchLensGraph | { error: string }> {
    const graph = await this.graph()
    if (graph === null) return { error: 'no facts yet: run 重新扫描 (refresh) first' }
    return graph
  }

  /**
   * Duty facts for figure prompts — the 「各包职责」 section is assembled
   * HOST-side from disk state (review verdict C): versioned AI summaries
   * (readDutySummaries: miss/stale-version → null, NEVER generates) → scanned
   * blurbs. Making the link a pure function of disk state means 「职责→出图」
   * holds regardless of whether the catalog tab was ever opened — no timing
   * hole, no second copy of the priority rule (single source: duty-facts.ts
   * leaf). The old client-supplied LEGACY fallback map is gone: the disk chain
   * is the only fact source, so a second copy could only diverge.
   */
  private async dutyFactsForFigure(
    root: string,
    language: string,
  ): Promise<Record<string, string>> {
    const summaries = await readDutySummaries(this.ctx.fs, root, language)
    const graph = await this.graph()
    const nodes = graph === null || 'error' in graph ? [] : graph.nodes
    return mergeDutyFacts(summaries, nodes, language)
  }

  /**
   * The scanned workspace graph (read-only cache; null when no rescan has
   * built facts yet). Facts are established by refresh() (重新扫描).
   * @returns graph, null when no disk cache, or an error.
   */
  @Remote('graph')
  async remoteGraph(): Promise<ArchLensGraph | null | { error: string }> {
    return this.graph()
  }

  /**
   * Rescan = REBUILD EVERY fact source (the ONLY place facts are built):
   * invalidate the scan graph, re-index the code-index, invalidate the AI
   * caches, then scan the workspace and persist a fresh graph (new
   * generatedAt = new facts version). Opening the panel / switching tabs
   * NEVER scans — they read caches only.
   * Layer-1 change detection: when the file manifest shows NO file changed
   * since the last rescan, every cache is still valid and the rebuild is
   * skipped entirely — the existing graph is returned as-is.
   * @returns the fresh scan graph (or null when none exists yet) plus
   *   whether a rebuild actually ran.
   */
  @Remote('refresh')
  async remoteRefresh(): Promise<
    | { graph: ArchLensGraph; changed: true; changes: WorkspaceChanges }
    | { graph: ArchLensGraph | null; changed: false; changes: null }
    | { error: string }
  > {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const fileChanges: WorkspaceFileChanges = await checkWorkspaceChanges(this.ctx.fs, root, this.sessionPolicy())
    if (!fileChanges.changed) {
      // No fact source moved: caches (scan graph, code-index, AI figures) are
      // all still valid — serve the existing graph, skip the rebuild.
      const graph = await this.graph()
      if (graph === null) return { graph: null, changed: false, changes: null }
      if ('error' in graph) return graph
      // Crash-residue self-heal: files moved nothing (so the rebuild is
      // skipped) but the index envelope may still be blank from a refresh
      // that died between invalidation and rebuild — without this, the
      // READ-ONLY call graph would tell the user to rescan forever, and a
      // rescan is exactly the path that skips itself out of existence here.
      await this.ensureIndexEnvelope(root)
      return { graph, changed: false, changes: null }
    }
    // Snapshot the OLD package ids BEFORE clearing the in-memory graph (used
    // to compute added/removed packages against the fresh scan).
    const oldGraph = await this.graph()
    const oldIds = oldGraph !== null && !('error' in oldGraph) ? oldGraph.nodes.map(node => node.id) : []
    // 只读模式预检：重建要写 graph + 失效缓存，只读时全部会被拒——先拒绝。
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `refresh: ${blocked}` }
    this.graphCaches.clear()
    this.graphInFlight = null
    // Mark the persisted scan graph invalid: the rescan below overwrites it,
    // and a failed rescan must not resurrect stale data on the next open.
    try {
      const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root })
      await this.ctx.fs.writeText(target, JSON.stringify({ root, invalidated: true, generatedAt: Date.now() }), undefined, undefined, this.sessionPolicy())
    } catch {
      // non-fatal
    }
    await this.refreshCodeIndex()
    await this.removeAICaches()
    // Explicitly build facts: scan the workspace, persist the fresh graph
    // (new facts version) and serve it.
    const scanned = await scanWorkspace(this.ctx.fs, root)
    if ('error' in scanned) return scanned
    const changes = computeChangedPackages(fileChanges, oldIds, scanned.nodes.map(node => node.id))
    const newVersion = await this.writeGraphDisk(root, scanned)
    // Selective invalidation: only figures whose deps intersect the changed
    // packages are invalidated; unaffected figures get their version
    // re-stamped to the new facts version and keep serving. newVersion===0
    // (write failure) makes every re-stamped cache unmatchable — safe.
    await selectiveInvalidate(
      this.ctx.fs,
      root,
      new Set(changes.changedPackages),
      newVersion,
      this.sessionPolicy(),
    )
    // Tombstone sweep: physically remove legacy cache files no current reader
    // can serve (unversioned leftovers from older naming eras) — invalidation
    // only re-stamps, and named deletes never reach them.
    const swept = await sweepLegacyCaches(this.ctx.fs, root)
    if (swept.length > 0) console.log(`[arch-lens] refresh: swept ${swept.length} legacy cache file(s): ${swept.join(', ')}`)
    // 重扫契约「所有事实源一次建齐」：provider 的 refresh 只把索引文件清空作失效，
    // 重建+戳版本只发生在 indexWorkspace 里——而 callGraph 这类纯读路径按设计
    // 不触发重建。不在此立刻以新 factsVersion（writeGraphDisk 之后才成立，早一行
    // 拿到的还是失效标记的旧版本）重建，调用关系图就会在每次真实重扫后卡死在
    // 「与当前事实版本不一致」。
    await this.ensureIndexEnvelope(root)
    this.graphCaches.set(root, scanned)
    return { graph: scanned, changed: true, changes }
  }

  /**
   * Refresh only the code-index facts (in-memory + disk invalidated). Used by
   * "refresh this figure": the figure then re-derives from a fresh index.
   * @returns acknowledgement.
   */
  @Remote('refreshIndex')
  async remoteRefreshIndex(): Promise<{ ok: true } | { error: string }> {
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `refresh index: ${blocked}` }
    await this.refreshCodeIndex()
    return { ok: true }
  }

  /**
   * 「全量重建」: regenerate AI figures from the CURRENT facts. 智能增量
   * (incremental=true, 前端「全量重建」/「变动更新」按钮的默认路径)：每张
   * 实体级图先检查缓存是否失效（v ≠ 当前 factsVersion 或缺失），失效才
   * force=true 重绘，未失效直接跳过——重新扫描已做精确失效，所以这里只补
   * 涉及变动包的图；全部有效时零 LLM、秒回。incremental=false 保持旧语义
   * （无条件全部重绘）。方法级（-methods）不在此路径（按需生成）。
   * @param request - role language + 是否智能增量。
   * @returns rebuilt/skipped 图清单，或第一个生成错误（所有步骤都跑）。
   */
  @Remote('generateAll')
  async remoteGenerateAll(request: { language?: string; incremental?: boolean }): Promise<{ ok: true; rebuilt: string[]; skipped: string[] } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const graph = await this.requireGraph()
    if ('error' in graph) return graph
    const language = request.language ?? '中文'
    // 只读模式预检：LLM 前先拒绝，避免"生成完但缓存写不进"。
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `generateAll: ${blocked}` }
    let index: CodeIndexResult
    try {
      index = await this.indexWorkspaceShared(root)
    } catch (error) {
      return { error: `codeIndex unavailable: ${error instanceof Error ? error.message : String(error)}` }
    }
    const policy = this.sessionPolicy()
    const fs = this.ctx.fs
    const incremental = request.incremental === true
    // 图清单与缓存文件名一律来自 figures.ts 注册表（单一来源）：旧版在这里
    // 手拼 `${base}-${lang}.json`，flow 的真实文件名（语言+视角）永远拼不中，
    // 增量模式被判定为“缺失”而每次 force 重画——注册表结构性修复该漏洞。
    const outcome = await runEntityFigurePass(
      { ctx: this.ctx, fs, root, index, graph, language, policy },
      incremental,
    )
    if (outcome.errors.length > 0) return { error: `generateAll: ${outcome.errors.join('; ')}` }
    return { ok: true, rebuilt: outcome.rebuilt, skipped: outcome.skipped }
  }

  /**
   * Point the desk's data source at one session's workspace. This is the
   * official wire name (kept for harness-contract compatibility) but its
   * SEMANTICS are "load, never invalidate": only the target session id is
   * set and no cache is touched. The scan cache is keyed by workspace root,
   * so re-loading the same workspace (reopening the panel, switching between
   * its sessions) is instant, while a different workspace rescans
   * automatically on the next graph() call. Explicit invalidation stays
   * exclusively on refresh().
   * @param sessionId - target session id, or null for the policy root.
   * @returns acknowledgement.
   */
  @Remote('setSession')
  async remoteSetSession(sessionId: string | null): Promise<{ ok: true }> {
    this.targetSessionId = sessionId
    // Session bind is the first moment resolveRoot() can point at the REAL
    // workspace — adopt the persisted ledger here (once), not at init.
    await this.adoptLlmStats()
    return { ok: true }
  }

  /**
   * Fold the workspace's persisted LLM ledger (`index/.arch-lens-llm-stats.json`)
   * into the running accounting. The disk file is treated as the historical
   * ledger and adoption is once-per-process (llmStatsAdopted gate), so this
   * is safe to call from every entry point that runs before the first write.
   */
  private async adoptLlmStats(): Promise<void> {
    if (llmStatsAdopted()) return
    const root = this.resolveRoot()
    if (typeof root !== 'string') return
    try {
      const target = await this.ctx.fs.resolve(`${CACHE_DIR}/.arch-lens-llm-stats.json`, { cwd: root })
      const info = await this.ctx.fs.stat(target)
      if (info === undefined || info.type !== 'file') return
      const text = await this.ctx.fs.readText(target)
      hydrateLlmStats(JSON.parse(text) as LlmStatsSnapshot)
    } catch {
      // no persisted ledger yet — start clean
    }
  }

  /** Invalidate the code-index for the workspace (no-op when unavailable). */
  private async refreshCodeIndex(): Promise<void> {
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return
    const root = this.resolveRoot()
    if (typeof root !== 'string') return
    try {
      await codeIndex.refresh(root, this.sessionPolicy())
    } catch (error) {
      console.warn(`[arch-lens] code-index refresh failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Ensure the on-disk code-index envelope is valid against the CURRENT facts
   * version, rebuilding through the shared loader when it is not (blanked by
   * provider.refresh, stale, or lost to a crashed rescan).
   *
   * Best-effort AND time-boxed: a full-workspace parse can run for minutes on
   * a large monorepo, far beyond the rescan RPC budget, so the shared loader
   * is started (or joined if already in flight) and awaited only up to a cap.
   * Small workspaces finish inline so the call graph opens on the first try;
   * big ones keep building in the background — the in-flight promise survives
   * on `indexInFlight`, writes the envelope when done, and later reads serve
   * from it. A rebuild failure never fails the caller's rescan: the graph
   * facts are already established and the affected tabs keep their rescan hint.
   * @param root - workspace root.
   */
  private async ensureIndexEnvelope(root: string): Promise<void> {
    const facts = await readIndexFacts(this.ctx.fs, root)
    if (!('error' in facts)) return
    const rebuild = this.indexWorkspaceShared(root).then(
      () => undefined,
      (error: unknown) => {
        console.warn(`[arch-lens] refresh: code index rebuild failed: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
    const outcome = await Promise.race([
      rebuild.then(() => 'done' as const),
      new Promise<'pending'>((resolve) => {
        const timer = setTimeout(() => resolve('pending'), INDEX_ENVELOPE_TIMEBOX_MS)
        timer.unref?.()
      }),
    ])
    if (outcome === 'pending') {
      console.log('[arch-lens] refresh: code index rebuild continues in background (large workspace)')
    }
  }

  /**
   * Invalidate AI figure caches (concept tree / sequence / events / flow /
   * core / analysis). Since the versioned-cache change the DISK copies are
   * NOT touched: a rescan rebuilds the scan graph with a fresh generatedAt
   * (facts version), and every figure cache records the version it was
   * generated against — readers refuse a mismatched version and regenerate.
   * Physical clearing was the cause of "reopening the panel is slow": it
   * threw away caches that were still valid across page reloads.
   */
  private async removeAICaches(): Promise<void> {
    // The shared analysis profile's single-flight memory must not serve an
    // old profile after a rescan (the disk copy stays; its version check
    // refuses it — the memory cache would bypass that check).
    clearAnalysisProfileCache()
  }

  /**
   * Detail projection for one package. The graph carries precomputed details,
   * so this is a plain lookup (kept as a Remote for compatibility).
   * @param request - package id.
   * @returns detail or error.
   */
  @Remote('component')
  async remoteComponent(request: { id: string }): Promise<ArchLensComponentDetail | { error: string }> {
    const graph = await this.requireGraph()
    if ('error' in graph) return graph
    const node = graph.nodes.find(candidate => candidate.id === request.id)
    if (node === undefined) return { error: `unknown component: ${request.id}` }
    return node.detail
  }

  /**
   * The note file listing, newest first.
   * @returns notes listing or an error.
   */
  @Remote('notes')
  async remoteNotes(): Promise<ArchLensNotesResult | { error: string }> {
    if (NOTES_FEATURE_OFF) return { error: '笔记功能已暂时下线：讲解记录 = 当前会话历史（含图，比笔记文件完整）' }
    const root = this.resolveRoot()
    if (typeof root !== 'string') return { path: this.notesFile, entries: [] }
    return readNotes(this.ctx.fs, root, this.notesFile)
  }

  /**
   * Mermaid dependency flowchart for the scanned graph.
   * @returns flowchart source or an error.
   */
  @Remote('mermaidDeps')
  async remoteMermaidDeps(): Promise<{ kind: 'flowchart'; source: string } | { error: string }> {
    const graph = await this.requireGraph()
    if ('error' in graph) return graph
    return { kind: 'flowchart', source: dependencyFlowchart(graph) }
  }

  /**
   * Mermaid ER diagram of package relationships for the scanned graph.
   * @returns erDiagram source or an error.
   */
  @Remote('mermaidEr')
  async remoteMermaidEr(): Promise<{ kind: 'erDiagram'; source: string } | { error: string }> {
    const graph = await this.requireGraph()
    if ('error' in graph) return graph
    return { kind: 'erDiagram', source: packageErDiagram(graph) }
  }

  /**
   * Mermaid diagrams over the code-index imports: source-level dependency
   * edges (real imports) instead of npm peerDependencies. Falls back to the
   * scanned-graph variants when the codeIndex service or a language is absent.
   * @param request - diagram kind.
   * @returns mermaid source or an error.
   */
  @Remote('mermaidIndexed')
  async remoteMermaidIndexed(request: { kind: 'flowchart' | 'erDiagram' }): Promise<{ kind: 'flowchart' | 'erDiagram'; source: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.ctx.get('codeIndex') as { indexWorkspace(root: string, policy?: SandboxExecutionPolicy): Promise<CodeIndexResult> } | undefined
    if (codeIndex === undefined) {
      return { error: 'codeIndex service unavailable' }
    }
    try {
      const index = await this.indexWorkspaceShared(root)
      if (index.language === 'unknown') return { error: 'unsupported workspace language (no package.json / pyproject.toml / pom.xml)' }
      return request.kind === 'flowchart'
        ? { kind: 'flowchart', source: importFlowchart(index) }
        : { kind: 'erDiagram', source: entityErDiagram(index) }
    } catch (error) {
      return { error: `indexed mermaid failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * 「调用关系图」真实数据源 — READ ONLY: the real cross-package import
   * reference edges from the versioned code-index disk cache (facts written
   * by 「↻ 重新扫描」 only, never by AI; version binding lives in
   * `readIndexFacts`). Pure cache read: no index-service call, no LLM. Edges
   * are returned in message shape so the client renders them with the same
   * call-graph view.
   * @param request - role language for edge labels.
   * @returns package-level edges, or an error telling the user to rescan first.
   */
  @Remote('callGraph')
  async remoteCallGraph(request: { language?: string }): Promise<{ ok: true; edges: Array<{ from: string; to: string; label: string }> } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      const facts = await readIndexFacts(this.ctx.fs, root)
      if ('error' in facts) return facts
      const edges = importEdges(facts.index)
      const verb = request.language === 'English' ? 'references' : '引用'
      const messages: Array<{ from: string; to: string; label: string }> = []
      for (const [from, tos] of edges) {
        for (const to of tos) messages.push({ from, to, label: `${verb} ${to}` })
      }
      if (messages.length === 0) return { error: '工作区没有跨包 import 引用边' }
      return { ok: true, edges: messages }
    } catch (error) {
      return { error: `读取代码索引失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Core-flow diagram (deps/ER overview) — READ ONLY: built from the cached
   * core selection + the scanned graph; null when no core cache exists.
   * Generation (LLM selection) is WRITE-path only (「🤖 AI 生成」 /
   * regenerateFigure). Never walks the code index.
   * @param request - diagram kind, role language.
   * @returns mermaid source and core selection, null, or an error.
   */
  @Remote('mermaidCore')
  async remoteMermaidCore(request: { kind: 'flowchart' | 'erDiagram'; language?: string; methodLevel?: boolean }): Promise<{ kind: 'flowchart' | 'erDiagram'; source: string; core: ArchLensCoreGraph } | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      const core = await readCore(this.ctx.fs, root, request.language ?? '中文', request.methodLevel === true)
      if (core === null) return null
      const graph = await this.requireGraph()
      if ('error' in graph) return graph
      const source = request.kind === 'flowchart'
        ? coreFlowchartFromGraph(graph, core.ids)
        : coreErDiagramFromGraph(graph, core.ids)
      return { kind: request.kind, source, core }
    } catch (error) {
      return { error: `core diagram failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * 架构概览 (rule-built) — READ ONLY (D2): built from the cached core
   * selection + the scanned graph; null when no core cache exists. There is
   * NO rule fallback on read — facts appear only after a rescan plus the
   * user's generate action (「🤖 AI 生成」 / regenerateFigure writes the core
   * cache). Never walks the code index.
   * @param request - role language.
   * @returns the overview mermaid + core selection, null, or an error.
   */
  @Remote('overviewFigure')
  async remoteOverviewFigure(request: { language?: string }): Promise<{ title: string; mermaid: string; core: ArchLensCoreGraph } | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      const language = request.language ?? '中文'
      const core = await readCore(this.ctx.fs, root, language, false)
      if (core === null) return null
      const graph = await this.requireGraph()
      if ('error' in graph) return graph
      const blurbOf = (id: string): string => {
        const node = graph.nodes.find(candidate => candidate.id === id)
        if (node === undefined) return ''
        return language === 'English' ? node.blurb : (node.blurbZh ?? node.blurb)
      }
      return { title: '架构概览', mermaid: overviewFigureFromGraph(graph, core.ids, blurbOf), core }
    } catch (error) {
      return { error: `overview figure failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Shared codeIndex accessor for the concept/docs remotes. The optional
   * third `factsVersion` argument binds the provider's disk cache to the
   * single change anchor (see indexWorkspaceShared). */
  private codeIndexService(): { indexWorkspace(root: string, policy?: SandboxExecutionPolicy, factsVersion?: number): Promise<CodeIndexResult>; refresh(root: string, policy?: SandboxExecutionPolicy): Promise<void> } | undefined {
    return this.ctx.get('codeIndex') as { indexWorkspace(root: string, policy?: SandboxExecutionPolicy, factsVersion?: number): Promise<CodeIndexResult>; refresh(root: string, policy?: SandboxExecutionPolicy): Promise<void> } | undefined
  }

  /**
   * Session-scoped sandbox policy for every file write: the fs sandbox
   * derives its workspace-write containment root from the calling session's
   * cwd — the same root this service writes to — so passing it approves the
   * writes.
   */
  private sessionPolicy(): SandboxExecutionPolicy {
    return resolveSessionPolicy(this.ctx, this.targetSessionId)
  }

  /**
   * Pre-flight write check for the LLM-generating write paths (generateAll,
   * AI 生成, 追问重画, 文档, rescan rebuild): when the session sandbox is
   * read-only every cache write would be denied — refusing BEFORE the (often
   * minutes-long) LLM passes saves the user from "生成跑完了但一个缓存都没写
   * 进去" (the symptom reported from a read-only generateAll). Callers return
   * the message as their error result.
   * @returns an error message when writes are impossible, null when OK.
   */
  private ensureWritable(): string | null {
    const policy = this.sessionPolicy()
    if (policy.mode === 'read-only') {
      return '会话为只读模式，无法写入图缓存（生成结果无处落盘）：请将文件策略切换为「可写」后再试。本次未执行 AI 生成。'
    }
    return null
  }

  /**
   * Concept hierarchy — READ ONLY: serve the versioned cache; null when
   * absent/stale. Generation (doc extraction / LLM induction / cache write)
   * happens ONLY through the write paths (「🤖 AI 生成」 figurePrompt /
   * regenerateFigure). Opening the panel or switching tabs never generates.
   * @param request - role language and method-level cache variant.
   * @returns concept-tree nodes, null when no matching cache, or an error.
   */
  @Remote('conceptTree')
  async remoteConceptTree(request: { language?: string; methodLevel?: boolean }): Promise<ArchLensConceptNode[] | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      return await readConceptTree(this.ctx.fs, root, request.language ?? '中文', request.methodLevel === true)
    } catch (error) {
      return { error: `concept tree read failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Generate the complete architecture doc (global button) — 阶段 4 组装链
   * (D8)：文档正文【零 LLM】，全部章节由图缓存渲染；某节对应图缺失/过期时，
   * 先经该图自己的构建链补建（缓存→文档→档案→LLM，统一写路径回缓存），再
   * 组装。文档不再反哺任何图缓存（旧"文档后补写/重建概念树"回灌已删）。
   * @param request - role language.
   * @returns the doc path or an error.
   */
  @Remote('generateDocs')
  async remoteGenerateDocs(request: { language?: string }): Promise<{ path: string } | { error: string }> {
    if (DOCS_FEATURE_OFF) return { error: '一键生成文档已暂时下线（重做方向参照 DSH：docs=仓库资产、agent 会话轮撰写），图缓存与读路径不受影响' }
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `generate docs: ${blocked}` }
    // 后端锁：同一工作区的一次完整文档生成进行中时，后续调用共享同一个
    // promise（补建链只执行一次），而不是各自重新跑组装。
    const inFlight = this.docInFlight
    if (inFlight !== null && inFlight.root === root) return inFlight.promise
    const promise = (async (): Promise<{ path: string } | { error: string }> => {
      try {
        const codeIndex = this.codeIndexService()
        if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
        const graph = await this.requireGraph()
        if ('error' in graph) return graph
        const index = await this.indexWorkspaceShared(root)
        const result = await generateDocsFromFigures(this.ctx, this.ctx.fs, root, index, graph, request.language ?? '中文', this.sessionPolicy())
        if ('error' in result) return result
        for (const failure of result.errors) console.warn(`[arch-lens] doc assembly section skipped: ${failure}`)
        return { path: result.path }
      } catch (error) {
        return { error: `generate docs failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    })().finally(() => {
      if (this.docInFlight?.root === root) this.docInFlight = null
    })
    this.docInFlight = { root, promise }
    return promise
  }

  /**
   * Regenerate one doc section on demand (per-tab "AI 生成") — 组装链单节版：
   * 该节的图走注册表缓存/构建链，正文渲染零 LLM，merge 进生成文档的对应
   * `## 标题` 节。
   * @param request - section kind and role language.
   * @returns the doc path or an error.
   */
  @Remote('generateDocSection')
  async remoteGenerateDocSection(request: { kind: DocKind; language?: string }): Promise<{ path: string } | { error: string }> {
    if (DOCS_FEATURE_OFF) return { error: '按节生成文档已暂时下线（与「一键生成文档」同批）' }
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `generate doc section: ${blocked}` }
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const graph = await this.requireGraph()
      if ('error' in graph) return graph
      const index = await this.indexWorkspaceShared(root)
      return await generateDocSection(this.ctx, this.ctx.fs, root, index, graph, request.language ?? '中文', request.kind, this.sessionPolicy())
    } catch (error) {
      return { error: `generate doc section failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Structured figure data for the sequence tab — READ ONLY: serve the
   * versioned cache; null when absent/stale. The static call-graph, doc
   * extraction and LLM induction stages are WRITE-path only (「🤖 AI 生成」 /
   * regenerateFigure). Opening the panel or switching tabs never generates.
   * The client renders an empty state on null.
   * @param request - role language and method-level cache variant.
   * @returns the cached figure, null, or an error.
   */
  @Remote('sequence')
  async remoteSequence(request: { language?: string; methodLevel?: boolean }): Promise<ArchLensSequenceResult | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      return await readSequence(this.ctx.fs, root, request.language ?? '中文', request.methodLevel === true)
    } catch (error) {
      return { error: `sequence read failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Per-tab "AI generate" (分离方案): regenerate ONE shared-profile field
   * with one trimmed-summary LLM call and return the fresh figure data. The
   * profile is updated in memory and on disk; other figures are untouched
   * (except core regeneration, which invalidates flow/seq/events — see
   * analysis.ts). The client renders the returned data directly, so a
   * per-tab generate never rewrites docs/architecture.generated.md.
   * @param request - figure kind and role language.
   * @returns the regenerated field, or an error.
   */
  @Remote('regenerateFigure')
  async remoteRegenerateFigure(request: { kind: 'concepts' | 'seq' | 'flow' | 'interaction' | 'deps' | 'er'; language?: string; methodLevel?: boolean }): Promise<RegenerateFigureResult | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `regenerate figure: ${blocked}` }
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await this.indexWorkspaceShared(root)
      const language = request.language ?? '中文'
      const methods = request.methodLevel === true
      // 🔬 方法级: this figure regenerates from the method-level summary with
      // its OWN LLM call — the shared profile (entity-level) is untouched, so
      // other tabs keep their cheap entity-level facts.
      if (methods) {
        return await this.regenerateFigureMethodLevel(request.kind, index, language)
      }
      const kind = request.kind === 'concepts' ? 'concept'
        : request.kind === 'deps' || request.kind === 'er' ? 'core'
          : request.kind === 'interaction' ? 'events'
            : request.kind
      const profile = await regenerateProfileField(this.ctx, this.ctx.fs, root, index, language, kind, this.sessionPolicy())
      // 同步落各图版本化缓存：profile 已更新，但读侧 remote（readConceptTree /
      // readFlow / readSequence / events / readCore）只认各图独立缓存文件——
      // 不写的话重开/重拉会 miss（画不出来）。writeFigureCache 已版本化。
      const writeFigure = async (figureKind: SessionFigureKind, parsed: Record<string, unknown>, angle?: FlowAngle): Promise<void> => {
        try {
          await writeFigureCache(this.ctx.fs, root, index, figureKind, parsed, language, angle, methods, this.sessionPolicy())
        } catch (error) {
          console.warn(`[arch-lens] regenerate cache write failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      switch (request.kind) {
        case 'concepts': {
          const tree = profile.conceptTree
          if (tree === undefined || tree.length === 0) return { error: 'concept regeneration produced no tree' }
          void writeFigure('concepts', { conceptTree: tree })
          return { kind: 'concepts', tree }
        }
        case 'seq': {
          const messages = profile.seqMessages
          if (messages === undefined || messages.length === 0) return { error: 'seq regeneration produced no messages' }
          void writeFigure('seq', { seqMessages: messages })
          return { kind: 'seq', messages }
        }
        case 'flow': {
          // Both viewpoints come back in one response — the client renders
          // whichever angle is selected without another LLM call.
          if (profile.flow === undefined || Object.keys(profile.flow).length === 0) {
            return { error: 'flow regeneration produced no diagram' }
          }
          const flows: Partial<Record<FlowAngle, ArchLensFlowResult>> = {}
          for (const [angle, flow] of Object.entries(profile.flow) as Array<[FlowAngle, AnalysisFlow]>) {
            flows[angle] = { title: flow.title, source: 'flow' as const, angle, mermaid: sanitizeMermaid(flow.mermaid) }
            void writeFigure('flow', { title: flow.title, mermaid: flow.mermaid }, angle)
          }
          return { kind: 'flow', flows }
        }
        case 'interaction': {
          const events = profile.events
          if (events === undefined || events.length === 0) return { error: 'events regeneration produced no events' }
          void writeFigure('interaction', { events })
          return { kind: 'interaction', events }
        }
        default: {
          if (profile.coreIds.length < 4) return { error: 'core regeneration produced too few packages' }
          void writeFigure('core', { core: profile.coreIds })
          return { kind: 'core', core: { ids: profile.coreIds, source: 'flow' } }
        }
      }
    } catch (error) {
      return { error: `regenerate figure failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * 🔬 方法级 field regeneration: one method-summary LLM call for the figure,
   * independent of the shared (entity-level) profile. Results are written to
   * the method-level caches so a later read with the switch on reuses them.
   * @param kind - the wire figure kind (concepts/seq/flow/interaction/deps/er).
   * @param index - code index result.
   * @param language - role language.
   * @returns the regenerated field, or an error.
   */
  private async regenerateFigureMethodLevel(
    kind: 'concepts' | 'seq' | 'flow' | 'interaction' | 'deps' | 'er',
    index: CodeIndexResult,
    language: string,
  ): Promise<RegenerateFigureResult | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      switch (kind) {
        case 'concepts': {
          const tree = await generateFromFlow(this.ctx, index, language, generationSignal(root), true)
          if (tree.length === 0) return { error: 'concept method-level generation produced no tree' }
          return { kind: 'concepts', tree }
        }
        case 'seq': {
          const generated = await writeStructuredCache(this.ctx, this.ctx.fs, root, index, language, 'seq', this.sessionPolicy(), true)
          if (!Array.isArray(generated) || generated.length === 0) return { error: 'seq method-level generation produced no messages' }
          return { kind: 'seq', messages: generated as ArchLensSequenceMessage[] }
        }
        case 'flow': {
          // Both viewpoints regenerate with the method-level summary (each
          // its own LLM call) so the angle switch stays instant afterwards.
          const flows: Partial<Record<FlowAngle, ArchLensFlowResult>> = {}
          for (const angle of ['event', 'pipeline'] as FlowAngle[]) {
            const flow = await flowDiagram(this.ctx, this.ctx.fs, root, index, language, true, angle, this.sessionPolicy(), true)
            if (!('error' in flow)) flows[angle] = flow
          }
          if (Object.keys(flows).length === 0) return { error: 'flow method-level generation produced no diagram' }
          return { kind: 'flow', flows }
        }
        case 'interaction': {
          const generated = await writeStructuredCache(this.ctx, this.ctx.fs, root, index, language, 'interaction', this.sessionPolicy(), true)
          if (!Array.isArray(generated) || generated.length === 0) return { error: 'events method-level generation produced no events' }
          return { kind: 'interaction', events: generated as ArchLensEventRow[] }
        }
        default: {
          const core = await coreGraph(this.ctx, this.ctx.fs, root, index, language, true, this.sessionPolicy(), true)
          if ('error' in core) return { error: core.error }
          return { kind: 'core', core: { ids: core.ids, source: core.source } }
        }
      }
    } catch (error) {
      return { error: `method-level regenerate failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * The latest assistant answer of the target session: visible text plus the
   * reasoning chain (thinking blocks). The panel shows the model's thinking
   * for the last explanation — the reasoning stays in the session message
   * (host-side projection), the client only renders a copy.
   * @param request - optional session id (defaults to the target session).
   * @returns the last assistant message's text/reasoning, or an error.
   */
  @Remote('lastAnswer')
  async remoteLastAnswer(request: { sessionId?: string }): Promise<{ text: string; reasoning: string } | { error: string }> {
    const sessionId = request.sessionId ?? this.targetSessionId
    if (sessionId === null) return { error: 'no target session' }
    const session = this.ctx.get('sessions')?.get(sessionId as SessionId)
    if (session === undefined) return { error: 'session not found' }
    try {
      const messages = session.deriveMessages()
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message === undefined || message.role !== 'assistant') continue
        let text = ''
        let reasoning = ''
        for (const block of message.content) {
          if (block.type === 'text') text += block.text
          else if (block.type === 'reasoning') reasoning += block.text
        }
        if (text.trim() !== '' || reasoning.trim() !== '') return { text, reasoning }
      }
      return { text: '', reasoning: '' }
    } catch (error) {
      return { error: `lastAnswer failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Live generation status of the workspace (⚙️ 生成过程 box): what the LLM
   * is currently doing — stage label, elapsed time, streamed output preview
   * (reasoning tail while thinking). Polled by the panel while a generation
   * is suspected in flight; null when nothing was generated yet.
   * @returns the live status, or null.
   */
  @Remote('generationStatus')
  async remoteGenerationStatus(): Promise<GenerationStatus | null> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return null
    return currentGenerationStatus(root)
  }

  /**
   * LONG-POLL push of the live generation status: resolves when the status
   * seq differs from `since` (a change just happened — throttled to a smooth
   * cadence), or after ~20s with the current snapshot (the panel re-issues
   * immediately). One in-flight request at a time delivers the generation
   * process with SSE-like latency over the regular RPC channel.
   * @param request - the client's last seen seq.
   * @returns the current status snapshot, or null when nothing was generated.
   */
  @Remote('generationStatusNext')
  async remoteGenerationStatusNext(request: { since?: number }): Promise<{ status: GenerationStatus; seq: number } | null> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return null
    return await waitForGenerationStatus(root, request.since ?? 0)
  }

  /**
   * Build the session message that asks the agent to produce ONE figure
   * (「图生成走会话」): the prompt embeds the code facts; the CLIENT sends it
   * into the current session, so the GUI's own conversation stream shows the
   * agent working in real time. This RPC stages a pendingFigure (matched by
   * figId) and returns immediately — the figure lands in the cache when the
   * agent answers, and the panel refetches it after the turn completes.
   * @param request - figure kind, role language, flow angle, 🔬 method level.
   * @returns the figId + prompt to send, or an error.
   */
  @Remote('figurePrompt')
  async remoteFigurePrompt(request: {
    kind: 'concepts' | 'seq' | 'flow' | 'interaction' | 'deps' | 'er'
    language?: string
    angle?: FlowAngle
    methodLevel?: boolean
  }): Promise<{ figId: string; prompt: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `figure prompt: ${blocked}` }
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await this.indexWorkspaceShared(root)
      const language = request.language ?? '中文'
      const kind: SessionFigureKind = request.kind === 'deps' || request.kind === 'er'
        ? 'core'
        : request.kind === 'interaction' ? 'interaction'
          : request.kind
      const angle = request.kind === 'flow' ? request.angle ?? 'event' : undefined
      const methodLevel = request.methodLevel === true
      const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const prompt = buildFigurePrompt(kind, index, language, figId, angle, methodLevel)
      const usageStart = this.sessionUsageSnapshot(this.targetSessionId)
      this.pendingFigure = {
        figId,
        kind,
        language,
        ...(angle !== undefined ? { angle } : {}),
        methodLevel,
        sessionId: this.targetSessionId,
        stagedAt: Date.now(),
        ...(usageStart !== undefined ? { usageStart } : {}),
        index,
      }
      // One-shot staging: clear after 30 minutes even if the agent never
      // answers (a later ordinary chat reply must not be misparsed — the
      // figId match is the real gate; the TTL is only defensive cleanup,
      // and it must outlast a slow agent turn in the session).
      setTimeout(() => {
        if (this.pendingFigure?.figId === figId) this.pendingFigure = null
      }, 30 * 60 * 1000)
      return { figId, prompt }
    } catch (error) {
      return { error: `figure prompt failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Build the session message that asks the agent to draw ONE DYNAMIC detail
   * figure (「动态画图」hover drill-down): a sequence-edge drill-down (the two
   * packages' method-level call sequence) or a flow-subgraph expansion (that
   * stage as a detailed flowchart). Same session-turn contract as figurePrompt
   * — the answer is matched by figId and written to a per-target cache file
   * (`index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`), so a generated detail
   * opens instantly on the next hover without re-generating.
   * @param request - dynamic kind, hover target, role language, and for
   *   flow-subgraph the current diagram source (context.mermaid).
   * @returns the figId + prompt to send, or an error.
   */
  @Remote('dynamicFigurePrompt')
  async remoteDynamicFigurePrompt(request: {
    kind: 'seq-edge' | 'flow-subgraph' | 'overview'
    target: { from?: string; to?: string; label?: string; stage?: string }
    language?: string
    context?: { mermaid?: string }
  }): Promise<{ figId: string; prompt: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `dynamic figure prompt: ${blocked}` }
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await this.indexWorkspaceShared(root)
      const language = request.language ?? '中文'
      const kind: DynamicFigureKind = request.kind === 'seq-edge' ? 'seq-edge' : request.kind === 'overview' ? 'overview' : 'flow-subgraph'
      const targetKey = dynamicTargetKey(kind, request.target)
      const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      // 同族下钻增量复用: a re-drill on the SAME target reuses the cached
      // figure as prompt context so the LLM extends/redraws details instead of
      // starting from scratch (a forced regenerate keeps the family coherent).
      const existing = await this.readDynamicFigureFromDisk(root, kind, targetKey, language)
      // 职责段只被总览链消费（seq-edge/flow-subgraph 不读盘，保持轻）；
      // 职责事实 host 侧从磁盘自取（dutyFactsForFigure），不经客户端。
      const duties = kind === 'overview'
        ? await this.dutyFactsForFigure(root, language)
        : undefined
      const prompt = buildDynamicFigurePrompt(kind, index, language, figId, request.target, request.context?.mermaid, duties, existing ?? undefined)
      const usageStart = this.sessionUsageSnapshot(this.targetSessionId)
      this.pendingFigure = {
        figId,
        kind,
        language,
        sessionId: this.targetSessionId,
        stagedAt: Date.now(),
        ...(usageStart !== undefined ? { usageStart } : {}),
        index,
        dynamic: { kind, targetKey },
      }
      setTimeout(() => {
        if (this.pendingFigure?.figId === figId) this.pendingFigure = null
      }, 30 * 60 * 1000)
      return { figId, prompt }
    } catch (error) {
      return { error: `dynamic figure prompt failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Read one cached dynamic figure (`index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`),
   * or null when absent / unreadable / stale (version-bound read, D1: an
   * invalidated or outdated drill-down must NOT be served — the client's hover
   * then re-triggers generation; legacy unversioned files read as null too).
   * Shared by the read RPC and the re-drill prompt builder (same-family
   * incremental reuse). */
  private async readDynamicFigureFromDisk(root: string, kind: DynamicFigureKind, targetKey: string, language: string): Promise<{ title: string; diagram: string; summary: string } | null> {
    try {
      const target = await this.ctx.fs.resolve(dynamicFigureCacheName(kind, targetKey, language), { cwd: root })
      const factsVersion = await readFactVersion(this.ctx.fs, root)
      const parsed = await readVersionedCache<{ title?: unknown; diagram?: unknown; summary?: unknown }>(this.ctx.fs, target, factsVersion)
      if (parsed === null || typeof parsed.diagram !== 'string' || parsed.diagram === '') return null
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        diagram: parsed.diagram,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      }
    } catch {
      return null
    }
  }

  /**
   * Read one cached dynamic figure (`index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`).
   * The panel calls this after the turn completes (and on every later hover)
   * so a generated detail opens instantly without re-generating.
   * @param request - dynamic kind, target key, role language.
   * @returns the cached diagram, or null when absent.
   */
  @Remote('dynamicFigure')
  async remoteDynamicFigure(request: { kind: 'seq-edge' | 'flow-subgraph' | 'overview'; targetKey: string; language?: string }): Promise<{ title: string; diagram: string; kind: 'seq-edge' | 'flow-subgraph' | 'overview'; targetKey: string } | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const kind: DynamicFigureKind = request.kind === 'seq-edge' ? 'seq-edge' : request.kind === 'overview' ? 'overview' : 'flow-subgraph'
    const language = request.language ?? '中文'
    const cached = await this.readDynamicFigureFromDisk(root, kind, request.targetKey, language)
    if (cached === null) return null
    return {
      title: cached.title,
      diagram: cached.diagram,
      kind,
      targetKey: request.targetKey,
    }
  }

  /**
   * L2.5 渲染即校验：the browser's version-matched mermaid is the ONLY syntax
   * authority (the host has no DOM — a mermaid import there dies on DOMPurify;
   * nothing here may ever stamp a figure "valid"). Drill-down figures are
   * auto-persisted at capture, so a syntax-broken diagram the sanitizer
   * could not safely repair would otherwise fail EVERY later hover forever:
   * syntax rot is independent of the fact version the cache is bound to.
   * The panel reports the first render failure and this deletes that disk
   * cache (unlink, same removal precedent as customFigureDelete) — the next
   * hover honestly reads the empty state and regenerates. Zero-LLM
   * self-cleaning; the inline error stays visible to the user.
   * @param request - dynamic kind, target key, role language (cache name).
   * @returns `{ ok: true, removed }` (removed=false: already absent) or error.
   */
  @Remote('dynamicFigureFailed')
  async remoteDynamicFigureFailed(request: { kind: 'seq-edge' | 'flow-subgraph' | 'overview'; targetKey: string; language?: string }): Promise<{ ok: true; removed: boolean } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const kind: DynamicFigureKind = request.kind === 'seq-edge' ? 'seq-edge' : request.kind === 'overview' ? 'overview' : 'flow-subgraph'
    const language = request.language ?? '中文'
    try {
      const target = await this.ctx.fs.resolve(dynamicFigureCacheName(kind, request.targetKey, language), { cwd: root })
      await unlink(this.ctx.fs.processPath(target))
      return { ok: true, removed: true }
    } catch {
      // absent / never written / raced delete — nothing to invalidate
      return { ok: true, removed: false }
    }
  }

  /**
   * Build the session message for the CUSTOM figure branch (「🎨 动态出图」): the
   * user types ANY request ("存图的逻辑，怎么存的、存哪、怎么读的…") and the agent
   * draws a matching diagram PLUS a short summary. Same session-turn contract
   * as dynamicFigurePrompt — the answer is matched by figId, captured into
   * `customFigures[figureId]`, and NOT persisted automatically: the panel's
   * 保存 button locks the scene id to disk explicitly.
   * SCENE ID: when `figureId` is given (a follow-up on an existing scene) it is
   * reused and the existing figure is embedded as context; otherwise a new
   * per-workspace id `dynamic-N` is allocated for a brand-new scene.
   * @param request - the user's figure request text, optional target figureId
   *   (follow-up), and role language — the duty section is assembled host-side
   *   (dutyFactsForFigure), so AI-generated summaries reach the prompt with
   *   no client state involved.
   * @returns the figId + scene figureId + prompt to send, or an error.
   */
  @Remote('customFigurePrompt')
  async remoteCustomFigurePrompt(request: { text: string; figureId?: string; language?: string }): Promise<{ figId: string; figureId: string; prompt: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `custom figure prompt: ${blocked}` }
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    const text = (request.text ?? '').trim()
    if (text === '') return { error: 'empty draw request' }
    try {
      const index = await this.indexWorkspaceShared(root)
      const language = request.language ?? '中文'
      let figureId = request.figureId
      const existing = figureId !== undefined
        ? this.customFigures.get(figureId) ?? await this.readDrawFromDisk(root, figureId)
        : null
      if (figureId === undefined) figureId = await this.allocateFigureId(root)
      const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const duties = await this.dutyFactsForFigure(root, language)
      const prompt = buildCustomFigurePrompt(index, text, language, figId, duties, existing === null ? undefined : {
        title: existing.title,
        diagram: existing.diagram,
        summary: existing.summary,
      })
      const usageStart = this.sessionUsageSnapshot(this.targetSessionId)
      this.pendingCustomFigure = {
        figId, figureId, text, language, stagedAt: Date.now(),
        ...(usageStart !== undefined ? { usageStart } : {}),
      }
      // One-shot staging: clear after 30 minutes even if the agent never
      // answers (same defensive TTL as the figure/dynamic branches).
      setTimeout(() => {
        if (this.pendingCustomFigure?.figId === figId) this.pendingCustomFigure = null
      }, 30 * 60 * 1000)
      return { figId, figureId, prompt }
    } catch (error) {
      return { error: `custom figure prompt failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Read ONE custom figure scene: in-memory first (this session's generated or
   * restored content), then the saved disk file (marked `saved: true`). The
   * panel calls this after a turn completes (to render the freshly drawn
   * figure) and when the user selects a scene in the list.
   * FALLBACK (no figureId): return the newest in-memory figure, else the
   * newest saved one, so a plain panel reopen restores something useful.
   * @returns the custom figure (figureId, title, diagram, summary, text),
   *   null when nothing matches, or an error.
   */
  @Remote('customFigure')
  async remoteCustomFigure(request: { figureId?: string }): Promise<{ figureId: string; title: string; diagram: string; summary: string; text: string; saved?: boolean } | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    if (request.figureId !== undefined && request.figureId !== '') {
      const mem = this.customFigures.get(request.figureId)
      if (mem !== undefined) return { figureId: mem.figureId, title: mem.title, diagram: mem.diagram, summary: mem.summary, text: mem.text, saved: mem.saved }
      const disk = await this.readDrawFromDisk(root, request.figureId)
      if (disk !== null) return { ...disk, saved: true }
      return null
    }
    let newestMem: { figureId: string; title: string; diagram: string; summary: string; text: string; at: number } | null = null
    for (const entry of this.customFigures.values()) {
      if (newestMem === null || entry.at > newestMem.at) newestMem = { figureId: entry.figureId, title: entry.title, diagram: entry.diagram, summary: entry.summary, text: entry.text, at: entry.at }
    }
    if (newestMem !== null) return { figureId: newestMem.figureId, title: newestMem.title, diagram: newestMem.diagram, summary: newestMem.summary, text: newestMem.text }
    const saved = await this.readNewestDraw(root)
    if (saved !== null) return { ...saved, saved: true }
    return null
  }

  /** Parse one `.arch-lens-draw-*.json` file into its figure record. figureId
   * comes from the file's `figureId` field when present, else the file name
   * (`dynamic-N` for scene saves, the hash part for legacy text-hash saves).
   * Returns null for unreadable, diagram-less, or tombstoned (deleted) files. */
  private drawFileRecord(name: string, parsed: { diagram?: unknown; title?: unknown; summary?: unknown; text?: unknown; savedAt?: unknown; figureId?: unknown; deleted?: unknown }): { figureId: string; title: string; diagram: string; summary: string; text: string; savedAt: number } | null {
    if (parsed.deleted === true) return null
    if (typeof parsed.diagram !== 'string' || parsed.diagram === '') return null
    const match = /^\.arch-lens-draw-dynamic-(\d+)-/.exec(name)
    const figureId = typeof parsed.figureId === 'string' && parsed.figureId !== ''
      ? parsed.figureId
      : match !== null
        ? `dynamic-${match[1]}`
        : name.replace(/^\.arch-lens-draw-/, '').replace(/-[A-Za-z0-9_-]*\.json$/, '')
    return {
      figureId,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      diagram: parsed.diagram,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      text: typeof parsed.text === 'string' ? parsed.text : '',
      savedAt: typeof parsed.savedAt === 'string' ? Date.parse(parsed.savedAt) : 0,
    }
  }

  /** Scan `index/` then the workspace root (legacy saves) for every saved
   * custom figure file. Tombstoned (deleted) files are filtered out. */
  private async readSavedDraws(root: string): Promise<Array<{ figureId: string; title: string; diagram: string; summary: string; text: string; savedAt: number }>> {
    const fs = this.ctx.fs
    const out: Array<{ figureId: string; title: string; diagram: string; summary: string; text: string; savedAt: number }> = []
    for (const dir of [CACHE_DIR, '.']) {
      try {
        const dirTarget = await fs.resolve(dir === '.' ? '.' : dir, { cwd: root })
        const entries = await fs.listDir(dirTarget)
        for (const entry of entries) {
          if (entry.type !== 'file' || !entry.name.startsWith('.arch-lens-draw-') || !entry.name.endsWith('.json')) continue
          try {
            const parsed = JSON.parse(await fs.readText(entry.target)) as { diagram?: unknown; title?: unknown; summary?: unknown; text?: unknown; savedAt?: unknown; figureId?: unknown; deleted?: unknown }
            const record = this.drawFileRecord(entry.name, parsed)
            if (record !== null) out.push(record)
          } catch {
            // corrupt/unreadable file — skip
          }
        }
      } catch {
        // dir missing — skip
      }
    }
    return out
  }

  /** Read ONE saved custom figure by figureId, or null. */
  private async readDrawFromDisk(root: string, figureId: string): Promise<{ figureId: string; title: string; diagram: string; summary: string; text: string } | null> {
    const records = await this.readSavedDraws(root)
    const found = records.find(record => record.figureId === figureId)
    return found === undefined ? null : { figureId: found.figureId, title: found.title, diagram: found.diagram, summary: found.summary, text: found.text }
  }

  /** Newest saved custom figure across disk (memory lost on restart), or null. */
  private async readNewestDraw(root: string): Promise<{ figureId: string; title: string; diagram: string; summary: string; text: string } | null> {
    const records = await this.readSavedDraws(root)
    let newest: { figureId: string; title: string; diagram: string; summary: string; text: string; savedAt: number } | null = null
    for (const record of records) {
      if (newest === null || record.savedAt > newest.savedAt) newest = record
    }
    return newest === null ? null : { figureId: newest.figureId, title: newest.title, diagram: newest.diagram, summary: newest.summary, text: newest.text }
  }

  /** Next free per-workspace scene id: `dynamic-<maxExisting+1>`. Scans raw
   * file names (INCLUDING tombstoned ones) plus memory, so deleted numbers
   * never get reused. */
  private async allocateFigureId(root: string): Promise<string> {
    const fs = this.ctx.fs
    let max = 0
    for (const dir of [CACHE_DIR, '.']) {
      try {
        const dirTarget = await fs.resolve(dir === '.' ? '.' : dir, { cwd: root })
        const entries = await fs.listDir(dirTarget)
        for (const entry of entries) {
          if (entry.type !== 'file') continue
          const match = /^\.arch-lens-draw-dynamic-(\d+)-/.exec(entry.name)
          if (match !== null) max = Math.max(max, Number(match[1]))
        }
      } catch {
        // dir missing — skip
      }
    }
    for (const key of this.customFigures.keys()) {
      const match = /^dynamic-(\d+)$/.exec(key)
      if (match !== null) max = Math.max(max, Number(match[1]))
    }
    return `dynamic-${max + 1}`
  }

  /** Cache file name for a scene figure: `index/.arch-lens-draw-<figureId>[-<lang>].json`. */
  private drawFileName(figureId: string, language: string): string {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
    return `${CACHE_DIR}/.arch-lens-draw-${figureId}-${safe === '' ? 'default' : safe}.json`
  }

  /**
   * List every custom figure scene: saved ones from disk (saved: true) merged
   * with this session's memory figures (unsaved ones show saved: false so the
   * panel can offer 保存). Ordered dynamic-N ascending, then legacy hashes.
   * @returns the scene list (figureId, title, text, saved), or an error.
   */
  @Remote('customFigureList')
  async remoteCustomFigureList(): Promise<Array<{ figureId: string; title: string; text: string; saved: boolean; savedAt?: string }> | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      const byId = new Map<string, { figureId: string; title: string; text: string; saved: boolean; savedAt?: string }>()
      for (const record of await this.readSavedDraws(root)) {
        const entry: { figureId: string; title: string; text: string; saved: boolean; savedAt?: string } = {
          figureId: record.figureId,
          title: record.title,
          text: record.text,
          saved: true,
        }
        if (record.savedAt > 0) entry.savedAt = new Date(record.savedAt).toISOString()
        byId.set(record.figureId, entry)
      }
      for (const entry of this.customFigures.values()) {
        byId.set(entry.figureId, { figureId: entry.figureId, title: entry.title, text: entry.text, saved: entry.saved })
      }
      return [...byId.values()].sort((a, b) => {
        const na = /^dynamic-(\d+)$/.exec(a.figureId)
        const nb = /^dynamic-(\d+)$/.exec(b.figureId)
        if (na !== null && nb !== null) return Number(na[1]) - Number(nb[1])
        if (na !== null) return -1
        if (nb !== null) return 1
        return a.figureId.localeCompare(b.figureId)
      })
    } catch (error) {
      return { error: `list custom figures failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * 「🔧 按报错修复重画」(L3): the panel reports the RENDERER's parse error for a
   * memory scene figure; this stages a grammar-only repair turn through the
   * SAME session-turn capture pipeline as customFigurePrompt. The client sends
   * ONLY `{ figureId, error }` — the broken source is taken from the HOST copy
   * (single source of truth; the client re-sanitizes on render so the two
   * agree), and a FRESH figId nonce is minted while the LOCKED scene figureId
   * is reused, so the fix overwrites the same scene slot on capture. No
   * scan-facts replay (the facts stand in the broken diagram; replaying the
   * index would burn tokens and invite semantic drift). Manual-only: this is
   * never called automatically — the user clicks, spending one turn.
   * @param request - locked scene figureId + the renderer's error text.
   * @returns figId + figureId + prompt to send, or an error.
   */
  @Remote('figureRepairPrompt')
  async remoteFigureRepairPrompt(request: { figureId: string; error: string }): Promise<{ figId: string; figureId: string; prompt: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `figure repair prompt: ${blocked}` }
    if (request.figureId === '') return { error: 'empty figureId' }
    try {
      const scene = this.customFigures.get(request.figureId) ?? await this.readDrawFromDisk(root, request.figureId)
      if (scene === undefined || scene === null) return { error: `figure not found: ${request.figureId}` }
      if (scene.diagram === '') return { error: 'figure has no diagram to repair' }
      const error = (request.error ?? '').trim()
      if (error === '') return { error: 'empty render error (nothing to repair)' }
      const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const prompt = buildFigureRepairPrompt(request.figureId, figId, scene.diagram, scene.title, scene.summary, error)
      const usageStart = this.sessionUsageSnapshot(this.targetSessionId)
      // Reuse the CUSTOM capture slot/contract verbatim: the listener matches
      // the fresh figId and overwrites customFigures[figureId] (same scene),
      // so a repair round needs no separate capture branch. text preserved so
      // the scene keeps its original request wording.
      this.pendingCustomFigure = {
        figId, figureId: request.figureId, text: scene.text, language: '中文', stagedAt: Date.now(),
        ...(usageStart !== undefined ? { usageStart } : {}),
      }
      setTimeout(() => {
        if (this.pendingCustomFigure?.figId === figId) this.pendingCustomFigure = null
      }, 30 * 60 * 1000)
      return { figId, figureId: request.figureId, prompt }
    } catch (error) {
      return { error: `figure repair prompt failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Persist a scene figure — 图 AND 概要 — to
   * `index/.arch-lens-draw-<figureId>[-<lang>].json`, LOCKING the scene id
   * (replacing the old text-hash naming). The only way a custom figure lands
   * on disk; a follow-up re-render marks it unsaved again until 保存 re-locks.
   * @param request - target figureId + role language (cache-name suffix).
   * @returns `{ ok: true, path }` or an error.
   */
  @Remote('saveCustomFigure')
  async remoteSaveCustomFigure(request: { figureId: string; language?: string }): Promise<{ ok: true; path: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `save custom figure: ${blocked}` }
    const result = this.customFigures.get(request.figureId)
    if (result === undefined) return { error: 'figure not found: generate the scene first' }
    const language = request.language ?? '中文'
    try {
      const name = this.drawFileName(request.figureId, language)
      const target = await this.ctx.fs.resolve(name, { cwd: root })
      await this.ctx.fs.writeText(
        target,
        JSON.stringify({
          figureId: result.figureId,
          title: result.title,
          diagram: result.diagram,
          summary: result.summary,
          text: result.text,
          savedAt: new Date().toISOString(),
        }, null, 2),
        undefined,
        undefined,
        this.sessionPolicy(),
      )
      result.saved = true
      return { ok: true, path: target.displayPath }
    } catch (error) {
      return { error: `save custom figure failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Delete a scene figure for REAL: every disk file (all language variants in
   * `index/` and the legacy root location) is physically removed via
   * node:fs/promises unlink — the fs service has no remove, so the resolved
   * target's process path is unlinked directly. Memory entry dropped. (Files
   * tombstoned by an older build are still filtered on read.)
   * @returns `{ ok: true }` or an error.
   */
  @Remote('customFigureDelete')
  async remoteCustomFigureDelete(request: { figureId: string }): Promise<{ ok: true } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    if (request.figureId === '') return { error: 'empty figureId' }
    try {
      const fs = this.ctx.fs
      for (const dir of [CACHE_DIR, '.']) {
        try {
          const dirTarget = await fs.resolve(dir === '.' ? '.' : dir, { cwd: root })
          const entries = await fs.listDir(dirTarget)
          for (const entry of entries) {
            if (entry.type !== 'file' || !entry.name.startsWith(`.arch-lens-draw-${request.figureId}-`) || !entry.name.endsWith('.json')) continue
            try {
              await unlink(fs.processPath(entry.target))
            } catch {
              // already gone (concurrent delete / raced rename) — fine
            }
          }
        } catch {
          // dir missing — skip
        }
      }
      this.customFigures.delete(request.figureId)
      return { ok: true }
    } catch (error) {
      return { error: `delete custom figure failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * 原地追问重画：对某个 tab 的主图（flow/seq/concepts/events/core/overview）
   * 做一次带追问上下文的重新生成，结果覆写同一缓存并返回新图数据；客户端
   * 直接回填该 tab 状态，图就原地更新（不画到「动态出图」）。
   * @param request - 图类型、语言、流程视角（flow）、方法级开关、追问文本。
   * @returns 与对应 tab 正常 RPC 相同形状的新图数据，或错误。
   */
  @Remote('figureFollowUp')
  async remoteFigureFollowUp(request: { kind: FollowUpKind; language?: string; angle?: FlowAngle; methodLevel?: boolean; followUp: string }): Promise<FollowUpResult | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    if (request.followUp.trim() === '') return { error: 'empty follow-up text' }
    const blocked = this.ensureWritable()
    if (blocked !== null) return { error: `figure follow-up: ${blocked}` }
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await this.indexWorkspaceShared(root)
      const controller = new AbortController()
      this.followUpAbort.set(root, controller)
      try {
        return await figureFollowUp(this.ctx, this.ctx.fs, root, index, { ...request, language: request.language ?? '中文' }, this.sessionPolicy(), controller.signal)
      } finally {
        if (this.followUpAbort.get(root) === controller) this.followUpAbort.delete(root)
      }
    } catch (error) {
      return { error: `figure follow-up failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Cancel the in-flight follow-up redraw of the current workspace (the
   * panel's「取消」button while a redraw is running): aborting the stream
   * stops the LLM call and the cache is never overwritten — the old figure
   * stays in place.
   * @returns whether a follow-up generation was aborted.
   */
  @Remote('cancelFollowUp')
  async remoteCancelFollowUp(): Promise<{ ok: boolean }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return { ok: false }
    const controller = this.followUpAbort.get(root)
    if (controller === undefined) return { ok: false }
    controller.abort()
    this.followUpAbort.delete(root)
    return { ok: true }
  }

  /**
   * Abort every in-flight LLM generation for the current workspace (the
   *「⏹ 终止」button). The active AbortSignal fires, so provider streams stop
   * promptly; the client drops the pending responses locally.
   * @returns whether a generation was aborted.
   */
  @Remote('cancelGeneration')
  async remoteCancelGeneration(): Promise<{ ok: boolean }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return { ok: false }
    return { ok: abortGeneration(root) }
  }

  /**
   * Structured figure data for the interaction tab — READ ONLY: serve the
   * versioned structured cache; null when absent/stale. The shared-profile
   * fallback and LLM induction are WRITE-path only (「🤖 AI 生成」 /
   * regenerateFigure). Opening the panel or switching tabs never generates.
   * @param request - role language and method-level cache variant.
   * @returns event array, null, or an error.
   */
  @Remote('events')
  async remoteEvents(request: { language?: string; methodLevel?: boolean }): Promise<Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      const cached = await readStructuredCache(this.ctx.fs, root, request.language ?? '中文', 'interaction', request.methodLevel === true) as Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null
      if (cached !== null) console.log(`[arch-lens] events: served from cache (read-only, methodLevel=${request.methodLevel === true})`)
      return cached
    } catch (error) {
      return { error: `events read failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Flow diagram — READ ONLY: serve the versioned cache; null when
   * absent/stale. Doc extraction, pseudo transcode, profile and LLM
   * induction are WRITE-path only (「🤖 AI 生成」 / regenerateFigure).
   * Opening the panel or switching tabs never generates.
   * @param request - role language, viewpoint, and method-level variant.
   * @returns the cached diagram, null, or an error.
   */
  @Remote('flow')
  async remoteFlow(request: { language?: string; angle?: FlowAngle; methodLevel?: boolean }): Promise<ArchLensFlowResult | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    try {
      return await readFlow(this.ctx.fs, root, request.language ?? '中文', request.angle ?? 'event', request.methodLevel === true)
    } catch (error) {
      return { error: `flow read failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Code-derived insights: services/events/tools/remotes extracted from each
   * package's entry source. This is the "code-first" view — documentation is
   * a reference, but the analysis never depends on it.
   * @returns insight records or an error.
   */
  @Remote('analyze')
  async remoteAnalyze(): Promise<ArchLensCodeInsight[] | { error: string }> {
    const graph = await this.requireGraph()
    if ('error' in graph) return graph
    return analyzeWorkspace(this.ctx.fs, graph)
  }

  /**
   * AI one-line duty summaries for the package catalog. READ (default): serve
   * the persisted cache AS IS — possibly partial (generation batches stop at
   * the RPC budget). The catalog is a SCAN fact (每包的 README/description 兜底
   * 是 dutyText 的行级契约), so withholding the whole table over uncovered rows
   * turns "AI 覆盖了 80/247" into a永久空态: the incremental pass judges the
   * cache stamp-valid and never fills it, while a completeness-gated read never
   * serves it — the half-generated cache could neither grow nor be seen.
   * WRITE (force=true, the catalog「🤖 AI 生成」): generate the missing
   * summaries (LLM) and persist them (merges over the existing partial map).
   * @param request - output language (default 中文) and force flag.
   * @returns id → summary map (whatever is current), null when no cache exists
   *   at this facts version, or an error.
   */
  @Remote('summarizeDuties')
  async remoteSummarizeDuties(request: { language?: string; force?: boolean }): Promise<Record<string, string> | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const graph = await this.requireGraph()
    if ('error' in graph) return graph
    const language = request.language ?? '中文'
    if (request.force === true) {
      // 写路径：包目录「🤖 AI 生成」——LLM 补齐缺失总结并落缓存。
      const blocked = this.ensureWritable()
      if (blocked !== null) return { error: `summarize duties: ${blocked}` }
      return summarizeDuties(this.ctx, this.ctx.fs, root, graph, language, this.sessionPolicy())
    }
    return await readDutySummaries(this.ctx.fs, root, language)
  }

  /**
   * AI learning-progress summary: contrasts the note targets against the
   * scanned graph and appends a model-generated entry to the note file bottom.
   * @param request - role language and whether to force regeneration.
   * @returns progress stats plus the generated summary, or an error.
   */
  @Remote('progress')
  async remoteProgress(request: { language?: string; force?: boolean }): Promise<ArchLensProgressResult | { error: string }> {
    if (NOTES_FEATURE_OFF) return { error: '学习进度总结已暂时下线（数据源=笔记文件，随笔记系一并废弃）' }
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const graph = await this.requireGraph()
    if ('error' in graph) return graph
    return summarizeProgress(this.ctx, this.ctx.fs, root, graph, this.notesFile, request.language ?? '中文', request.force === true, this.sessionPolicy())
  }

  /**
   * Read-only learning-progress statistics (no LLM call).
   * @returns asked/unasked lists and the coverage percentage.
   */
  @Remote('progressStats')
  async remoteProgressStats(): Promise<{ asked: string[]; unasked: string[]; total: number; progress: number } | { error: string }> {
    if (NOTES_FEATURE_OFF) return { error: '覆盖度统计已暂时下线（数据源=笔记文件，随笔记系一并废弃）' }
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const graph = await this.requireGraph()
    if ('error' in graph) return graph
    return progressStats(this.ctx.fs, root, graph, this.notesFile)
  }

  /**
   * LLM usage accounting: totals and the newest recorded calls (see
   * llm-stats.ts for the estimation rule). The snapshot is also persisted to
   * `index/.arch-lens-llm-stats.json` under the workspace so token spend is
   * inspectable outside the panel and survives restarts.
   * @returns the accounting snapshot.
   */
  @Remote('llmStats')
  async remoteLlmStats(): Promise<LlmStatsSnapshot> {
    // Adopt BEFORE snapshotting/writing: the write below re-persists the
    // memory snapshot, and an unadopted empty memory would otherwise clobber
    // the historical file on the very first panel open after a restart.
    await this.adoptLlmStats()
    const snapshot = llmStatsSnapshot()
    const root = this.resolveRoot()
    if (typeof root === 'string') {
      try {
        const target = await this.ctx.fs.resolve(`${CACHE_DIR}/.arch-lens-llm-stats.json`, { cwd: root })
        await this.ctx.fs.writeText(target, JSON.stringify(snapshot, null, 2), undefined, undefined, this.sessionPolicy())
      } catch {
        // best-effort persistence
      }
    }
    return snapshot
  }

  /**
   * Stage question metadata for the next assistant/message answer. Memory
   * only — the file write stays exclusively on the event path below.
   * An empty `text` CLEARS any staged metadata instead of staging: the desk
   * uses that after a failed explain send so no later ordinary
   * assistant/message gets mis-recorded as an explain (no extra wire name —
   * this stays within the official notePending contract).
   * @param request - target label, question text, and calling session id.
   * @returns acknowledgement.
   */
  @Remote('notePending')
  async remoteNotePending(request: {
    target: string
    text: string
    sessionId?: string
  }): Promise<{ ok: true }> {
    if (request.text === '') {
      this.pending = null
      return { ok: true }
    }
    const usageStart = this.sessionUsageSnapshot(request.sessionId ?? null)
    this.pending = {
      target: request.target ?? '架构讲解',
      question: request.text ?? '',
      sessionId: request.sessionId ?? null,
      stagedAt: Date.now(),
      ...(usageStart !== undefined ? { usageStart } : {}),
    }
    return { ok: true }
  }

  /**
   * Read the persisted per-workspace prompt configuration.
   * @returns the config and its storage path.
   */
  @Remote('promptConfig')
  async remotePromptConfig(): Promise<ArchLensPromptConfigResult> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return { path: PROMPT_CONFIG_FILE, config: {} }
    const fs = this.ctx.fs
    try {
      const target = await fs.resolve(PROMPT_CONFIG_FILE, { cwd: root })
      const info = await fs.stat(target)
      if (info === undefined || info.type !== 'file') return { path: PROMPT_CONFIG_FILE, config: {} }
      const text = await fs.readText(target)
      return { path: PROMPT_CONFIG_FILE, config: JSON.parse(text) as ArchLensPromptConfig }
    } catch {
      return { path: PROMPT_CONFIG_FILE, config: {} }
    }
  }

  /**
   * Persist the per-workspace prompt configuration.
   * @param request - config fields to store (absent fields keep their stored value).
   * @returns the stored config and its path.
   */
  @Remote('promptConfigSave')
  async remotePromptConfigSave(request: ArchLensPromptConfig): Promise<ArchLensPromptConfigResult | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const fs = this.ctx.fs
    try {
      const target = await fs.resolve(PROMPT_CONFIG_FILE, { cwd: root })
      const info = await fs.stat(target)
      const existing: ArchLensPromptConfig = info !== undefined && info.type === 'file'
        ? JSON.parse(await fs.readText(target)) as ArchLensPromptConfig
        : {}
      const merged: ArchLensPromptConfig = {}
      if (request.overviewPrompt !== undefined) merged.overviewPrompt = request.overviewPrompt
      else if (existing.overviewPrompt !== undefined) merged.overviewPrompt = existing.overviewPrompt
      if (request.explainStyle !== undefined) merged.explainStyle = request.explainStyle
      else if (existing.explainStyle !== undefined) merged.explainStyle = existing.explainStyle
      if (request.language !== undefined) merged.language = request.language
      else if (existing.language !== undefined) merged.language = existing.language
      if (request.useDefaults !== undefined) merged.useDefaults = request.useDefaults
      else if (existing.useDefaults !== undefined) merged.useDefaults = existing.useDefaults
      await fs.writeText(target, JSON.stringify(merged, null, 2), undefined, undefined, this.sessionPolicy())
      return { path: PROMPT_CONFIG_FILE, config: merged }
    } catch (error) {
      return { error: `prompt config save failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Register the single note-write path: assistant/message events. */
  protected async [Service.init](): Promise<void> {
    // NOTE: LLM-ledger adoption deliberately does NOT happen here. At init the
    // panel has not bound a session yet, so resolveRoot() falls back to the
    // process cwd — folding in THAT workspace's file would mix ledgers.
    // remoteSetSession / remoteLlmStats adopt lazily once the root is real
    // (see adoptLlmStats).
    this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'assistant/message') return
      const message = event.data.message
      let answer = ''
      for (const block of message.content) {
        if (block.type === 'text') answer += block.text
      }
      // Skip empty-content assistant/message events: they exist only to host
      // usage metadata, and writing them would record blank note entries.
      if (answer.trim() === '') return
      // Session-driven figure generation: an answer carrying the staged
      // figId is the agent's figure output — sanitize it into the figure
      // cache (the panel refetches after the turn completes). The figId
      // (timestamp + random suffix, 5-min TTL) is the match gate, not the
      // session: the prompt may be sent to the GUI's current session even
      // when the user switches sessions between staging and sending.
      const stagedFigure = this.pendingFigure
      if (stagedFigure !== null) {
        const parsed = extractFigureJson(answer, stagedFigure.figId)
        if (parsed !== null) {
          this.pendingFigure = null
          // Attribute the answering model call's spend to the ledger: the
          // figure was generated inside the session's agent turn, so its
          // tokens only surface via the session tokenUsage delta.
          this.recordSessionUsage(
            'figure',
            stagedFigure.dynamic === undefined ? 'AI 生成' : '动态下钻',
            stagedFigure.stagedAt, stagedFigure.usageStart, session.id,
          )
          const root = session.header.cwd ?? this.rootFromPolicy()
          if (root !== undefined) {
            // The staged figure carries the index its prompt was built from —
            // no re-indexing here, so the cache write lands in milliseconds
            // (before the panel's running-flip refetch can read it).
            const write = stagedFigure.dynamic === undefined
              ? writeFigureCache(
                  this.ctx.fs, root, stagedFigure.index, stagedFigure.kind as SessionFigureKind, parsed,
                  stagedFigure.language, stagedFigure.angle, stagedFigure.methodLevel,
                  resolveSessionPolicy(this.ctx, session.id),
                )
              : (async () => {
                  const dyn = stagedFigure.dynamic!
                  // §6.2 统一下钻图事实戳：写时读 factsVersion + 按规则算 deps
                  // （seq-edge→两端点、flow-subgraph→父流程 deps、overview→全部包），
                  // 选择性失效据此级联（D1）。
                  const facts = await dynamicFigureWriteFacts(this.ctx.fs, root, dyn, stagedFigure.language, stagedFigure.angle, stagedFigure.index)
                  return writeDynamicFigureCache(
                    this.ctx.fs, root, dyn.kind, dyn.targetKey, parsed,
                    stagedFigure.language, facts.factsVersion, facts.deps, resolveSessionPolicy(this.ctx, session.id),
                  )
                })()
            void write.then(result => {
              console.log(`[arch-lens] session figure ${stagedFigure.figId} (${stagedFigure.kind}): ${'ok' in result ? 'cached' : result.error}`)
            })
          }
        }
      }
      // Custom figure (🎨 动态出图): an answer carrying the staged custom
      // figId is captured into customFigures[figureId] (diagram + 概要) —
      // NEVER auto-written to disk; the panel's 保存 button locks the scene
      // id to disk explicitly. A follow-up re-render keeps the scene id and
      // flips `saved` back to false (the disk copy is now stale).
      const stagedCustom = this.pendingCustomFigure
      if (stagedCustom !== null) {
        const parsed = extractFigureJson(answer, stagedCustom.figId)
        if (parsed !== null) {
          this.pendingCustomFigure = null
          this.recordSessionUsage('draw', '动态出图', stagedCustom.stagedAt, stagedCustom.usageStart, session.id)
          const value = extractCustomFigure(parsed)
          if (value !== undefined) {
            this.customFigures.set(stagedCustom.figureId, {
              figureId: stagedCustom.figureId,
              ...value,
              text: stagedCustom.text,
              at: Date.now(),
              // A fresh render means the disk copy (if any) is now stale:
              // the user must 保存 again to re-lock the scene id.
              saved: false,
            })
            console.log(`[arch-lens] custom figure ${stagedCustom.figureId} captured (memory only, not persisted)`)
          }
        }
      }
      if (this.pending !== null && this.pending.sessionId !== null && session.id !== this.pending.sessionId) return
      const staged = this.pending
      // Only panel-initiated explains (notePending pre-registration) are
      // recorded — ordinary conversation (bug discussions, design decisions)
      // must not pollute the learning notes.
      if (staged === null) return
      this.pending = null
      this.recordSessionUsage('explain', '讲解', staged.stagedAt, staged.usageStart, session.id)
      // 笔记系下线：会话记录即笔记，回答不再抄录进 ARCH-NOTES.md（图只有
      // 会话记得住）；usage 记账保留。恢复=翻开关。
      if (NOTES_FEATURE_OFF) return
      // The listener runs on the service (root) context, where the sandbox
      // policy has no session scope — use the event's own session cwd instead.
      const root = session.header.cwd ?? this.rootFromPolicy()
      if (root === undefined) return
      void appendNote(
        this.ctx.fs,
        root,
        {
          target: staged.target,
          question: staged.question,
          answer,
        },
        this.notesFile,
        // The event session owns the workspace being written: resolve its
        // policy so the fs sandbox approves the note write (the root context
        // alone has no session scope and would fall back to the deployment
        // root, which denies writes into the learned workspace).
        resolveSessionPolicy(this.ctx, session.id),
      ).then(result => {
        if ('ok' in result && result.skipped === true) {
          console.log('[arch-lens] note skipped: duplicate question (same target and question head)')
        }
      })
    })
  }

  /** Policy-derived workspace root, used only when the event session has no cwd. */
  private rootFromPolicy(): string | undefined {
    return this.ctx.get('sandboxPolicy')?.workspaceRoot
  }
}

export default ArchLensService
