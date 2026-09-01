/**
 * Chapter-based architecture doc generation (V1 docs write path).
 *
 * One chapter per DocKind, each an independent product with its OWN versioned
 * envelope cache and its OWN landed file (`docs/architecture-<kind>.generated.md`).
 * 「一键生成文档」 is the serial loop over the seven chapters: a fresh cache is
 * skipped, everything else regenerates independently (independent envelope,
 * independent failure). A chapter's prose is ONE direct host LLM call per
 * round (llmText — same channel as duty summaries; the interactive session is
 * reserved for explains/dynamic figures), grounded in a bounded fact block
 * packed from READ-ONLY figure caches + code facts, then validated by the
 * hallucination gate (doc-hallucination.ts) with ONE repair round before the
 * envelope stamp — faithful output is the only thing that gets cached.
 *
 * Chapters are PURE CONSUMERS: they never trigger figure generation. A
 * figure-driven chapter whose figure cache is missing is skipped with an
 * actionable reason (generate the figure in its tab first).
 * @module @deepseek-ai/dsh-arch-lens-backend/src/docchapter
 */
import { CACHE_DIR } from "./cache-dir.js";
import { readFactVersion, readStalePrior, readVersionedCache, writeVersionedCache } from "./fact-cache.js";
import { importEdges } from "./mermaid.js";
import { llmText, priorRevisionPreamble, readStructuredCache } from "./docsgen.js";
import { ABORTED_MESSAGE, generationSignal } from "./abort.js";
import { readConceptTree } from "./concept.js";
import { readFlow } from "./flow.js";
import { readSequence } from "./sequence.js";
import { readCore } from "./core.js";
import { readDutySummaries } from "./summarize.js";
import { coreErDiagramFromGraph, coreFlowchartFromGraph } from "./mermaid.js";
import { checkDocProse, formatViolations } from "./doc-hallucination.js";
/** The ONE chapter list (order = the comprehension spine, aligned with
 * FIGURE_SPECS: vocabulary → claims → skeleton → golden path → nouns →
 * reactions). Keys are the public DocKind boundary type. */
export const DOC_CHAPTER_KINDS = ['catalog', 'concepts', 'deps', 'seq', 'flow', 'er', 'interaction'];
/** Bilingual chapter titles (migrated from the removed SECTION_TITLES). */
const CHAPTER_TITLES = {
    concepts: { zh: '概念层级', en: 'Concept Hierarchy' },
    seq: { zh: '时序', en: 'Sequence' },
    flow: { zh: '流程图', en: 'Flow' },
    interaction: { zh: '核心交互', en: 'Core Interactions' },
    deps: { zh: '依赖', en: 'Dependencies' },
    er: { zh: '实体关系', en: 'Entity Relationships' },
    catalog: { zh: '包目录职责', en: 'Package Catalog' },
};
/** Chapters whose essence IS a figure: no figure cache ⇒ skip (pure consumer).
 * The remaining chapters (deps/er/catalog) can be written from code facts alone. */
const FIGURE_DRIVEN = new Set(['concepts', 'seq', 'flow', 'interaction']);
/** Spine `requires` per chapter (phase 2): every cache kind whose CONTENT the
 * chapter consumes — its embedded figure(s) AND its cascade-context inputs
 * (§4.2): er/catalog anchor on the core protagonists, flow/interaction carry
 * the golden path. Recorded in the envelope so an in-place regeneration of any
 * consumed cache cascades and invalidates the chapter. Duties is deliberately
 * NOT recorded: it is covered by the facts version and recording it would
 * over-invalidate every chapter. */
