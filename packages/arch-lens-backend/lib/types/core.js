/**
 * Core-flow package selection for the Arch Lens backend: pick the packages
 * that form the project's core flow. The LLM selects ids from the index
 * summary (validated against the index — unknown ids are dropped); a
 * deterministic fallback (entry packages plus their source-import neighbors,
 * depth 1) covers LLM failure so the figure never renders empty. Edges are
 * derived by rules elsewhere (mermaid.ts importEdges); this module owns only
 * the selection and its provenance.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/core
 */
import { importEdges } from "./mermaid.js";
import { indexSummary, llmText } from "./docsgen.js";
/** Cache file base name; the role language is appended (sanitized). */
const CORE_FILE_BASE = '.arch-lens-core';
/** Keep cache file names filesystem-safe. */
function cacheName(language) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${CORE_FILE_BASE}-${safe === '' ? 'default' : safe}.json`;
}
/** LLM selection bounds: small enough to read, large enough to be a graph. */
const MIN_CORE = 4;
const MAX_CORE = 25;
/** Validate and bound the LLM's id list against the indexed packages. */
function validateIds(index, raw) {
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
        if (ids.length >= MAX_CORE)
            break;
    }
    return ids;
}
/** Deterministic fallback: entry packages plus their import neighbors (depth 1). */
function fallbackIds(index) {
    const picked = new Set(index.packages.filter(pkg => pkg.entryFiles.length > 0).map(pkg => pkg.id));
    const edges = importEdges(index);
    for (const [from, tos] of edges) {
        if (picked.has(from))
            for (const to of tos)
                picked.add(to);
        if (tos.some(to => picked.has(to)))
            picked.add(from);
    }
    return [...picked];
}
/** Pull the `{ "core": [...] }` object out of a model answer, tolerating prose. */
function extractCoreJson(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
        return undefined;
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (typeof parsed !== 'object' || parsed === null)
            return undefined;
        return parsed.core;
    }
    catch {
        return undefined;
    }
}
/** LLM pick: return the ids the model selects from the index summary. */
async function llmPick(ctx, index, language) {
    const prompt = `你是代码架构分析师。以下是某项目的代码索引摘要（包 id / 语言 / 顶层实体 / 入口文件）。\n`
        + `请从摘要中选出构成这个项目核心流程的 ${MIN_CORE}-${MAX_CORE} 个核心包 id（如启动、请求处理、主循环涉及的关键包）。\n`
        + `只能使用摘要中出现的包 id，不要编造。\n`
        + `输出语言：${language}。\n`
        + `严格按以下格式输出，不要输出其他内容：\n`
        + `{"core": ["id1", "id2", ...]}\n\n`
        + `项目摘要：\n${indexSummary(index)}`;
    const out = await llmText(ctx, prompt, 0.3);
    return validateIds(index, extractCoreJson(out));
}
/**
 * The full core-selection chain: cache → LLM pick (validated) → deterministic
 * fallback. `force` bypasses the cache and rebuilds the selection facts.
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @returns the core selection, or an error result.
 */
export async function coreGraph(ctx, fs, root, index, language, force, sandboxPolicy) {
    const cacheTarget = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null);
    if (!force && cacheTarget !== null) {
        try {
            const info = await fs.stat(cacheTarget);
            if (info !== undefined && info.type === 'file') {
                const cached = JSON.parse(await fs.readText(cacheTarget));
                if (typeof cached === 'object' && cached !== null && Array.isArray(cached.ids) && (cached.source === 'flow' || cached.source === 'curated')) {
                    console.log(`[arch-lens] core: served from cache (lang=${language})`);
                    return cached;
                }
            }
        }
        catch {
            // stale/corrupt cache → regenerate
        }
    }
    const writeCache = async (result) => {
        if (cacheTarget === null)
            return;
        try {
            await fs.writeText(cacheTarget, JSON.stringify(result), undefined, undefined, sandboxPolicy);
        }
        catch {
            // cache write failures are non-fatal
        }
    };
    // LLM pick first: validated ids, source 'flow' (non-authoritative).
    let ids = [];
    try {
        ids = await llmPick(ctx, index, language);
    }
    catch (error) {
        console.warn(`[arch-lens] core: LLM pick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (ids.length >= MIN_CORE) {
        const result = { ids, source: 'flow' };
        await writeCache(result);
        return result;
    }
    // Deterministic fallback: entry packages + import neighbors. Not cached —
    // the next non-forced read retries the LLM instead of freezing on rules.
    console.log('[arch-lens] core: LLM pick empty or too small — using deterministic fallback');
    const fallback = fallbackIds(index);
    if (fallback.length === 0)
        return { error: 'core selection failed: no entry packages in the index' };
    return { ids: fallback, source: 'curated', ref: 'entry packages plus their source-import neighbors' };
}
//# sourceMappingURL=core.js.map