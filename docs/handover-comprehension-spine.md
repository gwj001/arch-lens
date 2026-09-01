# arch-lens「理解主干」交接文档

> 交接时刻：阶段 0/1/2/3 已提交（本地未推送）。
> 权威设计备忘：`docs/design-comprehension-spine.md`（**先读它**，本文是工程侧交接 + 测试点）。

## 一、项目是什么

`arch-lens` 是 DSH 的一个 Cordis 插件（浮动机器人 + 学习桌），核心是把一个代码仓库
**扫描 → 归纳成一组"图"（概念树/时序/流程×2/交互/核心/职责）→ 写成 7 章架构文档**。
"理解主干"（comprehension spine）是贯穿图与文档生成的**认知顺序 + 缓存/失效账 +
增量修订**总设计。

- 仓库根：`D:\dev\project\agent\deepseek\plugin\arch-lens`
- 后端逻辑：`packages/arch-lens-backend/src/`
- 测试：`packages/arch-lens-backend/tests/`（vitest，`--pool=threads`）
- 客户端：`packages/client-arch-lens/`

## 二、命令（验证三件套 + 构建）

```
pnpm typecheck                        # 源码
pnpm typecheck:tests                  # 测试也要过
pnpm exec vitest run --pool=threads   # 当前 336 全绿
pnpm build                            # 三面构建
```

提交用消息文件 + `git commit -F`（如 `.git/COMMIT_MSG_*`，提交后删除）。
**不要 `git push`——推送是用户自己在终端做的事。** CRLF warning 无害。

## 三、进度与提交（本地，未推送）

| 提交 | 内容 |
|---|---|
| `1b68648` | 笔记系 + 旧一键文档**开关式下线**（`NOTES_FEATURE_OFF` / `DOCS_FEATURE_OFF`，唯一 kill-switch 是 `NOTES_FEATURE_OFF`） |
| `f546563` | 一键生成文档 **V1 章节管线**（7 章串行 + 幻觉门禁 + 一轮修复 + 版本信封 + 章节嵌图；删旧 `docbuild`） |
| `f2c5614` | **阶段 0**：图/章生成重排认知序 + docs 类调用降思考档 |
| `b0fa829` | **阶段 1**：过期缓存降级为「先前稿」增量修订（章节/时序/交互/流程/核心 五链） |
| `1d76a63` | 阶段 1 收尾（概念树链接 prior）+ **阶段 2 账本半边**：信封 `requires` + 级联失效 |
| `5026c41` | **阶段 2 提示词半边**：级联语境（§4.2）上线，消费即依赖 |
| `（本批）` | **阶段 3：讲解版本化**——tab 讲解按文档语体写、落章信封、章节梯度插「新鲜讲解」零二次 LLM 格 |
| `（本批）` | **V2①：细粒度包依赖**——事实块与信封 `deps` 同源收窄（时序/交互/依赖/ER 四章），无关包变动只重盖章、相关包变动才失效；讲解信封 deps 同源（覆盖黄金路径，无欠失效边角） |
| `（本批）` | **级联语境补全（§3.3）**：黄金路径触及的实体 → ER 章；ER `requires` 扩为 `[core,seq]`、`erPkgSubset` 并入路径端点 |

阶段 0–3 与 V2① 全部已实施。

## 四、核心机制速查（改动前必读）

### 4.1 信封格式（缓存脊柱）
所有图/章缓存都是 `{ v, deps?, requires?, data }` 信封，写在 `index/.arch-lens-*.json`。
- `v` = 写入时的 `factsVersion`；`{v:0}` 是**失效墓碑**。
- `deps` = 派生自哪些**包**（代码变动维度）。
- `requires` = 消费了哪些**缓存种类**（逻辑主干维度，如章节嵌的图、级联语境输入）。
- 读：`readRawCache`（版本无关，`requires` 缺失读为 `[]`，向后兼容）；
  `readVersionedCache`（仅 `v===当前版本` 才服务）；
  `readStalePrior`（`v≠当前 且 v≠0` 的旧数据当"先前稿"，只喂修订提示词、**绝不直接服务**）。
- 写：统一走 `writeVersionedCache`（`deps`/`requires` 去重、`v===0` 拒写）。图只经
  `writeFigure`（解析权威文件名 → `figureDeps` 盖章 → `writeVersionedCache` → **级联**）。

