# Arch Lens 重构执行方案（交接版 · 给执行模型）

> 本文档是完整的自包含执行方案。执行人不需要其他上下文：先通读本文，再按"验证基线"跑一遍现状测试，然后按阶段 0→5 顺序落地。**每阶段独立可提交、独立可回滚**。
> 写作依据：对 `packages/*` 源码的逐行阅读（2026-07），全部现状结论附代码位置；与 `docs/arch-lens-overview.md`、`docs/arch-lens-diagrams.md` 冲突时**以本文和代码为准**（那两份文档已整体滞后，阶段 5 重写）。

---

## 0. 目标（用户原话归纳）

1. **复用图缓存**：保持"缓存优先"，重开面板/切 tab 零 LLM。
2. **变动更新包含下钻图**：下钻图（hover 钻取的 `dynamic-*` 图）在变动时级联失效，按需重生成，绝不展示过期图。
3. **一键生成文档 = 图缓存组装**：文档章节由各 tab 图缓存渲染而来；哪个 tab 的图缺失/过期，文档构建时自动触发该图的更新（与「变动更新」同一条写路径）；全系统**唯一变更事实真相**；**统一写路径**。
4. **🔁 全量重建语义暂不动**（见第 6 节红线）。

终态：所有变动更新按每个 tab 图落地存储；一键生成文档拿每个 tab 的图构成最终文档；后续扩展"图缓存带 LLM 自然语言概要"（`description` 字段，见阶段 4）。

---

## 1. 现状事实（已逐行核实）

### 1.1 事实与版本体系
- **唯一变更锚**：`index/.arch-lens-graph.json` 的 `generatedAt` = factsVersion，只有 `refresh()`（`↻ 重新扫描`）写它（`packages/arch-lens-backend/src/index.ts` remoteRefresh，约 L350-406）。
- 图缓存信封：`{ v: factsVersion, deps?: string[], data }`（`fact-cache.ts`）。读侧只认 `v === 当前 factsVersion`（`readVersionedCache`）。
- rescan 流程：文件清单比对（`manifest.ts`，version token + md5，测试目录/文件不计）→ 无变动直接返回 → 有变动才：清内存图 → 置失效标记 → `codeIndex.refresh` → 清档案单飞内存 → 重扫 → 写新 factsVersion → `computeChangedPackages`（`change-pack.ts`）→ `selectiveInvalidate`（deps ∩ changed 命中 → 写 `{v:0}` 失效；否则重盖章 v=新版本）。
- **漏洞①**：`index/.arch-lens-index.json`（代码索引磁盘缓存，`packages/code-index-tree-sitter/src/index.ts`）**没有任何版本字段**；`callGraph` remote 直读它且不校验版本（`index.ts` remoteCallGraph 约 L621-655）。
- **漏洞②**：`generateAll` 的跳过判断 `needs(base)` 拼 `${base}-${lang}.json`（`index.ts` 约 L456），而 flow 缓存真实文件名是 `.arch-lens-flow-<lang>-<angle>.json`（`flow.ts` cacheName L40）→ **flow-event/flow-pipeline 在增量模式下永远被判定需要重画**，"零 LLM/skipped"语义对 flow 失效。

### 1.2 八个 Tab 与图来源（读/写分离）
客户端 8 tab：`concepts / overview / seq / flow / interaction / deps / catalog / draw`（`packages/client-arch-lens/src/client/arch-view.tsx` tabOrder 约 L1779）。**ER tab 已删**（`mermaidEr`/`mermaidIndexed`/`mermaidDeps` 三个 remote 客户端不再调用，只剩 `remote.ts` 里的声明——**本次不删**）。

读路径（全部只读缓存，无缓存→null→空态，绝不生成）：