const CHAPTER_REQUIRES = {
    concepts: ['concepts'],
    seq: ['seq'],
    flow: ['flow-event', 'flow-pipeline', 'seq'],
    interaction: ['interaction', 'seq'],
    deps: ['core'],
    er: ['core'],
    catalog: ['core'],
};
/** LLM sampling temperature for chapter prose (low, but not greedy). */
const CHAPTER_TEMPERATURE = 0.2;
/** Fact-block bounds (same discipline as the figure prompts). */
const MAX_PACKAGE_LINES = 60;
const MAX_EDGE_ROWS = 120;
const MAX_CONCEPT_LINES = 60;
const MAX_SEQ_LINES = 60;
const MAX_FLOW_CHARS = 3500;
const MAX_EVENT_LINES = 40;
const MAX_ENTITY_LINES = 120;
const MAX_CATALOG_LINES = 60;
const MAX_LINE_CHARS = 160;
/** Cache file base; chapter kind + role language appended (sanitized). */
const CHAPTER_CACHE_BASE = '.arch-lens-docchapter';
/** Keep cache/doc names filesystem-safe. */
function langSuffix(language) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return safe === '' ? 'default' : safe;
}
/** The AUTHORITATIVE chapter cache file name (CACHE_DIR-relative). */
export function chapterCacheName(kind, language) {
    return `${CACHE_DIR}/${CHAPTER_CACHE_BASE}-${kind}-${langSuffix(language)}.json`;
}
/** The AUTHORITATIVE landed doc path (workspace-relative). The `.generated.md`
 * suffix is the safety marker: the plugin only ever writes `*.generated.md`,
 * never the user's own `docs/*.md`. Regeneration overwrites its own file. */
export function chapterDocPath(kind) {
    return `docs/architecture-${kind}.generated.md`;
}
/** Chapter title in the role language. */
export function chapterTitle(kind, language) {
    return language === 'English' ? CHAPTER_TITLES[kind].en : CHAPTER_TITLES[kind].zh;
}
/**
 * Assemble the authoritative entity sets ONCE per round; the chapter prompt
 * and the hallucination gate must consume this SAME snapshot (re-reading
 * between the two could race a rescan).
 * @param index - code index facts.
 * @param graph - scanned graph facts.
 * @returns package/file/edge ground truth.
 */
export function buildGroundTruth(index, graph) {
    const packages = new Set();
    for (const node of graph.nodes) {
        packages.add(node.id);
        if (node.short !== '')
            packages.add(node.short);
    }
    for (const pkg of index.packages)
        packages.add(pkg.id);
    const files = new Set();
    const pushFile = (raw) => {
        const path = raw.replace(/\\/g, '/');
        if (path !== '')
            files.add(path);
    };
    for (const pkg of index.packages) {
        for (const entity of pkg.entities)
            pushFile(entity.file);
        // entryFiles are package-root-relative; rebase them onto the workspace.
        const rel = pkg.path.startsWith(index.root)
            ? pkg.path.slice(index.root.length).replace(/\\/g, '/').replace(/^\/+/, '')
            : '';
        for (const entry of pkg.entryFiles)
            pushFile(rel === '' ? entry : `${rel}/${entry}`);
    }
    for (const call of index.calls ?? [])
        pushFile(call.fromFile);
    const edges = new Set();
    for (const [from, targets] of importEdges(index)) {
        for (const to of targets)
            edges.add(`${from}\0${to}`);
    }
    return { packages, files, edges };
}
/** Bound one fact line. */
function line(text) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > MAX_LINE_CHARS ? `${oneLine.slice(0, MAX_LINE_CHARS)}…` : oneLine;
}
/** Shared fact block: spine protagonists (when established) + package roster
 * (with duties) + real import edges. The `core` line is the comprehension
 * spine's cascade context (§4.2): the upstream core selection flows into every
 * downstream chapter prompt so prose anchors on the protagonists instead of an
 * undifferentiated roster. The protagonists themselves come from facts, and any
 * package the prose cites is still re-checked by the hallucination gate. */
