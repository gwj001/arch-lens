/**
 * Architecture-doc generation for the Arch Lens backend. Two entry points:
 *   - generateFullDocs: one LLM pass writes a complete docs/architecture.md
 *     (concept / sequence / interaction / dependency / ER / catalog sections).
 *   - generateDocSection: one dimension regenerated on demand (per-tab "AI
 *     generate"); sequence/interaction also write structured caches the
 *     figures render directly.
 * A generated file carries a marker header; a pre-existing hand-written
 * architecture.md is never overwritten — the generated doc lands in
 * docs/architecture.generated.md instead.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docsgen
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { importEdges } from "./mermaid.js";
/** Marker proving a doc file was produced by this tool. */
const DOC_MARK = '<!-- arch-lens generated -->';
/** Primary target for generated docs. */
const DOC_FILE = 'docs/architecture.md';
/** Alternative target when the primary exists without the marker. */
const DOC_FILE_AI = 'docs/architecture.generated.md';
/** Section titles per dimension, used as `##` headings in the doc. */
export const SECTION_TITLES = {
    concepts: '概念层级',
    seq: '时序',
    interaction: '核心交互',
    deps: '依赖',
    er: '实体关系',
    catalog: '包目录职责',
};
/** Cache file names for structured figure data (sequence/events). */
const SEQ_CACHE = '.arch-lens-sequence';
const EVENTS_CACHE = '.arch-lens-events';
/** Keep cache file names filesystem-safe. */
function cacheName(base, language) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${base}-${safe === '' ? 'default' : safe}.json`;
}
/** Resolve the doc target: primary when absent or already generated; else the AI variant. */
export async function resolveDocTarget(fs, root) {
    try {
        const primary = await fs.resolve(DOC_FILE, { cwd: root });
        const info = await fs.stat(primary);
        if (info !== undefined && info.type === 'file') {
            const text = await fs.readText(primary);
            if (text.includes(DOC_MARK))
                return primary.displayPath;
            // Hand-written primary (no marker): never touch it — the generated doc
            // lands in the AI variant (absolute display path).
            const ai = await fs.resolve(DOC_FILE_AI, { cwd: root });
            const aiInfo = await fs.stat(ai);
            return (aiInfo !== undefined && aiInfo.type === 'file' ? ai : await fs.resolve(DOC_FILE_AI, { cwd: root })).displayPath;
        }
    }
    catch {
        // primary absent → create it
    }
    return (await fs.resolve(DOC_FILE, { cwd: root })).displayPath;
}
/** Bounded summary lines of the code index for prompts (shared with flow.ts). */
export function indexSummary(index) {
    const lines = [];
    for (const pkg of index.packages.slice(0, 60)) {
        const entities = pkg.entities.filter(e => e.kind !== 'method' && e.kind !== 'field').slice(0, 8).map(e => e.name);
        lines.push(`- ${pkg.id}（${pkg.language}）依赖: ${pkg.deps.slice(0, 6).join(', ') || '无'}；顶层实体: ${entities.join(', ') || '无'}；入口: ${pkg.entryFiles.slice(0, 2).join(', ') || '无'}`);
    }
    return lines.join('\n');
}
/**
 * One LLM generation call with the standard config contract (shared with
 * flow.ts). The output cap is optional: omitted, the request inherits the
 * adapter's Config-owned default maxTokens instead of a local literal.
 */
export async function llmText(ctx, prompt, temperature, maxTokens) {
    const llm = ctx.get('llm');
    const defaultModel = ctx.get('agentDefaultModel');
    if (llm === undefined || defaultModel === undefined)
        throw new Error('llm or agentDefaultModel service missing');
    const selection = defaultModel.currentSelection();
    const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature, ...(maxTokens === undefined ? {} : { maxTokens }) });
    const cfg = prepared.config;
    let out = '';
    const chunkTypes = new Map();
    let finishInfo = '';
    for await (const chunk of prepared.stream({
        provider: cfg.provider, model: cfg.model,
        ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
        ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
        ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
        ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
        messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
    })) {
        chunkTypes.set(chunk.type, (chunkTypes.get(chunk.type) ?? 0) + 1);
        if (chunk.type === 'text-delta')
            out += chunk.text;
        if (chunk.type === 'finish') {
            finishInfo = JSON.stringify(chunk.reason);
            // An error finish (missing credential, quota, transport…) must surface
            // as a real error, never as a misleading "empty text" result.
            if (chunk.reason.kind === 'error' && chunk.reason.failure !== undefined) {
                throw new Error(`llm call failed: ${chunk.reason.failure.message}`);
            }
        }
    }
    const text = out.trim();
    if (text === '') {
        console.warn(`[arch-lens] llmText returned empty text (provider=${cfg.provider}, model=${cfg.model}, ` +
            `temperature=${cfg.temperature}, maxTokens=${cfg.maxTokens ?? 'default'}) ` +
            `chunks=${JSON.stringify([...chunkTypes])} finish=${finishInfo} — ` +
            'output budget may have been fully consumed by reasoning');
    }
    return text;
}
/** Build the LLM prompt for one doc section. */
function sectionPrompt(kind, index, language) {
    const summary = indexSummary(index);
    // The anti-fabrication clause: the generated doc is the ONLY source the
    // concept tree / figures later trust (extractDocTree verbatim), so the
    // model must not invent mechanisms that are not in the index summary —
    // e.g. "concept tree built by analyzing entity relations" describes a
    // pipeline that does not exist in this system.
    const antiFabrication = '所有内容必须只基于上面摘要中列出的包/依赖/实体/入口事实；禁止编造摘要中不存在的分析机制、流程步骤或数据关系（例如"系统通过分析X构建Y"这类摘要里没有的机制描述）。';
    const base = `你是代码架构文档作者。以下是某项目的代码索引摘要（包/依赖/实体/入口）。\n输出语言：${language}。\n不要输出代码块，直接输出 Markdown。\n${antiFabrication}\n\n项目摘要：\n${summary}\n\n`;
    switch (kind) {
        case 'concepts':
            return base + '请输出「## 概念层级」章节：归纳项目是怎么运作的核心概念（运行角色/机制，不要列包清单），层级小节（### 子节）。';
        case 'seq':
            return base + '请输出「## 时序」章节：描述【项目核心】的一次典型主流程的调用顺序（从用户输入/入口到输出/回复：谁→谁，什么顺序），用 Markdown 有序列表或 mermaid sequenceDiagram。';
        case 'interaction':
            return base + '请输出「## 核心交互」章节：列出核心事件/服务交互（生产者→事件→消费者），用 Markdown 列表或 mermaid。';
        case 'deps':
            return base + '请输出「## 依赖」章节：说明包/模块之间的依赖关系与分层，重点讲清楚谁依赖谁、为什么。';
        case 'er':
            return base + '请输出「## 实体关系」章节：列出核心类/接口实体及其关系（继承/实现/引用），用 Markdown 列表或 mermaid erDiagram。';
        case 'catalog':
            return base + '请输出「## 包目录职责」章节：为每个包写一行职责说明（简洁准确）。';
    }
}
/** Merge one section into the doc: drop EVERY existing section with exactly
 * this title, then append the fresh one.
 *
 * Why a line scan instead of a regex replace: the first attempt replaced only
 * the first occurrence (stale copies accumulated), and a regex with an end
 * lookahead (`(?=^## |$)`) terminates too early under `m` — `$` matches any
 * line end, so the non-greedy body stopped at the first blank line and only
 * the heading lines were removed, leaving the content behind. The line scan
 * is exact: a `## ` heading switches in/out of the dropped section, every
 * other line is kept verbatim. The model also tends to echo the requested
 * heading back in its output, so a leading `#+ <title>` line is stripped
 * before appending (otherwise every merge leaves an empty twin heading). */
function mergeSection(existing, title, sectionBody) {
    const header = `## ${title}`;
    const body = sectionBody.trim().replace(new RegExp(`^#{1,6}\\s+${title}\\s*\\n+`), '');
    const block = `${header}\n\n${body}\n\n`;
    const kept = [];
    let inTarget = false;
    for (const line of existing.split('\n')) {
        const isH2 = /^##\s/.test(line);
        if (isH2)
            inTarget = line.trimEnd() === header;
        if (!inTarget)
            kept.push(line);
    }
    return kept.join('\n').replace(/\s+$/, '\n\n') + block;
}
/** Write text to the doc target (create with marker when new). */
async function writeDoc(fs, targetPath, text, sandboxPolicy) {
    const target = await fs.resolve(targetPath);
    const info = await fs.stat(target).catch(() => undefined);
    const finalTarget = info !== undefined && info.type === 'file' ? target : await fs.resolve(targetPath);
    const existing = info !== undefined && info.type === 'file' ? await fs.readText(finalTarget) : '';
    const body = existing.includes(DOC_MARK) ? existing.replace(DOC_MARK, '').trim() : existing.trim();
    const next = `${DOC_MARK}\n\n${body === '' ? '' : `${body}\n\n`}${text.trim()}\n`;
    await fs.writeText(finalTarget, next, undefined, undefined, sandboxPolicy);
}
/**
 * Generate one doc section on demand (per-tab "AI generate"). Sequence and
 * interaction also write structured caches for their figures.
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param kind - section dimension.
 * @returns the doc target path, or an error.
 */
export async function generateDocSection(ctx, fs, root, index, language, kind, sandboxPolicy) {
    try {
        const title = SECTION_TITLES[kind];
        // No hard-coded maxTokens: inherit the adapter default. A local literal
        // (e.g. 2000) can be fully consumed by reasoning under high reasoning
        // levels, leaving zero output text.
        const text = await llmText(ctx, sectionPrompt(kind, index, language), 0.3);
        if (text === '')
            return { error: 'doc section generation returned empty text' };
        const targetPath = await resolveDocTarget(fs, root);
        const target = await fs.resolve(targetPath);
        const info = await fs.stat(target).catch(() => undefined);
        const existing = info !== undefined && info.type === 'file' ? await fs.readText(target) : '';
        await writeDoc(fs, targetPath, mergeSection(existing, title, text), sandboxPolicy);
        // Structured caches for the sequence/interaction figures.
        if (kind === 'seq' || kind === 'interaction') {
            await writeStructuredCache(ctx, fs, root, index, language, kind, sandboxPolicy);
        }
        return { path: targetPath };
    }
    catch (error) {
        return { error: `doc section failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
/**
 * Generate the complete architecture doc in one pass (global button).
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @returns the doc target path, or an error.
 */
export async function generateFullDocs(ctx, fs, root, index, language, sandboxPolicy) {
    try {
        const kinds = ['concepts', 'seq', 'interaction', 'deps', 'er', 'catalog'];
        const targetPath = await resolveDocTarget(fs, root);
        const target = await fs.resolve(targetPath);
        const info = await fs.stat(target).catch(() => undefined);
        let existing = info !== undefined && info.type === 'file' ? await fs.readText(target) : '';
        for (const kind of kinds) {
            const text = await llmText(ctx, sectionPrompt(kind, index, language), 0.3);
            if (text === '')
                continue;
            existing = mergeSection(existing, SECTION_TITLES[kind], text);
        }
        await writeDoc(fs, targetPath, existing, sandboxPolicy);
        if (await fs.stat(target).then(i => i?.type === 'file')) {
            // sequence/interaction structured caches for the figures
            await writeStructuredCache(ctx, fs, root, index, language, 'seq', sandboxPolicy);
            await writeStructuredCache(ctx, fs, root, index, language, 'interaction', sandboxPolicy);
        }
        return { path: targetPath };
    }
    catch (error) {
        return { error: `full docs failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
/**
 * Build the LLM induction prompt for the main-flow sequence figure: the
 * project-core main flow, entry → core loop → key capabilities → output.
 * The main line is pinned by name: entry packages (with entry files) start
 * the flow and the most-imported packages (in-degree over source imports)
 * form the core it must pass through. Every from/to must be a real package
 * id from the index summary (the anti-fabrication clause), so the figure
 * stays code-grounded.
 * @param index - code index result.
 * @param language - output language.
 * @returns the prompt text.
 */
export function seqInductionPrompt(index, language) {
    const entryIds = index.packages.filter(pkg => pkg.entryFiles.length > 0).slice(0, 8).map(pkg => pkg.id);
    const inDegree = new Map();
    for (const targets of importEdges(index).values()) {
        for (const target of targets)
            inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    }
    const coreIds = [...inDegree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
    const line = entryIds.length > 0 && coreIds.length > 0
        ? `主线约束：主线必须从这些入口包之一出发：${entryIds.join('、')}；并必须经过这些被依赖最多的核心包：${coreIds.join('、')}。其余包只能作为主线的前置/后续步骤出现；禁止以客户端 UI 包或测试包作为主线起点。\n`
        : '';
    return `你是代码时序分析师。根据项目摘要归纳【项目核心】的一次典型主流程的调用顺序。\n`
        + `输出语言：${language}。\n`
        + line
        + `结构要求：从入口包开始 → 核心循环/驱动（被依赖最多的包）→ 关键能力（工具/存储/LLM/会话等）→ 输出/回复结束；共 10-16 条。\n`
        + `硬性约束：每条消息的 "from" / "to" 只能是摘要中列出的包 id；"label" 写短动宾短语或「调用 xxx()」；只依据摘要事实，禁止编造摘要中不存在的包、机制或数据关系。\n`
        + `严格输出 JSON 数组：[{ "from": "...", "to": "...", "label": "..." }]，不要其他内容。\n\n${indexSummary(index)}`;
}
/**
 * Structured figure data for the sequence/interaction tabs, generated by LLM
 * from the code index and cached per language.
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param kind - 'seq' or 'interaction'.
 * @returns the parsed structured data, or an error.
 */
export async function writeStructuredCache(ctx, fs, root, index, language, kind, sandboxPolicy) {
    try {
        const prompt = kind === 'seq'
            ? seqInductionPrompt(index, language)
            : `你是代码交互分析师。根据项目摘要列出核心事件/交互。\n输出语言：${language}。\n严格输出 JSON 数组：[{ "event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..." }]（8-14 条），不要其他内容。\n\n${indexSummary(index)}`;
        const text = await llmText(ctx, prompt, 0.3);
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start < 0 || end <= start)
            return { error: 'structured generation returned no JSON array' };
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (!Array.isArray(parsed) || parsed.length === 0)
            return { error: 'structured generation returned an empty array' };
        const target = await fs.resolve(cacheName(kind === 'seq' ? SEQ_CACHE : EVENTS_CACHE, language), { cwd: root });
        await fs.writeText(target, JSON.stringify(parsed), undefined, undefined, sandboxPolicy);
        return parsed;
    }
    catch (error) {
        return { error: `structured cache failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
/**
 * Read the structured figure cache for a language, if present.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language.
 * @param kind - 'seq' or 'interaction'.
 * @returns the cached array, or null.
 */
export async function readStructuredCache(fs, root, language, kind) {
    try {
        const target = await fs.resolve(cacheName(kind === 'seq' ? SEQ_CACHE : EVENTS_CACHE, language), { cwd: root });
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return null;
        const parsed = JSON.parse(await fs.readText(target));
        return Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=docsgen.js.map