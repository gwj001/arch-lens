# Arch Lens（架构学习台）包分工与关键机制

> 本文档对 `packages/*` 源码直接阅读总结，描述现状最终链路：图注册表 / 版本化信封 / 统一写路径 / 级联失效 / 文档章节管线（幻觉门禁）/ 统计文件账本 / 讲解按钮族与图渲染配置。
> 阅读顺序建议：包分工 → 关键机制 1→10 → 绘图流程速览 → 对照代码浏览。

---

## 一、这个项目是什么

**Arch Lens（架构学习台）** 是 DeepSeek Harness（DSH）的一个扩展插件，独立仓库形态（`pnpm workspace`，5 个包）。作用：把任意工作区代码仓库变成"可学习的对象"——

1. 扫描出包依赖图（`packages/<组>/<包>` 树 + peerDependencies 边）；
2. 生成概念 / 时序 / 流程图 / 交互 / 依赖 / ER / 目录等学习单元（图元），外加「⚡ 动态总览」共 **8 个 Tab**；
3. "AI 讲解"不自己聊天，而是把带**事实依据**的问题塞进**主会话管线**发问；
4. 回答留在**会话历史**——会话记录就是笔记（问答与图全都在）。旧版 `ARCH-NOTES.md` 笔记
   系与"学习进度"统计已于 2026-09 退役（机制存档见下）；「📄 一键生成文档」同期重做为
   **章节管线**（每章一次 LLM + 幻觉门禁，机制 10）。

配套图：见 `docs/arch-lens-diagrams.md`。

---

## 二、包分工

| 包 | 侧 | 职责 | 入口代码 |
|---|---|---|---|
| `typert-protocol` | 共享 | 从 deepseek-harness 拷贝的 Typert Remote 协议：`@Remote` 装饰器、`TypertRemoteService` 基类、`RemoteResult` 信封 | `packages/typert-protocol/src/index.ts`、`types.ts` |
| `code-index` | Host | **能力缝 Service Definition**：抽象 `CodeIndex` 服务（`indexWorkspace(root, policy?, factsVersion?)` / `refresh(root)`）+ 线类型（`CodeEntity` / `CodeImport` / `CodePackage` / `CodeIndexResult`）。契约：**提供方必须以 `{v: factsVersion, data}` 版本信封落盘**，事实版本未知（0）时不得持久化 | `packages/code-index/src/index.ts`、`types.ts` |
| `code-index-tree-sitter` | Host | `ctx.codeIndex` 的 **tree-sitter 提供方**：TS / Python / Java 实体与 import 提取，纯离线 AST、无 LLM，内存 + 磁盘双层缓存（信封读写 `envelope.ts`） | `packages/code-index-tree-sitter/src/index.ts`、`envelope.ts`、`discover.ts`、`*-adapter.ts` |
| `arch-lens-backend` | Host | `ctx.archLens`（`TypertRemoteService`）：扫描、Mermaid 规则图、图注册表与统一写路径、AI 链、会话图生成、文档章节管线 | `packages/arch-lens-backend/src/index.ts` + 下列模块 |
| `client-arch-lens` | Browser | 浏览器半区：`client.js`（mermaid 内联），悬浮机器人 + 8 Tab 学习台。讲解入口在概念树 / 追问对话框 / 动态出图动作行（「🗣 AI 讲解」，图源附件带 `lastAttachedFigRef` 脏检）；header 📊 旁实时进度徽章（`progressStats` 零 LLM）；调用关系图由 `callGraphToMermaid` 合并平行边（×N）、双向归一 `<-->`、图内 `curve:linear` 渲染；全局 flowchart linear + 宽间距，子图 hover 几何命中 + 浮动按钮 150ms 宽限 | `packages/client-arch-lens/src/client/*` |

后端模块按职责分层：

