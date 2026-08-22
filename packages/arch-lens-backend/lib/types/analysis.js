/**
 * Shared analysis profile: ONE LLM pass (two serial calls) produces every
 * AI-derived figure fact from ONE index summary, so concept/flow/seq/events/
 * core share a single context instead of six independent ones re-sending the
 * same summary. Each chain consumes the profile AFTER its authoritative stage
 * (docs / static call graph) and BEFORE its own LLM fallback, so authority
 * order never changes: cache → docs/code → profile → chain-own LLM.
 *
 *   ensureAnalysisProfile(ctx, fs, root, index, language, policy)
 *     ├─ call 1 (structure): { coreIds, conceptTree }   — trimmed summary
 *     │    （id+实体+入口，无依赖字段：方案 B）
 *     └─ call 2 (figures): { flow, seqMessages, events } — core-only summary
 *          （只发送 coreIds 子集，seq 的 from/to 由 coreIds 交叉校验）
 *
 * In-memory single-flight per root+language: concurrent chains share one
 * generation. The profile lands in `.arch-lens-analysis-<lang>.json` and is
 * invalidated by `removeAICaches` together with the other AI caches; the
 * single-flight map is cleared by `clearAnalysisProfileCache()`.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/analysis
 */
import { CACHE_DIR } from "./cache-dir.js";
import { indexSummary, llmText } from "./docsgen.js";
import { FLOW_ANGLE_LABEL, FLOW_STYLE_RULES, flowAngleRule, sanitizeMermaid } from "./flow-angle.js";
import { generationSignal } from "./abort.js";
/** Flow viewpoints generated together (order = UI order on the flow tab). */
const FLOW_ANGLES = ['event', 'pipeline'];
/** Cache file base name; the role language is appended (sanitized). */
export const ANALYSIS_FILE_BASE = '.arch-lens-analysis';
/** Profile schema version: readers ignore other versions (regenerate).
 * v2: the `flow` field is a per-viewpoint map ({ event, pipeline }) instead
 * of a single diagram — old v1 profiles are regenerated with both angles. */
