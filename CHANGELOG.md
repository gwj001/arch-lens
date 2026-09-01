# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)（预发布期以 `-rc.N` 递增）。

## [Unreleased]

### Added
- **「📄 一键生成文档」V1 章节管线（重做回归，替代下条的开关式下线）**：
  一个 `generateDocs` RPC 内 host 侧**串行**跑 7 章（概念层级 / 时序 / 流程图 /
  核心交互 / 依赖 / 实体关系 / 包目录职责，无总览章），每章一次独立宿主直连
  `llmText`（kind `docs`，与图生成同一通道、同一 ⚡ 用量账本、同一 ⏹ 终止信号）：
  - **同一份事实快照同时喂 prompt 与门禁**：`buildGroundTruth`（包/文件/边）一轮只算
    一次，生成与校验不存在时间差；
  - **零 LLM 幻觉门禁**（`doc-hallucination.ts`，纯函数、宁可漏报不误报）：拦截编造的
    带 scope 包名（给最近真包建议）、不存在的文件路径（`./` 与反斜杠归一、大小写宽容）、
    `| 调用方 | 被调用方 |` 表中的虚构边与方向颠倒；围栏代码块与裸标识符（函数名等）
    永不拦截。违规退回**恰好一轮修复**（只修列出的违规、禁改语义）；修复后仍不过关 →
    带 ⚠️ 落地但**不写缓存**（下轮重试）；
  - **图驱动章节（概念/时序/流程/交互）是纯消费者**：缺对应图缓存即跳过并提示去相应
    tab 补图，从不暗中触发出图——一次点击的费用面完全确定；依赖/ER/目录三章只靠代码
    事实即可写；
  - **落地与复用**：每章独立写 `docs/architecture-<章>.generated.md`（文件头带生成来源
    注释，重生成覆盖；`.generated.md` 后缀保证永不覆盖用户手写文档）+ 版本化信封缓存
    `.arch-lens-docchapter-<章>-<语言>.json`（与图缓存同一套 `factsVersion` 机制）；
    新鲜缓存直接跳过，重复点击**只补缺、只重试失败章**（幂等）；
  - 客户端按钮提示语细化：生成/跳过（缓存新鲜/缺图）/失败章分桶汇报 + 降级与失败名单；
  - **章节嵌图（零 LLM）**：落地文档正文后附「## 图示」一节，从对应图缓存**确定性渲染**
    ——流程章=两视角 mermaid 原样围栏（读侧已净化）、时序章=消息序列图（首见序参与者）、
    依赖/ER 章=核心子图规则 mermaid、概念章=嵌套列表、交互章=事件表、目录章无图；
    图块是缓存派生事实，不重复过幻觉门禁；缺图章节维持纯正文；
  - 测试：`doc-hallucination.spec.ts`（12 例，含"不得误报"契约）+ `docchapter.spec.ts`
    （22 例：注册表/事实打包/门禁-修复-降级全路径/信封往返/串行循环跳过语义/嵌图渲染）
- **V2 演进清单（记录后续方向，非本次实现）**：① 每章细粒度 `deps` 失效（V1 为
  deps=全部包，任何代码变动使全部章节失效）；② 提示词编辑器接入文档风格（当前章节
  prompt 内置）；③ 逐章 diff/合并的落盘交互（当前直接覆盖）；④ `withDescriptions`
  图说明作为章节可选增强（能力随旧组装链保留未删）；⑤ 隔离会话生成选项（当前宿主直连，
  不进会话历史）；⑥ 裸标识符/短名实体白名单校验（V1 已知放行面）；⑦ 图驱动章节缺图时
  可选"顺手补图"模式；⑧（探讨中）**章节来源演进——全图讲解版本化**：讲解回答埋令牌、
  宿主捕获落版本信封（deps=该图 deps，图失效连带讲解失效），章节优先消费新鲜讲解
  （讲解提示词按文档语体写 → 零二次 LLM），缺失回落宿主直连；把出文档成本摊进学习时间；
  ⑨ docs 类调用思考档下调/并行化（压首轮墙钟，与⑧正交可叠加）

### Changed
- **理解主干 · 阶段 1 收尾：概念树链接入 prior 修订**——概念树是自研流式归纳
  （不走 `llmText`），本批补齐：`generateFromFlow` 增 prior 参数，`conceptTree`
  兜底前读旧概念树信封（`force` 照旧跳过）。至此五条图归纳链 + 章节管线全部接入
  先前稿修订，阶段 1 无遗留
