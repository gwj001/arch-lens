/**
 * Concept-hierarchy generation for the Arch Lens backend, as a replaceable
 * one-way chain:
 *
 *   resolveDocSet(root) → extractDocTree(each doc in the set)
 *                      ↘ (no usable doc) generateFromFlow(index)
 *   every stage writes/reads the per-language cache (.arch-lens-concept-<lang>.json)
 *
 * Doc extraction is VERBATIM (no LLM enhancement): nodes carry the original
 * section text and a source anchor so explains can cite evidence. The chain
 * order is FIXED today (docs first, LLM-from-flow as fallback) but each stage
 * is an independent function, so the strategy can be reordered or swapped
 * without touching consumers.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/concept
 */
import { debug } from "./log.js";
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { CACHE_DIR } from "./cache-dir.js";
import { readFactVersion, readStalePrior, readVersionedCache } from "./fact-cache.js";
import { writeFigure } from "./figures.js";
import { workspaceRelative } from "./paths.js";
import { sectionText } from "./sequence.js";
import { ensureAnalysisProfile } from "./analysis.js";
import { priorRevisionPreamble } from "./docsgen.js";
import { normalizeUsage, recordLlmCall } from "./llm-stats.js";
import { ABORTED_MESSAGE, beginGenerationStage, endGenerationStage, generationSignal, reportGeneration, tailPreview } from "./abort.js";
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
function docCandidates(language) {
    if (language === 'English')
        return DOC_CANDIDATES;
    const [primary, zh, ...rest] = DOC_CANDIDATES;
    return [zh, primary, ...rest];
}
/** Markdown heading levels that become tree depth (shared with flow.ts). */
export const HEADING_RE = /^(#{1,6})\s+(.+)$/;
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName(language, methods = false) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${CACHE_DIR}/${CONCEPT_FILE_BASE}-${safe === '' ? 'default' : safe}${methods ? '-methods' : ''}.json`;
}
/**
 * The AUTHORITATIVE concept cache file name, exported for the figure
 * registry (`figures.ts`): consumers must never re-spell cache names.
 * @param language - role language.
 * @param methods - 🔬 method-level variant.
 * @returns the CACHE_DIR-relative cache file name.
 */
export function conceptCacheName(language, methods = false) {
    return cacheName(language, methods);
}
// ─────────────────────────────────────────────────────────────────────────
// Doc-set resolution: whitelist + one-hop link following + language-variant merge
// ─────────────────────────────────────────────────────────────────────────
/** Logical-doc cap for the doc set (whitelist hits + followed refs), guarding hub-style READMEs. */
const DOC_SET_LIMIT = 8;
/**
 * Verbatim read window every doc chain applies per doc (extractDocTree /
 * flow block / sequence section). The ONE source: chains must never re-spell
 * the number.
 */
export const DOC_READ_BYTES = 262144;
/** Per-hub read window used for link extraction (links past the cap are not followed). */
const LINK_SCAN_BYTES = 65536;
/** Inline markdown link targets (image links `![](...)` are excluded). */
const INLINE_LINK_RE = /(?<!!)\[[^\]]*\]\(\s*<?([^<>()\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
/** Normalize a workspace-relative path for grouping and comparison. */
function normalizeRel(path) {
    const slashed = path.replace(/\\/g, '/').toLowerCase();
    return slashed.startsWith('./') ? slashed.slice(2) : slashed;
}
/**
 * Language tag of a normalized path: suffix style (`x.zh.md`) or directory
 * style (`zh/x.md`). Only zh/en participate in merging (roles are zh/en).
 * @param rel - normalized workspace-relative path.
 * @returns 'zh' | 'en' | null (null = untagged primary).
 */
function localeTag(rel) {
    if (/(^|[/.])zh(?:-[a-z]+)?(?=\.|\/)/.test(rel))
        return 'zh';
    if (/(^|[/.])en(?:-[a-z]+)?(?=\.|\/)/.test(rel))
        return 'en';
    return null;
}
/** Logical-doc key: the path stripped of zh/en suffix and directory markers. */
function logicalKey(rel) {
    return rel
        .replace(/\.zh(?:-[a-z]+)?(?=\.)/, '')
        .replace(/\.en(?:-[a-z]+)?(?=\.)/, '')
        .replace(/(^|\/)zh(?:-[a-z]+)?\//, '$1')
        .replace(/(^|\/)en(?:-[a-z]+)?\//, '$1');
}
/** .md link targets of a doc body: #fragments stripped, schemes/anchors/non-md skipped. */
function extractMdLinks(text) {
    const out = [];
    for (const match of text.matchAll(INLINE_LINK_RE)) {
        let target = match[1] ?? '';
        const hash = target.indexOf('#');
        if (hash >= 0)
            target = target.slice(0, hash);
        try {
            target = decodeURIComponent(target);
        }
        catch {
            // keep the raw spelling when it is not valid percent-encoding
        }
        if (target === '' || target.startsWith('#'))
            continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//'))
            continue;
        if (!target.toLowerCase().endsWith('.md'))
            continue;
        out.push(target.startsWith('/') ? target.slice(1) : target);
    }
    return out;
}
/** Join a link target with the linking doc's directory (resolves ./ and ../). */
function joinDocPath(dir, target) {
    const segments = (dir === '' ? [] : dir.split('/')).concat(target.split('/'));
    const stack = [];
    for (const segment of segments) {
        if (segment === '' || segment === '.')
            continue;
        if (segment === '..')
            stack.pop();
        else
            stack.push(segment);
    }
    return stack.join('/');
}
/**
 * Pick the ONE variant a role reads: Chinese roles prefer zh > primary > en,
 * English roles prefer primary > en > zh.
 * @param variants - discovered variants of a single logical doc.
 * @param language - role language ('English' or a non-English default).
 * @returns the chosen variant.
 */
function pickVariant(variants, language) {
    const priority = language === 'English' ? [null, 'en', 'zh'] : ['zh', null, 'en'];
    for (const tag of priority) {
        const index = variants.findIndex(v => localeTag(v.rel) === tag);
        if (index >= 0)
            return variants[index];
    }
    return variants[0];
}
/**
 * Resolve the ordered doc set every doc-first chain reads (deterministic,
 * zero LLM): the whitelist candidates (zh-ordered) PLUS one hop of inline
 * markdown links found inside those docs (workspace-relative `.md` targets
 * only). Language variants are MERGED — `docs/x.md`, `docs/x.zh.md` and
 * `docs/zh/x.md` are ONE logical doc and only the role-language variant is
 * read, exactly once; links to another language of an already-listed doc
 * (README language-switch rows) collapse into the same group instead of
 * double-reading. Links inside FOLLOWED docs are not expanded (one hop,
 * loop-proof) and the set is capped at {@link DOC_SET_LIMIT} logical docs.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (variant pick + candidate ordering).
 * @param excludeRel - workspace-relative doc paths to EXCLUDE as hubs: a
 *   chain that must not read a doc's claims (e.g. the concept tree skipping
 *   the README's usage-oriented hierarchy) drops the hub BEFORE its links
 *   are followed, so nothing it links to enters the set either.
 * @param extraCandidates - additional workspace-relative candidate paths
 *   registered AFTER the whitelist (as hubs, links followed): lets a chain
 *   that excluded the README hub still reach docs the README used to link
 *   (e.g. the flow chain reaching a diagrams doc for doc flows).
 * @returns chosen display paths: hubs first, followed refs in link order.
 */
export async function resolveDocSet(fs, root, language, excludeRel, extraCandidates) {
    const excluded = new Set((excludeRel ?? []).map(rel => normalizeRel(rel)));
    const groups = new Map();
    const order = [];
    const add = (displayPath) => {
        const rel = normalizeRel(workspaceRelative(root, displayPath));
        if (excluded.has(rel))
            return;
        const key = logicalKey(rel);
        let list = groups.get(key);
        if (list === undefined) {
            if (groups.size >= DOC_SET_LIMIT)
                return;
            list = [];
            groups.set(key, list);
            order.push(key);
        }
        if (!list.some(v => v.rel === rel))
            list.push({ rel, displayPath });
    };
    const statFile = async (wsRel) => {
        try {
            const target = await fs.resolve(wsRel, { cwd: root });
            const info = await fs.stat(target);
            return info !== undefined && info.type === 'file' ? target.displayPath : null;
        }
        catch {
            return null; // absent / unreadable candidate — not part of the set
        }
    };
    // ① Whitelist: register EVERY hit. Variant merging relies on logical
    // grouping, so the probe no longer stops at the first existing file —
    // "which doc carries the section" is decided by the chains scanning the set.
    // ①b docs/ sweep: every .md directly inside docs/ is a candidate (sorted
    // by name — deterministic), EXCEPT plugin-generated chapters
    // (*.generated.md): those are OUTPUTS of this plugin, and reading them
    // back as claims would self-reference (a chapter tree re-extracted into
    // the concept tree). A missing/unreadable docs/ dir skips the sweep.
    const sweepCandidates = [];
    try {
        const entries = await fs.listDir(await fs.resolve('docs', { cwd: root }));
        for (const entry of entries) {
            if (entry.type !== 'file')
                continue;
            if (!entry.name.endsWith('.md') || entry.name.endsWith('.generated.md'))
                continue;
            sweepCandidates.push(`docs/${entry.name}`);
        }
        sweepCandidates.sort();
    }
    catch {
        // no docs/ directory (or unreadable) — sweep contributes nothing
    }
    const hubKeys = [];
    for (const candidate of [...docCandidates(language), ...sweepCandidates, ...(extraCandidates ?? [])]) {
        const found = await statFile(candidate);
        if (found === null)
            continue;
        const key = logicalKey(normalizeRel(workspaceRelative(root, found)));
        if (groups.has(key))
            continue; // another language of a known logical doc
        // An excluded candidate must be skipped BEFORE it becomes a hub —
        // otherwise hubKeys would name a group that never registered and the
        // link-following pass would crash on pickVariant(undefined).
        if (excluded.has(normalizeRel(workspaceRelative(root, found))))
            continue;
        add(found);
        hubKeys.push(key);
        if (groups.size >= DOC_SET_LIMIT)
            break;
    }
    // ② One hop: scan the links of the variant-selected hubs only.
    for (const key of hubKeys) {
        if (groups.size >= DOC_SET_LIMIT)
            break;
        const hub = pickVariant(groups.get(key), language);
        let text = '';
        try {
            text = (await fs.readText(await fs.resolve(hub.displayPath))).slice(0, LINK_SCAN_BYTES);
        }
        catch {
            continue;
        }
        const dir = hub.rel.slice(0, hub.rel.lastIndexOf('/') + 1);
        for (const target of extractMdLinks(text)) {
            if (groups.size >= DOC_SET_LIMIT)
                break;
            const found = await statFile(joinDocPath(dir, target));
            if (found !== null)
                add(found);
        }
    }
    return order.map(key => pickVariant(groups.get(key), language).displayPath);
}
/**
 * Stage 2: extract a concept tree from a Markdown doc by its heading
 * hierarchy. Pure rule stage — zero LLM, deterministic. Every node carries
 * its source anchor (`ref`: doc path + heading) and the section's full
 * original text (`sourceText`, bounded) so explains can cite verbatim
 * evidence instead of paraphrase.
 * @param fs - filesystem service.
 * @param docPath - display path of the doc.
 * @param root - workspace root (refs are workspace-relative).
 * @returns the extracted tree (may be empty when the doc has no headings).
 */
export async function extractDocTree(fs, docPath, root) {
    const info = await fs.stat(await fs.resolve(docPath));
    if (info === undefined || info.type !== 'file')
        return [];
    const text = (await fs.readText(await fs.resolve(docPath))).slice(0, DOC_READ_BYTES);
    return extractTreeFromText(text, docPath, root);
}
/** 声称类文档的文件名关键词（中英双语：与文档语言变体逻辑一致——中文角色
 * 优先 zh 文档、没有才英文，关键词同样双语匹配）。 */
const CLAIM_DOC_KEYWORDS = [
    'design', '设计',
    'overview', '概览', '总览', '全貌',
    'architecture', '架构',
    'concept', '概念',
    '层级', '分层', 'hierarchy',
];
/** Whether a doc's file name claims architecture semantics (design/overview/
 * architecture/concept/层级…). Usage docs (usage/README/交接) never match. */
export function isClaimDoc(rel) {
    const base = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.zh\.md$/, '').replace(/\.md$/, '').toLowerCase();
    return CLAIM_DOC_KEYWORDS.some(keyword => base.includes(keyword));
}
/** A claim doc's heading outline (bounded) — the「文档声称」fact block injected
 * into the concept induction: the project's OWN claimed layering, read as an
 * expectation (not a conclusion). */
export async function docClaimOutline(fs, root, docPath) {
    try {
        const info = await fs.stat(await fs.resolve(docPath));
        if (info === undefined || info.type !== 'file')
            return '';
        const text = (await fs.readText(await fs.resolve(docPath))).slice(0, DOC_READ_BYTES);
        const headings = [];
        for (const line of text.split('\n')) {
            const heading = HEADING_RE.exec(line.trim());
            if (heading !== null) {
                headings.push(line.trim());
                if (headings.length >= 40)
                    break;
            }
        }
        if (headings.length === 0)
            return '';
        return `【${workspaceRelative(root, docPath)}】\n${headings.join('\n')}\n`;
    }
    catch {
        return '';
    }
}
/** Collect the【文档声称】block shared by the concept-tree induction AND the
 * 架构概览 induction: every claim doc (design/overview/architecture/concept/
 * 层级…, bilingual keywords) in the resolved doc set contributes its heading
 * outline. README is excluded (usage TOC). '' when no claim docs exist. */
export async function collectClaimOutlines(fs, root, language) {
    try {
        const docSet = await resolveDocSet(fs, root, language, ['README.md']);
        let claims = '';
        for (const docPath of docSet) {
            if (!isClaimDoc(workspaceRelative(root, docPath)))
                continue;
            claims += await docClaimOutline(fs, root, docPath);
        }
        return claims.trim();
    }
    catch {
        return '';
    }
}
/** Extract a「概念层级」section (中文 / English section titles) from a doc
 * and turn ITS OWN heading hierarchy into a tree — a doc that explicitly
 * writes a concept hierarchy stays zero-LLM verbatim; a doc that merely has
 * deep headings does NOT qualify anymore (that was the README/diagrams
 * mis-extraction: a usage TOC is not a concept tree). */
export async function extractConceptSection(fs, docPath, root) {
    const info = await fs.stat(await fs.resolve(docPath));
    if (info === undefined || info.type !== 'file')
        return [];
    const text = (await fs.readText(await fs.resolve(docPath))).slice(0, DOC_READ_BYTES);
    for (const title of ['概念层级', '概念层', 'Concept Hierarchy']) {
        const section = sectionText(text, title);
        if (section === null || section === '')
            continue;
        return extractTreeFromText(section, docPath, root);
    }
    return [];
}
/** Heading-hierarchy tree from markdown TEXT (shared by whole-doc extraction
 * and concept-section extraction; refs are `docPath#heading` anchors). */
function extractTreeFromText(text, docPath, root) {
    const roots = [];
    const stack = [];
    let currentDesc = '';
    let currentText = [];
    let pendingNode = null;
    // Monotonic id: the old `doc:${roots.length}-${stack.length}` produced the
    // SAME id for every sibling at a given depth, so React saw seven nodes with
    // one key (duplicated/corrupted rendering in the concept graph).
    let seq = 0;
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
                id: `doc:${seq}`,
                name,
                desc: '',
                source: 'doc',
                ref: `${workspaceRelative(root, docPath)}#${heading[2].trim().replace(/\s+/g, '-')}`,
            };
            seq += 1;
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
 * @param signal - optional cancellation (⏹ 终止).
 * @param methods - 🔬 方法级: append per-class method names so concept
 *   descriptions can cite real functions.
 * @param prior - prior-draft tree from a STALE cache (phase 1): non-empty ⇒
 *   the induction revises that draft instead of starting blank.
 * @param claims - 声称类文档的标题大纲（claim docs, bilingual keywords）:
 *   the project's OWN claimed layering, injected as an expectation — not a
 *   conclusion; code facts stay authoritative. '' = no claims available.
 * @returns the induced tree (empty on failure).
 */
export async function generateFromFlow(ctx, index, language, signal, methods = false, prior = null, claims = '') {
    const llm = ctx.get('llm');
    const defaultModel = ctx.get('agentDefaultModel');
    if (llm === undefined || defaultModel === undefined)
        return [];
    try {
        const selection = defaultModel.currentSelection();
        // No hard-coded maxTokens (same reasoning as docsgen.llmText): a local
        // literal (3000) can be fully consumed by reasoning under high reasoning
        // levels, leaving zero output text to parse as JSON.
        const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, temperature: 0.3 }, signal);
        const cfg = prepared.config;
        const entryLines = index.packages
            .filter(pkg => pkg.entryFiles.length > 0)
            .slice(0, 30)
            .map(pkg => {
            const base = `- ${pkg.id}（入口：${pkg.entryFiles.slice(0, 3).join(', ')}，依赖：${pkg.deps.slice(0, 3).join(', ') || '无'}`;
            if (!methods)
                return `${base}）`;
            const methodLines = [];
            for (const entity of pkg.entities) {
                if (entity.kind === 'class' && Array.isArray(entity.children)) {
                    const names = entity.children
                        .filter(child => child.kind === 'method' || child.kind === 'function')
                        .slice(0, 6)
                        .map(child => child.name);
                    if (names.length > 0)
                        methodLines.push(`${entity.name}{${names.join(', ')}}`);
                    if (methodLines.length >= 4)
                        break;
                }
            }
            return `${base}；方法：${methodLines.join('；') || '无'}）`;
        })
            .join('\n');
        const claimBlock = claims === ''
            ? ''
            : `\n【文档声称】该项目文档自述的架构分层（这是"预期"不是"结论"——请参考其分层思路与术语，但以代码事实为准，冲突时以代码事实为准）：\n${claims}\n`;
        const basePrompt = `你是代码架构分析师。以下是某项目的包入口与依赖元数据${methods ? '（含类方法，🔬方法级）' : ''}。\n`
            + `请归纳这个项目「是怎么运作的」：识别运行核心概念（如入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳，不要生搬硬套），组织成概念层级树。\n`
            + claimBlock
            + `输出语言：${language}。\n`
            + `严格输出 JSON 对象数组（最多 12 个根节点，每个节点含 name/desc/inside/children）：[{ "name": "...", "desc": "...", "inside": "...", "children": [] }]，不要输出其他内容。\n\n`
            + entryLines;
        const prompt = prior !== null && prior.length > 0
            ? priorRevisionPreamble(language) + `【上一版概念树】\n${JSON.stringify(prior)}\n\n${basePrompt}`
            : basePrompt;
        const started = Date.now();
        let out = '';
        let usage;
        // ⚙️ live generation status (same mechanism as llmText).
        beginGenerationStage(signal, 'LLM：concept');
        let textTail = '';
        for await (const chunk of prepared.stream({
            provider: cfg.provider, model: cfg.model,
            ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }),
            ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
            ...(cfg.maxTokens === undefined ? {} : { maxTokens: cfg.maxTokens }),
            ...(cfg.stop === undefined ? {} : { stop: cfg.stop }),
            ...(signal === undefined ? {} : { signal }),
            messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
        })) {
            if (signal?.aborted === true) {
                endGenerationStage(signal);
                throw new Error(ABORTED_MESSAGE);
            }
            if (chunk.type === 'text-delta') {
                out += chunk.text;
                textTail = tailPreview(textTail, chunk.text);
                reportGeneration(signal, out.length, textTail);
            }
            if (chunk.type === 'usage')
                usage = chunk.usage;
        }
        if (signal?.aborted === true) {
            endGenerationStage(signal);
            throw new Error(ABORTED_MESSAGE);
        }
        endGenerationStage(signal);
        recordLlmCall(index.root, 'concept', prompt, out, Date.now() - started, normalizeUsage(usage));
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
 * READ-ONLY concept tree: serve the versioned cache when its facts version
 * matches; null when absent/stale. NEVER generates (no doc extraction, no
 * LLM, no cache write) — generation is owned by the write paths (AI 生成 /
 * rescan-dependent regenerate).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (cache key).
 * @param methods - 🔬 方法级 cache variant.
 * @returns the cached tree, or null when no matching cache exists.
 */