export const PROFILE_VERSION = 2;
/** Caps mirrored from the chain prompts so one profile stays bounded. */
const MAX_ROOT_CONCEPTS = 12;
const MAX_CONCEPT_DEPTH = 3;
const MIN_CORE_IDS = 4;
const MAX_CORE_IDS = 25;
const MAX_SEQ_MESSAGES = 16;
const MAX_EVENTS = 14;
/** Allowed interaction modes (same vocabulary as the events figure). */
const EVENT_MODES = new Set(['emit', 'waterfall', 'parallel', 'serial']);
/** Keep cache file names filesystem-safe. */
export function cacheName(language) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${CACHE_DIR}/${ANALYSIS_FILE_BASE}-${safe === '' ? 'default' : safe}.json`;
}
/** Single-flight: one in-memory generation per root+language. */
const inflight = new Map();
/** The latest known profile per root+language (kept in sync with disk; the
 * single source the chains and field regenerations read). */
const currentProfiles = new Map();
/** Serialized field-level regenerations per root+language (each per-tab AI
 * generate mutates the profile; concurrent ones must not interleave). */
const mutations = new Map();
/** Drop every in-flight profile and mutation (rescan invalidates the
 * analysis layer too). */
export function clearAnalysisProfileCache() {
    inflight.clear();
    currentProfiles.clear();
    mutations.clear();
}
/**
 * Resolve the shared analysis profile: memory → disk cache → generate
 * (single-flight). Returns a profile whose missing fields mean "this chain
 * must fall back to its own LLM"; it never throws.
 * @param ctx - host context (llm / agentDefaultModel services).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (summary source).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns the profile (possibly with empty/missing fields).
 */
export async function ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy) {
    const key = `${root}\u0000${language}`;
    const current = currentProfiles.get(key);
    if (current !== undefined)
        return current;
    const existing = inflight.get(key);
    if (existing !== undefined)
        return existing;
    const promise = resolveProfile(ctx, fs, root, index, language, sandboxPolicy).then(profile => {
        currentProfiles.set(key, profile);
        return profile;
    });
    inflight.set(key, promise);
    return promise;
}
async function resolveProfile(ctx, fs, root, index, language, sandboxPolicy) {
    const target = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null);
    if (target !== null) {
        try {
            const info = await fs.stat(target);
            if (info !== undefined && info.type === 'file') {
                const cached = profileFromText(await fs.readText(target));
                if (cached !== null) {
                    console.log(`[arch-lens] analysis: served from cache (lang=${language})`);
                    return cached;
                }
            }
        }
        catch {
            // stale/corrupt profile → regenerate
        }
    }
    console.log('[arch-lens] analysis: generating shared profile (2 serial LLM calls)');
    const structure = await generateStructure(ctx, index, language, { core: true, concept: true }, generationSignal(root));
    const figures = structure.coreIds !== undefined && structure.coreIds.length >= MIN_CORE_IDS
        ? await generateFigures(ctx, index, structure.coreIds, language, { flow: true, seq: true, events: true }, generationSignal(root))
        : null;
    const profile = {
        version: PROFILE_VERSION,
        generatedAt: Date.now(),
        language,
        coreIds: structure.coreIds ?? [],
        ...(structure.conceptTree !== undefined && structure.conceptTree.length > 0
            ? { conceptTree: structure.conceptTree }
            : {}),
        ...(figures?.flow !== undefined ? { flow: figures.flow } : {}),
        ...(figures?.seqMessages !== undefined && figures.seqMessages.length > 0
            ? { seqMessages: figures.seqMessages }
            : {}),
        ...(figures?.events !== undefined && figures.events.length > 0
            ? { events: figures.events }
            : {}),
    };
    if (target !== null) {
        try {
            await fs.writeText(target, JSON.stringify(profile), undefined, undefined, sandboxPolicy);
            console.log('[arch-lens] analysis: profile cached');
        }
        catch {
            // cache write failures are non-fatal
        }
    }
    return profile;
}
/** Parse a persisted profile, validating only what readers rely on. */
export function profileFromText(text) {
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        if (parsed.version !== PROFILE_VERSION)
            return null;
        if (!Array.isArray(parsed.coreIds))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/** Pull the outermost JSON object out of a model answer, tolerating prose. */
export function parseProfileObject(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * Validate and bound an LLM id list against the indexed packages:
 * strings only, must exist in the index, deduplicated, capped at 25.
 * Mirrors core.ts `validateIds` so the profile's coreIds obey the same rule.
 * @param index - code index result.
 * @param raw - the raw `coreIds` field of a model answer.
 * @returns the sanitized id list.
 */
export function sanitizeCoreIds(index, raw) {
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
        if (ids.length >= MAX_CORE_IDS)
            break;
    }
    return ids;
}
/**
 * Build concept-tree nodes from a raw model array: names required (trimmed),
 * bounded text, depth ≤3, at most 12 roots. Nodes carry source:'flow' like
 * the chain-own induction fallback.
 * @param raw - raw `conceptTree` field of a model answer.
 * @param idPrefix - node id prefix (unique per profile).
 * @returns the sanitized tree (possibly empty).
 */
export function buildProfileConceptTree(raw, idPrefix) {
    return buildTree(raw, idPrefix, 0);
}
function buildTree(raw, idPrefix, depth) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        if (typeof item !== 'object' || item === null)
            continue;
        const record = item;
        if (typeof record.name !== 'string' || record.name.trim() === '')
            continue;
        const node = {
            id: `${idPrefix}-${depth}-${i}`,
            name: record.name.trim().slice(0, 60),
            desc: typeof record.desc === 'string' ? record.desc.slice(0, 220) : '',
            source: 'flow',
        };
        if (typeof record.inside === 'string' && record.inside !== '')
            node.inside = record.inside.slice(0, 400);
        if (depth < MAX_CONCEPT_DEPTH - 1 && Array.isArray(record.children)) {
            const children = buildTree(record.children, `${idPrefix}-${depth}-${i}`, depth + 1);
            if (children.length > 0)
                node.children = children;
        }
        out.push(node);
        if (out.length >= MAX_ROOT_CONCEPTS)
            break;
    }
    return out;
}
/** Extract a mermaid flowchart from raw text (fenced or bare), like flow.ts,
 * then repair syntax the model tends to break (see sanitizeMermaid). */
function extractMermaidLocal(out) {
    const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
    if (fenced !== null)
        return sanitizeMermaid(fenced[1].trim());
    const idx = out.search(/\b(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/);
    if (idx < 0)
        return '';
    return sanitizeMermaid(out.slice(idx).trim().replace(/```\s*$/, '').trim());
}
/**
 * Sanitize a raw flow object: mermaid source required (cleaned), title
 * bounded with a neutral default. The generation viewpoint is stamped from
 * the caller (the model never chooses it).
 * @param raw - raw `flow.<angle>` field of a model answer.
 * @param angle - the requested generation viewpoint.
 * @returns the sanitized flow, or undefined.
 */
