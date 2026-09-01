/**
 * Entity-level figure registry: one spec per tab figure owning its
 * AUTHORITATIVE cache file name (delegated to the chain module that writes
 * it — the historical generateAll bug hand-spelled cache names and the flow
 * name never matched flow.ts's real file, so flow figures could never be
 * skipped in incremental mode), its dependency rule (`figureDeps`) and its
 * unified build entry. The write paths (generateAll, every chain's cache
 * write via `writeFigure`) consume this registry so there is exactly ONE
 * list of figures, ONE name source, ONE deps rule and ONE force semantic.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/figures
 */
import { invalidateRequiring, readFactVersion, readRawCache, readStalePrior, writeVersionedCache } from "./fact-cache.js";
import { CACHE_DIR } from "./cache-dir.js";
import { conceptTree, conceptCacheName } from "./concept.js";
import { flowDiagram, flowCacheName } from "./flow.js";
import { coreGraph, coreCacheName } from "./core.js";
import { summarizeDuties, summariesCacheName } from "./summarize.js";
import { writeStructuredCache, readStructuredCache, seqCacheName, eventsCacheName } from "./docsgen.js";
import { resolveSequence } from "./sequence.js";
import { ensureAnalysisProfile } from "./analysis.js";
/**
 * The ONE entity-level figure list. Order = the comprehension spine
 * (docs/design-comprehension-spine.md, phase 0): vocabulary (duties) →
 * claims (concepts, doc-first) → protagonists (core) → golden path (seq →
 * flow×2) → reactions (interaction). Cache names and invalidation key on
 * file names, never on this order — reordering is generation-order only.
 */
