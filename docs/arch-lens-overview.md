# Arch Lens（架构学习台）包分工与关键机制

> 本文档由对 `packages/*` 源码的直接阅读（非 git 日志、非 node_modules、非文档转述）总结。
> 所有结论都标注了可对照阅读的代码位置；阅读顺序建议：包分工 → 关键机制 1→9 → 绘图流程速览 → 对照代码浏览。

---

## 一、这个项目是什么

**Arch Lens（架构学习台）** 是 DeepSeek Harness（DSH）的一个扩展插件，独立仓库形态
（`pnpm workspace`，5 个包）。作用：把任意工作区代码仓库变成"可学习的对象"——

1. 扫描出包依赖图（`packages/<组>/<包>` 树 + peerDependencies 边）；
2. 生成概念 / 调用关系（代码静态调用图；文档/AI 来源时为主流程时序）/ 交互 / 依赖 / ER / 目录六类学习单元（图元）；
3. "AI 讲解"不自己聊天，而是把带**事实依据**的问题塞进**主会话管线**发问；
4. 回答自动沉淀到工作区 `ARCH-NOTES.md`，并反哺"学习进度"统计。

配套图：见 `docs/arch-lens-diagrams.md`（绘图速览 + 运行时拓扑 / 数据管线 / 七 Tab 绘图总览 / AI 生成链 / 时序与交互 / 依赖与 ER / 讲解闭环 / 刷新语义 / 构建打包 9 张 Mermaid 图）。

---

## 二、包分工

| 包 | 侧 | 版本 | 职责 | 入口代码 |
|---|---|---|---|---|
| `typert-protocol` | 共享 | 0.1.0-rc.6 | 从 deepseek-harness 拷贝的 Typert Remote 协议：`@Remote` 装饰器、`TypertRemoteService` 基类、`RemoteResult` 信封、各类 registry 契约 | `packages/typert-protocol/src/index.ts`、`types.ts` |
| `code-index` | Host | 0.1.0-rc.1 | **能力缝 Service Definition**：抽象 `CodeIndex` 服务（`indexWorkspace(root)` / `refresh(root)`）+ 线类型（`CodeEntity` / `CodeImport` / `CodePackage` / `CodeIndexResult`） | `packages/code-index/src/index.ts`、`types.ts` |
| `code-index-tree-sitter` | Host | 0.1.0-rc.1 | `ctx.codeIndex` 的 **tree-sitter 提供方**：TS / Python / Java 实体与 import 提取，纯离线 AST、无 LLM，内存 + 磁盘双层缓存 | `packages/code-index-tree-sitter/src/index.ts`、`discover.ts`、`ts-adapter.ts`、`python-adapter.ts`、`java-adapter.ts`、`parser.ts` |
| `arch-lens-backend` | Host | 0.1.0-rc.5 | `ctx.archLens`（`TypertRemoteService`）：工作区扫描、Mermaid 图生成、AI 链（概念树 / 流程图 / 时序 / 文档生成 / 职责总结 / 学习进度）、**唯一**的笔记写路径 | `packages/arch-lens-backend/src/index.ts` + `scan.ts` / `analyze.ts` / `mermaid.ts` / `concept.ts` / `flow.ts` / `core.ts` / `sequence.ts` / `docsgen.ts` / `summarize.ts` / `progress.ts` / `notes.ts` / `policy.ts` / `types.ts` |
| `client-arch-lens` | Browser | 0.1.0-rc.5 | 浏览器半区：打包成 `client.js`（mermaid 内联），在 `shell.overlay` 注册悬浮机器人，内含 7 个学习单元 Tab | `packages/client-arch-lens/src/client/index.ts`、`floating-bot.tsx`、`arch-view.tsx`、`graphs.tsx`、`mermaid-view.tsx`、`catalog.tsx`、`explain.ts`、`remote.ts`、`i18n.ts`、`insights-panel.tsx`、`notes-panel.tsx`、`prompt-editor.tsx` |

依赖关系（按代码里的 import 与 peerDependencies）：