function sharedFacts(index, graph, duties, withEdges, core = null) {
    const parts = [];
    if (core !== null && core.ids.length > 0) {
        parts.push(`■ 主干核心包（上游结论，source=${core.source}）\n${core.ids.join(', ')}`);
    }
    const roster = [];
    for (const node of graph.nodes.slice(0, MAX_PACKAGE_LINES)) {
        const duty = duties?.[node.id] ?? node.blurb;
        roster.push(`- ${node.id}${duty === '' ? '' : ` — ${line(duty)}`}`);
    }
    parts.push(`■ 包清单（${roster.length}）\n${roster.join('\n')}`);
    if (withEdges) {
        const rows = [];
        outer: for (const [from, targets] of importEdges(index)) {
            for (const to of targets) {
                rows.push(`| ${from} | ${to} |`);
                if (rows.length >= MAX_EDGE_ROWS)
                    break outer;
            }
        }
        if (rows.length > 0)
            parts.push(`■ 调用关系（真实源码 import 边，${rows.length} 条）\n| 调用方 | 被调用方 |\n| --- | --- |\n${rows.join('\n')}`);
    }
    return parts.join('\n\n');
}
/** Concept tree → bounded outline (`name — desc`, indent = depth). */
function conceptFacts(tree) {
    const lines = [];
    const walk = (node, depth) => {
        if (lines.length >= MAX_CONCEPT_LINES)
            return;
        lines.push(`${'  '.repeat(depth)}- ${node.name}${node.desc === '' ? '' : ` — ${line(node.desc)}`}`);
        for (const child of node.children ?? [])
            walk(child, depth + 1);
    };
    for (const node of tree)
        walk(node, 0);
    return `■ 概念树（图缓存）\n${lines.join('\n')}`;
}
/** Sequence figure → bounded message lines. */
function seqFacts(seq) {
    const lines = seq.messages.slice(0, MAX_SEQ_LINES).map(msg => `- ${msg.from} → ${msg.to}：${line(msg.label)}`);
    return `■ 时序消息（图缓存，source=${seq.source}）\n${lines.join('\n')}`;
}
/** Golden path (the seq figure's message sequence) as cascade context (§4.2):
 * the established request flow is handed to the chapters that sit downstream
 * of it on the spine (flow, interaction), so their prose stays consistent with
 * the canonical path. Facts-derived; any package the prose cites is still
 * re-checked by the hallucination gate. Empty when no seq figure exists. */
function goldenPathFacts(seq) {
    if (seq === null || seq.messages.length === 0)
        return '';
    const lines = seq.messages.slice(0, MAX_SEQ_LINES).map(msg => `- ${msg.from} → ${msg.to}：${line(msg.label)}`);
    return `■ 黄金路径（上游时序结论，source=${seq.source}）\n${lines.join('\n')}`;
}
/** Flow figures (both angles) → title + mermaid source (bounded). */
function flowFacts(event, pipeline) {
    const parts = [];
    for (const [angle, figure] of [['事件流', event], ['管道流', pipeline]]) {
        if (figure === null)
            continue;
        parts.push(`■ ${angle}（图缓存，source=${figure.source}）\n标题：${figure.title}\n${figure.mermaid.slice(0, MAX_FLOW_CHARS)}`);
    }
    return parts.join('\n\n');
}
/** Interaction events → bounded rows. */
function interactionFacts(events) {
    const lines = events.slice(0, MAX_EVENT_LINES).map(event => `- ${event.event}（${event.mode}）：${event.producers.join(', ')} → ${event.consumers.join(', ')}${event.note === '' ? '' : ` · ${line(event.note)}`}`);
    return `■ 交互事件（图缓存）\n${lines.join('\n')}`;
}
/** Core selection → focus line (edges already in the shared block). */
function depsFacts(core) {
    if (core === null)
        return '';
    return `■ 核心流包（图缓存，source=${core.source}）\n${core.ids.join(', ')}`;
}
/** Index entities → bounded `Entity(kind) @ file` lines. */
function erFacts(index) {
    const lines = [];
    outer: for (const pkg of index.packages) {
        for (const entity of pkg.entities) {
            if (entity.kind === 'field' || entity.kind === 'method')
                continue; // ER level: types, not members
            lines.push(`- ${entity.name}（${entity.kind}）@ ${pkg.id}/${entity.file}`);
            if (lines.length >= MAX_ENTITY_LINES)
                break outer;
        }
    }
    return `■ 实体（代码索引）\n${lines.join('\n')}`;
}
/** Catalog extras: manifest deps + entry files (roster already shared). */
function catalogFacts(index) {
    const lines = [];
    for (const pkg of index.packages.slice(0, MAX_CATALOG_LINES)) {
        const deps = pkg.deps.length === 0 ? '' : `deps: ${pkg.deps.join(', ')}`;
        const entry = pkg.entryFiles.length === 0 ? '' : `entry: ${pkg.entryFiles.join(', ')}`;
        const extra = [deps, entry].filter(part => part !== '').join(' · ');
        lines.push(`- ${pkg.id}${extra === '' ? '' : `（${extra}）`}`);
    }
    return `■ 包明细（代码索引）\n${lines.join('\n')}`;
}
/** Load every figure cache once for the round. */
async function loadFigureFacts(fs, root, language) {
    return {
        concepts: await readConceptTree(fs, root, language),
        seq: await readSequence(fs, root, language),
        flowEvent: await readFlow(fs, root, language, 'event'),
        flowPipeline: await readFlow(fs, root, language, 'pipeline'),
        interaction: await readStructuredCache(fs, root, language, 'interaction'),
        core: await readCore(fs, root, language),
        duties: await readDutySummaries(fs, root, language),
    };
}
/**
 * Pack one chapter's bounded fact block.
 * @returns the fact text, or null when a figure-driven chapter has no figure.
 */
