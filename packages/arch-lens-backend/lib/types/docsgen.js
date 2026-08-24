/**
 * Architecture-doc generation for the Arch Lens backend. Two entry points:
 *   - generateFullDocs: one LLM pass writes a complete architecture doc
 *     (concept / sequence / interaction / dependency / ER / catalog sections).
 *   - generateDocSection: one dimension regenerated on demand (per-tab "AI
 *     generate"); sequence/interaction also write structured caches the
 *     figures render directly.
 * The generated doc ALWAYS lands in docs/architecture.generated.md and is
 * overwritten on every generation. docs/architecture.md is the USER'S OWN
 * document and the generator never writes it — users adopt a generated doc
 * by renaming/copying it into place (dropping the "generated" suffix).
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docsgen
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { CACHE_DIR } from "./cache-dir.js";
import { readFactVersion, readVersionedCache, writeVersionedCache } from "./fact-cache.js";
import { workspaceRelative } from "./paths.js";
import { importEdges } from "./mermaid.js";
import { normalizeUsage, recordLlmCall } from "./llm-stats.js";
import { ABORTED_MESSAGE, beginGenerationStage, endGenerationStage, generationSignal, reportGeneration, tailPreview } from "./abort.js";
/** Marker proving a doc file was produced by this tool. */
const DOC_MARK = '<!-- arch-lens generated -->';
/** The only doc target the generator ever writes (overwritten each time). */
const DOC_FILE_AI = 'docs/architecture.generated.md';
/** Method-level summary bounds: per-class methods (6), per-package classes
 * with methods (6), total call edges (120) — detail without blowup. */
const MAX_SUMMARY_CALLS = 120;
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
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName(base, language, methods = false) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${CACHE_DIR}/${base}-${safe === '' ? 'default' : safe}${methods ? '-methods' : ''}.json`;
}
/**
 * Resolve the doc target: ALWAYS `docs/architecture.generated.md`.
 * `docs/architecture.md` belongs to the user and is never written, whether it
 * carries a generated marker or not. Every generation overwrites the AI
 * variant (per-section merge for generateDocSection, full rewrite for
 * generateFullDocs). Users adopt a generated doc by renaming/copying it over
 * `architecture.md` (dropping the "generated" suffix) — the generator keeps
 * writing the AI variant afterwards.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @returns the AI variant display path.
 */
export async function resolveDocTarget(fs, root) {
    return (await fs.resolve(DOC_FILE_AI, { cwd: root })).displayPath;
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
    const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature, ...(maxTokens === undefined ? {} : { maxTokens }) }, signal);
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
        const text = await llmText(ctx, sectionPrompt(kind, index, language), 0.3, undefined, 'docs-section', generationSignal(root));
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
            const text = await llmText(ctx, sectionPrompt(kind, index, language), 0.3, undefined, 'docs-full', generationSignal(root));
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
            : `你是代码交互分析师。根据项目摘要列出核心事件/交互。\n输出语言：${language}。\n严格输出 JSON 数组：[{ "event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..." }]（8-14 条），不要其他内容。\n\n${summary}`;
        const text = await llmText(ctx, prompt, 0.3, undefined, kind === 'seq' ? 'seq' : 'events', generationSignal(root));
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start < 0 || end <= start)
            return { error: 'structured generation returned no JSON array' };
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (!Array.isArray(parsed) || parsed.length === 0)
            return { error: 'structured generation returned an empty array' };
        const target = await fs.resolve(cacheName(kind === 'seq' ? SEQ_CACHE : EVENTS_CACHE, language, methodLevel), { cwd: root });
        const factsVersion = await readFactVersion(fs, root);
        // 结构化图的依赖包：seq 取消息 from/to；interaction 取生产者/消费者。
        const deps = [];
        for (const item of parsed) {
            if (typeof item !== 'object' || item === null)
                continue;
            if (kind === 'seq') {
                const msg = item;
                if (typeof msg.from === 'string' && msg.from !== '')
                    deps.push(msg.from);
                if (typeof msg.to === 'string' && msg.to !== '')
                    deps.push(msg.to);
            }
            else {
                const ev = item;
                for (const list of [ev.producers, ev.consumers]) {
                    if (Array.isArray(list)) {
                        for (const id of list) {
                            if (typeof id === 'string' && id !== '')
                                deps.push(id);
                        }
                    }
                }
            }
        }
        await writeVersionedCache(fs, target, parsed, factsVersion, sandboxPolicy, deps);
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