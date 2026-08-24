/**
 * The archLens Remote face injected through `ctx.remote.archLens`. Method
 * signatures come from the generated remote-client artifact (TypertRemoteMap
 * merge); this alias keeps the component import surface small.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/remote
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ArchLensCodeInsight,
  ArchLensComponentDetail,
  ArchLensCoreGraph,
  ArchLensFlowResult,
  ArchLensGraph,
  ArchLensNotesResult,
  ArchLensProgressResult,
  ArchLensPromptConfig,
  ArchLensPromptConfigResult,
  ArchLensSequenceResult,
  FlowAngle,
  GenerationStatus,
  LlmStatsSnapshot,
  RegenerateFigureResult,
  WorkspaceChanges,
} from '@deepseek-ai/dsh-arch-lens-backend'

/** Concept-tree node returned by the backend chain (matches ConceptNode shape). */
export interface RemoteConceptNode {
  id: string
  name: string
  desc: string
  inside?: string
  pkg?: string
  children?: RemoteConceptNode[]
}

/** 原地追问重画的结果：与各 tab 正常 RPC 返回形状一致。 */
export type FollowUpResult =
  | ArchLensFlowResult
  | ArchLensSequenceResult
  | RemoteConceptNode[]
  | Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }>
  | { kind: 'flowchart'; source: string; core: ArchLensCoreGraph }
  | { title: string; diagram: string; kind: 'overview'; targetKey: string }

