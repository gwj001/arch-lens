/**
 * Doc assembly from figure caches (阶段 4，D8)：「一键生成文档」不再走六段
 * LLM 直写，而是【图缓存的唯一事实真相】的纯组装——每个章节对应注册表里的
 * 图种，先版本化读缓存；缺失/过期的图走该图自己的构建链（force=false，
 * 内部缓存复查 + 文档→档案→LLM 逐级兜底）补建并统一写回，然后零 LLM 渲染
 * 成章节。文档反过来【不】写任何图缓存（旧链路的"文档后补写结构化缓存/
 * 重建概念树"回灌已删）：图 → 文档是单向组装，无循环。
 *
 * The generated doc ALWAYS lands in docs/architecture.generated.md (see
 * docsgen.resolveDocTarget); docs/architecture.md is the user's own document
 * and is never written here either.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docbuild
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox';
import type { CodeIndexResult } from '@deepseek-ai/dsh-code-index';
import type { EntityFigureId, FigureEnv } from './figures.ts';
import type { DocKind } from './types.ts';
import type { ArchLensConceptNode, ArchLensCoreGraph, ArchLensEventRow, ArchLensFlowResult, ArchLensGraph, ArchLensSequenceResult } from './types.ts';
/**
 * The figure a doc section renders FROM: current-cache hit serves instantly
 * (zero LLM); a missing/stale figure triggers THAT figure's own rebuild chain
 * (`force = false` → the chain re-checks its cache, then doc → profile → LLM
 * stages, persisting through the unified write path). This is exactly the
 * user-facing semantic「哪个 tab 落后就触发哪个的变动更新；没有 tab 也先建」.
 * @returns the figure payload, or `{ error }` when it could not be produced.
 */
export declare function ensureFigure(env: FigureEnv, id: EntityFigureId): Promise<{
    data: unknown;
} | {
    error: string;
}>;
/** concepts: the hierarchy tree → nested markdown bullets (+doc anchors). */
export declare function renderConcepts(tree: ArchLensConceptNode[]): string;
/** flow (D2a): one mermaid block per viewpoint + provenance. */
export declare function renderFlow(event: ArchLensFlowResult | null, pipeline: ArchLensFlowResult | null): string;
/** seq: ordered `from → to：label` list + provenance (accepts the legacy
 * bare-array cache shape — normalized, disk files are never migrated). */
export declare function renderSeq(figure: ArchLensSequenceResult | ArchLensSequenceResult['messages']): string;
/** interaction: the event table. */
export declare function renderInteraction(events: ArchLensEventRow[]): string;
/** deps: the core subgraph flowchart + its real import edge list (rules, no LLM). */
export declare function renderDeps(core: ArchLensCoreGraph, graph: ArchLensGraph, index: CodeIndexResult): string;
/** er (D2b kept): package-level entity-relationship diagram of the core set. */
export declare function renderEr(core: ArchLensCoreGraph, graph: ArchLensGraph): string;
/** catalog: package duties table. */
export declare function renderCatalog(duties: Record<string, string>): string;
/**
 * The「📄 一键生成文档」core chain (D8): assemble the architecture doc purely
 * from the figure caches, rebuilding only figures that are missing/stale
 * (through their own chains, unified write path) — zero LLM for the doc body
 * itself. Overwrites docs/architecture.generated.md only.
 * @param ctx - host context (only figure chains / optional descriptions call LLM).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index facts.
 * @param graph - scanned workspace graph facts (deps/er rendering).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for cache/doc writes.
 * @param options - `withDescriptions`: ONE batched LLM pass fills figure
 *   `description` fields first (D3, default off → fully deterministic).
 * @returns `{ path, errors }` (per-section errors collected, doc still
 *   written with the sections that could render), or one fatal `{ error }`.
 */
export declare function generateDocsFromFigures(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, graph: ArchLensGraph, language: string, sandboxPolicy?: SandboxExecutionPolicy, options?: {
    withDescriptions?: boolean;
}): Promise<{
    path: string;
    errors: string[];
} | {
    error: string;
}>;
/**
 * Regenerate ONE doc section (per-tab「AI 生成」) from the figure caches:
 * ensure the section's figure(s) (missing/stale → that figure's own chain),
 * render, merge into docs/architecture.generated.md under its `## 标题`
 * (every stale copy of the heading is replaced — same rule as the full doc).
 * Zero LLM for the section body itself.
 * @returns `{ path }` or `{ error }`.
 */
export declare function generateDocSection(ctx: Context, fs: FileSystem, root: string, index: CodeIndexResult, graph: ArchLensGraph, language: string, kind: DocKind, sandboxPolicy?: SandboxExecutionPolicy): Promise<{
    path: string;
} | {
    error: string;
}>;
//# sourceMappingURL=docbuild.d.ts.map