- **事实与缓存内核**：`fact-cache.ts`（版本信封读写 + `selectiveInvalidate` 两段式失效）、`figures.ts`（**图注册表**：图清单 / 权威文件名 / deps 规则 / 统一写入口 `writeFigure` / `runEntityFigurePass` / `readIndexFacts`）；
- **图链**（每条 = 缓存 → 文档/代码 → 共享档案 → 链自身 LLM）：`concept.ts` / `flow.ts` / `sequence.ts` / `docsgen.ts`（结构化归纳）/ `core.ts` / `summarize.ts` / `analysis.ts`（共享档案）；
- **会话生成**：`session-figure.ts`（实体图 + 动态下钻图的提示词、清洗、落盘）；`followup.ts`（原地追问重画）；
- **文档章节管线**：`docchapter.ts`（7 章 prompt/落地/信封缓存/修复）+ `doc-hallucination.ts`（零 LLM 幻觉门禁）；
- **规则图与事实**：`scan.ts` / `mermaid.ts` / `analyze.ts` / `mermaid` 无关的 `notes.ts`（已退役，常量屏蔽）/ `progress.ts`（已退役，常量屏蔽）/ `policy.ts` / `abort.ts` / `llm-stats.ts` / `types.ts`。

依赖关系（import 与 peerDependencies）：`arch-lens-backend` → `typert-protocol`、`code-index`（**仅类型**，运行时经 `ctx.get('codeIndex')` 结构型获取，缝签名演进不需要重建 harness）；`code-index-tree-sitter` → `code-index`（实现抽象类）；`client-arch-lens` → `arch-lens-backend`（仅类型）；`@deepseek-ai/*` 宿主包指向 `../../deepseek-harness`。

---

## 三、关键机制

### 机制 1：前后端通过 Typert RPC 通信

- 后端 `ArchLensService extends TypertRemoteService`，**41 个** `@Remote` 方法暴露为 `ctx.remote.archLens`（graph / refresh / refreshIndex / generateAll / setSession / component / notes / notePending / promptConfig / promptConfigSave / mermaidDeps / mermaidEr / mermaidIndexed / mermaidCore / callGraph / overviewFigure / conceptTree / generateDocs / sequence / events / flow / analyze / summarizeDuties / progress / progressStats / figurePrompt / regenerateFigure / dynamicFigurePrompt / dynamicFigure / customFigurePrompt / customFigure / customFigureList / saveCustomFigure / customFigureDelete / figureFollowUp / cancelFollowUp / cancelGeneration / generationStatus / generationStatusNext / llmStats / lastAnswer）。
- **已废弃面（wire 保留、不再演进）**：`mermaidEr` / `mermaidIndexed` / `mermaidDeps`（全量视图，学习价值低，客户端不依赖）；`resolveSequence` 的 code 视图分支不再被任何链引用（真实调用边由 `callGraph` remote 独立呈现）。
- 客户端 `remote.ts` 手写签名 + `unwrapRemote` 解包；`@Remote('name')` 显式指定线名。

### 机制 2：讲解不走自研聊天 UI，走主会话管线

- `FloatingBot` 的 `send` = `sessions.binding(id).session.prompt(...)`，回答渲染在主线对话里，零自定义聊天 UI。
- **目标会话跟随左侧栏当前会话**；切会话时 `setSession(sessionId)` **纯加载、从不失效缓存**（扫描缓存按 workspace root 命中）；失效只发生在「↻ 重新扫描」。
- explain 队列：同一时间只跑一个，`running` 翻转解锁 + 20 秒兜底。

### 机制 3：笔记写入只有一条路径（已退役，机制存档）

> ⚠️ 2026-09 退役：`NOTES_FEATURE_OFF` 常量屏蔽全部笔记面（`notes`/`notePending` RPC
> 早退、讲解完成不再落盘、面板与徽章不渲染）；代码与既有 `ARCH-NOTES.md` 文件保留。
> 理由：**会话记录本身就是更完整的笔记**（问答与图全都在历史里）。

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
- 「全量重建」= `incremental=false`，无条件重绘。

### 机制 5：图注册表与统一写路径（单一来源原则）

