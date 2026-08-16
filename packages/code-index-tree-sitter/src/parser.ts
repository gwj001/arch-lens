/**
 * Typed surface over the tree-sitter native bindings. The core package ships
 * its own declarations; the grammar packages are shimmed in globals.d.ts.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/parser
 */

import Parser from 'tree-sitter'
import TypeScript from 'tree-sitter-typescript'
import Python from 'tree-sitter-python'
import Java from 'tree-sitter-java'

/** A parsed syntax node (projection of the native node). */
export interface TsNode {
  readonly type: string
  readonly text: string
  readonly startPosition: { readonly row: number; readonly column: number }
  readonly endPosition: { readonly row: number; readonly column: number }
  readonly children: readonly TsNode[]
  readonly namedChildren: readonly TsNode[]
}

/** One parsed source tree. */
export interface TsTree {
  readonly rootNode: TsNode
}

/** Language entry points accepted by the native bindings. */
export type LanguageId = 'typescript' | 'python' | 'java'

/** Load one grammar's language object. */
export function languageFor(id: LanguageId): Parser.Language {
  switch (id) {
    case 'typescript':
      return TypeScript.typescript
    case 'python':
      return Python
    case 'java':
      return Java
  }
}

/**
 * Parse a source string with the given language.
 * @param id - language id.
 * @param source - source text.
 * @returns the parse tree.
 */
export function parse(id: LanguageId, source: string): TsTree {
  const parser = new Parser()
  parser.setLanguage(languageFor(id))
  return parser.parse(source) as unknown as TsTree
}
