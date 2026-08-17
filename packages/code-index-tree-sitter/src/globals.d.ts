/**
 * Ambient declarations for the tree-sitter GRAMMAR packages, which ship no
 * types. The `tree-sitter` core package carries its own declarations
 * (`export = Parser` with a `Parser.Language` type); only the grammars need
 * this shim.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/globals
 */

declare module 'tree-sitter-typescript' {
  import type { Parser } from 'tree-sitter'
  /** TypeScript (not tsx) grammar language object. */
  export const typescript: Parser.Language
  /** TSX grammar language object. */
  export const tsx: Parser.Language
}

declare module 'tree-sitter-python' {
  import type { Parser } from 'tree-sitter'
  /** Python grammar language object. */
  const language: Parser.Language
  export default language
}

declare module 'tree-sitter-java' {
  import type { Parser } from 'tree-sitter'
  /** Java grammar language object. */
  const language: Parser.Language
  export default language
}
