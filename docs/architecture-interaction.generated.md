<!-- arch-lens generated · chapter=interaction · language=中文 · at=2026-09-01T05:56:02.680Z · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->

# 核心交互

## 核心交互

### 职责划分与边界
`client-arch-lens` 承载浏览器端学习单元，表达概念、序列、交互和目录意图；`arch-lens-backend` 作为宿主端，负责扫描工作区仓库、投影组件详情，并记录答案级 `ARCH-NOTES.md`。`typert-protocol` 提供编译器无关的 Remote 元数据与 Typert 提供方协议；`code-index` 定义语言感知的工作区实体与导入提取契约；`code-index-tree-sitter` 依 `code-index` 契约，基于 tree-sitter 提取 TypeScript、Python 和 Java 的实体与导入信息。

### 关键路径
用户选择事件以 `Selection` 与 `CoreEvent` 触发后端生成请求；视图配置事件以 `ArchViewConfig` 与 `ArchViewProps` 请求架构视图，二者均由 `client-arch-lens` 发送到 `arch-lens-backend`。`arch-lens-backend` 向 `typert-protocol` 发出 `generationSignal`，驱动远程索引调用。`typert-protocol` 通过 `RemoteInvocationMarker` 与 `TypertGatewayBinding` 关联 `code-index`。包根发现、源码收集与语言检测事件使 `code-index` 与 `code-index-tree-sitter` 完成可索引源文件与 `CodeLanguage` 的准备；索引结果事件携带 `CodeEntity`、`CodeImport` 与 `CallEdge`，支撑精确架构图和基于代码的解释。`reportGeneration`、`endGenerationStage` 与 `notify` 事件将生成阶段结果、结束状态和 `tailPreview` 推送给 `client-arch-lens`。`client-arch-lens` 可通过 `abortGeneration` 终止当前生成阶段。

### 设计取舍
交互以宿主端为枢纽，浏览器端不直接扫描仓库，降低边界复杂度。索引能力通过 `code-index` 抽象，具体解析由 `code-index-tree-sitter` 承担，使上层可面向契约演进。`typert-protocol` 隔离远程协议与索引调用，避免 `arch-lens-backend` 直接耦合语言解析。若发生 `TypertLookupFailure`，失败状态返回宿主端，保持生成阶段可终止、可通知。
