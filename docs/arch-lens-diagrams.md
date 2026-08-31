# Arch Lens 绘图机制图解（Mermaid 源码）

> 本文件由对 `packages/*` 源码的直接阅读生成，每个图节点都标注代码出处；
> 标 `【推断】` 的节点对应实现位于 deepseek-harness（本仓库之外），无法在仓库内交叉验证。
> 阅读顺序建议：速览表 → 图 3（各 Tab 总览与文件存储）→ 图 4/5/6（各图元生成链）→ 图 1/2（拓扑与数据）→ 图 7/8/9 → 第十一章（事实源与验证量化）→ 图 10（包目录职责三入口）。

---

## 一、绘图速览

**总原则：缓存优先 → 文档/代码优先 → 共享分析档案 → 链自身 LLM 兜底 → 带出处。**
每个图元 = 一条独立链，链上每阶段是独立函数（可重排可替换）；所有 AI/文档产物都落到工作区 `index/` 目录（统一缓存目录，常量 `CACHE_DIR`）下的 `.arch-lens-<kind>-<lang>.json` 磁盘缓存（`<lang>` 为净化后的角色语言，默认 `中文`）。

| Tab | 后端 Remote / 图元 | 生成链（按顺序） | 来源标记 | 磁盘缓存 | 客户端渲染 |
|---|---|---|---|---|---|
| ① 概念树 | `conceptTree` | 缓存 → 文档逐字提取（7 候选，非 English zh 优先）→ 档案 conceptTree → LLM 归纳 | `doc` / `flow` | `.arch-lens-concept-<lang>.json` | `ConceptGraph` |
| ② 时序 | `sequence`（注册表链固定 `prefer:'flow'`；调用关系另有 `callGraph` 独立线） | 主流程：缓存 → 文档「## 时序」→ 档案 seqMessages → LLM；调用关系图：直读索引真实调用边（零 LLM 不落缓存） | `doc` / `flow`（+`code` 仅 callGraph） | `.arch-lens-sequence-<lang>.json` | `SequenceGraph`（主流程）/ `MermaidView`（调用关系：`callGraphToMermaid` 平行边合并 ×N、双向 `<-->`、图内 init `curve:linear`） |
| ③ 流程图 | `flow` | 缓存（**按语言+角度**）→ 文档围栏（mermaid 原样 / `text` 伪代码 LLM 转码）→ 档案 flow → LLM 归纳 | `doc` / `flow` | `.arch-lens-flow-<lang>-<angle>.json` | `MermaidView` |
| ④ 交互 | `events` | 结构化缓存 → 档案 events → null（空状态）；「🤖 AI 生成」走会话（`figurePrompt` kind=events，figId 匹配后经 `writeFigure` 落盘） | `flow` | `.arch-lens-events-<lang>.json` | `InteractionGraph` |
| ⑤ 依赖 | `mermaidCore`（核心子图；全量视图 `mermaidIndexed`/`mermaidDeps` 已废弃，仅 wire 保留） | 核心选包（缓存 → 档案 coreIds → LLM 4–25 → curated 回退）+ `importEdges` 规则画边 | `flow` / `curated` | `.arch-lens-core-<lang>.json` | `MermaidView` |
| ⑥ ER | `mermaidCore`（同上，全量已废弃） | 同依赖（同一份核心选择，ER 规则生成） | `flow` / `curated` | `.arch-lens-core-<lang>.json` | `MermaidView` |
| ⑦ 目录 | `graph` + `summarizeDuties` | 扫描节点 blurb（zh 优先）→ `dutyText`；AI 职责总结（缓存 + 分批 40/调用 2 批） | `flow` | `.arch-lens-summaries-<lang>.json` | `Catalog` |

共享分析档案（`analysis.ts`，`.arch-lens-analysis-<lang>.json`）是 ①–⑥ 的公共 LLM 兜底：两次串行调用（结构 = coreIds+conceptTree；图元 = flow+seq+events）喂五条链，单飞锁共享，见第十一章。

**来源标记含义**（客户端据此打徽标，讲解时作为证据引用）：
- `doc` = 架构文档原文（逐字提取/原样渲染，权威，带 `ref` 锚点 + `sourceText`）；
- `code` = 真实静态调用图（代码事实，权威）；
- `flow` = LLM 从代码元数据归纳（**非权威**）；
- `curated` = 确定性规则回退（入口包 + import 邻居，**非权威**）。

---

## 二、图 1：总体运行时拓扑

```mermaid
flowchart LR
    subgraph HOST["Host 进程（Node）"]
        CORDIS["Cordis 插件运行时"]
        AL["ctx.archLens / arch-lens-backend / TypertRemoteService"]
        CI["ctx.codeIndex / code-index-tree-sitter"]
        LLM["ctx.llm / agentDefaultModel"]
        FS["ctx.fs"]
        GATEWAY["Typert Gateway（【推断】见 typert-protocol + lib/typert.host.js）"]
        AL -->|"indexWorkspace / refresh"| CI
        AL -->|"prepareCall + stream"| LLM
        AL -->|"resolve / stat / read / write"| FS
        AL -.->|"session/event 监听"| CORDIS
        GATEWAY --> AL
    end
    subgraph BROWSER["浏览器（DSH Web GUI）"]
        MOD["window.__ModuleLoader__ 模块表（tsdown.helpers.ts banner）"]
        CLIENT["client.js（client-arch-lens bundle）"]
        BOT["FloatingBot / shell.overlay 槽位（client/index.ts）"]
        DESK["ArchView 学习台 / ⚡总览 + 7 学习单元（8 Tab）"]
        MM["mermaid 11 渲染（内联，pan/zoom）（mermaid-view.tsx；flowchart 全局 curve:linear + nodeSpacing60/rankSpacing90，杜绝 basis 捆束压字）"]
        CLIENT --> MOD
        BOT --> DESK
        DESK --> MM
    end
    GATEWAY <-->|"Typert RPC：remote.archLens.*"| CLIENT
    DESK -->|"props.send → sessions.binding(id).session.prompt([{type:'text',text}], 'queue')"| CLIENT
    CLIENT -->|"sessions 客户端 face → 宿主 RPC【推断】"| GATEWAY
```

出处：`packages/arch-lens-backend/src/index.ts`、`packages/client-arch-lens/src/client/*`、
`packages/tsdown.helpers.ts`、`packages/typert-protocol/src/index.ts`。

