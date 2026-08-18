# Arch Lens（架构学习台）包分工与关键机制

> 本文档由对 `packages/*` 源码的直接阅读（非 git 日志、非 node_modules、非文档转述）总结。
> 所有结论都标注了可对照阅读的代码位置；阅读顺序建议：包分工 → 关键机制 1→8 → 对照代码浏览。

---

## 一、这个项目是什么

**Arch Lens（架构学习台）** 是 DeepSeek Harness（DSH）的一个扩展插件，独立仓库形态
（`pnpm workspace`，5 个包）。作用：把任意工作区代码仓库变成"可学习的对象"——

1. 扫描出包依赖图（`packages/<组>/<包>` 树 + peerDependencies 边）；
2. 生成概念 / 时序 / 交互 / 依赖 / ER / 目录六类学习单元（图元）；
3. "AI 讲解"不自己聊天，而是把带**事实依据**的问题塞进**主会话管线**发问；
4. 回答自动沉淀到工作区 `ARCH-NOTES.md`，并反哺"学习进度"统计。

配套图：见 `docs/arch-lens-diagrams.md`（运行时拓扑 / 数据管线 / AI 链 / 讲解闭环 / 刷新语义 / 构建打包 6 张 Mermaid 图）。

---

## 二、包分工

| 包 | 侧 | 版本 | 职责 | 入口代码 |
|---|---|---|---|---|
| `typert-protocol` | 共享 | 0.1.0-rc.6 | 从 deepseek-harness 拷贝的 Typert Remote 协议：`@Remote` 装饰器、`TypertRemoteService` 基类、`RemoteResult` 信封、各类 registry 契约 | `packages/typert-protocol/src/index.ts`、`types.ts` |
| `code-index` | Host | 0.1.0-rc.1 | **能力缝 Service Definition**：抽象 `CodeIndex` 服务（`indexWorkspace(root)` / `refresh(root)`）+ 线类型（`CodeEntity` / `CodeImport` / `CodePackage` / `CodeIndexResult`） | `packages/code-index/src/index.ts`、`types.ts` |
| `code-index-tree-sitter` | Host | 0.1.0-rc.1 | `ctx.codeIndex` 的 **tree-sitter 提供方**：TS / Python / Java 实体与 import 提取，纯离线 AST、无 LLM，内存 + 磁盘双层缓存 | `packages/code-index-tree-sitter/src/index.ts`、`discover.ts`、`ts-adapter.ts`、`python-adapter.ts`、`java-adapter.ts`、`parser.ts` |
| `arch-lens-backend` | Host | 0.1.0-rc.5 | `ctx.archLens`（`TypertRemoteService`）：工作区扫描、Mermaid 图生成、AI 链（概念树 / 流程图 / 文档生成 / 职责总结 / 学习进度）、**唯一**的笔记写路径 | `packages/arch-lens-backend/src/index.ts` + `scan.ts` / `analyze.ts` / `mermaid.ts` / `concept.ts` / `flow.ts` / `core.ts` / `docsgen.ts` / `summarize.ts` / `progress.ts` / `notes.ts` |
| `client-arch-lens` | Browser | 0.1.0-rc.5 | 浏览器半区：打包成 `client.js`（mermaid 内联），在 `shell.overlay` 注册悬浮机器人，内含 7 个学习单元 Tab | `packages/client-arch-lens/src/client/index.ts`、`floating-bot.tsx`、`arch-view.tsx`、`graphs.tsx`、`mermaid-view.tsx`、`catalog.tsx`、`explain.ts`、`curated.ts`、`remote.ts` |

依赖关系（按代码里的 import 与 peerDependencies）：

- `arch-lens-backend` 依赖 `typert-protocol`（Remote 机制）、`code-index`（类型 + 服务获取）、`zod`（生成的 typert.host.js codec）
- `code-index-tree-sitter` 依赖 `code-index`（实现其抽象类）、tree-sitter 原生绑定
- `client-arch-lens` 依赖 `arch-lens-backend`（仅类型）、mermaid、schemastery、react、cordis
- 对外依赖（无法在本仓库内阅读）：`@deepseek-ai/cordis`（插件运行时）、`dsh-fs`、`dsh-llm`、`dsh-sandbox-policy`、`dsh-session`、`dsh-api-remotes`、`dsh-client-runtime` 等，均指向 `../../deepseek-harness`