- `arch-lens-backend` 依赖 `typert-protocol`（Remote 机制）、`code-index`（类型 + 服务获取）、`zod`（生成的 typert.host.js codec）
- `code-index-tree-sitter` 依赖 `code-index`（实现其抽象类）、tree-sitter 原生绑定
- `client-arch-lens` 依赖 `arch-lens-backend`（仅类型）、mermaid、schemastery、react、cordis
- 对外依赖（无法在本仓库内阅读）：`@deepseek-ai/cordis`（插件运行时）、`dsh-fs`、`dsh-llm`、`dsh-sandbox-policy`、`dsh-session`、`dsh-api-remotes`、`dsh-client-runtime` 等，均指向 `../../deepseek-harness`

---

## 三、关键机制

### 机制 1：前后端通过 Typert RPC 通信

- 后端 `ArchLensService extends TypertRemoteService`，**23 个** `@Remote` 方法暴露为 `ctx.remote.archLens`（`arch-lens-backend/src/index.ts`）：graph / refresh / refreshIndex / setSession / component / notes / notePending / promptConfig / promptConfigSave / mermaidDeps / mermaidEr / mermaidIndexed / mermaidCore / conceptTree / generateDocs / generateDocSection / sequence / events / flow / analyze / summarizeDuties / progress / progressStats。
- 客户端 `remote.ts` 手写完整方法签名 + `unwrapRemote` 解包 `{ok, value} | {ok:false, error}` 信封（`client-arch-lens/src/client/remote.ts`）。
- 线上方法名在 `@Remote('graph')` 等注解里显式指定；`ArchLensService` 经 `super(ctx, 'archLens')` 注册服务，`TypertRemoteService` 构造器内部随即调用 `bindTypertRemote(this, this.name)`（此时 name 即 serviceKey = `'archLens'`）完成 namespace 绑定（`typert-protocol/src/index.ts`）。
- 生成产物：`lib/typert.host.js`（Host 端 zod codec + 方法表）与 `lib/typert.remote-client.js`（客户端面），由 `scripts/gen-typert.mjs` 或根 `tsdown.config.ts` 引入的 typert 插件生成。

### 机制 2：讲解不走自研聊天 UI，走主会话管线

- `FloatingBot` 注入的 `send` = `sessions.binding(id).session.prompt([{ type: 'text', text }], 'queue')`（消息块数组，不是裸字符串；`'queue'` 为排队模式），问题进主会话队列，**回答渲染在主线对话里，零自定义聊天 UI**（`client-arch-lens/src/client/index.ts`）。
- **目标会话始终跟随左侧栏当前会话**（`useSessions.current` 派生，无面板选择器）；侧边栏切会话时客户端调 `archLens.setSession(sessionId)`（wire 名 `setSession`，对应后端 `remoteSetSession`）把数据源指向该会话 cwd——**纯加载、从不失效缓存**：扫描缓存按 workspace root 命中，同工作区（重开面板/同工作区切会话）秒回，跨工作区才自动重扫；客户端以 `graph.root` 判断数据源是否真的换了工作区（`floating-bot.tsx`、`arch-view.tsx`）。header 的"↻ 重载"走同一条加载路径，**无任何失效语义**；失效只发生在「↻ 重新扫描」。
- 客户端维护"同一时间只跑一个"的 explain 队列：`explainQueueRef` 入队 → `explainingRef` 加锁 → 监听会话 `running` 状态翻转解锁 → 20 秒兜底定时器防止卡死（`arch-view.tsx` 的 `pumpExplainQueue`）。

### 机制 3：笔记写入只有一条路径

- 面板发问前先 `notePending` 暂存（**纯内存**，绝不碰文件）（`index.ts` `remoteNotePending`）。
- 后端在 `Service.init` 注册 `session/event` 监听，只在 `assistant/message` 事件到来时写笔记；**跳过空内容事件**、校验 `sessionId` 匹配（`index.ts` `Service.init`）。
- 只有面板发起的讲解（有 pending 预注册）才记录——普通闲聊（bug 讨论、设计决策）永不污染笔记。
- 写文件走 `notes.ts`：同 target + 问句头去重、回答截断 600 字、文件上限 200 条（`appendNote` / `isDuplicate` / `trimToLimit`）。

### 机制 4：三层"事实源"与失效语义

