# arch-lens「理解主干」交接文档

> 交接时刻：阶段 0/1/2 已提交（本地未推送），阶段 3 未动。
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

阶段 3（讲解版本化，备忘 §五）**未动**；细粒度包依赖（V2①）**刻意未做**（见 §六）。

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
- **刻意窄化**：主角只进无图章、黄金路径只进其下游——避免 `core` 成全员依赖、级联扇出过大。
- **消费即依赖**：注入即写进 `requires`（流程/交互→`seq`，ER/目录→`core`），账实相符。
- 缺上游图优雅退回原事实块。`CHAPTER_REQUIRES`（docchapter.ts）是这张账的唯一真源：
  `concepts→[concepts]`、`seq→[seq]`、`flow→[flow-event,flow-pipeline,seq]`、
  `interaction→[interaction,seq]`、`deps/er/catalog→[core]`。

### 4.5 docs 降思考档（阶段 0）
`docsgen.ts`：`LOW_EFFORT_KINDS = new Set(['docs'])`（**图归纳不动**）。`llmText` 用
`llm.resolveModelInfo` 探模型 `reasoning`，`lowestReasoningEffort` 选广告最低档
（命名低档正则 `^(none|minimal|low|最低|低)$`，否则取第一个；等于默认档则跳过）；
探测失败回落默认、**绝不阻塞**。

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
4. **`deps` 不能盲目窄化**：章节事实块（`sharedFacts`）当前含**全部包清单**，若只按正文
   引用的包窄化 `deps` 会**欠失效**、服务过期正文（比过度失效更糟）。这是 V2① 被推迟的原因。
5. **`edit` 工具**：`old_string` 必须精确唯一匹配；此仓库多次出现"看不见的不匹配"，
   失败时改用**更小的单行锚点**重试。已删除路径再 `edit` 会报"文件不存在"，换新文件名。
6. **`read` 用工具而非 `cat`**；`glob` 找文件、`grep` 找内容（不用 shell 的 find/grep）。

## 六、明确的"不做 / 缓做"

- **细粒度包依赖（V2①）**：需先把每章事实块收窄到相关包，才敢窄化 `deps`。账本格式
  （`requires`）已就位，勿抢做、勿二次改信封格式（备忘 §四.3："同一本账，不能分两次改信封"）。
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
- [ ] 黄金路径只出现在 **流程/交互** 章；目录章**无**；无 `seq` 图时**无**此块。
- [ ] 依赖章保留自己的核心块、**不**重复注入主干核心包行。
- [ ] 缺上游图（`core`/`seq` 为 null 或空）→ 优雅退回，不报错。
- [ ] 七章信封 `requires` 与 `CHAPTER_REQUIRES` 一致。

**信封账（阶段 2）**
- [ ] `requires` 写读往返；旧信封（无字段）读为 `[]`；写入去重。

**思考档（阶段 0）**
- [ ] 仅 `docs` 类降档，图归纳不动；探测失败回落默认且不阻塞。

**一键生成整体**
- [ ] 串行 7 章、新鲜缓存跳过、只补缺/重试失败章；降级正文带 ⚠️ 落地但**不写缓存**。

## 八、阶段 3 交接（下一站，备忘 §五）

讲解版本化归位：讲解回答埋令牌（figId 同款捕获）→ 宿主落版本信封
`.arch-lens-explain-<章>-<语言>.json`（`deps`=该图 `figureDeps`，图失效连带讲解失效）→
章节解析梯度插入"新鲜讲解（文档语体、零二次 LLM）→ 图证生成 → 延伸"。缺失/过期回落
宿主直连。**动它之前**先读备忘 §五 与现有 `explain.ts`/章节梯度，勿改信封格式。

## 九、一句话总结

主干 = 认知序（阶段 0）→ 旧稿当底稿改（阶段 1）→ 上游结论下传 + 消费即依赖的失效账
（阶段 2）。三阶段已提交未推送；阶段 3 与 V2① 是下一站；改任何缓存/提示词前，先回到
备忘与本文 §四/§五 对齐不变式。