### 4.2 先前稿增量修订（阶段 1）
过期缓存不丢弃 → 旧数据作修订底稿（`priorRevisionPreamble` 双语 + 上一版 + 原提示词），
任务从"创作"变"只改受影响部分"。**不变式**：输出格式契约与解析逐链不变；修订产物
照旧过幻觉门禁（章节）/ `validateIds`（核心）防旧错误锚定；`force`（🔁 全量）永远跳过
prior；删信封文件 = 同时移除缓存与 prior。已接入 6 链：章节/时序/交互/流程/核心/概念树
（概念树是自研流式归纳，不走 `llmText`）。

### 4.3 级联失效（阶段 2 账本）
`invalidateRequiring(fs, root, node)`：墓碑所有 `requires` 含 `node` 的信封（跳过事实源
`.arch-lens-graph.json`/manifest、用户画作 `.arch-lens-draw-*`、已墓碑文件）。
`writeFigure` 成功后自动级联（**方法级 `methods===true` 不级联实体章节**）。修补的缺口：
图就地重生（🔁/补图，`factsVersion` 未变）时，嵌它的章节过去会以"新鲜"身份服务旧正文。

### 4.4 级联语境（阶段 2 提示词，§4.2）
上游结论作事实段注入下游章节提示词，同格式同门禁，不引入新幻觉面：
- **主干核心包**（protagonists）→ 无图的 **ER / 目录** 章（`sharedFacts` 加 `core` 参数）；
  依赖章本就嵌核心子图（`depsFacts`），不重复注入。