| 层 | 内容 | 缓存位置 | 失效入口 |
|---|---|---|---|
| 扫描图 | `ArchLensGraph`（nodes/edges/detail 随图预计算） | `index.ts` 内存 `Map<workspaceRoot, graph>` + **磁盘 `.arch-lens-graph.json`**（host 重启后首次打开直接读盘，不再重走文件扫描） | `remoteRefresh`（显式：内存清 + 磁盘写失效标记）；`setSession` 不清缓存 |
| code-index | 实体/import 索引 | 内存 Promise 复用 + 磁盘 `.arch-lens-index.json` | `refresh(root)`：内存删 + 磁盘置空 |
| AI 缓存（受 refresh 置空） | 概念树/流程图/核心选择/时序/交互/共享分析档案 | 工作区根 `.arch-lens-{concept,sequence,events,flow,core,analysis}-<lang>.json` | `removeAICaches` 置空 6 类前缀 |
| AI 缓存（不受 refresh 置空） | 职责总结 / 学习进度 | 工作区根 `.arch-lens-summaries-<lang>.json` / `.arch-lens-progress-<lang>.json` | 无显式失效：职责总结按缺失 id 增量补；进度靠 `force` 重生成 |

- `refresh`（重新扫描）= 扫描图 + code-index + 上述 6 类 AI 缓存全部重建；`refreshIndex`（刷新此图 / AI 生成前置）= 只重建索引。注意 `removeAICaches` 只置空 6 个前缀（`.arch-lens-concept-` / `.arch-lens-sequence-` / `.arch-lens-events-` / `.arch-lens-flow-` / `.arch-lens-core-` / `.arch-lens-analysis-`），职责总结与进度缓存不在其列。
- 客户端在 refresh 落定后才重拉所有图（并行重拉会读到失效缓存——竞态）（`arch-view.tsx` `refresh`）。
- 磁盘缓存置空而非删除（`fs` 服务没有 delete API），读回空内容按"无缓存"处理。

### 机制 5：概念树 / 流程图都是"文档优先双链"

