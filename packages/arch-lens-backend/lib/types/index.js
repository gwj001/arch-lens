/**
 * Arch Lens backend host service: workspace graph scanning, component detail
 * projection, and answer-level note recording. Read-only graph/component/notes
 * methods cross to the browser via Typert Remote; note file WRITES have exactly
 * one path — the session/event listener below. notePending only stages in-memory
 * question metadata; it never touches the file.
 * @module @deepseek-ai/dsh-arch-lens-backend
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Service } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import s from '@deepseek-ai/schemastery';
import { appendNote, readNotes } from "./notes.js";
import { scanWorkspace } from "./scan.js";
import { summarizeDuties } from "./summarize.js";
import { progressStats, summarizeProgress } from "./progress.js";
import { analyzeWorkspace } from "./analyze.js";
import { conceptTree } from "./concept.js";
import { flowDiagram } from "./flow.js";
import { generateDocSection, generateFullDocs, readStructuredCache } from "./docsgen.js";
import { dependencyFlowchart, entityErDiagram, importFlowchart, packageErDiagram, coreFlowchart, coreErDiagram } from "./mermaid.js";
import { coreGraph } from "./core.js";
// Export the wire types AND the shared runtime helper (groupLabel) — the
// client bundle imports it as a value.
export * from "./types.js";
/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = 'ARCH-NOTES.md';
/** Per-workspace prompt configuration file in the workspace root. */
const PROMPT_CONFIG_FILE = '.arch-lens-prompts.json';
/**
 * The Arch Lens backend Remote service (`ctx.archLens`).
 */
