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
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import s from '@deepseek-ai/schemastery'
import { appendNote, readNotes } from './notes.ts'
import { scanWorkspace } from './scan.ts'
import { summarizeDuties } from './summarize.ts'
import { progressStats, summarizeProgress } from './progress.ts'
import { analyzeWorkspace } from './analyze.ts'
import { conceptTree } from './concept.ts'
import { flowDiagram } from './flow.ts'
import { generateDocSection, generateFullDocs, readStructuredCache } from './docsgen.ts'
import { dependencyFlowchart, entityErDiagram, importFlowchart, packageErDiagram, coreFlowchart, coreErDiagram } from './mermaid.ts'
import { coreGraph } from './core.ts'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import type {
  ArchLensCodeInsight,
  ArchLensComponentDetail,
  ArchLensConceptNode,
  ArchLensCoreGraph,
  ArchLensFlowResult,
  ArchLensGraph,
  ArchLensNotesResult,
  ArchLensProgressResult,
  ArchLensPromptConfig,
  ArchLensPromptConfigResult,
} from './types.ts'

export type * from './types.ts'

/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = 'ARCH-NOTES.md'

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
  private graphCache: ArchLensGraph | { error: string } | null = null
  private graphInFlight: Promise<ArchLensGraph | { error: string }> | null = null
  private pending: PendingNote | null = null

  /**
   * @param ctx - host context carrying fs and sandboxPolicy.
   * @param config - optional notes file name.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'archLens')
    this.notesFile = config.notesFile ?? DEFAULT_NOTES_FILE
  }

  /** Resolve the workspace root from the session sandbox policy. */
  private resolveRoot(): string | { error: string } {
    const sandboxPolicy = this.ctx.get('sandboxPolicy')
    const root = sandboxPolicy?.workspaceRoot
    if (root === undefined) return { error: 'cannot resolve workspace root (sandboxPolicy.workspaceRoot missing)' }
    return root
  }

  /** Scan (with cache) the workspace package tree; concurrent callers share one scan. */
  private graph(): Promise<ArchLensGraph | { error: string }> {
    if (this.graphCache !== null) return Promise.resolve(this.graphCache)
    if (this.graphInFlight !== null) return this.graphInFlight
    const root = this.resolveRoot()
    if (typeof root !== 'string') return Promise.resolve(root)
    const fs = this.ctx.fs
    this.graphInFlight = scanWorkspace(fs, root).then(result => {
      this.graphInFlight = null
      this.graphCache = result
      return result
    })
    return this.graphInFlight
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
    this.graphCache = null
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

  /** Invalidate the code-index for the workspace (no-op when unavailable). */
  private async refreshCodeIndex(): Promise<void> {
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return
    const root = this.resolveRoot()
    if (typeof root !== 'string') return
    try {
      await codeIndex.refresh(root)
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
        if (['.arch-lens-concept-', '.arch-lens-sequence-', '.arch-lens-events-', '.arch-lens-flow-', '.arch-lens-core-'].some(prefix => name.startsWith(prefix)) && name.endsWith('.json')) {
          try {
            // Blank the file: readers treat an unparseable cache as absent
            // (the fs service has no delete API), so the next read rebuilds.
            await fs.writeText(entry.target, '')
            console.log(`[arch-lens] invalidated AI cache ${name}`)
          } catch {
            // best-effort invalidation
          }
        }
      }
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
    const codeIndex = this.ctx.get('codeIndex') as { indexWorkspace(root: string): Promise<CodeIndexResult> } | undefined
    if (codeIndex === undefined) {
      return { error: 'codeIndex service unavailable' }
    }
    try {
      const index = await codeIndex.indexWorkspace(root)
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
  async remoteMermaidCore(request: { kind: 'flowchart' | 'erDiagram'; language?: string; force?: boolean }): Promise<{ kind: 'flowchart' | 'erDiagram'; source: string; core: ArchLensCoreGraph } | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root)
      const core = await coreGraph(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true)
      if ('error' in core) return core
      const source = request.kind === 'flowchart' ? coreFlowchart(index, core.ids) : coreErDiagram(index, core.ids)
      return { kind: request.kind, source, core }
    } catch (error) {
      return { error: `core diagram failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Concept tree over the code-index entities: packages → top-level
   * classes/interfaces/functions → methods. This is the code-grounded
   * replacement for the curated DSH concept hierarchy — precise for ANY
   * workspace language the index supports.
   * @returns concept-tree nodes or an error.
   */
  @Remote('entityTree')
  async remoteEntityTree(): Promise<Array<{ id: string; name: string; desc: string; pkg?: string; children?: Array<{ id: string; name: string; desc: string }> }> | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.ctx.get('codeIndex') as { indexWorkspace(root: string): Promise<CodeIndexResult> } | undefined
    if (codeIndex === undefined) {
      return { error: 'codeIndex service unavailable' }
    }
    try {
      const index = await codeIndex.indexWorkspace(root)
      if (index.language === 'unknown') return { error: 'unsupported workspace language (no package.json / pyproject.toml / pom.xml)' }
      const tree: Array<{ id: string; name: string; desc: string; pkg?: string; children?: Array<{ id: string; name: string; desc: string }> }> = []
      for (const pkg of index.packages) {
        const topLevel = pkg.entities.filter(entity => entity.kind !== 'method' && entity.kind !== 'field')
        if (topLevel.length === 0) continue
        tree.push({
          id: `pkg:${pkg.id}`,
          name: `📦 ${pkg.id}`,
          desc: pkg.language,
          pkg: pkg.id,
          children: topLevel.slice(0, 60).map(entity => ({
            id: `e:${pkg.id}:${entity.name}`,
            name: entity.name,
            desc: `${entity.kind}${entity.modifiers !== undefined && entity.modifiers.length > 0 ? ` ${entity.modifiers.join(', ')}` : ''}`,
            children: entity.children !== undefined && entity.children.length > 0
              ? entity.children.slice(0, 40).map(member => ({ id: `m:${pkg.id}:${entity.name}:${member.name}`, name: member.name, desc: member.kind }))
              : undefined,
          })),
        })
      }
      return tree
    } catch (error) {
      return { error: `entity tree failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Shared codeIndex accessor for the concept/docs remotes. */
  private codeIndexService(): { indexWorkspace(root: string): Promise<CodeIndexResult>; refresh(root: string): Promise<void> } | undefined {
    return this.ctx.get('codeIndex') as { indexWorkspace(root: string): Promise<CodeIndexResult>; refresh(root: string): Promise<void> } | undefined
  }

  /**
   * Concept hierarchy via the one-way chain: architecture doc (extract +
   * LLM enhance) first, LLM-from-flow as fallback. Cached per language.
   * @param request - role language and whether to force regeneration.
   * @returns concept-tree nodes or an error.
   */
  @Remote('conceptTree')
  async remoteConceptTree(request: { language?: string; force?: boolean }): Promise<ArchLensConceptNode[] | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root)
      const tree = await conceptTree(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true)
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
      const index = await codeIndex.indexWorkspace(root)
      return await generateFullDocs(this.ctx, this.ctx.fs, root, index, request.language ?? '中文')
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
      const index = await codeIndex.indexWorkspace(root)
      return await generateDocSection(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.kind)
    } catch (error) {
      return { error: `generate doc section failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * Structured figure data for the sequence tab: LLM-generated from the code
   * index (cached per language); the client falls back to curated data when
   * this returns null.
   * @param request - role language.
   * @returns message array, null, or an error.
   */
  @Remote('sequence')
  async remoteSequence(request: { language?: string }): Promise<Array<{ from: string; to: string; label: string }> | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    return (await readStructuredCache(this.ctx.fs, root, request.language ?? '中文', 'seq')) as Array<{ from: string; to: string; label: string }> | null
  }

  /**
   * Structured figure data for the interaction tab (cached per language).
   * @param request - role language.
   * @returns event array, null, or an error.
   */
  @Remote('events')
  async remoteEvents(request: { language?: string }): Promise<Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    return (await readStructuredCache(this.ctx.fs, root, request.language ?? '中文', 'interaction')) as Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null
  }

  /**
   * Flow diagram via the dual chain: architecture doc flow block first
   * (verbatim mermaid, or LLM transcode of a pseudo-code block — both
   * `source: 'doc'` with an anchor), LLM induction from code metadata as the
   * fallback (`source: 'flow'`, non-authoritative). Cached per language.
   * @param request - role language and whether to force regeneration.
   * @returns the flow diagram or an error.
   */
  @Remote('flow')
  async remoteFlow(request: { language?: string; force?: boolean }): Promise<ArchLensFlowResult | { error: string }> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return root
    const codeIndex = this.codeIndexService()
    if (codeIndex === undefined) return { error: 'codeIndex service unavailable' }
    try {
      const index = await codeIndex.indexWorkspace(root)
      return await flowDiagram(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true)
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
    return summarizeDuties(this.ctx, this.ctx.fs, root, graph, request.language ?? '中文')
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
    return summarizeProgress(this.ctx, this.ctx.fs, root, graph, this.notesFile, request.language ?? '中文', request.force === true)
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
   * Stage question metadata for the next assistant/message answer. Memory
   * only — the file write stays exclusively on the event path below.
   * @param request - target label, question text, and calling session id.
   * @returns acknowledgement.
   */
  @Remote('notePending')
  async remoteNotePending(request: {
    target: string
    text: string
    sessionId?: string
  }): Promise<{ ok: true }> {
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
      await fs.writeText(target, JSON.stringify(merged, null, 2))
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
