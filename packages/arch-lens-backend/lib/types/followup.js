/**
 * 原地追问重画（figureFollowUp）：对某一个 tab 的主图做一次带追问上下文的
 * 重画——读现有图 → LLM 基于「现有图 + 用户追问」重新生成（同一 JSON 契约）
 * → 覆写同一缓存文件 → 返回新图数据。客户端拿到结果直接回填该 tab 的状态，
 * 图就"原地"更新了，不画到别的地方。
 * @module @deepseek-ai/dsh-arch-lens-backend/src/followup
 */
import { readFactVersion, readVersionedCache, writeVersionedCache } from "./fact-cache.js";
import { specCacheName, writeFigure } from "./figures.js";
import { indexSummary, llmText } from "./docsgen.js";
import { coreFlowchart } from "./mermaid.js";
import { dynamicFigureCacheName, extractDynamicDiagram } from "./session-figure.js";
/** Follow-up entity kind → the registry entity id ('overview' is a dynamic
 * drill-down figure, not a registered entity figure). */
function followUpEntityKind(kind, angle) {
    switch (kind) {
        case 'flow':
            return angle === 'pipeline' ? 'flow-pipeline' : 'flow-event';
        case 'seq':
            return 'seq';
        case 'concepts':
            return 'concepts';
        case 'events':
            return 'interaction';
        case 'core':
            return 'core';
        default:
            return null;
    }
}
/** Read a versioned cache file; null when absent/stale/unreadable. */
async function readCache(fs, root, name) {
    try {
        const target = await fs.resolve(name, { cwd: root });
        const factsVersion = await readFactVersion(fs, root);
        return await readVersionedCache(fs, target, factsVersion);
    }
    catch {
        return null;
    }
}
/** Write an ENTITY figure cache through the unified registry entry, keeping
 * the follow-up's historical non-fatal write discipline (a persistence failure
 * must not discard the freshly drawn figure for this session turn).
 * v = facts version re-read at write time (same stamping as before). */
async function writeEntityFigure(fs, root, kind, language, data, options) {
    try {
        const factsVersion = await readFactVersion(fs, root);
        await writeFigure(fs, root, kind, language, factsVersion, data, options);
    }
    catch {
        // cache write failures are non-fatal (unchanged)
    }
}
/** Write a DYNAMIC (overview) cache file, non-fatal (until stage 3 unifies it).
 * @param fs - filesystem service. @param root - workspace root. @param name - cache file name.
 * @param value - the figure payload. @param sandboxPolicy - session policy. */
