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
 * Native `parse(string)` breaks past 2^15−1 characters ("Invalid argument",
 * tree-sitter 0.21 napi conversion bug — reproduces on every large source,
 * e.g. any file over ~32KB). The streaming read-callback path is unaffected:
 * the engine requests the document in chunks and reassembles them exactly
 * (verified: `rootNode.text` equals the full source, CJK included; offsets are
 * JS string indices). Chunk size stays far under the limit even in UTF-16
 * bytes so the callback's own chunks cannot trip it either.
 */
const DIRECT_PARSE_LIMIT = 32767;
const CHUNK_CHARS = 8192;
/**
 * Parse a source string with the given language.
 * @param id - language id.
 * @param source - source text.
 * @returns the parse tree.
 */
export function parse(id, source) {
    const parser = new Parser();
    parser.setLanguage(languageFor(id));
    if (source.length <= DIRECT_PARSE_LIMIT) {
        return parser.parse(source);
    }
    const read = (offset) => (offset >= source.length ? null : source.slice(offset, offset + CHUNK_CHARS));
    return parser.parse(read);
}
//# sourceMappingURL=parser.js.map