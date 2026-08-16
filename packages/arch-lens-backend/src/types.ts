/**
 * Wire types for the Arch Lens backend service.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/types
 */

/** One scanned package node of the workspace graph. */
export interface ArchLensPackageNode {
  /** Short package name (dsh- prefix stripped). */
  id: string
  /** Same as id; kept for symmetry with the client view. */
  short: string
  /** packages/<group> directory name. */
  group: string
  /** First README paragraph, trimmed. */
  blurb: string
  /** First paragraph of README.zh.md, when present (localized duty text). */
  blurbZh?: string
  /** src/ file names (bounded). */
  files: string[]
  /** dsh-* peer dependency short names. */
  deps: string[]
  /** Absolute package directory path. */
  path: string
  /** Precomputed popup detail, sent with the graph so clicks open instantly. */
  detail: ArchLensComponentDetail
}

/** One dependency edge between scanned nodes. */
export interface ArchLensEdge {
  from: string
  to: string
}

/** The complete scanned workspace graph. */
export interface ArchLensGraph {
  /** Absolute workspace root that was scanned. */
  root: string
  /** Sorted group directory names. */
  groups: string[]
  nodes: ArchLensPackageNode[]
  edges: ArchLensEdge[]
}

/** Role classification of one src file. */
export type ArchLensFileRole = 'entry' | 'types' | 'invariant' | 'assembly' | 'test' | ''

/** One src file of a package with its role guess. */
export interface ArchLensFileRef {
  name: string
  role: ArchLensFileRole
}

/** Per-package detail projection for the client popup. */
export interface ArchLensComponentDetail {
  id: string
  short: string
  group: string
  blurb: string
  files: ArchLensFileRef[]
  /** dsh-* dependency short names. */
  deps: string[]
  /** Packages that depend on this one. */
  dependents: string[]
  /** Entry source head, condensed (bounded). */
  snippet: string
  /** Registration lines extracted from the entry source. */
  keyLines: string[]
}

/** One recorded note entry, newest first. */
export interface ArchLensNoteEntry {
  time: string
  target: string
  preview: string
}

/** The note file listing response. */
export interface ArchLensNotesResult {
  path: string
  entries: ArchLensNoteEntry[]
}

/** Error result shape shared by all remote methods. */
export interface ArchLensError {
  error: string
}

/** Editable prompt configuration, persisted per workspace. */
export interface ArchLensPromptConfig {
  /** Overview explain prompt template; `{root}`/`{core}` placeholders allowed. */
  overviewPrompt?: string
  /** Unit explain style appended to component/event/data questions. */
  explainStyle?: string
  /** Output language for all explanations and summaries (default '中文'). */
  language?: string
  /** Use the per-language default templates instead of the saved overrides (default: inferred). */
  useDefaults?: boolean
}

/** The persisted prompt configuration plus its storage path. */
export interface ArchLensPromptConfigResult {
  path: string
  config: ArchLensPromptConfig
}

/** One code-derived insight for a package. */
export interface ArchLensCodeInsight {
  /** Package short id. */
  id: string
  /** Services this package provides (ctx.provide / extends Service / TypertRemoteService). */
  provides: string[]
  /** Events this package listens to (ctx.on / @Remote / on(...)). */
  listens: string[]
  /** Tools this package registers (tools.register / defineTool). */
  tools: string[]
  /** Remote method export names. */
  remotes: string[]
}