export function sanitizeFlow(raw, angle) {
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const record = raw;
    if (typeof record.mermaid !== 'string')
        return undefined;
    const mermaid = extractMermaidLocal(record.mermaid);
    if (mermaid === '')
        return undefined;
    return {
        title: typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim().slice(0, 60) : '核心流程',
        angle,
        mermaid,
    };
}
/**
 * Sanitize raw sequence messages: strings only, from/to must be core ids,
 * no self-loops, label bounded, capped at 16.
 * @param raw - raw `seqMessages` field of a model answer.
 * @param coreIds - the profile's validated core ids (the only legal endpoints).
 * @returns the sanitized messages.
 */
export function sanitizeSeqMessages(raw, coreIds) {
    if (!Array.isArray(raw))
        return [];
    const idSet = new Set(coreIds);
    const out = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null)
            continue;
        const record = item;
        if (typeof record.from !== 'string' || typeof record.to !== 'string')
            continue;
        if (!idSet.has(record.from) || !idSet.has(record.to) || record.from === record.to)
            continue;
        const label = typeof record.label === 'string' ? record.label.trim().slice(0, 60) : '';
        if (label === '')
            continue;
        out.push({ from: record.from, to: record.to, label });
        if (out.length >= MAX_SEQ_MESSAGES)
            break;
    }
    return out;
}
/**
 * Sanitize raw interaction events: event name required, mode restricted to
 * the four cordis dispatch modes, producers/consumers bounded, capped at 14.
 * @param raw - raw `events` field of a model answer.
 * @returns the sanitized events.
 */
export function sanitizeEvents(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null)
            continue;
        const record = item;
        if (typeof record.event !== 'string' || record.event.trim() === '')
            continue;
        const producers = Array.isArray(record.producers)
            ? record.producers.filter((p) => typeof p === 'string').slice(0, 8)
            : [];
        const consumers = Array.isArray(record.consumers)
            ? record.consumers.filter((c) => typeof c === 'string').slice(0, 8)
            : [];
        const mode = typeof record.mode === 'string' && EVENT_MODES.has(record.mode) ? record.mode : 'emit';
        out.push({
            event: record.event.trim().slice(0, 80),
            mode,
            producers,
            consumers,
            note: typeof record.note === 'string' ? record.note.slice(0, 200) : '',
        });
        if (out.length >= MAX_EVENTS)
            break;
    }
    return out;
}
/**
 * Call 1 (structure): core ids and/or concept tree from the trimmed summary.
 * The caller selects which fields it wants: the full cold-start generation
 * wants both; a per-tab regenerate wants exactly one.
 * @param ctx - host context.
 * @param index - code index result.
 * @param language - role language.
 * @param want - which structure fields to ask for.
 * @param signal - optional cancellation (⏹ 终止).
 * @returns the requested fields (absent = the model produced none).
 */
