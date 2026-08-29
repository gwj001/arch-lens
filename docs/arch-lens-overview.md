# Arch Lens（架构学习台）包分工与关键机制

> 本文档对 `packages/*` 源码直接阅读总结，并已对齐重构后的最终链路（图注册表 / 版本化信封 / 统一写路径 / 级联失效 / 文档组装）及重构后增量（统计文件账本 / 进度信封与实时徽章 / 讲解按钮族与图渲染修复）。
> 阅读顺序建议：包分工 → 关键机制 1→10 → 绘图流程速览 → 对照代码浏览。

---

## 一、这个项目是什么

**Arch Lens（架构学习台）** 是 DeepSeek Harness（DSH）的一个扩展插件，独立仓库形态（`pnpm workspace`，5 个包）。作用：把任意工作区代码仓库变成"可学习的对象"——

1. 扫描出包依赖图（`packages/<组>/<包>` 树 + peerDependencies 边）；
2. 生成概念 / 时序 / 流程图 / 交互 / 依赖 / ER / 目录等学习单元（图元），外加「⚡ 动态总览」共 **8 个 Tab**；
3. "AI 讲解"不自己聊天，而是把带**事实依据**的问题塞进**主会话管线**发问；
4. 回答自动沉淀到工作区 `ARCH-NOTES.md`，并反哺"学习进度"统计。

配套图：见 `docs/arch-lens-diagrams.md`。

---

## 二、包分工

| 包 | 侧 | 职责 | 入口代码 |
|---|---|---|---|
| `typert-protocol` | 共享 | 从 deepseek-harness 拷贝的 Typert Remote 协议：`@Remote` 装饰器、`TypertRemoteService` 基类、`RemoteResult` 信封 | `packages/typert-protocol/src/index.ts`、`types.ts` |
| `code-index` | Host | **能力缝 Service Definition**：抽象 `CodeIndex` 服务（`indexWorkspace(root, policy?, factsVersion?)` / `refresh(root)`）+ 线类型（`CodeEntity` / `CodeImport` / `CodePackage` / `CodeIndexResult`）。契约：**提供方必须以 `{v: factsVersion, data}` 版本信封落盘**，事实版本未知（0）时不得持久化 | `packages/code-index/src/index.ts`、`types.ts` |
| `code-index-tree-sitter` | Host | `ctx.codeIndex` 的 **tree-sitter 提供方**：TS / Python / Java 实体与 import 提取，纯离线 AST、无 LLM，内存 + 磁盘双层缓存（信封读写 `envelope.ts`） | `packages/code-index-tree-sitter/src/index.ts`、`envelope.ts`、`discover.ts`、`*-adapter.ts` |
| `arch-lens-backend` | Host | `ctx.archLens`（`TypertRemoteService`）：扫描、Mermaid 规则图、图注册表与统一写路径、AI 链、会话图生成、文档组装、笔记唯一写路径 | `packages/arch-lens-backend/src/index.ts` + 下列模块 |
| `client-arch-lens` | Browser | 浏览器半区：`client.js`（mermaid 内联），悬浮机器人 + 8 Tab 学习台。重构后又叠加一轮增强：追问对话框与动态出图的「🗣 AI 讲解」按钮（图源附件带 `lastAttachedFigRef` 脏检）、📊 旁实时进度徽章（`progressStats` 零 LLM）、调用关系图 Mermaid 化（`callGraphToMermaid` 平行边合并 ×N + 双向 `<-->` + 图内 `curve:linear`）、mermaid 全局 flowchart 改 linear + 加宽间距、子图 hover 几何命中 + 按钮 150ms 宽限（治遮挡误判与闪烁） | `packages/client-arch-lens/src/client/*` |

后端模块按职责分层（重构后的骨架）：

- **事实与缓存内核**：`fact-cache.ts`（版本信封读写 + `selectiveInvalidate` 两段式失效）、`figures.ts`（**图注册表**：图清单 / 权威文件名 / deps 规则 / 统一写入口 `writeFigure` / `runEntityFigurePass` / `readIndexFacts`）；
- **图链**（每条 = 缓存 → 文档/代码 → 共享档案 → 链自身 LLM）：`concept.ts` / `flow.ts` / `sequence.ts` / `docsgen.ts`（结构化归纳）/ `core.ts` / `summarize.ts` / `analysis.ts`（共享档案）；
- **会话生成**：`session-figure.ts`（实体图 + 动态下钻图的提示词、清洗、落盘）；`followup.ts`（原地追问重画）；
- **文档组装**：`docbuild.ts`（图缓存 → markdown，正文零 LLM）；
- **规则图与事实**：`scan.ts` / `mermaid.ts` / `analyze.ts` / `mermaid` 无关的 `notes.ts` / `progress.ts` / `policy.ts` / `abort.ts` / `llm-stats.ts` / `types.ts`。

