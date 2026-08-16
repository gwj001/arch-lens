/**
 * Wire types for the code-index capability seam: language-aware entity,
 * import, and composition extraction over a workspace, powering precise
 * architecture graphs and code-grounded explain prompts.
 * @module @deepseek-ai/dsh-code-index/src/types
 */
/** One code entity (class/interface/function/method/field/enum/type/module). */
export interface CodeEntity {
    /** Entity name (class name, function name, method name, ...). */
    name: string;
    /** Entity kind — drives graph shape (ER entities, class trees). */
    kind: 'class' | 'interface' | 'function' | 'method' | 'field' | 'enum' | 'type' | 'module';
    /** Source file path, relative to the workspace root (`/` separators). */
    file: string;
    /** 1-based start line in the source file. */
    line: number;
    /** Directly-contained child entities (composition: class → methods/fields). */
    children?: CodeEntity[];
    /** Decorator/annotation/modifier names (Java `@Service`, Python `@app.route`). */
    modifiers?: string[];
    /** First doc-comment paragraph, trimmed (bounded). */
    doc?: string;
}
/** One import edge from a source file to a module. */
export interface CodeImport {
    /** Source file, relative to the workspace root (`/` separators). */
    from: string;
    /** Imported module specifier (import path, package name, module name). */
    to: string;
    /** Imported binding names (`{ Foo }` / `from x import y`); empty = whole module. */
    names: string[];
    /** Whether this is a type-only import (TypeScript `import type`). */
    typeOnly?: boolean;
}
/** One discovered package/module root of the workspace. */
export interface CodePackage {
    /** Short package/module id (npm short name, python distribution, java module). */
    id: string;
    /** Absolute path to the package root. */
    path: string;
    /** Detected language. */
    language: CodeLanguage;
    /** Package-level dependencies (from the manifest: npm deps, pyproject deps, gradle deps). */
    deps: string[];
    /** Entities defined in this package, grouped per file. */
    entities: CodeEntity[];
    /** Import edges within this package. */
    imports: CodeImport[];
    /** Entry source files (index.ts / __init__.py / Main.java ...), relative to package root. */
    entryFiles: string[];
}
/** Languages the seam knows how to index. */
export type CodeLanguage = 'typescript' | 'python' | 'java' | 'unknown';
/** The full workspace index result. */
export interface CodeIndexResult {
    /** Absolute workspace root. */
    root: string;
    /** Primary detected language of the workspace. */
    language: CodeLanguage;
    /** Discovered packages. */
    packages: CodePackage[];
}
//# sourceMappingURL=types.d.ts.map