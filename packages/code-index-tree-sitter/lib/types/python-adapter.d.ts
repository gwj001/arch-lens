/**
 * Python adapter: import edges, class/function entities, class-body method
 * composition, and decorators, via tree-sitter-python.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/python-adapter
 */
import type { CodeEntity, CodeImport } from '@deepseek-ai/dsh-code-index';
/**
 * Extract imports and entities from a Python source file.
 * @param relPath - file path relative to the workspace root.
 * @param source - source text.
 * @returns imports and entities.
 */
export declare function extractPython(relPath: string, source: string): {
    imports: CodeImport[];
    entities: CodeEntity[];
};
//# sourceMappingURL=python-adapter.d.ts.map