依赖关系（import 与 peerDependencies）：`arch-lens-backend` → `typert-protocol`、`code-index`（**仅类型**，运行时经 `ctx.get('codeIndex')` 结构型获取，缝签名演进不需要重建 harness）；`code-index-tree-sitter` → `code-index`（实现抽象类）；`client-arch-lens` → `arch-lens-backend`（仅类型）；`@deepseek-ai/*` 宿主包指向 `../../deepseek-harness`。

---

## 三、关键机制

### 机制 1：前后端通过 Typert RPC 通信

- 后端 `ArchLensService extends TypertRemoteService`，**42 个** `@Remote` 方法暴露为 `ctx.remote.archLens`（graph / refresh / refreshIndex / generateAll / setSession / component / notes / notePending / promptConfig / promptConfigSave / mermaidDeps / mermaidEr / mermaidIndexed / mermaidCore / callGraph / overviewFigure / conceptTree / generateDocs / generateDocSection / sequence / events / flow / analyze / summarizeDuties / progress / progressStats / figurePrompt / regenerateFigure / dynamicFigurePrompt / dynamicFigure / customFigurePrompt / customFigure / customFigureList / saveCustomFigure / customFigureDelete / figureFollowUp / cancelFollowUp / cancelGeneration / generationStatus / generationStatusNext / llmStats / lastAnswer）。**本次重构线名与返回形状零变化**（客户端零改动）。
- **已废弃面（D6，wire 保留、不再演进）**：`mermaidEr` / `mermaidIndexed` / `mermaidDeps`（全量视图，学习价值低，客户端主路径已不依赖）；`resolveSequence` 的 code 视图分支不再被注册表链引用（真实调用边由 `callGraph` remote 独立呈现）。
- 客户端 `remote.ts` 手写签名 + `unwrapRemote` 解包；`@Remote('name')` 显式指定线名。

### 机制 2：讲解不走自研聊天 UI，走主会话管线

- `FloatingBot` 的 `send` = `sessions.binding(id).session.prompt(...)`，回答渲染在主线对话里，零自定义聊天 UI。
- **目标会话跟随左侧栏当前会话**；切会话时 `setSession(sessionId)` **纯加载、从不失效缓存**（扫描缓存按 workspace root 命中）；失效只发生在「↻ 重新扫描」。
- explain 队列：同一时间只跑一个，`running` 翻转解锁 + 20 秒兜底。

### 机制 3：笔记写入只有一条路径

- 发问前 `notePending` 纯内存暂存 → `assistant/message` 监听只在 sessionId 匹配、内容非空时写 `ARCH-NOTES.md`；同 target 去重、回答截断、文件上限裁剪（`notes.ts`）。

### 机制 4：唯一事实真相——factsVersion + 版本信封 + 两段式级联失效

这是整个缓存体系的**事实脊柱**：

| 概念 | 语义 | 代码 |
|---|---|---|
| `factsVersion` | = 磁盘扫描图 `index/.arch-lens-graph.json` 的 `generatedAt`。**只有 `refresh()` 会推进它**。0 = 未知：任何读不认它、任何写不落盘 | `fact-cache.ts readFactVersion` |
| 版本信封 | 每个缓存文件 = `{ v, deps?, data }`。读命中条件：`v === 当前 factsVersion` 精确相等。`v=0` = 失效标记（永不匹配）。**缺 `deps` = legacy = 依赖全部包**；`deps: []` = 永不失效（如文档来源的图） | `fact-cache.ts readVersionedCache / writeVersionedCache`（写失败**必须抛**） |
| 代码索引 | 提供方以 `{v, data}` 落盘（v=本次 refresh 盖章的事实版本）；`callGraph` 读盘校验版本+语言，legacy/失配一律按"无缓存"重索引；`indexWorkspaceShared` 发现信封 v ≠ factsVersion 时 refresh+重建一次 | `code-index-tree-sitter/envelope.ts`、`index.ts` 的 `indexWorkspaceShared` |
| 依赖规则 | **唯一一份** `figureDeps(kind, data, index?)`：概念/流程(AI)→全部包；流程(文档)→[]；时序→消息端点包；交互→生产者/消费者包；核心→选中 id；职责→已总结 id。会话图、追问重画、组装补建全部走同一规则 | `figures.ts figureDeps` |
| 重扫 | `refresh()`：manifest 无变化直接跳过（changed:false）；有变化 → 扫描 → 新图落盘（新 factsVersion）→ `selectiveInvalidate` | `index.ts remoteRefresh` |

