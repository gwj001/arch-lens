/**
 * Entity-level figure registry: one spec per tab figure owning its
 * AUTHORITATIVE cache file name (delegated to the chain module that writes
 * it — the historical generateAll bug hand-spelled cache names and the flow
 * name never matched flow.ts's real file, so flow figures could never be
 * skipped in incremental mode) and its unified build entry. The write paths
 * (generateAll, later ensureFigure for doc assembly) consume this registry so
 * there is exactly ONE list of figures, ONE name source and ONE force
 * semantic.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/figures
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index'
import { readFactVersion, readRawCache } from './fact-cache.ts'
import { conceptTree, conceptCacheName } from './concept.ts'
import { flowDiagram, flowCacheName } from './flow.ts'
import { coreGraph, coreCacheName } from './core.ts'
import { summarizeDuties, summariesCacheName } from './summarize.ts'
import { writeStructuredCache, seqCacheName, eventsCacheName } from './docsgen.ts'
import type { ArchLensGraph } from './types.ts'

/** Entity-level figure ids (wire-stable step labels of generateAll). */
export type EntityFigureId =
  | 'concepts'
  | 'flow-event'
  | 'flow-pipeline'
  | 'seq'
  | 'interaction'
  | 'core'
  | 'duties'

/** Everything a figure chain needs for one build; shared by all specs. */
export interface FigureEnv {
  ctx: Context
  fs: FileSystem
  root: string
  /** Code index facts (every chain except duties). */
  index: CodeIndexResult
  /** Scanned graph facts (duties). */
  graph: ArchLensGraph
  /** Role language (cache key + output language). */
  language: string
  /** Session-scoped sandbox policy for cache writes. */
  policy?: SandboxExecutionPolicy
}

/** One registered entity-level figure. */
export interface FigureKindSpec {
  id: EntityFigureId
  /**
   * The AUTHORITATIVE cache file name (CACHE_DIR-relative) for this figure at
   * a role language. MUST delegate to the owning chain module — never
   * re-spell the name here, or incremental validity checks silently break.
   * @param language - role language.
   * @returns the cache file name.
   */
  cacheName(language: string): string
  /**
   * Shared build entry: chain order is the module's own (cache → docs →
   * shared profile → LLM). `force` bypasses the chain's leading cache read
   * (used once the caller already knows the cache is missing/stale).
   * @param env - the figure environment.
   * @param force - regenerate even when the chain's own cache check would hit.
   * @returns the figure data, or an `{ error }` result.
   */
  build(env: FigureEnv, force: boolean): Promise<unknown>
}

/** The ONE entity-level figure list (order = historical generateAll steps). */
export const FIGURE_SPECS: readonly FigureKindSpec[] = [
  {
    id: 'concepts',
    cacheName: language => conceptCacheName(language),
    build: (env, force) => conceptTree(env.ctx, env.fs, env.root, env.index, env.language, force, env.policy),
  },
  {
    id: 'flow-event',
    cacheName: language => flowCacheName(language, 'event'),
    build: (env, force) => flowDiagram(env.ctx, env.fs, env.root, env.index, env.language, force, 'event', env.policy),
  },
  {
    id: 'flow-pipeline',
    cacheName: language => flowCacheName(language, 'pipeline'),
    build: (env, force) => flowDiagram(env.ctx, env.fs, env.root, env.index, env.language, force, 'pipeline', env.policy),
  },
  {
    id: 'seq',
    cacheName: language => seqCacheName(language),
    build: env => writeStructuredCache(env.ctx, env.fs, env.root, env.index, env.language, 'seq', env.policy),
  },
  {
    id: 'interaction',
    cacheName: language => eventsCacheName(language),
    build: env => writeStructuredCache(env.ctx, env.fs, env.root, env.index, env.language, 'interaction', env.policy),
  },
  {
    id: 'core',
    cacheName: language => coreCacheName(language),
    build: (env, force) => coreGraph(env.ctx, env.fs, env.root, env.index, env.language, force, env.policy),
  },
  {
    id: 'duties',
    cacheName: language => summariesCacheName(language),
    build: env => summarizeDuties(env.ctx, env.fs, env.root, env.graph, env.language, env.policy),
  },
]

/**
 * Whether a figure cache exists and was written against the CURRENT facts
 * version (a versioned envelope with `v === factsVersion`; legacy/corrupt/
 * invalidated files and an unknown facts version all read as invalid).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param cacheFile - the CACHE_DIR-relative file name from a spec.
 * @param factsVersion - the current facts version (0 = unknown ⇒ never valid).
 * @returns whether the cached figure may be served.
 */
export async function isFigureCacheValid(
  fs: FileSystem,
  root: string,
  cacheFile: string,
  factsVersion: number,
): Promise<boolean> {
  if (factsVersion === 0) return false
  const target = await fs.resolve(cacheFile, { cwd: root }).catch(() => null)
  if (target === null) return false
  const raw = await readRawCache(fs, target)
  return raw !== null && raw.v === factsVersion
}

/** Outcome of one entity-figure rebuild pass. */
export interface EntityFigurePassOutcome {
  rebuilt: string[]
  skipped: string[]
  errors: string[]
}

/**
 * The generateAll loop shared by「🔁 全量重建」/「⚡ 变动更新」(behavior
 * unchanged from the hand-rolled steps): incremental mode skips every figure
 * whose cache is valid against the current facts version and force-redraws
 * only the missing/stale ones; non-incremental force-redraws everything.
 * Every step runs even when one fails; the caller formats `errors`.
 * @param env - the figure environment.
 * @param incremental - smart-incremental mode (frontend default: true).
 * @param specs - the figure list (defaults to the registry; parameterized for tests).
 * @returns the rebuilt/skipped ids and collected errors.
 */
export async function runEntityFigurePass(
  env: FigureEnv,
  incremental: boolean,
  specs: readonly FigureKindSpec[] = FIGURE_SPECS,
): Promise<EntityFigurePassOutcome> {
  const factsVersion = incremental ? await readFactVersion(env.fs, env.root) : 0
  const rebuilt: string[] = []
  const skipped: string[] = []
  const errors: string[] = []
  for (const spec of specs) {
    if (incremental && await isFigureCacheValid(env.fs, env.root, spec.cacheName(env.language), factsVersion)) {
      skipped.push(spec.id)
      continue
    }
    try {
      const result = await spec.build(env, true)
      if (typeof result === 'object' && result !== null && 'error' in result) {
        errors.push(`${spec.id}: ${(result as { error: string }).error}`)
      } else {
        rebuilt.push(spec.id)
      }
    } catch (error) {
      errors.push(`${spec.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { rebuilt, skipped, errors }
}