export async function packChapterFacts(kind, index, graph, cache) {
    switch (kind) {
        case 'concepts':
            if (cache.concepts === null)
                return null;
            return `${sharedFacts(index, graph, cache.duties, false)}\n\n${conceptFacts(cache.concepts)}`;
        case 'seq':
            if (cache.seq === null)
                return null;
            return `${sharedFacts(index, graph, cache.duties, true)}\n\n${seqFacts(cache.seq)}`;
        case 'flow':
            if (cache.flowEvent === null && cache.flowPipeline === null)
                return null;
            return `${sharedFacts(index, graph, cache.duties, true)}\n\n${flowFacts(cache.flowEvent, cache.flowPipeline)}${goldenPathFacts(cache.seq) === '' ? '' : `\n\n${goldenPathFacts(cache.seq)}`}`;
        case 'interaction':
            if (cache.interaction === null)
                return null;
            return `${sharedFacts(index, graph, cache.duties, true)}\n\n${interactionFacts(cache.interaction)}${goldenPathFacts(cache.seq) === '' ? '' : `\n\n${goldenPathFacts(cache.seq)}`}`;
        case 'deps':
            // deps IS the core-flow chapter: it keeps its own dedicated core block
            // (depsFacts) and does not double-inject the shared protagonists line.
            return `${sharedFacts(index, graph, cache.duties, true)}${depsFacts(cache.core) === '' ? '' : `\n\n${depsFacts(cache.core)}`}`;
        case 'er':
            // Cascade context (§4.2): the figure-less code-fact chapters anchor on the
            // upstream core protagonists (deps does too, via its dedicated block).
            return `${sharedFacts(index, graph, cache.duties, false, cache.core)}\n\n${erFacts(index)}`;
        case 'catalog':
            return `${sharedFacts(index, graph, cache.duties, false, cache.core)}\n\n${catalogFacts(index)}`;
    }
}
/** The chapter-writer prompt (role language, strict JSON contract). */
export function chapterPrompt(kind, language, facts) {
    const title = chapterTitle(kind, language);
    if (language === 'English') {
        return 'You are a senior software architecture writer. Using ONLY the [FACTS] below, write the '
            + `"${title}" chapter of an architecture document.\n`
            + 'Rules:\n'
            + '1. Use ONLY packages, files and call relations present in [FACTS]; never invent names outside them.\n'
            + '2. Do not describe the diagrams (arrows, boxes) — write the architecture: responsibilities, boundaries, key paths, design tradeoffs.\n'
            + '3. Write in English; structure with `##`/`###`; wrap package/file names in backticks; 300–800 words.\n'
            + '4. Call relations may only come from the [FACTS] call table (when given); never reverse a direction. If you keep a call table in the prose, its header MUST be | caller | callee | action |.\n'
            + '5. When the facts cannot support a claim, omit it rather than fabricate.\n\n'
            + `[FACTS]\n${facts}\n\n`
            + 'Your final answer must be EXACTLY one JSON object: {"markdown": "## …chapter body…"} — no explanation, no code fences, no extra text.';
    }
    return '你是资深软件架构文档撰写者。依据下方【事实】撰写架构文档的「' + title + '」一章。\n'
        + '写作规则：\n'
        + '1. 只能使用【事实】中出现的包、文件与调用关系；事实之外的名称一律不得写入。\n'
        + '2. 不要描述图形（"箭头"、"方框"、"连线"），要写架构本身：职责划分、边界、关键路径、设计取舍。\n'
        + '3. 用中文撰写；用 `##`/`###` 组织小节；包名与文件用反引号；篇幅 300–800 字。\n'
        + '4. 引用调用关系只能取自【事实】的「调用关系」表（若有），方向不得颠倒；如正文保留调用表，表头必须为 | 调用方 | 被调用方 | 动作 |。\n'
        + '5. 事实不足以支撑某个论断时，宁可不写，也不得补造。\n\n'
        + `【事实】\n${facts}\n\n`
        + '最终回答必须且只能是一个 JSON 对象，格式：{"markdown": "## …章节正文…"}，不要输出任何解释、代码块围栏或额外文字。';
}
/** One-shot repair prompt: fix ONLY the listed violations, keep everything else. */
export function chapterRepairPrompt(language, violations, markdown) {
    const list = formatViolations(violations);
    if (language === 'English') {
        return 'Your previous chapter referenced entities that do not exist in the facts. Fix ONLY the violations below '
            + '(replace each with the closest real entity from the facts, or drop the sentence); do NOT change any other meaning or structure.\n'
            + `Violations:\n${list}\n\n`
            + `Previous chapter:\n${markdown}\n\n`
            + 'Your final answer must be EXACTLY one JSON object: {"markdown": "…full rewritten chapter…"}';
    }
    return '你上一轮输出的章节引用了事实之外的实体。只修正下列违规（替换为事实中最接近的真实实体，或删除该句），禁止改动其余语义与结构。\n'
        + `违规清单：\n${list}\n\n`
        + `上一轮章节：\n${markdown}\n\n`
        + '最终回答必须且只能是一个 JSON 对象：{"markdown": "…重写后的完整章节…"}';
}
/**
 * Prior-draft revision prompt (comprehension-spine phase 1): revise a STALE
 * chapter against fresh facts instead of writing from scratch. Composes the
 * shared revision preamble + the prior draft + the ordinary chapter prompt,
 * so the five writing rules and the strict JSON contract apply unchanged and
 * the hallucination gate downstream re-checks the result. The prior is a
 * shape hint only — facts stay authoritative.
 * @param kind - chapter key.
 * @param language - role language.
 * @param facts - the CURRENT ground-truth facts block.
 * @param prior - the stale chapter markdown (prior draft).
 * @returns the revision prompt.
 */
