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

/** Backend Remote face: every method resolves to a RemoteResult envelope. */
export interface ArchLensRemote {
  graph(): Promise<RemoteResult<ArchLensGraph | { error: string }>>
  refresh(): Promise<RemoteResult<ArchLensGraph | { error: string }>>
  refreshIndex(): Promise<RemoteResult<{ ok: true }>>
  setSession(sessionId: string | null): Promise<RemoteResult<{ ok: true }>>
  component(request: { id: string }): Promise<RemoteResult<ArchLensComponentDetail | { error: string }>>
  notes(): Promise<RemoteResult<ArchLensNotesResult | { error: string }>>
  notePending(request: { target: string; text: string; sessionId?: string }): Promise<RemoteResult<{ ok: true }>>
  promptConfig(): Promise<RemoteResult<ArchLensPromptConfigResult>>
  promptConfigSave(request: ArchLensPromptConfig): Promise<RemoteResult<ArchLensPromptConfigResult | { error: string }>>
  mermaidDeps(): Promise<RemoteResult<{ kind: 'flowchart'; source: string } | { error: string }>>
  mermaidEr(): Promise<RemoteResult<{ kind: 'erDiagram'; source: string } | { error: string }>>
  mermaidIndexed(request: { kind: 'flowchart' | 'erDiagram' }): Promise<RemoteResult<{ kind: 'flowchart' | 'erDiagram'; source: string } | { error: string }>>
  mermaidCore(request: { kind: 'flowchart' | 'erDiagram'; language?: string; force?: boolean; methodLevel?: boolean }): Promise<RemoteResult<{ kind: 'flowchart' | 'erDiagram'; source: string; core: ArchLensCoreGraph } | { error: string }>>
  conceptTree(request: { language?: string; force?: boolean; methodLevel?: boolean }): Promise<RemoteResult<RemoteConceptNode[] | { error: string }>>
  generateDocs(request: { language?: string }): Promise<RemoteResult<{ path: string } | { error: string }>>
  generateDocSection(request: { kind: 'concepts' | 'seq' | 'interaction' | 'deps' | 'er' | 'catalog'; language?: string }): Promise<RemoteResult<{ path: string } | { error: string }>>
  sequence(request: { language?: string; prefer?: 'code' | 'flow'; methodLevel?: boolean }): Promise<RemoteResult<ArchLensSequenceResult | null | { error: string }>>
  regenerateFigure(request: { kind: 'concepts' | 'seq' | 'flow' | 'interaction' | 'deps' | 'er'; language?: string; methodLevel?: boolean }): Promise<RemoteResult<RegenerateFigureResult | { error: string }>>
  events(request: { language?: string; methodLevel?: boolean }): Promise<RemoteResult<Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null | { error: string }>>
  flow(request: { language?: string; force?: boolean; angle?: FlowAngle; methodLevel?: boolean }): Promise<RemoteResult<ArchLensFlowResult | { error: string }>>
  cancelGeneration(): Promise<RemoteResult<{ ok: boolean }>>
  generationStatus(): Promise<RemoteResult<GenerationStatus | null>>
  generationStatusNext(request: { since?: number }): Promise<RemoteResult<{ status: GenerationStatus; seq: number } | null>>
  lastAnswer(request: { sessionId?: string }): Promise<RemoteResult<{ text: string; reasoning: string } | { error: string }>>
  analyze(): Promise<RemoteResult<ArchLensCodeInsight[] | { error: string }>>
  summarizeDuties(request: { language?: string }): Promise<RemoteResult<Record<string, string> | { error: string }>>
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
 * @returns the business value (envelope unwrapped).
 */
export async function directRemote<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const rpcId = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const response = await fetch(`/api/archLens/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