| Tab | Remote | 缓存文件 |
|---|---|---|
| 概念树 | `conceptTree` | `.arch-lens-concept-<lang>[-methods].json` |
| 概览静态 | `overviewFigure` | core 缓存 + graph **规则拼装**（`mermaid.ts` overviewFigureFromGraph），零 LLM、无独立文件 |
| 概览 AI | `dynamicFigure('overview')` | `.arch-lens-dynamic-overview-<hash>-<lang>.json` |
| 时序-调用关系 | `callGraph` | 直读 `.arch-lens-index.json` import 边，零 LLM |
| 时序-主流程 | `sequence` | `.arch-lens-sequence-<lang>[-methods].json` |
| 流程图 | `flow`（语言×视角×粒度） | `.arch-lens-flow-<lang>-<angle>[-methods].json` |
| 交互 | `events`（实体+方法各一次） | `.arch-lens-events-<lang>[-methods].json` |
| 依赖 | `mermaidCore` | `.arch-lens-core-<lang>.json` + graph 规则画边 |
| 目录 | `graph` + `summarizeDuties` | graph 缓存 + `.arch-lens-summaries-<lang>.json` |
| 动态出图 | `customFigure` | 内存 → `.arch-lens-draw-<figureId>-<lang>.json`（用户保存才有） |

写路径（当前共 7 条，本方案收敛为 1 条统一写函数）：
1. `generateAll`（🔁 全量重建 / ⚡ 变动更新共用）：7 步实体级补画（`index.ts` remoteGenerateAll 约 L430-500）。
2. 🤖 AI 生成（会话回合）：`figurePrompt` → 回答监听 → `writeFigureCache`（`session-figure.ts` 约 L256）。
3. `regenerateFigure`（档案字段再生，后台兜底）：`regenerateProfileField` + `writeFigureCache`。
4. `✍️ 追问重画`：`followup.ts` → 自身 `writeVersionedCache`。
5. `📄 一键生成文档` / `generateDocSection`：LLM 直写文档章节 + （seq/interaction）`writeStructuredCache`。
6. 下钻：`writeDynamicFigureCache`——**非版本化裸 JSON，无 deps**。
7. draw 保存：`saveCustomFigure`（用户资产，非版本化，保持不动）。

### 1.3 各图写路径的链顺序（代码实证）
- **概念树** `conceptTree(ctx,...,force)`（`concept.ts`）：缓存→文档逐字提取（`docCandidates` zh 优先，7 候选；`isUsableDocTree` 门槛）→ 档案 `conceptTree` 字段（≥2 根或含子节点）→ LLM `generateFromFlow`。
- **流程图** `flowDiagram(ctx,...,force,angle)`（`flow.ts`）：缓存→文档围栏（mermaid 逐字 / 伪代码转码）→ 档案 `flow[angle]` → LLM `generateFlowFromCode`。deps：`source==='doc' ? [] : 全部包`（L266）。
- **core 选包** `coreGraph(ctx,...,force)`（`core.ts`）：缓存→档案 `coreIds`（≥4）→ `llmPick`（4–25）→ `fallbackIds`（curated，**不落缓存**）。
- **时序**：完整链 `resolveSequence`（code→cache→doc「## 时序」→档案→LLM）在 `sequence.ts`，**但没有任何 remote 调用它**（死代码）；`generateAll` 的 seq 步骤直接用 `writeStructuredCache`（纯 LLM，`docsgen.ts` L441），绕过文档与档案。
- **交互**：同 `writeStructuredCache`（纯 LLM）。
- **职责总结** `summarizeDuties`（`summarize.ts`）：只补缺失包，全量命中才返回；`generateAll` 步骤用它。
- **共享档案** `ensureAnalysisProfile`（`analysis.ts`）：两次串行 LLM（structure / figures），单飞锁；deps=全部包（任何包变动即失效）。

### 1.4 两个按钮的真实语义（勿误解）
- **⚡ 变动更新**（客户端 `regenerateInvalidated`，`arch-view.tsx` 约 L1210）：`refresh()`（检测+选择性失效）→ `generateAll({incremental:true})`。
- **🔁 全量重建**（`regenerateAll` 约 L1180）：**只有** `generateAll({incremental:true})`，不带 refresh。`incremental=false`（无条件全部重绘）后端保留但前端无入口。→ **本方案不改这两个按钮的语义**。
- 下钻图与 `-methods` 方法级缓存**都不在** generateAll 的清单里。`-methods` 有版本（会被失效、懒补画）；**下钻图无版本，失效与重建两头都不管**（本方案阶段 3 修复）。
- `selectiveInvalidate` 跳过名单：graph / file-manifest / index / llm-stats / progress（`fact-cache.ts` SKIP_INVALIDATION）。

