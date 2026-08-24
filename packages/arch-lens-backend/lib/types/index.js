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
import { unlink } from 'node:fs/promises';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import s from '@deepseek-ai/schemastery';
import { appendNote, readNotes } from "./notes.js";
import { scanWorkspace } from "./scan.js";
import { summarizeDuties, readDutySummaries } from "./summarize.js";
import { progressStats, summarizeProgress } from "./progress.js";
import { analyzeWorkspace } from "./analyze.js";
import { generateFromFlow, readConceptTree, conceptTree } from "./concept.js";
import { flowDiagram, readFlow } from "./flow.js";
import { generateDocSection, generateFullDocs, readStructuredCache, writeStructuredCache } from "./docsgen.js";
import { readSequence } from "./sequence.js";
import { dependencyFlowchart, entityErDiagram, importFlowchart, packageErDiagram, coreFlowchartFromGraph, coreErDiagramFromGraph, overviewFigureFromGraph } from "./mermaid.js";
import { coreGraph, readCore } from "./core.js";
import { clearAnalysisProfileCache, regenerateProfileField } from "./analysis.js";
import { llmStatsSnapshot, hydrateLlmStats, recordLlmCall } from "./llm-stats.js";
import { checkWorkspaceChanges } from "./manifest.js";
import { selectiveInvalidate } from "./fact-cache.js";
import { computeChangedPackages } from "./change-pack.js";
import { abortGeneration, currentGenerationStatus, generationSignal, waitForGenerationStatus } from "./abort.js";
import { buildCustomFigurePrompt, buildDynamicFigurePrompt, buildFigurePrompt, dynamicFigureCacheName, dynamicTargetKey, extractCustomFigure, extractFigureJson, writeDynamicFigureCache, writeFigureCache, } from "./session-figure.js";
import { sanitizeMermaid } from "./flow-angle.js";
import { figureFollowUp } from "./followup.js";
import { sessionPolicy as resolveSessionPolicy } from "./policy.js";
import { CACHE_DIR } from "./cache-dir.js";
// Export the wire types AND the shared runtime helper (groupLabel) — the
// client bundle imports it as a value.
export * from "./types.js";
/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = 'ARCH-NOTES.md';
/** Persisted scan-graph cache under the workspace `index/` cache directory
 * (reopening after a host restart must not re-walk the filesystem; refresh()
 * invalidates it). */
const GRAPH_CACHE_FILE = `${CACHE_DIR}/.arch-lens-graph.json`;
/** Per-workspace prompt configuration file under the same cache directory. */
const PROMPT_CONFIG_FILE = `${CACHE_DIR}/.arch-lens-prompts.json`;
/**
 * The Arch Lens backend Remote service (`ctx.archLens`).
 */
