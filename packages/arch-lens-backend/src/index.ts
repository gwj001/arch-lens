/**
 * Arch Lens backend host service: workspace graph scanning, component detail
 * projection, and answer-level note recording. Read-only graph/component/notes
 * methods cross to the browser via Typert Remote; note file WRITES have exactly
 * one path — the session/event listener below. notePending only stages in-memory
 * question metadata; it never touches the file.
 * @module @deepseek-ai/dsh-arch-lens-backend
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import s from '@deepseek-ai/schemastery'
import { appendNote, readNotes } from './notes.ts'
import { scanWorkspace } from './scan.ts'
import { summarizeDuties } from './summarize.ts'
import { progressStats, summarizeProgress } from './progress.ts'
import { analyzeWorkspace } from './analyze.ts'
import { conceptTree, generateFromFlow } from './concept.ts'
import { flowDiagram } from './flow.ts'
import { generateDocSection, generateFullDocs, readStructuredCache, writeStructuredCache } from './docsgen.ts'
import { resolveSequence } from './sequence.ts'
import { dependencyFlowchart, entityErDiagram, importFlowchart, packageErDiagram, coreFlowchart, coreErDiagram, overviewFigure } from './mermaid.ts'
import { coreGraph } from './core.ts'
import { ensureAnalysisProfile, clearAnalysisProfileCache, regenerateProfileField } from './analysis.ts'
import type { AnalysisFlow } from './analysis.ts'
import { llmStatsSnapshot } from './llm-stats.ts'
import { abortGeneration, currentGenerationStatus, generationSignal, waitForGenerationStatus } from './abort.ts'
import {
  buildDynamicFigurePrompt,
  buildFigurePrompt,
  dynamicFigureCacheName,
  dynamicTargetKey,
  extractFigureJson,
  writeDynamicFigureCache,
  writeFigureCache,
} from './session-figure.ts'
import type { DynamicFigureKind, PendingFigure, SessionFigureKind } from './session-figure.ts'
import { sanitizeMermaid } from './flow-angle.ts'
import { sessionPolicy as resolveSessionPolicy } from './policy.ts'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
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
  RegenerateFigureResult,
} from './types.ts'

// Export the wire types AND the shared runtime helper (groupLabel) — the
// client bundle imports it as a value.
export * from './types.ts'

/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = 'ARCH-NOTES.md'

/** Persisted scan-graph cache in the workspace root (reopening after a host
 * restart must not re-walk the filesystem; refresh() invalidates it). */
const GRAPH_CACHE_FILE = '.arch-lens-graph.json'

/** Per-workspace prompt configuration file in the workspace root. */
const PROMPT_CONFIG_FILE = '.arch-lens-prompts.json'

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

/** In-memory staged question metadata, consumed by the next matching answer. */
interface PendingNote {
  target: string
  question: string
  sessionId: string | null
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
  /** One in-flight scan (root + promise) so concurrent callers share one scan
   * per root; a scan of another root can run alongside without clobbering it. */
  private graphInFlight: { root: string; promise: Promise<ArchLensGraph | { error: string }> } | null = null
  private pending: PendingNote | null = null
  /** One staged session-driven figure request (🤖 AI 生成 via 会话回合):
   * matched by figId in the agent's answer, written to the figure cache. */
  private pendingFigure: PendingFigure | null = null
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

  /** Scan (with cache) the workspace package tree; concurrent callers share
   * one scan per root. Cache-first: a previously scanned workspace (any
   * session of it) resolves instantly; only a new root triggers a scan.
   * The scan graph is ALSO persisted to `.arch-lens-graph.json` in the
   * workspace root, so reopening the desk after a host restart serves the
   * cached graph instead of re-walking the filesystem. refresh() marks the
   * disk copy invalid before it rescans (the FileSystem has no delete). */
  private graph(): Promise<ArchLensGraph | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return Promise.resolve(root)
    const cached = this.graphCaches.get(root)
    if (cached !== undefined) return Promise.resolve(cached)
    if (this.graphInFlight !== null && this.graphInFlight.root === root) return this.graphInFlight.promise
    const fs = this.ctx.fs
    const promise = this.graphFromDisk(root).then(fromDisk => {
      if (fromDisk !== null) {
        console.log(`[arch-lens] graph: served from disk cache (root=${root})`)
        this.graphCaches.set(root, fromDisk)
        return fromDisk
      }
      return scanWorkspace(fs, root).then(result => {
        if (this.graphInFlight !== null && this.graphInFlight.promise === promise) this.graphInFlight = null
        this.graphCaches.set(root, result)
        if (!('error' in result)) void this.writeGraphDisk(root, result)
        return result
      })
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

  /** Persist a fresh scan graph (non-fatal on failure). */
  private async writeGraphDisk(root: string, graph: ArchLensGraph): Promise<void> {
    try {
      const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root })
      await this.ctx.fs.writeText(
        target,
        JSON.stringify({ root, generatedAt: Date.now(), graph }),
        undefined, undefined, this.sessionPolicy(),
      )
    } catch {
      // non-fatal
    }
  }