---

## 三、图 2：数据管线（扫描 / 索引 → 图元）

```mermaid
flowchart TD
    ROOT["workspace root / 目标会话 cwd 或 sandboxPolicy（index.ts resolveRoot）"]
    SCAN["scanWorkspace / packages/组/包 → package.json/README/src（scan.ts）"]
    GRAPH["ArchLensGraph / nodes+edges+detail 随图预计算（scan.ts）"]
    DETECT["detectLanguage / package.json / pyproject / pom（discover.ts）"]
    PKGS["discoverPackageRoots（discover.ts）"]
    PARSE["tree-sitter 提取 / TS/Py/Java 适配器（ts-adapter.ts 等）"]
    INDEX["CodeIndexResult / packages/entities/imports/calls/entryFiles"]
    DISKCACHE[".arch-lens-index.json 磁盘缓存（{v,data} 信封：读侧校验 v===factsVersion，legacy/失配按无缓存重索引）"]
    MERMAID["mermaid.ts 纯函数 / flowchart / erDiagram / importEdges 规则聚合"]
    CONCEPT["conceptTree 链（concept.ts）"]
    FLOW["flowDiagram 链（flow.ts）"]
    SEQEVENT["sequence 双视图（code 静态调用图 / flow 主流程时序，sequence.ts）+ events 结构化缓存（docsgen.ts）"]
    CATALOG["catalog：客户端 dutyText（catalog.tsx）/ AI summaries 分批（summarize.ts）"]
    INSIGHT["analyze：正则代码洞察 / provides/listens/remotes/tools（analyze.ts）"]
    PROGRESS["progressStats / summarizeProgress（progress.ts）"]
    ROOT --> SCAN
    ROOT --> DETECT
    DETECT -->|"unknown 直接返回"| INDEX
    DETECT --> PKGS --> PARSE --> INDEX
    INDEX --> DISKCACHE
    DISKCACHE -.->|"语言匹配则命中"| INDEX
    SCAN --> GRAPH
    INDEX --> MERMAID
    INDEX --> CONCEPT
    INDEX --> FLOW
    INDEX --> SEQEVENT
    GRAPH --> CATALOG
    GRAPH --> INSIGHT
    GRAPH --> PROGRESS
```

出处：`scan.ts`、`discover.ts`、三个语言适配器、`mermaid.ts`、`docsgen.ts`、`analyze.ts`。

---

## 四、图 3：各 Tab 绘图总览（核心图：7 类实体图 + 动态总览）

> 事实源 → 各 Tab 的生成链 → 客户端渲染。实线为主路径，虚线为兜底/依赖。
> 全量细节见图 4（AI 链）、图 5（时序/交互）、图 6（依赖/ER）。

```mermaid
flowchart TB
    subgraph FACTS["事实源"]
        SCAN["扫描图 graph<br/>scanWorkspace / peerDeps 边 / README（scan.ts）"]
        CI["代码索引 index<br/>code-index-tree-sitter / .arch-lens-index.json"]
        DOC["架构文档<br/>detectArchDocs 7 候选 / 非 English zh 优先（concept.ts）"]
        LLM["LLM<br/>agentDefaultModel.currentSelection + prepareCall/stream"]
        PROFILE["共享分析档案（analysis.ts）<br/>.arch-lens-analysis-&lt;lang&gt;.json<br/>2 次串行调用：结构 + 图元 / 单飞锁"]
    end
    subgraph T1["① 概念树 concepts"]
        direction TB
        T1A["缓存 .arch-lens-concept-&lt;lang&gt;.json"]
        T1B["extractDocTree<br/>标题层级逐字提取 / ref 锚点 + sourceText"]
        T1P["档案 conceptTree（source:'flow'）"]
        T1C["generateFromFlow<br/>链自身 LLM 归纳（仅档案无字段时）"]
        T1D["ConceptGraph"]
        T1A -->|"未命中"| T1B
        T1B -->|"无文档/无标题"| T1P
        T1B -->|"source:'doc'"| T1D
        T1P -->|"无字段"| T1C
        T1P -->|"source:'flow'"| T1D
        T1C -->|"source:'flow'"| T1D
    end
    subgraph T2["② 时序 seq（注册表链 prefer flow；code 分支已废弃，仅存 wire）"]
        direction TB
        T2A["buildSequenceFromCalls<br/>静态调用图 / 排除测试边 / BFS<br/>（调用关系由 callGraph 独立呈现）"]
        T2B["缓存 .arch-lens-sequence-&lt;lang&gt;.json"]
        T2C["extractSequenceFromDoc<br/>「## 时序」章节逐字解析"]
        T2P["档案 seqMessages<br/>from/to ∈ coreIds 交叉校验"]
        T2D["链自身 LLM 归纳 10-16 条<br/>（仅档案不足 3 条时）"]
        T2E["SequenceGraph"]
        T2A -.->|"废弃分支"| T2B
        T2B -->|"无则"| T2C
        T2C -->|"source:'doc'；无则"| T2P
        T2P -->|"不足 3 条"| T2D
        T2D -->|"source:'flow'"| T2E
        T2B --> T2E
        T2C --> T2E
        T2P -->|"source:'flow'"| T2E
    end
    subgraph T3["③ 流程图 flow"]
        direction TB
        T3A["缓存 .arch-lens-flow-&lt;lang&gt;.json"]
        T3B["extractFlowBlock<br/>mermaid 围栏原样 / text 伪代码 LLM 转码"]
        T3P["档案 flow（source:'flow'）"]
        T3C["generateFlowFromCode<br/>链自身 LLM 归纳（仅档案无字段时）"]
        T3D["MermaidView"]
        T3A -->|"未命中"| T3B
        T3B -->|"无围栏块"| T3P
        T3B -->|"source:'doc'"| T3D
        T3P -->|"无字段"| T3C
        T3P -->|"source:'flow'"| T3D
        T3C -->|"source:'flow'"| T3D
    end
    subgraph T4["④ 交互 interaction"]
        direction TB
        T4A["readStructuredCache<br/>.arch-lens-events-&lt;lang&gt;.json"]
        T4P["档案 events（mode 白名单校验）"]
        T4B["🤖 AI 生成：档案 events 字段级再生成"]
        T4C["InteractionGraph<br/>（事件框两行：事件名 + 中文 note 概要）"]
        T4A -->|"null"| T4P
        T4A --> T4C
        T4P -->|"无字段"| T4B
        T4P --> T4C
        T4B --> T4C
    end
    subgraph T5["⑤ 依赖 deps（仅核心子图，无 full 视图）"]
        direction TB
        T5A["coreGraph 选包<br/>缓存 → 档案 coreIds（索引校验）→ LLM 4-25 → curated 回退"]
        T5B["coreFlowchart<br/>importEdges 只画选中包"]
        T5E["MermaidView"]
        T5A --> T5B --> T5E
    end
    subgraph T6["⑥ ER er（仅核心子图，无 full 视图）"]
        direction TB
        T6A["coreErDiagram<br/>选中包实体（ER 线色 directive 保证可见）"]
        T6D["MermaidView"]
        T6A --> T6D
    end
    subgraph T7["⑦ 目录 catalog"]
        direction TB
        T7A["扫描节点 blurb / blurbZh"]
        T7B["dutyText 本地化职责"]
        T7C["summarizeDuties<br/>LLM 分批 40/调用 2 批"]
        T7D["Catalog"]
        T7A --> T7B --> T7D
        T7C --> T7D
    end
    DOC -.-> T1B
    DOC -.-> T2C
    DOC -.-> T3B
    LLM -.-> T1C
    LLM -.-> T2D
    LLM -.-> T3C
    LLM -.-> T4B
    LLM -.-> T5A
    LLM -.-> T7C
    PROFILE -.-> T1P
    PROFILE -.-> T2P
    PROFILE -.-> T3P
    PROFILE -.-> T4P
    PROFILE -.-> T5A
    SCAN --> T7A
    SCAN -.-> T5D
    SCAN -.-> T6C
    CI -.-> T2A
    CI -.-> T5A
    CI -.-> T5C
    CI -.-> T6B
```

