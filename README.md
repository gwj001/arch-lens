# Arch Lens · 架构学习台

> **EN**: Arch Lens is a DeepSeek Harness (DSH) extension plugin that turns any code
> repository into a *learnable object*: study figures in 8 tabs, evidence-grounded
> questions routed into your existing chat session, and answers accumulated into
> `ARCH-NOTES.md` with a learning-progress dashboard. MIT licensed. 中文文档如下。

一个把"读代码"变成"上课"的 DSH 插件：**扫描 → 制图 → 讲解 → 笔记 → 进度** 闭环。

---

# 📖 使用者层

## 1. 你能得到什么

- **8 个学习 Tab**：⚡ 动态总览 · 概念树 · 主流程时序 · 调用关系 · 流程图 · 交互 · 依赖 · ER · 目录。
- **每图带出处徽章**：`doc` 仓库文档原文（权威）/ `code` 真实调用关系（权威）/ `flow` AI 归纳 /
  `curated` 规则回退——哪句是抄的、哪句是猜的，一眼分清。
- **文档优先，不白花 token**：仓库自带架构文档时，概念/流程/时序直接逐字提取原文，**冷启动 0 次 LLM**。
- **讲解不换窗口**：点「🗣 AI 讲解」，Arch Lens 把带事实依据（职责、核心文件、真实调用边、图源）
  的问题发进你当前会话；回答自动存进工作区 `ARCH-NOTES.md`，并计入学习进度。
- **随问随画**：hover 任意调用边/子图可下钻细节图；🎨 动态出图按你的问题现画一张（含讲解概要），
  可保存锁定——保存的图是你的资产，重扫不丢。
- **不多花一分钱**：结果全部缓存；重新扫描只更新受影响的部分，没变的图秒回、不重复计费。
- **用量透明**：⚡ LLM 面板显示本工作区累计与最近明细（字符/估算/模型实际 token），重启不丢。
- **代码不出机器**：扫描与解析全程本地离线，除你已配置的模型调用外无任何网络请求。

## 2. 安装启用（三步）