  /**
   * The scanned workspace graph (cached until refresh).
   * @returns graph or error.
   */
  @Remote('graph')
  async remoteGraph(): Promise<ArchLensGraph | { error: string }> {
    return this.graph()
  }

  /**
   * Rescan = REBUILD EVERY fact source: invalidate the scan graph, the
   * code-index (in-memory + disk), and the AI caches (concept tree /
   * sequence / events). The next read of any figure re-derives from current
   * code and docs — no stale fact may survive a rescan.
   * @returns the fresh scan graph or error.
   */
  @Remote('refresh')
  async remoteRefresh(): Promise<ArchLensGraph | { error: string }> {
    this.graphCaches.clear()
    this.graphInFlight = null
    // Mark the persisted scan graph invalid: the rescan below overwrites it,
    // and a failed rescan must not resurrect stale data on the next open.
    const root = this.resolveRoot()
    if (typeof root === 'string') {
      try {
        const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root })
        await this.ctx.fs.writeText(target, JSON.stringify({ root, invalidated: true, generatedAt: Date.now() }), undefined, undefined, this.sessionPolicy())
      } catch {
        // non-fatal
      }
    }
    await this.refreshCodeIndex()
    await this.removeAICaches()
    return this.graph()
  }

  /**
   * Refresh only the code-index facts (in-memory + disk invalidated). Used by
   * "refresh this figure": the figure then re-derives from a fresh index.
   * @returns acknowledgement.
   */
  @Remote('refreshIndex')
  async remoteRefreshIndex(): Promise<{ ok: true }> {
    await this.refreshCodeIndex()
    return { ok: true }
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
    return { ok: true }
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

  /** Remove the per-language AI caches (concept tree / sequence / events). */
  private async removeAICaches(): Promise<void> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return
    const fs = this.ctx.fs
    try {
      const rootTarget = await fs.resolve('.', { cwd: root })
      const entries = await fs.listDir(rootTarget)
      for (const entry of entries) {
        if (entry.type !== 'file') continue
        const name = entry.name
        if (['.arch-lens-concept-', '.arch-lens-sequence-', '.arch-lens-events-', '.arch-lens-flow-', '.arch-lens-core-', '.arch-lens-analysis-'].some(prefix => name.startsWith(prefix)) && name.endsWith('.json')) {
          try {
            // Blank the file: readers treat an unparseable cache as absent
            // (the fs service has no delete API), so the next read rebuilds.
            await fs.writeText(entry.target, '', undefined, undefined, this.sessionPolicy())
            console.log(`[arch-lens] invalidated AI cache ${name}`)
          } catch {
            // best-effort invalidation
          }
        }
      }
      // The shared analysis profile's single-flight memory must follow the
      // disk invalidation, or a rescan would keep serving the old profile.
      clearAnalysisProfileCache()
    } catch {
      // absent cache files are fine — nothing to invalidate
    }
  }

  /**
   * Detail projection for one package. The graph carries precomputed details,
   * so this is a plain lookup (kept as a Remote for compatibility).
   * @param request - package id.
   * @returns detail or error.
   */
  @Remote('component')
  async remoteComponent(request: { id: string }): Promise<ArchLensComponentDetail | { error: string }> {
    const graph = await this.graph()
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
    const graph = await this.graph()
    if ('error' in graph) return graph
    return { kind: 'flowchart', source: dependencyFlowchart(graph) }
  }

  /**
   * Mermaid ER diagram of package relationships for the scanned graph.
   * @returns erDiagram source or an error.
   */
  @Remote('mermaidEr')
  async remoteMermaidEr(): Promise<{ kind: 'erDiagram'; source: string } | { error: string }> {
    const graph = await this.graph()
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
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      if (index.language === 'unknown') return { error: 'unsupported workspace language (no package.json / pyproject.toml / pom.xml)' }
      return request.kind === 'flowchart'
        ? { kind: 'flowchart', source: importFlowchart(index) }
        : { kind: 'erDiagram', source: entityErDiagram(index) }
    } catch (error) {
      return { error: `indexed mermaid failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Core-flow diagram (deps/ER overview): the LLM-selected core packages with
   * rule-derived source-import edges. Returns the mermaid source plus the
   * selection provenance so the client can badge/explain it.
   * @param request - diagram kind, role language, and whether to force a new selection.
   * @returns mermaid source and core selection, or an error.
   */
  @Remote('mermaidCore')
  async remoteMermaidCore(request: { kind: 'flowchart' | 'erDiagram'; language?: string; force?: boolean; methodLevel?: boolean }): Promise<{ kind: 'flowchart' | 'erDiagram'; source: string; core: ArchLensCoreGraph } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      const core = await coreGraph(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true, this.sessionPolicy(), request.methodLevel === true)
      if ('error' in core) return core
      const source = request.kind === 'flowchart' ? coreFlowchart(index, core.ids) : coreErDiagram(index, core.ids)
      return { kind: request.kind, source, core }
    } catch (error) {
      return { error: `core diagram failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * 架构概览 (rule-built): the core packages with their one-line duty under
   * the name + source-level import edges between them — zero LLM, built from
   * structured facts (core selection + graph blurbs + index imports). The
   * pure-LLM variant (dynamic figure kind 'overview') stays available for
   * comparison.
   * @param request - role language, force a new core selection.
   * @returns the overview mermaid + core selection, or an error.
   */
  @Remote('overviewFigure')
  async remoteOverviewFigure(request: { language?: string; force?: boolean }): Promise<{ title: string; mermaid: string; core: ArchLensCoreGraph } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      const language = request.language ?? '中文'
      const core = await coreGraph(this.ctx, this.ctx.fs, root, index, language, request.force === true, this.sessionPolicy(), false)
      if ('error' in core) return core
      const graph = await this.graph()
      if ('error' in graph) return graph
      const blurbOf = (id: string): string => {
        const node = graph.nodes.find(candidate => candidate.id === id)
        if (node === undefined) return ''
        return language === 'English' ? node.blurb : (node.blurbZh ?? node.blurb)
      }
      return { title: '架构概览', mermaid: overviewFigure(index, core.ids, blurbOf), core }
    } catch (error) {
      return { error: `overview figure failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Shared codeIndex accessor for the concept/docs remotes. */
  private codeIndexService(): { indexWorkspace(root: string, policy?: SandboxExecutionPolicy): Promise<CodeIndexResult>; refresh(root: string, policy?: SandboxExecutionPolicy): Promise<void> } | undefined {
    return this.ctx.get('codeIndex') as { indexWorkspace(root: string, policy?: SandboxExecutionPolicy): Promise<CodeIndexResult>; refresh(root: string, policy?: SandboxExecutionPolicy): Promise<void> } | undefined
  }

  /**
   * Session-scoped sandbox policy for every file write: the fs sandbox
   * derives its workspace-write root from the calling session's cwd — the
   * same root this service writes to — so passing it approves the writes.
   */
  private sessionPolicy(): SandboxExecutionPolicy {
    return resolveSessionPolicy(this.ctx, this.targetSessionId)
  }

  /**
   * Concept hierarchy via the one-way chain: architecture doc (extract +
   * LLM enhance) first, LLM-from-flow as fallback. Cached per language.
   * @param request - role language and whether to force regeneration.
   * @returns concept-tree nodes or an error.
   */
  @Remote('conceptTree')
  async remoteConceptTree(request: { language?: string; force?: boolean; methodLevel?: boolean }): Promise<ArchLensConceptNode[] | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      const tree = await conceptTree(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true, this.sessionPolicy(), request.methodLevel === true)
      if ('error' in tree) return tree
      return tree
    } catch (error) {
      return { error: `concept tree failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Generate the complete architecture doc (global button): one LLM pass
   * writes concept/sequence/interaction/dependency/ER/catalog sections.
   * @param request - role language.
   * @returns the doc path or an error.
   */
  @Remote('generateDocs')
  async remoteGenerateDocs(request: { language?: string }): Promise<{ path: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      return await generateFullDocs(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', this.sessionPolicy())
    } catch (error) {
      return { error: `generate docs failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Generate one doc section on demand (per-tab "AI generate"). Sequence and
   * interaction also refresh their structured caches.
   * @param request - section kind and role language.
   * @returns the doc path or an error.
   */
  @Remote('generateDocSection')
  async remoteGenerateDocSection(request: { kind: 'concepts' | 'seq' | 'interaction' | 'deps' | 'er' | 'catalog'; language?: string }): Promise<{ path: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      return await generateDocSection(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.kind, this.sessionPolicy())
    } catch (error) {
      return { error: `generate doc section failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Structured figure data for the sequence tab, resolved through the chain:
   * real static call graph first (source 'code'), then the cached doc/LLM
   * result, then the doc's sequence section (source 'doc'), then LLM
   * induction (source 'flow'). With prefer 'flow' the static call-graph
   * stage is skipped, so the main-flow sequence view resolves from the
   * cache, the doc section, or LLM induction. The client renders an empty
   * state on null.
   * @param request - role language and preferred view ('code' | 'flow').
   * @returns the figure (with provenance), null, or an error.
   */
  @Remote('sequence')
  async remoteSequence(request: { language?: string; prefer?: 'code' | 'flow'; methodLevel?: boolean }): Promise<ArchLensSequenceResult | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    try {
      const index = codeIndex === undefined
        ? { root, language: 'unknown' as const, packages: [] }
        : await codeIndex.indexWorkspace(root, this.sessionPolicy())
      return await resolveSequence(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', this.sessionPolicy(), request.prefer ?? 'code', request.methodLevel === true)
    } catch (error) {
      return { error: `sequence failed: ${error instanceof Error ? error.message : String(error)}` }
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
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
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
      switch (request.kind) {
        case 'concepts': {
          const tree = profile.conceptTree
          if (tree === undefined || tree.length === 0) return { error: 'concept regeneration produced no tree' }
          return { kind: 'concepts', tree }
        }
        case 'seq': {
          const messages = profile.seqMessages
          if (messages === undefined || messages.length === 0) return { error: 'seq regeneration produced no messages' }
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
          }
          return { kind: 'flow', flows }
        }
        case 'interaction': {
          const events = profile.events
          if (events === undefined || events.length === 0) return { error: 'events regeneration produced no events' }
          return { kind: 'interaction', events }
        }
        default: {
          if (profile.coreIds.length < 4) return { error: 'core regeneration produced too few packages' }
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
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      const language = request.language ?? '中文'
      const kind: SessionFigureKind = request.kind === 'deps' || request.kind === 'er'
        ? 'core'
        : request.kind === 'interaction' ? 'interaction'
          : request.kind
      const angle = request.kind === 'flow' ? request.angle ?? 'event' : undefined
      const methodLevel = request.methodLevel === true
      const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const prompt = buildFigurePrompt(kind, index, language, figId, angle, methodLevel)
      this.pendingFigure = {
        figId,
        kind,
        language,
        ...(angle !== undefined ? { angle } : {}),
        methodLevel,
        sessionId: this.targetSessionId,
        stagedAt: Date.now(),
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
   * (`.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`), so a generated detail
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
    context?: { mermaid?: string; blurbs?: Record<string, string> }
  }): Promise<{ figId: string; prompt: string } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      const language = request.language ?? '中文'
      const kind: DynamicFigureKind = request.kind === 'seq-edge' ? 'seq-edge' : request.kind === 'overview' ? 'overview' : 'flow-subgraph'
      const targetKey = dynamicTargetKey(kind, request.target)
      const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const prompt = buildDynamicFigurePrompt(kind, index, language, figId, request.target, request.context?.mermaid, request.context?.blurbs)
      this.pendingFigure = {
        figId,
        kind,
        language,
        sessionId: this.targetSessionId,
        stagedAt: Date.now(),
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

  /**
   * Read one cached dynamic figure (`.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`).
   * The panel calls this after the turn completes (and on every later hover)
   * so a generated detail opens instantly without re-generating.
   * @param request - dynamic kind, target key, role language.
   * @returns the cached diagram, or null when absent.
   */
  @Remote('dynamicFigure')
  async remoteDynamicFigure(request: { kind: 'seq-edge' | 'flow-subgraph'; targetKey: string; language?: string }): Promise<{ title: string; diagram: string; kind: 'seq-edge' | 'flow-subgraph'; targetKey: string } | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const kind: DynamicFigureKind = request.kind === 'seq-edge' ? 'seq-edge' : 'flow-subgraph'
    const language = request.language ?? '中文'
    try {
      const target = await this.ctx.fs.resolve(dynamicFigureCacheName(kind, request.targetKey, language), { cwd: root })
      const text = await this.ctx.fs.readText(target)
      const parsed = JSON.parse(text) as { title?: string; diagram?: string }
      if (typeof parsed.diagram !== 'string' || parsed.diagram === '') return null
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        diagram: parsed.diagram,
        kind,
        targetKey: request.targetKey,
      }
    } catch {
      return null
    }
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
   * Structured figure data for the interaction tab (cached per language).
   * @param request - role language.
   * @returns event array, null, or an error.
   */
  @Remote('events')
  async remoteEvents(request: { language?: string; methodLevel?: boolean }): Promise<Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const language = request.language ?? '中文'
    const methods = request.methodLevel === true
    const cached = await readStructuredCache(this.ctx.fs, root, language, 'interaction', methods) as Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null
    if (cached !== null) return cached
    // Shared analysis profile fallback: the events figure reads the profile's
    // sanitized events when no structured cache exists (AI generate still
    // writes the structured cache on demand). Skipped in method-level mode
    // (the shared profile is entity-level by design).
    if (methods) return null
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return null
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      const profile = await ensureAnalysisProfile(this.ctx, this.ctx.fs, root, index, language, this.sessionPolicy())
      const events = profile.events
      if (events !== undefined && events.length > 0) return events
    } catch (error) {
      console.warn(`[arch-lens] events profile fallback failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return null
  }

  /**
   * Flow diagram via the dual chain: architecture doc flow block first
   * (verbatim mermaid, or LLM transcode of a pseudo-code block — both
   * `source: 'doc'` with an anchor), then the shared analysis profile, then
   * LLM induction from code metadata (`source: 'flow'`, non-authoritative).
   * Non-doc stages honor the requested viewpoint (angle): overview / event /
   * pipeline. Cached per language + angle.
   * @param request - role language, force flag and the flow viewpoint.
   * @returns the flow diagram or an error.
   */
  @Remote('flow')
  async remoteFlow(request: { language?: string; force?: boolean; angle?: FlowAngle; methodLevel?: boolean }): Promise<ArchLensFlowResult | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root, this.sessionPolicy())
      return await flowDiagram(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true, request.angle ?? 'event', this.sessionPolicy(), request.methodLevel === true)
    } catch (error) {
      return { error: `flow diagram failed: ${error instanceof Error ? error.message : String(error)}` }
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
    const graph = await this.graph()
    if ('error' in graph) return graph
    return analyzeWorkspace(this.ctx.fs, graph)
  }

  /**
   * AI one-line duty summaries for the package catalog, in the role language.
   * @param request - output language (default 中文).
   * @returns id → summary map, or an error.
   */
  @Remote('summarizeDuties')
  async remoteSummarizeDuties(request: { language?: string }): Promise<Record<string, string> | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const graph = await this.graph()
    if ('error' in graph) return graph
    return summarizeDuties(this.ctx, this.ctx.fs, root, graph, request.language ?? '中文', this.sessionPolicy())
  }

  /**
   * AI learning-progress summary: contrasts the note targets against the
   * scanned graph and appends a model-generated entry to the note file bottom.
   * @param request - role language and whether to force regeneration.
   * @returns progress stats plus the generated summary, or an error.
   */
  @Remote('progress')
  async remoteProgress(request: { language?: string; force?: boolean }): Promise<ArchLensProgressResult | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const graph = await this.graph()
    if ('error' in graph) return graph
    return summarizeProgress(this.ctx, this.ctx.fs, root, graph, this.notesFile, request.language ?? '中文', request.force === true, this.sessionPolicy())
  }

  /**
   * Read-only learning-progress statistics (no LLM call).
   * @returns asked/unasked lists and the coverage percentage.
   */
  @Remote('progressStats')
  async remoteProgressStats(): Promise<{ asked: string[]; unasked: string[]; total: number; progress: number } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const graph = await this.graph()
    if ('error' in graph) return graph
    return progressStats(this.ctx.fs, root, graph, this.notesFile)
  }

  /**
   * LLM usage accounting: totals and the newest recorded calls (see
   * llm-stats.ts for the estimation rule). The snapshot is also persisted to
   * `.arch-lens-llm-stats.json` in the workspace root so token spend is
   * inspectable outside the panel and survives restarts.
   * @returns the accounting snapshot.
   */
  @Remote('llmStats')
  async remoteLlmStats(): Promise<LlmStatsSnapshot> {
    const snapshot = llmStatsSnapshot()
    const root = this.resolveRoot()
    if (typeof root === 'string') {
      try {
        const target = await this.ctx.fs.resolve('.arch-lens-llm-stats.json', { cwd: root })
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
    this.pending = {
      target: request.target ?? '架构讲解',
      question: request.text ?? '',
      sessionId: request.sessionId ?? null,
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
              : writeDynamicFigureCache(
                  this.ctx.fs, root, stagedFigure.dynamic.kind, stagedFigure.dynamic.targetKey, parsed,
                  stagedFigure.language, resolveSessionPolicy(this.ctx, session.id),
                )
            void write.then(result => {
              console.log(`[arch-lens] session figure ${stagedFigure.figId} (${stagedFigure.kind}): ${'ok' in result ? 'cached' : result.error}`)
            })
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