---

## 2. 已拍板决策（用户确认，按推荐项）

| # | 决策 | 定案 |
|---|---|---|
| D1 | 下钻图更新语义 | **级联失效 + hover 按需重生成**（不主动批量重画；失效后不得把旧图作为"同族上下文"喂给新生成） |
| D2a | 文档章节 | **新增「流程图」章节** |
| D2b | 文档 ER 章节 | **保留**（用 core ER 规则渲染） |
| D3 | LLM 图概要放哪 | **图缓存 data 内可选 `description` 字段**（同信封、随图一起失效） |
| D4 | index.json 进事实真相 | **改 code-index 缝**：磁盘缓存 `{v, data}` 信封；legacy 文件视为过期→重建一次 |
| D5 | seq/interaction 补画 | **回到完整链**（缓存→文档→档案→LLM），与其他图同一总原则 |
| D6 | 死 remote 清理 | **保留 wire 名不删**，仅文档标注废弃 |
| D7 | 方法级缓存 | **维持现状**：参与失效、不自动补画（懒加载） |
| D8 | 文档生成 | **纯组装零 LLM**（LLM 只用于补缺图与可选 description）；现有 `sectionPrompt` 六段 LLM 直写路径废弃 |

---

## 3. 阶段 0：图种注册表（结构修复，不改行为）

**新文件** `packages/arch-lens-backend/src/figures.ts`：

```ts
export type EntityFigureId = 'concepts' | 'seq' | 'flow-event' | 'flow-pipeline' | 'interaction' | 'core' | 'duties'
export interface FigureKindSpec {
  id: EntityFigureId
  /** 必须与该图链的真实缓存文件名逐字符一致（直接复用各链的 cacheName，禁止另拼字符串） */
  cacheName(language: string): string
  /** 统一构建入口：缓存(除非force)→文档→档案→LLM，写缓存走统一写函数（阶段 2） */
  build(ctx, fs, root, index, language, force, policy): Promise<unknown | { error: string }>
}
export const FIGURE_SPECS: FigureKindSpec[]
```

- `cacheName` 一律**调用各链现有函数**：`flow.ts` 的 cacheName 需要 export（现在是非导出的 `function cacheName`）；concept/core/summarize/docsgen(SEQ_CACHE/EVENTS_CACHE) 同理。**注册表不允许自己拼文件名**——这是对漏洞②的结构性修复。
- 改 `remoteGenerateAll`：`needs(spec)` = `readRawCache(spec.cacheName(lang))` 为 null 或 `v !== factsVersion`；删除 `'.arch-lens-flow-event'` 这类 base 字符串拼接。7 步清单、`incremental` 分支、`rebuilt/skipped/failed` 返回形状**不变**。
- 阶段 0 里 spec.build 先指向现有实现（concepts→`conceptTree`、flow-*→`flowDiagram`、seq/interaction→`writeStructuredCache`、core→`coreGraph`、duties→`summarizeDuties`），阶段 2 再替换。

**验收**：`pnpm test` 全绿；新增测试：增量模式下已有有效 flow 缓存时 `generateAll` 返回 `skipped` 含 flow-event/flow-pipeline、零 LLM（mock llmText 抛错断言）。

---

## 4. 阶段 1：唯一变更事实真相（index 版本绑定）