- **理解主干 · 阶段 2（部分）：`requires` 信封账 + 级联失效**（备忘 §四.3 的
  账本半边；级联语境提示词注入与细粒度包依赖未做，见备忘）：
  - 信封新增 `requires`（消费的缓存种类名，如章节嵌入的图）；`readRawCache`
    往返、旧信封读为 `[]`（向后兼容）；
  - `invalidateRequiring(fs, root, node)`：墓碑所有 `requires` 含 node 的信封
    （跳过事实源/用户画作/已墓碑文件）；
  - `writeFigure` 成功后自动级联（方法级变体不级联实体章节）——修补缺口：图
    **就地重生**（🔁 或补图，事实版本未变）时，嵌入它的章节信封过去会继续以
    "新鲜"身份服务旧正文，现在被级联失效、下轮重生成；
  - 章节落信封记录 `requires`：概念→[concepts]、时序→[seq]、流程→
    [flow-event, flow-pipeline]、交互→[interaction]、依赖→[core]、ER/目录→[]
    （职责刻意不记：事实版本已覆盖，记了会过度失效）
- 测试 322 → 332（`requires-cascade.spec.ts` 7 例：信封往返/向后兼容/去重、
  级联精确性与禁区、`writeFigure` 级联与语言级豁免；`concept-prior.spec.ts`
  2 例；docchapter 增 1 例：全图就绪时七章信封 `requires` 落盘形状）
- **理解主干 · 阶段 1：过期缓存降级为「先前稿」的增量修订链**（备忘 §四.1，
  本轮落地章节 + 时序 + 交互 + 流程 + 核心五条 LLM 归纳链）：
  - `fact-cache.ts readStalePrior`：版本失配的信封不再只是"拒绝"，其数据可作
    修订底稿读出（`v=0` 墓碑、新鲜缓存、无版本遗留、空数据一律 null）；
  - `docsgen.ts priorRevisionPreamble`：双语修订契约（保留仍成立的、只改矛盾的、
    删除新事实中已不存在的、上一版只是形态参考不是事实来源）；
  - 章节管线：`chapterRevisePrompt` = 修订前言 + 上一版 + 原章节提示词（五条写作
    规则与 JSON 契约不变，幻觉门禁照旧复审——防"旧错误锚定"）；循环内对每个待
    生成章节读旧信封作 prior；
  - 时序/交互：`writeStructuredCache` 增 prior 参数，`resolveSequence` 与交互
    构建读旧缓存注入；流程：归纳兜底携旧图修订；核心：旧选择作参照行
    （`validateIds` 仍按新索引过滤，锚定有界）；
  - 逃生门不变：🔁 全量重建（force）永远跳过 prior；章节侧删除信封文件即同时
    移除缓存与 prior。修订产物照旧走统一写路径、盖当前版本戳。
    遗留：概念树链是自研流式归纳（未接 prior），记入阶段 1 尾项
- 测试 310 → 322（`prior-revision.spec.ts` 9 例：readStalePrior 语义 6 + 修订
  契约 1 + 结构化归纳接线 2；docchapter 增 3 例：修订提示词契约/单章 prior/
  循环内 stale→prior 接线）
- **理解主干 · 阶段 0：图与章节生成顺序重排为认知序**（设计备忘
  `docs/design-comprehension-spine.md`）：`FIGURE_SPECS` 重排为 职责（词汇表）→
  概念（读声称）→ 核心（主角）→ 时序 → 流程×2（黄金路径）→ 交互（反应）；
  `DOC_CHAPTER_KINDS` 对齐为 目录 → 概念 → 依赖 → 时序 → 流程 → ER → 交互。
  缓存文件名/失效只认文件名不认顺序——重排仅改生成顺序；职责提前到首位，
  消除"词汇表没建、图提示词先造句"的历史错位。回归测试锁文件名契约与顺序同步
- **docs 类调用思考档下调**：`llmText` 对 kind `docs` 提案路由广告的最低思考档
  （`resolveModelInfo` 能力探测 + `lowestReasoningEffort` 纯函数：优先名含
  low/none/minimal/低 者，否则取 adapter 列表首位；与默认档相同则不提案）。
  dsh-llm 对不支持的 effort 在 provider I/O 前拒绝（无钳制无别名），故只提案
  已广告 id，结构安全；探测失败回落默认、绝不阻塞生成。背景：7 章文档轮实测
  思考 token 3K–9.4K/章、占墙钟约九成（≈18 分钟）；图类保留默认档待质量权衡