出处：`concept.ts`、`flow.ts`、`sequence.ts`、`core.ts`、`mermaid.ts`、`docsgen.ts`、`summarize.ts`、
`arch-lens-backend/src/index.ts`（Remote 面）、`client-arch-lens/src/client/arch-view.tsx`（Tab 组装）。

### 图 3 附：Tab 间关系与图文件存储

> **数据同源、文件分立、版本绑定**：所有 Tab 共用同一次 `code-index` 扫描（`.arch-lens-index.json` 的 `{v,data}` 信封：包 / 实体 / imports / 调用边），
> 每类图只是同一份事实的"投影"；但每类图独立落盘、独立渲染、独立触发。**清单、文件名、deps 规则、构建入口的唯一来源 = `figures.ts` 图注册表**（禁止任何模块再手拼缓存名）。

| Tab | 注册表 id | 数据来源（投影） | 磁盘缓存（实体级统一为版本信封 `{v, deps?, data}`） |
|---|---|---|---|
| ⚡ 总览 | （动态图） | 规则 overview / 会话生成 | `.arch-lens-dynamic-overview-<hash>[-<lang>].json`（`{v,deps,data}`，deps=全部包） |
| ① 概念树 | `concepts` | index → 文档 / 档案 / LLM（层级投影） | `.arch-lens-concept-<lang>.json`（deps=全部包） |
| ② 调用关系图 | （非注册表） | `callGraph` remote：真实调用边直读索引，零 LLM 不落缓存；客户端 `callGraphToMermaid` 先按有向对**合并平行边并计数 ×N**、双向对归一 `<-->`，图内 init `curve:linear` | —（读 `.arch-lens-index.json`） |
| ② 主流程时序 | `seq` | 缓存 → 文档「## 时序」→ 档案 → LLM（叙事投影，`prefer:'flow'`） | `.arch-lens-sequence-<lang>.json`（data = `{source,messages}`；deps=端点包） |
| ③ 流程图 | `flow-event` / `flow-pipeline` | 文档围栏 / 档案 / LLM（流程投影） | `.arch-lens-flow-<lang>-<angle>.json`（doc 源 deps=[] 永不失效；AI 源=全部包；缺省角度 = event） |
| ④ 交互 | `interaction` | 缓存 → 档案 events → LLM（事件投影） | `.arch-lens-events-<lang>.json`（data=事件数组；deps=生产者/消费者） |
| ⑤⑥ 依赖/ER | `core` | coreGraph 选包 + importEdges（子图投影） | `.arch-lens-core-<lang>.json`（deps=选中 ids；curated 回退不写缓存） |
| ⑦ 目录 | `duties` | 扫描 blurb + AI 职责摘要（列表投影） | `.arch-lens-summaries-<lang>.json`（deps=已总结包） |

- **共享的拉取**：`loadSequences()` 一次并行取时序双视图；「⚡ 变动更新」按注册表逐图查 `isFigureCacheValid`，失效才重画；flow 双视角在同一轮生成里一起出。真正分立的只有三点：独立缓存文件、独立渲染面板、独立 AI 触发。
- **信封语义**（`fact-cache.ts`）：读命中 = `v === factsVersion`（扫描图 generatedAt，只有 refresh 推进）；`v:0` = 失效标记；**缺 `deps` = legacy = 依赖全部包**；`deps:[]` = 永不失效。写侧唯一入口 `writeFigure`（注册表名 + `figureDeps` 规则；失败抛出）；🔬 方法级 = 同名 `-methods` 文件（按需生成，不进变动更新）。
- **动态/用户文件命名**：🎨 hover 下钻 `index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`（**也是版本信封**，deps 规则 `dynamicFigureWriteFacts`，失效随父图级联，读取版本不符 → 下次 hover 自动重生成）；💾 保存图 `index/.arch-lens-draw-<figureId>-<lang>.json` 为用户资产，**失效逻辑永不触碰**。


---

## 五、图 4：AI 生成链详解（概念树 / 流程图 / 核心选择 / 文档）