export async function readConceptTree(fs, root, language, methods = false) {
    const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null);
    if (cacheTarget === null)
        return null;
    const factsVersion = await readFactVersion(fs, root);
    const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
    if (cached !== null)
        debug(`[arch-lens] concept: served from cache (read-only, lang=${language})`);
    return cached;
}
/**
 * The full concept-tree chain: cache → detect doc → extract (verbatim, with
 * source anchors) → shared profile → (no doc) generate from flow. No LLM
 * enhancement — nodes carry the document's original text so explains can cite
 * evidence. Every successful stage writes the language cache; `force`
 * bypasses it. WRITE path only: reads happen through readConceptTree().
 * @param ctx - host context.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (for the flow fallback).
 * @param language - role language.
 * @param force - regenerate even when cached.
 * @param sandboxPolicy - session-scoped policy for the cache write.
 * @param methods - 🔬 方法级: skip the shared (entity-level) profile and
 *   induce from the method-level summary (methods + call edges).
 * @returns the concept tree, or an error result.
 */
export async function conceptTree(ctx, fs, root, index, language, force, sandboxPolicy, methods = false) {
    const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null);
    const factsVersion = await readFactVersion(fs, root);
    if (!force && cacheTarget !== null) {
        const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
        if (cached !== null) {
            debug(`[arch-lens] concept: served from cache (lang=${language})`);
            return cached;
        }
    }
    // 统一写入口（注册表文件名 + deps 规则单一来源）：概念树是全局归纳，
    // 依赖所有包；写失败抛出，由调用方决定成败。
    const writeCache = async (tree) => {
        await writeFigure(fs, root, 'concepts', language, factsVersion, tree, { index, methods, policy: sandboxPolicy });
    };
    // Stage 1: docs first. A doc only serves VERBATIM when it explicitly writes
    // a「概念层级」section whose own hierarchy is usable — a deep heading TOC
    // (README/usage/diagrams) is NOT a concept tree and no longer qualifies.
    // The README is excluded as a hub (usage TOC, not an architecture claim).
    const docSet = await resolveDocSet(fs, root, language, ['README.md']);
    for (const docPath of docSet) {
        const tree = await extractConceptSection(fs, docPath, root);
        if (isUsableDocTree(tree)) {
            debug(`[arch-lens] concept: doc concept section (${docPath})`);
            await writeCache(tree);
            return tree;
        }
    }
    // Stage 1b: claim docs (design/overview/architecture/concept…, bilingual
    // keywords) whose outline is injected into the induction as【文档声称】—
    // the spine reads the project's own claimed layering as an expectation,
    // then SYNTHESIZES the concept hierarchy from claims + code facts.
    const claims = await collectClaimOutlines(fs, root, language);
    if (claims !== '')
        debug('[arch-lens] concept: claim docs → induction');
    // Stage 1.5: shared analysis profile (one LLM pass across all chains —
    // consumed AFTER docs, BEFORE the chain-own LLM fallback). Skipped in
    // method-level mode (profile is entity-level), AND skipped when claim docs
    // exist: the project's own claimed layering + code facts beat the profile's
    // pure-code induction — 声称→合成 wins over 无声称档案.
    if (!methods && claims === '') {
        const profile = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy);
        if (profile.conceptTree !== undefined && profile.conceptTree.length > 0) {
            debug('[arch-lens] concept: shared analysis profile');
            await writeCache(profile.conceptTree);
            return profile.conceptTree;
        }
    }
    // Fallback: LLM from run-flow metadata (nodes carry source: 'flow').
    debug(`[arch-lens] concept: no usable doc headings — generating from flow${methods ? ' (method-level)' : ''}`);
    // Phase 1 prior draft: a stale concept cache seeds revision (force skips it
    // — 🔁 全量重建 stays the clean escape hatch).
    let prior = null;
    if (!force && cacheTarget !== null) {
        const stale = await readStalePrior(fs, cacheTarget, factsVersion);
        if (stale !== null && Array.isArray(stale) && stale.length > 0)
            prior = stale;
    }
    const tree = await generateFromFlow(ctx, index, language, generationSignal(root), methods, prior, claims);
    if (tree.length === 0)
        return { error: 'concept generation failed: no doc and LLM flow generation returned nothing' };
    await writeCache(tree);
    return tree;
}
/**
 * Whether an extracted doc tree is a usable hierarchy: at least two roots,
 * or at least one node with children. A single flat heading is not a
 * "concept hierarchy" — the figure would show one isolated box.
 * @param tree - the extracted doc tree.
 * @returns whether the tree is worth rendering as the doc authority.
 */
export function isUsableDocTree(tree) {
    if (tree.length >= 2)
        return true;
    return tree.some(node => node.children !== undefined && node.children.length > 0);
}
//# sourceMappingURL=concept.js.map