- 概念树：探测 `docs/architecture.md` 等 7 个候选文档（非 English 角色 zh 优先）→ 命中则按标题层级**逐字提取**（零 LLM 改文，节点带 `ref` 锚点 + `sourceText` 证据）；**提取树过浅（单标题、无父子层级）视为无可用的概念层级**，回退到共享分析档案/LLM 归纳（标 `source:'flow'` 非权威）（`concept.ts` `isUsableDocTree`）。
- 流程图：逐文档找 fenced 块——`mermaid` 围栏**原样渲染**（`source:'doc'`，角度无关，权威）；`text`/`txt` 伪代码块只做 LLM **格式转码**（语义不变，仍 `source:'doc'`）；都没有才走共享档案/LLM 归纳（`source:'flow'`）（`flow.ts`）。归纳路径支持**两个视角（角度）**：事件驱动（事件与触发链）/ 数据管道（数据产物如何流转）；**两视角在一次 LLM 调用里同时生成**（档案 `flow` 是 `{ event, pipeline }` 映射）。提示词带**项目中立的高密度风格规范**（`FLOW_STYLE_RULES`，两视角共用一份）：阶段 subgraph（阶段名按项目实际运行阶段归纳，非按包分组）+ 节点 ≤16 + 「动作+机制」两行标签（`<br/>`）+ 分支点用菱形决策节点并标「是/否」+ 每条边带动作标签 + 单主线无环 + **中性风格示例（few-shot，只学风格不学内容）**；禁止硬套任何外部词汇（emit/waterfall 等只在项目自用时才写）。**LLM 产出的 mermaid 一律过 `sanitizeMermaid` 语法修复**（`-->|标签|` 内的半角括号/分号换全角——`触发(emit)` 会被 mermaid 解析器拒绝），生成、缓存读取、档案读取全路径都修；客户端 MermaidView 渲染前再做一次同样的修复（本地镜像），因此旧坏缓存**刷新页面即可修复，无需重扫**。缓存按 语言+角度 分开（`.arch-lens-flow-<lang>-<angle>.json`），档案按角度命中即出图——**切换角度零 LLM**（客户端角度选择持久化在 localStorage，刷新页面不重生成）。
- 时序 code 视图：真实调用边优先（`buildSequenceFromCalls`，source `'code'`）；**无跨包调用边时（type-only import / 动态 `ctx.get` 取服务）回退到跨包 import 引用图**（`buildSequenceFromImports`，仍是代码静态事实，与主流程时序视图不同源）（`sequence.ts`）。
- 每条链都是"缓存 → 文档/代码 → 共享分析档案 → 链自身 LLM"固定顺序，但每阶段是独立函数，可重排可替换（共享分析档案见机制 9）。
- **🔬 方法级开关（每 tab 独立、默认关、⚡ LLM 面板一键全开/全关）**：开启后该图改用**方法级摘要**（类方法名 + 真实调用边 `from → to（file:line）`，`indexSummary methods` 模式，上限 120 条边/每类 6 方法）做**自己的会话生成**（`figurePrompt` 带 `methodLevel`，提示词要求引用真实方法名与文件），跳过共享档案（档案永远是实体级，方法数据不进共享摘要、不多花其他 tab 的 token）。方法级结果写独立缓存（`-methods` 后缀），与实体级互不污染。事实粒度：索引自带方法级调用边（`CallEdge.from/to` 符号 + `file:line`），不是 LLM 编的；运行时拓扑（进程/浏览器边界）不在代码事实内，LLM 只能推断并须标【推断】。

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
  - **host face**：`nodeLibrary` 把后端 src 入口打成 `lib/index.js`（产物中每个模块以 `//#region <模块路径>` 标记，相对模块全部合并进单文件），`@deepseek-ai/*`、react、zod 全部 external（DSH host 运行时提供，避免重复 cordis/typert 实例）。
  - **client face**：`clientBundleConfig` 把 `src/client/index.ts` 打成 CJS `client.js`，banner/footer 挂进 `window.__ModuleLoader__.load({id, factory})`；**仅 `PLATFORM_EXTERNALS` 白名单**（react、`@deepseek-ai/cordis`、`dsh-client-ui-slots` 等）external（模块表提供），其余 `@deepseek-ai/*` 与 mermaid 一律内联、动态 import 禁拆包（否则 180+ chunk 模块表不取）；CSS Modules 用 lightningcss 编译成 style 标签注入（`packages/tsdown.helpers.ts`）。
- Typert 产物两条生成路径并存：根 `tsdown.config.ts` 已从 `../../deepseek-harness` 直接 `import { typertPlugin }`（host face 构建时以 `mode: 'workspace'` 生成 `lib/typert.host.js` 等），另有独立脚本 `scripts/gen-typert.mjs`（不经 tsdown，直接跑 `WorkspaceTypertGenerator`）。"tsdown 插件发现不了 Remote 方法"的说法只残留于包级 `arch-lens-backend/tsdown.config.ts` 注释，对根构建不成立。
- 构建注意：`packages/tsdown.helpers.ts` 的 `nodeLibrary` 把 `outDir` 写死为 `packages/arch-lens-backend/lib`（与调用包无关），且构建不清理旧产物——`arch-lens-backend/lib/index.mjs` 与 `client-arch-lens/lib/index.js` / `index.mjs` / `invariant.js` 是旧配置残留，与当前产物并存（`index.mjs` 曾内联 cosmokit/schemastery，当前 `index.js` 为 src 入口 + external）。

### 机制 9：共享分析层（单次 LLM 综合分析，A+B 方案）

