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
import { dependencyFlowchart, packageErDiagram } from './mermaid.ts'
import type {
  ArchLensCodeInsight,
  ArchLensComponentDetail,
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
   * Invalidate the graph cache and rescan.
   * @returns the fresh graph or error.
   */
  @Remote('refresh')
  async remoteRefresh(): Promise<ArchLensGraph | { error: string }> {
    this.graphCache = null
    return this.graph()
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
