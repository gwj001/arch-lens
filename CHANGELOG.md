# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)（预发布期以 `-rc.N` 递增）。

## [Unreleased]

### Added
- `scripts/toggle-arch-lens.ps1`：DSH profile 挂载开关（on/off 重写 cordis.patch.yml，
  自动备份、保留无关行），README 使用者层同步「随时停用 / 恢复」小节

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
