/**
 * Concept-hierarchy generation for the Arch Lens backend, as a replaceable
 * one-way chain:
 *
 *   detectArchDocs(root) → extractDocTree(doc)
 *                      ↘ (no doc) generateFromFlow(index)
 *   every stage writes/reads the per-language cache (.arch-lens-concept-<lang>.json)
 *
 * Doc extraction is VERBATIM (no LLM enhancement): nodes carry the original
 * section text and a source anchor so explains can cite evidence. The chain
 * order is FIXED today (docs first, LLM-from-flow as fallback) but each stage
 * is an independent function, so the strategy can be reordered or swapped
 * without touching consumers.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/concept
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** Cache file base name; the role language is appended (sanitized). */
const CONCEPT_FILE_BASE = '.arch-lens-concept';
/** Candidate architecture-doc files, relative to the workspace root. */
const DOC_CANDIDATES = [
    'docs/architecture.md',
    'docs/architecture.zh.md',
    'ARCHITECTURE.md',
    'docs/ARCHITECTURE.md',
    'docs/design.md',
    'docs/overview.md',
    'README.md',
];
/**
 * Language-ordered doc candidates: non-English roles read the zh translation
 * first (docs/architecture.zh.md), English keeps the primary doc first.
 * @param language - role language ('English' or a non-English default).
 * @returns the candidate list in probe order.
 */
export function docCandidates(language) {
    if (language === 'English')
        return DOC_CANDIDATES;
    const [primary, zh, ...rest] = DOC_CANDIDATES;
    return [zh, primary, ...rest];
}
/** Markdown heading levels that become tree depth (shared with flow.ts). */
export const HEADING_RE = /^(#{1,6})\s+(.+)$/;
/** Keep cache file names filesystem-safe. */
function cacheName(language) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${CONCEPT_FILE_BASE}-${safe === '' ? 'default' : safe}.json`;
}
/**
 * Stage 1: probe the workspace for architecture documentation. Returns the
 * first candidate that exists as a file (README last — it is the weakest
 * signal and also the fallback for blurbs). Non-English roles probe the zh
 * translation first.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language ('English' or a non-English default).
 * @returns the doc's display path, or null when no candidate exists.
 */
export async function detectArchDocs(fs, root, language) {
    for (const candidate of docCandidates(language)) {
        try {
            const target = await fs.resolve(candidate, { cwd: root });
            const info = await fs.stat(target);
            if (info !== undefined && info.type === 'file')
                return target.displayPath;
        }
        catch {
            // absent candidate — keep probing
        }
    }
    return null;
}
/**
 * Stage 2: extract a concept tree from a Markdown doc by its heading
 * hierarchy. Pure rule stage — zero LLM, deterministic. Every node carries
 * its source anchor (`ref`: doc path + heading) and the section's full
 * original text (`sourceText`, bounded) so explains can cite verbatim
 * evidence instead of paraphrase.
 * @param fs - filesystem service.
 * @param docPath - display path of the doc.
 * @returns the extracted tree (may be empty when the doc has no headings).
 */
export async function extractDocTree(fs, docPath) {
    const info = await fs.stat(await fs.resolve(docPath));
    if (info === undefined || info.type !== 'file')
        return [];
    const text = (await fs.readText(await fs.resolve(docPath))).slice(0, 262144);
    const roots = [];
    const stack = [];
    let currentDesc = '';
    let currentText = [];
    let pendingNode = null;
    const flush = () => {
        if (pendingNode !== null) {
            pendingNode.desc = currentDesc.trim().slice(0, 220);
            const full = currentText.join('\n').trim();
            if (full !== '')
                pendingNode.sourceText = full.slice(0, 2000);
            pendingNode = null;
        }
        currentDesc = '';
        currentText = [];
    };
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        const heading = HEADING_RE.exec(trimmed);
        if (heading !== null) {
            flush();
            const level = heading[1].length;
            const name = heading[2].trim().replace(/[`*_]/g, '').slice(0, 60);
            const node = {
                id: `doc:${roots.length}-${stack.length}`,
                name,
                desc: '',
                source: 'doc',
                ref: `${docPath.replace(/\\/g, '/')}#${heading[2].trim().replace(/\s+/g, '-')}`,
            };
            while (stack.length > 0 && stack[stack.length - 1].level >= level)
                stack.pop();
            if (stack.length === 0) {
                roots.push(node);
            }
            else {
                const parent = stack[stack.length - 1].node;
                if (parent.children === undefined)
                    parent.children = [];
                parent.children.push(node);
            }
            stack.push({ level, node });
            pendingNode = node;
            continue;
        }
        if (trimmed === '' || trimmed.startsWith('<!--')) {
            if (pendingNode !== null && currentText.length > 0)
                currentText.push('');
            continue;
        }
        if (pendingNode !== null) {
            const content = trimmed.slice(0, 400);
            currentText.push(content);
            currentDesc += (currentDesc === '' ? '' : ' ') + content;
            if (currentDesc.length > 600) {
                currentDesc = currentDesc.slice(0, 600);
            }
        }
    }
    flush();
    return roots;
}
/**
 * Fallback stage: LLM induces a concept tree from the run-flow metadata
 * (entry files, imports, entities) — the "no architecture doc" path. Output
 * is the role language; the tree is bounded to keep the request small.
 * @param ctx - host context.
 * @param index - code index result.
 * @param language - role language.
 * @returns the induced tree (empty on failure).
 */