```mermaid
flowchart TD
    subgraph CONCEPT_CHAIN["概念树 conceptTree（.arch-lens-concept-&lt;lang&gt;.json）"]
        C1["缓存命中？"] -->|"是"| C_DONE["返回缓存"]
        C1 -->|"否"| C2["detectArchDocs / zh 优先候选文档（concept.ts）"]
        C2 -->|"有文档"| C3["extractDocTree / 标题层级逐字提取 / source:'doc' + ref/sourceText"]
        C2 -->|"无文档"| C4["generateFromFlow / LLM 从入口/依赖归纳 / source:'flow'"]
        C3 --> C_CACHE["写缓存"]
        C4 --> C_CACHE
    end
    subgraph FLOW_CHAIN["流程图 flowDiagram（.arch-lens-flow-&lt;lang&gt;-&lt;angle&gt;.json）"]
        F1["缓存命中？（按 语言+角度）"] -->|"是"| F_DONE["返回缓存"]
        F1 -->|"否"| F2["extractFlowBlock / 逐文档探测（flow.ts）"]
        F2 -->|"mermaid 围栏"| F3["原样渲染 source:'doc'（角度无关，权威）"]
        F2 -->|"text 伪代码"| F4["LLM 仅格式转码 source:'doc'"]
        F2 -->|"都没有"| F5["档案 flow 映射按角度命中？"]
        F5 -->|"是"| F_PROFILE["档案 flow[angle] source:'flow'"]
        F5 -->|"否"| F6["generateFlowFromCode / LLM 按角度归纳 source:'flow'"]
        F3 --> F_CACHE["写缓存（角度键）"]
        F4 --> F_CACHE
        F_PROFILE --> F_CACHE
        F6 --> F_CACHE
    end
    subgraph CORE_CHAIN["核心包选择 coreGraph（.arch-lens-core-&lt;lang&gt;.json）"]
        K1["缓存命中？"] -->|"是"| K_DONE["返回缓存"]
        K1 -->|"否"| K2["llmPick / 从索引摘要选 4-25 个 id / 校验后 source:'flow'"]
        K2 -->|"≥4 个"| K_DONE
        K2 -->|"失败/太少"| K3["fallbackIds / 入口包 + import 邻居 / source:'curated' / 不写缓存"]
        K3 --> K_DONE
    end
    subgraph DOCBUILD["架构文档组装 docbuild.ts（正文零 LLM）"]
        D1["resolveDocTarget / 永远落 docs/architecture.generated.md（每次覆盖）<br/>docs/architecture.md 为用户保留文件，永不写入"]
        D2["逐节 ensureFigure：版本化缓存命中即用；缺失/过期 → 该图注册表构建链补建（缓存→文档→档案→LLM）"]
        D3["renderSection 规则渲染 7 节（概念/流程两视角/时序/交互/依赖/ER/职责）→ mergeSection → 文档不反哺图缓存"]
        D1 --> D2 --> D3
    end
```

出处：`concept.ts`、`flow.ts`、`core.ts`、`figures.ts`（注册表/统一写路径）、`docbuild.ts`。

流程图 Tab 的 AI 归纳路径支持**两个视角（角度）**，提示词规则见 `flow-angle.ts`（档案与链共用）：
- **事件驱动**：节点 = 事件/触发点，边标注触发/消费关系与模式（emit/waterfall/parallel/serial）；
- **数据管道**：节点 = 数据产物（源码文件 → 实体/边 → 索引结果 → 档案 → 图数据），边标注转换动作。

每个角度都强制「subgraph 按**阶段**分组（不是按包）+ 节点 ≤16（「动词+宾语」一句话，不写裸函数名）+ 每条边带动作标签 + 单主线无环」。**两视角在档案图元调用中一次生成**（`flow: { event, pipeline }`），角度 chip 是纯本地切换（零 LLM，选择持久化 localStorage）；「🤖 AI 生成」一次调用同时重生成两视角。文档流程（`source:'doc'`）角度无关且优先。另外「⏹ 终止」按钮通过 `abort.ts` 的 AbortSignal 真正掐断 provider 流（所有 LLM 调用点都挂 signal，见 overview 机制 9）。

---

## 六、图 5：时序双视图与交互链

```mermaid
flowchart LR
    subgraph SEQ_CHAIN["时序 resolveSequence（sequence.ts，index.ts @Remote('sequence')）"]
        Q0["客户端请求<br/>prefer: 'flow'（注册表链固定）<br/>'code' 分支已废弃（仅 wire 保留，不再被调用）"]
        Q1["buildSequenceFromCalls<br/>真实调用边 → 包级消息（source:'code'）<br/>测试文件边丢弃 / BFS 上限 24 条 / 每条带 syms+file 证据<br/>（调用关系图现由 callGraph remote 独立呈现）"]
        Q2["readSeqCache<br/>.arch-lens-sequence-&lt;lang&gt;.json"]
        Q3["extractSequenceFromDoc<br/>「## 时序」章节逐字解析（source:'doc'）"]
        Q3P["档案 seqMessages（source:'flow'）<br/>from/to ∈ coreIds 交叉校验"]
        Q4["writeStructuredCache<br/>链自身 LLM 归纳主流程 10-16 条（source:'flow'）"]
        Q0 -.->|"废弃分支"| Q1
        Q0 -->|"flow：跳过调用图"| Q2
        Q1 -->|"无调用边/不足 3 条"| Q2
        Q2 -->|"无缓存"| Q3
        Q3 -->|"无文档段/不足 3 条"| Q3P
        Q3P -->|"档案不足 3 条/无字段"| Q4
        Q3 --> Q3C["写 seq 缓存（统一 {source,messages} 对象，经 writeFigure）"]
        Q3P --> Q3PC["写 seq 缓存（source:'flow'）"]
        Q4 --> Q4C["写 seq 缓存（同对象形态；历史裸数组由 readSeqCache 兼容读）"]
    end
    subgraph EVENTS_CHAIN["交互 events（注册表 spec：缓存→档案 events→链 LLM）"]
        E1["readStructuredCache<br/>.arch-lens-events-&lt;lang&gt;.json"]
        E1P["档案 events（mode 白名单校验）<br/>命中即 writeFigure 写回缓存"]
        E2["writeStructuredCache / LLM 归纳 5-8 条 + 写缓存（docsgen.ts）"]
        E1 -->|"null"| E1P
        E1P -->|"无字段"| E2
    end
```

出处：`sequence.ts`、`docsgen.ts`、`figures.ts`（seq/interaction 与其余图同一条注册表链，「⚡ 变动更新」会补建它们）、`arch-lens-backend/src/index.ts`。

---

## 七、图 6：依赖 / ER 核心子图（无全量视图）

> 依赖与 ER Tab 都已去掉全量视图（实体/包级全量图学习价值低）：只渲染核心子图
> `coreFlowchart` / `coreErDiagram`。三个 ER 生成函数输出带 `%%{init}` 线色 directive
> （深琥珀 `#b45309`），避免 import 线与背景同色不可见。

