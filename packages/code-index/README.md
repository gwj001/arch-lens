# @deepseek-ai/dsh-code-index

Code-index capability seam: language-aware workspace entity/import extraction
contract. Consumers (arch-lens graphs, code-grounded explains, future code
search) read only this contract; providers implement it per language.

## Model Experience

- **Model-visible inputs**: none by itself — this package is a host-side
  contract. Providers and consumers decide what reaches a model request.
- **Token effects**: none. Indexing is offline rule/AST work; no LLM calls.
- **KV-cache effects**: none.

## Role in the seam

- **Service Definition** (`ctx.codeIndex`): `indexWorkspace(root)` → packages,
  entities, imports, composition, primary language.
- **Provider**: `@deepseek-ai/dsh-code-index-tree-sitter` (tree-sitter AST
  extraction for TypeScript/Python/Java).
- **Consumer**: `@deepseek-ai/dsh-arch-lens-backend` (precise dependency/ER
  graphs and code-grounded explain prompts).

## Known Limitations and Deferred Work

- Syntax-level only: cross-file semantic resolution (which class a call
  binds to) is derived from the import graph by consumers, never from a
  language server.
- LSP-backed semantic indexing is deliberately deferred (process weight,
  per-language servers) unless a future consumer proves it necessary.
