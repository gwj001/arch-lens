/**
 * Session-driven figure generation (「图生成走会话」): the panel asks the
 * BACKEND for a figure-generation PROMPT (with the code facts embedded), the
 * CLIENT sends it into the current session as a user message — the GUI's own
 * conversation stream then shows the agent working in real time (thinking,
 * code reading, output) with zero custom push plumbing. When the agent
 * answers, the backend's assistant/message listener matches the answer by a
 * unique figId, sanitizes the figure data and writes the same caches the
 * figure chains read, so a plain refetch renders the fresh figure.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/session-figure
 */
import { indexSummary, seqInductionPrompt } from "./docsgen.js";
import { FLOW_ANGLE_LABEL, flowAngleRule, flowAngleRules, sanitizeMermaid } from "./flow-angle.js";
import { buildProfileConceptTree, sanitizeCoreIds, sanitizeEvents, sanitizeFlow, sanitizeSeqMessages } from "./analysis.js";
/** Cache file base names (must mirror the chains' cache readers). */
const CACHE_BASE = {
    concepts: '.arch-lens-concept',
    seq: '.arch-lens-sequence',
    flow: '.arch-lens-flow',
    interaction: '.arch-lens-events',
    core: '.arch-lens-core',
};
/** Keep cache file names filesystem-safe (language + angle + method level). */
export function figureCacheName(kind, language, angle, methodLevel = false) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    const suffix = kind === 'flow' && angle !== undefined ? `-${angle}` : '';
    return `${CACHE_BASE[kind]}-${safe === '' ? 'default' : safe}${suffix}${methodLevel ? '-methods' : ''}.json`;
}
/** The JSON output contract the agent must satisfy (echoes the figId). */
function jsonContract(kind) {
    switch (kind) {
        case 'flow':
            return '{"figId": "<figId>", "title": "流程标题", "mermaid": "flowchart TD\\n..."}';
        case 'concepts':
            return '{"figId": "<figId>", "conceptTree": [{"name": "...", "desc": "...", "inside": "...", "children": []}]}';
        case 'seq':
            return '{"figId": "<figId>", "seqMessages": [{"from": "包id", "to": "包id", "label": "短动宾短语或 调用 xxx()"}]}';
        case 'interaction':
            return '{"figId": "<figId>", "events": [{"event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..."}]}';
        default:
            return '{"figId": "<figId>", "core": ["包id", "包id"]}';
    }
}
/**
 * Build the session message that asks the agent to produce ONE figure.
 * The code facts (index summary, entity- or method-level) are embedded so
 * the agent is grounded; it MAY read source files with its tools to verify,
 * but its final answer must be the strict JSON below (echoing the figId).
 * @param kind - the figure kind.
 * @param index - code index result (fact source).
 * @param language - role language.
 * @param figId - unique marker the answer must echo.
 * @param angle - flow viewpoint (flow only).
 * @param methodLevel - 🔬 method-level summary (methods + call edges).
 * @returns the user-message text.
 */
export function buildFigurePrompt(kind, index, language, figId, angle, methodLevel = false) {
    const angleRule = kind === 'flow' && angle !== undefined ? flowAngleRule(angle) : '';
    const styleRules = kind === 'flow' ? flowAngleRules(angle ?? 'event') : '';
    const methodRule = methodLevel
        ? '- 已开启🔬方法级：节点/消息尽量引用真实方法名与文件（如 `Svc.handle（api.ts:41）`），只使用摘要中列出的方法名与调用边；\n'
        : '';
    const summary = indexSummary(index, { fields: { deps: false }, methods: methodLevel });
    const mission = (() => {
        switch (kind) {
            case 'flow':
                return `请以「${FLOW_ANGLE_LABEL[angle ?? 'event']}」视角生成一张可学习的核心流程图。`;
            case 'concepts':
                return '请归纳这个项目「是怎么运作的」：识别运行核心概念（入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳），组织成概念层级树。';
            case 'seq':
                return '请归纳【项目核心】的一次典型主流程的调用顺序。';
            case 'interaction':
                return '请列出这个项目的核心事件/交互。';
            default:
                return '请从摘要中选出构成这个项目核心流程的 4-25 个核心包 id（启动、请求处理、主循环涉及的关键包）。';
        }
    })();
    return `你是代码架构分析师。请为当前工作区生成一张架构图（这是 Arch Lens 学习台的「🤖 AI 生成」请求，figId=${figId}）。\n`
        + `你可以使用工作区工具读源码核实事实，但最终回答必须且只能是一个 JSON 对象，格式：${jsonContract(kind)}（把 figId 原样填成 ${figId}），不要输出任何解释、代码块围栏或额外文字。\n`
        + mission + '\n'
        + (kind === 'flow' ? `${angleRule}\n${styleRules}\n` : '')
        + (kind === 'seq' ? seqInductionPrompt(index, language, summary) : '')
        + methodRule
        + (kind !== 'seq' ? `输出语言：${language}。\n\n项目摘要：\n${summary}` : '');
}
/**
 * Find the answer's JSON object that carries the expected figId. Tolerates
 * prose, fenced ```json blocks and multiple JSON candidates (scans the last
 * balanced brace groups first).
 * @param answer - the assistant's full answer text.
 * @param figId - the expected marker.
 * @returns the parsed object, or null.
 */