```mermaid
flowchart LR
    subgraph OVERVIEW["唯一视图（deps / er）"]
        O1["coreGraph（core.ts）<br/>缓存 → 档案 coreIds（索引校验）→ llmPick 4-25<br/>→ 失败回退 fallbackIds（入口包+import 邻居，不写缓存）"]
        O2["coreFlowchart / coreErDiagram（mermaid.ts）<br/>importEdges 只画选中包之间的源码 import 边<br/>ER 线带 directive：%%{init: er.lineColor #b45309}"]
    end
    CLIENT_NOTE["客户端：deps/er Tab 打开时惰性加载 core 子图；<br/>🤖 AI 生成才 force 重新选包（档案 coreIds 字段级再生成）"]
    O1 --> O2 -.-> CLIENT_NOTE
```

出处：`core.ts`、`mermaid.ts`、`arch-lens-backend/src/index.ts`、`client-arch-lens/src/client/arch-view.tsx`。

---

## 八、图 7：讲解请求 → 笔记写入闭环

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant V as ArchView（arch-view.tsx）
    participant R as remote.archLens（index.ts @Remote）
    participant S as sessions.binding(id).session.prompt(...,'queue')（调用点在本仓库 client/index.ts；服务内部不可见）
    participant N as archLens 事件监听（index.ts Service.init）
    participant F as ARCH-NOTES.md（notes.ts）

    U->>V: 点击 🤖 讲解组件
    V->>V: explainQueueRef 入队（单飞：explainingRef + running 翻转 + 20s 兜底）
    V->>R: notePending(target, text, sessionId) —— 仅内存暂存
    V->>S: prompt([{ type: 'text', text }], 'queue') —— 进主会话队列
    Note over S: 主对话管线（agent-loop/LLM/工具 等内部细节<br/>不在本仓库代码内，无法在此验证）
    S-->>V: 会话 running 状态翻转 → 解锁队列
    S->>N: session/event { type: 'assistant/message' }
    N->>N: 校验：非空文本 && pending!=null && sessionId 匹配
    N->>F: appendNote（去重：同 target+问句头；截断 600 字；上限 200 条）
```

出处：`client-arch-lens/src/client/arch-view.tsx`、`client-arch-lens/src/client/index.ts`、
`arch-lens-backend/src/index.ts`、`arch-lens-backend/src/notes.ts`。

> **讲解入口**：概念树、追问重画对话框与动态出图动作行都带「🗣 AI 讲解」——问题组装为 标题/生成概要 + 【图源】附件 + 讲解风格 + 语言条款；
> 同一会话同一图源命中脏检（`lastAttachedFigRef`）时改发引用短句不重发全文（省 token 且答案沿用上文附件）。
> 组件级讲解（target `组件 X`）是学习进度覆盖度的唯一计分币种；📊 旁实时徽章（`progressStats`）在讲解回合结束即刷新。

---

## 九、图 8：刷新 / 失效语义（按钮三件套）

> 界面只保留三个心智动作：**旧了就重扫（↻ 重新扫描）· 图不满意就 AI 生成（🤖）· 要文档就一键生成（📄）**。

```mermaid
flowchart TD
    RESCAN["↻ 重新扫描（全局，事实旧了用）"] --> B0["checkWorkspaceChanges / manifest 无变化 → changed:false 直接返回现有图（0 重建）"]
    B0 -->|"有变化"| B1["remoteRefresh / graphCaches.clear() + 磁盘图写 invalidated 标记（index.ts）"]
    B1 --> B2["refreshCodeIndex / codeIndex.refresh：内存条目删除；磁盘索引带 v 信封，读侧版本校验自然拒旧"]
    B2 --> B3["removeAICaches / 只清共享档案的内存单飞；磁盘缓存不置空，版本不符读取自然 miss"]
    B3 --> B4["scanWorkspace 重建 → 新图落盘 = 新 factsVersion（generatedAt）"]
    B4 --> B45["selectiveInvalidate 两段式：实体图按 deps∩变动包 失效（v:0）或重盖章存活；下钻图随父图种级联（overview 恒失效）；.arch-lens-draw-* 用户资产永不触碰；progress 总结缓存被遍历跳过——它同为版本信封（deps=全部包），版本不符读取自 miss"]
    B45 --> B5["客户端 refresh 落定后：只重拉元数据 + 当前激活 Tab 的图；<br/>其余 Tab 切过去才惰性拉取 —— 重新扫描本身 0 LLM、不自动生成任何图（「⚡ 变动更新」只重画失效的那几张）"]
    AIGEN["🤖 AI 生成（单 Tab，图不满意用）"] --> D1["figurePrompt / 图生成走会话（session-figure.ts）<br/>后端出提示词（事实嵌入 + 唯一 figId），客户端发进当前会话<br/>GUI 对话流实时展示生成过程；回答按 figId 匹配并清洗写入图链缓存"]
    D1 --> D2["回合结束 running 翻转 → 面板按图种刷新（concepts/seq/flow/interaction/core）<br/>不写文档、不重建索引、不动其他图（core 生成不连坐：会话模式端点约束是全索引包 id）"]
    FOLLOW["侧边栏切会话（useSessions.current 驱动，无面板选择器）"] --> E1["setSession / 数据源指向该会话 cwd（纯加载，不清缓存）"]
    E1 --> E2["graph 扫描缓存按 workspace root 命中：同工作区秒回；root 变化才重扫 + 丢图状态全量重拉"]
    DOCS["📄 一键生成文档（要文档用）"] --> G1["docbuild.generateDocsFromFigures / 图缓存纯组装（正文 0 LLM）<br/>缺图/过期的节先走该图注册表构建链补建（缓存→文档→档案→LLM，统一写路径回缓存）再渲染<br/>永远写 docs/architecture.generated.md（用户文件永不覆盖、文档不反哺图缓存）"]
    G1 --> G2["7 节规则渲染：概念树/流程两视角/时序/交互表/依赖+边清单/ER/职责表<br/>可选 withDescriptions：恰好一次批量 LLM，同信封回写 description（保留原 v/deps）"]
