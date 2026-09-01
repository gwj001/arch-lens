/**
 * Flow-diagram generation for the Arch Lens backend, dual path:
 *
 *   resolveDocSet(root, language) → extractFlowBlock(doc, root) over every doc
 *     ├─ verbatim mermaid flowchart block  → rendered as-is (source: 'doc')
 *     ├─ pseudo-code flow block (```text)  → LLM format-transcode (source: 'doc')
 *     └─ (no block in any doc)             → generateFlowFromCode(index)
 *                                            LLM-induced entity flow (source: 'flow')
 *   every stage writes/reads the per-language cache (.arch-lens-flow-<lang>.json)
 *
 * Doc flows are grounded: the mermaid source (or the pseudo-code original, for
 * transcoded ones) is kept as `sourceText` with a `#heading` anchor so explains
 * can cite verbatim evidence. Induced flows declare themselves non-authoritative
 * (`source: 'flow'`), matching the concept-tree fallback.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/flow
 */
import { CACHE_DIR } from "./cache-dir.js";
import { readFactVersion, readStalePrior, readVersionedCache } from "./fact-cache.js";
import { writeFigure } from "./figures.js";
import { workspaceRelative } from "./paths.js";
import { DOC_READ_BYTES, HEADING_RE, resolveDocSet } from "./concept.js";
import { indexSummary, llmText, priorRevisionPreamble } from "./docsgen.js";
import { ensureAnalysisProfile } from "./analysis.js";
import { FLOW_ANGLE_LABEL, flowAngleRules, sanitizeMermaid } from "./flow-angle.js";
import { generationSignal } from "./abort.js";
/** Cache file base name; the role language + viewpoint are appended
 * (sanitized), so switching angles never reuses another angle's diagram. */
const FLOW_FILE_BASE = '.arch-lens-flow';
/** Fenced-code-block opener; the captured group is the fence language. */
const FENCE_RE = /^```(\S*)\s*$/;
/** Keep cache file names filesystem-safe (language + angle + method level). */
function cacheName(language, angle, methods = false) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${CACHE_DIR}/${FLOW_FILE_BASE}-${safe === '' ? 'default' : safe}-${angle}${methods ? '-methods' : ''}.json`;
}
/**
 * The AUTHORITATIVE flow cache file name, exported for the figure registry
 * (`figures.ts`): the old generateAll hand-spelled a different name and
 * never matched this file, so flow figures could never be skipped.
 * Consumers must never re-spell cache names.
 * @param language - role language.
 * @param angle - flow viewpoint.
 * @param methods - 🔬 method-level variant.
 * @returns the CACHE_DIR-relative cache file name.
 */
export function flowCacheName(language, angle, methods = false) {
    return cacheName(language, angle, methods);
}
/**
 * Stage: locate the first flow block in an architecture doc. A fenced
 * `mermaid` block whose body starts with `flowchart`/`graph` is returned
 * verbatim; a fenced `text`/`txt` block containing `->` arrows is returned as
 * pseudo-code for transcoding. The nearest preceding heading becomes the
 * source anchor. Pure rule stage — zero LLM, deterministic.
 * @param fs - filesystem service.
 * @param docPath - display path of the doc.
 * @param root - workspace root (refs are workspace-relative).
 * @returns the flow block, or null when the doc has none.
 */
