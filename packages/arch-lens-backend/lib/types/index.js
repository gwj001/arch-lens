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
import { conceptTree, generateFromFlow } from "./concept.js";
import { flowDiagram } from "./flow.js";
import { generateDocSection, generateFullDocs, readStructuredCache, writeStructuredCache } from "./docsgen.js";
import { resolveSequence } from "./sequence.js";
import { dependencyFlowchart, entityErDiagram, importFlowchart, packageErDiagram, coreFlowchart, coreErDiagram, overviewFigure } from "./mermaid.js";
import { coreGraph } from "./core.js";
import { ensureAnalysisProfile, clearAnalysisProfileCache, regenerateProfileField } from "./analysis.js";
import { llmStatsSnapshot } from "./llm-stats.js";
import { abortGeneration, currentGenerationStatus, generationSignal, waitForGenerationStatus } from "./abort.js";
import { buildDynamicFigurePrompt, buildFigurePrompt, dynamicFigureCacheName, dynamicTargetKey, extractFigureJson, writeDynamicFigureCache, writeFigureCache, } from "./session-figure.js";
import { sanitizeMermaid } from "./flow-angle.js";
import { sessionPolicy as resolveSessionPolicy } from "./policy.js";
// Export the wire types AND the shared runtime helper (groupLabel) — the
// client bundle imports it as a value.
export * from "./types.js";
/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = 'ARCH-NOTES.md';
/** Persisted scan-graph cache in the workspace root (reopening after a host
 * restart must not re-walk the filesystem; refresh() invalidates it). */
