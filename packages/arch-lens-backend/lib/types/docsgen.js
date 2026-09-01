/**
 * Shared doc/LLM plumbing for the Arch Lens backend: the bounded index
 * summary, the streaming `llmText` call (usage accounting + live status),
 * the structured seq/interaction induction, and the seq induction prompt.
 * Doc generation (V1 chapter write path) lives in docchapter.ts; the old
 * zero-LLM assembly chain (docbuild.ts) and its doc-target helpers were
 * removed with it — docs land per-chapter as `*.generated.md` there.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docsgen
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { CACHE_DIR } from "./cache-dir.js";
import { readFactVersion, readVersionedCache } from "./fact-cache.js";
import { writeFigure } from "./figures.js";
import { workspaceRelative } from "./paths.js";
import { importEdges } from "./mermaid.js";
import { normalizeUsage, recordLlmCall } from "./llm-stats.js";
import { ABORTED_MESSAGE, beginGenerationStage, endGenerationStage, generationSignal, reportGeneration, tailPreview } from "./abort.js";
/** Method-level summary bounds: per-class methods (6), per-package classes
 * with methods (6), total call edges (120) — detail without blowup. */
const MAX_SUMMARY_CALLS = 120;
/** Cache file names for structured figure data (sequence/events). */
const SEQ_CACHE = '.arch-lens-sequence';
const EVENTS_CACHE = '.arch-lens-events';
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName(base, language, methods = false) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${CACHE_DIR}/${base}-${safe === '' ? 'default' : safe}${methods ? '-methods' : ''}.json`;
}
/**
 * Accounting kinds that prefer the LOWEST advertised reasoning effort.
 * Doc-chapter prose is a bounded structured-output task: measured runs burned
 * 3K–9K hidden reasoning tokens per ~500-token chapter and the thinking
 * chain dominated wall time (≈18 min for one 7-chapter round). Figure kinds
 * keep the adapter default until the quality tradeoff is measured.
 */
const LOW_EFFORT_KINDS = new Set(['docs']);
/**
 * Pick the cheapest reasoning effort worth proposing for a bounded
 * structured-output call. ONLY ids advertised by the route are eligible:
 * dsh-llm rejects unsupported efforts before provider I/O (no clamping, no
 * aliasing), so proposing anything off-list would fail the whole call.
 * @param reasoning - the route's capability (`resolveModelInfo(...).reasoning`),
 * or undefined when the route exposes none.
 * @returns the effort id to propose, or undefined to keep the adapter
 * default (no capability / empty list / the cheapest IS the default).
 */
export function lowestReasoningEffort(reasoning) {
    if (reasoning === undefined || reasoning.efforts.length === 0)
        return undefined;
    const named = reasoning.efforts.find(effort => /^(none|minimal|low|最低|低)$/i.test(effort.name.trim()));
    const picked = named ?? reasoning.efforts[0];
    if (picked === undefined)
        return undefined;
    if (reasoning.defaultEffort !== undefined && picked.id === reasoning.defaultEffort)
        return undefined;
    return picked.id;
}
/**
 * The AUTHORITATIVE sequence / interaction cache file names, exported for the
 * figure registry (`figures.ts`): consumers must never re-spell cache names.
 * @param language - role language.
 * @param methods - 🔬 method-level variant.
 * @returns the CACHE_DIR-relative cache file name.
 */
export function seqCacheName(language, methods = false) {
    return cacheName(SEQ_CACHE, language, methods);
}
/** See `seqCacheName`. @param language - role language. @param methods - method-level variant. @returns the cache file name. */
export function eventsCacheName(language, methods = false) {
    return cacheName(EVENTS_CACHE, language, methods);
}
/**
 * Bounded summary lines of the code index for prompts (shared with flow.ts
 * and analysis.ts). Each caller picks only the fields its task needs —
 * e.g. core selection never reads edges, so it drops the `deps` field.
 * With `methods: true` the summary also lists per-class method names and a
 * capped block of real call edges (`from → to（file:line）`) — the fact
 * source for method-level figures.
 * @param index - code index result.
 * @param options - field / package / bound selection.
 * @returns the summary lines.
 */
export function indexSummary(index, options = {}) {
    const wanted = options.packages === undefined ? undefined : new Set(options.packages);
    const depsOn = options.fields?.deps !== false;
    const entitiesOn = options.fields?.entities !== false;
    const entryOn = options.fields?.entryFiles !== false;
    const maxPackages = options.maxPackages ?? 60;
    const maxDeps = options.maxDeps ?? 6;
    const lines = [];
    for (const pkg of index.packages) {
        if (lines.length >= maxPackages)
            break;
        if (wanted !== undefined && !wanted.has(pkg.id))
            continue;
        const parts = [`- ${pkg.id}（${pkg.language}）`];
        if (depsOn)
            parts.push(`依赖: ${pkg.deps.slice(0, maxDeps).join(', ') || '无'}`);
        if (entitiesOn) {
            const entities = pkg.entities.filter(e => e.kind !== 'method' && e.kind !== 'field').slice(0, 8).map(e => e.name);
            parts.push(`顶层实体: ${entities.join(', ') || '无'}`);
            if (options.methods === true) {
                // Per-class method names (capped): the method-level fact base.
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
                if (methodLines.length > 0)
                    parts.push(`方法: ${methodLines.join('；')}`);
            }
        }
        if (entryOn)
            parts.push(`入口: ${pkg.entryFiles.slice(0, 2).join(', ') || '无'}`);
        lines.push(parts.join('；'));
    }
    if (options.methods === true) {
        // Real call edges with caller file:line — the method-level chain facts.
        // Paths are workspace-relative; the absolute root is stated once in the
        // section header so no per-path absolute prefix leaks into the prompt.
        const edges = (index.calls ?? [])
            .filter(edge => edge.from !== undefined && edge.from !== '')
            .slice(0, MAX_SUMMARY_CALLS)
            .map(edge => `- ${edge.from} → ${edge.to}（${workspaceRelative(index.root, edge.fromFile)}${edge.line !== undefined ? `:${edge.line}` : ''}）`);
        if (edges.length > 0) {
            lines.push('');
            lines.push(`真实调用边（方法级，含调用点文件行号；路径相对工作区根 ${index.root}）:`);
            lines.push(...edges);
        }
    }
    return lines.join('\n');
}
/**
 * One LLM generation call with the standard config contract (shared with
 * flow.ts). The output cap is optional: omitted, the request inherits the
 * adapter's Config-owned default maxTokens instead of a local literal.
 * Every call is recorded in the LLM usage accounting (see llm-stats.ts).
 * An optional AbortSignal cancels the provider stream promptly (the「⏹ 终止」
 * button); an aborted call throws `ABORTED_MESSAGE` and is not recorded.
 * @param ctx - host context carrying llm and agentDefaultModel services.
 * @param prompt - the full prompt text.
 * @param temperature - sampling temperature.
 * @param maxTokens - optional output cap.
 * @param kind - accounting kind for llm-stats.ts.
 * @param signal - optional cancellation for this call.
 * @returns the model output text.
 */
export async function llmText(ctx, prompt, temperature, maxTokens, kind = 'llm', signal) {
    const llm = ctx.get('llm');
    const defaultModel = ctx.get('agentDefaultModel');
    if (llm === undefined || defaultModel === undefined)
        throw new Error('llm or agentDefaultModel service missing');
    const selection = defaultModel.currentSelection();
    // Bounded kinds propose the cheapest advertised reasoning effort; the probe
    // is advisory (a lookup failure keeps the adapter default, never blocks).
    let reasoningEffort;
    if (LOW_EFFORT_KINDS.has(kind)) {
        try {
            const info = await llm.resolveModelInfo(selection.provider, selection.model, signal);
            reasoningEffort = lowestReasoningEffort(info.reasoning);
        }
        catch {
            reasoningEffort = undefined;
        }
    }
    const prepared = await llm.prepareCall({
        provider: selection.provider, model: selection.model, temperature,
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    }, signal);
    const cfg = prepared.config;
    const started = Date.now();
    let out = '';
    let usage;
    const chunkTypes = new Map();
    let finishInfo = '';
    // ⚙️ live generation status: report stage + streamed output (reasoning tail
    // while the model thinks, then the text tail) so the panel can show the
    // LLM working on the figure.
    beginGenerationStage(signal, `LLM：${kind}`);
    let textTail = '';
    let reasoningTail = '';
    for await (const chunk of prepared.stream({
        provider: cfg.provider, model: cfg.model,
        ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
        ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
        ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
        ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
        ...(signal === undefined ? {} : { signal }),
        messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
    })) {
        if (signal?.aborted === true)
            throw new Error(ABORTED_MESSAGE);
        chunkTypes.set(chunk.type, (chunkTypes.get(chunk.type) ?? 0) + 1);
        if (chunk.type === 'text-delta') {
            out += chunk.text;
            textTail = tailPreview(textTail, chunk.text);
            reportGeneration(signal, out.length, textTail);
        }
        else if (chunk.type === 'reasoning-delta') {
            reasoningTail = tailPreview(reasoningTail, chunk.text);
            reportGeneration(signal, out.length, `🧠 ${reasoningTail}`);
        }
        if (chunk.type === 'usage')
            usage = chunk.usage;
        if (chunk.type === 'finish') {
            finishInfo = JSON.stringify(chunk.reason);
            // An error finish (missing credential, quota, transport…) must surface
            // as a real error, never as a misleading "empty text" result.
            if (chunk.reason.kind === 'error' && chunk.reason.failure !== undefined) {
                endGenerationStage(signal);
                throw new Error(`llm call failed: ${chunk.reason.failure.message}`);
            }
            if (chunk.reason.kind === 'aborted') {
                endGenerationStage(signal);
                throw new Error(ABORTED_MESSAGE);
            }
        }
    }
    if (signal?.aborted === true) {
        endGenerationStage(signal);
        throw new Error(ABORTED_MESSAGE);
    }
    endGenerationStage(signal);
    const text = out.trim();
    if (text === '') {
        console.warn(`[arch-lens] llmText returned empty text (provider=${cfg.provider}, model=${cfg.model}, ` +
            `temperature=${cfg.temperature}, maxTokens=${cfg.maxTokens ?? 'default'}) ` +
            `chunks=${JSON.stringify([...chunkTypes])} finish=${finishInfo} — ` +
            'output budget may have been fully consumed by reasoning');
    }
    recordLlmCall(kind, prompt, text, Date.now() - started, normalizeUsage(usage));
    return text;
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
 * @param summary - the summary lines to embed (entity-level by default,
 *   method-level when the 🔬 switch is on — callers choose the granularity).
 * @returns the prompt text.
 */
export function seqInductionPrompt(index, language, summary) {
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
        + `严格输出 JSON 数组：[{ "from": "...", "to": "...", "label": "..." }]，不要其他内容。\n\n${summary ?? indexSummary(index, { fields: { deps: false } })}`;
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
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @param methodLevel - 🔬 方法级: feed the method-level summary (methods +
 *   real call edges with file:line) instead of the entity-level one.
 * @returns the parsed structured data, or an error.
 */
export async function writeStructuredCache(ctx, fs, root, index, language, kind, sandboxPolicy, methodLevel = false) {
    try {
        const summary = indexSummary(index, { fields: { deps: false }, methods: methodLevel });
        const prompt = kind === 'seq'
            ? seqInductionPrompt(index, language, summary)
            : `你是代码交互分析师。根据项目摘要归纳这个项目的【核心事件流】。\n`
                + `输出语言：${language}。\n`
                + `粒度要求：事件应是项目运作的核心事件流大类（如：事实构建、AI 图生成、缓存读写、进度通知、结果持久化），禁止把每个具体功能/remote 方法/接口拆成独立事件，同类调用合并为一条。\n`
                + `每条事件必须写明「消费结果」：note 里说明消费者收到该事件/数据后执行什么动作、产生什么可观察效果（如"前端据此刷新时序图缓存"）。\n`
                + `严格输出 JSON 数组：[{ "event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..." }]（5-8 条），不要其他内容。\n\n${summary}`;
        const text = await llmText(ctx, prompt, 0.3, undefined, kind === 'seq' ? 'seq' : 'events', generationSignal(root));
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start < 0 || end <= start)
            return { error: 'structured generation returned no JSON array' };
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (!Array.isArray(parsed) || parsed.length === 0)
            return { error: 'structured generation returned an empty array' };
        const factsVersion = await readFactVersion(fs, root);
        // 统一写入口 + 统一 seq 形态：写侧一律 { source, messages } 对象（裸数组
        // 兼容读保留在 readSeqCache，不迁移磁盘）；interaction 仍是事件数组。
        const data = kind === 'seq' ? { source: 'flow', messages: parsed } : parsed;
        await writeFigure(fs, root, kind, language, factsVersion, data, { methods: methodLevel, policy: sandboxPolicy });
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
export async function readStructuredCache(fs, root, language, kind, methods = false) {
    try {
        const target = await fs.resolve(cacheName(kind === 'seq' ? SEQ_CACHE : EVENTS_CACHE, language, methods), { cwd: root });
        const factsVersion = await readFactVersion(fs, root);
        const parsed = await readVersionedCache(fs, target, factsVersion);
        return Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=docsgen.js.map