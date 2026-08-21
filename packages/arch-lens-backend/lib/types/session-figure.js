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
/**
 * Stable djb2 hash → filesystem-safe suffix. The CLIENT keeps a local mirror
 * (arch-view.tsx) so hover caches line up between panel and backend.
 * @param text - the string to hash.
 * @returns a base-36 string of the unsigned 32-bit hash.
 */
export function hashString(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}
/**
 * Serialize one dynamic-figure target into a stable key (the client mirror
 * must produce the same string, so the same cache file is hit).
 * @param kind - the dynamic figure kind.
 * @param target - the hovered element: seq-edge → from/to/label, flow-subgraph → stage.
 * @returns the target key (embedded in cache names).
 */
export function dynamicTargetKey(kind, target) {
    return kind === 'seq-edge'
        ? `seq:${target.from ?? ''}|${target.to ?? ''}|${target.label ?? ''}`
        : `flow:${target.stage ?? ''}`;
}
/** Cache file for one dynamic figure: `.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`. */
export function dynamicFigureCacheName(kind, targetKey, language) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `.arch-lens-dynamic-${kind}-${hashString(targetKey)}-${safe === '' ? 'default' : safe}.json`;
}
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
/** Accept the JSON object whose figId matches. A whole-text parse is tried
 * first (the prompt demands a pure JSON answer — the common shape), then
 * every `{` position is scanned from the end with brace balancing (nested
 * trees and prose-wrapped objects parse correctly). The cap only bounds
 * pathological answers; a real figure answer with a dozen inner objects
 * must still reach its outer `{` (regression: the old 8-start cap silently
 * skipped the outer object of answers with >8 inner objects). */
function extractBalancedJson(text, figId) {
    const whole = text.trim();
    if (whole.startsWith('{') && whole.endsWith('}')) {
        try {
            const parsed = JSON.parse(whole);
            if (typeof parsed === 'object' && parsed !== null
                && parsed.figId === figId) {
                return parsed;
            }
        }
        catch {
            // not a whole-text JSON object — fall through to start scanning
        }
    }
    const starts = [];
    for (let i = text.lastIndexOf('{'); i >= 0 && starts.length < 256; i = text.lastIndexOf('{', i - 1)) {
        starts.push(i);
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
/* ---------------------------------------------------------------------------
 * DYNAMIC figures (hover drill-down): a small detail diagram for ONE
 * sequence edge or ONE flow subgraph, generated as a session turn and
 * cached per target (`.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`) so
 * the panel opens it instantly on later hovers.
 * ------------------------------------------------------------------------- */
/** The JSON output contract the agent must satisfy for a dynamic figure. */
function dynamicJsonContract(kind) {
    return kind === 'seq-edge'
        ? '{"figId": "<figId>", "title": "简短标题", "diagram": "sequenceDiagram\\n  participant A as ...\\n  A->>B: ..."}'
        : '{"figId": "<figId>", "title": "简短标题", "diagram": "flowchart TD\\n  A --> B"}';
}
/** The package's absolute path prefix (with trailing separator, `/` separators
 * normalized), used to attribute real call edges to a package id. fromFile is
 * ABSOLUTE with `/` separators (e.g. `D:/.../packages/arch-lens-backend/src/
 * abort.ts`), while pkg.path keeps the platform's native separators — on
 * Windows that is BACKSLASHES, so the prefix must be normalized or every
 * startsWith() silently misses (regression: drill-down facts claimed "no call
 * edges" even when the index had plenty). */
function pkgPathPrefix(index, id) {
    const pkg = index.packages.find(candidate => candidate.id === id);
    if (pkg === undefined)
        return '';
    const normalized = pkg.path.replace(/\\/g, '/');
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
}
/** The hovered edge's TWO packages' method lines + ONLY the call edges the
 * label actually mentions. Token discipline: the whole point of a drill-down
 * is "give the LLM the necessary facts" — the summary is two short method
 * lines (class{methods}, no entity lists, no absolute entry paths), and the
 * edge list is filtered to symbols named in the hovered label (from/to ===
 * symbol, capped at 20, package-relative paths). Only when the label carries
 * no symbols (e.g. pure-Chinese labels) does it fall back to the two
 * packages' own edges, capped tighter (15). */
function seqEdgeFacts(index, target) {
    const ids = [target.from, target.to].filter((id) => typeof id === 'string' && id !== '');
    const summary = ids.map(id => pkgMethodLine(index, id)).filter(line => line !== '').join('\n');
    const symbols = symbolTokens(target.label ?? '');
    const prefixes = ids.map(id => pkgPathPrefix(index, id)).filter(prefix => prefix !== '');
    const bySymbol = symbols.length > 0
        ? (index.calls ?? [])
            .filter(edge => symbols.some(symbol => edge.from === symbol || edge.to === symbol))
            .slice(0, 20)
            .map(edge => edgeToString(edge, prefixes))
        : [];
    const edges = bySymbol.length > 0 ? bySymbol : packageEdges(index, ids, 15);
    return `涉及包的类方法（供引用真实方法名）：\n${summary}\n\n相关真实调用边（含调用点文件行号）：\n${edges.length > 0 ? edges.join('\n') : '（无调用边记录——只能基于摘要推断，请标注【推断】）'}`;
}
/** One short method line per package: `- id（lang）方法：Class{a, b}…`. */
function pkgMethodLine(index, id) {
    const pkg = index.packages.find(candidate => candidate.id === id);
    if (pkg === undefined)
        return '';
    const methodLines = [];
    for (const entity of pkg.entities) {
        if (entity.kind === 'class' && Array.isArray(entity.children)) {
            const methods = entity.children
                .filter(child => child.kind === 'method' || child.kind === 'function')
                .slice(0, 6)
                .map(child => child.name);
            if (methods.length > 0)
                methodLines.push(`${entity.name}{${methods.join(', ')}}`);
            if (methodLines.length >= 6)
                break;
        }
    }
    return `- ${id}（${pkg.language}）方法：${methodLines.length > 0 ? methodLines.join('；') : '（无类方法记录）'}`;
}
/** English-ish symbols (length ≥ 3) mentioned in the hovered edge label. */
function symbolTokens(label) {
    const tokens = label.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [];
    const stop = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'call', 'calls', 'via', 'via', 'using', 'this', 'that']);
    return [...new Set(tokens.filter(token => !stop.has(token.toLowerCase())))];
}
/** One edge line with a package-relative path: `from → to（src/abort.ts:45）`. */
function edgeToString(edge, prefixes) {
    const prefix = prefixes.find(candidate => edge.fromFile.startsWith(candidate)) ?? '';
    const rel = edge.fromFile.slice(prefix.length);
    return `- ${edge.from ?? '?'} → ${edge.to}（${rel}${edge.line !== undefined ? `:${edge.line}` : ''}）`;
}
/** The two packages' own call edges, package-relative paths, tight cap. */
function packageEdges(index, ids, cap) {
    const prefixes = ids.map(id => pkgPathPrefix(index, id)).filter(prefix => prefix !== '');
    return (index.calls ?? [])
        .filter(edge => prefixes.some(prefix => edge.fromFile.startsWith(prefix)))
        .slice(0, cap)
        .map(edge => edgeToString(edge, prefixes));
}
/**
 * Build the session message that asks the agent to draw ONE dynamic detail
 * figure. Facts are embedded (the hovered edge's two packages with their
 * method-level summary + real call edges, or the flow subgraph's source
 * block + the code summary); the answer must be the strict JSON below.
 * @param kind - seq-edge (edge drill-down) or flow-subgraph (stage expansion).
 * @param index - code index result (fact source).
 * @param language - role language.
 * @param figId - unique marker the answer must echo.
 * @param target - the hovered element (from/to/label or stage).
 * @param mermaidSource - the current flow diagram source (flow-subgraph only).
 * @returns the user-message text.
 */
