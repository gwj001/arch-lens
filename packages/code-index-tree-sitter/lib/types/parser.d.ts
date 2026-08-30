/**
 * Typed surface over the tree-sitter native bindings. The core package ships
 * its own declarations; the grammar packages are shimmed in globals.d.ts.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/parser
 */
import Parser from 'tree-sitter';
/** A parsed syntax node (projection of the native node). */
export interface TsNode {
    readonly type: string;
    readonly text: string;
    readonly startPosition: {
        readonly row: number;
        readonly column: number;
    };
    readonly endPosition: {
        readonly row: number;
        readonly column: number;
    };
    readonly children: readonly TsNode[];
    readonly namedChildren: readonly TsNode[];
}
/** One parsed source tree. */
export interface TsTree {
    readonly rootNode: TsNode;
}
/** Language entry points accepted by the native bindings. */
export type LanguageId = 'typescript' | 'python' | 'java';
/** Load one grammar's language object. The 0.21 declaration line types the
 * language as `any`, so the return derives from setLanguage's parameter. */
export declare function languageFor(id: LanguageId): Parameters<Parser['setLanguage']>[0];
/**
 * Parse a source string with the given language.
 * @param id - language id.
 * @param source - source text.
 * @returns the parse tree.
 */
export declare function parse(id: LanguageId, source: string): TsTree;
//# sourceMappingURL=parser.d.ts.map