- `figures.ts FIGURE_SPECS`（7 实体图：duties / concepts / core / seq / flow-event / flow-pipeline / interaction，顺序 = 认知主干，见 `docs/design-comprehension-spine.md`）是**图清单、权威缓存文件名（委托各链模块导出）、构建入口的**唯一来源**——手拼文件名被结构性杜绝（回归测试锁文件名契约）。
- **所有图写入只有一条路**：`writeFigure(fs, root, kind, language, factsVersion, data, {index?, methods?, deps?, policy?})` → 解析权威文件名 → 按 `figureDeps` 规则盖章 → `writeVersionedCache` → **主干级联**（理解主干阶段 2：`invalidateRequiring` 墓碑所有 `requires` 本种类的消费者信封——嵌入该图的章节；方法级写入不级联实体章节）。链内写、会话回答落盘（`writeFigureCache`）、追问重画、组装补建，无一例外；resolve 失败**抛错**由调用方决定是否致命（generateAll 收集、followup 保留非致命语义）。
- `factsVersion` 必须在**生成开始时**读，写侧沿链传递——中途重扫不得把新戳盖到旧事实的产物上。
- 时序缓存写侧统一 `{source, messages}` 对象形态；磁盘裸数组由 `readSeqCache` 兼容读归一，不迁移文件。
- 方法级（🔬）缓存 = 同名 `-methods` 文件，同一注册表；按需生成、不进 generateAll。

### 机制 6：概念树 / 流程图 / 时序都是"文档优先链"

- 概念树：探测候选文档（非 English zh 优先，**README 作为使用目录被排除**、其一跳链接
  也不跟）→ 标题层级**逐字提取**（`source:'doc'` + `ref` + `sourceText`）；提取树过浅
  或候选全空回退档案/LLM（`source:'flow'`）。
- **README 对三条 doc 链（概念树/流程图/时序）统一排除**；flow/sequence 把 README
  原本链接的图文档（diagrams）作为额外候选保留 doc 流程/doc 时序能力。
- 流程图（n×n 交叉视角：实体/方法级 × 事件驱动/数据管道）：`mermaid` 围栏原样渲染
  **只锚定实体×事件一格**（文档声称的角度无关、权威、零 LLM）→ `text` 伪代码仅格式
  转码 → 档案 `flow: {event, pipeline}`（两视角一次生成，切视角零 LLM）→ 链 LLM 归纳
  （视角规则 + `FLOW_STYLE_RULES` + 方法级摘要——同一套算法，输入不同）；一切 mermaid
  出图前过 `sanitizeMermaid`。缓存按 语言+角度+方法级 分文件（注册表名）。
- 时序（注册表链）：缓存 → 文档「## 时序」逐字解析（`source:'doc'`）→ 档案 `seqMessages` → 链 LLM。静态调用关系由 `callGraph` remote 独立呈现，不在文档链里。
- 交互：缓存 → 档案 `events`（命中即写回缓存）→ 链 LLM 归纳（「⚡ 变动更新」会补建交互图）。

### 机制 7：核心子图（deps / ER 的默认视图）

- LLM 从索引摘要选 4–25 个核心包（校验 ∈ 索引，`source:'flow'`）；失败回退"入口包+import 邻居"（`source:'curated'`，**故意不写缓存**，下次重试）。deps/ER 只渲染核心子图；边由 `importEdges` 规则聚合（零 LLM）。

### 机制 8：代码索引纯离线

- 语言探测（package.json / pyproject.toml / pom.xml）→ 每包 ≤400 文件、每文件 ≤256 KiB → tree-sitter 提取实体/import/调用边；内存 Promise 单飞 + 磁盘 `{v,data}` 信封双层缓存；不做 LSP。

### 机制 9：共享分析层 + 会话图生成 + 终止

- `analysis.ts`：一份共享档案 `{coreIds, conceptTree, flow, seqMessages, events}`，单飞锁，冷启动自动路径**恰好两次串行 LLM**（结构 + 图元）；有文档仓库仍 0 LLM。档案命中即由各链写回**自己**的版本化缓存。
- 「🤖 AI 生成」= 图生成走会话：`figurePrompt` 出带 `figId` 的提示词 → 客户端发进当前会话 → `assistant/message` 监听按 figId 匹配（TTL + 会话无关双保险）→ 清洗后**经 `writeFigure` 统一写入口**落盘（文件名与 deps 和各链同一注册表同一规则）。
- 「🤖 动态画图」（hover 钻取）：时序边 / 流程子块 / 总览各写 `.arch-lens-dynamic-<kind>-<hash>[-<lang>].json` **版本信封** `{v, deps, data:{title, diagram, source, kind, targetKey}}`；deps 规则唯一来源 `dynamicFigureWriteFacts`（seq-edge→端点包、flow-subgraph→父流程 deps、overview→全部包）。失效/过期 → 读取返回 null → 下次 hover 重新生成；重扫时随父图级联失效（机制 4 第二段）。💾 用户保存图 `.arch-lens-draw-*` 是**用户资产，任何失效逻辑永不触碰**。
- 「⏹ 终止」：`abort.ts` per-root AbortController，所有 LLM 调用点挂 signal，真掐流并停计费。

