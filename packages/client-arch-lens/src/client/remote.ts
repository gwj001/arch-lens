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
  mermaidCore(request: { kind: 'flowchart' | 'erDiagram'; language?: string; force?: boolean }): Promise<RemoteResult<{ kind: 'flowchart' | 'erDiagram'; source: string; core: ArchLensCoreGraph } | { error: string }>>
  entityTree(): Promise<RemoteResult<Array<{ id: string; name: string; desc: string; pkg?: string; children?: Array<{ id: string; name: string; desc: string }> }> | { error: string }>>
  conceptTree(request: { language?: string; force?: boolean }): Promise<RemoteResult<RemoteConceptNode[] | { error: string }>>
  generateDocs(request: { language?: string }): Promise<RemoteResult<{ path: string } | { error: string }>>
  generateDocSection(request: { kind: 'concepts' | 'seq' | 'interaction' | 'deps' | 'er' | 'catalog'; language?: string }): Promise<RemoteResult<{ path: string } | { error: string }>>
  sequence(request: { language?: string }): Promise<RemoteResult<Array<{ from: string; to: string; label: string }> | null | { error: string }>>
  events(request: { language?: string }): Promise<RemoteResult<Array<{ event: string; mode: string; producers: string[]; consumers: string[]; note: string }> | null | { error: string }>>
  flow(request: { language?: string; force?: boolean }): Promise<RemoteResult<ArchLensFlowResult | { error: string }>>
  analyze(): Promise<RemoteResult<ArchLensCodeInsight[] | { error: string }>>
  summarizeDuties(request: { language?: string }): Promise<RemoteResult<Record<string, string> | { error: string }>>
  progress(request: { language?: string; force?: boolean }): Promise<RemoteResult<ArchLensProgressResult | { error: string }>>
  progressStats(): Promise<RemoteResult<{ asked: string[]; unasked: string[]; total: number; progress: number } | { error: string }>>
}

/** Unwrap a RemoteResult envelope to the business value or a thrown error. */
export async function unwrapRemote<T>(promise: Promise<RemoteResult<T>>): Promise<T> {
  const result = await promise
  if (result.ok) return result.value
  throw new Error(result.error.message)
}