export function extractFigureJson(answer, figId) {
    const fenced = /```(?:json)?\s*\n([\s\S]*?)```/g;
    const candidates = [];
    let match;
    while ((match = fenced.exec(answer)) !== null)
        candidates.push(match[1]);
    candidates.push(answer);
    for (const text of candidates) {
        const parsed = extractBalancedJson(text, figId);
        if (parsed !== null)
            return parsed;
    }
    return null;
}
/** Scan `{` positions from the end; balance braces; accept the object whose
 * figId matches (nested trees parse correctly thanks to brace balancing). */
function extractBalancedJson(text, figId) {
    const starts = [];
    for (let i = text.lastIndexOf('{'); i >= 0; i = text.lastIndexOf('{', i - 1)) {
        starts.push(i);
        if (starts.length >= 8)
            break;
    }
    for (const start of starts) {
        let depth = 0;
        let end = -1;
        for (let i = start; i < text.length; i += 1) {
            const ch = text[i];
            if (ch === '{')
                depth += 1;
            else if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        if (end < 0)
            continue;
        try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (typeof parsed === 'object' && parsed !== null
                && parsed.figId === figId) {
                return parsed;
            }
        }
        catch {
            // keep scanning earlier candidates
        }
    }
    return null;
}
/**
 * Sanitize the parsed answer into the figure's cache shape and persist it to
 * the same file the chain reads, so a plain refetch renders the fresh figure.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (id validation for seq/core answers).
 * @param kind - the figure kind.
 * @param parsed - the answer JSON (figId matched already).
 * @param language - role language.
 * @param angle - flow viewpoint (flow only).
 * @param methodLevel - cache suffix.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns `{ ok: true }` or `{ error }`.
 */
export async function writeFigureCache(fs, root, index, kind, parsed, language, angle, methodLevel = false, sandboxPolicy) {
    let value;
    if (kind === 'flow') {
        const flow = sanitizeFlow(parsed, angle ?? 'event');
        if (flow === undefined)
            return { error: 'flow answer did not parse into a diagram' };
        value = { title: flow.title, source: 'flow', angle: flow.angle, mermaid: sanitizeMermaid(flow.mermaid) };
    }
    else if (kind === 'concepts') {
        const tree = buildProfileConceptTree(parsed.conceptTree, 'session-figure');
        if (tree.length === 0)
            return { error: 'concept answer produced no tree' };
        value = tree;
    }
    else if (kind === 'seq') {
        const messages = sanitizeSeqMessages(parsed.seqMessages, index.packages.map(pkg => pkg.id));
        if (messages.length === 0)
            return { error: 'seq answer produced no messages' };
        value = { source: 'flow', messages };
    }
    else if (kind === 'interaction') {
        const events = sanitizeEvents(parsed.events);
        if (events.length === 0)
            return { error: 'events answer produced no events' };
        value = events;
    }
    else {
        const ids = sanitizeCoreIds(index, parsed.core);
        if (ids.length === 0)
            return { error: 'core answer produced no ids' };
        value = { ids, source: 'flow' };
    }
    try {
        const target = await fs.resolve(figureCacheName(kind, language, angle, methodLevel), { cwd: root });
        await fs.writeText(target, JSON.stringify(value), undefined, undefined, sandboxPolicy);
        return { ok: true };
    }
    catch (error) {
        return { error: `figure cache write failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
//# sourceMappingURL=session-figure.js.map