- 新文件 `analysis.ts`：一份 **`.arch-lens-analysis-<lang>.json` 共享分析档案** `{ coreIds, conceptTree, flow, seqMessages, events }`，由**两次串行 LLM 调用**生成——调用 1（结构：coreIds + conceptTree）输入裁剪摘要（id+实体+入口，**无依赖字段**）；调用 2（图元：flow + seq + events）**只发送 coreIds 包子集**的摘要。生成带按 root+语言的**单飞锁**（并发链共享同一次生成），并随 `removeAICaches` 一并失效。
- **链顺序（已实施）**：缓存 → 文档/静态调用图（权威，不变）→ **档案** → 链自身 LLM（仅档案缺该字段时）。concept/flow/seq/core/events 五条链都在权威阶段之后、独立 LLM 之前插入档案阶段；命中档案即写回该链自己的缓存。
- **交叉校验（准确性不降反升）**：`coreIds` 必须存在于索引（防编造）；`seqMessages` 的 from/to 必须是 coreIds（图元与选包强制一致）；events 的 mode 限定 emit/waterfall/parallel/serial；概念树根 ≤12、深度 ≤3；flow 的 mermaid 经提取清洗。
- **量化（单元测试实测，60 包 fixture，无文档无缓存冷启动）**：自动路径 LLM 调用 **5 → 2**；摘要输入字符 **≈86% 节省**（含概念兜底的独立预算口径 **92%**）；有文档的仓库仍 **0 次 LLM**（文档优先不破坏）。测试：`packages/arch-lens-backend/tests/analysis.spec.ts`（校验规则）、`summary.spec.ts`（裁剪与预算）、`analysis-chain.spec.ts`（链级调用次数与输入字符量）。
- 兜底语义不变：档案解析失败或字段缺失时，各链回到自己原来的 LLM 归纳——最坏情况与旧行为一致，不会因新层损失任何图。
- **「🤖 AI 生成」= 会话回合生成（图生成走会话，已实施）**：见机制 10「图生成走会话」条目——后端出提示词（事实嵌入）、客户端发进当前会话、GUI 对话流实时展示生成过程、回答按 `figId` 落缓存、面板回合结束刷新。**flow 双视角**：流程图 Tab 顶部「事件驱动 / 数据管道」角度 chip 纯本地切换（刷新页面记住选择）；会话生成只带当前视角，切到未生成视角时按需触发一次会话生成。旧的档案字段级再生成（`regenerateProfileField` + `@Remote('regenerateFigure')`：写回档案、core 再生成连坐置空 flow/seq/events）仍保留在后台作链兜底与调试，客户端已不再调用；会话生成不写档案、core 生成也不连坐（会话模式的 seq/flow 端点约束是全索引包 id 而非 coreIds，无悬空风险）。文档流程（`source:'doc'`）角度无关且权威。
- **「⏹ 终止」= 真正掐断生成（已实施）**：`abort.ts` 维护每工作区根一个 `AbortController`；所有 LLM 调用（`llmText` 与 concept/duties/progress 独立循环）把 `generationSignal(root)` 传给 `prepareCall` 与 stream 并在 chunk 间检查——`@Remote('cancelGeneration')` 触发 abort 后 provider 流**立即停止计费**，调用抛 `generation aborted` 不记入用量。客户端「⏹ 终止」按钮同时丢弃所有在途响应（stopRef + generation 守卫），显示「已终止生成」，迟到错误不会覆盖该提示。

### 机制 10：LLM 用量统计（provider 实际 token 优先）

