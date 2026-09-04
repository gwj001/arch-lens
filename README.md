# Arch Lens · 架构学习台

> **EN**: Arch Lens is a DeepSeek Harness (DSH) extension plugin that turns any code
> repository into a *learnable object*: study figures in 8 tabs, evidence-grounded
> questions routed into your existing chat session — and the session history *is*
> your notebook (Q&A, figures, follow-ups, all of it). MIT licensed. 中文文档如下。

一个把"读代码"变成"上课"的 DSH 插件：**扫描 → 制图 → 讲解 → 会话即笔记** 闭环。

---

# 📖 使用者层

## 1. 你能得到什么

- **8 个学习 Tab**：⚡ 动态总览 · 概念树 · 主流程时序 · 调用关系 · 流程图 · 交互 · 依赖 · ER · 目录。
- **每图带出处徽章**：`doc` 仓库文档原文（权威）/ `code` 真实调用关系（权威）/ `flow` AI 归纳 /
  `curated` 规则回退——哪句是抄的、哪句是猜的，一眼分清。
- **文档优先，不白花 token**：仓库自带架构文档时，概念/流程/时序直接逐字提取原文，**冷启动 0 次 LLM**。
- **讲解不换窗口**：点「🗣 AI 讲解」，Arch Lens 把带事实依据（职责、核心文件、真实调用边、图源）
  的问题发进你当前会话；回答就留在会话历史里——**会话记录就是笔记**，问答与生成的图全都记得住
  （原 `ARCH-NOTES.md` 笔记面板、📊 学习进度已下线，见 usage）。
- **一键出文档**：📄 按钮按 7 章（目录/概念/依赖/时序/流程/ER/交互，认知主干顺序）逐章串行生成，每章只依据
  代码事实写正文，先过"幻觉门禁"再落地 `docs/architecture-<章>.generated.md`；已生成的章节
  缓存复用，重复点击只补缺、重试失败章。
- **随问随画**：hover 任意调用边/子图可下钻细节图；🎨 动态出图按你的问题现画一张（含讲解概要），
  可保存锁定——保存的图是你的资产，重扫不丢。
- **不多花一分钱**：结果全部缓存；重新扫描只更新受影响的部分，没变的图秒回、不重复计费。
- **用量透明**：⚡ LLM 面板显示本工作区累计与最近明细（字符/估算/模型实际 token），重启不丢。
- **代码不出机器**：扫描与解析全程本地离线，除你已配置的模型调用外无任何网络请求。

## 2. 安装启用（三步）

