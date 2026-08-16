/**
 * TypeScript adapter: import edges, class/interface/enum/function entities,
 * class-body composition, and decorators, via tree-sitter-typescript.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/ts-adapter
 */
import type { CodeEntity, CodeImport } from '@deepseek-ai/dsh-code-index';
/**
 * Extract imports and entities from a TypeScript source file.
 * @param relPath - file path relative to the workspace root.
 * @param source - source text.
 * @returns imports and entities.
 */
export declare function extractTs(relPath: string, source: string): {
    imports: CodeImport[];
    entities: CodeEntity[];
};
//# sourceMappingURL=ts-adapter.d.ts.map