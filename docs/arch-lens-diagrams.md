# Arch Lens 代码直读流程图（Mermaid 源码）

> 本文件由对 `packages/*` 源码的直接阅读（非 git 日志、非 node_modules、非文档转述）生成。
> 每个图节点尽量标注代码出处（`src` 路径）；标 `【推断】` 的节点是依据协议类型/生成产物推得，
> 对应实现位于本仓库之外（deepseek-harness），无法在本仓库代码内交叉验证。
> 图 4 的参与者命名已按「代码里实际出现的标识」修正，外部管线内部细节明确标注为不可见。

---

## 图 1：总体运行时拓扑

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
        DESK["ArchView 学习台 / 7 个 Tab（arch-view.tsx）"]
        MM["mermaid 11 渲染（内联，pan/zoom）（mermaid-view.tsx）"]
        CLIENT --> MOD
        BOT --> DESK
        DESK --> MM
    end
    GATEWAY <-->|"Typert RPC：remote.archLens.*"| CLIENT
    DESK -->|"session.prompt(queue)"| CLIENT
    CLIENT -->|"remote.sessions"| GATEWAY
```

出处：`packages/arch-lens-backend/src/index.ts`、`packages/client-arch-lens/src/client/*`、
`packages/tsdown.helpers.ts`、`packages/typert-protocol/src/index.ts`。

---

## 图 2：数据管线（扫描 / 索引 → 图元）

```mermaid
flowchart TD
    ROOT["workspace root / 目标会话 cwd 或 sandboxPolicy（index.ts resolveRoot）"]
    SCAN["scanWorkspace / packages/组/包 → package.json/README/src（scan.ts）"]
    GRAPH["ArchLensGraph / nodes+edges+detail 随图预计算（scan.ts）"]
    DETECT["detectLanguage / package.json / pyproject / pom（discover.ts）"]
    PKGS["discoverPackageRoots（discover.ts）"]
    PARSE["tree-sitter 提取 / TS/Py/Java 适配器（ts-adapter.ts 等）"]
    INDEX["CodeIndexResult / packages/entities/imports/entryFiles"]
    DISKCACHE[".arch-lens-index.json 磁盘缓存（index.ts refresh 置空失效）"]
    MERMAID["mermaid.ts 纯函数 / flowchart / erDiagram / importEdges 规则聚合"]
    CONCEPT["conceptTree 链（concept.ts）"]
    FLOW["flowDiagram 链（flow.ts）"]
    SEQEVENT["sequence / events 结构化缓存（docsgen.ts）"]
    CATALOG["catalog：dutyText / AI summaries 分批（summarize.ts）"]
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

## 图 3：AI 生成链（概念树 / 流程图 / 核心选择 / 文档）

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
    subgraph FLOW_CHAIN["流程图 flowDiagram（.arch-lens-flow-&lt;lang&gt;.json）"]
        F1["缓存命中？"] -->|"是"| F_DONE["返回缓存"]
        F1 -->|"否"| F2["extractFlowBlock / 逐文档探测（flow.ts）"]
        F2 -->|"mermaid 围栏"| F3["原样渲染 source:'doc'"]
        F2 -->|"text 伪代码"| F4["LLM 仅格式转码 source:'doc'"]
        F2 -->|"都没有"| F5["generateFlowFromCode / LLM 归纳 source:'flow'"]
        F3 --> F_CACHE["写缓存"]
        F4 --> F_CACHE
        F5 --> F_CACHE
    end
    subgraph CORE_CHAIN["核心包选择 coreGraph（.arch-lens-core-&lt;lang&gt;.json）"]
        K1["缓存命中？"] -->|"是"| K_DONE["返回缓存"]
        K1 -->|"否"| K2["llmPick / 从索引摘要选 4-25 个 id / 校验后 source:'flow'"]
        K2 -->|"≥4 个"| K_DONE
        K2 -->|"失败/太少"| K3["fallbackIds / 入口包 + import 邻居 / source:'curated'"]
        K3 --> K_DONE
    end
    subgraph DOCGEN["架构文档生成 docsgen"]
        D1["resolveDocTarget / 手写 architecture.md 永不覆盖 / 落 architecture.generated.md"]
        D2["6 个 section 逐一 LLM 生成 / mergeSection 按标题替换/追加"]
        D3["seq/interaction 额外写结构化缓存"]
        D1 --> D2 --> D3
    end
```

出处：`concept.ts`、`flow.ts`、`core.ts`、`docsgen.ts`。

---

## 图 4：讲解请求 → 笔记写入闭环（纯代码可验证版）

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant V as ArchView（arch-view.tsx）
    participant R as remote.archLens（index.ts @Remote）
    participant S as sessions.binding(id).session.prompt(...,'queue')（外部，本仓库不可见）
    participant N as archLens 事件监听（index.ts Service.init）
    participant F as ARCH-NOTES.md（notes.ts）

    U->>V: 点击 🤖 讲解组件
    V->>V: explainQueueRef 入队（单飞：explainingRef + running 翻转 + 20s 兜底）
    V->>R: notePending(target, text, sessionId) —— 仅内存暂存
    V->>S: prompt([text], 'queue') —— 进主会话队列
    Note over S: 主对话管线（agent-loop/LLM/工具 等内部细节<br/>不在本仓库代码内，无法在此验证）
    S-->>V: 会话 running 状态翻转 → 解锁队列
    S->>N: session/event { type: 'assistant/message' }
    N->>N: 校验：非空文本 && pending!=null && sessionId 匹配
    N->>F: appendNote（去重：同 target+问句头；截断 600 字；上限 200 条）
```

出处：`client-arch-lens/src/client/arch-view.tsx`、`client-arch-lens/src/client/index.ts`、
`arch-lens-backend/src/index.ts`、`arch-lens-backend/src/notes.ts`。

---

## 图 5：刷新 / 失效语义

```mermaid
flowchart TD
    RESCAN["↻ 重新扫描（全局）"] --> B1["remoteRefresh / graphCache=null（index.ts）"]
    B1 --> B2["refreshCodeIndex / codeIndex.refresh：内存删 + 磁盘置空"]
    B2 --> B3["removeAICaches / 置空 6 类 .arch-lens-*.json"]
    B3 --> B4["重新 scanWorkspace"]
    B4 --> B5["客户端等 refresh 落定后才重拉全部图（防竞态，arch-view.tsx refresh）"]
    REFRESHTAB["↻ 刷新此图（单 Tab）"] --> C1["remoteRefreshIndex / 只重建 code-index"]
    C1 --> C2["该图 force:true 重推导"]
    AIGEN["🤖 AI 生成（单 Tab）"] --> D1["remoteRefreshIndex"]
    D1 --> D2["generateDocSection / 写文档 section（seq/interaction 同时写结构化缓存）"]
    D2 --> D3["该图 force:true 重推导（core 重新 AI 选包）"]
    SETSESS["切换目标会话"] --> E1["remoteSetSession / root 换成该会话 cwd"]
    E1 --> E2["丢图缓存，全量重拉"]
    DOCS["📄 一键生成文档"] --> G1["generateFullDocs / 6 section 一次 LLM 通过"]
    G1 --> G2["conceptTree force + flow force + 结构化缓存"]
```

出处：`arch-lens-backend/src/index.ts`、`client-arch-lens/src/client/arch-view.tsx`、
`code-index-tree-sitter/src/index.ts`。

---

## 图 6：构建与打包

```mermaid
flowchart LR
    SRC["src/*.ts"] --> TSC["tsc -b / lib/types/**（声明+JS）"]
    TSC --> TYPERT["scripts/gen-typert.mjs 或 tsdown typert 插件"]
    TYPERT --> HOST["lib/typert.host.js"]
    TYPERT --> REMOTE["lib/typert.remote-client.js"]
    SRC --> HOSTBUNDLE["tsdown host face / nodeLibrary → lib/index.js 单文件 / @deepseek-ai/* external"]
    SRC --> CLIENTBUNDLE["tsdown client face / clientBundleConfig → lib/client.js CJS"]
    CLIENTBUNDLE --> BANNER["banner: window.__ModuleLoader__.load({id, factory})"]
    CLIENTBUNDLE --> EXTERN["react / @deepseek-ai/* external（DSH 模块表提供）"]
    CLIENTBUNDLE --> INLINE["mermaid 内联 + CSS Modules → style 标签注入"]
```

出处：`tsdown.config.ts`（根）、`packages/tsdown.helpers.ts`、`packages/arch-lens-backend/tsdown.config.ts`、
`packages/client-arch-lens/tsdown.config.ts`、`scripts/gen-typert.mjs`。

---

## 已知不一致（代码佐证）

- `packages/client-arch-lens/lib/types/` 存在 `chat-projection.*` 产物，但 `src/` 中已无此文件 —— lib 与 src 不同步（陈旧产物）。
- 根目录 `lib/index.js` 与 `packages/arch-lens-backend/lib/index.js` 为同类 bundle，helper 的 outDir 写死为包内 lib，根 lib 应为旧配置产物。
- `client-arch-lens/src/index.ts` 的 host 侧 `apply()` 为空函数（浏览器插件在 host 侧无行为），但 package.json 仍导出 `./client`。
