/**
 * tree-sitter provider for the code-index seam: detects the workspace
 * language, discovers packages, and extracts entities/imports per language.
 * Cached per workspace root; a fresh call re-indexes.
 * @module @deepseek-ai/dsh-code-index-tree-sitter
 */
import type { Context } from '@deepseek-ai/cordis';
/** Service required before indexing can read files. */
export declare const inject: string[];
/**
 * The tree-sitter provider body: provide the codeIndex service.
 * @param ctx - host context.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map