1. 克隆本仓库并按 [开发者层 › 构建](#4-构建与开发命令) 打出全部包产物；
2. 在仓库根执行 `scripts\link-arch-lens.ps1`（Windows）或
   `pwsh scripts/link-arch-lens.ps1`（macOS / Linux），把 `arch-lens-backend`、
   `client-arch-lens`、`code-index-tree-sitter` 以 `link:` 依赖挂载进 DSH web
   profile 的 `node_modules`（幂等，可重复执行；详见
   [scripts/scripts.md](scripts/scripts.md) link-arch-lens 一节）；
3. 执行 `scripts\toggle-arch-lens.ps1 -Mode on` 写入启用行，再重启 DSH 主服务 +
   浏览器硬刷新（Ctrl+F5），在 Web GUI 侧边栏唤出悬浮机器人 → 学习台。

### 随时停用 / 恢复

脚本只对 DSH profile 的 `cordis.patch.yml` 做**追加 / 变更**：缺 arch-lens 行才补、
已有则只翻转 `disabled`，文件里其它任何配置（mcp-browser 等）原样保留。

**脚本命令与参数说明见 [scripts/scripts.md](scripts/scripts.md)（toggle-arch-lens 一节）**，


## 3. 界面速查

### 全局按钮（面板顶部）

| 按钮 | 含义 | LLM 消耗 |
|---|---|---|
| 提示词 | 编辑讲解/生成用的提示词套装（保存在工作区，跟随仓库） | 0 |
| ↻ 重新扫描 | 只重建事实：重扫代码图与索引，按变动包**精确失效**受影响的图缓存；不生成任何图 | 0 |
| ⚡ 变动更新 | 一条链 = 重新扫描 + 智能增量重绘：只补画失效/缺失的图；改完代码后的一键维护 | 仅失效的图 |
| 🔁 全量重建 | 不重扫，对全部图逐一校验缓存：失效/缺失的重绘、有效的跳过（"全量"指清点范围，不是无条件重绘） | 仅失效/缺失的图 |
| ⏹ 停止 | 立即中断所有进行中的 AI 生成 | — |
| 📄 一键生成文档 | 7 章串行生成（见上）；每章独立失败、独立重试，重复点击只补缺 | 缺失/失效的章 |

> 三颗扫描/重建按钮的完整用法（费用语义、中断、常见坑）见
> [usage.md](docs/usage.md)「三个扫描 / 重建按钮」一节。

> 📊 学习进度按钮已**下线**（2026-09）：其数据源是已退役的笔记文件；会话记录本身就是
> 更完整的笔记。详见 [usage.md](docs/usage.md)。

### 图内交互

| 操作 | 含义 |
|---|---|
| 🤖 AI 生成（各 Tab） | 对当前图不满意？把重画请求发进会话，AI 读码后重画这张图，画完自动回填 |
| 🗣 AI 讲解 | 概念树节点、追问对话框、动态出图行都有——把"讲明白这个"发进会话，答案进笔记；讲解过的组件计入进度 |
| 🔬 方法级 | 时序/交互/流程图切到方法粒度：按真实方法与调用边重新归纳（独立生成，不影响实体级图） |
| hover 调用边 / 子图标题 | 浮出 🤖 动态画图——只对这一条边/这一块画细节图 |
| 右键节点/边/子图 | 把该元素的标签送进 🎨 出图输入框，改一改再问 |
| 💾 保存当前图 | 动态出的图连标题、讲解概要一起保存，图号锁定，重扫不失效 |
| ✏️ 追问重画 | 在对话框里对已生成的图追加要求（"把 XX 展开""换成时序"），原图位置更新 |

> 每个 Tab 与交互的完整走读见 [docs/usage.md](docs/usage.md)。

---

# 🛠 开发者层

## 4. 构建与开发命令

环境要求：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）运行环境、
Node.js `^22.19 || >=24`、pnpm 11（见 `package.json` 的 engines / packageManager）。

```bash
pnpm install

# 类型检查 + 全量测试
pnpm exec tsc -b tsconfig.json
pnpm exec vitest run --pool=threads

# 两面构建（产物 lib/ 随仓库提交，即部署载荷）
pnpm exec tsdown --config tsdown.config.ts                             # host 面
pnpm exec tsdown --config tsdown.config.ts --env.DSH_BUILD_FACE client # client 面
```

改动的生效方式：后端 = 重启 DSH 主服务（启动时快照加载）；前端 = 浏览器 Ctrl+F5。

### 依赖与版本对齐

- 编译期 `@deepseek-ai/*` 依赖来自 npm，统一锁定 **0.1.2-rc.1 线**（`devDependencies` /
  `peerDependencies` 精确版本，升级 DSH 宿主时若上游有更新版本线需同步调整）；
- **运行时由宿主 DSH 提供**：后端 bundle 把所有 `@deepseek-ai/*` external 化，npm 副本只
  用于编译期类型；浏览器端 bundle 自包含内联；
- **vendored `dsh-typert-protocol` 跟随宿主源码并保持版本号与 npm 线对齐（0.1.2-rc.1）**：
  升级宿主版本时需同步更新 vendored 的 src 与版本号，否则 pnpm 会为上游包的 peer 自动
  拉一份 npm 副本（同一包名两套实现并存）；
- 全部 `@deepseek-ai/*` 均已 npm 化，无机器耦合路径（`tsconfig.base.json` 仅剩本地
  workspace 包与 vendored 的映射）；`typertPlugin` 生成器来自 npm 包
  `@deepseek-ai/dsh-typert-generator/tsdown`。

## 5. 仓库结构

| 包 | 位置 | 职责 |
|---|---|---|
| `packages/arch-lens-backend` | 宿主 | 扫描、图注册表与缓存、生成链、会话图生成、文档章节管线（含幻觉门禁） |
| `packages/client-arch-lens` | 浏览器 | 悬浮机器人、8 Tab 学习台、Mermaid/SVG 渲染 |
| `packages/code-index-tree-sitter` | 宿主 | tree-sitter 离线解析（TS / Python / Java） |
| `packages/code-index` | 宿主 | 代码索引能力缝契约 |
| `packages/typert-protocol` | 共享 | Typert Remote 协议（vendored，见许可致谢） |

## 6. 深入机制

| 文档 | 内容 |
|---|---|
| [docs/arch-lens-overview.md](docs/arch-lens-overview.md) | 包分工与关键机制（缓存 / 失效 / 写路径 / 组装） |
| [docs/arch-lens-diagrams.md](docs/arch-lens-diagrams.md) | 绘图机制全图解（逐节点标代码出处） |
| [docs/architecture.generated.md](docs/architecture.generated.md) | 旧组装链给本仓库生成的架构文档（历史产物示例；V1 章节管线产出 `architecture-<章>.generated.md`） |

## 7. 贡献

Issues 与 Pull Requests 欢迎。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)
与 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；变更记录见 [CHANGELOG.md](CHANGELOG.md)。

---

# ⚖️ 许可层

- 本项目以 [MIT License](LICENSE) 开源。
- `packages/typert-protocol` 为 deepseek-harness `packages/typert/protocol` 的 vendor 拷贝，
  著作权归 deepseek-harness 项目所有，以同源 MIT 条款分发。
- 依赖 mermaid、tree-sitter 语法包等第三方 MIT 开源组件；安全漏洞报告见 [SECURITY.md](SECURITY.md)。
