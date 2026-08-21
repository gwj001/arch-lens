/**
 * Call-graph figure data for the Arch Lens backend, as a replaceable chain:
 *
 *   buildSequenceFromCalls(index)   — real static call graph (source 'code')
 *   readSeqCache(root, language)    — cached doc/LLM result
 *   extractSequenceFromDoc(root)    — verbatim doc section (source 'doc')
 *   writeStructuredCache('seq')     — LLM induction (source 'flow')
 *
 * Resolution order is FIXED: real call edges first (the only authoritative
 * source — static analysis of what the code can call), then the cached
 * doc/LLM result, then a fresh doc extraction, then LLM induction. Every
 * stage is an independent function, so the strategy can be reordered without
 * touching consumers.
 *
 * Naming note: the code-sourced figure is a STATIC CALL GRAPH — message
 * order is BFS traversal order over package-level call edges, NOT runtime
 * timing. Only doc/LLM sources describe a main-flow sequence.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/sequence
 */
import { detectArchDocs, HEADING_RE } from "./concept.js";
import { writeStructuredCache } from "./docsgen.js";
import { ensureAnalysisProfile } from "./analysis.js";
import { importEdges } from "./mermaid.js";
/** Cache file base name for the sequence figure (same file as LLM writes). */
const SEQ_CACHE = '.arch-lens-sequence';
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName(base, language, methods = false) {
    const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    return `${base}-${safe === '' ? 'default' : safe}${methods ? '-methods' : ''}.json`;
}
/** Normalize a path for map keys (`\` → `/`, strip `./` segments anywhere). */
function norm(path) {
    return path.replace(/\\/g, '/').replace(/\/\.\//g, '/').replace(/^\.\//, '');
}
/** Whether a source file is a test file: test-directory paths (`tests/`,
 * `__tests__/`, `test/`) or test-suffixed names (`*.spec.ts`, `*.test.ts`,
 * `*_test.py`). Used to keep fixture-only call edges out of the production
 * call graph. */
function isTestFile(path) {
    return /(^|\/)(__tests__|tests?)(\/|$)/.test(path)
        || /\.(spec|test)\.[a-z]+$/i.test(path)
        || /_test\.py$/i.test(path);
}
/** Message cap for doc/LLM figures (matches the LLM prompt's 10-16 range). */
const MESSAGE_LIMIT = 16;
/** Message cap for the code-sourced call graph (one row per edge; entries
 * plus hubs need more room than a hand-written main-flow sequence). */
const CODE_MESSAGE_LIMIT = 24;
/** Minimum messages before a figure is considered usable. */
const MIN_MESSAGES = 3;
/** Symbols shown in the edge label; the rest stay in `syms` for explains. */
const LABEL_SYMS = 3;
/** Symbols kept on the message as explain evidence. */
const SYMS_EVIDENCE = 8;
/** In-degree threshold for the 'hub' (shared-service) role. */
const HUB_CITED_BY = 2;
/** Out-degree threshold for the 'entry' role: an uncited package must
 * orchestrate at least this many others to read as a flow source. */
const ENTRY_CITES = 2;
/**
 * Stage 1 (code): derive the call-graph figure from real source-level call
 * edges. Edges are resolved symbol → import → module → package; only
 * cross-package edges become messages, and edges from TEST files are
 * excluded (fixture calls must not inflate the production graph). Traversal
 * starts at entry packages (BFS, bounded), so the result reads as
 * "entry → … → leaf" — traversal order, NOT execution timing. Every message
 * carries the called symbols and a sample caller file as explain evidence;
 * the figure annotates each package with a role (entry / hub / leaf) and its
 * in/out degrees.
 * @param index - code index result with raw call edges.
 * @param language - role language (label wording).
 * @returns the code-sourced figure, or null when unusable.
 */
export function buildSequenceFromCalls(index, language) {
    const calls = index.calls;
    if (calls === undefined || calls.length === 0)
        return null;
    // File → package map (declaration files plus import sites).
    const fileToPkg = new Map();
    for (const pkg of index.packages) {
        for (const entity of pkg.entities)
            fileToPkg.set(norm(entity.file), pkg.id);
        for (const imp of pkg.imports)
            fileToPkg.set(norm(imp.from), pkg.id);
    }
    // Per-file import index: module specifiers and their imported names.
    const fileImports = new Map();
    for (const pkg of index.packages) {
        for (const imp of pkg.imports) {
            const list = fileImports.get(norm(imp.from)) ?? [];
            list.push({ to: imp.to, names: imp.names });
            fileImports.set(norm(imp.from), list);
        }
    }
    // Module specifier → package id (relative paths resolve to files first).
    const resolveModule = (spec, fromFile) => {
        if (spec.startsWith('./') || spec.startsWith('../')) {
            const dir = fromFile.slice(0, fromFile.lastIndexOf('/') + 1);
            const candidates = [
                dir + spec, `${dir}${spec}.ts`, `${dir}${spec}.tsx`, `${dir}${spec}.js`,
                `${dir}${spec}/index.ts`, `${dir}${spec}/index.tsx`, `${dir}${spec}/index.js`,
            ];
            for (const candidate of candidates) {
                const pkg = fileToPkg.get(norm(candidate));
                if (pkg !== undefined)
                    return pkg;
            }
            return undefined;
        }
        // Package specifier: match the full name, the scope-stripped name, the
        // last segment, and the dsh- prefix stripped — package ids are directory
        // short names (`session`) while workspace imports use npm names
        // (`@deepseek-ai/dsh-session`).
        const stripped = spec.replace(/^@[^/]+\//, '');
        const candidates = new Set([
            spec,
            stripped,
            spec.split('/').at(-1) ?? spec,
            stripped.replace(/^dsh-/, ''),
        ]);
        for (const pkg of index.packages) {
            if (candidates.has(pkg.id))
                return pkg.id;
        }
        return undefined;
    };
    // Aggregate edges caller-package → callee-package with the symbols seen and
    // the first caller file (explain evidence). Edges whose CALLER is a test
    // file are dropped: fixture-only calls would inflate the production call
    // graph with edges that never run in the product (e.g. acp → tools via
    // tests/edges.spec.ts).
    const edges = new Map();
    for (const edge of calls) {
        if (isTestFile(norm(edge.fromFile)))
            continue;
        const callerPkg = fileToPkg.get(norm(edge.fromFile));
        if (callerPkg === undefined)
            continue;
        const imports = fileImports.get(norm(edge.fromFile)) ?? [];
        // Match the imported binding: the callee symbol itself for named
        // imports (`import { foo }` → `foo()`), or the call-target root for
        // namespace imports (`import * as svc` → `svc.inner.launch()`).
        const binding = edge.root ?? edge.to;
        let module;
        for (const imp of imports) {
            if (imp.names.includes(binding)) {
                module = imp.to;
                break;
            }
        }
        if (module === undefined)
            continue;
        const calleePkg = resolveModule(module, norm(edge.fromFile));
        if (calleePkg === undefined || calleePkg === callerPkg)
            continue;
        const key = `${callerPkg}\u0000${calleePkg}`;
        const existing = edges.get(key);
        if (existing !== undefined) {
            existing.syms.add(edge.to);
            if (existing.file === undefined)
                existing.file = norm(edge.fromFile);
        }
        else {
            edges.set(key, { to: calleePkg, syms: new Set([edge.to]), file: norm(edge.fromFile) });
        }
    }
    if (edges.size === 0)
        return null;
    // Adjacency from entry packages (BFS, bounded, cycle-safe).
    const adjacency = new Map();
    for (const [key, info] of edges) {
        const [from] = key.split('\u0000');
        const list = adjacency.get(from) ?? [];
        const edge = { to: info.to, syms: info.syms };
        if (info.file !== undefined)
            edge.file = info.file;
        list.push(edge);
        adjacency.set(from, list);
    }
    const queue = [];
    for (const pkg of index.packages) {
        if (pkg.entryFiles.length > 0)
            queue.push(pkg.id);
    }
    if (queue.length === 0) {
        // No entry packages: traverse the whole graph, most-cited packages first.
        const inDegree = new Map();
        for (const [key] of edges) {
            const [, to] = key.split('\u0000');
            inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
        }
        const sorted = [...index.packages].sort((a, b) => (inDegree.get(b.id) ?? 0) - (inDegree.get(a.id) ?? 0));
        queue.push(...sorted.map(pkg => pkg.id));
    }
    const messages = [];
    const visited = new Set();
    const callVerb = language === 'English' ? 'calls' : '调用';
    while (queue.length > 0 && messages.length < CODE_MESSAGE_LIMIT) {
        const pkg = queue.shift();
        if (visited.has(pkg))
            continue;
        visited.add(pkg);
        for (const edge of adjacency.get(pkg) ?? []) {
            if (messages.length >= CODE_MESSAGE_LIMIT)
                break;
            const symList = [...edge.syms];
            const shown = symList.slice(0, LABEL_SYMS);
            const more = symList.length - shown.length;
            const label = `${callVerb} ${shown.map(sym => `${sym}()`).join('、')}${more > 0 ? ` 等 ${symList.length} 个` : ''}`;
            const message = { from: pkg, to: edge.to, label };
            if (symList.length > LABEL_SYMS)
                message.syms = symList.slice(0, SYMS_EVIDENCE);
            if (edge.file !== undefined)
                message.file = edge.file;
            messages.push(message);
            if (!visited.has(edge.to))
                queue.push(edge.to);
        }
    }
    if (messages.length < MIN_MESSAGES)
        return null;
    // Node role metadata for every package appearing in the figure: hubs
    // (cited by ≥2 packages = shared services), entries (uncited sources that
    // orchestrate ≥2 packages = flow starts), then leaves. Order follows first
    // appearance in the messages, matching the client's lane order.
    const nodes = buildSequenceNodes(index, messages);
    return { source: 'code', messages, nodes };
}
/**
 * Fallback stage for the code view: when the static call graph yields no
 * cross-package edges (type-only imports, or calls resolved dynamically
 * through `ctx.get`), derive a package-level REFERENCE graph from the real
 * cross-package import edges instead. Still a static code fact (source
 * 'code') — it shows what the code actually references, not a runtime
 * sequence, and deliberately differs from the flow view's main-flow figure.
 * @param index - code index result.
 * @param language - role language (label wording).
 * @returns the reference figure, or null when there are no cross-package imports.
 */
export function buildSequenceFromImports(index, language) {
    const edges = importEdges(index);
    const verb = language === 'English' ? 'references' : '引用';
    const messages = [];
    // Deterministic order: package declaration order, targets in edge order.
    for (const pkg of index.packages) {
        const targets = edges.get(pkg.id);
        if (targets === undefined)
            continue;
        for (const to of targets) {
            messages.push({ from: pkg.id, to, label: `${verb} ${to}` });
            if (messages.length >= CODE_MESSAGE_LIMIT)
                break;
        }
        if (messages.length >= CODE_MESSAGE_LIMIT)
            break;
    }
    if (messages.length < MIN_MESSAGES)
        return null;
    const nodes = buildSequenceNodes(index, messages);
    return { source: 'code', messages, nodes };
}
/** Workspace-relative package path: entry file when available, else the
 * first source file, else the package directory. Entry files and entity
 * files are already workspace-relative in the code index. */
function packagePath(pkg, root) {
    if (pkg === undefined)
        return '';
    const entry = pkg.entryFiles[0];
    if (entry !== undefined)
        return entry.replace(/\\/g, '/');
    const firstEntity = pkg.entities.find(entity => entity.file !== '');
    if (firstEntity !== undefined)
        return norm(firstEntity.file);
    return norm(pkg.path).replace(norm(root), '').replace(/^\/+/, '');
}
/**
 * Build per-package role metadata for the packages in the figure. Roles are
 * pure graph facts over the call edges: 'hub' = cited by ≥2 packages (the
 * shared-service signal); 'entry' = cited by nobody and orchestrating ≥2
 * packages (a flow source); 'leaf' = everything else. Entry files do NOT
 * participate — in large workspaces nearly every package has one, which
 * would flatten every node into 'entry'.
 */
function buildSequenceNodes(index, messages) {
    const inDegree = new Map();
    const outDegree = new Map();
    for (const message of messages) {
        inDegree.set(message.to, (inDegree.get(message.to) ?? 0) + 1);
        outDegree.set(message.from, (outDegree.get(message.from) ?? 0) + 1);
    }
    const pkgById = new Map(index.packages.map(pkg => [pkg.id, pkg]));
    const nodes = [];
    const seen = new Set();
    const push = (id) => {
        if (seen.has(id))
            return;
        seen.add(id);
        const pkg = pkgById.get(id);
        const citedBy = inDegree.get(id) ?? 0;
        const cites = outDegree.get(id) ?? 0;
        const role = citedBy >= HUB_CITED_BY
            ? 'hub'
            : citedBy === 0 && cites >= ENTRY_CITES
                ? 'entry'
                : 'leaf';
        nodes.push({ id, role, citedBy, cites, path: packagePath(pkg, index.root) });
    };
    for (const message of messages) {
        push(message.from);
        push(message.to);
    }
    return nodes;
}
/**
 * Extract the doc's `## 时序` (sequence) section verbatim and parse it into
 * messages. Pure rule stage — zero LLM, deterministic. Supports mermaid
 * `sequenceDiagram` blocks (with `participant X as 别名` aliases) and plain
 * `A -> B: label` / `A→B: label` lines.
 * @param text - the section text (or whole doc; heading scan is cheap).
 * @returns parsed messages, possibly empty.
 */
export function parseSequenceSection(text) {
    const messages = [];
    const aliases = new Map();
    const block = /```mermaid\s*\n([\s\S]*?)```/.exec(text);
    const body = block === null ? text : block[1];
    const inDiagram = block !== null;
    // Participant names may be Chinese (docs are written in the role language),
    // so the name classes exclude whitespace/arrow/colon instead of whitelisting
    // ASCII. An optional leading list marker ("1. ") is tolerated.
    const lineRe = /^\s*(?:\d+[.、]\s+)?([^\s:>\-]+)\s*(?:->>|-->>|->|-->|→)\s*([^\s:>\-]+)\s*(?::\s*(.+))?$/;
    for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (line === '' || line.startsWith('```'))
            continue;
        if (inDiagram) {
            const participant = /^participant\s+([A-Za-z0-9_\-./]+)(?:\s+as\s+(.+))?$/.exec(line);
            if (participant !== null) {
                if (participant[2] !== undefined)
                    aliases.set(participant[1], participant[2].trim());
                continue;
            }
            if (/^(note|activate|deactivate|loop|alt|else|opt|par|end)\b/i.test(line))
                continue;
        }
        const match = lineRe.exec(line);
        if (match === null)
            continue;
        // Groups: 1=from, 2=to, 3=label (the arrow alternation is non-capturing).
        const from = aliases.get(match[1]) ?? match[1];
        const to = aliases.get(match[2]) ?? match[2];
        if (from === to)
            continue;
        const label = (match[3] ?? '').trim().slice(0, 60);
        messages.push({ from, to, label });
        if (messages.length >= MESSAGE_LIMIT)
            break;
    }
    return messages;
}
/**
 * Stage 2 (doc): locate the architecture doc, extract its `## 时序` section,
 * and parse it verbatim into messages.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - role language (doc candidate ordering).
 * @returns the doc-sourced figure, or null when no usable section exists.
 */
export async function extractSequenceFromDoc(fs, root, language) {
    const docPath = await detectArchDocs(fs, root, language);
    if (docPath === null)
        return null;
    const target = await fs.resolve(docPath);
    const info = await fs.stat(target);
    if (info === undefined || info.type !== 'file')
        return null;
    const text = (await fs.readText(target)).slice(0, 262144);
    const section = sectionText(text, '时序');
    if (section === null)
        return null;
    const messages = parseSequenceSection(section);
    if (messages.length < MIN_MESSAGES)
        return null;
    return { source: 'doc', messages, ref: `${docPath.replace(/\\/g, '/')}#时序` };
}
/** Extract the level-2 section with the given title (until the next ≤2 heading). */
export function sectionText(text, title) {
    const lines = text.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        const heading = HEADING_RE.exec(lines[i].trim());
        if (heading !== null && heading[1].length === 2 && heading[2].trim() === title) {
            start = i + 1;
            break;
        }
    }
    if (start < 0)
        return null;
    const out = [];
    for (let i = start; i < lines.length; i += 1) {
        const heading = HEADING_RE.exec(lines[i].trim());
        if (heading !== null && heading[1].length <= 2)
            break;
        out.push(lines[i]);
    }
    return out.join('\n').trim();
}
/** Read the sequence cache: object format, legacy raw arrays map to 'flow'.
 * Method-level results live under a `-methods` suffix so entity and method
 * figures never collide. */