let ArchLensService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _remoteGraph_decorators;
    let _remoteRefresh_decorators;
    let _remoteRefreshIndex_decorators;
    let _remoteSetSession_decorators;
    let _remoteComponent_decorators;
    let _remoteNotes_decorators;
    let _remoteMermaidDeps_decorators;
    let _remoteMermaidEr_decorators;
    let _remoteMermaidIndexed_decorators;
    let _remoteMermaidCore_decorators;
    let _remoteConceptTree_decorators;
    let _remoteGenerateDocs_decorators;
    let _remoteGenerateDocSection_decorators;
    let _remoteSequence_decorators;
    let _remoteEvents_decorators;
    let _remoteFlow_decorators;
    let _remoteAnalyze_decorators;
    let _remoteSummarizeDuties_decorators;
    let _remoteProgress_decorators;
    let _remoteProgressStats_decorators;
    let _remoteNotePending_decorators;
    let _remoteNotePendingClear_decorators;
    let _remotePromptConfig_decorators;
    let _remotePromptConfigSave_decorators;
    return class ArchLensService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate(this, null, _remoteGraph_decorators, { kind: "method", name: "remoteGraph", static: false, private: false, access: { has: obj => "remoteGraph" in obj, get: obj => obj.remoteGraph }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteRefresh_decorators, { kind: "method", name: "remoteRefresh", static: false, private: false, access: { has: obj => "remoteRefresh" in obj, get: obj => obj.remoteRefresh }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteRefreshIndex_decorators, { kind: "method", name: "remoteRefreshIndex", static: false, private: false, access: { has: obj => "remoteRefreshIndex" in obj, get: obj => obj.remoteRefreshIndex }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteSetSession_decorators, { kind: "method", name: "remoteSetSession", static: false, private: false, access: { has: obj => "remoteSetSession" in obj, get: obj => obj.remoteSetSession }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteComponent_decorators, { kind: "method", name: "remoteComponent", static: false, private: false, access: { has: obj => "remoteComponent" in obj, get: obj => obj.remoteComponent }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteNotes_decorators, { kind: "method", name: "remoteNotes", static: false, private: false, access: { has: obj => "remoteNotes" in obj, get: obj => obj.remoteNotes }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteMermaidDeps_decorators, { kind: "method", name: "remoteMermaidDeps", static: false, private: false, access: { has: obj => "remoteMermaidDeps" in obj, get: obj => obj.remoteMermaidDeps }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteMermaidEr_decorators, { kind: "method", name: "remoteMermaidEr", static: false, private: false, access: { has: obj => "remoteMermaidEr" in obj, get: obj => obj.remoteMermaidEr }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteMermaidIndexed_decorators, { kind: "method", name: "remoteMermaidIndexed", static: false, private: false, access: { has: obj => "remoteMermaidIndexed" in obj, get: obj => obj.remoteMermaidIndexed }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteMermaidCore_decorators, { kind: "method", name: "remoteMermaidCore", static: false, private: false, access: { has: obj => "remoteMermaidCore" in obj, get: obj => obj.remoteMermaidCore }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteConceptTree_decorators, { kind: "method", name: "remoteConceptTree", static: false, private: false, access: { has: obj => "remoteConceptTree" in obj, get: obj => obj.remoteConceptTree }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteGenerateDocs_decorators, { kind: "method", name: "remoteGenerateDocs", static: false, private: false, access: { has: obj => "remoteGenerateDocs" in obj, get: obj => obj.remoteGenerateDocs }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteGenerateDocSection_decorators, { kind: "method", name: "remoteGenerateDocSection", static: false, private: false, access: { has: obj => "remoteGenerateDocSection" in obj, get: obj => obj.remoteGenerateDocSection }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteSequence_decorators, { kind: "method", name: "remoteSequence", static: false, private: false, access: { has: obj => "remoteSequence" in obj, get: obj => obj.remoteSequence }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteEvents_decorators, { kind: "method", name: "remoteEvents", static: false, private: false, access: { has: obj => "remoteEvents" in obj, get: obj => obj.remoteEvents }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteFlow_decorators, { kind: "method", name: "remoteFlow", static: false, private: false, access: { has: obj => "remoteFlow" in obj, get: obj => obj.remoteFlow }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteAnalyze_decorators, { kind: "method", name: "remoteAnalyze", static: false, private: false, access: { has: obj => "remoteAnalyze" in obj, get: obj => obj.remoteAnalyze }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteSummarizeDuties_decorators, { kind: "method", name: "remoteSummarizeDuties", static: false, private: false, access: { has: obj => "remoteSummarizeDuties" in obj, get: obj => obj.remoteSummarizeDuties }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteProgress_decorators, { kind: "method", name: "remoteProgress", static: false, private: false, access: { has: obj => "remoteProgress" in obj, get: obj => obj.remoteProgress }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteProgressStats_decorators, { kind: "method", name: "remoteProgressStats", static: false, private: false, access: { has: obj => "remoteProgressStats" in obj, get: obj => obj.remoteProgressStats }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteNotePending_decorators, { kind: "method", name: "remoteNotePending", static: false, private: false, access: { has: obj => "remoteNotePending" in obj, get: obj => obj.remoteNotePending }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteNotePendingClear_decorators, { kind: "method", name: "remoteNotePendingClear", static: false, private: false, access: { has: obj => "remoteNotePendingClear" in obj, get: obj => obj.remoteNotePendingClear }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remotePromptConfig_decorators, { kind: "method", name: "remotePromptConfig", static: false, private: false, access: { has: obj => "remotePromptConfig" in obj, get: obj => obj.remotePromptConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remotePromptConfigSave_decorators, { kind: "method", name: "remotePromptConfigSave", static: false, private: false, access: { has: obj => "remotePromptConfigSave" in obj, get: obj => obj.remotePromptConfigSave }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['fs', 'sandboxPolicy'];
        /** Loader validation for the optional note file name. */
        static Config = s.object({
            notesFile: s.string(),
        });
        notesFile = __runInitializers(this, _instanceExtraInitializers);
        graphCache = null;
        graphInFlight = null;
        pending = null;
        /** Session whose cwd anchors the workspace root; null falls back to the sandbox policy. */
        targetSessionId = null;
        /**
         * @param ctx - host context carrying fs and sandboxPolicy.
         * @param config - optional notes file name.
         */
        constructor(ctx, config = {}) {
            super(ctx, 'archLens');
            this.notesFile = config.notesFile ?? DEFAULT_NOTES_FILE;
        }
        /** Resolve the workspace root from the target session's cwd, else the sandbox policy. */
        resolveRoot() {
            const target = this.targetSessionId;
            if (target !== null) {
                const session = this.ctx.get('sessions')?.get(target);
                const cwd = session?.header.cwd;
                if (cwd !== undefined)
                    return cwd;
            }
            const sandboxPolicy = this.ctx.get('sandboxPolicy');
            const root = sandboxPolicy?.workspaceRoot;
            if (root === undefined)
                return { error: 'cannot resolve workspace root (sandboxPolicy.workspaceRoot missing)' };
            return root;
        }
        /** Scan (with cache) the workspace package tree; concurrent callers share one scan. */
        graph() {
            if (this.graphCache !== null)
                return Promise.resolve(this.graphCache);
            if (this.graphInFlight !== null)
                return this.graphInFlight;
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return Promise.resolve(root);
            const fs = this.ctx.fs;
            this.graphInFlight = scanWorkspace(fs, root).then(result => {
                this.graphInFlight = null;
                this.graphCache = result;
                return result;
            });
            return this.graphInFlight;
        }
        /**
         * The scanned workspace graph (cached until refresh).
         * @returns graph or error.
         */
        async remoteGraph() {
            return this.graph();
        }
        /**
         * Rescan = REBUILD EVERY fact source: invalidate the scan graph, the
         * code-index (in-memory + disk), and the AI caches (concept tree /
         * sequence / events). The next read of any figure re-derives from current
         * code and docs — no stale fact may survive a rescan.
         * @returns the fresh scan graph or error.
         */
        async remoteRefresh() {
            this.graphCache = null;
            await this.refreshCodeIndex();
            await this.removeAICaches();
            return this.graph();
        }
        /**
         * Refresh only the code-index facts (in-memory + disk invalidated). Used by
         * "refresh this figure": the figure then re-derives from a fresh index.
         * @returns acknowledgement.
         */
        async remoteRefreshIndex() {
            await this.refreshCodeIndex();
            return { ok: true };
        }
        /**
         * Point the desk's data source at one session's workspace. Selecting a
         * target session switches the scanned root to that session's cwd and drops
         * the cached scan graph; null falls back to the sandbox policy root. The
         * resolved workspace root travels on the graph result instead (the desk
         * client keys its figures on `graph.root`).
         * @param sessionId - target session id, or null for the policy root.
         * @returns acknowledgement.
         */
        async remoteSetSession(sessionId) {
            this.targetSessionId = sessionId;
            this.graphCache = null;
            this.graphInFlight = null;
            return { ok: true };
        }
        /** Invalidate the code-index for the workspace (no-op when unavailable). */
        async refreshCodeIndex() {
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return;
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return;
            try {
                await codeIndex.refresh(root);
            }
            catch (error) {
                console.warn(`[arch-lens] code-index refresh failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        /** Remove the per-language AI caches (concept tree / sequence / events). */
        async removeAICaches() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return;
            const fs = this.ctx.fs;
            try {
                const rootTarget = await fs.resolve('.', { cwd: root });
                const entries = await fs.listDir(rootTarget);
                for (const entry of entries) {
                    if (entry.type !== 'file')
                        continue;
                    const name = entry.name;
                    if (['.arch-lens-concept-', '.arch-lens-sequence-', '.arch-lens-events-', '.arch-lens-flow-', '.arch-lens-core-'].some(prefix => name.startsWith(prefix)) && name.endsWith('.json')) {
                        try {
                            // Blank the file: readers treat an unparseable cache as absent
                            // (the fs service has no delete API), so the next read rebuilds.
                            await fs.writeText(entry.target, '');
                            console.log(`[arch-lens] invalidated AI cache ${name}`);
                        }
                        catch {
                            // best-effort invalidation
                        }
                    }
                }
            }
            catch {
                // absent cache files are fine — nothing to invalidate
            }
        }
        /**
         * Detail projection for one package. The graph carries precomputed details,
         * so this is a plain lookup (kept as a Remote for compatibility).
         * @param request - package id.
         * @returns detail or error.
         */
        async remoteComponent(request) {
            const graph = await this.graph();
            if ('error' in graph)
                return graph;
            const node = graph.nodes.find(candidate => candidate.id === request.id);
            if (node === undefined)
                return { error: `unknown component: ${request.id}` };
            return node.detail;
        }
        /**
         * The note file listing, newest first.
         * @returns notes listing or an error.
         */
        async remoteNotes() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return { path: this.notesFile, entries: [] };
            return readNotes(this.ctx.fs, root, this.notesFile);
        }
        /**
         * Mermaid dependency flowchart for the scanned graph.
         * @returns flowchart source or an error.
         */
        async remoteMermaidDeps() {
            const graph = await this.graph();
            if ('error' in graph)
                return graph;
            return { kind: 'flowchart', source: dependencyFlowchart(graph) };
        }
        /**
         * Mermaid ER diagram of package relationships for the scanned graph.
         * @returns erDiagram source or an error.
         */
        async remoteMermaidEr() {
            const graph = await this.graph();
            if ('error' in graph)
                return graph;
            return { kind: 'erDiagram', source: packageErDiagram(graph) };
        }
        /**
         * Mermaid diagrams over the code-index imports: source-level dependency
         * edges (real imports) instead of npm peerDependencies. Falls back to the
         * scanned-graph variants when the codeIndex service or a language is absent.
         * @param request - diagram kind.
         * @returns mermaid source or an error.
         */
        async remoteMermaidIndexed(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.ctx.get('codeIndex');
            if (codeIndex === undefined) {
                return { error: 'codeIndex service unavailable' };
            }
            try {
                const index = await codeIndex.indexWorkspace(root);
                if (index.language === 'unknown')
                    return { error: 'unsupported workspace language (no package.json / pyproject.toml / pom.xml)' };
                return request.kind === 'flowchart'
                    ? { kind: 'flowchart', source: importFlowchart(index) }
                    : { kind: 'erDiagram', source: entityErDiagram(index) };
            }
            catch (error) {
                return { error: `indexed mermaid failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Core-flow diagram (deps/ER overview): the LLM-selected core packages with
         * rule-derived source-import edges. Returns the mermaid source plus the
         * selection provenance so the client can badge/explain it.
         * @param request - diagram kind, role language, and whether to force a new selection.
         * @returns mermaid source and core selection, or an error.
         */
        async remoteMermaidCore(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root);
                const core = await coreGraph(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true);
                if ('error' in core)
                    return core;
                const source = request.kind === 'flowchart' ? coreFlowchart(index, core.ids) : coreErDiagram(index, core.ids);
                return { kind: request.kind, source, core };
            }
            catch (error) {
                return { error: `core diagram failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /** Shared codeIndex accessor for the concept/docs remotes. */
        codeIndexService() {
            return this.ctx.get('codeIndex');
        }
        /**
         * Concept hierarchy via the one-way chain: architecture doc (extract +
         * LLM enhance) first, LLM-from-flow as fallback. Cached per language.
         * @param request - role language and whether to force regeneration.
         * @returns concept-tree nodes or an error.
         */
        async remoteConceptTree(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root);
                const tree = await conceptTree(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true);
                if ('error' in tree)
                    return tree;
                return tree;
            }
            catch (error) {
                return { error: `concept tree failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Generate the complete architecture doc (global button): one LLM pass
         * writes concept/sequence/interaction/dependency/ER/catalog sections.
         * @param request - role language.
         * @returns the doc path or an error.
         */
        async remoteGenerateDocs(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root);
                return await generateFullDocs(this.ctx, this.ctx.fs, root, index, request.language ?? '中文');
            }
            catch (error) {
                return { error: `generate docs failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Generate one doc section on demand (per-tab "AI generate"). Sequence and
         * interaction also refresh their structured caches.
         * @param request - section kind and role language.
         * @returns the doc path or an error.
         */
        async remoteGenerateDocSection(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root);
                return await generateDocSection(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.kind);
            }
            catch (error) {
                return { error: `generate doc section failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Structured figure data for the sequence tab: LLM-generated from the code
         * index (cached per language); the client renders an empty state when this
         * this returns null.
         * @param request - role language.
         * @returns message array, null, or an error.
         */
        async remoteSequence(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            return (await readStructuredCache(this.ctx.fs, root, request.language ?? '中文', 'seq'));
        }
        /**
         * Structured figure data for the interaction tab (cached per language).
         * @param request - role language.
         * @returns event array, null, or an error.
         */
        async remoteEvents(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            return (await readStructuredCache(this.ctx.fs, root, request.language ?? '中文', 'interaction'));
        }
        /**
         * Flow diagram via the dual chain: architecture doc flow block first
         * (verbatim mermaid, or LLM transcode of a pseudo-code block — both
         * `source: 'doc'` with an anchor), LLM induction from code metadata as the
         * fallback (`source: 'flow'`, non-authoritative). Cached per language.
         * @param request - role language and whether to force regeneration.
         * @returns the flow diagram or an error.
         */
        async remoteFlow(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root);
                return await flowDiagram(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true);
            }
            catch (error) {
                return { error: `flow diagram failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Code-derived insights: services/events/tools/remotes extracted from each
         * package's entry source. This is the "code-first" view — documentation is
         * a reference, but the analysis never depends on it.
         * @returns insight records or an error.
         */
        async remoteAnalyze() {
            const graph = await this.graph();
            if ('error' in graph)
                return graph;
            return analyzeWorkspace(this.ctx.fs, graph);
        }
        /**
         * AI one-line duty summaries for the package catalog, in the role language.
         * @param request - output language (default 中文).
         * @returns id → summary map, or an error.
         */
        async remoteSummarizeDuties(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const graph = await this.graph();
            if ('error' in graph)
                return graph;
            return summarizeDuties(this.ctx, this.ctx.fs, root, graph, request.language ?? '中文');
        }
        /**
         * AI learning-progress summary: contrasts the note targets against the
         * scanned graph and appends a model-generated entry to the note file bottom.
         * @param request - role language and whether to force regeneration.
         * @returns progress stats plus the generated summary, or an error.
         */
        async remoteProgress(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const graph = await this.graph();
            if ('error' in graph)
                return graph;
            return summarizeProgress(this.ctx, this.ctx.fs, root, graph, this.notesFile, request.language ?? '中文', request.force === true);
        }
        /**
         * Read-only learning-progress statistics (no LLM call).
         * @returns asked/unasked lists and the coverage percentage.
         */
        async remoteProgressStats() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const graph = await this.graph();
            if ('error' in graph)
                return graph;
            return progressStats(this.ctx.fs, root, graph, this.notesFile);
        }
        /**
         * Stage question metadata for the next assistant/message answer. Memory
         * only — the file write stays exclusively on the event path below.
         * @param request - target label, question text, and calling session id.
         * @returns acknowledgement.
         */
        async remoteNotePending(request) {
            this.pending = {
                target: request.target ?? '架构讲解',
                question: request.text ?? '',
                sessionId: request.sessionId ?? null,
            };
            return { ok: true };
        }
        /**
         * Clear any staged question metadata — called by the desk after a failed
         * explain send so no later ordinary assistant/message gets mis-recorded as
         * an explain. Memory only; the note write stays on the event path.
         * @returns acknowledgement.
         */
        async remoteNotePendingClear() {
            this.pending = null;
            return { ok: true };
        }
        /**
         * Read the persisted per-workspace prompt configuration.
         * @returns the config and its storage path.
         */
        async remotePromptConfig() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return { path: PROMPT_CONFIG_FILE, config: {} };
            const fs = this.ctx.fs;
            try {
                const target = await fs.resolve(PROMPT_CONFIG_FILE, { cwd: root });
                const info = await fs.stat(target);
                if (info === undefined || info.type !== 'file')
                    return { path: PROMPT_CONFIG_FILE, config: {} };
                const text = await fs.readText(target);
                return { path: PROMPT_CONFIG_FILE, config: JSON.parse(text) };
            }
            catch {
                return { path: PROMPT_CONFIG_FILE, config: {} };
            }
        }
        /**
         * Persist the per-workspace prompt configuration.
         * @param request - config fields to store (absent fields keep their stored value).
         * @returns the stored config and its path.
         */
        async remotePromptConfigSave(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const fs = this.ctx.fs;
            try {
                const target = await fs.resolve(PROMPT_CONFIG_FILE, { cwd: root });
                const info = await fs.stat(target);
                const existing = info !== undefined && info.type === 'file'
                    ? JSON.parse(await fs.readText(target))
                    : {};
                const merged = {};
                if (request.overviewPrompt !== undefined)
                    merged.overviewPrompt = request.overviewPrompt;
                else if (existing.overviewPrompt !== undefined)
                    merged.overviewPrompt = existing.overviewPrompt;
                if (request.explainStyle !== undefined)
                    merged.explainStyle = request.explainStyle;
                else if (existing.explainStyle !== undefined)
                    merged.explainStyle = existing.explainStyle;
                if (request.language !== undefined)
                    merged.language = request.language;
                else if (existing.language !== undefined)
                    merged.language = existing.language;
                if (request.useDefaults !== undefined)
                    merged.useDefaults = request.useDefaults;
                else if (existing.useDefaults !== undefined)
                    merged.useDefaults = existing.useDefaults;
                await fs.writeText(target, JSON.stringify(merged, null, 2));
                return { path: PROMPT_CONFIG_FILE, config: merged };
            }
            catch (error) {
                return { error: `prompt config save failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /** Register the single note-write path: assistant/message events. */
        async [(_remoteGraph_decorators = [Remote('graph')], _remoteRefresh_decorators = [Remote('refresh')], _remoteRefreshIndex_decorators = [Remote('refreshIndex')], _remoteSetSession_decorators = [Remote('setSession')], _remoteComponent_decorators = [Remote('component')], _remoteNotes_decorators = [Remote('notes')], _remoteMermaidDeps_decorators = [Remote('mermaidDeps')], _remoteMermaidEr_decorators = [Remote('mermaidEr')], _remoteMermaidIndexed_decorators = [Remote('mermaidIndexed')], _remoteMermaidCore_decorators = [Remote('mermaidCore')], _remoteConceptTree_decorators = [Remote('conceptTree')], _remoteGenerateDocs_decorators = [Remote('generateDocs')], _remoteGenerateDocSection_decorators = [Remote('generateDocSection')], _remoteSequence_decorators = [Remote('sequence')], _remoteEvents_decorators = [Remote('events')], _remoteFlow_decorators = [Remote('flow')], _remoteAnalyze_decorators = [Remote('analyze')], _remoteSummarizeDuties_decorators = [Remote('summarizeDuties')], _remoteProgress_decorators = [Remote('progress')], _remoteProgressStats_decorators = [Remote('progressStats')], _remoteNotePending_decorators = [Remote('notePending')], _remoteNotePendingClear_decorators = [Remote('notePendingClear')], _remotePromptConfig_decorators = [Remote('promptConfig')], _remotePromptConfigSave_decorators = [Remote('promptConfigSave')], Service.init)]() {
            this.ctx.on('session/event', (session, event) => {
                if (event.type !== 'assistant/message')
                    return;
                const message = event.data.message;
                let answer = '';
                for (const block of message.content) {
                    if (block.type === 'text')
                        answer += block.text;
                }
                // Skip empty-content assistant/message events: they exist only to host
                // usage metadata, and writing them would record blank note entries.
                if (answer.trim() === '')
                    return;
                if (this.pending !== null && this.pending.sessionId !== null && session.id !== this.pending.sessionId)
                    return;
                const staged = this.pending;
                // Only panel-initiated explains (notePending pre-registration) are
                // recorded — ordinary conversation (bug discussions, design decisions)
                // must not pollute the learning notes.
                if (staged === null)
                    return;
                this.pending = null;
                // The listener runs on the service (root) context, where the sandbox
                // policy has no session scope — use the event's own session cwd instead.
                const root = session.header.cwd ?? this.rootFromPolicy();
                if (root === undefined)
                    return;
                void appendNote(this.ctx.fs, root, {
                    target: staged.target,
                    question: staged.question,
                    answer,
                }, this.notesFile).then(result => {
                    if ('ok' in result && result.skipped === true) {
                        console.log('[arch-lens] note skipped: duplicate question (same target and question head)');
                    }
                });
            });
        }
        /** Policy-derived workspace root, used only when the event session has no cwd. */
        rootFromPolicy() {
            return this.ctx.get('sandboxPolicy')?.workspaceRoot;
        }
    };
})();
export { ArchLensService };
export default ArchLensService;
//# sourceMappingURL=index.js.map