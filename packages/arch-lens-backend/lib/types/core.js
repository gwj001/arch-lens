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
import { CACHE_DIR } from "./cache-dir.js";
import { readFactVersion, readStalePrior, readVersionedCache } from "./fact-cache.js";
import { writeFigure } from "./figures.js";
import { importEdges } from "./mermaid.js";
import { indexSummary, llmText } from "./docsgen.js";
import { ensureAnalysisProfile } from "./analysis.js";
import { generationSignal } from "./abort.js";
/** Cache file base name; the role language is appended (sanitized). */
const CORE_FILE_BASE = '.arch-lens-core';
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName(language, methods = false) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${CACHE_DIR}/${CORE_FILE_BASE}-${safe === '' ? 'default' : safe}${methods ? '-methods' : ''}.json`;
}
/**
 * The AUTHORITATIVE core cache file name, exported for the figure registry
 * (`figures.ts`): consumers must never re-spell cache names.
 * @param language - role language.
 * @param methods - 🔬 method-level variant.
 * @returns the CACHE_DIR-relative cache file name.
 */
export function coreCacheName(language, methods = false) {
    return cacheName(language, methods);
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
/** LLM pick: return the ids the model selects from the index summary.
 * `priorIds` (phase 1) seeds revision with the stale selection — validateIds
 * drops anything the new index no longer contains, so anchoring is bounded. */
async function llmPick(ctx, index, language, signal, methods = false, priorIds = []) {
    const priorLine = priorIds.length > 0
        ? `上一版核心包（依据旧事实选出，仅作参照：保留仍成立的、删去摘要中已不存在的、补上新事实需要的）：${priorIds.join('、')}\n`
        : '';
    const prompt = `你是代码架构分析师。以下是某项目的代码索引摘要（包 id / 语言 / 顶层实体 / 入口文件${methods ? '/方法/真实调用边' : ''}）。\n`
        + `请从摘要中选出构成这个项目核心流程的 ${MIN_CORE}-${MAX_CORE} 个核心包 id（如启动、请求处理、主循环涉及的关键包）。\n`
        + priorLine
        + `只能使用摘要中出现的包 id，不要编造。\n`
        + `输出语言：${language}。\n`
        + `严格按以下格式输出，不要输出其他内容：\n`
        + `{"core": ["id1", "id2", ...]}\n\n`
        + `项目摘要：\n${indexSummary(index, { fields: { deps: false }, methods })}`;
    const out = await llmText(ctx, prompt, 0.3, undefined, 'core', signal);
    return validateIds(index, extractCoreJson(out));
}
/**
 * READ-ONLY core selection: serve the versioned cache when its facts version
 * matches; null when absent/stale. NEVER generates (no profile, no LLM pick,
 * no deterministic fallback, no cache write) — generation is owned by the
 * write paths (AI 生成 / regenerate). D2: 架构概览 has no rule fallback on
 * read — facts appear only after a rescan plus the user's generate action.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @param methods - 🔬 方法级 cache variant.
 * @returns the cached selection, or null when no matching cache exists.
 */
export async function readCore(fs, root, language, methods = false) {
    const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null);
    if (cacheTarget === null)
        return null;
    const factsVersion = await readFactVersion(fs, root);
    const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
    if (cached !== null && typeof cached === 'object' && Array.isArray(cached.ids) && (cached.source === 'flow' || cached.source === 'curated')) {
        console.log(`[arch-lens] core: served from cache (read-only, lang=${language})`);
        return cached;
    }
    return null;
}
/**
 * The full core-selection chain: cache → LLM pick (validated) → deterministic
 * fallback. `force` bypasses the cache and rebuilds the selection facts.
 * WRITE path only: reads happen through readCore().
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result.
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @returns the core selection, or an error result.
 */
export async function coreGraph(ctx, fs, root, index, language, force, sandboxPolicy, methods = false) {
    const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null);
    const factsVersion = await readFactVersion(fs, root);
    if (!force && cacheTarget !== null) {
        const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
        if (cached !== null && typeof cached === 'object' && Array.isArray(cached.ids) && (cached.source === 'flow' || cached.source === 'curated')) {
            console.log(`[arch-lens] core: served from cache (lang=${language}${methods ? ', method-level' : ''})`);
            return cached;
        }
    }
    // 统一写入口：核心子图依赖所选核心包（deps = result.ids，规则在 figureDeps）。
    const writeCache = async (result) => {
        await writeFigure(fs, root, 'core', language, factsVersion, result, { methods, policy: sandboxPolicy });
    };
    // 小仓库（包数 < MIN_CORE）：「请选 4-25 个核心包」对只有 1-3 个包的仓库
    // 无意义——profile/LLM 永远凑不齐 4 个，只能落到下方『确定性兜底』，而那个
    // 分支有意不写缓存（多包场景下次重试 LLM 更有价值），于是只读侧
    // readCore() 永远读空 → 架构概览/依赖图 static 空白。小仓库里整个仓库
    // 就是核心流：确定性选取全部包并落缓存（source 'curated'），generateAll
    // 之后只读概览立即可读。大仓库（≥ MIN_CORE）不受影响，原链不变。
    const totalPackages = index.packages.length;
    if (totalPackages > 0 && totalPackages < MIN_CORE) {
        const allIds = index.packages.map(pkg => pkg.id);
        console.log(`[arch-lens] core: small workspace (${totalPackages} package${totalPackages === 1 ? '' : 's'}) — all packages as the core`);
        const result = { ids: allIds, source: 'curated', ref: 'small workspace: every package forms the core flow' };
        await writeCache(result);
        return result;
    }
    if (totalPackages === 0) {
        return { error: 'core selection failed: the code index contains no packages' };
    }
    // Stage: shared analysis profile ids (validated the same way as the pick)
    // — consumed BEFORE the chain-own LLM pick, AFTER the cache. Skipped in
    // method-level mode (the shared profile is entity-level by design).
    if (!methods) {
        const profile = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy);
        const profileIds = validateIds(index, profile.coreIds);
        if (profileIds.length >= MIN_CORE) {
            console.log('[arch-lens] core: shared analysis profile');
            const result = { ids: profileIds, source: 'flow' };
            await writeCache(result);
            return result;
        }
    }
    // LLM pick first: validated ids, source 'flow' (non-authoritative).
    // Phase 1 prior draft: a stale selection seeds revision (force skips it —
    // 🔁 全量重建 stays the clean escape hatch).
    let priorIds = [];
    if (!force && cacheTarget !== null) {
        const stale = await readStalePrior(fs, cacheTarget, factsVersion);
        if (stale !== null && typeof stale === 'object' && Array.isArray(stale.ids))
            priorIds = stale.ids.filter((id) => typeof id === 'string');
    }
    let ids = [];
    try {
        ids = await llmPick(ctx, index, language, generationSignal(root), methods, priorIds);
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