export function chapterRevisePrompt(kind, language, facts, prior) {
    const priorHeading = language === 'English'
        ? 'PRIOR DRAFT (generated against older facts — shape hint only)'
        : '【上一版章节】（依据旧事实生成，仅作形态参考）';
    return priorRevisionPreamble(language)
        + `${priorHeading}\n${prior}\n\n`
        + chapterPrompt(kind, language, facts);
}
/** Pull the markdown out of the model answer (tolerating wrapping prose). */
export function extractChapterMarkdown(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    }
    catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null)
        return null;
    const markdown = parsed.markdown;
    return typeof markdown === 'string' && markdown.trim() !== '' ? markdown.trim() : null;
}
/** Chapter envelope cache read: only a current-version cache is served. */
export async function readChapterCache(fs, root, kind, language) {
    const target = await fs.resolve(chapterCacheName(kind, language), { cwd: root }).catch(() => null);
    if (target === null)
        return null;
    const factsVersion = await readFactVersion(fs, root);
    const cached = await readVersionedCache(fs, target, factsVersion);
    if (cached !== null && typeof cached.markdown === 'string' && cached.markdown !== '')
        return cached;
    return null;
}
/** Sequence messages → mermaid sequenceDiagram (participants in first-seen order). */
function seqMermaid(seq) {
    const messages = seq.messages.slice(0, MAX_SEQ_LINES);
    const lines = ['sequenceDiagram'];
    const seen = new Set();
    for (const msg of messages) {
        for (const id of [msg.from, msg.to]) {
            if (seen.has(id))
                continue;
            seen.add(id);
            lines.push(`  participant ${id}`);
        }
    }
    for (const msg of messages)
        lines.push(`  ${msg.from}->>${msg.to}: ${line(msg.label).replace(/`/g, '')}`);
    return lines.join('\n');
}
/** Concept tree → nested markdown list (the doc-form of the tree tab). */
function conceptList(tree) {
    const lines = [];
    const walk = (node, depth) => {
        if (lines.length >= MAX_CONCEPT_LINES)
            return;
        lines.push(`${'  '.repeat(depth)}- **${node.name}**${node.desc === '' ? '' : ` — ${line(node.desc)}`}`);
        for (const child of node.children ?? [])
            walk(child, depth + 1);
    };
    for (const node of tree)
        walk(node, 0);
    return lines.join('\n');
}
/** Interaction events → bounded table rows. */
function interactionTable(events) {
    return events.slice(0, MAX_EVENT_LINES).map(event => `| ${event.event} | ${event.mode} | ${event.producers.join(', ')} | ${event.consumers.join(', ')} | ${line(event.note)} |`).join('\n');
}
/**
 * Zero-LLM figure section for the landed doc: deterministic renders of the
 * SAME versioned figure caches the tabs show (flow mermaid verbatim —
 * readFlow sanitizes on read; rule-built mermaid for seq/deps/er; list/table
 * for concepts/interaction). '' when the chapter's figures are absent — the
 * prose still lands alone. Figures are cache-derived facts, so the
 * hallucination gate does not apply to them.
 */
export function chapterFigureBlocks(kind, cache, graph, language) {
    const en = language === 'English';
    const heading = en ? '## Figures' : '## 图示';
    const fence = (mermaid) => `\`\`\`mermaid\n${mermaid}\n\`\`\``;
    switch (kind) {
        case 'concepts':
            if (cache.concepts === null)
                return '';
            return `${heading}\n\n${conceptList(cache.concepts)}`;
        case 'seq':
            if (cache.seq === null || cache.seq.messages.length === 0)
                return '';
            return `${heading}\n\n${fence(seqMermaid(cache.seq))}`;
        case 'flow': {
            const parts = [];
            if (cache.flowEvent !== null) {
                const title = cache.flowEvent.title === '' ? (en ? 'Event flow' : '事件流视角') : cache.flowEvent.title;
                parts.push(`### ${title}\n\n${fence(cache.flowEvent.mermaid)}`);
            }
            if (cache.flowPipeline !== null) {
                const title = cache.flowPipeline.title === '' ? (en ? 'Pipeline flow' : '管道流视角') : cache.flowPipeline.title;
                parts.push(`### ${title}\n\n${fence(cache.flowPipeline.mermaid)}`);
            }
            return parts.length === 0 ? '' : `${heading}\n\n${parts.join('\n\n')}`;
        }
        case 'interaction':
            if (cache.interaction === null || cache.interaction.length === 0)
                return '';
            return `${heading}\n\n| ${en ? 'Event' : '事件'} | ${en ? 'Mode' : '模式'} | ${en ? 'Producers' : '生产者'} | ${en ? 'Consumers' : '消费者'} | ${en ? 'Note' : '说明'} |\n| --- | --- | --- | --- | --- |\n${interactionTable(cache.interaction)}`;
        case 'deps':
            if (cache.core === null)
                return '';
            return `${heading}\n\n${fence(coreFlowchartFromGraph(graph, cache.core.ids))}`;
        case 'er':
            if (cache.core === null)
                return '';
            return `${heading}\n\n${fence(coreErDiagramFromGraph(graph, cache.core.ids))}`;
        case 'catalog':
            return '';
    }
}
/** Landed doc content: provenance header + (degraded warning) + body + figure blocks. */
function renderLandedDoc(kind, language, markdown, degraded, figureBlocks) {
    const title = chapterTitle(kind, language);
    const at = new Date().toISOString();
    const header = `<!-- arch-lens generated · chapter=${kind} · language=${language} · at=${at} · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->`;
    const warning = degraded === null ? ''
        : `\n> ⚠️ 降级输出：幻觉校验后仍有 ${degraded.violations.length} 处引用未能核实（${degraded.violations.slice(0, 5).map(v => v.token).join('、')}${degraded.violations.length > 5 ? '…' : ''}），引用前请人工复核。\n`;
    const figures = figureBlocks === '' ? '' : `\n${figureBlocks}\n`;
    return `${header}\n\n# ${title}\n${warning}\n${markdown.trim()}\n${figures}`;
}
/**
 * Generate ONE chapter end to end: facts → prompt → LLM → extract →
 * hallucination gate (one repair round) → envelope cache + landed file.
 * Faithful prose is the only prose that gets cached; a still-violating draft
 * lands with a warning but is NOT cached (the next round retries it).
 * @param priorMarkdown - phase 1 prior draft: a STALE chapter's markdown to
 *   revise instead of writing from scratch ('' = blank generation).
 * @param requires - phase 2 spine deps: figure-cache kinds this chapter
 *   embeds, recorded in the envelope for cascade invalidation.
 * @returns the chapter outcome.
 */