---

## 三、关键机制

### 机制 1：前后端通过 Typert RPC 通信

- 后端 `ArchLensService extends TypertRemoteService`，约 20 个 `@Remote` 方法暴露为 `ctx.remote.archLens`（`arch-lens-backend/src/index.ts`）。
- 客户端 `remote.ts` 手写完整方法签名 + `unwrapRemote` 解包 `{ok, value} | {ok:false, error}` 信封（`client-arch-lens/src/client/remote.ts`）。
- 线上方法名在 `@Remote('graph')` 等注解里显式指定；`TypertRemoteService` 构造时通过 `bindTypertRemote(this, 'archLens')` 绑定 namespace（`typert-protocol/src/index.ts`）。
- 生成产物：`lib/typert.host.js`（Host 端 codec + 方法表）与 `lib/typert.remote-client.js`（客户端面），由 `scripts/gen-typert.mjs` 或 tsdown typert 插件生成。

### 机制 2：讲解不走自研聊天 UI，走主会话管线

- `FloatingBot` 注入的 `send` = `sessions.binding(id).session.prompt([text], 'queue')`，问题进主会话队列，**回答渲染在主线对话里，零自定义聊天 UI**（`client-arch-lens/src/client/index.ts`）。
- **目标会话始终跟随左侧栏当前会话**（`useSessions.current` 派生，无面板选择器）；侧边栏切会话时 `remoteSetSession` 把数据源指向该会话 cwd，客户端以 **`graph.root`（graph 结果自带的工作区索引）** 判断数据源是否真的换了工作区——root 变化（跨工作区）才全量重拉图，root 不变（同工作区会话）只换讲解目标（`floating-bot.tsx`、`arch-view.tsx`）。header 的"↻ 重载"只重拉当前工作区全部图，**无任何失效语义**。
- 客户端维护"同一时间只跑一个"的 explain 队列：`explainQueueRef` 入队 → `explainingRef` 加锁 → 监听会话 `running` 状态翻转解锁 → 20 秒兜底定时器防止卡死（`arch-view.tsx` 的 `pumpExplainQueue`）。

### 机制 3：笔记写入只有一条路径

- 面板发问前先 `notePending` 暂存（**纯内存**，绝不碰文件）（`index.ts` `remoteNotePending`）。
- 后端在 `Service.init` 注册 `session/event` 监听，只在 `assistant/message` 事件到来时写笔记；**跳过空内容事件**、校验 `sessionId` 匹配（`index.ts` `Service.init`）。
- 只有面板发起的讲解（有 pending 预注册）才记录——普通闲聊（bug 讨论、设计决策）永不污染笔记。
- 写文件走 `notes.ts`：同 target + 问句头去重、回答截断 600 字、文件上限 200 条（`appendNote` / `isDuplicate` / `trimToLimit`）。

### 机制 4：三层"事实源"与失效语义

| 层 | 内容 | 缓存位置 | 失效入口 |
|---|---|---|---|
| 扫描图 | `ArchLensGraph`（nodes/edges/detail 随图预计算） | `index.ts` 内存 `graphCache` | `remoteRefresh` / `remoteSetSession` |
| code-index | 实体/import 索引 | 内存 Promise 复用 + 磁盘 `.arch-lens-index.json` | `refresh(root)`：内存删 + 磁盘置空 |
| AI 缓存 | 概念树/流程图/核心选择/时序/交互/职责总结/进度 | 工作区根 `.arch-lens-*.json`（按语言分文件） | `removeAICaches` 全部置空 |

- `refresh`（重新扫描）= 三层全重建；`refreshIndex`（刷新此图 / AI 生成前置）= 只重建索引。
- 客户端在 refresh 落定后才重拉所有图（并行重拉会读到失效缓存——竞态）（`arch-view.tsx` `refresh`）。
- 磁盘缓存置空而非删除（`fs` 服务没有 delete API），读回空内容按"无缓存"处理。

### 机制 5：概念树 / 流程图都是"文档优先双链"