```

出处：`arch-lens-backend/src/index.ts`（`remoteRefresh`）、`fact-cache.ts`（`selectiveInvalidate`）、`docbuild.ts`、`client-arch-lens/src/client/arch-view.tsx`、
`code-index-tree-sitter/src/index.ts`。

---

## 十、图 9：构建与打包

```mermaid
flowchart LR
    SRC["src/*.ts"] --> TSC["tsc -b / lib/types/**（声明+JS）"]
    TSC --> TYPERT["scripts/gen-typert.mjs 或根 tsdown 配置的 typertPlugin（自 npm 包 @deepseek-ai/dsh-typert-generator/tsdown）"]
    TYPERT --> HOST["lib/typert.host.js"]
    TYPERT --> REMOTE["lib/typert.remote-client.js"]
    SRC --> HOSTBUNDLE["tsdown host face / nodeLibrary → lib/index.js 单文件（#region 模块标记）/ @deepseek-ai/* external"]
    SRC --> CLIENTBUNDLE["tsdown client face / clientBundleConfig → lib/client.js CJS"]
    CLIENTBUNDLE --> BANNER["banner: window.__ModuleLoader__.load({id, factory})"]
    CLIENTBUNDLE --> EXTERN["仅 PLATFORM_EXTERNALS 白名单 external（react 等）；其余 @deepseek-ai/* 内联"]
    CLIENTBUNDLE --> INLINE["mermaid 内联 + CSS Modules → style 标签注入"]
```

出处：`tsdown.config.ts`（根）、`packages/tsdown.helpers.ts`、`packages/arch-lens-backend/tsdown.config.ts`、
`packages/client-arch-lens/tsdown.config.ts`、`scripts/gen-typert.mjs`。

---

## 十一、事实源、缓存与 LLM 上下文

> 说明：本节所有 `.arch-lens-*.json` 均位于工作区 `index/` 目录（`CACHE_DIR`），为简洁不再逐个加前缀。

### 图 10：事实源与 LLM 上下文全景

> 结论：**扫描图与代码索引是共享事实源；`factsVersion`（扫描图 generatedAt）+ 版本信封 `{v,deps,data}` 是唯一事实真相——每个缓存都盖着生成时的事实戳，只有 `refresh()` 能推进版本并重盖章/级联失效；图清单/文件名/deps 规则/构建入口的唯一来源是 `figures.ts` 注册表。LLM 归纳收敛为共享分析档案的 2 次串行调用（结构 + 图元），链自身 LLM 只在档案缺字段时兜底；「📄 一键生成文档」是图缓存的纯组装（正文零 LLM）。LLM 从不直接读代码文件——"找代码"由 tree-sitter 一次性完成，LLM 只吃规则生成的摘要字符串。**

```mermaid
flowchart TB
    subgraph SHARED["共享事实源（整份复用，只生成一次）"]
        G["扫描图 graph<br/>内存 Map&lt;root, graph&gt; + 单飞 promise<br/>scanWorkspace 只跑 1 次（package.json/README/src 清单/入口 head）"]
        I["代码索引 index<br/>内存 Promise 复用 + 磁盘 .arch-lens-index.json 的 {v,data} 信封（v=factsVersion，legacy/失配按无缓存重索引）<br/>tree-sitter 全量索引只跑 1 次（分钟级）"]
    end
    subgraph DOCREAD["架构文档：文件同一份，读取不共享"]
        D["concept / flow / seq 三条链各自 detectArchDocs + readText<br/>同一份文档冷启动最多被读 3-4 次（各 ≤256KiB，无内存缓存）"]
    end
    subgraph CHAINS["7 Tab 的生成链"]
        T1["① 概念树：缓存 → 文档逐字提取 → 档案 conceptTree →（缺字段）链自身 LLM"]
        T2["② 时序：index.calls → 缓存 → 文档段 → 档案 seqMessages（coreIds 校验）→（缺）链自身 LLM"]
        T3["③ 流程图：缓存 → 文档围栏 → 档案 flow →（缺）链自身 LLM"]
        T4["④ 交互：缓存 → 档案 events（命中写回缓存）→ 链 LLM"]
        T5["⑤⑥ overview：coreGraph → 档案 coreIds → llmPick → curated（deps/er 共享 .arch-lens-core 缓存）"]
        T6["⑤⑥ deps/ER 边渲染：importEdges 规则聚合选中包（无 LLM）；全量视图已废弃"]
        T7["⑦ 目录：blurb → dutyText + LLM 分批职责总结"]
    end
    subgraph LLMCTX["LLM：共享档案 2 次串行调用 + 链自身兜底（仅档案缺字段）"]
        LL["档案生成（analysis.ts，单飞锁）：<br/>① 结构 = coreIds + conceptTree（裁剪摘要，无依赖字段）<br/>② 图元 = flow + seq + events（只发 core 包子集摘要）"]
    end
    G --> T6
    G --> T7
    I --> T1
    I --> T2
    I --> T3
    I --> T5
    I --> T6
    D --> T1
    D --> T2
    D --> T3
    I -.->|"indexSummary（裁剪后）只发 2 次"| LL
    G -.->|"blurb"| LL
    LL -.-> T1
    LL -.-> T2
    LL -.-> T3
    LL -.-> T4
    LL -.-> T5
    LL -.-> T7
```

出处：`arch-lens-backend/src/index.ts`（写路径 Remote 先 `indexWorkspaceShared`：信封 v ≠ factsVersion 时 refresh+重建一次）、
`fact-cache.ts` / `figures.ts`（事实脊柱）、`concept.ts` / `flow.ts` / `sequence.ts` / `docsgen.ts` / `core.ts` / `summarize.ts` / `docbuild.ts`。

### 图 11：第一次打开面板（无任何缓存）的冷启动时序

> 每个 Tab 各自发请求、各自走链，但底层共享：扫描 1 次、索引 1 次（由最先到达的请求触发，其余等待同一个 Promise）。
> 有架构文档的仓库：概念/流程/时序段走文档路径，0 次 LLM；无文档仓库落到共享分析档案（2 次串行 LLM），档案缺失的字段才由各链自己的 LLM 兜底。

```mermaid
sequenceDiagram
    autonumber
    participant V as ArchView（挂载/切会话）
    participant R as remote.archLens（Host）
    participant G as scanWorkspace
    participant I as codeIndex（tree-sitter）
    participant D as 架构文档
    participant L as LLM
    participant P as 分析档案 analysis.ts
    participant C as 磁盘缓存 .arch-lens-*.json

    V->>R: setSession(sessionId) → loadAllFigures
    V->>R: 并行发：graph + conceptTree + sequence(code) + sequence(flow) + flow + events + notes + promptConfig + analyze
    R->>G: graph()：内存 miss → 扫描 1 次（秒级）→ 写内存缓存（此后所有请求共享）
    R->>I: 最先到达的请求（通常 conceptTree）触发 indexWorkspace 全量索引（分钟级）
    Note over R,I: 其余请求 await 同一个 Promise（单飞）→ 索引完成后写 .arch-lens-index.json
    R->>D: conceptTree：detectArchDocs → extractDocTree（读文档 #1）
    R->>D: flow：extractFlowBlock（读文档 #2）
    R->>D: sequence(code)+sequence(flow)：extractSequenceFromDoc（读文档 #3/#4）
    R->>P: 无文档/无块/无 calls 时：确保档案（单飞锁，并发链共享同一次生成）
    R->>L: 档案生成 = 2 次串行调用：结构（coreIds+conceptTree，裁剪摘要）→ 图元（flow+seq+events，core 子集摘要）
    P->>C: 写 .arch-lens-analysis-&lt;lang&gt;.json；各链命中档案后写回自己的缓存
    Note over R,L: 档案缺字段才调用该链自己的 LLM 归纳（兜底位）
    Note over V: 交互 Tab：结构化缓存 → 档案 events → 链 LLM 归纳（「变动更新」会补建）。<br/>deps/ER/catalog：切 Tab 时才惰性加载（core 从档案/缓存取、duties 分批 LLM）
