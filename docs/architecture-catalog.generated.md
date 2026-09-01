<!-- arch-lens generated · chapter=catalog · language=中文 · at=2026-09-01T06:03:11.216Z · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->

# 包目录职责

## 包目录职责

### 职责划分
`arch-lens-backend` 是 Arch Lens 学习桌的宿主端，负责扫描工作区仓库、投影组件详情，并记录答案级 `ARCH-NOTES.md`。其入口为 `arch-lens-backend`，职责边界限定在宿主侧工作区访问与结果记录。

`client-arch-lens` 是浏览器端，通过 archLens Host Remote 提供概念、序列、交互和目录学习单元。其入口为 `client-arch-lens`，职责集中在学习单元的浏览器侧呈现与交互。

`code-index` 定义代码索引能力接口，约定语言感知的工作区实体与导入提取契约，用于支撑精确架构图和基于代码的解释。`code-index-tree-sitter` 是基于 `tree-sitter` 的代码索引提供方，从工作区中提取 `TypeScript`、`Python` 和 `Java` 的实体与导入信息。`typert-protocol` 承担与编译器无关的 Remote 元数据与 Typert 提供方协议。

### 边界、关键路径与设计取舍
目录边界按宿主、浏览器、索引契约、索引实现与协议五类职责划分。`arch-lens-backend` 与 `client-arch-lens` 分属宿主端与浏览器端，避免工作区扫描、答案记录与学习单元呈现混杂。关键路径由 `arch-lens-backend` 的扫描、投影与记录职责，以及 `client-arch-lens` 通过 archLens Host Remote 提供学习单元的职责构成；`code-index` 与 `code-index-tree-sitter` 在该路径中提供实体与导入提取能力，支撑精确架构图和基于代码的解释。

设计取舍上，`code-index` 只保留契约，不绑定具体解析实现；`code-index-tree-sitter` 以 `tree-sitter` 提供多语言提取，使索引职责可独立于接口存在。`typert-protocol` 独立承载 Remote 元数据与 Typert 提供方协议，避免协议细节混入业务包。
