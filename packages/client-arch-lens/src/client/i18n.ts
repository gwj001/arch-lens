/**
 * Panel UI copy for the Arch Lens desk, switched by the configured role
 * language (promptConfig.language): 'English' renders the en set, anything
 * else falls back to Chinese. Question texts sent to the model are NOT part
 * of this — they already carry their own language directive.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/i18n
 */

/** Static panel copy keyed by language; unknown languages fall back to zh. */
const UI_COPY = {
  zh: {
    title: '🧭 架构学习台',
    tabConcepts: '概念层级图',
    tabSeq: '时序图',
    tabInteraction: '核心交互图',
    tabDeps: '依赖图',
    tabEr: 'ER 图',
    tabCatalog: '包目录',
    btnCode: '🔍 代码解析',
    btnOverview: '💡 全貌讲解',
    btnProgress: '📊 学习进度',
    btnPrompts: '✏️ 提示词',
    btnRescan: '↻ 重新扫描',
    btnRefresh: '↻ 刷新此图',
    btnExplainGraph: '🤖 讲解此图',
    btnExplainCatalog: '🤖 讲解此目录',
    viewOverview: '组概要',
    viewFull: '全量图',
    loadingScan: '正在扫描 packages/*/* …',
    generating: '生成{t}…',
    indexingCopy: '正在生成源码级依赖图（首次索引约 1-2 分钟，自动重试中…）',
    failLoad: '{t}加载失败：{msg}',
    retry: '↻ 重试',
    tipConcepts: '概念层级图：点击概念节点展开/收起，点击包节点查看详情',
    tipSeq: '时序图：一次完整 turn 的消息流（策展数据）',
    tipInteraction: '核心交互图：生产者 → 事件 → 消费者，点击事件节点查看详情',
    tipDeps: '依赖图（Mermaid）：包间 peerDependencies 关系',
    tipEr: 'ER 图（Mermaid）：包关系实体视图',
    tipCatalog: '包目录 # 职责：{count} 个包，点击任意一行查看详情并 AI 讲解',
    loadFailed: '加载失败：{msg}',
    detailFailed: '详情读取失败',
    detailFiles: '核心文件索引',
    detailDeps: '依赖 → {deps} ｜ 被依赖 ← {dependents}',
    detailKeyLines: '关键注册点（浓缩）',
    detailSnippet: '入口代码（浓缩）',
    detailExplain: '🤖 AI 讲解此组件',
    detailFollowup: '针对此组件的追问，回复显示在下方',
    send: '发送',
    eventProducers: '生产者 → {list}',
    eventConsumers: '消费者 ← {list}',
    eventExplain: '🤖 AI 讲解此事件',
    followupPlaceholder: '追问',
    notesTitle: '📓 笔记记录更新#{count}',
    notesHintNone: '（每次 AI 讲解后自动记录）',
    notesHintSome: '（详情见工作区 ARCH-NOTES.md）',
    noDesc: '（无描述，点击查看详情）',
    sessionPlaceholder: '选择会话…',
    sessionTitle: '讲解目标会话（回复渲染在所选会话的主对话中）',
    noSessionNotice: '请先在面板顶部选择目标会话',
    sendFailedNotice: '讲解请求失败：{msg}',
    sendSkipNotice: '讲解请求未能送达，已跳过',
    summarizeFailedNotice: '职责总结生成失败：{msg}',
    summarizeReqFailedNotice: '职责总结请求失败：{msg}',
    progressWorking: '学习进度总结生成中…',
    progressDone: '✓ 学习进度总结已生成（见笔记底部）',
    progressRegenerated: '✓ 学习进度总结已重新生成（见笔记底部）',
    progressFailed: '学习进度总结失败：{msg}',
    progressReqFailed: '学习进度请求失败：{msg}',
    editorTitle: '✏️ 提示词编辑（保存在工作区 .arch-lens-prompts.json）',
    editorModeLabel: '使用哪套提示词：',
    editorModeMine: '📝 我的提示词',
    editorModeDefault: '✨ 默认模板',
    editorModeHintMine: '使用你保存的提示词（可编辑）；未保存过时回退到默认模板。',
    editorModeHintDefault: '使用默认模板：随角色语言自动切换（中文 / English 各一套），切换语言即切换模板；点"覆盖我的"会把当前语言默认模板写入"我的提示词"。',
    editorOverviewLabel: '💡 全貌讲解提示词（可用 {root} / {core} 占位符）',
    editorStyleLabel: '📖 单元/组件讲解理念（EXPLAIN_STYLE）',
    editorLanguageLabel: '🌐 角色语言（所有讲解/摘要的输出语言，如：中文 / English）',
    editorSave: '保存',
    editorOverwrite: '覆盖我的',
    editorSaving: '保存中…',
    editorReset: '恢复默认',
    editorSaved: '✓ 已保存',
    fabTitle: '拖动移动；点击展开/收起架构学习台',
    fabBusyTitle: '讲解员忙（正在讲解）',
  },
  en: {
    title: '🧭 Arch Lens Desk',
    tabConcepts: 'Concepts',
    tabSeq: 'Sequence',
    tabInteraction: 'Interactions',
    tabDeps: 'Dependencies',
    tabEr: 'ER',
    tabCatalog: 'Catalog',
    btnCode: '🔍 Code',
    btnOverview: '💡 Overview',
    btnPrompts: '✏️ Prompts',
    btnRescan: '↻ Rescan',
    btnRefresh: '↻ Refresh',
    btnExplainGraph: '🤖 Explain',
    btnExplainCatalog: '🤖 Explain',
    btnProgress: '📊 Progress',
    viewOverview: 'Groups',
    viewFull: 'Full',
    loadingScan: 'Scanning packages/*/* …',
    generating: 'Generating {t}…',
    indexingCopy: 'Building source-level graph (first index takes 1-2 min; auto-retrying…)',
    failLoad: '{t} failed: {msg}',
    retry: '↻ Retry',
    tipConcepts: 'Concept tree: click a concept to expand/collapse, click a package for details',
    tipSeq: 'Sequence: message flow of one full turn (curated)',
    tipInteraction: 'Interactions: producer → event → consumer; click an event for details',
    tipDeps: 'Dependencies (Mermaid): peerDependencies between packages',
    tipEr: 'ER (Mermaid): package relationship entities',
    tipCatalog: 'Catalog # duty: {count} packages — click a row for details and AI explain',
    loadFailed: 'Failed to load: {msg}',
    detailFailed: 'Failed to read details',
    detailFiles: 'Key files',
    detailDeps: 'Depends → {deps} ｜ Depended by ← {dependents}',
    detailKeyLines: 'Key registration points (condensed)',
    detailSnippet: 'Entry code (condensed)',
    detailExplain: '🤖 Explain this package',
    detailFollowup: 'Follow-up about this package (reply appears below)',
    send: 'Send',
    eventProducers: 'Producers → {list}',
    eventConsumers: 'Consumers ← {list}',
    eventExplain: '🤖 Explain this event',
    followupPlaceholder: 'Follow-up',
    notesTitle: '📓 Notes updated #{count}',
    notesHintNone: '（recorded automatically after each AI explain）',
    notesHintSome: '（details in workspace ARCH-NOTES.md）',
    noDesc: '（no description — click for details）',
    sessionPlaceholder: 'Select session…',
    sessionTitle: 'Target session (the answer renders in its main chat)',
    noSessionNotice: 'Select a target session in the panel header first',
    sendFailedNotice: 'Explain request failed: {msg}',
    sendSkipNotice: 'Explain request could not be delivered, skipped',
    summarizeFailedNotice: 'Duty summaries failed: {msg}',
    summarizeReqFailedNotice: 'Duty summary request failed: {msg}',
    progressWorking: 'Generating progress summary…',
    progressDone: '✓ Progress summary appended (bottom of notes)',
    progressRegenerated: '✓ Progress summary regenerated (bottom of notes)',
    progressFailed: 'Progress summary failed: {msg}',
    progressReqFailed: 'Progress request failed: {msg}',
    editorTitle: '✏️ Prompt editor (saved to workspace .arch-lens-prompts.json)',
    editorModeLabel: 'Which prompts to use:',
    editorModeMine: '📝 My prompts',
    editorModeDefault: '✨ Default templates',
    editorModeHintMine: 'Use your saved prompts (editable); falls back to the defaults when none are saved.',
    editorModeHintDefault: 'Use the default templates: they switch with the role language (中文 / English), so changing the language changes the templates. "Overwrite mine" copies the current-language default into your saved prompts.',
    editorOverviewLabel: '💡 Overview prompt ({root} / {core} placeholders)',
    editorStyleLabel: '📖 Explain style (EXPLAIN_STYLE)',
    editorLanguageLabel: '🌐 Role language (output language for all explains/summaries, e.g. 中文 / English)',
    editorSave: 'Save',
    editorOverwrite: 'Overwrite mine',
    editorSaving: 'Saving…',
    editorReset: 'Reset',
    editorSaved: '✓ Saved',
    fabTitle: 'Drag to move; click to open/close the Arch Lens desk',
    fabBusyTitle: 'Explainer busy (explaining)',
  },
} as const

export type UiKey = keyof typeof UI_COPY.zh

/** Resolve the copy set for the configured role language ('English' → en, else zh). */
function setFor(language: string): Record<UiKey, string> {
  return (language === 'English' ? UI_COPY.en : UI_COPY.zh) as Record<UiKey, string>
}

/**
 * Panel copy for one key in the configured language.
 * @param language - role language (promptConfig.language).
 * @param key - copy key.
 * @returns the localized string.
 */
export function ui(language: string, key: UiKey): string {
  return setFor(language)[key] ?? UI_COPY.zh[key]
}

/**
 * Panel copy with `{name}` placeholders substituted.
 * @param language - role language.
 * @param key - copy key.
 * @param params - placeholder values.
 * @returns the localized template with substitutions.
 */
export function uiT(language: string, key: UiKey, params: Record<string, string>): string {
  let text = ui(language, key)
  for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, value)
  return text
}
