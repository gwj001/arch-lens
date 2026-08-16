/**
 * Java adapter: import edges, class/interface/enum entities, class-body
 * method/field composition, and annotations, via tree-sitter-java.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/java-adapter
 */
import type { CodeEntity, CodeImport } from '@deepseek-ai/dsh-code-index';
/**
 * Extract imports and entities from a Java source file.
 * @param relPath - file path relative to the workspace root.
 * @param source - source text.
 * @returns imports and entities.
 */
export declare function extractJava(relPath: string, source: string): {
    imports: CodeImport[];
    entities: CodeEntity[];
};
//# sourceMappingURL=java-adapter.d.ts.map