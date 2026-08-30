/**
 * Typed surface over the tree-sitter native bindings. The core package ships
 * its own declarations; the grammar packages are shimmed in globals.d.ts.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/parser
 */
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
/** Load one grammar's language object. The 0.21 declaration line types the
 * language as `any`, so the return derives from setLanguage's parameter. */
export function languageFor(id) {
    switch (id) {
        case 'typescript':
            return TypeScript.typescript;
        case 'python':
            return Python;
        case 'java':
            return Java;
    }
}
/**
 * Parse a source string with the given language.
 * @param id - language id.
 * @param source - source text.
 * @returns the parse tree.
 */
export function parse(id, source) {
    const parser = new Parser();
    parser.setLanguage(languageFor(id));
    return parser.parse(source);
}
//# sourceMappingURL=parser.js.map