export async function readSeqCache(fs, root, language, methods = false) {
    try {
        const target = await fs.resolve(cacheName(SEQ_CACHE, language, methods), { cwd: root });
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return null;
        const text = (await fs.readText(target)).trim();
        if (text === '')
            return null;
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            const messages = parsed;
            if (messages.length === 0)
                return null;
            return { source: 'flow', messages };
        }
        if (typeof parsed === 'object' && parsed !== null) {
            const obj = parsed;
            if ((obj.source === 'doc' || obj.source === 'flow') && Array.isArray(obj.messages) && obj.messages.length > 0) {
                const result = { source: obj.source, messages: obj.messages };
                if (typeof obj.ref === 'string' && obj.ref !== '')
                    result.ref = obj.ref;
                return result;
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
/** Persist a doc-sourced figure so subsequent reads skip the doc scan. */
export async function writeSeqCache(fs, root, language, result, sandboxPolicy, methods = false) {
    const target = await fs.resolve(cacheName(SEQ_CACHE, language, methods), { cwd: root });
    await fs.writeText(target, JSON.stringify(result), undefined, undefined, sandboxPolicy);
}
/**
 * The resolution chain: code call graph → cached result → doc section →
 * LLM induction. The LLM stage writes its own cache (raw array) via
 * writeStructuredCache; the doc stage caches the parsed object here.
 * With prefer 'flow' (the main-flow sequence view), the static call-graph
 * stage is skipped: the caller wants the core main-flow sequence, so the
 * chain starts at the cache and falls through doc extraction to LLM
 * induction.
 * @param ctx - host context (llm services for the fallback stage).
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param index - code index result (raw call edges for stage 1).
 * @param language - role language.
 * @param sandboxPolicy - session-scoped policy for cache writes.
 * @param prefer - 'code' (default) prefers the static call graph; 'flow'
 *   resolves the main-flow sequence only (cache → doc → LLM).
 * @param methodLevel - 🔬 方法级: skip the shared (entity-level) profile and
 *   induce from the method-level summary (methods + call edges).
 * @returns the figure, or null when no stage produced usable data.
 */
export async function resolveSequence(ctx, fs, root, index, language, sandboxPolicy, prefer = 'code', methodLevel = false) {
    console.log(`[arch-lens] resolveSequence: prefer=${prefer} calls=${index.calls?.length ?? 0} packages=${index.packages.length}`);
    if (prefer === 'code') {
        const fromCalls = buildSequenceFromCalls(index, language);
        if (fromCalls !== null) {
            console.log(`[arch-lens] resolveSequence: source=code (${fromCalls.messages.length} messages)`);
            return fromCalls;
        }
        // Fallback: no static call edges (type-only imports / dynamic wiring such
        // as ctx.get) — derive the code view from the real cross-package import
        // references instead, so it still shows a genuine code fact that differs
        // from the flow view.
        const fromImports = buildSequenceFromImports(index, language);
        if (fromImports !== null) {
            console.log(`[arch-lens] resolveSequence: source=code (import references, ${fromImports.messages.length} messages)`);
            return fromImports;
        }
    }
    const cached = await readSeqCache(fs, root, language, methodLevel);
    if (cached !== null) {
        console.log(`[arch-lens] resolveSequence: source=${cached.source} (cached${methodLevel ? ', method-level' : ''})`);
        return cached;
    }
    const fromDoc = await extractSequenceFromDoc(fs, root, language);
    if (fromDoc !== null) {
        console.log(`[arch-lens] resolveSequence: source=doc (${fromDoc.messages.length} messages)`);
        await writeSeqCache(fs, root, language, fromDoc, sandboxPolicy, methodLevel);
        return fromDoc;
    }
    // Stage: shared analysis profile (consumed AFTER code/doc, BEFORE the
    // chain-own LLM induction). Messages are cross-checked against the
    // profile's validated coreIds, so the figure cannot cite invented packages.
    // Skipped in method-level mode: the shared profile is entity-level by design.
    if (!methodLevel) {
        const profile = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy);
        if (profile.seqMessages !== undefined && profile.seqMessages.length >= MIN_MESSAGES) {
            const idSet = new Set(profile.coreIds);
            const messages = profile.seqMessages.filter(message => idSet.has(message.from) && idSet.has(message.to) && message.from !== message.to && message.label !== '');
            if (messages.length >= MIN_MESSAGES) {
                console.log(`[arch-lens] resolveSequence: source=flow (shared profile, ${messages.length} messages)`);
                const result = { source: 'flow', messages };
                await writeSeqCache(fs, root, language, result, sandboxPolicy, methodLevel);
                return result;
            }
        }
    }
    console.log(`[arch-lens] resolveSequence: no code/doc data — falling to LLM induction${methodLevel ? ' (method-level)' : ''}`);
    const generated = await writeStructuredCache(ctx, fs, root, index, language, 'seq', sandboxPolicy, methodLevel);
    if (Array.isArray(generated) && generated.length > 0) {
        return { source: 'flow', messages: generated };
    }
    return null;
}
//# sourceMappingURL=sequence.js.map