- 测试 303 → 310（`lowestReasoningEffort` 4 例 + `llmText` effort 接线 3 例）
- **旧「一键生成文档」组装链整体删除（非屏蔽）**：`docbuild.ts`（图缓存 → markdown 的
  零 LLM 模板组装，含 `ensureFigure` 按需补建）、`remoteGenerateDocSection` 单节面、
  `DOCS_FEATURE_OFF` 开关、`SECTION_TITLES` 与旧 `tests/docsgen.spec.ts` 一并移除——
  模板正文达不到可交付质量是当年下线裁定，V1 章节管线回归后该链无存在意义；
  `docsgen.ts` 保留共享基建（`llmText`/归纳 prompt/结构化缓存读写）。笔记系
  `NOTES_FEATURE_OFF` 维持退役（会话记录即笔记的裁定不变）

### Fixed
- 客户端 bot 的 `send`/`cancel` 编译断裂（宿主漂移）：harness 将浏览器会话面从
  `SessionStore.binding` 迁到 Session Controller（`dsh-api-session-controller`），而
  `dsh-session`（宿主对象层）与 controller 对 `Context.sessions` 的合并声明在
  skipLibCheck 下互让，本仓库类型图解析到无 `binding` 的宿主版——`client/index.ts`
  改为消费**结构性镜像**（契约逐条对齐 `contract/sessions.ts` `binding` +
  `contract/session.ts` `prompt/cancel` + `contract/result.ts` `ClientResult`），
  运行时注入的仍是 controller，行为不变
- `typertPlugin` 产物构建死锁：`DocChapterOutcome`/`DocChaptersOutcome` 必须声明在公共
  非根 type 子路径（`./types`）才能过 typert 边界分析——两个 wire 类型从 `docchapter.ts`
  迁入 `types.ts`（根 index 照旧 `export *` 转出）

### Added
- `scripts/toggle-arch-lens.ps1`：DSH profile 挂载开关（on/off 重写 cordis.patch.yml，
  自动备份、保留无关行），README 使用者层同步「随时停用 / 恢复」小节
- 测试类型检查收编：三个 `packages/*/tests/tsconfig.json` + `pnpm typecheck:tests`
  （vitest 只转译不查类型，此前 tests 从不被 tsc 审查）
- `scripts/scripts.md` 脚本手册：各脚本作用 / 用法 / 生效方式；脚本头部说明精简为一行指路

### Changed
- **笔记系与一键生成文档暂时下线（开关式屏蔽，代码与既有数据文件保留，翻回即恢复）**：
  裁定"会话记录即笔记"——讲解问答、生成的图、追问过程全在当前会话历史里，
  `ARCH-NOTES.md` 只是记不住图的有损子集。屏蔽面：host `NOTES_FEATURE_OFF`（`notes`/
  `progress`/`progressStats` 三 RPC 守卫 + 讲解完成监听不再 `appendNote`，usage 记账与
  讲解链路照常）、client 同名开关隐藏 NotesPanel/📊 学习进度按钮/覆盖度徽章；
  `DOCS_FEATURE_OFF` 下线 `generateDocs`/`generateDocSection`（零 LLM 模板组装正文达不到
  可交付质量，重做参照 DSH 文档形态：docs=仓库资产、agent 会话轮撰写，另议）。
  不受影响：时序/流程图对既有仓库文档的逐字提取读路径、你手写的 `docs/architecture.md`。
  README/usage.md/overview 机制 10 同步标注
- 职责事实 LEGACY 兜底移除：`customFigurePrompt` / `dynamicFigurePrompt` 不再收
  `context.blurbs`，客户端 `blurbsFromGraph` 及四处调用点删除——出图职责段唯一来源
  为 host 侧磁盘态（`dutyFactsForFigure` → `mergeDutyFacts` 零依赖叶子），
  双数据路径归一；空洞（无 AI 总结且无扫描文本）留空不再由客户端填洞
- 编译期依赖解耦本机 DSH checkout：tsconfig.base.json 的 60+ 条 harness `paths`
  换成 npm `@deepseek-ai/*` 固定 0.1.1-rc.2 线（dev/peer 精确锁定；运行时仍由宿主
  external 提供，不产生双份实例）；`typertPlugin` 改自 npm
  `@deepseek-ai/dsh-typert-generator/tsdown`；唯一豁免 `@deepseek-ai/dsh-client-ui-session`
  （上游未发 npm，paths 带注释保留，README 记录清理时机）
- `toggle-arch-lens.ps1` 由整文件模板替换改为对开关段的追加 / 变更（缺行才补，
  其余配置一概不碰）；`check-contract` 对比目标改为本仓库 client bundle（自挂载后的
  真实 codec 载体，不再依赖 harness 副本）；`verify-dsh-web.cmd` 去本机路径
  （argv > DSH_HARNESS_DIR > 同级推断）