1. **缝改造** `packages/code-index/src/index.ts`（CodeIndex 抽象类）与 `packages/code-index-tree-sitter/src/index.ts`：
   - `indexWorkspace(root, sandboxPolicy?, factsVersion?)` 增加可选参数。
   - 磁盘写：`factsVersion` 为有限正数时写 `{ v: factsVersion, data: <原 CodeIndexResult JSON> }`；**factsVersion 为 0/未传 → 不落盘**（与 `writeVersionedCache` 的 v=0 纪律一致）。
   - 磁盘读：解析信封；**顶层直接是 `{language, packages, ...}` 的 legacy 文件视为过期**（返回未命中→重建）；`language` 校验逻辑保留。
   - `refresh()` 语义不变（清内存+置空磁盘）。
2. **后端接入** `packages/arch-lens-backend/src/index.ts`：
   - `indexWorkspaceShared(root)`：先 `readFactVersion`，把 factsVersion 传给 `indexWorkspace`；拿到结果后防御性核对 `v === factsVersion`，不符则 `codeIndex.refresh` + 重建。
   - `remoteCallGraph`：改为解析信封并校验 `v === factsVersion`，否则返回现有的错误形状（提示先「↻ 重新扫描」）。
3. 兼容性：升级后第一次运行读到 legacy index → 重建一次（分钟级，一次性成本，可接受）。

**验收**：`pnpm test` 全绿（含 code-index 相关测试）；新增测试：v 不匹配时 callGraph 拒绝；legacy 文件触发重建；factsVersion=0 不落盘。

---

## 5. 阶段 2：统一写路径

1. **`figures.ts` 追加**：

```ts
/** 唯一的依赖包计算：所有图写缓存必须经此，不得各自另算 */
export function figureDeps(kind, data, index): string[]
/** 唯一的版本化写入口（内部调 writeVersionedCache，失败照旧 throw） */
export async function writeFigure(fs, root, specId, language, data, policy?, methods?): Promise<void>
```

   deps 规则（唯一一份）：
   - concepts / analysis 档案：全部包
   - flow：`source === 'doc' ? [] : 全部包`
   - seq：消息 from/to 去重
   - interaction：producers/consumers 去重
   - core：`result.ids`
   - duties：已总结包 id（`Object.keys(merged)`）
2. **迁移所有写点**（只换写函数，不动链顺序、不动提示词、不动读路径）：
   - `concept.ts` / `flow.ts` / `core.ts` 各自的 writeCache → `writeFigure`
   - `docsgen.ts` writeStructuredCache → `writeFigure`
   - `sequence.ts` writeSeqCache → `writeFigure`
   - `session-figure.ts` writeFigureCache：保留全部 sanitize，落盘改走 `writeFigure`
   - `followup.ts` 写点 → `writeFigure`
   - `summarize.ts` → `writeFigure('duties', ...)`
   - `analysis.ts` 档案写点**保持原样**（档案不是 tab 图，deps 已是全部包）
3. **seq 缓存形态统一**：写侧一律 `{ source, messages, ref? }` 对象；`writeStructuredCache` 产出包成 `{source:'flow', messages}`；`readSeqCache` 的裸数组兼容读**保留**（读旧缓存归一，不迁移磁盘文件）。
4. **seq/interaction 回完整链（D5）**：spec.build 实现——
   - seq：缓存(非force)→`extractSequenceFromDoc`（≥3 条且端点 ∈ 索引）→ 档案 `seqMessages`（≥3 且 coreIds 交叉校验）→ `writeStructuredCache`（LLM）。可直接重构 `resolveSequence` 为 build 实现（保留导出供测试用）；其 `buildSequenceFromCalls`/`buildSequenceFromImports` code 视图：`callGraph` 已独立提供，链内可不启用（默认 prefer='flow'）。
   - interaction：缓存(非force)→档案 `events`→LLM（writeStructuredCache）。
5. `remoteRegenerateFigure` 保留（后台兜底），其 `writeFigureCache` 落盘已随 2 走统一写函数。

**验收**：现有 89 测试全绿；新增：有文档仓库变动更新 seq 零 LLM（文档优先回归）；统一写出的信封与旧格式可互相读取。

---

## 6. 阶段 3：下钻图并入变动更新（D1）