let ArchLensService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _remoteGraph_decorators;
    let _remoteRefresh_decorators;
    let _remoteRefreshIndex_decorators;
    let _remoteGenerateAll_decorators;
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
    let _remoteCustomFigurePrompt_decorators;
    let _remoteCustomFigure_decorators;
    let _remoteCustomFigureList_decorators;
    let _remoteSaveCustomFigure_decorators;
    let _remoteCustomFigureDelete_decorators;
    let _remoteFigureFollowUp_decorators;
    let _remoteCancelFollowUp_decorators;
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
            __esDecorate(this, null, _remoteGenerateAll_decorators, { kind: "method", name: "remoteGenerateAll", static: false, private: false, access: { has: obj => "remoteGenerateAll" in obj, get: obj => obj.remoteGenerateAll }, metadata: _metadata }, null, _instanceExtraInitializers);
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
            __esDecorate(this, null, _remoteCustomFigurePrompt_decorators, { kind: "method", name: "remoteCustomFigurePrompt", static: false, private: false, access: { has: obj => "remoteCustomFigurePrompt" in obj, get: obj => obj.remoteCustomFigurePrompt }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteCustomFigure_decorators, { kind: "method", name: "remoteCustomFigure", static: false, private: false, access: { has: obj => "remoteCustomFigure" in obj, get: obj => obj.remoteCustomFigure }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteCustomFigureList_decorators, { kind: "method", name: "remoteCustomFigureList", static: false, private: false, access: { has: obj => "remoteCustomFigureList" in obj, get: obj => obj.remoteCustomFigureList }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteSaveCustomFigure_decorators, { kind: "method", name: "remoteSaveCustomFigure", static: false, private: false, access: { has: obj => "remoteSaveCustomFigure" in obj, get: obj => obj.remoteSaveCustomFigure }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteCustomFigureDelete_decorators, { kind: "method", name: "remoteCustomFigureDelete", static: false, private: false, access: { has: obj => "remoteCustomFigureDelete" in obj, get: obj => obj.remoteCustomFigureDelete }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteFigureFollowUp_decorators, { kind: "method", name: "remoteFigureFollowUp", static: false, private: false, access: { has: obj => "remoteFigureFollowUp" in obj, get: obj => obj.remoteFigureFollowUp }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteCancelFollowUp_decorators, { kind: "method", name: "remoteCancelFollowUp", static: false, private: false, access: { has: obj => "remoteCancelFollowUp" in obj, get: obj => obj.remoteCancelFollowUp }, metadata: _metadata }, null, _instanceExtraInitializers);
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
        /** One in-flight read (root + promise) so concurrent callers share one
         * cache read per root; a read of another root can run alongside. */
        graphInFlight = null;
        pending = null;
        /** One staged session-driven figure request (🤖 AI 生成 via 会话回合):
         * matched by figId in the agent's answer, written to the figure cache. */
        pendingFigure = null;
        /** One staged CUSTOM figure request (🎨 动态出图): matched by figId in the
         * agent's answer, captured into customFigures[figureId]. `figureId` is the
         * stable scene id (`dynamic-N`, per-workspace counter) the panel locks on
         * save; a follow-up re-uses it, a new scene allocates a fresh one. */
        pendingCustomFigure = null;
        /** All custom figures known this session, keyed by scene id: generated by
         * the panel OR restored from disk. `saved` reflects whether the CURRENT
         * content is persisted (a follow-up re-render flips it back to false). */
        customFigures = new Map();
        /** In-flight code-index load per root: CONCURRENT figure RPCs share ONE
         * indexWorkspace call instead of each re-loading/re-parsing the workspace
         * (the disk cache already avoids re-scanning source; this dedups the load). */
        indexInFlight = null;
        /** Shared workspace index load: concurrent calls for the SAME root await the
         * same in-flight promise (dedup); sequential calls behave exactly like a
         * plain indexWorkspace. @throws when the codeIndex service is unavailable. */
        async indexWorkspaceShared(root) {
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                throw new Error('codeIndex service unavailable');
            const inFlight = this.indexInFlight;
            if (inFlight !== null && inFlight.root === root)
                return inFlight.promise;
            const promise = codeIndex.indexWorkspace(root, this.sessionPolicy()).finally(() => {
                if (this.indexInFlight?.root === root)
                    this.indexInFlight = null;
            });
            this.indexInFlight = { root, promise };
            return promise;
        }
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
        /** Snapshot the session's cumulative token usage (the tokenUsage projection
         * from token-meter), or undefined when the session or projection is
         * unavailable. The delta between two snapshots around one staged request
         * attributes that request's provider-reported spend to the arch-lens
         * action (AI 生成 / 动态出图 / 讲解 run inside the session's agent turn). */
        sessionUsageSnapshot(sessionId) {
            if (sessionId === null || sessionId === undefined)
                return undefined;
            const session = this.ctx.get('sessions')?.get(sessionId);
            if (session === undefined)
                return undefined;
            const projections = this.ctx.get('sessionProjections');
            return projections?.snapshot(session).values.tokenUsage;
        }
        /** Attribute one staged session-driven request's token spend (delta between
         * the staged and the current session tokenUsage) to the LLM ledger. */
        recordSessionUsage(kind, label, stagedAt, usageStart, sessionId) {
            const end = this.sessionUsageSnapshot(sessionId);
            if (usageStart === undefined || end === undefined)
                return;
            const delta = {
                uncachedInputTokens: Math.max(0, end.uncachedInputTokens - usageStart.uncachedInputTokens),
                outputTokens: Math.max(0, end.outputTokens - usageStart.outputTokens),
                cacheReadTokens: Math.max(0, end.cacheReadTokens - usageStart.cacheReadTokens),
                cacheWriteTokens: Math.max(0, end.cacheWriteTokens - usageStart.cacheWriteTokens),
            };
            if (delta.uncachedInputTokens === 0 && delta.outputTokens === 0
                && delta.cacheReadTokens === 0 && delta.cacheWriteTokens === 0)
                return;
            const usage = {
                inTokens: delta.uncachedInputTokens + delta.cacheReadTokens + delta.cacheWriteTokens,
                outTokens: delta.outputTokens,
            };
            if (delta.cacheReadTokens > 0)
                usage.cacheReadTokens = delta.cacheReadTokens;
            if (delta.cacheWriteTokens > 0)
                usage.cacheWriteTokens = delta.cacheWriteTokens;
            recordLlmCall(kind, '', '', Math.max(0, Date.now() - stagedAt), usage, label);
        }
        /** In-flight follow-up redraw AbortControllers per workspace root: the
         * panel's「取消」button (while a redraw is running) aborts the matching
         * controller so the LLM stream stops and the cache is never overwritten. */
        followUpAbort = new Map();
        /** In-flight full-docs generation per workspace root: repeated「📄 一键生成
         * 文档」clicks (or parallel RPCs) while one is running reuse the SAME
         * promise — the LLM work runs exactly once per root, later calls share its
         * result instead of re-generating. */
        docInFlight = null;
        /** Scan (with cache) the workspace package tree; concurrent callers share
         * one scan per root. Cache-first: a previously scanned workspace (any
         * session of it) resolves instantly; only a new root triggers a scan.
         * The scan graph is ALSO persisted to `index/.arch-lens-graph.json` under the
         * workspace root, so reopening the desk after a host restart serves the
         * cached graph instead of re-walking the filesystem. refresh() marks the
         * disk copy invalid before it rescans (the FileSystem has no delete).
         * READ-ONLY: never scans. Facts (scan graph + code index) are built ONLY
         * by rescan (refresh) — opening the panel / switching tabs never walks the
         * filesystem. No disk cache ⇒ returns null.
         */
        graph() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return Promise.resolve(root);
            const cached = this.graphCaches.get(root);
            if (cached !== undefined)
                return Promise.resolve(cached);
            if (this.graphInFlight !== null && this.graphInFlight.root === root)
                return this.graphInFlight.promise;
            const promise = this.graphFromDisk(root).then(fromDisk => {
                if (fromDisk !== null) {
                    console.log(`[arch-lens] graph: served from disk cache (root=${root})`);
                    this.graphCaches.set(root, fromDisk);
                    return fromDisk;
                }
                console.log(`[arch-lens] graph: no disk cache (root=${root}) — null; facts are built by rescan`);
                return null;
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
        /** Persist a fresh scan graph (non-fatal on failure) and return the new
         * facts version (generatedAt) written, or 0 when the write failed. */
        async writeGraphDisk(root, graph) {
            const generatedAt = Date.now();
            try {
                const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
                await this.ctx.fs.writeText(target, JSON.stringify({ root, generatedAt, graph }), undefined, undefined, this.sessionPolicy());
                return generatedAt;
            }
            catch {
                return 0;
            }
        }
        /** Graph read for internal consumers: null (no facts built yet) collapses
         * to an error so callers never touch undefined nodes/edges. */
        async requireGraph() {
            const graph = await this.graph();
            if (graph === null)
                return { error: 'no facts yet: run 重新扫描 (refresh) first' };
            return graph;
        }
        /**
         * The scanned workspace graph (read-only cache; null when no rescan has
         * built facts yet). Facts are established by refresh() (重新扫描).
         * @returns graph, null when no disk cache, or an error.
         */
        async remoteGraph() {
            return this.graph();
        }
        /**
         * Rescan = REBUILD EVERY fact source (the ONLY place facts are built):
         * invalidate the scan graph, re-index the code-index, invalidate the AI
         * caches, then scan the workspace and persist a fresh graph (new
         * generatedAt = new facts version). Opening the panel / switching tabs
         * NEVER scans — they read caches only.
         * Layer-1 change detection: when the file manifest shows NO file changed
         * since the last rescan, every cache is still valid and the rebuild is
         * skipped entirely — the existing graph is returned as-is.
         * @returns the fresh scan graph (or null when none exists yet) plus
         *   whether a rebuild actually ran.
         */
        async remoteRefresh() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const fileChanges = await checkWorkspaceChanges(this.ctx.fs, root, this.sessionPolicy());
            if (!fileChanges.changed) {
                // No fact source moved: caches (scan graph, code-index, AI figures) are
                // all still valid — serve the existing graph, skip the rebuild.
                const graph = await this.graph();
                if (graph === null)
                    return { graph: null, changed: false, changes: null };
                if ('error' in graph)
                    return graph;
                return { graph, changed: false, changes: null };
            }
            // Snapshot the OLD package ids BEFORE clearing the in-memory graph (used
            // to compute added/removed packages against the fresh scan).
            const oldGraph = await this.graph();
            const oldIds = oldGraph !== null && !('error' in oldGraph) ? oldGraph.nodes.map(node => node.id) : [];
            this.graphCaches.clear();
            this.graphInFlight = null;
            // Mark the persisted scan graph invalid: the rescan below overwrites it,
            // and a failed rescan must not resurrect stale data on the next open.
            try {
                const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
                await this.ctx.fs.writeText(target, JSON.stringify({ root, invalidated: true, generatedAt: Date.now() }), undefined, undefined, this.sessionPolicy());
            }
            catch {
                // non-fatal
            }
            await this.refreshCodeIndex();
            await this.removeAICaches();
            // Explicitly build facts: scan the workspace, persist the fresh graph
            // (new facts version) and serve it.
            const scanned = await scanWorkspace(this.ctx.fs, root);
            if ('error' in scanned)
                return scanned;
            const changes = computeChangedPackages(fileChanges, oldIds, scanned.nodes.map(node => node.id));
            const newVersion = await this.writeGraphDisk(root, scanned);
            // Selective invalidation: only figures whose deps intersect the changed
            // packages are invalidated; unaffected figures get their version
            // re-stamped to the new facts version and keep serving. newVersion===0
            // (write failure) makes every re-stamped cache unmatchable — safe.
            await selectiveInvalidate(this.ctx.fs, root, new Set(changes.changedPackages), newVersion, this.sessionPolicy());
            this.graphCaches.set(root, scanned);
            return { graph: scanned, changed: true, changes };
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
         * 「全量重建」: regenerate EVERY AI figure from the CURRENT facts, each with
         * its own force=true pass (concept tree, both flow angles, sequence,
         * interaction, core selection, duty summaries). Slow by design (multiple
         * sequential LLM calls) — this is an explicit user action, never automatic.
         * @param request - role language.
         * @returns acknowledgement, or the first generation error (all steps run).
         */
        async remoteGenerateAll(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const graph = await this.requireGraph();
            if ('error' in graph)
                return graph;
            const language = request.language ?? '中文';
            let index;
            try {
                index = await this.indexWorkspaceShared(root);
            }
            catch (error) {
                return { error: `codeIndex unavailable: ${error instanceof Error ? error.message : String(error)}` };
            }
            const policy = this.sessionPolicy();
            const errors = [];
            const step = async (label, run) => {
                try {
                    const result = await run();
                    if (typeof result === 'object' && result !== null && 'error' in result) {
                        errors.push(`${label}: ${result.error}`);
                    }
                }
                catch (error) {
                    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
                }
            };
            await step('concepts', () => conceptTree(this.ctx, this.ctx.fs, root, index, language, true, policy));
            await step('flow-event', () => flowDiagram(this.ctx, this.ctx.fs, root, index, language, true, 'event', policy));
            await step('flow-pipeline', () => flowDiagram(this.ctx, this.ctx.fs, root, index, language, true, 'pipeline', policy));
            await step('seq', () => writeStructuredCache(this.ctx, this.ctx.fs, root, index, language, 'seq', policy));
            await step('interaction', () => writeStructuredCache(this.ctx, this.ctx.fs, root, index, language, 'interaction', policy));
            await step('core', () => coreGraph(this.ctx, this.ctx.fs, root, index, language, true, policy));
            await step('duties', () => summarizeDuties(this.ctx, this.ctx.fs, root, graph, language, policy));
            if (errors.length > 0)
                return { error: `generateAll: ${errors.join('; ')}` };
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
        /**
         * Invalidate AI figure caches (concept tree / sequence / events / flow /
         * core / analysis). Since the versioned-cache change the DISK copies are
         * NOT touched: a rescan rebuilds the scan graph with a fresh generatedAt
         * (facts version), and every figure cache records the version it was
         * generated against — readers refuse a mismatched version and regenerate.
         * Physical clearing was the cause of "reopening the panel is slow": it
         * threw away caches that were still valid across page reloads.
         */
        async removeAICaches() {
            // The shared analysis profile's single-flight memory must not serve an
            // old profile after a rescan (the disk copy stays; its version check
            // refuses it — the memory cache would bypass that check).
            clearAnalysisProfileCache();
        }
        /**
         * Detail projection for one package. The graph carries precomputed details,
         * so this is a plain lookup (kept as a Remote for compatibility).
         * @param request - package id.
         * @returns detail or error.
         */
        async remoteComponent(request) {
            const graph = await this.requireGraph();
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
            const graph = await this.requireGraph();
            if ('error' in graph)
                return graph;
            return { kind: 'flowchart', source: dependencyFlowchart(graph) };
        }
        /**
         * Mermaid ER diagram of package relationships for the scanned graph.
         * @returns erDiagram source or an error.
         */
        async remoteMermaidEr() {
            const graph = await this.requireGraph();
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
                const index = await this.indexWorkspaceShared(root);
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
         * Core-flow diagram (deps/ER overview) — READ ONLY: built from the cached
         * core selection + the scanned graph; null when no core cache exists.
         * Generation (LLM selection) is WRITE-path only (「🤖 AI 生成」 /
         * regenerateFigure). Never walks the code index.
         * @param request - diagram kind, role language.
         * @returns mermaid source and core selection, null, or an error.
         */
        async remoteMermaidCore(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            try {
                const core = await readCore(this.ctx.fs, root, request.language ?? '中文', request.methodLevel === true);
                if (core === null)
                    return null;
                const graph = await this.requireGraph();
                if ('error' in graph)
                    return graph;
                const source = request.kind === 'flowchart'
                    ? coreFlowchartFromGraph(graph, core.ids)
                    : coreErDiagramFromGraph(graph, core.ids);
                return { kind: request.kind, source, core };
            }
            catch (error) {
                return { error: `core diagram failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * 架构概览 (rule-built) — READ ONLY (D2): built from the cached core
         * selection + the scanned graph; null when no core cache exists. There is
         * NO rule fallback on read — facts appear only after a rescan plus the
         * user's generate action (「🤖 AI 生成」 / regenerateFigure writes the core
         * cache). Never walks the code index.
         * @param request - role language.
         * @returns the overview mermaid + core selection, null, or an error.
         */
        async remoteOverviewFigure(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            try {
                const language = request.language ?? '中文';
                const core = await readCore(this.ctx.fs, root, language, false);
                if (core === null)
                    return null;
                const graph = await this.requireGraph();
                if ('error' in graph)
                    return graph;
                const blurbOf = (id) => {
                    const node = graph.nodes.find(candidate => candidate.id === id);
                    if (node === undefined)
                        return '';
                    return language === 'English' ? node.blurb : (node.blurbZh ?? node.blurb);
                };
                return { title: '架构概览', mermaid: overviewFigureFromGraph(graph, core.ids, blurbOf), core };
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
         * Concept hierarchy — READ ONLY: serve the versioned cache; null when
         * absent/stale. Generation (doc extraction / LLM induction / cache write)
         * happens ONLY through the write paths (「🤖 AI 生成」 figurePrompt /
         * regenerateFigure). Opening the panel or switching tabs never generates.
         * @param request - role language and method-level cache variant.
         * @returns concept-tree nodes, null when no matching cache, or an error.
         */
        async remoteConceptTree(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            try {
                return await readConceptTree(this.ctx.fs, root, request.language ?? '中文', request.methodLevel === true);
            }
            catch (error) {
                return { error: `concept tree read failed: ${error instanceof Error ? error.message : String(error)}` };
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
            // 后端锁：同一工作区的一次完整文档生成进行中时，后续调用共享同一个
            // promise（LLM 只执行一次），而不是各自重新跑 6 节串行生成。
            const inFlight = this.docInFlight;
            if (inFlight !== null && inFlight.root === root)
                return inFlight.promise;
            const promise = (async () => {
                try {
                    const codeIndex = this.codeIndexService();
                    if (codeIndex === undefined)
                        return { error: 'codeIndex service unavailable' };
                    const index = await this.indexWorkspaceShared(root);
                    const result = await generateFullDocs(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', this.sessionPolicy());
                    if ('error' in result)
                        return result;
                    // 写路径：一键文档后同步重建概念树缓存（doc 提取 → profile → flow），
                    // 让读路径的 conceptTree 立即返回新树（不依赖前端再点 AI 生成）。
                    try {
                        await conceptTree(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', true, this.sessionPolicy(), false);
                    }
                    catch (error) {
                        console.warn(`[arch-lens] concept cache rebuild after docs failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    return result;
                }
                catch (error) {
                    return { error: `generate docs failed: ${error instanceof Error ? error.message : String(error)}` };
                }
            })().finally(() => {
                if (this.docInFlight?.root === root)
                    this.docInFlight = null;
            });
            this.docInFlight = { root, promise };
            return promise;
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
                const index = await this.indexWorkspaceShared(root);
                return await generateDocSection(this.ctx, this.ctx.fs, root, index, request.language ?? '中文', request.kind, this.sessionPolicy());
            }
            catch (error) {
                return { error: `generate doc section failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Structured figure data for the sequence tab — READ ONLY: serve the
         * versioned cache; null when absent/stale. The static call-graph, doc
         * extraction and LLM induction stages are WRITE-path only (「🤖 AI 生成」 /
         * regenerateFigure). Opening the panel or switching tabs never generates.
         * The client renders an empty state on null.
         * @param request - role language and method-level cache variant.
         * @returns the cached figure, null, or an error.
         */
        async remoteSequence(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            try {
                return await readSequence(this.ctx.fs, root, request.language ?? '中文', request.methodLevel === true);
            }
            catch (error) {
                return { error: `sequence read failed: ${error instanceof Error ? error.message : String(error)}` };
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
                const index = await this.indexWorkspaceShared(root);
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
                // 同步落各图版本化缓存：profile 已更新，但读侧 remote（readConceptTree /
                // readFlow / readSequence / events / readCore）只认各图独立缓存文件——
                // 不写的话重开/重拉会 miss（画不出来）。writeFigureCache 已版本化。
                const writeFigure = async (figureKind, parsed, angle) => {
                    try {
                        await writeFigureCache(this.ctx.fs, root, index, figureKind, parsed, language, angle, methods, this.sessionPolicy());
                    }
                    catch (error) {
                        console.warn(`[arch-lens] regenerate cache write failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                };
                switch (request.kind) {
                    case 'concepts': {
                        const tree = profile.conceptTree;
                        if (tree === undefined || tree.length === 0)
                            return { error: 'concept regeneration produced no tree' };
                        void writeFigure('concepts', { conceptTree: tree });
                        return { kind: 'concepts', tree };
                    }
                    case 'seq': {
                        const messages = profile.seqMessages;
                        if (messages === undefined || messages.length === 0)
                            return { error: 'seq regeneration produced no messages' };
                        void writeFigure('seq', { seqMessages: messages });
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
                            void writeFigure('flow', { title: flow.title, mermaid: flow.mermaid }, angle);
                        }
                        return { kind: 'flow', flows };
                    }
                    case 'interaction': {
                        const events = profile.events;
                        if (events === undefined || events.length === 0)
                            return { error: 'events regeneration produced no events' };
                        void writeFigure('interaction', { events });
                        return { kind: 'interaction', events };
                    }
                    default: {
                        if (profile.coreIds.length < 4)
                            return { error: 'core regeneration produced too few packages' };
                        void writeFigure('core', { core: profile.coreIds });
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
                const index = await this.indexWorkspaceShared(root);
                const language = request.language ?? '中文';
                const kind = request.kind === 'deps' || request.kind === 'er'
                    ? 'core'
                    : request.kind === 'interaction' ? 'interaction'
                        : request.kind;
                const angle = request.kind === 'flow' ? request.angle ?? 'event' : undefined;
                const methodLevel = request.methodLevel === true;
                const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                const prompt = buildFigurePrompt(kind, index, language, figId, angle, methodLevel);
                const usageStart = this.sessionUsageSnapshot(this.targetSessionId);
                this.pendingFigure = {
                    figId,
                    kind,
                    language,
                    ...(angle !== undefined ? { angle } : {}),
                    methodLevel,
                    sessionId: this.targetSessionId,
                    stagedAt: Date.now(),
                    ...(usageStart !== undefined ? { usageStart } : {}),
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
         * (`index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`), so a generated detail
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
                const index = await this.indexWorkspaceShared(root);
                const language = request.language ?? '中文';
                const kind = request.kind === 'seq-edge' ? 'seq-edge' : request.kind === 'overview' ? 'overview' : 'flow-subgraph';
                const targetKey = dynamicTargetKey(kind, request.target);
                const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                // 同族下钻增量复用: a re-drill on the SAME target reuses the cached
                // figure as prompt context so the LLM extends/redraws details instead of
                // starting from scratch (a forced regenerate keeps the family coherent).
                const existing = await this.readDynamicFigureFromDisk(root, kind, targetKey, language);
                const prompt = buildDynamicFigurePrompt(kind, index, language, figId, request.target, request.context?.mermaid, request.context?.blurbs, existing ?? undefined);
                const usageStart = this.sessionUsageSnapshot(this.targetSessionId);
                this.pendingFigure = {
                    figId,
                    kind,
                    language,
                    sessionId: this.targetSessionId,
                    stagedAt: Date.now(),
                    ...(usageStart !== undefined ? { usageStart } : {}),
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
        /** Read one cached dynamic figure (`index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`),
         * or null when absent/unreadable. Shared by the read RPC and the re-drill
         * prompt builder (same-family incremental reuse). */
        async readDynamicFigureFromDisk(root, kind, targetKey, language) {
            try {
                const target = await this.ctx.fs.resolve(dynamicFigureCacheName(kind, targetKey, language), { cwd: root });
                const text = await this.ctx.fs.readText(target);
                const parsed = JSON.parse(text);
                if (typeof parsed.diagram !== 'string' || parsed.diagram === '')
                    return null;
                return {
                    title: typeof parsed.title === 'string' ? parsed.title : '',
                    diagram: parsed.diagram,
                    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
                };
            }
            catch {
                return null;
            }
        }
        /**
         * Read one cached dynamic figure (`index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`).
         * The panel calls this after the turn completes (and on every later hover)
         * so a generated detail opens instantly without re-generating.
         * @param request - dynamic kind, target key, role language.
         * @returns the cached diagram, or null when absent.
         */
        async remoteDynamicFigure(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const kind = request.kind === 'seq-edge' ? 'seq-edge' : request.kind === 'overview' ? 'overview' : 'flow-subgraph';
            const language = request.language ?? '中文';
            const cached = await this.readDynamicFigureFromDisk(root, kind, request.targetKey, language);
            if (cached === null)
                return null;
            return {
                title: cached.title,
                diagram: cached.diagram,
                kind,
                targetKey: request.targetKey,
            };
        }
        /**
         * Build the session message for the CUSTOM figure branch (「🎨 动态出图」): the
         * user types ANY request ("存图的逻辑，怎么存的、存哪、怎么读的…") and the agent
         * draws a matching diagram PLUS a short summary. Same session-turn contract
         * as dynamicFigurePrompt — the answer is matched by figId, captured into
         * `customFigures[figureId]`, and NOT persisted automatically: the panel's
         * 保存 button locks the scene id to disk explicitly.
         * SCENE ID: when `figureId` is given (a follow-up on an existing scene) it is
         * reused and the existing figure is embedded as context; otherwise a new
         * per-workspace id `dynamic-N` is allocated for a brand-new scene.
         * @param request - the user's figure request text, optional target figureId
         *   (follow-up), role language, and graph blurbs for the prompt facts.
         * @returns the figId + scene figureId + prompt to send, or an error.
         */
        async remoteCustomFigurePrompt(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            const text = (request.text ?? '').trim();
            if (text === '')
                return { error: 'empty draw request' };
            try {
                const index = await this.indexWorkspaceShared(root);
                const language = request.language ?? '中文';
                let figureId = request.figureId;
                const existing = figureId !== undefined
                    ? this.customFigures.get(figureId) ?? await this.readDrawFromDisk(root, figureId)
                    : null;
                if (figureId === undefined)
                    figureId = await this.allocateFigureId(root);
                const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
                const prompt = buildCustomFigurePrompt(index, text, language, figId, request.context?.blurbs ?? {}, existing === null ? undefined : {
                    title: existing.title,
                    diagram: existing.diagram,
                    summary: existing.summary,
                });
                const usageStart = this.sessionUsageSnapshot(this.targetSessionId);
                this.pendingCustomFigure = {
                    figId, figureId, text, language, stagedAt: Date.now(),
                    ...(usageStart !== undefined ? { usageStart } : {}),
                };
                // One-shot staging: clear after 30 minutes even if the agent never
                // answers (same defensive TTL as the figure/dynamic branches).
                setTimeout(() => {
                    if (this.pendingCustomFigure?.figId === figId)
                        this.pendingCustomFigure = null;
                }, 30 * 60 * 1000);
                return { figId, figureId, prompt };
            }
            catch (error) {
                return { error: `custom figure prompt failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Read ONE custom figure scene: in-memory first (this session's generated or
         * restored content), then the saved disk file (marked `saved: true`). The
         * panel calls this after a turn completes (to render the freshly drawn
         * figure) and when the user selects a scene in the list.
         * FALLBACK (no figureId): return the newest in-memory figure, else the
         * newest saved one, so a plain panel reopen restores something useful.
         * @returns the custom figure (figureId, title, diagram, summary, text),
         *   null when nothing matches, or an error.
         */
        async remoteCustomFigure(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            if (request.figureId !== undefined && request.figureId !== '') {
                const mem = this.customFigures.get(request.figureId);
                if (mem !== undefined)
                    return { figureId: mem.figureId, title: mem.title, diagram: mem.diagram, summary: mem.summary, text: mem.text, saved: mem.saved };
                const disk = await this.readDrawFromDisk(root, request.figureId);
                if (disk !== null)
                    return { ...disk, saved: true };
                return null;
            }
            let newestMem = null;
            for (const entry of this.customFigures.values()) {
                if (newestMem === null || entry.at > newestMem.at)
                    newestMem = { figureId: entry.figureId, title: entry.title, diagram: entry.diagram, summary: entry.summary, text: entry.text, at: entry.at };
            }
            if (newestMem !== null)
                return { figureId: newestMem.figureId, title: newestMem.title, diagram: newestMem.diagram, summary: newestMem.summary, text: newestMem.text };
            const saved = await this.readNewestDraw(root);
            if (saved !== null)
                return { ...saved, saved: true };
            return null;
        }
        /** Parse one `.arch-lens-draw-*.json` file into its figure record. figureId
         * comes from the file's `figureId` field when present, else the file name
         * (`dynamic-N` for scene saves, the hash part for legacy text-hash saves).
         * Returns null for unreadable, diagram-less, or tombstoned (deleted) files. */
        drawFileRecord(name, parsed) {
            if (parsed.deleted === true)
                return null;
            if (typeof parsed.diagram !== 'string' || parsed.diagram === '')
                return null;
            const match = /^\.arch-lens-draw-dynamic-(\d+)-/.exec(name);
            const figureId = typeof parsed.figureId === 'string' && parsed.figureId !== ''
                ? parsed.figureId
                : match !== null
                    ? `dynamic-${match[1]}`
                    : name.replace(/^\.arch-lens-draw-/, '').replace(/-[A-Za-z0-9_-]*\.json$/, '');
            return {
                figureId,
                title: typeof parsed.title === 'string' ? parsed.title : '',
                diagram: parsed.diagram,
                summary: typeof parsed.summary === 'string' ? parsed.summary : '',
                text: typeof parsed.text === 'string' ? parsed.text : '',
                savedAt: typeof parsed.savedAt === 'string' ? Date.parse(parsed.savedAt) : 0,
            };
        }
        /** Scan `index/` then the workspace root (legacy saves) for every saved
         * custom figure file. Tombstoned (deleted) files are filtered out. */
        async readSavedDraws(root) {
            const fs = this.ctx.fs;
            const out = [];
            for (const dir of [CACHE_DIR, '.']) {
                try {
                    const dirTarget = await fs.resolve(dir === '.' ? '.' : dir, { cwd: root });
                    const entries = await fs.listDir(dirTarget);
                    for (const entry of entries) {
                        if (entry.type !== 'file' || !entry.name.startsWith('.arch-lens-draw-') || !entry.name.endsWith('.json'))
                            continue;
                        try {
                            const parsed = JSON.parse(await fs.readText(entry.target));
                            const record = this.drawFileRecord(entry.name, parsed);
                            if (record !== null)
                                out.push(record);
                        }
                        catch {
                            // corrupt/unreadable file — skip
                        }
                    }
                }
                catch {
                    // dir missing — skip
                }
            }
            return out;
        }
        /** Read ONE saved custom figure by figureId, or null. */
        async readDrawFromDisk(root, figureId) {
            const records = await this.readSavedDraws(root);
            const found = records.find(record => record.figureId === figureId);
            return found === undefined ? null : { figureId: found.figureId, title: found.title, diagram: found.diagram, summary: found.summary, text: found.text };
        }
        /** Newest saved custom figure across disk (memory lost on restart), or null. */
        async readNewestDraw(root) {
            const records = await this.readSavedDraws(root);
            let newest = null;
            for (const record of records) {
                if (newest === null || record.savedAt > newest.savedAt)
                    newest = record;
            }
            return newest === null ? null : { figureId: newest.figureId, title: newest.title, diagram: newest.diagram, summary: newest.summary, text: newest.text };
        }
        /** Next free per-workspace scene id: `dynamic-<maxExisting+1>`. Scans raw
         * file names (INCLUDING tombstoned ones) plus memory, so deleted numbers
         * never get reused. */
        async allocateFigureId(root) {
            const fs = this.ctx.fs;
            let max = 0;
            for (const dir of [CACHE_DIR, '.']) {
                try {
                    const dirTarget = await fs.resolve(dir === '.' ? '.' : dir, { cwd: root });
                    const entries = await fs.listDir(dirTarget);
                    for (const entry of entries) {
                        if (entry.type !== 'file')
                            continue;
                        const match = /^\.arch-lens-draw-dynamic-(\d+)-/.exec(entry.name);
                        if (match !== null)
                            max = Math.max(max, Number(match[1]));
                    }
                }
                catch {
                    // dir missing — skip
                }
            }
            for (const key of this.customFigures.keys()) {
                const match = /^dynamic-(\d+)$/.exec(key);
                if (match !== null)
                    max = Math.max(max, Number(match[1]));
            }
            return `dynamic-${max + 1}`;
        }
        /** Cache file name for a scene figure: `index/.arch-lens-draw-<figureId>[-<lang>].json`. */
        drawFileName(figureId, language) {
            const safe = language.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
            return `${CACHE_DIR}/.arch-lens-draw-${figureId}-${safe === '' ? 'default' : safe}.json`;
        }
        /**
         * List every custom figure scene: saved ones from disk (saved: true) merged
         * with this session's memory figures (unsaved ones show saved: false so the
         * panel can offer 保存). Ordered dynamic-N ascending, then legacy hashes.
         * @returns the scene list (figureId, title, text, saved), or an error.
         */
        async remoteCustomFigureList() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            try {
                const byId = new Map();
                for (const record of await this.readSavedDraws(root)) {
                    const entry = {
                        figureId: record.figureId,
                        title: record.title,
                        text: record.text,
                        saved: true,
                    };
                    if (record.savedAt > 0)
                        entry.savedAt = new Date(record.savedAt).toISOString();
                    byId.set(record.figureId, entry);
                }
                for (const entry of this.customFigures.values()) {
                    byId.set(entry.figureId, { figureId: entry.figureId, title: entry.title, text: entry.text, saved: entry.saved });
                }
                return [...byId.values()].sort((a, b) => {
                    const na = /^dynamic-(\d+)$/.exec(a.figureId);
                    const nb = /^dynamic-(\d+)$/.exec(b.figureId);
                    if (na !== null && nb !== null)
                        return Number(na[1]) - Number(nb[1]);
                    if (na !== null)
                        return -1;
                    if (nb !== null)
                        return 1;
                    return a.figureId.localeCompare(b.figureId);
                });
            }
            catch (error) {
                return { error: `list custom figures failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Persist a scene figure — 图 AND 概要 — to
         * `index/.arch-lens-draw-<figureId>[-<lang>].json`, LOCKING the scene id
         * (replacing the old text-hash naming). The only way a custom figure lands
         * on disk; a follow-up re-render marks it unsaved again until 保存 re-locks.
         * @param request - target figureId + role language (cache-name suffix).
         * @returns `{ ok: true, path }` or an error.
         */
        async remoteSaveCustomFigure(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const result = this.customFigures.get(request.figureId);
            if (result === undefined)
                return { error: 'figure not found: generate the scene first' };
            const language = request.language ?? '中文';
            try {
                const name = this.drawFileName(request.figureId, language);
                const target = await this.ctx.fs.resolve(name, { cwd: root });
                await this.ctx.fs.writeText(target, JSON.stringify({
                    figureId: result.figureId,
                    title: result.title,
                    diagram: result.diagram,
                    summary: result.summary,
                    text: result.text,
                    savedAt: new Date().toISOString(),
                }, null, 2), undefined, undefined, this.sessionPolicy());
                result.saved = true;
                return { ok: true, path: target.displayPath };
            }
            catch (error) {
                return { error: `save custom figure failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Delete a scene figure for REAL: every disk file (all language variants in
         * `index/` and the legacy root location) is physically removed via
         * node:fs/promises unlink — the fs service has no remove, so the resolved
         * target's process path is unlinked directly. Memory entry dropped. (Files
         * tombstoned by an older build are still filtered on read.)
         * @returns `{ ok: true }` or an error.
         */
        async remoteCustomFigureDelete(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            if (request.figureId === '')
                return { error: 'empty figureId' };
            try {
                const fs = this.ctx.fs;
                for (const dir of [CACHE_DIR, '.']) {
                    try {
                        const dirTarget = await fs.resolve(dir === '.' ? '.' : dir, { cwd: root });
                        const entries = await fs.listDir(dirTarget);
                        for (const entry of entries) {
                            if (entry.type !== 'file' || !entry.name.startsWith(`.arch-lens-draw-${request.figureId}-`) || !entry.name.endsWith('.json'))
                                continue;
                            try {
                                await unlink(fs.processPath(entry.target));
                            }
                            catch {
                                // already gone (concurrent delete / raced rename) — fine
                            }
                        }
                    }
                    catch {
                        // dir missing — skip
                    }
                }
                this.customFigures.delete(request.figureId);
                return { ok: true };
            }
            catch (error) {
                return { error: `delete custom figure failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * 原地追问重画：对某个 tab 的主图（flow/seq/concepts/events/core/overview）
         * 做一次带追问上下文的重新生成，结果覆写同一缓存并返回新图数据；客户端
         * 直接回填该 tab 状态，图就原地更新（不画到「动态出图」）。
         * @param request - 图类型、语言、流程视角（flow）、方法级开关、追问文本。
         * @returns 与对应 tab 正常 RPC 相同形状的新图数据，或错误。
         */
        async remoteFigureFollowUp(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            if (request.followUp.trim() === '')
                return { error: 'empty follow-up text' };
            const codeIndex = this.codeIndexService();
            if (codeIndex === undefined)
                return { error: 'codeIndex service unavailable' };
            try {
                const index = await this.indexWorkspaceShared(root);
                const controller = new AbortController();
                this.followUpAbort.set(root, controller);
                try {
                    return await figureFollowUp(this.ctx, this.ctx.fs, root, index, { ...request, language: request.language ?? '中文' }, this.sessionPolicy(), controller.signal);
                }
                finally {
                    if (this.followUpAbort.get(root) === controller)
                        this.followUpAbort.delete(root);
                }
            }
            catch (error) {
                return { error: `figure follow-up failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Cancel the in-flight follow-up redraw of the current workspace (the
         * panel's「取消」button while a redraw is running): aborting the stream
         * stops the LLM call and the cache is never overwritten — the old figure
         * stays in place.
         * @returns whether a follow-up generation was aborted.
         */
        async remoteCancelFollowUp() {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return { ok: false };
            const controller = this.followUpAbort.get(root);
            if (controller === undefined)
                return { ok: false };
            controller.abort();
            this.followUpAbort.delete(root);
            return { ok: true };
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
         * Structured figure data for the interaction tab — READ ONLY: serve the
         * versioned structured cache; null when absent/stale. The shared-profile
         * fallback and LLM induction are WRITE-path only (「🤖 AI 生成」 /
         * regenerateFigure). Opening the panel or switching tabs never generates.
         * @param request - role language and method-level cache variant.
         * @returns event array, null, or an error.
         */
        async remoteEvents(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            try {
                const cached = await readStructuredCache(this.ctx.fs, root, request.language ?? '中文', 'interaction', request.methodLevel === true);
                if (cached !== null)
                    console.log(`[arch-lens] events: served from cache (read-only, methodLevel=${request.methodLevel === true})`);
                return cached;
            }
            catch (error) {
                return { error: `events read failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Flow diagram — READ ONLY: serve the versioned cache; null when
         * absent/stale. Doc extraction, pseudo transcode, profile and LLM
         * induction are WRITE-path only (「🤖 AI 生成」 / regenerateFigure).
         * Opening the panel or switching tabs never generates.
         * @param request - role language, viewpoint, and method-level variant.
         * @returns the cached diagram, null, or an error.
         */
        async remoteFlow(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            try {
                return await readFlow(this.ctx.fs, root, request.language ?? '中文', request.angle ?? 'event', request.methodLevel === true);
            }
            catch (error) {
                return { error: `flow read failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /**
         * Code-derived insights: services/events/tools/remotes extracted from each
         * package's entry source. This is the "code-first" view — documentation is
         * a reference, but the analysis never depends on it.
         * @returns insight records or an error.
         */
        async remoteAnalyze() {
            const graph = await this.requireGraph();
            if ('error' in graph)
                return graph;
            return analyzeWorkspace(this.ctx.fs, graph);
        }
        /**
         * AI one-line duty summaries for the package catalog. READ (default):
         * serve the persisted map when it covers every scanned package, null
         * otherwise. WRITE (force=true, the catalog「🤖 AI 生成」): generate the
         * missing summaries (LLM) and persist them.
         * @param request - output language (default 中文) and force flag.
         * @returns id → summary map (complete), null when incomplete, or an error.
         */
        async remoteSummarizeDuties(request) {
            const root = this.resolveRoot();
            if (typeof root !== 'string')
                return root;
            const graph = await this.requireGraph();
            if ('error' in graph)
                return graph;
            const language = request.language ?? '中文';
            if (request.force === true) {
                // 写路径：包目录「🤖 AI 生成」——LLM 补齐缺失总结并落缓存。
                return summarizeDuties(this.ctx, this.ctx.fs, root, graph, language, this.sessionPolicy());
            }
            const cached = await readDutySummaries(this.ctx.fs, root, language);
            if (cached === null)
                return null;
            const missing = graph.nodes.filter(node => cached[node.id] === undefined || cached[node.id] === '');
            if (missing.length === 0)
                return cached;
            return null;
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
            const graph = await this.requireGraph();
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
            const graph = await this.requireGraph();
            if ('error' in graph)
                return graph;
            return progressStats(this.ctx.fs, root, graph, this.notesFile);
        }
        /**
         * LLM usage accounting: totals and the newest recorded calls (see
         * llm-stats.ts for the estimation rule). The snapshot is also persisted to
         * `index/.arch-lens-llm-stats.json` under the workspace so token spend is
         * inspectable outside the panel and survives restarts.
         * @returns the accounting snapshot.
         */
        async remoteLlmStats() {
            const snapshot = llmStatsSnapshot();
            const root = this.resolveRoot();
            if (typeof root === 'string') {
                try {
                    const target = await this.ctx.fs.resolve(`${CACHE_DIR}/.arch-lens-llm-stats.json`, { cwd: root });
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
            const usageStart = this.sessionUsageSnapshot(request.sessionId ?? null);
            this.pending = {
                target: request.target ?? '架构讲解',
                question: request.text ?? '',
                sessionId: request.sessionId ?? null,
                stagedAt: Date.now(),
                ...(usageStart !== undefined ? { usageStart } : {}),
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
        async [(_remoteGraph_decorators = [Remote('graph')], _remoteRefresh_decorators = [Remote('refresh')], _remoteRefreshIndex_decorators = [Remote('refreshIndex')], _remoteGenerateAll_decorators = [Remote('generateAll')], _remoteSetSession_decorators = [Remote('setSession')], _remoteComponent_decorators = [Remote('component')], _remoteNotes_decorators = [Remote('notes')], _remoteMermaidDeps_decorators = [Remote('mermaidDeps')], _remoteMermaidEr_decorators = [Remote('mermaidEr')], _remoteMermaidIndexed_decorators = [Remote('mermaidIndexed')], _remoteMermaidCore_decorators = [Remote('mermaidCore')], _remoteOverviewFigure_decorators = [Remote('overviewFigure')], _remoteConceptTree_decorators = [Remote('conceptTree')], _remoteGenerateDocs_decorators = [Remote('generateDocs')], _remoteGenerateDocSection_decorators = [Remote('generateDocSection')], _remoteSequence_decorators = [Remote('sequence')], _remoteRegenerateFigure_decorators = [Remote('regenerateFigure')], _remoteLastAnswer_decorators = [Remote('lastAnswer')], _remoteGenerationStatus_decorators = [Remote('generationStatus')], _remoteGenerationStatusNext_decorators = [Remote('generationStatusNext')], _remoteFigurePrompt_decorators = [Remote('figurePrompt')], _remoteDynamicFigurePrompt_decorators = [Remote('dynamicFigurePrompt')], _remoteDynamicFigure_decorators = [Remote('dynamicFigure')], _remoteCustomFigurePrompt_decorators = [Remote('customFigurePrompt')], _remoteCustomFigure_decorators = [Remote('customFigure')], _remoteCustomFigureList_decorators = [Remote('customFigureList')], _remoteSaveCustomFigure_decorators = [Remote('saveCustomFigure')], _remoteCustomFigureDelete_decorators = [Remote('customFigureDelete')], _remoteFigureFollowUp_decorators = [Remote('figureFollowUp')], _remoteCancelFollowUp_decorators = [Remote('cancelFollowUp')], _remoteCancelGeneration_decorators = [Remote('cancelGeneration')], _remoteEvents_decorators = [Remote('events')], _remoteFlow_decorators = [Remote('flow')], _remoteAnalyze_decorators = [Remote('analyze')], _remoteSummarizeDuties_decorators = [Remote('summarizeDuties')], _remoteProgress_decorators = [Remote('progress')], _remoteProgressStats_decorators = [Remote('progressStats')], _remoteLlmStats_decorators = [Remote('llmStats')], _remoteNotePending_decorators = [Remote('notePending')], _remotePromptConfig_decorators = [Remote('promptConfig')], _remotePromptConfigSave_decorators = [Remote('promptConfigSave')], Service.init)]() {
            // Restore the persisted LLM accounting (totals + recent records) so token
            // history survives host restarts; the next llmStats write re-persists it.
            const root = this.resolveRoot();
            if (typeof root === 'string') {
                try {
                    const target = await this.ctx.fs.resolve(`${CACHE_DIR}/.arch-lens-llm-stats.json`, { cwd: root });
                    const info = await this.ctx.fs.stat(target);
                    if (info !== undefined && info.type === 'file') {
                        const text = await this.ctx.fs.readText(target);
                        hydrateLlmStats(JSON.parse(text));
                    }
                }
                catch {
                    // no persisted stats yet — start clean
                }
            }
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
                        // Attribute the answering model call's spend to the ledger: the
                        // figure was generated inside the session's agent turn, so its
                        // tokens only surface via the session tokenUsage delta.
                        this.recordSessionUsage('figure', stagedFigure.dynamic === undefined ? 'AI 生成' : '动态下钻', stagedFigure.stagedAt, stagedFigure.usageStart, session.id);
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
                // Custom figure (🎨 动态出图): an answer carrying the staged custom
                // figId is captured into customFigures[figureId] (diagram + 概要) —
                // NEVER auto-written to disk; the panel's 保存 button locks the scene
                // id to disk explicitly. A follow-up re-render keeps the scene id and
                // flips `saved` back to false (the disk copy is now stale).
                const stagedCustom = this.pendingCustomFigure;
                if (stagedCustom !== null) {
                    const parsed = extractFigureJson(answer, stagedCustom.figId);
                    if (parsed !== null) {
                        this.pendingCustomFigure = null;
                        this.recordSessionUsage('draw', '动态出图', stagedCustom.stagedAt, stagedCustom.usageStart, session.id);
                        const value = extractCustomFigure(parsed);
                        if (value !== undefined) {
                            this.customFigures.set(stagedCustom.figureId, {
                                figureId: stagedCustom.figureId,
                                ...value,
                                text: stagedCustom.text,
                                at: Date.now(),
                                // A fresh render means the disk copy (if any) is now stale:
                                // the user must 保存 again to re-lock the scene id.
                                saved: false,
                            });
                            console.log(`[arch-lens] custom figure ${stagedCustom.figureId} captured (memory only, not persisted)`);
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
                this.recordSessionUsage('explain', '讲解', staged.stagedAt, staged.usageStart, session.id);
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