export async function generateDocChapter(ctx, fs, root, kind, language, facts, truth, factsVersion, allPackageIds, figureBlocks = '', sandboxPolicy, priorMarkdown = '', requires = []) {
    const title = chapterTitle(kind, language);
    const signal = generationSignal(root);
    const base = { kind, title, state: 'failed' };
    const prompt = priorMarkdown === ''
        ? chapterPrompt(kind, language, facts)
        : chapterRevisePrompt(kind, language, facts, priorMarkdown);
    let markdown = extractChapterMarkdown(await llmText(ctx, prompt, CHAPTER_TEMPERATURE, undefined, 'docs', signal));
    if (markdown === null)
        return { ...base, reason: '模型输出未包含 {"markdown": …} JSON' };
    let violations = checkDocProse(markdown, truth);
    const firstDraftViolations = violations.length;
    if (violations.length > 0) {
        // ONE targeted repair round: fix references only, semantics untouched.
        const repaired = extractChapterMarkdown(await llmText(ctx, chapterRepairPrompt(language, violations, markdown), CHAPTER_TEMPERATURE, undefined, 'docs', signal));
        if (repaired !== null) {
            const recheck = checkDocProse(repaired, truth);
            if (recheck.length < violations.length) {
                markdown = repaired;
                violations = recheck;
            }
        }
    }
    const degraded = violations.length > 0;
    // Faithful prose lands the envelope; degraded prose lands only the file.
    if (!degraded) {
        const cacheTarget = await fs.resolve(chapterCacheName(kind, language), { cwd: root });
        const payload = { markdown, generatedAt: Date.now() };
        // V1 deps = every package id (any change invalidates every chapter);
        // V2 narrows this to the packages each chapter actually cites. `requires`
        // (phase 2) records the figure kinds this chapter embeds, so an in-place
        // figure regeneration cascades and invalidates this envelope.
        await writeVersionedCache(fs, cacheTarget, payload, factsVersion, sandboxPolicy, allPackageIds, requires);
    }
    else {
        console.warn(`[arch-lens] docchapter ${kind}: degraded (${violations.length} violations after repair) — landed without cache`);
    }
    const docTarget = await fs.resolve(chapterDocPath(kind), { cwd: root });
    await fs.writeText(docTarget, renderLandedDoc(kind, language, markdown, degraded ? { violations } : null, figureBlocks), undefined, undefined, sandboxPolicy);
    return {
        kind, title, state: 'generated',
        path: docTarget.displayPath,
        ...(degraded ? { degraded: true } : {}),
        violations: firstDraftViolations,
    };
}
/**
 * 「一键生成文档」 V1: the serial chapter loop. Fresh caches are skipped;
 * everything else regenerates with an independent envelope and independent
 * failure. An abort between chapters stops the round cleanly.
 * @param ctx - host context (llm services).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index facts.
 * @param graph - scanned graph facts.
 * @param language - role language.
 * @param sandboxPolicy - session-scoped write policy.
 * @returns per-chapter outcomes, or a round-level error.
 */
