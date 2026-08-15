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
import { analyzeWorkspace } from './analyze.ts'
import { dependencyFlowchart, packageErDiagram } from './mermaid.ts'
import type {
  ArchLensCodeInsight,
  ArchLensComponentDetail,
  ArchLensGraph,
  ArchLensNotesResult,
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
      if (this.pending !== null && this.pending.sessionId !== null && session.id !== this.pending.sessionId) return
      const message = event.data.message
      let answer = ''
      for (const block of message.content) {
        if (block.type === 'text') answer += block.text
      }
      const staged = this.pending
      this.pending = null
      const root = this.resolveRoot()
      if (typeof root !== 'string') return
      void appendNote(
        this.ctx.fs,
        root,
        {
          target: staged?.target ?? '架构讲解',
          question: staged?.question ?? '',
          answer,
        },
        this.notesFile,
      )
    })
  }
}

export default ArchLensService
