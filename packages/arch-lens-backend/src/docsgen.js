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
    for await (const chunk of prepared.stream({
        provider: cfg.provider, model: cfg.model,
        ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
        ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
        ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
        ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
        messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
    })) {
        if (chunk.type === 'text-delta')
            out += chunk.text;
    }
    return out.trim();
}
/** Build the LLM prompt for one doc section. */
function sectionPrompt(kind, index, language) {
    const summary = indexSummary(index);
    const base = `你是代码架构文档作者。以下是某项目的代码索引摘要（包/依赖/实体/入口）。\n输出语言：${language}。\n不要输出代码块，直接输出 Markdown。\n\n项目摘要：\n${summary}\n\n`;
    switch (kind) {
        case 'concepts':
            return base + '请输出「## 概念层级」章节：归纳项目是怎么运作的核心概念（运行角色/机制，不要列包清单），层级小节（### 子节）。';
        case 'seq':
            return base + '请输出「## 时序」章节：描述一次典型主流程的调用顺序（谁→谁，什么顺序），用 Markdown 有序列表或 mermaid sequenceDiagram。';
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
/** Merge one section into the doc: replace the same-titled section or append. */
function mergeSection(existing, title, sectionBody) {
    const header = `## ${title}`;
    const pattern = new RegExp(`## ${title}\\s*[\\s\\S]*?(?=^## |\\z)`, 'm');
    const block = `${header}\n\n${sectionBody.trim()}\n\n`;
    if (pattern.test(existing))
        return existing.replace(pattern, block);
    return existing.replace(/\s*\z/, '\n\n') + block;
}
/** Write text to the doc target (create with marker when new). */
async function writeDoc(fs, targetPath, text) {
    const target = await fs.resolve(targetPath);
    const info = await fs.stat(target).catch(() => undefined);
    const finalTarget = info !== undefined && info.type === 'file' ? target : await fs.resolve(targetPath);
    const existing = info !== undefined && info.type === 'file' ? await fs.readText(finalTarget) : '';
    const body = existing.includes(DOC_MARK) ? existing.replace(DOC_MARK, '').trim() : existing.trim();
    const next = `${DOC_MARK}\n\n${body === '' ? '' : `${body}\n\n`}${text.trim()}\n`;
    await fs.writeText(finalTarget, next);
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
export async function generateDocSection(ctx, fs, root, index, language, kind) {
    try {
        const title = SECTION_TITLES[kind];
        const text = await llmText(ctx, sectionPrompt(kind, index, language), 0.3, 2000);
        if (text === '')
            return { error: 'doc section generation returned empty text' };
        const targetPath = await resolveDocTarget(fs, root);
        const target = await fs.resolve(targetPath);
        const info = await fs.stat(target).catch(() => undefined);
        const existing = info !== undefined && info.type === 'file' ? await fs.readText(target) : '';
        await writeDoc(fs, targetPath, mergeSection(existing, title, text));
        // Structured caches for the sequence/interaction figures.
        if (kind === 'seq' || kind === 'interaction') {
            await writeStructuredCache(ctx, fs, root, index, language, kind);
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
export async function generateFullDocs(ctx, fs, root, index, language) {
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
        await writeDoc(fs, targetPath, existing);
        if (await fs.stat(target).then(i => i?.type === 'file')) {
            // sequence/interaction structured caches for the figures
            await writeStructuredCache(ctx, fs, root, index, language, 'seq');
            await writeStructuredCache(ctx, fs, root, index, language, 'interaction');
        }
        return { path: targetPath };
    }
    catch (error) {
        return { error: `full docs failed: ${error instanceof Error ? error.message : String(error)}` };
    }
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
export async function writeStructuredCache(ctx, fs, root, index, language, kind) {
    try {
        const prompt = kind === 'seq'
            ? `你是代码时序分析师。根据项目摘要归纳一次典型主流程的消息流。\n输出语言：${language}。\n严格输出 JSON 数组：[{ "from": "...", "to": "...", "label": "..." }]（10-16 条），不要其他内容。\n\n${indexSummary(index)}`
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
        await fs.writeText(target, JSON.stringify(parsed));
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