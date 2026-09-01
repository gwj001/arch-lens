# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)（预发布期以 `-rc.N` 递增）。

## [Unreleased]

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