export function buildDynamicFigurePrompt(kind, index, language, figId, target, mermaidSource) {
    const mission = kind === 'seq-edge'
        ? `主流程时序中有一条消息 ${target.from ?? '?'} → ${target.to ?? '?'}（${target.label ?? ''}）。请钻取这两个包之间的【方法级调用时序】，输出 mermaid sequenceDiagram（参与者用包 id；消息 label 尽量引用真实方法名与文件，如 \`Svc.handle（api.ts:41）\`；只使用下面摘要/调用边中的事实）。`
        : `当前流程图中有一个阶段子块「${target.stage ?? '?'}」。请展开该子块，生成一张更详细的 flowchart 图：保留子块内的节点与边，补充子块内部的步骤细节（仅基于代码事实；源码中没有证据的环节必须标注【推断】）。`;
    const context = kind === 'seq-edge'
        ? seqEdgeFacts(index, target)
        : flowSubgraphFacts(index, mermaidSource ?? '', target.stage ?? '');
    return `你是代码架构分析师。请为当前工作区生成一张【动态细节图】（这是 Arch Lens 学习台的「动态画图」请求，figId=${figId}）。\n`
        + `你可以使用工作区工具读源码核实事实，但最终回答必须且只能是一个 JSON 对象，格式：${dynamicJsonContract(kind)}（把 figId 原样填成 ${figId}），不要输出任何解释、代码块围栏或额外文字。\n`
        + mission + '\n'
        + `输出语言：${language}。\n\n${context}`;
}
/** Facts for a flow-subgraph expansion: the hovered subgraph block itself,
 * the OTHER stage titles (where it sits in the overall flow), the edges that
 * touch its nodes (cross-stage handoffs included), and a broader code
 * summary — a stage expansion needs more context than an edge drill-down. */