export const FIGURE_SPECS = [
    {
        id: 'duties',
        cacheName: language => summariesCacheName(language),
        build: env => summarizeDuties(env.ctx, env.fs, env.root, env.graph, env.language, env.policy),
    },
    {
        id: 'concepts',
        cacheName: (language, methods) => conceptCacheName(language, methods === true),
        build: (env, force) => conceptTree(env.ctx, env.fs, env.root, env.index, env.language, force, env.policy),
    },
    {
        id: 'core',
        cacheName: (language, methods) => coreCacheName(language, methods === true),
        build: (env, force) => coreGraph(env.ctx, env.fs, env.root, env.index, env.language, force, env.policy),
    },
    {
        // 完整链（D5）：缓存(非 force)→文档时序节→共享档案 seqMessages→LLM 归纳。
        // code 视图不在此链：callGraph remote 已独立呈现真实调用边。
        id: 'seq',
        cacheName: (language, methods) => seqCacheName(language, methods === true),
        build: async (env, force) => {
            const result = await resolveSequence(env.ctx, env.fs, env.root, env.index, env.language, env.policy, 'flow', false, force);
            return result ?? { error: 'sequence chain produced no usable data' };
        },
    },
    {
        id: 'flow-event',
        cacheName: (language, methods) => flowCacheName(language, 'event', methods === true),
        build: (env, force) => flowDiagram(env.ctx, env.fs, env.root, env.index, env.language, force, 'event', env.policy),
    },
    {
        id: 'flow-pipeline',
        cacheName: (language, methods) => flowCacheName(language, 'pipeline', methods === true),
        build: (env, force) => flowDiagram(env.ctx, env.fs, env.root, env.index, env.language, force, 'pipeline', env.policy),
    },
    {
        // 完整链（D5）：缓存(非 force)→共享档案 events→LLM 归纳。
        id: 'interaction',
        cacheName: (language, methods) => eventsCacheName(language, methods === true),
        build: async (env, force) => {
            if (!force) {
                const cached = await readStructuredCache(env.fs, env.root, env.language, 'interaction');
                if (cached !== null)
                    return cached;
            }
            const profile = await ensureAnalysisProfile(env.ctx, env.fs, env.root, env.index, env.language, env.policy);
            const events = profile.events;
            if (events !== undefined && events.length > 0) {
                const factsVersion = await readFactVersion(env.fs, env.root);
                await writeFigure(env.fs, env.root, 'interaction', env.language, factsVersion, events, { index: env.index, policy: env.policy });
                return events;
            }
            // Phase 1 prior draft: a stale events cache seeds revision (force skips
            // it — 🔁 全量重建 stays the clean escape hatch).
            let prior = null;
            if (!force) {
                const priorTarget = await env.fs.resolve(eventsCacheName(env.language), { cwd: env.root }).catch(() => null);
                if (priorTarget !== null) {
                    const stale = await readStalePrior(env.fs, priorTarget, await readFactVersion(env.fs, env.root));
                    if (Array.isArray(stale))
                        prior = stale;
                }
            }
            return writeStructuredCache(env.ctx, env.fs, env.root, env.index, env.language, 'interaction', env.policy, false, prior);
        },
    },
];
/** Registry lookup by kind (throws on unknown — a programming error). */
function specOrThrow(kind) {
    const spec = FIGURE_SPECS.find(candidate => candidate.id === kind);
    if (spec === undefined)
        throw new Error(`unknown figure kind: ${kind}`);
    return spec;
}
/** The AUTHORITATIVE cache file name for one kind. */
export function specCacheName(kind, language, methods = false) {
    return specOrThrow(kind).cacheName(language, methods);
}
/** The ONE dependency-package rule for every figure cache write. */
export function figureDeps(kind, data, index) {
    const all = index === undefined ? undefined : index.packages.map(pkg => pkg.id);
    switch (kind) {
        // 概念树是全局归纳：依赖全部包。
        case 'concepts':
            return all;
        // 文档流程块（source='doc'）来自文档、与代码无关 → 永不失效；
        // AI 归纳（source='flow'）依赖全部包。
        case 'flow-event':
        case 'flow-pipeline':
            return data?.source === 'doc' ? [] : all;
        // 时序图依赖图上出现的包（from/to）：只有这些包变动才需要重画。
        case 'seq': {
            const messages = Array.isArray(data)
                ? data
                : data?.messages;
            if (!Array.isArray(messages))
                return all;
            const ids = messages
                .flatMap(message => [message.from, message.to])
                .filter((id) => typeof id === 'string' && id !== '');
            return ids.length > 0 ? [...new Set(ids)] : all;
        }
        // 交互图依赖出现过的生产者/消费者。
        case 'interaction': {
            const events = Array.isArray(data) ? data : [];
            const ids = [];
            for (const event of events) {
                for (const list of [event?.producers, event?.consumers]) {
                    if (Array.isArray(list)) {
                        for (const id of list) {
                            if (typeof id === 'string' && id !== '')
                                ids.push(id);
                        }
                    }
                }
            }
            return ids.length > 0 ? [...new Set(ids)] : all;
        }
        // 核心子图依赖所选核心包：只有这些包变动才需要重选。
        case 'core': {
            const ids = data?.ids;
            return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : all;
        }
        // 职责总结按包独立：deps = 已总结的包 id。
        case 'duties':
            return typeof data === 'object' && data !== null ? Object.keys(data) : all;
    }
}
/**
 * The ONE versioned write entry for every tab figure cache: resolves the
 * authoritative file name through the registry and delegates to
 * `writeVersionedCache` — a failed write THROWS by design (callers decide
 * whether persistence failure is fatal). `factsVersion` is the version read
 * AT THE START of the generation (never re-read after the LLM call: facts
 * that moved mid-generation must not get stamped as current). `deps` defaults
 * to the registry rule (`figureDeps`).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param kind - the figure kind (registry key).
 * @param language - role language (cache key).
 * @param factsVersion - the facts version the data was generated against.
 * @param data - the figure payload (chain's canonical shape).
 * @param options - index for the deps rule, method-level variant, explicit
 *   deps override, session sandbox policy.
 */
