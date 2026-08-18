/**
 * Flow-diagram generation for the Arch Lens backend, dual path:
 *
 *   docCandidates(language) → extractFlowBlock(doc) over every existing doc
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
import { HEADING_RE, docCandidates } from "./concept.js";
import { indexSummary, llmText } from "./docsgen.js";
/** Cache file base name; the role language is appended (sanitized). */
const FLOW_FILE_BASE = '.arch-lens-flow';
/** Fenced-code-block opener; the captured group is the fence language. */
const FENCE_RE = /^```(\S*)\s*$/;
/** Keep cache file names filesystem-safe. */
function cacheName(language) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${FLOW_FILE_BASE}-${safe === '' ? 'default' : safe}.json`;
}
/**
 * Stage: locate the first flow block in an architecture doc. A fenced
 * `mermaid` block whose body starts with `flowchart`/`graph` is returned
 * verbatim; a fenced `text`/`txt` block containing `->` arrows is returned as
 * pseudo-code for transcoding. The nearest preceding heading becomes the
 * source anchor. Pure rule stage — zero LLM, deterministic.
 * @param fs - filesystem service.
 * @param docPath - display path of the doc.
 * @returns the flow block, or null when the doc has none.
 */
export async function extractFlowBlock(fs, docPath) {
    const info = await fs.stat(await fs.resolve(docPath));
    if (info === undefined || info.type !== 'file')
        return null;
    const text = (await fs.readText(await fs.resolve(docPath))).slice(0, 262144);
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
            const anchor = `${docPath.replace(/\\/g, '/')}#${currentHeading === '' ? 'top' : currentHeading.replace(/\s+/g, '-')}`;
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
/** Extract mermaid source from an LLM answer (fenced block, or bare source). */
function extractMermaid(out) {
    const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
    if (fenced !== null)
        return fenced[1].trim();
    const idx = out.search(/\b(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/);
    if (idx < 0)
        return '';
    return out.slice(idx).trim().replace(/```\s*$/, '').trim();
}
/**
 * Stage: LLM format-transcode of a pseudo-code flow block into a mermaid
 * flowchart. Format only — steps, branches, order and semantics are preserved;
 * labels keep their original terms. The result stays `source: 'doc'` because
 * the evidence is the doc's own text.
 * @param ctx - host context.
 * @param pseudo - the doc's pseudo-code flow block.
 * @param language - role language.
 * @returns mermaid flowchart source ('' on failure).
 */
async function transcodeFlow(ctx, pseudo, language) {
    const prompt = `你是流程图转换器。把下面的流程伪代码块转换成 Mermaid flowchart：\n`
        + `- 只转换表示形式，不增删任何步骤、分支、顺序或语义；\n`
        + `- 节点 label 保留原文术语（不翻译）；分支条件作为边的 label；\n`
        + `- 输出语言：${language}（仅用于必要的中文说明，节点术语保持原文）；\n`
        + `- 严格只输出 mermaid 源码（flowchart TD 开头），不要代码块围栏，不要任何解释。\n\n`
        + `流程块：\n${pseudo}`;
    return extractMermaid(await llmText(ctx, prompt, 0.2));
}
/**
 * Fallback stage: LLM induces a core flow (entity → entity) from the code
 * index metadata — the "no doc flow block" path, language-independent.
 * Result is `source: 'flow'` (non-authoritative).
 * @param ctx - host context.
 * @param index - code index result.
 * @param language - role language.
 * @returns the induced flow, or null on failure.
 */
export async function generateFlowFromCode(ctx, index, language) {
    try {
        const prompt = `你是代码架构分析师。以下是某项目的代码索引摘要（包/依赖/实体/入口）。\n`
            + `请归纳出这个项目最有代表性的一条核心流程（如启动、请求处理、主循环——选一条，不要多条）：谁 → 谁，按什么顺序流转，含关键分支。\n`
            + `输出语言：${language}。\n`
            + `严格输出 JSON：{"title": "流程标题", "mermaid": "flowchart TD\\n..."}，mermaid 字段是完整 mermaid flowchart 源码（flowchart TD 开头，不要代码块围栏），不要输出其他内容。\n\n`
            + `项目摘要：\n${indexSummary(index)}`;
        const out = await llmText(ctx, prompt, 0.3);
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
            mermaid,
        };
    }
    catch (error) {
        console.warn(`[arch-lens] flow induction failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
/**
 * The full flow chain: cache → doc (verbatim mermaid, else LLM transcode of a
 * pseudo-code block) → (none) LLM induction from code metadata. `force`
 * bypasses the cache and rebuilds the figure's facts.
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (for the induction fallback).
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @returns the flow diagram, or an error result.
 */
export async function flowDiagram(ctx, fs, root, index, language, force, sandboxPolicy) {
    const cacheTarget = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null);
    if (!force && cacheTarget !== null) {
        try {
            const info = await fs.stat(cacheTarget);
            if (info !== undefined && info.type === 'file') {
                const cached = JSON.parse(await fs.readText(cacheTarget));
                if (typeof cached === 'object' && typeof cached.mermaid === 'string') {
                    console.log(`[arch-lens] flow: served from cache (lang=${language})`);
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
    // Stage 1: docs first — scan every language-ordered candidate doc for a
    // flow block: verbatim mermaid, or LLM transcode of a pseudo-code block.
    // The first doc that carries a flow block decides; a failed transcode falls
    // through to the induction fallback below.
    for (const candidate of docCandidates(language)) {
        const target = await fs.resolve(candidate, { cwd: root }).catch(() => null);
        if (target === null)
            continue;
        const info = await fs.stat(target).catch(() => undefined);
        if (info === undefined || info.type !== 'file')
            continue;
        const block = await extractFlowBlock(fs, target.displayPath);
        if (block === null)
            continue;
        if (block.mermaid !== undefined) {
            const result = { title: block.title, source: 'doc', ref: block.ref, sourceText: block.mermaid, mermaid: block.mermaid };
            await writeCache(result);
            return result;
        }
        if (block.pseudo !== undefined) {
            const mermaid = await transcodeFlow(ctx, block.pseudo, language);
            if (mermaid !== '') {
                const result = { title: block.title, source: 'doc', ref: block.ref, sourceText: block.pseudo, mermaid };
                await writeCache(result);
                return result;
            }
        }
        break;
    }
    // Fallback: LLM induction from code metadata (source: 'flow', non-authoritative).
    console.log('[arch-lens] flow: no doc flow block — inducing from code metadata');
    const induced = await generateFlowFromCode(ctx, index, language);
    if (induced === null)
        return { error: 'flow generation failed: no doc flow block and LLM induction returned nothing' };
    await writeCache(induced);
    return induced;
}
//# sourceMappingURL=flow.js.map