- 测试假体对齐 dsh-fs 0.1.1-rc.2 类型（fake-fs 升级 FsTarget 语义 + fsTarget helper；
  notes / read-only / docsgen / analysis 四处 spec 数据形状对齐新类型）

### Fixed
- 子图互相压叠（动态出图/流程图）：dense 多子图布局在紧凑间距下子图框重叠、盖住
  相邻子图标题（t8hmeb 实测：职责归纳∩基础事实层 重叠 7229px²）——flowchart
  `nodeSpacing` 60→110、`rankSpacing` 90→170（mermaid-view 全局 + 调用关系图
  init 指令同步）；实测 100/160 起重叠归零，110/170 保留 10%+ 余量
- 节点/子图文字被裁（动态出图与流程图 tab）：mermaid 按自身测量（画布字宽 +
  wrappingWidth 分行）定死 foreignObject 尺寸，实际 HTML 排版在字体度量不一致时
  多折一行/超出测量宽度即被 fo 默认 hidden overflow 切掉——mermaid-view 增加
  `svg foreignObject { overflow: visible }`，标签文字永不裁切（溢出仅限度量差
  的几像素/一行，实测 SimSun 字体偏差下子图标题由 457px 截断恢复为全文可见）
- 最右侧子图框右缘外文字不可见：mermaid 的 viewBox 只按布局盒子计算，标签溢出
  部分对最右元素落在 viewBox 之外，被 SVG 根视口默认裁掉——`.host svg` 增加
  `overflow: visible` 放开根视口（`.host` 自身 overflow:hidden 仍把溢出限制在
  图面板内），右缘溢出文字恢复可见
- 重扫收尾墓碑清扫（`sweepLegacyCaches`）：物理删除 `index/` 下无 `{v,...}` 版本
  封套、当前任何读写路径都够不到的 `.arch-lens-*.json` 残留（如无视角时代的旧命名
  流图文件）；失效标记 `{v:0}` 属受管墓碑不动，用户资产 `.arch-lens-draw-*` 与
  progress/graph/llm-stats 等纯 JSON 系统文件一律跳过
- 编辑器里 tests 的 `@deepseek-ai/dsh-fs` 等误报红（tests 不在任何 tsconfig 项目内
  导致的 inferred-project 解析）

## [0.1.0-rc.5] - 2026-08-27

### Added
- 讲解按钮族扩展：追问重画对话框与动态出图动作行新增「🗣 AI 讲解」；同会话同图源脏检（不重复发全文）
- 学习进度实时徽章（`已讲解 N/M · x%`，零 LLM 纯算术，讲解回合结束即刷新）；缓存命中时提示生成时间与强刷指引
- 「💾 保存当前图（锁定图号）」旁新增讲解入口；已保存图支持回看/删除
- 一键生成文档：正文零 LLM 的图缓存组装 + 缺图按需补建 + 可选 `withDescriptions` 批量图说明
- 「⏹ 停止」：per-root AbortController 挂到全部 LLM 调用点，真中断
- ⚡ LLM 用量面板：本工作区账本（累计 + 最近明细，provider 实数优先）

### Changed
- 学习进度总结并入版本信封缓存：重扫后旧总结不再误发
- LLM 统计改为以文件为账本（进程重启历史不丢、折叠加性、写入前防覆盖）
- mermaid flowchart 全局 basis→linear + 加宽间距；调用关系图平行边合并（×N）与双向 `<-->` 归一
- 子图 hover 几何命中 + 浮动按钮 150ms 宽限（遮挡不再干扰）
- 概念树节点文字按框宽截断 + 悬停全文；画布宽随实际层级自适应

### Fixed
- 流程图边标签/曲线遮挡节点文字
- 「⚡ 变动更新」在手动重扫后早退（看似无反应）
- 讲解队列手动清空后脏检引用失同步

## [0.1.0-rc.1] - 2026-08（初始整合）

### Added
- pnpm workspace 五包骨架：typert-protocol（vendored）/ code-index（能力缝）/
  code-index-tree-sitter（TS·Python·Java 离线解析）/ arch-lens-backend / client-arch-lens
- 8 Tab 学习台：⚡ 总览 · 概念树 · 时序 · 流程图 · 交互 · 依赖 · ER · 目录
- 事实脊柱：`factsVersion` + `{v, deps, data}` 版本信封 + 图注册表统一写路径 + 两段式级联失效
- 文档优先链、共享分析档案（冷启动两次串行 LLM）、会话图生成（figId 协议）、
  动态下钻/自定义出图/追问重画、笔记管线（去重/截断/上限）
