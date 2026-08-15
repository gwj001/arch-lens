/**
 * The archLens Remote face injected through `ctx.remote.archLens`. Method
 * signatures come from the generated remote-client artifact (TypertRemoteMap
 * merge); this alias keeps the component import surface small.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/remote
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { ArchLensCodeInsight, ArchLensComponentDetail, ArchLensGraph, ArchLensNotesResult, ArchLensPromptConfig, ArchLensPromptConfigResult } from '@deepseek-ai/dsh-arch-lens-backend';
/** Backend Remote face: every method resolves to a RemoteResult envelope. */
export interface ArchLensRemote {
    graph(): Promise<RemoteResult<ArchLensGraph | {
        error: string;
    }>>;
    refresh(): Promise<RemoteResult<ArchLensGraph | {
        error: string;
    }>>;
    component(request: {
        id: string;
    }): Promise<RemoteResult<ArchLensComponentDetail | {
        error: string;
    }>>;
    notes(): Promise<RemoteResult<ArchLensNotesResult | {
        error: string;
    }>>;
    notePending(request: {
        target: string;
        text: string;
        sessionId?: string;
    }): Promise<RemoteResult<{
        ok: true;
    }>>;
    promptConfig(): Promise<RemoteResult<ArchLensPromptConfigResult>>;
    promptConfigSave(request: ArchLensPromptConfig): Promise<RemoteResult<ArchLensPromptConfigResult | {
        error: string;
    }>>;
    mermaidDeps(): Promise<RemoteResult<{
        kind: 'flowchart';
        source: string;
    } | {
        error: string;
    }>>;
    mermaidEr(): Promise<RemoteResult<{
        kind: 'erDiagram';
        source: string;
    } | {
        error: string;
    }>>;
    analyze(): Promise<RemoteResult<ArchLensCodeInsight[] | {
        error: string;
    }>>;
    summarizeDuties(request: {
        language?: string;
    }): Promise<RemoteResult<Record<string, string> | {
        error: string;
    }>>;
}
/** Unwrap a RemoteResult envelope to the business value or a thrown error. */
export declare function unwrapRemote<T>(promise: Promise<RemoteResult<T>>): Promise<T>;
//# sourceMappingURL=remote.d.ts.map