async function writeDynamicCache(fs, root, name, value, sandboxPolicy) {
    try {
        const target = await fs.resolve(name, { cwd: root });
        const factsVersion = await readFactVersion(fs, root);
        await writeVersionedCache(fs, target, value, factsVersion, sandboxPolicy);
    }
    catch {
        // cache write failures are non-fatal
    }
}
/** The existing figure of one kind, rendered as prompt context text. */
async function existingText(fs, root, kind, language, angle, methods) {
    try {
        const entityKind = followUpEntityKind(kind, angle);
        const name = entityKind !== null
            ? specCacheName(entityKind, language, methods)
            : dynamicFigureCacheName('overview', 'overview:all', language);
        switch (kind) {
            case 'flow': {
                const cached = await readCache(fs, root, name);
                return cached !== null && typeof cached.mermaid === 'string'
                    ? `标题：${cached.title ?? ''}\n现有图（mermaid）：\n${cached.mermaid}`
                    : '';
            }
            case 'seq': {
                const cached = await readCache(fs, root, name);
                return cached !== null ? `现有时序消息（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : '';
            }
            case 'concepts': {
                const cached = await readCache(fs, root, name);
                return cached !== null ? `现有概念树（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : '';
            }
            case 'events': {
                const cached = await readCache(fs, root, name);
                return cached !== null ? `现有核心交互（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : '';
            }
            case 'core': {
                const cached = await readCache(fs, root, name);
                return cached !== null && Array.isArray(cached.ids) ? `现有核心包：${cached.ids.join('、')}` : '';
            }
            case 'overview': {
                const cached = await readCache(fs, root, name);
                return cached !== null && typeof cached.diagram === 'string'
                    ? `标题：${typeof cached.title === 'string' ? cached.title : ''}\n现有总览图（mermaid）：\n${cached.diagram}`
                    : '';
            }
        }
    }
    catch {
        return '';
    }
}
/** Per-kind JSON contract appended to every follow-up prompt. */
function contractOf(kind) {
    switch (kind) {
        case 'flow':
            return '严格输出 JSON：{"title": "流程标题", "mermaid": "flowchart TD\\n..."}（mermaid 为完整 flowchart 源码，不要代码块围栏），不要输出其他内容。';
        case 'seq':
            return '严格输出 JSON 数组：[{ "from": "包id", "to": "包id", "label": "短动宾短语或 调用 xxx()" }]（10-16 条，from/to 只能是摘要中的包 id），不要输出其他内容。';
        case 'concepts':
            return '严格输出 JSON 数组：[{ "name": "概念名", "desc": "一句话", "inside": "一句话", "children": [] }]（层级小节），不要输出其他内容。';
        case 'events':
            return '严格输出 JSON 数组：[{ "event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..." }]（8-14 条），不要输出其他内容。';
        case 'core':
            return '严格输出 JSON：{"core": ["包id", ...]}（4-25 个核心包 id，只能是摘要中的包 id），不要输出其他内容。';
        default:
            return '严格输出 JSON：{"title": "简短标题", "diagram": "flowchart TD\\n..."}（架构总览图），不要输出其他内容。';
    }
}
/** Build the follow-up prompt: summary + existing figure + user's ask + contract. */
function followUpPrompt(kind, language, followUp, summary, existing) {
    const base = `你是代码架构分析师。以下是某项目的代码索引摘要（包/依赖/实体/入口）。\n输出语言：${language}。\n只依据摘要事实作答；源码中没有证据的环节必须在图上标注【推断】。\n\n项目摘要：\n${summary}\n\n`;
    const existingBlock = existing !== ''
        ? `该图已有以下版本（保持同一场景，在现有图上扩展/重画细节）：\n${existing}\n\n`
        : '';
    const ask = `用户对现有图提出追问/扩展要求：${followUp}\n请基于现有图重画或扩展细节。\n`;
    return base + existingBlock + ask + contractOf(kind);
}
/** Pull the first {...} object out of a model answer, tolerating prose. */
function extractJson(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        const value = JSON.parse(text.slice(start, end + 1));
        return typeof value === 'object' && value !== null ? value : null;
    }
    catch {
        return null;
    }
}
/** Pull the first [...] array out of a model answer; null when empty. */
function extractArray(text) {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start)
        return null;
    try {
        const value = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(value) && value.length > 0 ? value : null;
    }
    catch {
        return null;
    }
}
/** Validate and bound the LLM's core ids against the indexed packages. */
function validateCoreIds(index, raw) {
    if (!Array.isArray(raw))
        return [];
    const known = new Set(index.packages.map(pkg => pkg.id));
    const ids = [];
    for (const item of raw) {
        if (typeof item !== 'string')
            continue;
        if (!known.has(item))
            continue;
        if (ids.includes(item))
            continue;
        ids.push(item);
        if (ids.length >= 25)
            break;
    }
    return ids;
}
/** Strip fences / stray prose from a mermaid answer; '' when no diagram. */
function cleanMermaid(out) {
    const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
    if (fenced !== null)
        return fenced[1].trim();
    const idx = out.search(/\b(?:flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|journey|gantt)\b/);
    if (idx < 0)
        return '';
    return out.slice(idx).trim().replace(/```\s*$/, '').trim();
}
/**
 * In-place follow-up redraw for ONE tab figure. Reads the existing figure,
 * asks the LLM to extend/redraw it with the follow-up, overwrites the SAME
 * cache, and returns the new figure (same contract as the tab's RPC).
 * @param request - figure kind, role language, viewpoint (flow), method-level
 *   switch, and the user's follow-up instruction.
 * @param signal - optional cancellation: aborting it stops the LLM stream
 *   promptly (the panel's「取消」button while a redraw is running).
 * @returns the new figure data, or an error.
 */
export async function figureFollowUp(ctx, fs, root, index, request, sandboxPolicy, signal) {
    const { kind, language } = request;
    const methods = request.methodLevel === true;
    const angle = request.angle ?? 'event';
    try {
        const summary = indexSummary(index, { fields: { deps: false }, methods });
        const existing = await existingText(fs, root, kind, language, angle, methods);
        const text = await llmText(ctx, root, followUpPrompt(kind, language, request.followUp, summary, existing), 0.3, undefined, `followup-${kind}`, signal);
        if (text === '')
            return { error: 'follow-up generation returned empty text' };
        switch (kind) {
            case 'flow': {
                const parsed = extractJson(text);
                if (parsed === null || typeof parsed.mermaid !== 'string')
                    return { error: 'flow follow-up did not parse into a diagram' };
                const mermaid = cleanMermaid(parsed.mermaid);
                if (mermaid === '')
                    return { error: 'flow follow-up produced no mermaid' };
                const result = {
                    title: typeof parsed.title === 'string' && parsed.title !== '' ? parsed.title.slice(0, 60) : '核心流程',
                    source: 'flow',
                    angle,
                    mermaid,
                };
                await writeEntityFigure(fs, root, angle === 'pipeline' ? 'flow-pipeline' : 'flow-event', language, result, { index, methods, policy: sandboxPolicy });
                return result;
            }
            case 'seq': {
                const messages = extractArray(text);
                if (messages === null)
                    return { error: 'seq follow-up produced no messages' };
                // 写侧统一 { source, messages } 形态（裸数组兼容读仍在 readSeqCache）。
                const result = { messages: messages, source: 'flow' };
                await writeEntityFigure(fs, root, 'seq', language, result, { methods, policy: sandboxPolicy });
                return result;
            }
            case 'concepts': {
                const tree = extractArray(text);
                if (tree === null)
                    return { error: 'concepts follow-up produced no tree' };
                await writeEntityFigure(fs, root, 'concepts', language, tree, { index, methods, policy: sandboxPolicy });
                return tree;
            }
            case 'events': {
                const events = extractArray(text);
                if (events === null)
                    return { error: 'events follow-up produced no events' };
                await writeEntityFigure(fs, root, 'interaction', language, events, { index, methods, policy: sandboxPolicy });
                return events;
            }
            case 'core': {
                const parsed = extractJson(text);
                const ids = validateCoreIds(index, parsed?.core);
                if (ids.length < 4)
                    return { error: 'core follow-up produced no valid package ids' };
                const core = { ids, source: 'flow' };
                await writeEntityFigure(fs, root, 'core', language, core, { methods, policy: sandboxPolicy });
                return { kind: 'flowchart', source: coreFlowchart(index, ids), core };
            }
            case 'overview': {
                const parsed = extractJson(text);
                const value = parsed !== null ? extractDynamicDiagram(parsed) : undefined;
                if (value === undefined)
                    return { error: 'overview follow-up did not parse into a diagram' };
                const targetKey = 'overview:all';
                await writeDynamicCache(fs, root, dynamicFigureCacheName('overview', targetKey, language), { ...value, source: 'flow', kind: 'overview', targetKey }, sandboxPolicy);
                return { ...value, kind: 'overview', targetKey };
            }
        }
    }
    catch (error) {
        return { error: `follow-up failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
//# sourceMappingURL=followup.js.map