**`selectiveInvalidate` 两段式**：

1. **实体段**：遍历 `index/.arch-lens-*.json`（跳过 graph/manifest/index/llm-stats/progress 与 `.arch-lens-draw-*` 用户资产）；`deps ∩ changedPackages` 命中 → 写 `{v:0}` 失效，**并记录该图种被失效**；否则保留 data/deps、重盖章 `v = 新 factsVersion`（未变动的图跨重扫存活）。
2. **下钻段**：`.arch-lens-dynamic-*` 按"自己 deps 命中 ∨ 父图种被失效（seq-edge→sequence、flow-subgraph→flow）∨ overview 恒失效 ∨ legacy 无版本"级联失效；幸存者同样重盖章。

- 「变动更新」按钮 = `generateAll(incremental=true)`：`runEntityFigurePass` 对注册表 7 图逐张检查 `isFigureCacheValid`，缺失/过期才 `build(force)`——未失效的图**零 LLM 秒过**。
- 「全量重建」= `incremental=false`，无条件重绘（语义未动）。

### 机制 5：图注册表与统一写路径（单一来源原则）

- `figures.ts FIGURE_SPECS`（7 实体图：concepts / flow-event / flow-pipeline / seq / interaction / core / duties）是**图清单、权威缓存文件名（委托各链模块导出）、构建入口的唯一来源**。历史上 generateAll 手拼 flow 文件名与 flow.ts 实际不符导致增量永远重画——注册表结构性消灭这类漂移（回归测试锁文件名契约）。
- **所有图写入只有一条路**：`writeFigure(fs, root, kind, language, factsVersion, data, {index?, methods?, deps?, policy?})` → 解析权威文件名 → 按 `figureDeps` 规则盖章 → `writeVersionedCache`。链内写、会话回答落盘（`writeFigureCache`）、追问重画、组装补建，无一例外；resolve 失败**抛错**由调用方决定是否致命（generateAll 收集、followup 保留非致命语义）。
- `factsVersion` 必须在**生成开始时**读，写侧沿链传递——中途重扫不得把新戳盖到旧事实的产物上。
- 时序缓存写侧统一 `{source, messages}` 对象形态；磁盘上的历史裸数组由 `readSeqCache` 兼容读归一，不迁移文件。
- 方法级（🔬）缓存 = 同名 `-methods` 文件，同一注册表；维持按需生成、不进 generateAll（D7）。

### 机制 6：概念树 / 流程图 / 时序都是"文档优先链"

- 概念树：探测 7 候选文档（非 English zh 优先）→ 标题层级**逐字提取**（`source:'doc'` + `ref` + `sourceText`）；提取树过浅回退档案/LLM（`source:'flow'`）。
- 流程图：`mermaid` 围栏原样渲染（角度无关、权威）→ `text` 伪代码仅格式转码 → 档案 `flow: {event, pipeline}`（两视角一次生成，切视角零 LLM）→ 链 LLM 归纳（视角规则 + `FLOW_STYLE_RULES`）；一切 mermaid 出图前过 `sanitizeMermaid`。缓存按 语言+角度 分文件（注册表名）。
- 时序（注册表链，D5）：缓存 → 文档「## 时序」逐字解析（`source:'doc'`）→ 档案 `seqMessages` → 链 LLM。code 视图（静态调用边/import 引用）由 `callGraph` remote 独立呈现，不在文档链里。
- 交互（D5）：缓存 → 档案 `events`（命中即写回缓存）→ 链 LLM 归纳——「变动更新」现在会真正补建交互图（旧版只读档案、永不落盘）。

### 机制 7：核心子图（deps / ER 的默认视图）