1. `session-figure.ts` `writeDynamicFigureCache` 改版本化信封 `{ v, deps, data:{ title, diagram, source, kind, targetKey } }`，签名增加 `version` 与 `deps`。
2. **deps 规则**：
   - `seq-edge`：targetKey 里的 from / to 两个包；
   - `flow-subgraph`：父图（当前语言+视角的 flow 缓存）信封的 deps（读 `readRawCache` 拿；拿不到→全部包）；
   - `overview`：全部包。
   - 写入点在 `index.ts` 会话回答监听（落下钻缓存处），此处有 `index` 与 pendingFigure 上下文。
3. `readDynamicFigureFromDisk` 改用 `readVersionedCache`（版本不符→null）。客户端零改动：hover miss / 版本过期 → `startDynamicGeneration` 重新生成；**过期图不得再被 `buildDynamicFigurePrompt` 当同族上下文嵌入**（existing 读取自然为 null，确认此路径）。
4. `fact-cache.ts` `selectiveInvalidate` 改两段式：
   - 第一段：现行逻辑（实体/档案缓存失效或重盖章），**同时记录被失效的图种**（按文件名前缀映射 concept/sequence/events/flow/core/summaries/analysis）。
   - 第二段：`.arch-lens-dynamic-*.json`：命中条件 = `deps ∩ changedPackages` **或** 父图种被失效（seq-edge→sequence，flow-subgraph→flow，overview→恒失效因其 deps=全部包）**或** 无版本/无 deps 的 legacy 文件（与现行 legacy 规则一致）。
   - `.arch-lens-draw-*.json`（用户资产）与非信封文件继续跳过。
5. `-methods` 缓存维持现状（D7）：已被第一段覆盖，不进 generateAll。

**验收**：新增测试——父图失效 → 对应下钻全失效；未变动包的下钻重盖章存活；过期下钻读取返回 null；`pnpm test` 全绿。

---

## 7. 阶段 4：一键生成文档 = 图缓存组装（D2/D3/D8）

**新文件** `packages/arch-lens-backend/src/docbuild.ts`：

1. `ensureFigure(specId)`：版本化读缓存；缺失/过期 → `spec.build(force=false)`（内部自带缓存复查与链）→ 再读 → 返回图数据（或错误）。**这就是"哪个 tab 落后就触发哪个的变动更新；没有图就先建图"**——与阶段 2 完全同一条写路径。
2. `renderSection(kind, figure, graph, language): string` 纯渲染（零 LLM）：
   - concepts：树 → 层级 markdown（节点名+desc，doc 来源带锚点）。
   - **flow（新增，D2a）**：两个视角各一段，mermaid 围栏 + 来源标记（doc/flow）。
   - seq：有序列表 `from → to：label` + 来源标记。
   - interaction：表格（event/mode/producers/consumers/note）。
   - deps：core 子图 mermaid 围栏（复用 `mermaid.ts` importEdges/coreFlowchartFromGraph）+ 边清单。
   - er（保留，D2b）：`coreErDiagramFromGraph` 围栏。
   - catalog：`summarizeDuties` 全量结果（缺→ensureFigure('duties')）→ 包|职责 表格。
3. `generateDocsFromFigures(...)`：按 `SECTION_TITLES` 顺序 ensureFigure+render，`DOC_MARK` + 章节拼装 → 覆盖写 `docs/architecture.generated.md`（沿用 `resolveDocTarget`/`writeDoc`，绝不碰 `docs/architecture.md`）。
4. **改造入口**：`generateFullDocs` → 上述链；`generateDocSection(kind)` → 单章版。**删除**：`sectionPrompt` 的六段 LLM 调用路径、文档后补写 `writeStructuredCache`、`remoteGenerateDocs` 成功后"重建概念树"的 hack（新链路文档不反哺图，无循环）。`llmText` 保留供 description 用。
5. **description 扩展点（D3）**：
   - 各图 wire 类型加可选 `description?: string`（`types.ts`，只加字段不改形状）。
   - 渲染时：有 description 就输出为图后说明段。
   - 可选开关 `withDescriptions`：对缺 description 的图做**一次批量** LLM 调用产出各图概要，逐图 read-modify-write 回**同一信封**（保留原 v 与 deps）。默认关闭。
