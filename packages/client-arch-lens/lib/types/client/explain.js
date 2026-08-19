/**
 * Explain-prompt assembly for the Arch Lens learning desk. Prompts stay
 * learning-object-agnostic: the scanned graph injects the repository identity
 * and core components, so the same templates serve any workspace.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/explain
 */
/** Default output language (Config/promptConfig.language may replace it). */
export const DEFAULT_LANGUAGE = '中文';
/** Default unit explain style (Config.explainStyle may replace it). */
export const DEFAULT_EXPLAIN_STYLE = '按以下理念讲解：'
    + '0) 先一句话说明这张图/这份数据的性质：是代码静态调用关系，还是运行时消息时序？'
    + '若是静态调用图，明确说明：每条边代表"谁在源码里调用谁的函数"，边的顺序是遍历顺序、不代表执行时序；'
    + '1) 只讲流程与职责，这个组件/事件/图表达什么、关键节点是什么；'
    + '2) 它如何被调度、又如何调度其他组件（服务/事件/消息）；'
    + '3) 用自然语言翻译核心机制，不要贴大段代码；'
    + '4) 给出关键文件路径（优先引用图中/依据里给出的路径）；'
    + '5) 最后给一条学习路径建议（接下来看什么）。';
/** Default overview prompt (Config.overviewPrompt may replace it). */
export const DEFAULT_OVERVIEW_PROMPT = '请从上帝视角讲解代码库「{root}」的整体架构。\n\n'
    + '【参考模板】参考架构学习台的概念层级模板组织讲解：先讲运行框架/基座，再讲核心层，再讲各能力模块，最后讲外部接入。\n'
    + '【设计理念】识别并讲解这个系统的核心设计理念（如插件化、事件驱动、不可变日志、分层、fail-closed 等——从代码和文档中判断，不要生搬硬套）。\n'
    + '【结构与交互】1) 核心组件有哪些（参考：被依赖最多的组件：{core}）；2) 核心组件之间怎么交互（服务调用 vs 事件/消息，谁调度谁）；3) 整体如何装配/启动；4) 一次典型的主流程。\n'
    + '【安全】如有沙箱/权限/审批机制，讲解其构成与执行路径。\n'
    + '【输出要求】只讲流程与职责，用自然语言翻译核心机制，不要贴大段代码；给出关键文件路径；最后给一条学习路径建议。\n\n'
    + '工作区：{root}';
/** English default overview prompt (used when the role language is English). */
export const DEFAULT_OVERVIEW_PROMPT_EN = 'Explain the codebase "{root}" from a bird\'s-eye view.\n\n'
    + '[Template] Organize the explanation along the concept-hierarchy shape: runtime foundation first, then the core layer, then capability modules, then external integration.\n'
    + '[Design ideas] Identify and explain the core design ideas (plugin-based, event-driven, immutable log, layering, fail-closed, etc. — judge from the code and docs, do not force-fit).\n'
    + '[Structure & interaction] 1) Core components (reference: most-depended packages: {core}); 2) How they interact (service calls vs events/messages, who schedules whom); 3) How the whole thing is assembled and starts; 4) One typical main flow.\n'
    + '[Security] If sandbox/permission/approval mechanisms exist, explain their structure and execution path.\n'
    + '[Output] Flow and responsibility only; translate core mechanisms into plain language; no large code blocks; give key file paths; end with one learning-path suggestion.\n\n'
    + 'Workspace: {root}';
/** English default explain style (used when the role language is English). */
export const DEFAULT_EXPLAIN_STYLE_EN = 'Explain per this philosophy: '
    + '0) start with one sentence about the nature of this figure/data: is it a static call relationship or a runtime message sequence? '
    + 'If it is a static call graph, state clearly that each edge means "who calls whose function in source", and that edge order is traversal order, not execution timing; '
    + '1) flow and responsibility only — what this component/event/figure expresses and its key nodes; '
    + '2) how it is scheduled and how it schedules others (services/events/messages); '
    + '3) translate the core mechanisms into plain language, no large code blocks; '
    + '4) give key file paths (prefer paths present in the figure/evidence); '
    + '5) end with one learning-path suggestion (what to look at next).';
/** Default overview template for the configured role language. */
export function defaultOverview(language) {
    return language === 'English' ? DEFAULT_OVERVIEW_PROMPT_EN : DEFAULT_OVERVIEW_PROMPT;
}
/** Default explain style for the configured role language. */
export function defaultStyle(language) {
    return language === 'English' ? DEFAULT_EXPLAIN_STYLE_EN : DEFAULT_EXPLAIN_STYLE;
}
/**
 * Whether the per-language default templates should be used for prompts.
 * An explicit `useDefaults` wins; otherwise a config that already carries a
 * saved override behaves like "my prompts", and an empty one like defaults.
 * @param config - persisted prompt configuration.
 * @returns true when the default templates apply.
 */
export function useDefaultsConfig(config) {
    return config.useDefaults ?? (config.overviewPrompt === undefined && config.explainStyle === undefined);
}
/**
 * Repository display name from the graph root path.
 * @param root - absolute workspace root.
 * @returns last path segment, or a fallback.
 */
export function repoName(root) {
    const parts = root.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.at(-1) ?? '当前代码库';
}
/**
 * The most-depended-upon package ids (core candidate heuristic).
 * @param graph - scanned graph.
 * @param limit - how many to return.
 * @returns short ids ordered by in-degree descending.
 */
