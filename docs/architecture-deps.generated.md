<!-- arch-lens generated · chapter=deps · language=中文 · at=2026-09-01T05:57:58.713Z · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->

# 依赖

## 依赖

### 职责划分
`arch-lens-backend` 是宿主端，负责扫描工作区仓库、投影组件详情，并记录答案级 `ARCH-NOTES.md`。它依赖 `code-index` 与 `typert-protocol`。

`client-arch-lens` 是浏览器端，通过 archLens Host Remote 提供概念、序列、交互和目录学习单元。它依赖 `arch-lens-backend` 与 `typert-protocol`。

`code-index` 定义语言感知的工作区实体与导入提取契约，支撑精确架构图和基于代码的解释。`code-index-tree-sitter` 是基于 tree-sitter 的代码索引提供方，依赖 `code-index`，从工作区中提取 TypeScript、Python 和 Java 的实体与导入信息。

### 边界与关键路径
依赖边界集中在学习桌访问与代码索引两条路径。学习桌访问路径为 `client-arch-lens` 调用 `arch-lens-backend`；`arch-lens-backend` 再调用 `code-index` 与 `typert-protocol`。代码索引路径中，`arch-lens-backend` 只调用 `code-index`，`code-index-tree-sitter` 只调用 `code-index`，宿主端与具体提取实现之间没有直接调用。

`typert-protocol` 同时被 `arch-lens-backend` 与 `client-arch-lens` 依赖，构成浏览器端与宿主端共同依赖的协议边界。

### 设计取舍
该结构将索引契约与索引提供方分开。`code-index` 作为接口约束工作区实体与导入提取，`code-index-tree-sitter` 面向该接口提供 TypeScript、Python 和 Java 的实体与导入信息，避免 `arch-lens-backend` 直接依赖具体提取实现。协议依赖集中在 `typert-protocol`，使 `arch-lens-backend` 与 `client-arch-lens` 围绕同一 Remote 元数据与 Typert 提供方协议交互。