- **黄金路径**（时序消息序列，`goldenPathFacts`）→ **流程 / 交互** 章。
- **刻意窄化**：主角只进无图章、黄金路径只进其下游（流程/交互/**ER 章路径触及的
  实体**，§3.3）——避免 `core` 成全员依赖、级联扇出过大。
- **消费即依赖**：注入即写进 `requires`（流程/交互/ER→`seq`，ER/目录→`core`），账实相符。
- 缺上游图优雅退回原事实块。`CHAPTER_REQUIRES`（docchapter.ts）是这张账的唯一真源：
  `concepts→[concepts]`、`seq→[seq]`、`flow→[flow-event,flow-pipeline,seq]`、
  `interaction→[interaction,seq]`、`deps→[core]`、`er→[core,seq]`、`catalog→[core]`。

### 4.5 docs 降思考档（阶段 0）
`docsgen.ts`：`LOW_EFFORT_KINDS = new Set(['docs'])`（**图归纳不动**）。`llmText` 用
`llm.resolveModelInfo` 探模型 `reasoning`，`lowestReasoningEffort` 选广告最低档
（命名低档正则 `^(none|minimal|low|最低|低)$`，否则取第一个；等于默认档则跳过）；
探测失败回落默认、**绝不阻塞**。

### 4.6 讲解版本化（阶段 3，备忘 §五）
- 讲解 = 学习桌「讲解」按钮 → 客户端把问题塞进 GUI 会话（agent 回合）。捕获机制：
  `notePending`（后端预注册 pending：target/question/sessionId/**chapter/language**）→
  下一条 `assistant/message` 匹配 → usage 记账 +（可选）笔记 + **章讲解落盘**。
- 章讲解落盘：`staged.chapter` 存在时写 `.arch-lens-explain-<章>-<语言>.json`
  （`explain-cache.ts` 叶子模块：`explainCacheName`/`readExplainCache`（仅
  `v===factsVersion` 且非空 markdown 才算新鲜）/`writeExplainCache`）。`deps` 由
  `docchapter.chapterExplainDeps` 从该章图缓存派生（**与章节收窄同源**，交互/流程
  讲解覆盖黄金路径端点；er/catalog/概念无图 → undefined=legacy 全失效）；
  `requires`=导出的 `CHAPTER_REQUIRES`（图就地重生 → 既有 `invalidateRequiring`
  级联墓碑讲解）。
- 章节梯度（`generateDocChapters` 循环内）：新鲜章节缓存 → **新鲜讲解**（过幻觉门禁
  ⇒ 零二次 LLM 直接 renderLandedDoc + 写章节信封，照常盖 requires；门禁违规 ⇒ 回落
  LLM）→ packChapterFacts 正常链。**独立于笔记开关**：`NOTES_FEATURE_OFF` 只关笔记，
  讲解捕获不受影响（捕获代码在笔记 return 之前）。
- 客户端：默认讲解理念第 6 条=文档语体（用户自定义 `explainStyle` 时用自己的）；
  六入口（概念/时序/流程/交互/依赖/目录 tab）讲解带章归属，组件/事件/概念讲解不带
  （粒度不对齐、不落盘）。

### 4.7 细粒度包依赖（V2①，同一本账的另一半）
- `sharedFacts` 增 `pkgSubset` 参数：包清单 + 调用边表（双端在子集内）只列相关包。
- 收窄四章（子集源自嵌入数据）：`seq`→消息 from/to 包；`interaction`→事件包 ∪
  黄金路径包（`interactionScope`）；`deps`→核心 ids；`er`→`erFacts` 被列出实体的
  所属包 ∪ 核心 ids（与实体清单同遍历、同 `MAX_ENTITY_LINES` 上限，**锁步一致**；
  实体增删必在子集内、函数实现变化不失效，两方向都正确）。目录/概念/流程**保持
  全量**（全局事实是目录章的本体；流程 mermaid 节点是实体不是包 id，无法可靠映射）
  ——失效方向永远安全：没喂的包不会失效章节，喂了的必失效。
- 信封 `deps` = `chapterPackageDeps(kind, figureCache, graph, index?)`，与事实块**同源**
  派生（er 需要 index，无 index 回退全量）；讲解信封 deps（`chapterExplainDeps`）同源。
  无欠失效边角。
- 效果：无关包变动 → `selectiveInvalidate` 只**重盖章**保留正文（v 更新、数据在）；
  相关包变动 → 墓碑重生成。此前"任何代码变动使全部章节失效"到此结束。

## 五、已知的"坑"（改代码前必看）

1. **测试缝**：`docsgen.ts` **内部定义**的函数（如 `writeStructuredCache`）调用的是模块
   自己的 `llmText` 绑定——`vi.mock('../src/docsgen.ts')` **拦不到**。要测经 `llmText` 的
   提示词，须 mock `@deepseek-ai/dsh-llm` 的 `createUserMessage` 捕获 `message.content[*].text`，
   并跑**真** `llmText`（配假 ctx：`agentDefaultModel` + `llm.prepareCall` 流式
   `text-delta`/`finish`）。参照 `tests/llmText-usage.spec.ts`。
2. **环形导入在函数级安全**：已有 `figures↔docsgen`、`concept→docsgen→figures→concept`，
   typecheck/测试已验证可用，别因"看着成环"就重构。
3. **`FigureFactsCache` 七字段必须齐全**（concepts/seq/flowEvent/flowPipeline/interaction/
   core/duties）——测试里拼对象时缺字段会过不了 `typecheck:tests`。
4. **`deps` 收窄必须与事实块同源**：只按正文引用的包窄化 `deps` 会**欠失效**、服务
   过期正文（比过度失效更糟）——V2① 的正确做法是先把事实块收窄到该章消费的包，
   再从同一子集派生 deps（已实施，见 §4.7）。
5. **`edit` 工具**：`old_string` 必须精确唯一匹配；此仓库多次出现"看不见的不匹配"，
   失败时改用**更小的单行锚点**重试。已删除路径再 `edit` 会报"文件不存在"，换新文件名。
6. **`read` 用工具而非 `cat`**；`glob` 找文件、`grep` 找内容（不用 shell 的 find/grep）。

## 六、明确的"不做 / 缓做"

- **并行化**：与主干哲学相抵（级联语境要求串行）；仅同层无依赖节点（如流程两视角）可选。
- **推送**：永远由用户执行。

## 七、测试点清单（验证/回归重点）

> 现有 336 例全绿。下列是**语义上必须守住**的点，改动后优先回归这些。

**先前稿修订（阶段 1）**
- [ ] 过期信封（`v≠当前 且 v≠0`）→ 成为修订底稿：**不是**新鲜跳过、**不是**空白重写。
- [ ] `force=true`（🔁）永远跳过 prior；删除信封 = 无缓存且无 prior。
- [ ] 修订产物过门禁/`validateIds`（旧错误不被锚定）；修订后重新盖**当前** `factsVersion`。
- [ ] 新鲜缓存（`v===当前`）直接服务，不进修订链。

**级联失效（阶段 2）**
- [ ] 图就地重生（`factsVersion` 不变）→ `requires` 它的章节信封变 `{v:0}`。
- [ ] 方法级写入（`methods:true`）**不**级联实体章节。
- [ ] 级联跳过：事实源 / `.arch-lens-draw-*` / 已墓碑文件；级联失败**不**使图写入失败。
- [ ] 精确性：`seq` 重生只达流程/交互，`core` 重生只达 ER/目录，概念章不受牵连。

**级联语境（阶段 2）**
- [ ] 主干核心包只出现在 **ER/目录** 章事实块（概念/时序/流程/交互章**无**此行）。
- [ ] 黄金路径只出现在 **流程/交互** 章；ER 章出现「黄金路径触及的实体」（§3.3：seq 端点包的实体）；目录章**无**；无 `seq` 图时**无**这些块。
- [ ] 依赖章保留自己的核心块、**不**重复注入主干核心包行。
- [ ] 缺上游图（`core`/`seq` 为 null 或空）→ 优雅退回，不报错。
- [ ] 七章信封 `requires` 与 `CHAPTER_REQUIRES` 一致（ER→`[core,seq]`，级联：seq 重生达流程/交互/ER）。

**信封账（阶段 2）**
- [ ] `requires` 写读往返；旧信封（无字段）读为 `[]`；写入去重。

**思考档（阶段 0）**
- [ ] 仅 `docs` 类降档，图归纳不动；探测失败回落默认且不阻塞。

**讲解版本化（阶段 3）**
- [ ] 新鲜讲解（`v===factsVersion`、非空 markdown）→ 章节**零 LLM** 落地 + 写章节信封；再点一次变 cache-fresh skip。
- [ ] 过期讲解 → 正常 LLM 链；门禁违规讲解 → 回落 LLM 且**不落地**。
- [ ] 讲解信封 `requires` 参与级联：图就地重生 → 讲解被墓碑 → 不再新鲜。
- [ ] 讲解捕获**独立于** `NOTES_FEATURE_OFF`（开关只关笔记）。
- [ ] 讲解落地后章节信封 `requires` 与 LLM 产出一致（`CHAPTER_REQUIRES`）。

**细粒度包依赖（V2①）**
- [ ] 时序/交互/依赖/ER 章事实块（包清单 + 调用边表）只含其消费的包；交互章覆盖黄金路径端点；ER 章子集与 `erFacts` 锁步（同遍历、同上限）。
- [ ] 收窄章的 `deps` 与事实块同源（时序=[消息端点]、交互=[事件∪黄金路径]、依赖=[核心 ids]、ER=[被列出实体所属包∪核心 ids]）；全局章（目录/概念/流程）=全量；er 无 index 回退全量。
- [ ] 失效语义：无关包变动 → 重盖章保留正文（v 更新、markdown 在）；相关包变动 → 墓碑。
- [ ] 讲解信封 deps 同源（交互/流程讲解覆盖黄金路径端点——无"重盖章复活但引用过时路径"的欠失效边角）。

**一键生成整体**
- [ ] 串行 7 章、新鲜缓存跳过、只补缺/重试失败章；降级正文带 ⚠️ 落地但**不写缓存**。

## 八、下一站交接

**主干四阶段与 V2① 全部落地**。已论证不做：流程章收窄（mermaid 节点是实体不是包
id，映射脆、会欠失效）；变化点注入（重扫变更集无跨层通道，需持久化新缓存种类）；
组件/事件/概念讲解落章（粒度不对齐）；并行化（与串行哲学相抵）；依赖章引用黄金
路径（§3.3 原话——但重排后 deps 先于 seq，级联方向不成立）。可选项：
- **概念章收窄**：概念树节点无包关联——若未来概念树节点带包元数据可收窄。
- **讲解信封覆盖补全**：er 章无独立 tab（与 deps 同源）。

## 九、一句话总结

主干 = 认知序（阶段 0）→ 旧稿当底稿改（阶段 1）→ 上游结论下传 + 消费即依赖的失效账
（阶段 2）→ 学习过的章节文档白得（阶段 3）→ 事实与失效账同源收窄（V2①）。
四阶段与 V2① 已提交未推送；改任何缓存/提示词前，先回到备忘与本文 §四/§五 对齐不变式。