```

### 图 12：有缓存 vs 无缓存

```mermaid
flowchart LR
    subgraph COLD["冷启动（无任何缓存）"]
        C1["graph：扫描 1 次（秒级）"]
        C2["index：tree-sitter 全量索引 1 次（分钟级，由第一个请求触发）"]
        C3["文档：同一文件被读 3-4 次（三条链各自读）"]
        C4["LLM：自动路径 2 次串行（共享分析档案：结构 + 图元）<br/>档案缺字段才触发该链自己的归纳"]
        C5["events：结构化缓存 → 档案 events → 链 LLM 归纳"]
    end
    subgraph WARM["有缓存（重开面板 / 切回同工作区 / 语言相同）"]
        W1["graph：内存命中，秒回（setSession 不清缓存）"]
        W2["index：内存/磁盘命中，0 文件 IO"]
        W3["文档：不读（概念/流程/时序缓存命中）"]
        W4["LLM：0 次。<br/>callGraph 每请求重算 buildSequenceFromCalls（纯内存零 LLM 不落盘）；<br/>duties 仅按缺失 id 增量补 LLM"]
        W5["events：读缓存"]
    end
```

出处：`arch-lens-backend/src/index.ts`（`graphCaches` / `graphInFlight`、`refreshCodeIndex`、`removeAICaches`）、
`code-index-tree-sitter/src/index.ts`（内存 Promise 缓存 + 磁盘缓存）、`client-arch-lens/src/client/arch-view.tsx`（`loadAllFigures`）。

### 图 13：共享分析层（省 token 不丢准确性）

```mermaid
flowchart TB
    subgraph PROFILE["共享分析档案（analysis.ts）"]
        P1["冷启动或缓存 miss：2 次串行调用<br/>① 结构：coreIds + conceptTree（裁剪摘要，无依赖字段）<br/>② 图元：flow + seqMessages + events（只发 core 包子集摘要）<br/>→ .arch-lens-analysis-&lt;lang&gt;.json / 单飞锁"]
        P2["各链顺序：缓存 → 文档/代码（权威优先）→ 档案 → 链自身 LLM（仅档案缺字段）"]
        P3["交叉校验：coreIds ∈ 索引；seq from/to ∈ coreIds；mode 白名单；根 ≤12 / 深度 ≤3"]
        P4["预算（60 包 fixture 冷启动实测）：LLM 调用恰 2 次；摘要输入合计 7,373 字符；有文档仓库仍 0 次 LLM"]
    end
