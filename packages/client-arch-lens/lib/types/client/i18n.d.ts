/**
 * Panel UI copy for the Arch Lens desk, switched by the configured role
 * language (promptConfig.language): 'English' renders the en set, anything
 * else falls back to Chinese. Question texts sent to the model are NOT part
 * of this — they already carry their own language directive.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/i18n
 */
/** Static panel copy keyed by language; unknown languages fall back to zh. */
declare const UI_COPY: {
    readonly zh: {
        readonly title: "🧭 架构学习台";
        readonly tabConcepts: "概念层级图";
        readonly tabSeq: "时序图";
        readonly tabInteraction: "核心交互图";
        readonly tabDeps: "依赖图";
        readonly tabEr: "ER 图";
        readonly tabCatalog: "包目录";
        readonly btnCode: "🔍 代码解析";
        readonly btnOverview: "💡 全貌预讲解";
        readonly btnPrompts: "✏️ 提示词";
        readonly btnRescan: "↻ 重新扫描";
        readonly btnRefresh: "↻ 刷新此图";
        readonly btnExplainGraph: "🤖 讲解此图";
        readonly btnExplainCatalog: "🤖 讲解此目录";
        readonly viewOverview: "组概要";
        readonly viewFull: "全量图";
        readonly loadingScan: "正在扫描 packages/*/* …";
        readonly generating: "生成{t}…";
        readonly failLoad: "{t}加载失败：{msg}";
        readonly retry: "↻ 重试";
        readonly tipConcepts: "概念层级图：点击概念节点展开/收起，点击包节点查看详情";
        readonly tipSeq: "时序图：一次完整 turn 的消息流（策展数据）";
        readonly tipInteraction: "核心交互图：生产者 → 事件 → 消费者，点击事件节点查看详情";
        readonly tipDeps: "依赖图（Mermaid）：包间 peerDependencies 关系";
        readonly tipEr: "ER 图（Mermaid）：包关系实体视图";
        readonly tipCatalog: "包目录 # 职责：{count} 个包，点击任意一行查看详情并 AI 讲解";
        readonly loadFailed: "加载失败：{msg}";
        readonly detailFailed: "详情读取失败";
        readonly detailFiles: "核心文件索引";
        readonly detailDeps: "依赖 → {deps} ｜ 被依赖 ← {dependents}";
        readonly detailKeyLines: "关键注册点（浓缩）";
        readonly detailSnippet: "入口代码（浓缩）";
        readonly detailExplain: "🤖 AI 讲解此组件";
        readonly detailFollowup: "针对此组件的追问，回复显示在下方";
        readonly send: "发送";
        readonly eventProducers: "生产者 → {list}";
        readonly eventConsumers: "消费者 ← {list}";
        readonly eventExplain: "🤖 AI 讲解此事件";
        readonly followupPlaceholder: "追问";
        readonly notesTitle: "📓 笔记记录更新#{count}";
        readonly notesHintNone: "（每次 AI 讲解后自动记录）";
        readonly notesHintSome: "（详情见工作区 ARCH-NOTES.md）";
        readonly noDesc: "（无描述，点击查看详情）";
        readonly sessionPlaceholder: "选择会话…";
        readonly sessionTitle: "讲解目标会话（回复渲染在所选会话的主对话中）";
        readonly noSessionNotice: "请先在面板顶部选择目标会话";
        readonly sendFailedNotice: "讲解请求失败：{msg}";
        readonly sendSkipNotice: "讲解请求未能送达，已跳过";
        readonly summarizeFailedNotice: "职责总结生成失败：{msg}";
        readonly summarizeReqFailedNotice: "职责总结请求失败：{msg}";
        readonly editorTitle: "✏️ 提示词编辑（保存在工作区 .arch-lens-prompts.json）";
        readonly editorOverviewLabel: "💡 全貌预讲解提示词（可用 {root} / {core} 占位符）";
        readonly editorStyleLabel: "📖 单元/组件讲解理念（EXPLAIN_STYLE）";
        readonly editorLanguageLabel: "🌐 角色语言（所有讲解/摘要的输出语言，如：中文 / English）";
        readonly editorSave: "保存";
        readonly editorSaving: "保存中…";
        readonly editorReset: "恢复默认";
        readonly editorSaved: "✓ 已保存";
        readonly fabTitle: "拖动移动；点击展开/收起架构学习台";
        readonly fabBusyTitle: "讲解员忙（正在讲解）";
    };
    readonly en: {
        readonly title: "🧭 Arch Lens Desk";
        readonly tabConcepts: "Concepts";
        readonly tabSeq: "Sequence";
        readonly tabInteraction: "Interactions";
        readonly tabDeps: "Dependencies";
        readonly tabEr: "ER";
        readonly tabCatalog: "Catalog";
        readonly btnCode: "🔍 Code";
        readonly btnOverview: "💡 Overview";
        readonly btnPrompts: "✏️ Prompts";
        readonly btnRescan: "↻ Rescan";
        readonly btnRefresh: "↻ Refresh";
        readonly btnExplainGraph: "🤖 Explain";
        readonly btnExplainCatalog: "🤖 Explain";
        readonly viewOverview: "Groups";
        readonly viewFull: "Full";
        readonly loadingScan: "Scanning packages/*/* …";
        readonly generating: "Generating {t}…";
        readonly failLoad: "{t} failed: {msg}";
        readonly retry: "↻ Retry";
        readonly tipConcepts: "Concept tree: click a concept to expand/collapse, click a package for details";
        readonly tipSeq: "Sequence: message flow of one full turn (curated)";
        readonly tipInteraction: "Interactions: producer → event → consumer; click an event for details";
        readonly tipDeps: "Dependencies (Mermaid): peerDependencies between packages";
        readonly tipEr: "ER (Mermaid): package relationship entities";
        readonly tipCatalog: "Catalog # duty: {count} packages — click a row for details and AI explain";
        readonly loadFailed: "Failed to load: {msg}";
        readonly detailFailed: "Failed to read details";
        readonly detailFiles: "Key files";
        readonly detailDeps: "Depends → {deps} ｜ Depended by ← {dependents}";
        readonly detailKeyLines: "Key registration points (condensed)";
        readonly detailSnippet: "Entry code (condensed)";
        readonly detailExplain: "🤖 Explain this package";
        readonly detailFollowup: "Follow-up about this package (reply appears below)";
        readonly send: "Send";
        readonly eventProducers: "Producers → {list}";
        readonly eventConsumers: "Consumers ← {list}";
        readonly eventExplain: "🤖 Explain this event";
        readonly followupPlaceholder: "Follow-up";
        readonly notesTitle: "📓 Notes updated #{count}";
        readonly notesHintNone: "（recorded automatically after each AI explain）";
        readonly notesHintSome: "（details in workspace ARCH-NOTES.md）";
        readonly noDesc: "（no description — click for details）";
        readonly sessionPlaceholder: "Select session…";
        readonly sessionTitle: "Target session (the answer renders in its main chat)";
        readonly noSessionNotice: "Select a target session in the panel header first";
        readonly sendFailedNotice: "Explain request failed: {msg}";
        readonly sendSkipNotice: "Explain request could not be delivered, skipped";
        readonly summarizeFailedNotice: "Duty summaries failed: {msg}";
        readonly summarizeReqFailedNotice: "Duty summary request failed: {msg}";
        readonly editorTitle: "✏️ Prompt editor (saved to workspace .arch-lens-prompts.json)";
        readonly editorOverviewLabel: "💡 Overview prompt ({root} / {core} placeholders)";
        readonly editorStyleLabel: "📖 Explain style (EXPLAIN_STYLE)";
        readonly editorLanguageLabel: "🌐 Role language (output language for all explains/summaries, e.g. 中文 / English)";
        readonly editorSave: "Save";
        readonly editorSaving: "Saving…";
        readonly editorReset: "Reset";
        readonly editorSaved: "✓ Saved";
        readonly fabTitle: "Drag to move; click to open/close the Arch Lens desk";
        readonly fabBusyTitle: "Explainer busy (explaining)";
    };
};
export type UiKey = keyof typeof UI_COPY.zh;
/**
 * Panel copy for one key in the configured language.
 * @param language - role language (promptConfig.language).
 * @param key - copy key.
 * @returns the localized string.
 */
export declare function ui(language: string, key: UiKey): string;
/**
 * Panel copy with `{name}` placeholders substituted.
 * @param language - role language.
 * @param key - copy key.
 * @param params - placeholder values.
 * @returns the localized template with substitutions.
 */
export declare function uiT(language: string, key: UiKey, params: Record<string, string>): string;
export {};
//# sourceMappingURL=i18n.d.ts.map