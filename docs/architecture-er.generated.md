<!-- arch-lens generated · chapter=er · language=中文 · at=2026-09-01T06:00:49.931Z · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->

# 实体关系

## 实体关系

### 包层边界
`arch-lens-backend` 是宿主端，承担工作区仓库扫描、组件详情投影与答案级 `ARCH-NOTES.md` 记录。`client-arch-lens` 是浏览器端，通过 archLens Host Remote 提供概念、序列、交互和目录学习单元。`code-index` 定义语言感知的工作区实体与导入提取契约。`code-index-tree-sitter` 是基于 tree-sitter 的提供方，提取 TypeScript、Python、Java 的实体与导入信息。`typert-protocol` 约束 Remote 元数据与 Typert 提供方协议。包层职责按宿主端、浏览器端、索引契约、索引提供方与协议契约划分，避免扫描、解析、渲染与展示职责混杂。

### 宿主端实体域
在 `arch-lens-backend` 内，实体按职责分组。生成控制实体包括 `generationSignal`、`abortGeneration`、`reportGeneration`、`currentGenerationStatus`。分析配置实体包括 `AnalysisFlow`、`ArchLensAnalysisProfile`、`ensureAnalysisProfile`、`buildProfileConceptTree`、`generateStructure`、`generateFigures`。分析入口实体包括 `analyzeWorkspace`、`analyzePackage`。图元实体包括 `FigureKindSpec`、`figureDeps`、`readIndexFacts`、`runEntityFigurePass`、`writeFigure`。文档实体包括 `renderConcepts`、`renderFlow`、`renderSeq`、`renderInteraction`、`renderDeps`、`renderEr`、`renderCatalog`、`generateDocsFromFigures`、`writeDoc`。缓存与变更实体包括 `RawVersionedCache`、`readVersionedCache`、`writeVersionedCache`、`selectiveInvalidate`、`computeChangedPackages`。

### 关键路径与设计取舍
关键路径涉及的实体包括 `analyzeWorkspace`、`ensureAnalysisProfile`、`generateFigures`、`renderEr`、`writeDoc`；这些实体分别对应工作区分析、配置整理、图元事实、实体关系渲染与 `ARCH-NOTES.md` 写入。设计取舍是将语言感知索引收敛到 `code-index`，由 `code-index-tree-sitter` 承担具体提取，使 TypeScript、Python、Java 的差异不侵入文档生成。缓存与失效集中在 `readVersionedCache`、`writeVersionedCache`、`selectiveInvalidate`，以版本化缓存降低重复分析成本。`client-arch-lens` 保持浏览器端轻边界，学习单元通过 archLens Host Remote 提供。