```

**要点**：
- **共享分析层**：`analysis.ts` 的 `ensureAnalysisProfile`（2 次串行调用 + 字段校验 + 单飞锁 + `.arch-lens-analysis-<lang>.json` 版本信封缓存），concept/flow/seq/core/events 五条链全部在权威阶段之后、链自身 LLM 之前消费档案；重扫只清档案的内存单飞（`removeAICaches`），磁盘副本靠版本校验拒旧。
- **索引摘要按需裁剪**：`indexSummary(index, { packages, fields, maxPackages, maxDeps })` 参数化；core/seq/interaction/flow 调用均去掉依赖字段；concept 兜底只带 3 个依赖；文档组装不发摘要（纯图缓存装配）。

### 验证与量化（单元测试可复现）

`pnpm exec vitest run --pool=threads`（218 tests，覆盖注册表 / 信封 / 统一写路径 / 级联失效 / 文档组装 / 索引事实等回归面：`figure-registry.spec.ts`、`write-unify.spec.ts`、`index-facts.spec.ts`、`envelope.spec.ts`、`selective-invalidate.spec.ts`、`docsgen.spec.ts` 等）。核心量化测试与实测数字：

| 指标 | 现状（可复现） | 出处 |
|---|---|---|
| 冷启动自动路径 LLM 调用次数 | **2**（串行：结构 + 图元；不含惰性 duties） | `analysis-chain.spec.ts` |
| 摘要输入字符总量 | **7,373 字符**（60 包 fixture 冷启动） | `analysis-chain.spec.ts` / `summary.spec.ts` |
| 有文档仓库 LLM 调用 | **0**（文档优先不被破坏） | `analysis-chain.spec.ts` |
| 有缓存重开面板 LLM 调用 | **0** | 链读取顺序测试 |
| 反编造校验 | coreIds ∈ 索引；seq from/to ∈ coreIds 交叉校验；events mode 白名单；概念树根 ≤12 / 深度 ≤3 | `analysis.spec.ts` |

验证方式说明：
- **链级计数**：mock `docsgen.llmText` 记录每次 prompt，冷启动跑五条链断言恰好 2 次调用、第二次只发送 core 子集摘要，并核算摘要输入字符预算；
- **准确性不变量**：`analysis.spec.ts` 逐条断言档案 sanitizer（编造 id 丢弃、自环丢弃、mode 白名单、根/深度上限、标题 trim、版本校验）；
- **权威顺序不变量**：有文档/calls 时断言 0 次 LLM 且 source 为 `doc`/`code`——档案永远排在权威源之后。
- 真实 LLM 效果需在部署环境实测（本仓库无法访问模型），以上数字是 prompt 构造层面的确定性下界。

---

## 十二、图 10：包目录职责归纳——三入口管道（扫描事实表 + AI 行内增强）

「包目录」页的本名是**扫描事实表**：行永远来自 `graph.nodes`（Tab 定义即"扫描 + README/description"），AI 职责总结只是**行内增强**，三条路径各自独立，靠一个 `.arch-lens-summaries-<lang>.json`（`{v 事实版本, data 职责映射, deps 依赖包}`）串起来。

```mermaid
flowchart TD
    subgraph SCAN["扫描事实（零 LLM，重扫生成）"]
        G["graph.json · generatedAt = 事实版本<br/>247 包 node{id, blurb, blurbZh}<br/>（scan.ts → requireGraph()，index.ts）"]
    end

    subgraph READ["读路径 · 打开「包目录」tab（force=false，零 LLM）"]
        R1["remoteSummarizeDuties（index.ts）"]
        R2["readDutySummaries：读 .arch-lens-summaries-&lt;lang&gt;.json<br/>只判 v === 事实版本（summarize.ts / fact-cache.ts）"]
        R3["命中 → data 原样返回（可部分映射，无完整度闸）<br/>缺失/过期 → null"]
        FE1{"前端 summaries === undefined?"}
        FE2["转圈 loading（尚未拉到）"]
        FE3["渲染 Catalog 表（行 = graph.nodes，恒全量）<br/>行级 dutyText：AI → blurbZh → blurb → 无描述<br/>（catalog.tsx / arch-view.tsx）"]
        R1 --> R2 --> R3 --> FE1
        FE1 -- 是 --> FE2
        FE1 -- 否 --> FE3
    end

    subgraph WRITE["写路径 · 「🤖 AI 生成」（force=true，LLM 分批增量）"]
        W1["ensureWritable 只读预检<br/>（先拒「生成完但写不进」，index.ts）"]
        W2["missing = graph.nodes − 已缓存 keys；全命中直接返回"]
        W3["分批：BATCH_SIZE=40 × 每 RPC ≤2 批 = 单次 ≤80<br/>卡在 30s 传输超时内；防大调用输出截断<br/>（summarize.ts L126-132）"]
        W4["逐批：prompt = 包短名+英文 blurb → 一行职责(输出语言)<br/>llm.prepareCall(temperature:0) + stream + abort 信号<br/>recordLlmCall('duties') → extractJson（summarize.ts L138-197）"]
        W5["merged = {...cached, ...本批} → writeFigure('duties', 事实版本, merged)<br/>deps = Object.keys(merged)：**按包独立**（figures.ts figureDeps L194-195）"]
        W1 --> W2 --> W3 --> W4 --> W5
        W5 -. "部分填充 → 前端 1.5s 后再调（仅 force，≤5 次）<br/>缓存使下次只算 missing，天然增量（arch-view loadSummaries）" .-> W2
    end

    subgraph INV["失效路径 · 重扫 changed=true"]
        I1["新事实版本 + selectiveInvalidate（fact-cache.ts）<br/>duty 缓存 deps 与变更包相交才失效"]
        I2["失效 = 版本戳不匹配 → 读路径自动回退 blurb；<br/>「⚡ 变动更新」按版本戳判有效即跳过（不为 duty 花 LLM）"]
        I1 --> I2
    end

    G --> R1
    G --> W2
    G --> I1
    W5 -. 落盘 .-> S[(".arch-lens-summaries-&lt;lang&gt;.json<br/>{v, data, deps}")]
    S -. 被读 .-> R2
```

**逐段讲解**：

1. **扫描事实是地基（零 LLM）**。`graph.json` 的每个包节点带 `blurb`（package.json 英文描述）与 `blurbZh`（README 中文段，若有）。职责映射只往这张表上"贴"增强文本，没有它表照样出。

2. **读路径只认版本戳**。`readDutySummaries` 判 `v === 当前事实版本`：等则把 `data` **按现状返回（可能部分覆盖）**，否则 null。前端行级回退链 `dutyText`（AI → blurbZh → blurb → 无描述）保证部分覆盖下每行仍有可读职责文本；「变动更新」的增量判定同样只看戳（`isFigureCacheValid`，figures.ts L239-250）。**两处判定共享同一标准是刻意不变量**：若读路径另设"全覆盖才肯返回"的门槛，而增量按戳跳过半生成缓存，会出现"部分映射既补不齐也看不见"、247 行扫描表被 80 条 AI 总结一票否决的死角。完整性**不是**读的门槛，只是 🤖 链的进度。

3. **写路径 = 分批 + 增量 + 合并**。一次 RPC 最多 2 批 × 40 包 = 80 条（大批量单次调用会输出截断致 JSON 解析失败，故设上限，`summarize.ts` 注释）；每批 `temperature:0`、从 `id + 官方英文描述` 归纳一行职责，`extractJson` 容错多余文字；`merged = {...旧缓存, ...新批次}` 落盘并盖**当前事实版本戳**。前端看到"还不全"且处于 force 模式时每 1.5s 续拉（≤5 次），缓存让每次只算 missing、天然增量——所以 247 包的补齐靠多轮小步，而非一次大调用。

4. **deps 决定失效粒度**。duty 缓存的 deps = 已总结包 id（注册表 `figureDeps`，按包独立）；重扫 changed=true 时 `selectiveInvalidate` 只在与变更包相交的图上动戳。区别于概念树/流程（deps=全部包，任一包变动即失效）——职责是逐包独立事实，不该被无关包拖累。

5. **成本与惰性**。打开 tab、点「⚡ 变动更新」都不产生 duties 调用（L127 惰性注册表注释）；只有「🤖 AI 生成」触发该链。LLM 统计记录 kind='duties'，token 花费按批可见。

出处：`packages/arch-lens-backend/src/index.ts`（remoteSummarizeDuties）、`src/summarize.ts`（读回退与分批生成）、`src/figures.ts`（'duties' 注册 L127-131、figureDeps L194-195、isFigureCacheValid L239-250、runEntityFigurePass L303）、`src/fact-cache.ts`（版本封套与 selectiveInvalidate）、`packages/client-arch-lens/src/client/arch-view.tsx`（loadSummaries / catalog 渲染闸）、`src/catalog.tsx`（dutyText 行级回退）。