- LLM 从索引摘要选 4–25 个核心包（校验 ∈ 索引，`source:'flow'`）；失败回退"入口包+import 邻居"（`source:'curated'`，**故意不写缓存**，下次重试）。deps/ER 只渲染核心子图；边由 `importEdges` 规则聚合（零 LLM）。

### 机制 8：代码索引纯离线

- 语言探测（package.json / pyproject.toml / pom.xml）→ 每包 ≤400 文件、每文件 ≤256 KiB → tree-sitter 提取实体/import/调用边；内存 Promise 单飞 + 磁盘 `{v,data}` 信封双层缓存；不做 LSP。

### 机制 9：共享分析层 + 会话图生成 + 终止

- `analysis.ts`：一份共享档案 `{coreIds, conceptTree, flow, seqMessages, events}`，两次串行 LLM（结构 + 图元），单飞锁，冷启动 5→2 次调用、输入字符 ≈86% 节省；有文档仓库仍 0 LLM。档案命中即由各链写回**自己**的版本化缓存。
- 「🤖 AI 生成」= 图生成走会话：`figurePrompt` 出带 `figId` 的提示词 → 客户端发进当前会话 → `assistant/message` 监听按 figId 匹配（TTL + 会话无关双保险）→ 清洗后**经 `writeFigure` 统一写入口**落盘（文件名/ deps 与链完全一致——旧版手写镜像名曾让无视角 flow 永远 miss，注册表委托后消除）。
- 「🤖 动态画图」（hover 钻取）：时序边 / 流程子块 / 总览各写 `.arch-lens-dynamic-<kind>-<hash>[-<lang>].json` **版本信封** `{v, deps, data:{title, diagram, source, kind, targetKey}}`；deps 规则唯一来源 `dynamicFigureWriteFacts`（seq-edge→端点包、flow-subgraph→父流程 deps、overview→全部包）。失效/过期 → 读取返回 null → 下次 hover 重新生成（D1）；重扫时随父图级联失效（机制 4 第二段）。💾 用户保存图 `.arch-lens-draw-*` 是**用户资产，任何失效逻辑永不触碰**。
- 「⏹ 终止」：`abort.ts` per-root AbortController，所有 LLM 调用点挂 signal，真掐流并停计费。

### 机制 10：LLM 用量统计、学习进度与文档组装

- `llm-stats.ts`：每次调用记录 kind/字符/估算与 provider 实际 token/耗时，落盘 `.arch-lens-llm-stats.json`；面板「⚡ LLM」查累计与最近明细。**统计以文件为账本**（重启不丢）：工作区账本经进程级一次性 `adopted` 守卫**加性折叠**进内存（懒 adopt 时机 = setSession 与读快照前，读快照先 adopt 后写，杜绝空内存覆盖磁盘历史）；`clearLlmStats()` 同时重置 adopted。
- `progress.ts` 学习进度：覆盖度纯算术（笔记里 `组件 X` target 命中节点 id/short 才计分，Set 去重，`round(covered/total*100)`）+ 教练 LLM 归纳（最近 15 问 + ≤40 未问）。缓存 `.arch-lens-progress-<lang>.json` **同为版本信封 `{v, deps=全部包, data}`**——重扫推进 factsVersion 后旧总结读取即 miss（`selectiveInvalidate` 的遍历仍跳过 progress 文件：它靠自校验，不需要被置失效）。结果带 `generatedAt`/`fromCache`：命中缓存时面板明示生成时间与"再点强制刷新"；header 📊 旁**实时徽章**（`已讲解 N/M · x%`，`progressStats` 纯算术零 LLM，加载链/讲解回合结束/进度生成后刷新）。
- **「📄 一键生成文档」= 图缓存组装（D8，正文零 LLM）**：`docbuild.generateDocsFromFigures` 按 7 节顺序（概念层级 → **流程图（D2a 新增，两视角）** → 时序 → 核心交互 → 依赖 → **实体关系（D2b 保留）** → 包目录职责）逐节 `ensureFigure`：**版本化读缓存命中即用；缺失/过期 → 触发该图自己的构建链补建**（`force=false`，内部再复查缓存 → 文档 → 档案 → LLM，统一写路径回缓存）——"哪个 Tab 落后补哪个，没有图先建图"；然后规则渲染（树→嵌套列表、flow→mermaid 围栏+来源、seq→有序列表、interaction→表格、deps/er→图+边清单、duties→表格）并 merge 落盘。文档**不反哺任何图缓存**（旧"文档后补写结构化缓存/重建概念树"回灌已删，图→文档单向无循环）。`generateDocSection(kind)` 为单节版（同一链）。
- D3 扩展点：对象形态图（flow/seq/core）的类型已加可选 `description?: string`，渲染时输出为图后说明段；`withDescriptions` 开启时**恰好一次**批量 LLM 产说明并**同信封 read-modify-write 回写（保留原 v/deps，说明不重盖章）**。默认关闭 → 全链确定性。
- 生成文档**永远**只写 `docs/architecture.generated.md`（带 `<!-- arch-lens generated -->` 标记）；`docs/architecture.md` 是用户保留文件，任何路径不写。
- **文档口径边界**：一键文档只收注册表 7 实体图（+流程两视角）。**方法级（🔬 `-methods`）图、动态下钻图、🎨 动态出图均不进文档**——方法级是实体图的分身（可用「AI 生成本节」按需换），下钻/出图属会话探索产物；💾 已保存图（`.arch-lens-draw-*`）作为用户资产目前也不进文档（附录化是候选改进，未实施）。