export async function generateDocChapters(ctx, fs, root, index, graph, language, sandboxPolicy) {
    const factsVersion = await readFactVersion(fs, root);
    if (factsVersion === 0)
        console.warn('[arch-lens] docchapters: facts version unknown (0) — chapters land without envelope caches');
    const truth = buildGroundTruth(index, graph);
    const figureCache = await loadFigureFacts(fs, root, language);
    const allPackageIds = graph.nodes.map(node => node.id);
    const signal = generationSignal(root);
    const outcomes = [];
    for (const kind of DOC_CHAPTER_KINDS) {
        if (signal.aborted) {
            outcomes.push({ kind, title: chapterTitle(kind, language), state: 'skipped', reason: 'aborted' });
            continue;
        }
        const title = chapterTitle(kind, language);
        try {
            if (await readChapterCache(fs, root, kind, language) !== null) {
                outcomes.push({ kind, title, state: 'skipped', reason: 'cache-fresh' });
                continue;
            }
            const facts = await packChapterFacts(kind, index, graph, figureCache);
            if (facts === null) {
                outcomes.push({
                    kind, title, state: 'skipped',
                    reason: FIGURE_DRIVEN.has(kind) ? 'figure-missing（先在对应 tab 点「🤖 AI 生成」补图）' : 'facts unavailable',
                });
                continue;
            }
            // Phase 1 prior draft: a stale chapter envelope seeds revision instead
            // of a blank generation. Deleting the envelope stays the escape hatch —
            // it removes the prior together with the cache.
            let priorMarkdown = '';
            const priorTarget = await fs.resolve(chapterCacheName(kind, language), { cwd: root }).catch(() => null);
            if (priorTarget !== null) {
                const stale = await readStalePrior(fs, priorTarget, factsVersion);
                if (stale !== null && typeof stale.markdown === 'string' && stale.markdown !== '')
                    priorMarkdown = stale.markdown;
            }
            const outcome = await generateDocChapter(ctx, fs, root, kind, language, facts, truth, factsVersion, allPackageIds, chapterFigureBlocks(kind, figureCache, graph, language), sandboxPolicy, priorMarkdown, CHAPTER_REQUIRES[kind]);
            outcomes.push(outcome);
            console.log(`[arch-lens] docchapter ${kind}: ${outcome.state}${outcome.degraded === true ? ' (degraded)' : ''}${outcome.violations === undefined || outcome.violations === 0 ? '' : ` (first-draft violations: ${outcome.violations})`}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes(ABORTED_MESSAGE) || signal.aborted) {
                outcomes.push({ kind, title, state: 'skipped', reason: 'aborted' });
                // Fill the remaining chapters as aborted without further LLM calls.
                for (const rest of DOC_CHAPTER_KINDS.slice(DOC_CHAPTER_KINDS.indexOf(kind) + 1)) {
                    outcomes.push({ kind: rest, title: chapterTitle(rest, language), state: 'skipped', reason: 'aborted' });
                }
                break;
            }
            outcomes.push({ kind, title, state: 'failed', reason: message });
            console.warn(`[arch-lens] docchapter ${kind} failed: ${message}`);
        }
    }
    return { outcomes };
}
//# sourceMappingURL=docchapter.js.map