function flowSubgraphFacts(index, source, stage) {
    const block = extractSubgraphBlock(source, stage);
    const titles = subgraphTitles(source).filter(title => title !== stage);
    const touching = edgesTouching(source, nodeIdsInBlock(block), 15);
    return `当前流程图源中的子块（只展开「${stage}」子块，不要重画整图）：\n\`\`\`mermaid\n${block}\n\`\`\`\n`
        + `流程图中的其他阶段（供定位该子块在整体流程中的位置）：\n${titles.length > 0 ? titles.map(title => `- ${title}`).join('\n') : '（无其他阶段）'}\n`
        + `与子块节点相连的边（含跨阶段衔接）：\n${touching.length > 0 ? touching.join('\n') : '（子块内无边）'}\n`
        + `代码摘要（供核实子块内的包/实体）：\n${indexSummary(index, { fields: { deps: false }, maxPackages: 40 })}`;
}
/** All subgraph titles in a flowchart source, in order, quotes stripped. */
function subgraphTitles(source) {
    const titles = [];
    for (const line of source.split('\n')) {
        const m = /^\s*subgraph\s+(.+?)\s*$/.exec(line);
        if (m !== null)
            titles.push(m[1].trim().replace(/["']/g, ''));
    }
    return titles;
}
/** Node ids appearing in a subgraph block (edge endpoints + definitions). */
function nodeIdsInBlock(block) {
    const ids = new Set();
    for (const line of block.split('\n')) {
        for (const m of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:-->|==>|\.->)/g))
            ids.add(m[1]);
        for (const m of line.matchAll(/(?:-->|==>|\.->)\s*([A-Za-z_][A-Za-z0-9_]*)/g))
            ids.add(m[1]);
    }
    return ids;
}
/** Edges of the whole diagram that touch the given node ids, capped. */
function edgesTouching(source, ids, cap) {
    const out = [];
    for (const line of source.split('\n')) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:-->|==>|\.->)\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
        if (m !== null && (ids.has(m[1]) || ids.has(m[2])))
            out.push(line.trim());
        if (out.length >= cap)
            break;
    }
    return out;
}
/** Extract ONE subgraph block (matched by title, quotes stripped) from a
 * flowchart source; falls back to the whole source when the block cannot be
 * isolated. Keeps the drill-down prompt small — only the hovered stage's
 * nodes/edges are embedded, not the entire diagram. */
function extractSubgraphBlock(source, stage) {
    if (stage === '')
        return source;
    const wanted = stage.trim().replace(/["']/g, '');
    const lines = source.split('\n');
    const start = lines.findIndex(line => {
        const m = /^\s*subgraph\s+(.+?)\s*$/.exec(line);
        return m !== null && m[1].trim().replace(/["']/g, '') === wanted;
    });
    if (start < 0)
        return source;
    let depth = 0;
    for (let i = start; i < lines.length; i += 1) {
        if (/^\s*subgraph\b/.test(lines[i]))
            depth += 1;
        else if (/^\s*end\s*$/.test(lines[i])) {
            depth -= 1;
            if (depth === 0)
                return lines.slice(start, i + 1).join('\n');
        }
    }
    return source;
}
/** Extract the diagram body from a dynamic answer ({title?, diagram}): strips
 * fences and stray prose, keeps the first diagram statement, repairs edge
 * labels. @returns the clean value, or undefined when unusable. */
export function extractDynamicDiagram(parsed) {
    const record = parsed;
    if (typeof record.diagram !== 'string')
        return undefined;
    const diagram = extractDiagramText(record.diagram);
    if (diagram === '')
        return undefined;
    return {
        title: typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim().slice(0, 60) : '动态细节图',
        diagram,
    };
}
/** Strip fences / trailing prose from a diagram answer; '' when no diagram. */
function extractDiagramText(out) {
    const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
    if (fenced !== null)
        return sanitizeMermaid(fenced[1].trim());
    const idx = out.search(/\b(?:flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|journey|gantt)\b/);
    if (idx < 0)
        return '';
    return sanitizeMermaid(out.slice(idx).trim().replace(/```\s*$/, '').trim());
}
/**
 * Persist one dynamic figure to its per-target cache file.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param kind - the dynamic figure kind.
 * @param targetKey - the serialized hover target (cache identity).
 * @param parsed - the answer JSON (figId matched already).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns `{ ok: true }` or `{ error }`.
 */
export async function writeDynamicFigureCache(fs, root, kind, targetKey, parsed, language, sandboxPolicy) {
    const value = extractDynamicDiagram(parsed);
    if (value === undefined)
        return { error: 'dynamic answer did not parse into a diagram' };
    try {
        const target = await fs.resolve(dynamicFigureCacheName(kind, targetKey, language), { cwd: root });
        await fs.writeText(target, JSON.stringify({ ...value, source: 'flow', kind, targetKey }), undefined, undefined, sandboxPolicy);
        return { ok: true };
    }
    catch (error) {
        return { error: `dynamic figure cache write failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
//# sourceMappingURL=session-figure.js.map