### 机制 10：LLM 用量统计、文档章节管线（幻觉门禁）与学习进度存档

- `llm-stats.ts`：每次调用记录 kind/字符/估算与 provider 实际 token/耗时，落盘 `.arch-lens-llm-stats.json`；面板「⚡ LLM」查累计与最近明细。**统计以文件为账本**（重启不丢）：工作区账本经进程级一次性 `adopted` 守卫**加性折叠**进内存（懒 adopt 时机 = setSession 与读快照前，读快照先 adopt 后写，杜绝空内存覆盖磁盘历史）；`clearLlmStats()` 同时重置 adopted。

- **「📄 一键生成文档」= 章节管线（V1）**：`generateDocs` 一个 RPC 内**串行**跑 7 章
  （`docchapter.ts`，顺序 = 认知主干：包目录职责 → 概念层级 → 依赖 → 时序 → 流程图 →
  实体关系 → 核心交互），每章一次独立宿主直连 `llmText`（kind `docs`，与图生成同一通道；
  `docs` 类调用提案模型最低思考档——正文是受限结构化任务，思考链曾占墙钟 90%）：
  1. **同一份事实快照喂 prompt 与门禁**：`buildGroundTruth` 一轮只算一次（包/文件/边），
     章节 prompt 与幻觉检查消费同一快照，杜绝"生成时真、检查时旧"；
  2. **图驱动章节是纯消费者**：概念/时序/流程/交互四章只读对应图缓存（概念树/时序/
     流程两视角/交互），缺图**跳过**并给出可操作理由（"先去对应 tab 补图"），从不
     暗中触发图生成——一次点击的费用面是确定的；依赖/ER/目录三章只靠代码事实；
  3. **幻觉门禁**（`doc-hallucination.ts`，纯函数零 LLM、宁可漏报不误报）：拦截带 scope
     的编造包名（给最近真包建议）、不存在的文件路径（`./`/反斜杠归一、大小写宽容）、
     `| 调用方 | 被调用方 |` 表里的虚构边与方向颠倒（给反向建议）；围栏代码块与裸标识符
     永不拦截。违规 → **一轮修复**（只修列出的违规、禁改语义）；修复后仍不过关 → 带
     ⚠️ 落地但**不写缓存**（下轮重试）；
  4. **落地与信封**：每章独立写 `docs/architecture-<章>.generated.md`（文件头
     `<!-- arch-lens generated · chapter=… -->` 来源注释，重生成覆盖）+ 版本化信封缓存
     `.arch-lens-docchapter-<章>-<语言>.json`（V1 `deps` = 全部包：任何代码变动使全部章节
     失效——细粒度依赖是 V2① 项（已实施：时序/交互/依赖/ER 章 `deps` 与事实块同源收窄——ER 章按被列出实体的所属包∪核心 ids，实体增删必失效、函数实现变化不失效；无关包变动只重盖章保留正文；目录/概念/流程章保持全量）；信封另记 `requires`=消费的缓存种类——嵌入的图**与**级联语境输入（流程/交互→`seq`，ER/目录→`core`），任一就地重生即级联失效本章）。新鲜缓存直接跳过，重复点击**只补缺/重试失败章**；
   5. **过期信封当「先前稿」（理解主干阶段 1）**：章节信封版本失配时不丢弃，旧正文作
      修订底稿喂回（`chapterRevisePrompt` = 修订前言 + 上一版 + 原提示词）——任务从"创作"
      变"只改受影响部分"，提示词更小、输出更稳；幻觉门禁照旧复审修订产物，防"旧错误锚定"。
      同一条 `readStalePrior` 链也接入了时序/交互/流程/核心四条图归纳（概念树自研流式归纳，
      暂未接）。逃生门：🔁 全量重建（force）永远跳过 prior；删除信封文件 = 同时移除缓存
      与 prior，回到全新生成。
   6. **级联语境（理解主干阶段 2 §4.2/§3.3）**：上游结论作事实段注入下游章节提示词——
      主干核心包（protagonists）进 ER/目录章（无图可嵌的代码事实章由此获得主干锚点），
      黄金路径（时序消息序列）进流程/交互章、路径触及的实体进 ER 章。与既有【事实】
      块同格式、同受门禁复核
      （上游结论源自事实、下游引用仍被复查，不引入新幻觉面）；缺上游图则优雅退回原
      事实块。注入即 `requires`（消费即依赖），与级联失效账实相符。
   7. **新鲜讲解零二次 LLM（理解主干阶段 3 §五）**：tab 讲解按文档语体写就、落版本
      信封 `.arch-lens-explain-<章>-<语言>.json`（`deps`=该章图 deps、`requires`=章账）；
      章节生成时新鲜讲解（`v===factsVersion` 且过幻觉门禁）直接当正文落地，省掉整次
      LLM 调用——学习过的章节，文档白得。过期/缺失/违规一律回落宿主直连生成。
  - **已删除的旧实现**：`docbuild.ts`（图缓存 → markdown 的零 LLM 模板组装，含
    `ensureFigure` 补建与 `generateDocSection` 单节面）——模板正文达不到可交付质量，
    整条链与 `DOCS_FEATURE_OFF` 开关一并移除（非屏蔽）。