- 概念树：探测 `docs/architecture.md` 等 7 个候选文档（非 English 角色 zh 优先）→ 命中则按标题层级**逐字提取**（零 LLM 改文，节点带 `ref` 锚点 + `sourceText` 证据）；无文档才降级 LLM 从入口/依赖元数据归纳（标 `source:'flow'` 非权威）（`concept.ts`）。
- 流程图：逐文档找 fenced 块——`mermaid` 围栏**原样渲染**（`source:'doc'`）；`text`/`txt` 伪代码块只做 LLM **格式转码**（语义不变，仍 `source:'doc'`）；都没有才 LLM 归纳（`source:'flow'`）（`flow.ts`）。
- 每条链都是"缓存 → 文档 → 归纳"固定顺序，但每阶段是独立函数，可重排可替换。

### 机制 6：核心子图（deps / ER 的默认视图）

- LLM 从索引摘要选 4–25 个核心包 id（**校验必须存在于索引**，`source:'flow'`）；失败回退"入口包 + import 邻居"（`source:'curated'`，不写缓存，下次重试 LLM）（`core.ts`）。
- 边一律由 `importEdges` 规则从源码 import 聚合（相对路径解析 + bare specifier 归一化 `dsh-` 前缀），外部模块丢弃（`mermaid.ts`）。
- 客户端 deps/ER Tab 默认显示核心子图，全量图一键切换且保持缓存（`arch-view.tsx` `renderGraphTab`）。

### 机制 7：代码索引纯离线

- 语言探测看清单文件：package.json / pyproject.toml / pom.xml（`discover.ts` `detectLanguage`）。
- TS 走 `packages/<组>/<包>` 结构；Python/Java 深度 ≤3 漫游找清单。
- 每包 ≤400 文件、每文件 ≤256 KiB；跳过 `node_modules/dist/build/venv/target/lib/.git` 等。
- 三种语言适配器覆盖：TS（import/import type/namespace/named + class/interface/enum/type/function + 装饰器）、Python（import/from + class/function + 类方法 + 装饰器）、Java（import + class/interface/enum/record + 方法/字段/构造器 + 注解）。
- 明确不做 LSP 语义索引（README 声明：进程重量与多语言 server 不值当）。

### 机制 8：构建与打包

- `tsc -b` 出 `lib/types/**`（声明 + JS），tsdown 两个 face：
  - **host face**：`nodeLibrary` 把后端打成单文件 `lib/index.js`（`#region` 合并所有模块），`@deepseek-ai/*`、react、zod 全部 external（DSH host 运行时提供，避免重复 cordis/typert 实例）。
  - **client face**：`clientBundleConfig` 把 `src/client/index.ts` 打成 CJS `client.js`，banner/footer 挂进 `window.__ModuleLoader__.load({id, factory})`；`@deepseek-ai/*` external（模块表提供），mermaid 内联、动态 import 禁拆包（否则 180+ chunk 模块表不取）；CSS Modules 用 lightningcss 编译成 style 标签注入（`packages/tsdown.helpers.ts`）。
- Typert 产物独立生成：`scripts/gen-typert.mjs`（tsdown 插件集成在此独立仓库布局下发现不了 Remote 方法，所以单独跑）。

---

## 四、一句话总结

> 这是一个**"代码仓库自学桌"插件**：host 侧用 Cordis 服务 + tree-sitter 离线索引 + LLM 缓存链把仓库变成一组可解释的图元，通过 Typert RPC 喂给浏览器侧的学习台；学习台不自己聊天，而是把"带事实依据的讲解问题"塞进主会话管线，答案回到主对话并由唯一事件监听路径沉淀成 `ARCH-NOTES.md`，再反哺"学习进度"统计——形成一个**扫描 → 制图 → 讲解 → 笔记 → 进度**的闭环。所有 AI 产物都是"缓存优先、文档优先、可失效、带出处"的设计。

---

## 五、代码佐证的已知不一致（对照阅读时注意）

- `packages/client-arch-lens/lib/types/` 存在 `chat-projection.*` 产物，但 `src/` 中已无此文件 —— lib 与 src 不同步（陈旧产物）。
- 根目录 `lib/index.js` 与 `packages/arch-lens-backend/lib/index.js` 为同类 bundle，helper 的 outDir 写死为包内 lib，根 lib 应为旧配置产物。
- `client-arch-lens/src/index.ts` 的 host 侧 `apply()` 为空函数（浏览器插件在 host 侧无行为），但 package.json 仍导出 `./client`。
- `pnpm-workspace.yaml` 的 `allowBuilds` 块是待填写的占位文本（"set this to true or false"），不是合法布尔值。
