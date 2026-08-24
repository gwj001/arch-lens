/**
 * 原地追问重画（figureFollowUp）：对某一个 tab 的主图做一次带追问上下文的
 * 重画——读现有图 → LLM 基于「现有图 + 用户追问」重新生成（同一 JSON 契约）
 * → 覆写同一缓存文件 → 返回新图数据。客户端拿到结果直接回填该 tab 的状态，
 * 图就"原地"更新了，不画到别的地方。
 * @module @deepseek-ai/dsh-arch-lens-backend/src/followup
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { FlowAngle, FollowUpKind, FollowUpResult } from './types.ts';
/** Figure kinds that support in-place follow-up redraw. */
export type { FollowUpKind, FollowUpResult };
/**
 * In-place follow-up redraw for ONE tab figure. Reads the existing figure,
 * asks the LLM to extend/redraw it with the follow-up, overwrites the SAME
 * cache, and returns the new figure (same contract as the tab's RPC).
 * @param request - figure kind, role language, viewpoint (flow), method-level
 *   switch, and the user's follow-up instruction.
 * @param signal - optional cancellation: aborting it stops the LLM stream
 *   promptly (the panel's「取消」button while a redraw is running).
 * @returns the new figure data, or an error.
 */
export declare function figureFollowUp(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, request: {
    kind: FollowUpKind;
    language: string;
    angle?: FlowAngle;
    methodLevel?: boolean;
    followUp: string;
}, sandboxPolicy?: SandboxExecutionPolicy, signal?: AbortSignal): Promise<FollowUpResult | {
    error: string;
}>;
//# sourceMappingURL=followup.d.ts.map