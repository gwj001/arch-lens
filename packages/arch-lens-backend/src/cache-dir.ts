/**
 * Workspace-relative directory holding EVERY `.arch-lens-*.json` cache
 * (scan graph, code index, per-kind figure caches, llm stats, prompts).
 * The code-index tree-sitter provider mirrors this literal (`index/`) so all
 * artifacts land in one place; keep the two in sync.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/cache-dir
 */

/** Cache directory name, relative to the workspace root. */
export const CACHE_DIR = 'index'
