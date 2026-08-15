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
import { componentDetail, scanWorkspace } from "./scan.js";
import { analyzeWorkspace } from "./analyze.js";
import { dependencyFlowchart, packageErDiagram } from "./mermaid.js";
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
    let _remoteComponent_decorators;
    let _remoteNotes_decorators;
    let _remoteMermaidDeps_decorators;
    let _remoteMermaidEr_decorators;
    let _remoteAnalyze_decorators;
    let _remoteNotePending_decorators;
    let _remotePromptConfig_decorators;
    let _remotePromptConfigSave_decorators;
    return class ArchLensService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate(this, null, _remoteGraph_decorators, { kind: "method", name: "remoteGraph", static: false, private: false, access: { has: obj => "remoteGraph" in obj, get: obj => obj.remoteGraph }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteRefresh_decorators, { kind: "method", name: "remoteRefresh", static: false, private: false, access: { has: obj => "remoteRefresh" in obj, get: obj => obj.remoteRefresh }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteComponent_decorators, { kind: "method", name: "remoteComponent", static: false, private: false, access: { has: obj => "remoteComponent" in obj, get: obj => obj.remoteComponent }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteNotes_decorators, { kind: "method", name: "remoteNotes", static: false, private: false, access: { has: obj => "remoteNotes" in obj, get: obj => obj.remoteNotes }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteMermaidDeps_decorators, { kind: "method", name: "remoteMermaidDeps", static: false, private: false, access: { has: obj => "remoteMermaidDeps" in obj, get: obj => obj.remoteMermaidDeps }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteMermaidEr_decorators, { kind: "method", name: "remoteMermaidEr", static: false, private: false, access: { has: obj => "remoteMermaidEr" in obj, get: obj => obj.remoteMermaidEr }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteAnalyze_decorators, { kind: "method", name: "remoteAnalyze", static: false, private: false, access: { has: obj => "remoteAnalyze" in obj, get: obj => obj.remoteAnalyze }, metadata: _metadata }, null, _instanceExtraInitializers);
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
        graphCache = null;
        graphInFlight = null;
        pending = null;
        /**
         * @param ctx - host context carrying fs and sandboxPolicy.
         * @param config - optional notes file name.
         */
        constructor(ctx, config = {}) {
            super(ctx, 'archLens');
            this.notesFile = config.notesFile ?? DEFAULT_NOTES_FILE;
        }
        /** Resolve the workspace root from the session sandbox policy. */
        resolveRoot() {
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
         * Invalidate the graph cache and rescan.
         * @returns the fresh graph or error.
         */
        async remoteRefresh() {
            this.graphCache = null;
            return this.graph();
        }
        /**
         * Detail projection for one package.
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
            return componentDetail(this.ctx.fs, graph, node);
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
                await fs.writeText(target, JSON.stringify(merged, null, 2));
                return { path: PROMPT_CONFIG_FILE, config: merged };
            }
            catch (error) {
                return { error: `prompt config save failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        }
        /** Register the single note-write path: assistant/message events. */
        async [(_remoteGraph_decorators = [Remote('graph')], _remoteRefresh_decorators = [Remote('refresh')], _remoteComponent_decorators = [Remote('component')], _remoteNotes_decorators = [Remote('notes')], _remoteMermaidDeps_decorators = [Remote('mermaidDeps')], _remoteMermaidEr_decorators = [Remote('mermaidEr')], _remoteAnalyze_decorators = [Remote('analyze')], _remoteNotePending_decorators = [Remote('notePending')], _remotePromptConfig_decorators = [Remote('promptConfig')], _remotePromptConfigSave_decorators = [Remote('promptConfigSave')], Service.init)]() {
            this.ctx.on('session/event', (session, event) => {
                if (event.type !== 'assistant/message')
                    return;
                if (this.pending !== null && this.pending.sessionId !== null && session.id !== this.pending.sessionId)
                    return;
                const message = event.data.message;
                let answer = '';
                for (const block of message.content) {
                    if (block.type === 'text')
                        answer += block.text;
                }
                const staged = this.pending;
                this.pending = null;
                const root = this.resolveRoot();
                if (typeof root !== 'string')
                    return;
                void appendNote(this.ctx.fs, root, {
                    target: staged?.target ?? '架构讲解',
                    question: staged?.question ?? '',
                    answer,
                }, this.notesFile);
            });
        }
    };
})();
export { ArchLensService };
export default ArchLensService;
//# sourceMappingURL=index.js.map