/**
 * TypeScript adapter: import edges, class/interface/enum/function entities,
 * class-body composition, and decorators, via tree-sitter-typescript.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/ts-adapter
 */
import type { CallEdge, CodeEntity, CodeImport } from '@deepseek-ai/dsh-code-index';
/**
 * Extract imports, entities, and call edges from a TypeScript source file.
 * One parse serves all three extractions (a second parse per file roughly
 * doubles full-workspace re-index time on large repos).
 * @param relPath - file path relative to the workspace root.
 * @param source - source text.
 * @returns imports, entities, and raw call edges.
 */
export declare function extractTs(relPath: string, source: string): {
    imports: CodeImport[];
    entities: CodeEntity[];
    calls: CallEdge[];
};
//# sourceMappingURL=ts-adapter.d.ts.map