export function coreCandidates(graph, limit = 8) {
    const inDegree = new Map();
    for (const edge of graph.edges)
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    return [...graph.nodes]
        .map(node => ({ id: node.id, degree: inDegree.get(node.id) ?? 0 }))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, limit)
        .map(entry => entry.id);
}
/**
 * Language directive appended to every explain prompt: the configured
 * "role language" governs all output (summaries, duty text, terminology,
 * code comments) and forbids mixing languages.
 * @param language - configured language name (e.g. '中文', 'English').
 * @returns the directive clause, or '' for the default language.
 */
export function languageClause(language) {
    if (language === DEFAULT_LANGUAGE)
        return '';
    return `\n\n【语言】请全程使用「${language}」输出——包括摘要、职责说明、术语解释、代码注释与所有文本；除非引用原文，否则不要混用其他语言。`;
}
/**
 * Evidence + answering-discipline clause appended to EVERY explain prompt:
 * the model must answer only from the given facts (each with its source
 * anchor), flag conflicts, and call out documents it can prove wrong.
 * @param entries - evidence items (label / source anchor / bounded text).
 * @returns the clause, or '' when there is no evidence.
 */
export function evidenceClause(entries) {
    if (entries === undefined || entries.length === 0)
        return '';
    const lines = entries.map(entry => `- ${entry.label}（出处：${entry.ref}）：${entry.text.slice(0, 1200)}`);
    return `\n\n【事实依据】\n${lines.join('\n')}\n`
        + `【作答要求】只依据上述「事实依据」与题目给出的数据作答，依据之外的内容不得补充或臆测；`
        + `需要引用图表数据（依赖/实体/时序/图源）时请标注其来源；`
        + `若依据之间或依据与你的知识冲突，说明可能存误并建议读者查证原文或案例推演；`
        + `若你能 100% 确认依据有误（如文档与代码事实矛盾），请明确指出「依据有误」并给出正确事实。`;
}
/**
 * Assemble the overview explain request for a workspace graph.
 * @param graph - scanned graph.
 * @param overviewPrompt - configured or default template.
 * @param language - output language name.
 * @param evidence - optional evidence entries appended to the prompt.
 * @returns the question text.
 */
export function overviewQuestion(graph, overviewPrompt, language, evidence) {
    const root = repoName(graph.root);
    return overviewPrompt
        .replaceAll('{root}', root)
        .replaceAll('{core}', coreCandidates(graph).join('、'))
        + evidenceClause(evidence)
        + languageClause(language);
}
/**
 * Code-derived insight clause appended to component/concept explains: the
 * entry-source registrations (services/events/remotes/tools) so the model
 * explains from real code, not just README blurbs. Empty when no insight.
 * @param insight - code-derived insight for the package.
 * @returns the clause text, or '' when absent.
 */
export function codeInsightClause(insight) {
    if (insight === undefined)
        return '';
    const parts = [];
    if (insight.provides.length > 0)
        parts.push(`提供服务：${insight.provides.join(', ')}`);
    if (insight.listens.length > 0)
        parts.push(`监听事件：${insight.listens.join(', ')}`);
    if (insight.remotes.length > 0)
        parts.push(`Remote 方法：${insight.remotes.join(', ')}`);
    if (insight.tools.length > 0)
        parts.push(`注册工具：${insight.tools.join(', ')}`);
    if (parts.length === 0)
        return '';
    return `\n\n【代码线索（从入口源码提取）】${parts.join('；')}。`;
}
/**
 * Assemble the per-component explain request.
 * @param id - package short id.
 * @param group - package group.
 * @param blurb - duty text (localized when available).
 * @param files - src file names.
 * @param explainStyle - configured or default style.
 * @param language - output language name.
 * @param insight - optional code-derived insight injected into the prompt.
 * @returns the question text.
 */
export function componentQuestion(id, group, blurb, files, explainStyle, language, insight, evidence) {
    const fileList = files.length > 0 ? files.join(', ') : id;
    return `讲解组件 ${id}${group === '' ? '' : `（${group}）`}：\n\n${blurb === '' ? '' : `${blurb}\n\n`}核心文件：${fileList}\n\n${explainStyle}${codeInsightClause(insight)}${evidenceClause(evidence)}${languageClause(language)}`;
}
/**
 * Assemble the per-event explain request.
 * @param event - event name.
 * @param mode - dispatch mode.
 * @param producers - producer names.
 * @param consumers - consumer names.
 * @param note - event note.
 * @param explainStyle - configured or default style.
 * @param language - output language name.
 * @returns the question text.
 */
export function eventQuestion(event, mode, producers, consumers, note, explainStyle, language, evidence) {
    return `讲解核心事件 ${event}（模式 ${mode}）：\n生产者：${producers.join(', ')}；消费者：${consumers.join(', ')}。\n${note}\n\n${explainStyle}${evidenceClause(evidence)}${languageClause(language)}`;
}
/**
 * Assemble a unit-data explain request (figure/catalog).
 * @param title - unit title.
 * @param data - unit data JSON.
 * @param explainStyle - configured or default style.
 * @param language - output language name.
 * @param evidence - optional evidence entries appended to the prompt.
 * @returns the question text.
 */
export function dataQuestion(title, data, explainStyle, language, evidence) {
    let body = '';
    try {
        // Bounded but roomy: the call-graph figure carries node role metadata
        // (up to ~24 messages with syms/file evidence plus ~24 nodes), and the
        // model should see it whole for a grounded explanation.
        body = JSON.stringify(data).slice(0, 8000);
    }
    catch {
        body = String(data);
    }
    return `请讲解这张图「${title}」：\n\n${body}\n\n${explainStyle}${evidenceClause(evidence)}${languageClause(language)}`;
}
//# sourceMappingURL=explain.js.map