/** Backend Remote face: every method resolves to a RemoteResult envelope. */
export interface ArchLensRemote {
  graph(): Promise<RemoteResult<ArchLensGraph | null | { error: string }>>
  refresh(): Promise<RemoteResult<
    | { graph: ArchLensGraph; changed: true; changes: WorkspaceChanges }
    | { graph: ArchLensGraph | null; changed: false; changes: null }
    | { error: string }
  >>
  refreshIndex(): Promise<RemoteResult<{ ok: true }>>
  generateAll(request: { language?: string }): Promise<RemoteResult<{ ok: true } | { error: string }>>
  setSession(sessionId: string | null): Promise<RemoteResult<{ ok: true }>>
  component(request: { id: string }): Promise<RemoteResult<ArchLensComponentDetail | { error: string }>>
  notes(): Promise<RemoteResult<ArchLensNotesResult | { error: string }>>
  notePending(request: { target: string; text: string; sessionId?: string }): Promise<RemoteResult<{ ok: true }>>
  promptConfig(): Promise<RemoteResult<ArchLensPromptConfigResult>>
  promptConfigSave(request: ArchLensPromptConfig): Promise<RemoteResult<ArchLensPromptConfigResult | { error: string }>>
  mermaidDeps(): Promise<RemoteResult<{ kind: 'flowchart'; source: string } | { error: string }>>
  mermaidEr(): Promise<RemoteResult<{ kind: 'erDiagram'; source: string } | { error: string }>>
  mermaidIndexed(request: { kind: 'flowchart' | 'erDiagram' }): Promise<RemoteResult<{ kind: 'flowchart' | 'erDiagram'; source: string } | { error: string }>>
  mermaidCore(request: { kind: 'flowchart' | 'erDiagram'; language?: string; methodLevel?: boolean }): Promise<RemoteResult<{ kind: 'flowchart' | 'erDiagram'; source: string; core: ArchLensCoreGraph } | null | { error: string }>>
  conceptTree(request: { language?: string; methodLevel?: boolean }): Promise<RemoteResult<RemoteConceptNode[] | null | { error: string }>>
  generateDocs(request: { language?: string }): Promise<RemoteResult<{ path: string } | { error: string }>>
  generateDocSection(request: { kind: 'concepts' | 'seq' | 'interaction' | 'deps' | 'er' | 'catalog'; language?: string }): Promise<RemoteResult<{ path: string } | { error: string }>>
  sequence(request: { language?: string; methodLevel?: boolean }): Promise<RemoteResult<ArchLensSequenceResult | null | { error: string }>>
  regenerateFigure(request: { kind: 'concepts' | 'seq' | 'flow' | 'interaction' | 'deps' | 'er'; language?: string; methodLevel?: boolean }): Promise<RemoteResult<RegenerateFigureResult | { error: string }>>
  events(request: { language?: string; methodLevel?: boolean }): Promise<RemoteResult<Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null | { error: string }>>
  flow(request: { language?: string; angle?: FlowAngle; methodLevel?: boolean }): Promise<RemoteResult<ArchLensFlowResult | null | { error: string }>>
  figurePrompt(request: { kind: 'concepts' | 'seq' | 'flow' | 'interaction' | 'deps' | 'er'; language?: string; angle?: FlowAngle; methodLevel?: boolean }): Promise<RemoteResult<{ figId: string; prompt: string } | { error: string }>>
  dynamicFigurePrompt(request: { kind: 'seq-edge' | 'flow-subgraph' | 'overview'; target: { from?: string; to?: string; label?: string; stage?: string }; language?: string; context?: { mermaid?: string; blurbs?: Record<string, string> } }): Promise<RemoteResult<{ figId: string; prompt: string } | { error: string }>>
  dynamicFigure(request: { kind: 'seq-edge' | 'flow-subgraph' | 'overview'; targetKey: string; language?: string }): Promise<RemoteResult<{ title: string; diagram: string; kind: string; targetKey: string } | null | { error: string }>>
  customFigurePrompt(request: { text: string; figureId?: string; language?: string; context?: { blurbs?: Record<string, string> } }): Promise<RemoteResult<{ figId: string; figureId: string; prompt: string } | { error: string }>>
  customFigure(request: { figureId?: string }): Promise<RemoteResult<{ figureId: string; title: string; diagram: string; summary: string; text: string; saved?: boolean } | null | { error: string }>>
  customFigureList(): Promise<RemoteResult<Array<{ figureId: string; title: string; text: string; saved: boolean; savedAt?: string }> | { error: string }>>
  saveCustomFigure(request: { figureId: string; language?: string }): Promise<RemoteResult<{ ok: true; path: string } | { error: string }>>
  customFigureDelete(request: { figureId: string }): Promise<RemoteResult<{ ok: true } | { error: string }>>
  figureFollowUp(request: { kind: 'flow' | 'seq' | 'concepts' | 'events' | 'core' | 'overview'; language?: string; angle?: FlowAngle; methodLevel?: boolean; followUp: string }): Promise<RemoteResult<FollowUpResult | { error: string }>>
  cancelGeneration(): Promise<RemoteResult<{ ok: boolean }>>
  generationStatus(): Promise<RemoteResult<GenerationStatus | null>>
  generationStatusNext(request: { since?: number }): Promise<RemoteResult<{ status: GenerationStatus; seq: number } | null>>
  lastAnswer(request: { sessionId?: string }): Promise<RemoteResult<{ text: string; reasoning: string } | { error: string }>>
  analyze(): Promise<RemoteResult<ArchLensCodeInsight[] | { error: string }>>
  summarizeDuties(request: { language?: string; force?: boolean }): Promise<RemoteResult<Record<string, string> | null | { error: string }>>
  progress(request: { language?: string; force?: boolean }): Promise<RemoteResult<ArchLensProgressResult | { error: string }>>
  progressStats(): Promise<RemoteResult<{ asked: string[]; unasked: string[]; total: number; progress: number } | { error: string }>>
  llmStats(): Promise<RemoteResult<LlmStatsSnapshot>>
}

/** Unwrap a RemoteResult envelope to the business value or a thrown error. */
export async function unwrapRemote<T>(promise: Promise<RemoteResult<T>>): Promise<T> {
  const result = await promise
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

/**
 * Direct gateway call for Remote methods that may be missing from the
 * injected namespace: the client method table can lag a host upgrade (the
 * injected `ctx.remote.archLens` is a snapshot taken when the page loaded).
 * Uses the same client-request envelope as the harness remote channel, so
 * new methods (llmStats / regenerateFigure) work immediately after a host
 * restart without waiting for the client table to catch up.
 * @param method - the wire method name (e.g. 'llmStats').
 * @param args - the remote parameters (descriptor field names, e.g. { request }).
 * @param signal - optional AbortSignal: aborting it drops the pending
 *   response locally (the client treats the call as cancelled).
 * @returns the business value (envelope unwrapped).
 */
export async function directRemote<T>(method: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const rpcId = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const response = await fetch(`/api/archLens/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(signal === undefined ? {} : { signal }),
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: `archLens/${method}`,
      payload: { args },
    }),
  })
  const json = await response.json() as { result?: { ok: boolean; value?: unknown; error?: { code?: string; message?: string } } }
  if (json.result?.ok !== true) {
    throw new Error(json.result?.error?.message ?? `archLens/${method} call failed`)
  }
  return json.result.value as T
}
