<!-- arch-lens generated · chapter=flow · language=中文 · at=2026-09-01T05:52:27.116Z · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->

# 流程图

## 流程图

### 职责划分与边界
`arch-lens-backend` 是宿主端，负责扫描工作区仓库、投影组件详情，并记录答案级 `ARCH-NOTES.md`。`client-arch-lens` 是浏览器端，通过 archLens Host Remote 提供概念、序列、交互和目录学习单元。`code-index` 定义语言感知的工作区实体与导入提取契约，`code-index-tree-sitter` 依据该契约提取 TypeScript、Python 和 Java 的实体与导入信息。`typert-protocol` 提供与编译器无关的 Remote 元数据与 Typert 提供方协议。

调用边界为：`client-arch-lens` 调用 `arch-lens-backend` 与 `typert-protocol`；`arch-lens-backend` 调用 `code-index` 与 `typert-protocol`；`code-index-tree-sitter` 调用 `code-index`。

### 关键路径
架构视图生成从用户选择触发与视图配置更新开始，进入后端生成信号。若请求中止，路径转入中止生成；否则进入开始生成阶段。生成阶段通过远程调用标记与网关绑定执行进入远程索引，再经过源码收集事件、语言检测事件，产出索引结果事件。索引结果经报告生成、结束生成阶段、通知客户端，最终渲染概念节点并进入尾部预览。

数据管道从项目根输入发现包根。未发现包根时，产出空目录产物；发现包根后，依次经过源文件列表、语言标识、代码实体、导入调用边、代码包产物、索引结果、概念节点、视图配置、选择状态，并到达尾部预览。

### 设计取舍
生成路径优先保证可中止与阶段化通知：中止判断位于开始生成阶段之前，结束生成阶段位于通知客户端之前。索引路径优先依赖契约：`code-index` 约束工作区实体与导入提取，`code-index-tree-sitter` 承担 TypeScript、Python 和 Java 的实体与导入提取。远程索引通过 `typert-protocol`、远程调用标记与网关绑定执行进入源码收集与语言检测，远程索引与视图呈现分段执行。
