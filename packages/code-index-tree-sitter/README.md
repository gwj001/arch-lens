# @deepseek-ai/dsh-code-index-tree-sitter

tree-sitter provider for the code-index seam: offline, syntax-level
TypeScript/Python/Java entity and import extraction over a workspace.

## Model Experience

- **Model-visible inputs**: none directly — consumers decide what reaches a
  model request (arch-lens feeds extracted entities/imports into explain
  prompts).
- **Token effects**: none from indexing; extraction is offline AST work.
- **KV-cache effects**: none.

## Role in the seam

- **Provider** of `ctx.codeIndex` (`indexWorkspace(root)` → packages with
  entities/imports/composition/entry files, plus manifest deps).
- **Consumer**: `@deepseek-ai/dsh-arch-lens-backend` (precise graphs and
  code-grounded explains).

## Extraction coverage

| Language | Imports | Entities | Composition | Modifiers |
|---|---|---|---|---|
| TypeScript | `import`/`import type`/namespace/named | class/interface/enum/type-alias/function | class → methods/fields | decorators |
| Python | `import`/`from x import y` | class/function | class → methods | decorators |
| Java | `import` | class/interface/enum/record | class → methods/fields/constructors | annotations |

Indexing skips `node_modules`/`dist`/`build`/`venv`/`target`/`lib` and is
bounded per package (400 files, 256 KiB per file).

## Known Limitations and Deferred Work

- Syntax-level only; cross-file call resolution is left to consumers via the
  import graph. No LSP-backed semantic indexing (deliberate: process weight
  and per-language servers outweigh the value for graph precision).
- Python manifest dependencies are best-effort (`[project].dependencies` /
  poetry lines); Gradle dependencies are not parsed (pom.xml only).