- 新文件 `llm-stats.ts`：每次模型调用记录 `{ kind, 输入/输出字符数, 估算 token, 耗时 }`，内存保留最近 100 条 + 全量累计。
- **provider 实际 token（优先）**：dsh-llm 流式接口会发 `{ type: 'usage', usage: TokenUsage }` chunk（`inputTokens/outputTokens/cacheRead/cacheWrite/reasoning`）——所有调用点（`llmText`、concept/duties/progress 独立循环）都捕获它；`normalizeUsage` 归一化为"计费输入 = 未命中输入 + 缓存读 + 缓存写"、输出 = completion、reasoning 单列。
- **估算（兜底）**：adapter 不发 usage chunk 时用字符估算——ASCII ≈ 4 字符/token、CJK ≈ 1.5 字符/token，`ceil(ascii/4 + nonAscii/1.5)`（`estimateTokens`，单测锁定）。估算同时保留作对照（可评估公式误差）。
- 查询：`@Remote('llmStats')` 返回累计（估算与 actual 双口径）+ 明细，并落盘工作区根 `.arch-lens-llm-stats.json`（重启后可查）。
- **面板 UI（已挂）**：header「⚡ LLM」按钮展开用量面板——累计（调用次数 / 输入 / 输出 / 总耗时，**有实际 usage 时显示实际值**）+ 最近 20 条记录（kind · 输入→输出 token（实际/估）· reasoning · 耗时 · 时间）；每次 🤖 AI 生成 / 📄 一键生成文档 / 学习进度总结完成时，通知里附带本次调用的实际/估算 token 与耗时。
- **讲解与会话约定（用户确认）**：讲解始终发到**当前会话**（共享会话上下文、对话连贯）；需要干净解读时**手动新开会话**是约定做法，插件不自动建会话。讲解回合结束后，面板顶部出现可折叠「🧠 思考链」框——后端 `@Remote('lastAnswer')` 用 `sessions.get().deriveMessages()` 取出最近一条 assistant 消息的 `reasoning` 块投影给面板渲染（消息本身仍留在会话里，面板只读副本）。
- **「🤖 AI 生成」= 图生成走会话（已实施，界面 SSE）**：后端 `@Remote('figurePrompt')` 用代码事实构建带唯一 `figId` 的生成提示词并暂存 `pendingFigure`（30 分钟 TTL 一次性匹配）——事实嵌入：`indexSummary` 摘要（🔬 方法级开启时含类方法名 + 真实调用边 file:line）、flow 带当前视角规则 + 风格条、seq 带主线约束（入口包 + 被依赖最多核心包）；客户端 `props.send` 把提示词发进**当前会话**，GUI 对话流实时展示 agent 思考/读码/输出（这就是「界面 SSE」，面板零推送管道）。回答后，后端 `session/event` 的 `assistant/message` 监听器按 `figId` 匹配（会话无关——figId 唯一性即门禁），`extractFigureJson` 容忍散文/围栏/嵌套（整体解析优先 + 平衡括号扫描），`writeFigureCache` 清洗后写入**与图链完全相同的缓存文件**（flow 经 `sanitizeMermaid` 修边标签括号；seq/core 端点须 ∈ 索引包 id），面板在回合结束（running 翻转）后按图种刷新即渲染新图。解析失败则保持暂存至 TTL 过期——普通聊天不可能被误解析（figId 匹配 + TTL 双保险）。后端直连 LLM 保留用于：冷启动共享档案、链兜底、📄 一键生成文档、目录职责摘要。
- **「🤖 动态画图」（hover 钻取，已实施）**：时序图（主流程时序）**边**与流程图**子块**上 hover 会露出「🤖 动态画图」按钮——时序边 = 钻取这两个包之间的**方法级调用时序**（提示词嵌入两包方法级摘要 + 真实调用边 file:line，产物 mermaid sequenceDiagram）；流程子块 = 展开该阶段为**详细 flowchart**（提示词嵌入当前 mermaid 源 + 代码摘要，产物 flowchart）。同样走会话生成：`@Remote('dynamicFigurePrompt')` 出提示词（figId + 目标 key）→ `props.send` → 监听器按 figId 匹配 → `writeDynamicFigureCache` 写入**按目标哈希的独立缓存** `.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`（djb2 哈希，客户端镜像 targetKey 保证同文件命中）；回合结束面板弹层自动展示，**生成过的目标再次 hover 点击直接打开缓存**（不再生成），弹层可折叠/收起/关闭。hover 实现：时序边 = `SequenceGraph` 自绘 SVG 的边命中层；流程子块 = `MermaidView` 对 mermaid 渲染结果 `g.cluster` 标题的包围盒定位浮层按钮。
- **⚙️ 生成过程展示（早期长轮询形态已下线，改为会话回合）**：早期版本用 `abort.ts` 状态槽 + `@Remote('generationStatusNext')` 长轮询（SSE 语义）在面板 tip 行下显示「⚙️ 生成过程」框；用户确认「不在机器人面板上展示」后，该框与客户端订阅、`generationStatus/generationStatusNext` 的客户端调用均已移除。`abort.ts` 的 per-root `AbortController` 仍服务「⏹ 终止」；状态槽与长轮询 RPC 保留在后台（调试/测试仍用，见 `tests/llmText-usage.spec.ts`）。图生成的实时过程现由**会话对话流**承担（上条）。注：真正的 HTTP SSE 需要 harness 侧开放路由/事件白名单（`API_REMOTE_FORWARDED_EVENTS` 锁死、插件 remote 只支持 Promise 返回），在「不能改 deepseek-harness」约束下「图生成走会话」是会话通道内最接近 SSE 的形态。