export async function writeFigure(fs, root, kind, language, factsVersion, data, options = {}) {
    const target = await fs.resolve(specCacheName(kind, language, options.methods === true), { cwd: root });
    await writeVersionedCache(fs, target, data, factsVersion, options.policy, options.deps ?? figureDeps(kind, data, options.index));
    // Spine cascade (phase 2): this figure's CONTENT moved — tombstone every
    // cache that consumed it (chapters embedding this figure). A failed cascade
    // never fails the figure write itself: the dependent simply stays stale
    // until the next rescan. Method-level variants don't cascade entity chapters.
    if (options.methods !== true) {
        const moved = await invalidateRequiring(fs, root, kind, options.policy).catch(() => []);
        if (moved.length > 0)
            console.log(`[arch-lens] writeFigure(${kind}): cascaded invalidation → ${moved.join(', ')}`);
    }
}
/**
 * Whether a figure cache exists and was written against the CURRENT facts
 * version (a versioned envelope with `v === factsVersion`; legacy/corrupt/
 * invalidated files and an unknown facts version all read as invalid).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param cacheFile - the CACHE_DIR-relative file name from a spec.
 * @param factsVersion - the current facts version (0 = unknown ⇒ never valid).
 * @returns whether the cached figure may be served.
 */
export async function isFigureCacheValid(fs, root, cacheFile, factsVersion) {
    if (factsVersion === 0)
        return false;
    const target = await fs.resolve(cacheFile, { cwd: root }).catch(() => null);
    if (target === null)
        return false;
    const raw = await readRawCache(fs, target);
    return raw !== null && raw.v === factsVersion;
}
/**
 * READ-ONLY code-index facts: parse the versioned `{ v, data }` envelope of
 * `index/.arch-lens-index.json` (written by the codeIndex provider during
 * 「↻ 重新扫描」) and refuse anything that is not the CURRENT facts version —
 * legacy unversioned files, foreign versions and missing files all return the
 * "rescan first" error (same shape as before the envelope existed). No index
 * service call, no LLM.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @returns the current index, or a user-facing error string.
 */
export async function readIndexFacts(fs, root) {
    const factsVersion = await readFactVersion(fs, root);
    if (factsVersion === 0)
        return { error: '尚未建立当前索引，请先点击「↻ 重新扫描」' };
    const target = await fs.resolve(`${CACHE_DIR}/.arch-lens-index.json`, { cwd: root }).catch(() => null);
    if (target === null)
        return { error: '找不到代码索引缓存，请先点击「↻ 重新扫描」' };
    const envelope = await readRawCache(fs, target);
    if (envelope === null || envelope.v !== factsVersion) {
        return { error: '代码索引与当前事实版本不一致，请先点击「↻ 重新扫描」' };
    }
    const index = envelope.data;
    if (index === undefined || !Array.isArray(index.packages) || index.packages.length === 0) {
        return { error: '代码索引为空，请先点击「↻ 重新扫描」' };
    }
    return { index };
}
/**
 * The generateAll loop shared by「🔁 全量重建」/「⚡ 变动更新」(behavior
 * unchanged from the hand-rolled steps): incremental mode skips every figure
 * whose cache is valid against the current facts version and force-redraws
 * only the missing/stale ones; non-incremental force-redraws everything.
 * Every step runs even when one fails; the caller formats `errors`.
 * @param env - the figure environment.
 * @param incremental - smart-incremental mode (frontend default: true).
 * @param specs - the figure list (defaults to the registry; parameterized for tests).
 * @returns the rebuilt/skipped ids and collected errors.
 */
export async function runEntityFigurePass(env, incremental, specs = FIGURE_SPECS) {
    const factsVersion = incremental ? await readFactVersion(env.fs, env.root) : 0;
    const rebuilt = [];
    const skipped = [];
    const errors = [];
    for (const spec of specs) {
        if (incremental && await isFigureCacheValid(env.fs, env.root, spec.cacheName(env.language), factsVersion)) {
            skipped.push(spec.id);
            continue;
        }
        try {
            const result = await spec.build(env, true);
            if (typeof result === 'object' && result !== null && 'error' in result) {
                errors.push(`${spec.id}: ${result.error}`);
            }
            else {
                rebuilt.push(spec.id);
            }
        }
        catch (error) {
            errors.push(`${spec.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { rebuilt, skipped, errors };
}
//# sourceMappingURL=figures.js.map