6. 客户端零改动（按钮行为不变，只是后端链路换了）；`genDocs` 的 notice 文案保持。

**验收**：重写 `docsgen.spec.ts`——组装正确性、缺图自动触发 build 链、默认零 LLM 断言（mock llmText 抛错）、`withDescriptions` 开启时恰好一次调用；`pnpm test` 全绿。

---

## 8. 阶段 5：收敛

1. 重写 `docs/arch-lens-overview.md`、`docs/arch-lens-diagrams.md`（对齐新链路：8 tab、版本化下钻、文档组装、唯一事实真相）。
2. 文档标注废弃面（D6）：`mermaidEr` / `mermaidIndexed` / `mermaidDeps`、`resolveSequence` 的 code 视图分支；**不删代码不删 wire**。
3. 可选：`index/` 旧命名残留文件（`.arch-lens-flow-default.json` 等无视角文件）不处理（无害，重盖章空转）。

---

## 9. 红线（不得改动）

1. **🔁 全量重建语义**：`generateAll(incremental=true)`、不带 refresh、`incremental=false` 分支保留、返回形状不变。
2. **所有读 remote 的 wire 名与返回形状**（唯一允许的行为变化：`callGraph` 增加版本校验后走既有错误形状）。
3. **会话图生成契约**：`figurePrompt` / `dynamicFigurePrompt` / `customFigurePrompt` 的 figId 匹配、30 分钟 TTL、usage 记账（`recordSessionUsage`）、pending 单槽。
4. draw 页签、笔记闭环（`notePending` + 会话事件监听唯一写路径）、讲解队列、⏹ 终止 / `cancelFollowUp`、LLM 统计。
5. `types.ts` 只允许**新增可选字段**（如 `description?`），不改既有字段与必选性。
6. `docs/architecture.md` 永不写入（用户文档）。
7. 客户端（`client-arch-lens`）本方案**零改动**是目标；若发现必须改，先停下来说明理由。

---

## 10. 验证基线与节奏

- 仓库根：`D:\dev\project\agent\deepseek\plugin\arch-lens`（pnpm workspace，Node ^22.19）。
- 动手前先跑基线并记录结果：`pnpm test`（vitest；现有 89 个测试）与 `pnpm typecheck`；完成后跑 `pnpm verify`（test + build）。
- 构建链：`tsc -b` → `tsdown`（host + client 两趟）；typert 生成物 `lib/typert.host.js` / `lib/typert.remote-client.js` 由构建驱动，**不改 wire 名就不需要手工重新设计**；若改了 `@Remote` 方法签名，必须重跑 `pnpm build` 让 codec 再生。
- 每阶段一个提交；提交信息注明阶段号。任何阶段测试红了先修到绿再进下一阶段。
- 测试风格沿用现有 `packages/arch-lens-backend/tests/*.spec.ts`（mock `ctx.llm.prepareCall` 记调用次数、mock `ctx.fs` 内存文件系统）。

## 11. 已知陷阱备忘

- `writeVersionedCache` 写失败必须 **throw**（"生成成功但图全空"症状的修复），迁移写点时不要包成静默。
- `selectiveInvalidate` 里"无 deps 字段 = 依赖所有包"、"显式空 deps = 永不失效（文档来源图）"两条规则不要破坏。
- `flow.ts` 的 doc 围栏提取、`sanitizeMermaid` 语法修复逻辑原样保留。
- `readSeqCache` 对裸数组的兼容读保留（旧缓存不迁移）。
- `coreGraph` 的 curated 回退**不落缓存**是故意设计（下次重试 LLM），不要"顺手"缓存它。
- 客户端 `dynamicTargetKey` / `hashString` 与后端是**镜像实现**（`arch-view.tsx` 有本地副本），改缓存命名规则时两边必须同步——本方案不改命名规则，避免触碰。
