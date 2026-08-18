/**
 * Service Definition for the code-index capability seam. Providers implement
 * language-aware entity/import extraction; consumers (arch-lens graphs,
 * code-grounded explains, future search) read only this contract.
 * @module @deepseek-ai/dsh-code-index
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { CodeIndexResult } from './types.ts'

export type {
  CodeEntity,
  CodeImport,
  CodeIndexResult,
  CodeLanguage,
  CodePackage,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    codeIndex: CodeIndex
  }
}

/**
 * Code-index Service Definition contract: index a workspace into packages,
 * entities, imports, and composition. Providers are replaceable (tree-sitter
 * today, semantic backends later); consumers never see the provider.
 */
export abstract class CodeIndex extends Service {
  constructor(ctx: Context) {
    super(ctx, 'codeIndex')
  }

  /**
   * Index a workspace: discover packages, extract entities/imports per
   * language, and report the primary language. Results should be cached by
   * the provider per workspace root; a refresh is a new call.
   * @param root - absolute workspace root.
   * @param sandboxPolicy - session-scoped policy for the provider's on-disk
   *   cache writes (the fs sandbox derives its writable root from the calling
   *   session's cwd); omit to fall back to the deployment policy.
   * @returns the workspace index.
   */
  abstract indexWorkspace(root: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<CodeIndexResult>

  /**
   * Invalidate every cached index for a workspace (in-memory and on-disk) so
   * the NEXT `indexWorkspace` call re-indexes from the current sources. The
   * force-rebuild entry point behind "rescan"/"refresh this figure": callers
   * must never see a stale index after code changed.
   * @param root - absolute workspace root.
   * @param sandboxPolicy - session-scoped policy for the on-disk
   *   invalidation write; omit to fall back to the deployment policy.
   */
  abstract refresh(root: string, sandboxPolicy?: SandboxExecutionPolicy): Promise<void>
}

export default CodeIndex