async function generateStructure(ctx, index, language, want, signal) {
    try {
        const items = [];
        if (want.core)
            items.push('  "coreIds": ["构成项目核心流程的包 id，4-25 个，只能从摘要出现过的 id 中选，不要编造"]');
        if (want.concept)
            items.push('  "conceptTree": [{ "name": "...", "desc": "...", "inside": "...", "children": [] }]');
        const prompt = `你是代码架构分析师。以下是某项目的代码索引摘要（包 id / 语言 / 顶层实体 / 入口文件）。\n`
            + `请完成以下任务，严格输出一个 JSON 对象，不要输出其他内容：\n{\n${items.join(',\n')}\n}\n`
            + (want.concept
                ? `conceptTree 要求：归纳项目「是怎么运作的」的运行核心概念（如入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳，不要生搬硬套），组织成层级树，最多 ${MAX_ROOT_CONCEPTS} 个根节点、深度最多 ${MAX_CONCEPT_DEPTH} 层。\n`
                : '')
            + `输出语言：${language}。\n\n`
            + `项目摘要：\n${indexSummary(index, { fields: { deps: false } })}`;
        const kind = want.core && want.concept ? 'analysis-structure' : want.core ? 'analysis-core' : 'analysis-concept';
        const out = await llmText(ctx, prompt, 0.3, undefined, kind, signal);
        const parsed = parseProfileObject(out);
        if (parsed === null)
            return {};
        const result = {};
        if (want.core) {
            const coreIds = sanitizeCoreIds(index, parsed.coreIds);
            if (coreIds.length > 0)
                result.coreIds = coreIds;
        }
        if (want.concept) {
            const tree = buildProfileConceptTree(parsed.conceptTree, 'analysis');
            if (tree.length > 0)
                result.conceptTree = tree;
        }
        return result;
    }
    catch (error) {
        console.warn(`[arch-lens] analysis structure failed: ${error instanceof Error ? error.message : String(error)}`);
        return {};
    }
}
/**
 * Call 2 (figures): flow / seq / events over the core-only summary. The
 * caller selects which figure fields it wants (full generation = all three;
 * a per-tab regenerate = exactly one). The flow figure generates BOTH
 * viewpoints (event + pipeline) in this single call — the profile carries
 * them as a map, so switching angles never costs another LLM call.
 * @param ctx - host context.
 * @param index - code index result.
 * @param coreIds - the profile's validated core ids (endpoint constraint).
 * @param language - role language.
 * @param want - which figure fields to ask for.
 * @param signal - optional cancellation (⏹ 终止).
 * @returns the requested fields (absent = the model produced none).
 */
async function generateFigures(ctx, index, coreIds, language, want, signal) {
    try {
        const items = [];
        if (want.flow) {
            items.push('  "flow": { "event": { "title": "事件驱动流程标题", "mermaid": "flowchart TD\\n..." }, "pipeline": { "title": "数据管道流程标题", "mermaid": "flowchart TD\\n..." } }');
        }
        if (want.seq)
            items.push('  "seqMessages": [{ "from": "包id", "to": "包id", "label": "短动宾短语或 调用 xxx()" }]');
        if (want.events)
            items.push('  "events": [{ "event": "事件名", "mode": "emit|waterfall|parallel|serial", "producers": ["包id"], "consumers": ["包id"], "note": "一句话说明" }]');
        const requirements = [];
        if (want.flow) {
            for (const angle of FLOW_ANGLES) {
                requirements.push(`- flow.${angle}：以「${FLOW_ANGLE_LABEL[angle]}」视角归纳一张可学习的核心流程图，mermaid 字段是完整 flowchart 源码（flowchart TD 开头，不要代码块围栏）；${flowAngleRule(angle)}`);
            }
            // The shared style bar (two-line labels, decision diamonds, few-shot
            // example) appears ONCE for both viewpoints.
            requirements.push(FLOW_STYLE_RULES);
            requirements.push('- flow 的 event 与 pipeline 是两张不同的图，不要互相复制内容；');
        }
        if (want.seq)
            requirements.push('- seqMessages：主线 10-16 条，from/to 只能使用上面列出的包 id，从入口包开始 → 核心循环/驱动 → 关键能力 → 输出/回复结束；');
        if (want.events)
            requirements.push('- events：核心事件/交互 8-14 条，producers/consumers 也只能使用上面列出的包 id；');
        requirements.push('- 禁止编造摘要中不存在的包、机制或数据关系。');
        const prompt = `你是代码架构分析师。以下是某项目核心流程涉及的包（已由结构分析选出）及其顶层实体。\n`
            + `请基于这些包归纳对应图元，严格输出一个 JSON 对象，不要输出其他内容：\n{\n${items.join(',\n')}\n}\n`
            + `要求：\n${requirements.join('\n')}\n`
            + `输出语言：${language}。\n\n`
            + `核心包摘要：\n${indexSummary(index, { packages: coreIds, fields: { deps: false } })}`;
        const out = await llmText(ctx, prompt, 0.3, undefined, 'analysis-figures', signal);
        const parsed = parseProfileObject(out);
        if (parsed === null)
            return {};
        const result = {};
        if (want.flow) {
            const rawFlow = parsed.flow;
            const flows = {};
            if (typeof rawFlow === 'object' && rawFlow !== null) {
                const record = rawFlow;
                for (const angle of FLOW_ANGLES) {
                    const flow = sanitizeFlow(record[angle], angle);
                    if (flow !== undefined)
                        flows[angle] = flow;
                }
            }
            if (Object.keys(flows).length > 0)
                result.flow = flows;
        }
        if (want.seq) {
            const seqMessages = sanitizeSeqMessages(parsed.seqMessages, coreIds);
            if (seqMessages.length > 0)
                result.seqMessages = seqMessages;
        }
        if (want.events) {
            const events = sanitizeEvents(parsed.events);
            if (events.length > 0)
                result.events = events;
        }
        return result;
    }
    catch (error) {
        console.warn(`[arch-lens] analysis figures failed: ${error instanceof Error ? error.message : String(error)}`);
        return {};
    }
}
/**
 * Per-tab "AI generate": regenerate ONE profile field with one trimmed-summary
 * LLM call, update the shared profile in memory and on disk, and return it.
 * Serialized per root+language so concurrent tab generations never interleave.
 *
 * Regenerating the core selection INVALIDATES flow/seq/events: their
 * endpoints are cross-checked against coreIds, so after a new selection the
 * old figures could reference dropped packages. They are cleared and
 * re-generated on demand when their tabs are opened.
 *
 * A field whose regeneration produced nothing throws (the profile keeps its
 * previous value — no stale data is frozen in).
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param kind - the profile field to regenerate.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @returns the updated profile.
 */
