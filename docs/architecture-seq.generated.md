<!-- arch-lens generated · chapter=seq · language=中文 · at=2026-09-01T05:50:47.696Z · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->

# 时序

## 时序

本章描述 Arch Lens 学习桌生成视图与交互中止的时序。职责上，`client-arch-lens` 是浏览器端，消费概念、序列、交互和目录学习单元；`arch-lens-backend` 是宿主端，负责扫描工作区仓库、投影组件详情，并记录答案级 `ARCH-NOTES.md`；`typert-protocol` 承载 Remote 元数据与 Typert 提供方协议；`code-index` 定义语言感知索引契约；`code-index-tree-sitter` 提供 TypeScript、Python、Java 的实体与导入提取。

### 生成视图

关键路径由 `client-arch-lens` 向 `arch-lens-backend` 请求生成视图开始。`arch-lens-backend` 随后通过 `typert-protocol` 绑定远程方法。绑定完成后，索引方法进入 `code-index` 与 `code-index-tree-sitter` 的索引阶段：包根发现、源码收集与语言检测在两者边界内完成，`code-index-tree-sitter` 向 `code-index` 返回源文件。索引结果经 `code-index` 与 `typert-protocol` 回传至 `arch-lens-backend`。宿主端再向 `client-arch-lens` 通知生成完成，并返回尾部预览。

### 交互与中止

生成期间，`client-arch-lens` 可向 `arch-lens-backend` 发送选择事件，用于交互；也可向 `arch-lens-backend` 请求中止生成。`arch-lens-backend` 收到中止请求后，负责结束当前生成路径，并向 `client-arch-lens` 通知中止完成。

### 边界与取舍

该时序将工作区访问限制在 `arch-lens-backend`，避免 `client-arch-lens` 直接扫描仓库，保持浏览器端轻量。`code-index` 与 `code-index-tree-sitter` 分离契约与实现：`code-index-tree-sitter` 依赖 `code-index`，使 TypeScript、Python、Java 的提取遵循统一接口。`typert-protocol` 被 `arch-lens-backend` 与 `client-arch-lens` 共同使用，承担远程协议边界。设计取舍是让生成结果经过协议、索引契约与实现提供方往返，以换取远程方法和语言索引的可替换性。