export async function generateFromFlow(ctx, index, language) {
    const llm = ctx.get('llm');
    const defaultModel = ctx.get('agentDefaultModel');
    if (llm === undefined || defaultModel === undefined)
        return [];
    try {
        const selection = defaultModel.currentSelection();
        const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature: 0.3, maxTokens: 3000 });
        const cfg = prepared.config;
        const entryLines = index.packages
            .filter(pkg => pkg.entryFiles.length > 0)
            .slice(0, 30)
            .map(pkg => `- ${pkg.id}（入口：${pkg.entryFiles.slice(0, 3).join(', ')}，依赖：${pkg.deps.slice(0, 5).join(', ') || '无'}）`)
            .join('\n');
        const prompt = `你是代码架构分析师。以下是某项目的包入口与依赖元数据。\n`
            + `请归纳这个项目「是怎么运作的」：识别运行核心概念（如入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳，不要生搬硬套），组织成概念层级树。\n`
            + `输出语言：${language}。\n`
            + `严格输出 JSON 对象数组（最多 12 个根节点，每个节点含 name/desc/inside/children）：[{ "name": "...", "desc": "...", "inside": "...", "children": [] }]，不要输出其他内容。\n\n`
            + entryLines;
        let out = '';
        for await (const chunk of prepared.stream({
            provider: cfg.provider, model: cfg.model,
            ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
            ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
            ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
            ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
            messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
        })) {
            if (chunk.type === 'text-delta')
                out += chunk.text;
        }
        const start = out.indexOf('[');
        const end = out.lastIndexOf(']');
        if (start < 0 || end <= start)
            return [];
        const parsed = JSON.parse(out.slice(start, end + 1));
        const build = (item, idPrefix, depth) => {
            if (typeof item.name !== 'string' || item.name === '')
                return null;
            const node = {
                id: `${idPrefix}-${depth}`,
                name: item.name.slice(0, 60),
                desc: typeof item.desc === 'string' ? item.desc.slice(0, 220) : '',
                source: 'flow',
            };
            if (typeof item.inside === 'string' && item.inside !== '')
                node.inside = item.inside.slice(0, 400);
            if (Array.isArray(item.children) && depth < 3) {
                const children = item.children
                    .map((child, i) => build(child, `${idPrefix}-${depth}-${i}`, depth + 1))
                    .filter((child) => child !== null);
                if (children.length > 0)
                    node.children = children;
            }
            return node;
        };
        return parsed.map((item, i) => build(item, `flow-${i}`, 0)).filter((node) => node !== null);
    }
    catch (error) {
        console.warn(`[arch-lens] concept flow generation failed: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}
/**
 * The full concept-tree chain: cache → detect doc → extract (verbatim, with
 * source anchors) → (no doc) generate from flow. No LLM enhancement — nodes
 * carry the document's original text so explains can cite evidence. Every
 * successful stage writes the language cache; `force` bypasses it.
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (for the flow fallback).
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @returns the concept tree, or an error result.
 */
export async function conceptTree(ctx, fs, root, index, language, force) {
    const cacheTarget = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null);
    if (!force && cacheTarget !== null) {
        try {
            const info = await fs.stat(cacheTarget);
            if (info !== undefined && info.type === 'file') {
                const cached = JSON.parse(await fs.readText(cacheTarget));
                console.log(`[arch-lens] concept: served from cache (lang=${language})`);
                return cached;
            }
        }
        catch {
            // stale/corrupt cache → regenerate
        }
    }
    const writeCache = async (tree) => {
        if (cacheTarget === null)
            return;
        try {
            await fs.writeText(cacheTarget, JSON.stringify(tree));
        }
        catch {
            // cache write failures are non-fatal
        }
    };
    // Stage 1: docs first (verbatim extraction, no LLM touching the text).
    const docPath = await detectArchDocs(fs, root, language);
    if (docPath !== null) {
        console.log(`[arch-lens] concept: doc chain (${docPath})`);
        const tree = await extractDocTree(fs, docPath);
        if (tree.length > 0) {
            await writeCache(tree);
            return tree;
        }
    }
    // Fallback: LLM from run-flow metadata (nodes carry source: 'flow').
    console.log('[arch-lens] concept: no usable doc headings — generating from flow');
    const tree = await generateFromFlow(ctx, index, language);
    if (tree.length === 0)
        return { error: 'concept generation failed: no doc and LLM flow generation returned nothing' };
    await writeCache(tree);
    return tree;
}
//# sourceMappingURL=concept.js.map