export async function regenerateProfileField(ctx, fs, root, index, language, kind, sandboxPolicy) {
    const key = `${root}\u0000${language}`;
    const previous = mutations.get(key) ?? Promise.resolve();
    const next = previous.catch(() => { }).then(async () => {
        // Make sure the base profile exists (disk or full generation) first.
        const base = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy);
        const updated = { ...base };
        if (kind === 'core' || kind === 'concept') {
            const structure = await generateStructure(ctx, index, language, { core: kind === 'core', concept: kind === 'concept' }, generationSignal(root));
            if (kind === 'core') {
                const coreIds = structure.coreIds;
                if (coreIds === undefined || coreIds.length < MIN_CORE_IDS) {
                    throw new Error('core regeneration produced too few packages');
                }
                updated.coreIds = coreIds;
                // Selection changed: old figure endpoints may no longer be core ids.
                delete updated.flow;
                delete updated.seqMessages;
                delete updated.events;
            }
            else {
                if (structure.conceptTree === undefined)
                    throw new Error('concept regeneration produced no tree');
                updated.conceptTree = structure.conceptTree;
            }
        }
        else {
            const figures = await generateFigures(ctx, index, updated.coreIds, language, {
                flow: kind === 'flow', seq: kind === 'seq', events: kind === 'events',
            }, generationSignal(root));
            if (kind === 'flow') {
                // The flow field regenerates BOTH viewpoints in the one call.
                if (figures.flow === undefined)
                    throw new Error('flow regeneration produced no diagram');
                updated.flow = figures.flow;
            }
            else if (kind === 'seq') {
                if (figures.seqMessages === undefined)
                    throw new Error('seq regeneration produced no messages');
                updated.seqMessages = figures.seqMessages;
            }
            else {
                if (figures.events === undefined)
                    throw new Error('events regeneration produced no events');
                updated.events = figures.events;
            }
        }
        updated.generatedAt = Date.now();
        currentProfiles.set(key, updated);
        const target = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null);
        if (target !== null) {
            try {
                await fs.writeText(target, JSON.stringify(updated), undefined, undefined, sandboxPolicy);
            }
            catch {
                // cache write failures are non-fatal
            }
        }
        return updated;
    });
    mutations.set(key, next);
    return next;
}
//# sourceMappingURL=analysis.js.map