- `progress.ts` 学习进度（**已退役，机制存档**，`NOTES_FEATURE_OFF` 同批屏蔽，理由同机制 3）：
  覆盖度纯算术（笔记里 `组件 X` target 命中节点 id/short 才计分）+ 教练 LLM 归纳。缓存
  `.arch-lens-progress-<lang>.json` 同为版本信封（`deps=全部包`）；`selectiveInvalidate`
  遍历跳过 progress 文件（靠自校验）。结果带 `generatedAt`/`fromCache`；header 📊 旁实时
  徽章（`progressStats` 纯算术零 LLM）。

- 可选图说明（`withDescriptions`，默认关闭，随旧组装链退役后**无调用方**，保留对象形态图的
  类型面与批量说明能力待 V2 复用）：对象形态图（flow/seq/core）类型带 `description?: string`；
  开启时恰好一次批量 LLM 产说明并同信封 read-modify-write 回写（保留原 v/deps）。

- **文档口径边界**：章节管线只收注册表 7 实体图（+流程两视角）。方法级（🔬 `-methods`）、
  动态下钻图、🎨 动态出图、💾 已保存图（用户资产）均不进文档。生成文档永远只写带
  `.generated.md` 后缀的文件；`docs/architecture.md` 是用户保留文件，任何路径不写。

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

- 触发入口三件套：「🔁 全量重建 / ⚡ 变动更新」= `runEntityFigurePass`（注册表 7 图，机制 4）；「🤖 AI 生成」= 会话回合（机制 9，同一注册表写路径）；「📄 一键生成文档」= 章节管线串行（机制 10，纯消费图缓存、不补建）。
- 来源标记含义：`doc` = 文档原文（权威，带锚点）；`code` = 静态调用图（权威）；`flow` = LLM 归纳（非权威）；`curated` = 规则回退（非权威）。

详细图解见 `docs/arch-lens-diagrams.md`。

---

## 五、一句话总结

> 一个**"代码仓库自学桌"**：host 侧以 `factsVersion + 版本信封 + 图注册表 + 统一写路径` 为事实脊柱，把 tree-sitter 离线索引和 LLM 缓存链产出的每类图**盖着事实戳**存进各自缓存文件；重扫只做两段式级联失效（变动包命中的图才重画），一键文档按 7 章串行生成、每章先过零 LLM 幻觉门禁再落地；学习台不自己聊天，把带事实依据的问题塞进主会话管线，答案沉淀在会话历史里（会话记录 = 笔记）——**扫描 → 制图 → 讲解 → 成文**闭环，所有 AI 产物"缓存优先、文档优先、版本可失效、出处可追溯"。