const GRAPH_CACHE_FILE = '.arch-lens-graph.json';
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
    let _remoteOverviewFigure_decorators;
    let _remoteConceptTree_decorators;
    let _remoteGenerateDocs_decorators;
    let _remoteGenerateDocSection_decorators;
    let _remoteSequence_decorators;
    let _remoteRegenerateFigure_decorators;
    let _remoteLastAnswer_decorators;
    let _remoteGenerationStatus_decorators;
    let _remoteGenerationStatusNext_decorators;
    let _remoteFigurePrompt_decorators;
    let _remoteDynamicFigurePrompt_decorators;
    let _remoteDynamicFigure_decorators;
    let _remoteCancelGeneration_decorators;
    let _remoteEvents_decorators;
    let _remoteFlow_decorators;
    let _remoteAnalyze_decorators;
    let _remoteSummarizeDuties_decorators;
    let _remoteProgress_decorators;
    let _remoteProgressStats_decorators;
    let _remoteLlmStats_decorators;
    let _remoteNotePending_decorators;
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
            __esDecorate(this, null, _remoteOverviewFigure_decorators, { kind: "method", name: "remoteOverviewFigure", static: false, private: false, access: { has: obj => "remoteOverviewFigure" in obj, get: obj => obj.remoteOverviewFigure }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteConceptTree_decorators, { kind: "method", name: "remoteConceptTree", static: false, private: false, access: { has: obj => "remoteConceptTree" in obj, get: obj => obj.remoteConceptTree }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteGenerateDocs_decorators, { kind: "method", name: "remoteGenerateDocs", static: false, private: false, access: { has: obj => "remoteGenerateDocs" in obj, get: obj => obj.remoteGenerateDocs }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteGenerateDocSection_decorators, { kind: "method", name: "remoteGenerateDocSection", static: false, private: false, access: { has: obj => "remoteGenerateDocSection" in obj, get: obj => obj.remoteGenerateDocSection }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteSequence_decorators, { kind: "method", name: "remoteSequence", static: false, private: false, access: { has: obj => "remoteSequence" in obj, get: obj => obj.remoteSequence }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteRegenerateFigure_decorators, { kind: "method", name: "remoteRegenerateFigure", static: false, private: false, access: { has: obj => "remoteRegenerateFigure" in obj, get: obj => obj.remoteRegenerateFigure }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteLastAnswer_decorators, { kind: "method", name: "remoteLastAnswer", static: false, private: false, access: { has: obj => "remoteLastAnswer" in obj, get: obj => obj.remoteLastAnswer }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteGenerationStatus_decorators, { kind: "method", name: "remoteGenerationStatus", static: false, private: false, access: { has: obj => "remoteGenerationStatus" in obj, get: obj => obj.remoteGenerationStatus }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteGenerationStatusNext_decorators, { kind: "method", name: "remoteGenerationStatusNext", static: false, private: false, access: { has: obj => "remoteGenerationStatusNext" in obj, get: obj => obj.remoteGenerationStatusNext }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteFigurePrompt_decorators, { kind: "method", name: "remoteFigurePrompt", static: false, private: false, access: { has: obj => "remoteFigurePrompt" in obj, get: obj => obj.remoteFigurePrompt }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteDynamicFigurePrompt_decorators, { kind: "method", name: "remoteDynamicFigurePrompt", static: false, private: false, access: { has: obj => "remoteDynamicFigurePrompt" in obj, get: obj => obj.remoteDynamicFigurePrompt }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteDynamicFigure_decorators, { kind: "method", name: "remoteDynamicFigure", static: false, private: false, access: { has: obj => "remoteDynamicFigure" in obj, get: obj => obj.remoteDynamicFigure }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteCancelGeneration_decorators, { kind: "method", name: "remoteCancelGeneration", static: false, private: false, access: { has: obj => "remoteCancelGeneration" in obj, get: obj => obj.remoteCancelGeneration }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteEvents_decorators, { kind: "method", name: "remoteEvents", static: false, private: false, access: { has: obj => "remoteEvents" in obj, get: obj => obj.remoteEvents }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteFlow_decorators, { kind: "method", name: "remoteFlow", static: false, private: false, access: { has: obj => "remoteFlow" in obj, get: obj => obj.remoteFlow }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteAnalyze_decorators, { kind: "method", name: "remoteAnalyze", static: false, private: false, access: { has: obj => "remoteAnalyze" in obj, get: obj => obj.remoteAnalyze }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteSummarizeDuties_decorators, { kind: "method", name: "remoteSummarizeDuties", static: false, private: false, access: { has: obj => "remoteSummarizeDuties" in obj, get: obj => obj.remoteSummarizeDuties }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteProgress_decorators, { kind: "method", name: "remoteProgress", static: false, private: false, access: { has: obj => "remoteProgress" in obj, get: obj => obj.remoteProgress }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteProgressStats_decorators, { kind: "method", name: "remoteProgressStats", static: false, private: false, access: { has: obj => "remoteProgressStats" in obj, get: obj => obj.remoteProgressStats }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteLlmStats_decorators, { kind: "method", name: "remoteLlmStats", static: false, private: false, access: { has: obj => "remoteLlmStats" in obj, get: obj => obj.remoteLlmStats }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteNotePending_decorators, { kind: "method", name: "remoteNotePending", static: false, private: false, access: { has: obj => "remoteNotePending" in obj, get: obj => obj.remoteNotePending }, metadata: _metadata }, null, _instanceExtraInitializers);
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
        /** Per-workspace scan cache: keyed by the resolved workspace root, so
         * re-loading the desk on the same workspace never rescans, while switching
         * to a different workspace rescans automatically on the next graph(). */
        graphCaches = new Map();
        /** One in-flight scan (root + promise) so concurrent callers share one scan
         * per root; a scan of another root can run alongside without clobbering it. */
        graphInFlight = null;
        pending = null;
        /** One staged session-driven figure request (🤖 AI 生成 via 会话回合):
         * matched by figId in the agent's answer, written to the figure cache. */
        pendingFigure = null;
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
        /** Scan (with cache) the workspace package tree; concurrent callers share
         * one scan per root. Cache-first: a previously scanned workspace (any
         * session of it) resolves instantly; only a new root triggers a scan.
         * The scan graph is ALSO persisted to `.arch-lens-graph.json` in the
         * workspace root, so reopening the desk after a host restart serves the
         * cached graph instead of re-walking the filesystem. refresh() marks the
         * disk copy invalid before it rescans (the FileSystem has no delete). */
        graph() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return Promise.resolve(root);
            const cached = this.graphCaches.get(root);
            if (cached !== undefined)
                return Promise.resolve(cached);
            if (this.graphInFlight !== null && this.graphInFlight.root === root)
                return this.graphInFlight.promise;
            const fs = this.ctx.fs;
            const promise = this.graphFromDisk(root).then(fromDisk => {
                if (fromDisk !== null) {
                    console.log(`[arch-lens] graph: served from disk cache (root=${root})`);
                    this.graphCaches.set(root, fromDisk);
                    return fromDisk;
                }
                return scanWorkspace(fs, root).then(result => {
                    if (this.graphInFlight !== null && this.graphInFlight.promise === promise)
                        this.graphInFlight = null;
                    this.graphCaches.set(root, result);
                    if (!('error' in result))
                        void this.writeGraphDisk(root, result);
                    return result;
                });
            });
            this.graphInFlight = { root, promise };
            return promise;
        }
        /** Read the persisted scan graph; null when absent, invalidated or foreign. */
        async graphFromDisk(root) {
            try {
                const fs = this.ctx.fs;
                const target = await fs.resolve(GRAPH_CACHE_FILE, { cwd: root }).catch(() => null);
                if (target === null)
                    return null;
                const info = await fs.stat(target).catch(() => undefined);
                if (info === undefined || info.type !== 'file')
                    return null;
                const parsed = JSON.parse(await fs.readText(target));
                if (typeof parsed !== 'object' || parsed === null)
                    return null;
                if (parsed.root !== root)
                    return null;
                const graph = parsed.graph;
                if (typeof graph !== 'object' || graph === null || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
                    return null;
                return graph;
            }
            catch {
                return null;
            }
        }
        /** Persist a fresh scan graph (non-fatal on failure). */
        async writeGraphDisk(root, graph) {
            try {
                const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
                await this.ctx.fs.writeText(target, JSON.stringify({ root, generatedAt: Date.now(), graph }), undefined, undefined, this.sessionPolicy());
            }
            catch {
                // non-fatal
            }
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
            this.graphCaches.clear();
            this.graphInFlight = null;
            // Mark the persisted scan graph invalid: the rescan below overwrites it,
            // and a failed rescan must not resurrect stale data on the next open.
            const root = this.resolveRoot();
            if (typeof root === 'string') {
                try {
                    const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
                    await this.ctx.fs.writeText(target, JSON.stringify({ root, invalidated: true, generatedAt: Date.now() }), undefined, undefined, this.sessionPolicy());
                }
                catch {
                    // non-fatal
                }
            }
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
         * Point the desk's data source at one session's workspace. This is the
         * official wire name (kept for harness-contract compatibility) but its
         * SEMANTICS are "load, never invalidate": only the target session id is
         * set and no cache is touched. The scan cache is keyed by workspace root,
         * so re-loading the same workspace (reopening the panel, switching between
         * its sessions) is instant, while a different workspace rescans
         * automatically on the next graph() call. Explicit invalidation stays
         * exclusively on refresh().
         * @param sessionId - target session id, or null for the policy root.
         * @returns acknowledgement.
         */
        async remoteSetSession(sessionId) {
            this.targetSessionId = sessionId;
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
                await codeIndex.refresh(root, this.sessionPolicy());
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
                    if (['.arch-lens-concept-', '.arch-lens-sequence-', '.arch-lens-events-', '.arch-lens-flow-', '.arch-lens-core-', '.arch-lens-analysis-'].some(prefix => name.startsWith(prefix)) && name.endsWith('.json')) {
                        try {
                            // Blank the file: readers treat an unparseable cache as absent
                            // (the fs service has no delete API), so the next read rebuilds.
                            await fs.writeText(entry.target, '', undefined, undefined, this.sessionPolicy());
                            console.log(`[arch-lens] invalidated AI cache ${name}`);
                        }
                        catch {
                            // best-effort invalidation
                        }
                    }
                }
                // The shared analysis profile's single-flight memory must follow the
                // disk invalidation, or a rescan would keep serving the old profile.
                clearAnalysisProfileCache();
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
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
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
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                const core = await coreGraph(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true, this.sessionPolicy(), request.methodLevel === true);
                if ('error' in core)
                    return core;
                const source = request.kind === 'flowchart' ? coreFlowchart(index, core.ids) : coreErDiagram(index, core.ids);
                return { kind: request.kind, source, core };
            }
            catch (error) {
                return { error: `core diagram failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * 架构概览 (rule-built): the core packages with their one-line duty under
         * the name + source-level import edges between them — zero LLM, built from
         * structured facts (core selection + graph blurbs + index imports). The
         * pure-LLM variant (dynamic figure kind 'overview') stays available for
         * comparison.
         * @param request - role language, force a new core selection.
         * @returns the overview mermaid + core selection, or an error.
         */
        async remoteOverviewFigure(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                const language = request.language ?? '中文';
                const core = await coreGraph(this.ctx, this.ctx.fs, root, index, language, request.force === true, this.sessionPolicy(), false);
                if ('error' in core)
                    return core;
                const graph = await this.graph();
                if ('error' in graph)
                    return graph;
                const blurbOf = (id) => {
                    const node = graph.nodes.find(candidate => candidate.id === id);
                    if (node === undefined)
                        return '';
                    return language === 'English' ? node.blurb : (node.blurbZh ?? node.blurb);
                };
                return { title: '架构概览', mermaid: overviewFigure(index, core.ids, blurbOf), core };
            }
            catch (error) {
                return { error: `overview figure failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /** Shared codeIndex accessor for the concept/docs remotes. */
        codeIndexService() {
            return this.ctx.get('codeIndex');
        }
        /**
         * Session-scoped sandbox policy for every file write: the fs sandbox
         * derives its workspace-write root from the calling session's cwd — the
         * same root this service writes to — so passing it approves the writes.
         */
        sessionPolicy() {
            return resolveSessionPolicy(this.ctx, this.targetSessionId);
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
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                const tree = await conceptTree(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true, this.sessionPolicy(), request.methodLevel === true);
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
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                return await generateFullDocs(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', this.sessionPolicy());
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
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                return await generateDocSection(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.kind, this.sessionPolicy());
            }
            catch (error) {
                return { error: `generate doc section failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Structured figure data for the sequence tab, resolved through the chain:
         * real static call graph first (source 'code'), then the cached doc/LLM
         * result, then the doc's sequence section (source 'doc'), then LLM
         * induction (source 'flow'). With prefer 'flow' the static call-graph
         * stage is skipped, so the main-flow sequence view resolves from the
         * cache, the doc section, or LLM induction. The client renders an empty
         * state on null.
         * @param request - role language and preferred view ('code' | 'flow').
         * @returns the figure (with provenance), null, or an error.
         */
        async remoteSequence(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            try {
                const index = codeIndex === undefined
                    ? { root, language: 'unknown', packages: [] }
                    : await codeIndex.indexWorkspace(root, this.sessionPolicy());
                return await resolveSequence(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', this.sessionPolicy(), request.prefer ?? 'code', request.methodLevel === true);
            }
            catch (error) {
                return { error: `sequence failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Per-tab "AI generate" (分离方案): regenerate ONE shared-profile field
         * with one trimmed-summary LLM call and return the fresh figure data. The
         * profile is updated in memory and on disk; other figures are untouched
         * (except core regeneration, which invalidates flow/seq/events — see
         * analysis.ts). The client renders the returned data directly, so a
         * per-tab generate never rewrites docs/architecture.generated.md.
         * @param request - figure kind and role language.
         * @returns the regenerated field, or an error.
         */
        async remoteRegenerateFigure(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                const language = request.language ?? '中文';
                const methods = request.methodLevel === true;
                // 🔬 方法级: this figure regenerates from the method-level summary with
                // its OWN LLM call — the shared profile (entity-level) is untouched, so
                // other tabs keep their cheap entity-level facts.
                if (methods) {
                    return await this.regenerateFigureMethodLevel(request.kind, index, language);
                }
                const kind = request.kind === 'concepts' ? 'concept'
                    : request.kind === 'deps' || request.kind === 'er' ? 'core'
                        : request.kind === 'interaction' ? 'events'
                            : request.kind;
                const profile = await regenerateProfileField(this.ctx, this.ctx.fs, root, index, language, kind, this.sessionPolicy());
                switch (request.kind) {
                    case 'concepts': {
                        const tree = profile.conceptTree;
                        if (tree === undefined || tree.length === 0)
                            return { error: 'concept regeneration produced no tree' };
                        return { kind: 'concepts', tree };
                    }
                    case 'seq': {
                        const messages = profile.seqMessages;
                        if (messages === undefined || messages.length === 0)
                            return { error: 'seq regeneration produced no messages' };
                        return { kind: 'seq', messages };
                    }
                    case 'flow': {
                        // Both viewpoints come back in one response — the client renders
                        // whichever angle is selected without another LLM call.
                        if (profile.flow === undefined || Object.keys(profile.flow).length === 0) {
                            return { error: 'flow regeneration produced no diagram' };
                        }
                        const flows = {};
                        for (const [angle, flow] of Object.entries(profile.flow)) {
                            flows[angle] = { title: flow.title, source: 'flow', angle, mermaid: sanitizeMermaid(flow.mermaid) };
                        }
                        return { kind: 'flow', flows };
                    }
                    case 'interaction': {
                        const events = profile.events;
                        if (events === undefined || events.length === 0)
                            return { error: 'events regeneration produced no events' };
                        return { kind: 'interaction', events };
                    }
                    default: {
                        if (profile.coreIds.length < 4)
                            return { error: 'core regeneration produced too few packages' };
                        return { kind: 'core', core: { ids: profile.coreIds, source: 'flow' } };
                    }
                }
            }
            catch (error) {
                return { error: `regenerate figure failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * 🔬 方法级 field regeneration: one method-summary LLM call for the figure,
         * independent of the shared (entity-level) profile. Results are written to
         * the method-level caches so a later read with the switch on reuses them.
         * @param kind - the wire figure kind (concepts/seq/flow/interaction/deps/er).
         * @param index - code index result.
         * @param language - role language.
         * @returns the regenerated field, or an error.
         */
        async regenerateFigureMethodLevel(kind, index, language) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            try {
                switch (kind) {
                    case 'concepts': {
                        const tree = await generateFromFlow(this.ctx, index, language, generationSignal(root), true);
                        if (tree.length === 0)
                            return { error: 'concept method-level generation produced no tree' };
                        return { kind: 'concepts', tree };
                    }
                    case 'seq': {
                        const generated = await writeStructuredCache(this.ctx, this.ctx.fs, root, index, language, 'seq', this.sessionPolicy(), true);
                        if (!Array.isArray(generated) || generated.length === 0)
                            return { error: 'seq method-level generation produced no messages' };
                        return { kind: 'seq', messages: generated };
                    }
                    case 'flow': {
                        // Both viewpoints regenerate with the method-level summary (each
                        // its own LLM call) so the angle switch stays instant afterwards.
                        const flows = {};
                        for (const angle of ['event', 'pipeline']) {
                            const flow = await flowDiagram(this.ctx, this.ctx.fs, root, index, language, true, angle, this.sessionPolicy(), true);
                            if (!('error' in flow))
                                flows[angle] = flow;
                        }
                        if (Object.keys(flows).length === 0)
                            return { error: 'flow method-level generation produced no diagram' };
                        return { kind: 'flow', flows };
                    }
                    case 'interaction': {
                        const generated = await writeStructuredCache(this.ctx, this.ctx.fs, root, index, language, 'interaction', this.sessionPolicy(), true);
                        if (!Array.isArray(generated) || generated.length === 0)
                            return { error: 'events method-level generation produced no events' };
                        return { kind: 'interaction', events: generated };
                    }
                    default: {
                        const core = await coreGraph(this.ctx, this.ctx.fs, root, index, language, true, this.sessionPolicy(), true);
                        if ('error' in core)
                            return { error: core.error };
                        return { kind: 'core', core: { ids: core.ids, source: core.source } };
                    }
                }
            }
            catch (error) {
                return { error: `method-level regenerate failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * The latest assistant answer of the target session: visible text plus the
         * reasoning chain (thinking blocks). The panel shows the model's thinking
         * for the last explanation — the reasoning stays in the session message
         * (host-side projection), the client only renders a copy.
         * @param request - optional session id (defaults to the target session).
         * @returns the last assistant message's text/reasoning, or an error.
         */
        async remoteLastAnswer(request) {
            const sessionId = request.sessionId ?? this.targetSessionId;
            if (sessionId === null)
                return { error: 'no target session' };
            const session = this.ctx.get('sessions')?.get(sessionId);
            if (session === undefined)
                return { error: 'session not found' };
            try {
                const messages = session.deriveMessages();
                for (let i = messages.length - 1; i >= 0; i -= 1) {
                    const message = messages[i];
                    if (message === undefined || message.role !== 'assistant')
                        continue;
                    let text = '';
                    let reasoning = '';
                    for (const block of message.content) {
                        if (block.type === 'text')
                            text += block.text;
                        else if (block.type === 'reasoning')
                            reasoning += block.text;
                    }
                    if (text.trim() !== '' || reasoning.trim() !== '')
                        return { text, reasoning };
                }
                return { text: '', reasoning: '' };
            }
            catch (error) {
                return { error: `lastAnswer failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Live generation status of the workspace (⚙️ 生成过程 box): what the LLM
         * is currently doing — stage label, elapsed time, streamed output preview
         * (reasoning tail while thinking). Polled by the panel while a generation
         * is suspected in flight; null when nothing was generated yet.
         * @returns the live status, or null.
         */
        async remoteGenerationStatus() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return null;
            return currentGenerationStatus(root);
        }
        /**
         * LONG-POLL push of the live generation status: resolves when the status
         * seq differs from `since` (a change just happened — throttled to a smooth
         * cadence), or after ~20s with the current snapshot (the panel re-issues
         * immediately). One in-flight request at a time delivers the generation
         * process with SSE-like latency over the regular RPC channel.
         * @param request - the client's last seen seq.
         * @returns the current status snapshot, or null when nothing was generated.
         */
        async remoteGenerationStatusNext(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return null;
            return await waitForGenerationStatus(root, request.since ?? 0);
        }
        /**
         * Build the session message that asks the agent to produce ONE figure
         * (「图生成走会话」): the prompt embeds the code facts; the CLIENT sends it
         * into the current session, so the GUI's own conversation stream shows the
         * agent working in real time. This RPC stages a pendingFigure (matched by
         * figId) and returns immediately — the figure lands in the cache when the
         * agent answers, and the panel refetches it after the turn completes.
         * @param request - figure kind, role language, flow angle, 🔬 method level.
         * @returns the figId + prompt to send, or an error.
         */
        async remoteFigurePrompt(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                const language = request.language ?? '中文';
                const kind = request.kind === 'deps' || request.kind === 'er'
                    ? 'core'
                    : request.kind === 'interaction' ? 'interaction'
                        : request.kind;
                const angle = request.kind === 'flow' ? request.angle ?? 'event' : undefined;
                const methodLevel = request.methodLevel === true;
                const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                const prompt = buildFigurePrompt(kind, index, language, figId, angle, methodLevel);
                this.pendingFigure = {
                    figId,
                    kind,
                    language,
                    ...(angle !== undefined ? { angle } : {}),
                    methodLevel,
                    sessionId: this.targetSessionId,
                    stagedAt: Date.now(),
                    index,
                };
                // One-shot staging: clear after 30 minutes even if the agent never
                // answers (a later ordinary chat reply must not be misparsed — the
                // figId match is the real gate; the TTL is only defensive cleanup,
                // and it must outlast a slow agent turn in the session).
                setTimeout(() => {
                    if (this.pendingFigure?.figId === figId)
                        this.pendingFigure = null;
                }, 30 * 60 * 1000);
                return { figId, prompt };
            }
            catch (error) {
                return { error: `figure prompt failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Build the session message that asks the agent to draw ONE DYNAMIC detail
         * figure (「动态画图」hover drill-down): a sequence-edge drill-down (the two
         * packages' method-level call sequence) or a flow-subgraph expansion (that
         * stage as a detailed flowchart). Same session-turn contract as figurePrompt
         * — the answer is matched by figId and written to a per-target cache file
         * (`.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`), so a generated detail
         * opens instantly on the next hover without re-generating.
         * @param request - dynamic kind, hover target, role language, and for
         *   flow-subgraph the current diagram source (context.mermaid).
         * @returns the figId + prompt to send, or an error.
         */
        async remoteDynamicFigurePrompt(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                const language = request.language ?? '中文';
                const kind = request.kind === 'seq-edge' ? 'seq-edge' : request.kind === 'overview' ? 'overview' : 'flow-subgraph';
                const targetKey = dynamicTargetKey(kind, request.target);
                const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                const prompt = buildDynamicFigurePrompt(kind, index, language, figId, request.target, request.context?.mermaid, request.context?.blurbs);
                this.pendingFigure = {
                    figId,
                    kind,
                    language,
                    sessionId: this.targetSessionId,
                    stagedAt: Date.now(),
                    index,
                    dynamic: { kind, targetKey },
                };
                setTimeout(() => {
                    if (this.pendingFigure?.figId === figId)
                        this.pendingFigure = null;
                }, 30 * 60 * 1000);
                return { figId, prompt };
            }
            catch (error) {
                return { error: `dynamic figure prompt failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Read one cached dynamic figure (`.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`).
         * The panel calls this after the turn completes (and on every later hover)
         * so a generated detail opens instantly without re-generating.
         * @param request - dynamic kind, target key, role language.
         * @returns the cached diagram, or null when absent.
         */
        async remoteDynamicFigure(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const kind = request.kind === 'seq-edge' ? 'seq-edge' : 'flow-subgraph';
            const language = request.language ?? '中文';
            try {
                const target = await this.ctx.fs.resolve(dynamicFigureCacheName(kind, request.targetKey, language), { cwd: root });
                const text = await this.ctx.fs.readText(target);
                const parsed = JSON.parse(text);
                if (typeof parsed.diagram !== 'string' || parsed.diagram === '')
                    return null;
                return {
                    title: typeof parsed.title === 'string' ? parsed.title : '',
                    diagram: parsed.diagram,
                    kind,
                    targetKey: request.targetKey,
                };
            }
            catch {
                return null;
            }
        }
        /**
         * Abort every in-flight LLM generation for the current workspace (the
         *「⏹ 终止」button). The active AbortSignal fires, so provider streams stop
         * promptly; the client drops the pending responses locally.
         * @returns whether a generation was aborted.
         */
        async remoteCancelGeneration() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return { ok: false };
            return { ok: abortGeneration(root) };
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
            const language = request.language ?? '中文';
            const methods = request.methodLevel === true;
            const cached = await readStructuredCache(this.ctx.fs, root, language, 'interaction', methods);
            if (cached !== null)
                return cached;
            // Shared analysis profile fallback: the events figure reads the profile's
            // sanitized events when no structured cache exists (AI generate still
            // writes the structured cache on demand). Skipped in method-level mode
            // (the shared profile is entity-level by design).
            if (methods)
                return null;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return null;
            try {
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                const profile = await ensureAnalysisProfile(this.ctx, this.ctx.fs, root, index, language, this.sessionPolicy());
                const events = profile.events;
                if (events !== undefined && events.length > 0)
                    return events;
            }
            catch (error) {
                console.warn(`[arch-lens] events profile fallback failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            return null;
        }
        /**
         * Flow diagram via the dual chain: architecture doc flow block first
         * (verbatim mermaid, or LLM transcode of a pseudo-code block — both
         * `source: 'doc'` with an anchor), then the shared analysis profile, then
         * LLM induction from code metadata (`source: 'flow'`, non-authoritative).
         * Non-doc stages honor the requested viewpoint (angle): overview / event /
         * pipeline. Cached per language + angle.
         * @param request - role language, force flag and the flow viewpoint.
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
                const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
                return await flowDiagram(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.force === true, request.angle ?? 'event', this.sessionPolicy(), request.methodLevel === true);
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
            return summarizeDuties(this.ctx, this.ctx.fs, root, graph, request.language ?? '中文', this.sessionPolicy());
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
            return summarizeProgress(this.ctx, this.ctx.fs, root, graph, this.notesFile, request.language ?? '中文', request.force === true, this.sessionPolicy());
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
         * LLM usage accounting: totals and the newest recorded calls (see
         * llm-stats.ts for the estimation rule). The snapshot is also persisted to
         * `.arch-lens-llm-stats.json` in the workspace root so token spend is
         * inspectable outside the panel and survives restarts.
         * @returns the accounting snapshot.
         */
        async remoteLlmStats() {
            const snapshot = llmStatsSnapshot();
            const root = this.resolveRoot();
            if (typeof root === 'string') {
                try {
                    const target = await this.ctx.fs.resolve('.arch-lens-llm-stats.json', { cwd: root });
                    await this.ctx.fs.writeText(target, JSON.stringify(snapshot, null, 2), undefined, undefined, this.sessionPolicy());
                }
                catch {
                    // best-effort persistence
                }
            }
            return snapshot;
        }
        /**
         * Stage question metadata for the next assistant/message answer. Memory
         * only — the file write stays exclusively on the event path below.
         * An empty `text` CLEARS any staged metadata instead of staging: the desk
         * uses that after a failed explain send so no later ordinary
         * assistant/message gets mis-recorded as an explain (no extra wire name —
         * this stays within the official notePending contract).
         * @param request - target label, question text, and calling session id.
         * @returns acknowledgement.
         */
        async remoteNotePending(request) {
            if (request.text === '') {
                this.pending = null;
                return { ok: true };
            }
            this.pending = {
                target: request.target ?? '架构讲解',
                question: request.text ?? '',
                sessionId: request.sessionId ?? null,
            };
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
                await fs.writeText(target, JSON.stringify(merged, null, 2), undefined, undefined, this.sessionPolicy());
                return { path: PROMPT_CONFIG_FILE, config: merged };
            }
            catch (error) {
                return { error: `prompt config save failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /** Register the single note-write path: assistant/message events. */
        async [(_remoteGraph_decorators = [Remote('graph')], _remoteRefresh_decorators = [Remote('refresh')], _remoteRefreshIndex_decorators = [Remote('refreshIndex')], _remoteSetSession_decorators = [Remote('setSession')], _remoteComponent_decorators = [Remote('component')], _remoteNotes_decorators = [Remote('notes')], _remoteMermaidDeps_decorators = [Remote('mermaidDeps')], _remoteMermaidEr_decorators = [Remote('mermaidEr')], _remoteMermaidIndexed_decorators = [Remote('mermaidIndexed')], _remoteMermaidCore_decorators = [Remote('mermaidCore')], _remoteOverviewFigure_decorators = [Remote('overviewFigure')], _remoteConceptTree_decorators = [Remote('conceptTree')], _remoteGenerateDocs_decorators = [Remote('generateDocs')], _remoteGenerateDocSection_decorators = [Remote('generateDocSection')], _remoteSequence_decorators = [Remote('sequence')], _remoteRegenerateFigure_decorators = [Remote('regenerateFigure')], _remoteLastAnswer_decorators = [Remote('lastAnswer')], _remoteGenerationStatus_decorators = [Remote('generationStatus')], _remoteGenerationStatusNext_decorators = [Remote('generationStatusNext')], _remoteFigurePrompt_decorators = [Remote('figurePrompt')], _remoteDynamicFigurePrompt_decorators = [Remote('dynamicFigurePrompt')], _remoteDynamicFigure_decorators = [Remote('dynamicFigure')], _remoteCancelGeneration_decorators = [Remote('cancelGeneration')], _remoteEvents_decorators = [Remote('events')], _remoteFlow_decorators = [Remote('flow')], _remoteAnalyze_decorators = [Remote('analyze')], _remoteSummarizeDuties_decorators = [Remote('summarizeDuties')], _remoteProgress_decorators = [Remote('progress')], _remoteProgressStats_decorators = [Remote('progressStats')], _remoteLlmStats_decorators = [Remote('llmStats')], _remoteNotePending_decorators = [Remote('notePending')], _remotePromptConfig_decorators = [Remote('promptConfig')], _remotePromptConfigSave_decorators = [Remote('promptConfigSave')], Service.init)]() {
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
                // Session-driven figure generation: an answer carrying the staged
                // figId is the agent's figure output — sanitize it into the figure
                // cache (the panel refetches after the turn completes). The figId
                // (timestamp + random suffix, 5-min TTL) is the match gate, not the
                // session: the prompt may be sent to the GUI's current session even
                // when the user switches sessions between staging and sending.
                const stagedFigure = this.pendingFigure;
                if (stagedFigure !== null) {
                    const parsed = extractFigureJson(answer, stagedFigure.figId);
                    if (parsed !== null) {
                        this.pendingFigure = null;
                        const root = session.header.cwd ?? this.rootFromPolicy();
                        if (root !== undefined) {
                            // The staged figure carries the index its prompt was built from —
                            // no re-indexing here, so the cache write lands in milliseconds
                            // (before the panel's running-flip refetch can read it).
                            const write = stagedFigure.dynamic === undefined
                                ? writeFigureCache(this.ctx.fs, root, stagedFigure.index, stagedFigure.kind, parsed, stagedFigure.language, stagedFigure.angle, stagedFigure.methodLevel, resolveSessionPolicy(this.ctx, session.id))
                                : writeDynamicFigureCache(this.ctx.fs, root, stagedFigure.dynamic.kind, stagedFigure.dynamic.targetKey, parsed, stagedFigure.language, resolveSessionPolicy(this.ctx, session.id));
                            void write.then(result => {
                                console.log(`[arch-lens] session figure ${stagedFigure.figId} (${stagedFigure.kind}): ${'ok' in result ? 'cached' : result.error}`);
                            });
                        }
                    }
                }
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
                }, this.notesFile, 
                // The event session owns the workspace being written: resolve its
                // policy so the fs sandbox approves the note write (the root context
                // alone has no session scope and would fall back to the deployment
                // root, which denies writes into the learned workspace).
                resolveSessionPolicy(this.ctx, session.id)).then(result => {
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