---

## 四、绘图流程速览

所有图元同一原则：**缓存（版本绑定）优先 → 文档/代码 → 共享档案 → 链自身 LLM 兜底 → 带出处 → 统一写路径回缓存**。

| Tab | 注册表 id | 生成链（按顺序） | 来源标记 | 磁盘缓存（权威名 = 注册表） |
|---|---|---|---|---|
| ⚡ 总览 | （动态图） | 读 `.arch-lens-dynamic-overview-*`（版本化，miss 走会话生成）| `flow` | `.arch-lens-dynamic-overview-<hash>[-<lang>].json` |
| ① 概念树 | `concepts` | 缓存 → 文档逐字提取 → 档案 conceptTree → LLM | `doc` / `flow` | `.arch-lens-concept-<lang>.json` |
| ② 时序 | `seq` | 缓存 → 文档「## 时序」→ 档案 seqMessages → LLM | `doc` / `flow` | `.arch-lens-sequence-<lang>.json`（对象 `{source,messages}`；裸数组兼容读） |
| ③ 流程图 | `flow-event` / `flow-pipeline` | 缓存（语言+角度）→ 文档围栏 → 档案 flow[angle] → LLM | `doc` / `flow` | `.arch-lens-flow-<lang>-<angle>.json` |
| ④ 交互 | `interaction` | 缓存 → 档案 events → LLM | `flow` | `.arch-lens-events-<lang>.json` |
| ⑤ 依赖 | `core` | 缓存 → 档案 coreIds → LLM 选包 → curated 回退（不缓存）+ `importEdges` 画边 | `flow` / `curated` | `.arch-lens-core-<lang>.json` |
| ⑥ ER | `core` | 同上（同一份核心选择，视图规则生成） | `flow` / `curated` | 同上 |
| ⑦ 目录 | `duties` | 缓存 → LLM 分批职责（按缺失 id 增量） | `flow` | `.arch-lens-summaries-<lang>.json` |

- 触发入口三件套：「🔁 全量重建 / ⚡ 变动更新」= `runEntityFigurePass`（注册表 7 图，机制 4）；「🤖 AI 生成」= 会话回合（机制 9，同一注册表写路径）；「📄 一键生成文档」= 组装链按需补建（机制 10）。
- 来源标记含义：`doc` = 文档原文（权威，带锚点）；`code` = 静态调用图（权威）；`flow` = LLM 归纳（非权威）；`curated` = 规则回退（非权威）。

详细图解见 `docs/arch-lens-diagrams.md`。

---

## 五、一句话总结

> 一个**"代码仓库自学桌"**：host 侧以 `factsVersion + 版本信封 + 图注册表 + 统一写路径` 为事实脊柱，把 tree-sitter 离线索引和 LLM 缓存链产出的每类图**盖着事实戳**存进各自缓存文件；重扫只做两段式级联失效（变动包命中的图才重画），一键文档纯组装按需补建（正文零 LLM）；学习台不自己聊天，把带事实依据的问题塞进主会话管线，答案沉淀 `ARCH-NOTES.md` 反哺进度——**扫描 → 制图 → 讲解 → 笔记 → 进度**闭环，所有 AI 产物"缓存优先、文档优先、版本可失效、出处可追溯"。