1. 克隆本仓库并按 [开发者层 › 构建](#4-构建与开发命令) 打出两个包；
2. 把 `packages/arch-lens-backend`、`packages/client-arch-lens` 两个目录链接
   （junction / symlink）到 DSH profile 的 `node_modules/@deepseek-ai/` 下，
   目录名分别为 `dsh-arch-lens-backend`、`dsh-client-arch-lens`；
3. 重启 DSH 主服务 + 浏览器硬刷新（Ctrl+F5），在 Web GUI 侧边栏唤出悬浮机器人 → 学习台。

### 随时停用 / 恢复

脚本只对 DSH profile 的 `cordis.patch.yml` 做**追加 / 变更**：缺 arch-lens 行才补、
已有则只翻转 `disabled`，文件里其它任何配置（mcp-browser 等）原样保留。

**各平台的完整命令与参数说明见 [scripts/scripts.md](scripts/scripts.md)（toggle-arch-lens 一节）**，
这里只给一句话速记（在 arch-lens 项目根目录执行）：

```cmd
:: Windows（cmd / PowerShell）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\toggle-arch-lens.ps1 -Mode off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\toggle-arch-lens.ps1 -Mode on
```

```bash
# macOS / Linux（需 PowerShell 7）
pwsh -NoProfile -File scripts/toggle-arch-lens.ps1 -Mode off
pwsh -NoProfile -File scripts/toggle-arch-lens.ps1 -Mode on
```

不装 PowerShell 7 也可直接手改 `~/.dsh/profiles/web/cordis.patch.yml`（文件顶部有中文说明）。
**切换后需重启 DSH 主服务生效**。注意：

- 停用 ≠ 删除：junction、`ARCH-NOTES.md`、`index/` 缓存、已保存的动态图全部原样保留，`on` 即恢复；
- 脚本每次切换前自动备份到 `cordis.patch.yml.bak`；只操作 arch-lens 相关条目，不会覆盖你的其它配置；
- 停用状态下旧标签页里的学习台会 RPC 报错，Ctrl+F5 后界面消失，属正常。

## 3. 界面速查

### 全局按钮（面板顶部）

| 按钮 | 含义 | LLM 消耗 |
|---|---|---|
| 📊 学习进度 | 生成"教练总结"：进度评估 + 哪里学浅了 + 下一步建议，追加进笔记；旁侧 `已讲解 N/M · x%` 徽章实时反映覆盖度 | 一次归纳（缓存内 0） |
| 📄 一键生成文档 | 把各 Tab 的图组装成一份完整架构文档写进 `docs/`；缺哪张图先自动补哪张 | 正文 0（仅补图时） |
| 提示词 | 编辑讲解/生成用的提示词套装（保存在工作区，跟随仓库） | 0 |
| ↻ 重新扫描 | 检查工作区代码变化并更新一切；没变的部分不会被重做 | 0 |
| ⚡ 变动更新 | 只重新生成失效或缺失的图，其余原样保留 | 仅变化的图 |
| 🔁 全量重建 | 所有图无条件重新生成（贵，一般用不着） | 全量 |
| ⏹ 停止 | 立即中断所有进行中的 AI 生成 | — |

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

- 编译期 `@deepseek-ai/*` 依赖来自 npm，统一锁定 **0.1.1-rc.2 线**（`devDependencies` /
  `peerDependencies` 精确版本，升级 DSH 宿主时若上游有更新版本线需同步调整）；
- **运行时由宿主 DSH 提供**：后端 bundle 把所有 `@deepseek-ai/*` external 化，npm 副本只
  用于编译期类型，不会造成双份 cordis/typert 实例；浏览器端 bundle 自包含内联；
- **已知豁免**：`@deepseek-ai/dsh-client-ui-session` 上游尚未发布到 npm（2026-08-30 核查，
  官方 registry 404）。`tsconfig.base.json` 保留两条指向本机 DSH checkout 的
  `paths` 豁免（带注释标记），**上游发布后请删除该条目并改用 npm 依赖**——这是全仓库
  唯一残留的机器耦合路径；
- 其余 harness 路径映射已全部移除；`typertPlugin` 生成器来自 npm 包
  `@deepseek-ai/dsh-typert-generator/tsdown`。

## 5. 仓库结构

| 包 | 位置 | 职责 |
|---|---|---|
| `packages/arch-lens-backend` | 宿主 | 扫描、图注册表与缓存、生成链、会话图生成、笔记/进度/统计、文档组装 |
| `packages/client-arch-lens` | 浏览器 | 悬浮机器人、8 Tab 学习台、Mermaid/SVG 渲染 |
| `packages/code-index-tree-sitter` | 宿主 | tree-sitter 离线解析（TS / Python / Java） |
| `packages/code-index` | 宿主 | 代码索引能力缝契约 |
| `packages/typert-protocol` | 共享 | Typert Remote 协议（vendored，见许可致谢） |

## 6. 深入机制

| 文档 | 内容 |
|---|---|
| [docs/arch-lens-overview.md](docs/arch-lens-overview.md) | 包分工与关键机制（缓存 / 失效 / 写路径 / 组装） |
| [docs/arch-lens-diagrams.md](docs/arch-lens-diagrams.md) | 绘图机制全图解（逐节点标代码出处） |
| [docs/architecture.generated.md](docs/architecture.generated.md) | Arch Lens 给本仓库自己生成的架构文档（产物示例） |

## 7. 贡献

Issues 与 Pull Requests 欢迎。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)
与 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；变更记录见 [CHANGELOG.md](CHANGELOG.md)。

---

# ⚖️ 许可层

- 本项目以 [MIT License](LICENSE) 开源。
- `packages/typert-protocol` 为 deepseek-harness `packages/typert/protocol` 的 vendor 拷贝，
  著作权归 deepseek-harness 项目所有，以同源 MIT 条款分发。
- 依赖 mermaid、tree-sitter 语法包等第三方 MIT 开源组件；安全漏洞报告见 [SECURITY.md](SECURITY.md)。