---

## 四、绘图流程速览

所有图元的生成遵循同一条总原则：**缓存优先 → 文档/代码优先 → 共享分析档案 → 链自身 LLM 兜底 → 带出处**。
每个图元 = 一条独立链，链上每阶段是独立函数（可重排可替换）；AI/文档产物都落到工作区根 `.arch-lens-<kind>-<lang>.json` 磁盘缓存。

| Tab | 图元 | 生成链（按顺序） | 来源标记 | 磁盘缓存 |
|---|---|---|---|---|
| ① 概念树 | `conceptTree` | 缓存 → 文档逐字提取（7 候选，非 English zh 优先）→ 档案 conceptTree → LLM 归纳 | `doc` / `flow` | `.arch-lens-concept-<lang>.json` |
| ② 时序 | `sequence` | code 视图：静态调用图 → 缓存 → 文档「## 时序」→ 档案 seqMessages → LLM；flow 视图跳过调用图 | `code` / `doc` / `flow` | `.arch-lens-sequence-<lang>.json` |
| ③ 流程图 | `flow` | 缓存（按 语言+角度）→ 文档围栏（mermaid 原样 / `text` 伪代码 LLM 转码，角度无关）→ 档案 flow 映射（两视角一次生成，按角度命中）→ LLM 归纳（按角度提示词：阶段 subgraph + ≤16 节点 + 动作边 + 单主线） | `doc` / `flow` | `.arch-lens-flow-<lang>-<angle>.json` |
| ④ 交互 | `events` | 结构化缓存 → 档案 events → null（空状态）；AI 生成 = 档案 events 字段级再生成；图上事件框显示事件名 + 中文 note 概要 | `flow` | `.arch-lens-events-<lang>.json` |
| ⑤ 依赖 | `mermaidCore` | 仅核心子图（coreFlowchart，无 full 视图）：核心选包（缓存 → 档案 coreIds → LLM 4–25 → curated 回退）+ `importEdges` 画边 | `flow` / `curated` | `.arch-lens-core-<lang>.json` |
| ⑥ ER | `mermaidCore` | 仅核心子图（coreErDiagram，无 full 视图）；线色 directive 保证 import 边可见 | `flow` / `curated` | `.arch-lens-core-<lang>.json` |
| ⑦ 目录 | `graph` + `summarizeDuties` | 扫描 blurb（zh 优先）→ `dutyText`；AI 职责总结分批（打开目录 Tab 自动加载/补全；`blurbZh` 缺失时未生成摘要前显示英文 blurb） | `flow` | `.arch-lens-summaries-<lang>.json` |

共享分析档案（`analysis.ts`，`.arch-lens-analysis-<lang>.json`）是 ①–⑥ 的公共 LLM 兜底：一份档案喂五条链，见机制 9。

**来源标记含义**（客户端据此打徽标，讲解时作为证据引用）：`doc` = 架构文档原文（逐字提取/原样渲染，权威，带 `ref` 锚点 + `sourceText`）；`code` = 真实静态调用图（代码事实，权威）；`flow` = LLM 从代码元数据归纳（非权威）；`curated` = 确定性规则回退（非权威）。

详细图解见 `docs/arch-lens-diagrams.md`：图 3（七 Tab 总览）、图 4（AI 生成链）、图 5（时序/交互链）、图 6（依赖/ER 双视图）。

---

## 五、一句话总结

> 这是一个**"代码仓库自学桌"插件**：host 侧用 Cordis 服务 + tree-sitter 离线索引 + LLM 缓存链把仓库变成一组可解释的图元，通过 Typert RPC 喂给浏览器侧的学习台；学习台不自己聊天，而是把"带事实依据的讲解问题"塞进主会话管线，答案回到主对话并由唯一事件监听路径沉淀成 `ARCH-NOTES.md`，再反哺"学习进度"统计——形成一个**扫描 → 制图 → 讲解 → 笔记 → 进度**的闭环。所有 AI 产物都是"缓存优先、文档优先、可失效、带出处"的设计。
