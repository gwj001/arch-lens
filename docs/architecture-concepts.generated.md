<!-- arch-lens generated · chapter=concepts · language=中文 · at=2026-09-01T14:06:22.326Z · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->

# 概念层级

## 概念层级

### 职责划分
系统由五个包构成，围绕“将代码仓库变为可学习对象”这一目标分层协作。`arch-lens-backend` 承担服务端职责：扫描工作区仓库、维护图注册表与缓存、驱动生成链、处理会话图生成，并运行文档章节管线（含幻觉门禁）。`client-arch-lens` 是浏览器端学习台，通过远程主机向用户呈现概念、时序、交互、目录等八个学习单元，并承载悬浮机器人、AI 生成与讲解等交互。

`code-index` 定义语言感知的工作区实体与导入提取契约，为精确架构图和代码解释提供能力接缝；`code-index-tree-sitter` 是该接缝的 tree-sitter 实现，负责从工作区提取 TypeScript、Python、Java 的实体与导入关系。`typert-protocol` 定义与编译器无关的远程元数据及 Typert 提供者协议，是 deepseek-harness 中 `typert/protocol` 的 vendor 拷贝。

### 边界
后端与浏览器端通过远程主机通信，形成明确的部署边界：后端产物作为 DSH 宿主插件运行，客户端产物独立构建。`code-index` 是抽象契约层，不依赖具体解析器；`code-index-tree-sitter` 仅面向该接缝实现，隔离了解析技术差异。`typert-protocol` 固定了编译器无关的元数据协议，使上游代码索引与下游展示解耦。

### 关键路径
用户启动扫描后，`arch-lens-backend` 调用 `code-index` 契约，由 `code-index-tree-sitter` 提取实体与导入关系，生成架构图并缓存；浏览器端请求时，`client-arch-lens` 通过远程主机获取渲染数据。AI 讲解路径中，用户将问题发进会话，后端读码后生成答案并写回 `ARCH-NOTES.md`。变动更新时，只重新生成失效或缺失的图，保留未变部分。

### 设计取舍
- **契约接缝**：`code-index` 将实体与导入提取抽象为接缝，`code-index-tree-sitter` 仅提供一种实现，未来可替换其他语言前端而不影响上层。
- **编译器无关协议**：`typert-protocol` 来自 deepseek-harness，避免与特定编译器绑定，保持远程元数据中立。
- **缓存与失效**：后端持有图注册表与缓存，扫描时检查工作区变化，未变部分不重做，以节省 LLM 消耗。
- **双面构建**：后端与客户端分别构建，产物随仓库提交，运行时由 DSH 宿主提供依赖，降低版本漂移风险。

## 图示

- **Arch Lens · 架构学习台** — > **EN**: Arch Lens is a DeepSeek Harness (DSH) extension plugin that turns any code > repository into a *learnable object*: study figures in 8 tabs, evidence-g…
- **📖 使用者层**
  - **1. 你能得到什么** — - **8 个学习 Tab**：⚡ 动态总览 · 概念树 · 主流程时序 · 调用关系 · 流程图 · 交互 · 依赖 · ER · 目录。 - **每图带出处徽章**：`doc` 仓库文档原文（权威）/ `code` 真实调用关系（权威）/ `flow` AI 归纳 / `curated` 规则回退——哪句是抄的、哪…
  - **2. 安装启用（三步）** — 1. 克隆本仓库并按 [开发者层 › 构建](#4-构建与开发命令) 打出全部包产物； 2. 在仓库根执行 `scripts\link-arch-lens.ps1`（Windows）或 `pwsh scripts/link-arch-lens.ps1`（macOS / Linux），把 `arch-lens-backe…
    - **随时停用 / 恢复** — 脚本只对 DSH profile 的 `cordis.patch.yml` 做**追加 / 变更**：缺 arch-lens 行才补、 已有则只翻转 `disabled`，文件里其它任何配置（mcp-browser 等）原样保留。 **脚本命令与参数说明见 [scripts/scripts.md](scripts/sc…
  - **3. 界面速查**
    - **全局按钮（面板顶部）** — | 按钮 | 含义 | LLM 消耗 | |---|---|---| | 提示词 | 编辑讲解/生成用的提示词套装（保存在工作区，跟随仓库） | 0 | | ↻ 重新扫描 | 检查工作区代码变化并更新一切；没变的部分不会被重做 | 0 | | ⚡ 变动更新 | 只重新生成失效或缺失的图，其余原样保留 | 仅变化的图 |…
    - **图内交互** — | 操作 | 含义 | |---|---| | 🤖 AI 生成（各 Tab） | 对当前图不满意？把重画请求发进会话，AI 读码后重画这张图，画完自动回填 | | 🗣 AI 讲解 | 概念树节点、追问对话框、动态出图行都有——把"讲明白这个"发进会话，答案进笔记；讲解过的组件计入进度 | | 🔬 方法级 | 时序…
- **🛠 开发者层**
  - **4. 构建与开发命令** — 环境要求：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）运行环境、 Node.js `^22.19 || >=24`、pnpm 11（见 `package.json` 的 engines / packageManager）…
- **类型检查 + 全量测试** — pnpm exec tsc -b tsconfig.json pnpm exec vitest run --pool=threads
- **两面构建（产物 lib/ 随仓库提交，即部署载荷）** — pnpm exec tsdown --config tsdown.config.ts # host 面 pnpm exec tsdown --config tsdown.config.ts --env.DSH_BUILD_FACE client # client 面 ``` 改动的生效方式：后端 = 重启 DSH 主服…
  - **依赖与版本对齐** — - 编译期 `@deepseek-ai/*` 依赖来自 npm，统一锁定 **0.1.1-rc.2 线**（`devDependencies` / `peerDependencies` 精确版本，升级 DSH 宿主时若上游有更新版本线需同步调整）； - **运行时由宿主 DSH 提供**：后端 bundle 把所有 `…
  - **5. 仓库结构** — | 包 | 位置 | 职责 | |---|---|---| | `packages/arch-lens-backend` | 宿主 | 扫描、图注册表与缓存、生成链、会话图生成、文档章节管线（含幻觉门禁） | | `packages/client-arch-lens` | 浏览器 | 悬浮机器人、8 Tab 学习台、M…
  - **6. 深入机制** — | 文档 | 内容 | |---|---| | [docs/arch-lens-overview.md](docs/arch-lens-overview.md) | 包分工与关键机制（缓存 / 失效 / 写路径 / 组装） | | [docs/arch-lens-diagrams.md](docs/arch-lens-…
  - **7. 贡献** — Issues 与 Pull Requests 欢迎。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；变更记录见 [CHANGELOG.md](CHANGELOG.md)。 ---
- **⚖️ 许可层** — - 本项目以 [MIT License](LICENSE) 开源。 - `packages/typert-protocol` 为 deepseek-harness `packages/typert/protocol` 的 vendor 拷贝， 著作权归 deepseek-harness 项目所有，以同源 MIT 条款分…