export async function extractFlowBlock(fs, docPath, root) {
    const info = await fs.stat(await fs.resolve(docPath));
    if (info === undefined || info.type !== 'file')
        return null;
    const text = (await fs.readText(await fs.resolve(docPath))).slice(0, DOC_READ_BYTES);
    const lines = text.split('\n');
    let currentHeading = '';
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        const heading = HEADING_RE.exec(trimmed);
        if (heading !== null) {
            currentHeading = heading[2].trim().replace(/[`*_]/g, '').slice(0, 60);
        }
        const fence = FENCE_RE.exec(trimmed);
        if (fence !== null) {
            const lang = fence[1];
            const body = [];
            i += 1;
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                body.push(lines[i]);
                i += 1;
            }
            if (i < lines.length)
                i += 1; // skip the closing fence
            const content = body.join('\n').trim();
            const anchor = `${workspaceRelative(root, docPath)}#${currentHeading === '' ? 'top' : currentHeading.replace(/\s+/g, '-')}`;
            const title = currentHeading === '' ? '流程' : currentHeading;
            if ((lang === 'mermaid' || lang === '') && /\b(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/.test(content)) {
                return { mermaid: content, ref: anchor, title };
            }
            if ((lang === 'text' || lang === 'txt') && content.includes('->')) {
                return { pseudo: content, ref: anchor, title };
            }
            continue;
        }
        i += 1;
    }
    return null;
}
/** Extract mermaid source from an LLM answer (fenced block, or bare source),
 * then repair syntax the model tends to break (see sanitizeMermaid). */
function extractMermaid(out) {
    const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
    if (fenced !== null)
        return sanitizeMermaid(fenced[1].trim());
    const idx = out.search(/\b(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/);
    if (idx < 0)
        return '';
    return sanitizeMermaid(out.slice(idx).trim().replace(/```\s*$/, '').trim());
}
/**
 * Stage: LLM format-transcode of a pseudo-code flow block into a mermaid
 * flowchart. Format only — steps, branches, order and semantics are preserved;
 * labels keep their original terms. The result stays `source: 'doc'` because
 * the evidence is the doc's own text.
 * @param ctx - host context.
 * @param pseudo - the doc's pseudo-code flow block.
 * @param language - role language.
 * @param signal - optional cancellation (⏹ 终止).
 * @returns mermaid flowchart source ('' on failure).
 */
async function transcodeFlow(ctx, pseudo, language, signal) {
    const prompt = `你是流程图转换器。把下面的流程伪代码块转换成 Mermaid flowchart：\n`
        + `- 只转换表示形式，不增删任何步骤、分支、顺序或语义；\n`
        + `- 节点 label 保留原文术语（不翻译）；分支条件作为边的 label；\n`
        + `- 输出语言：${language}（仅用于必要的中文说明，节点术语保持原文）；\n`
        + `- 严格只输出 mermaid 源码（flowchart TD 开头），不要代码块围栏，不要任何解释。\n\n`
        + `流程块：\n${pseudo}`;
    return extractMermaid(await llmText(ctx, prompt, 0.2, undefined, 'flow-transcode', signal));
}
/**
 * Fallback stage: LLM induces a core flow (entity → entity) from the code
 * index metadata — the "no doc flow block" path, language-independent.
 * The requested viewpoint shapes the diagram: event (trigger/consumer story)
 * or pipeline (data-product flow). Result is `source: 'flow'` (non-authoritative).
 * @param ctx - host context.
 * @param index - code index result.
 * @param language - role language.
 * @param angle - flow generation viewpoint.
 * @param signal - optional cancellation (⏹ 终止).
 * @param methods - 🔬 方法级: feed the method-level summary (methods + real
 *   call edges with file:line) so labels can cite real functions.
 * @param prior - prior-draft flow from a STALE cache (phase 1): non-null ⇒
 *   the induction revises that draft instead of starting blank.
 * @returns the induced flow, or null on failure.
 */
export async function generateFlowFromCode(ctx, index, language, angle = 'event', signal, methods = false, prior = null) {
    try {
        const basePrompt = `你是代码架构分析师。以下是某项目的代码索引摘要（包/依赖/实体/入口${methods ? '/方法/真实调用边' : ''}）。\n`
            + `请以「${FLOW_ANGLE_LABEL[angle]}」视角归纳一张可学习的核心流程图。\n`
            + flowAngleRules(angle)
            + (methods ? `- 已开启🔬方法级：节点第二行尽量引用真实方法名/文件（如 \`N["解析配置<br/>（parseConfig，config.ts:41）"]\`），只使用摘要中列出的方法名与调用边；\n` : '')
            + `输出语言：${language}。\n`
            + `严格输出 JSON：{"title": "流程标题", "mermaid": "flowchart TD\\n..."}，mermaid 字段是完整 mermaid flowchart 源码（flowchart TD 开头，不要代码块围栏），不要输出其他内容。\n\n`
            + `项目摘要：\n${indexSummary(index, { fields: { deps: false }, methods })}`;
        const prompt = prior !== null && prior.mermaid !== ''
            ? priorRevisionPreamble(language) + `【上一版流程图】\n标题：${prior.title}\nmermaid：\n${prior.mermaid}\n\n${basePrompt}`
            : basePrompt;
        const out = await llmText(ctx, prompt, 0.3, undefined, 'flow', signal);
        const start = out.indexOf('{');
        const end = out.lastIndexOf('}');
        if (start < 0 || end <= start)
            return null;
        const parsed = JSON.parse(out.slice(start, end + 1));
        const mermaid = typeof parsed.mermaid === 'string' ? extractMermaid(parsed.mermaid) : '';
        if (mermaid === '')
            return null;
        return {
            title: typeof parsed.title === 'string' && parsed.title !== '' ? parsed.title.slice(0, 60) : '核心流程',
            source: 'flow',
            angle,
            mermaid,
        };
    }
    catch (error) {
        console.warn(`[arch-lens] flow induction failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
/**
 * READ-ONLY flow diagram: serve the versioned cache when its facts version
 * matches; null when absent/stale. NEVER generates (no doc scan, no
 * transcode, no profile, no LLM, no cache write) — generation is owned by
 * the write paths (AI 生成 / regenerate).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @param angle - flow viewpoint (cache key).
 * @param methods - 🔬 方法级 cache variant.
 * @returns the cached diagram, or null when no matching cache exists.
 */
export async function readFlow(fs, root, language, angle = 'event', methods = false) {
    const cacheTarget = await fs.resolve(cacheName(language, angle, methods), { cwd: root }).catch(() => null);
    if (cacheTarget === null)
        return null;
    const factsVersion = await readFactVersion(fs, root);
    const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
    if (cached !== null && typeof cached === 'object' && typeof cached.mermaid === 'string') {
        console.log(`[arch-lens] flow: served from cache (read-only, lang=${language}, angle=${angle})`);
        // Repair syntax broken by the LLM even when it was cached before
        // the sanitizer existed — stale caches render again without rescan.
        return { ...cached, mermaid: sanitizeMermaid(cached.mermaid) };
    }
    return null;
}
/**
 * The full flow chain: cache → doc (verbatim mermaid, else LLM transcode of a
 * pseudo-code block) → shared analysis profile → LLM induction from code
 * metadata. `force` bypasses the cache and rebuilds the figure's facts.
 * WRITE path only: reads happen through readFlow().
 * The cache and the induced results are keyed by the requested viewpoint
 * (angle); doc flows are angle-independent and win whenever a doc carries a
 * flow block (documented authority order is unchanged).
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (for the induction fallback).
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @param angle - flow generation viewpoint (default 'event').
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @param methods - 🔬 方法级: skip the shared (entity-level) profile and
 *   induce from the method-level summary; caches get a `-methods` suffix so
 *   entity and method diagrams never collide.
 * @returns the flow diagram, or an error result.
 */
export async function flowDiagram(ctx, fs, root, index, language, force, angle = 'event', sandboxPolicy, methods = false) {
    const cacheTarget = await fs.resolve(cacheName(language, angle, methods), { cwd: root }).catch(() => null);
    const factsVersion = await readFactVersion(fs, root);
    if (!force && cacheTarget !== null) {
        const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
        if (cached !== null && typeof cached === 'object' && typeof cached.mermaid === 'string') {
            console.log(`[arch-lens] flow: served from cache (lang=${language}, angle=${angle})`);
            // Repair syntax broken by the LLM even when it was cached before
            // the sanitizer existed — stale caches render again without rescan.
            return { ...cached, mermaid: sanitizeMermaid(cached.mermaid) };
        }
    }
    // 统一写入口（注册表文件名 + deps 规则单一来源）：文档流程块 deps 为空
    // （永不失效），AI 归纳依赖全部包——规则在 figures.ts figureDeps 里只此一份。
    const writeCache = async (result) => {
        await writeFigure(fs, root, angle === 'pipeline' ? 'flow-pipeline' : 'flow-event', language, factsVersion, result, { index, methods, policy: sandboxPolicy });
    };
    // Stage 1: docs first — but ONLY for the entity × event cell of the n×n
    // granularity × angle matrix. A doc flow block is a single "claimed" story:
    // it has no angle annotation and no method-level detail, so feeding it to
    // every cell made 事件驱动/数据管道 (and method-level) render IDENTICAL
    // diagrams — the matrix collapsed to one picture. The doc claim now anchors
    // the entity-event cell only; entity-pipeline and both method-level cells
    // resolve through the profile / method-level induction, so each cell keeps
    // its own semantics from the SAME algorithm with different inputs.
    // (scan the resolved doc set — whitelist + one-hop links, language variants
    // merged to ONE read per logical doc — for a flow block: verbatim mermaid,
    // or LLM transcode of a pseudo-code block. The first doc that carries a
    // flow block decides; a failed transcode falls through to the induction.)
    if (!methods && angle === 'event') {
        // README is excluded as a hub (its hierarchy is a usage TOC, not an
        // architecture claim) — the diagrams doc it used to link enters the set
        // explicitly so doc flows still work.
        for (const docPath of await resolveDocSet(fs, root, language, ['README.md'], ['docs/arch-lens-diagrams.md'])) {
            const block = await extractFlowBlock(fs, docPath, root);
            if (block === null)
                continue;
            if (block.mermaid !== undefined) {
                const result = { title: block.title, source: 'doc', ref: block.ref, sourceText: block.mermaid, mermaid: block.mermaid };
                await writeCache(result);
                return result;
            }
            if (block.pseudo !== undefined) {
                const mermaid = await transcodeFlow(ctx, block.pseudo, language, generationSignal(root));
                if (mermaid !== '') {
                    const result = { title: block.title, source: 'doc', ref: block.ref, sourceText: block.pseudo, mermaid };
                    await writeCache(result);
                    return result;
                }
            }
            break;
        }
    }
    // Stage 1.5: shared analysis profile (consumed AFTER docs, BEFORE the
    // chain-own LLM induction) — SKIPPED in method-level mode: the shared
    // profile is entity-level by design, so a 🔬 request goes straight to its
    // own method-level induction (the profile never carries methods).
    if (!methods) {
        const profile = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy);
        const profileFlow = profile.flow?.[angle];
        if (profileFlow !== undefined && profileFlow.mermaid !== '') {
            console.log(`[arch-lens] flow: shared analysis profile (angle=${angle})`);
            const result = {
                title: profileFlow.title,
                source: 'flow',
                angle,
                mermaid: sanitizeMermaid(profileFlow.mermaid),
            };
            await writeCache(result);
            return result;
        }
    }
    // Fallback: LLM induction from code metadata (source: 'flow', non-authoritative).
    console.log(`[arch-lens] flow: no doc flow block — inducing from code metadata (angle=${angle}${methods ? ', method-level' : ''})`);
    // Phase 1 prior draft: a stale flow cache seeds revision (force skips it —
    // 🔁 全量重建 stays the clean escape hatch).
    let prior = null;
    if (!force && cacheTarget !== null) {
        const stale = await readStalePrior(fs, cacheTarget, factsVersion);
        if (stale !== null && typeof stale === 'object' && typeof stale.mermaid === 'string' && stale.mermaid !== '')
            prior = stale;
    }
    const induced = await generateFlowFromCode(ctx, index, language, angle, generationSignal(root), methods, prior);
    if (induced === null)
        return { error: 'flow generation failed: no doc flow block and LLM induction returned nothing' };
    await writeCache(induced);
    return induced;
}
//# sourceMappingURL=flow.js.map