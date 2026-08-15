import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import s from "@deepseek-ai/schemastery";
/** Timestamp format for note headings. */
function timestamp(now) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
/**
* Append one note entry to `ARCH-NOTES.md` under the workspace root and bound
* the file to {@link MAX_NOTE_ENTRIES} entries. This is the only write path.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @param input - target label, question head, and answer text.
* @param notesFile - note file name (default ARCH-NOTES.md).
* @returns success or error result.
*/
async function appendNote(fs, root, input, notesFile) {
	try {
		const target = await fs.resolve(notesFile, { cwd: root });
		const info = await fs.stat(target);
		const questionHead = input.question.split("\n")[0]?.slice(0, 100) ?? "架构讲解";
		const answer = input.answer.trim().slice(0, 600) || "（回答为空）";
		const entry = `\n## [${timestamp(/* @__PURE__ */ new Date())}] (${input.target}) ${questionHead}\n\n**问**：${questionHead}\n\n**答**：${answer}\n`;
		if (info === void 0 || info.type !== "file") {
			await fs.writeText(target, "# 架构笔记（ARCH-NOTES）\n\n由架构学习台自动维护：每次 AI 讲解（含回答）追加一条记录。\n" + entry);
			return { ok: true };
		}
		const trimmed = trimToLimit(await fs.readText(target) + entry);
		await fs.writeText(target, trimmed);
		return { ok: true };
	} catch (error) {
		return { error: `note write failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
/**
* Trim a note file to at most {@link MAX_NOTE_ENTRIES} `## [` headings,
* keeping the file header and the most recent entries.
* @param text - full note file text.
* @returns text with old entries removed from the head.
*/
function trimToLimit(text) {
	const lines = text.split("\n");
	const heads = lines.map((line, index) => ({
		line,
		index
	})).filter(({ line }) => /^## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/.test(line));
	if (heads.length <= 200) return text;
	const keepFrom = heads[heads.length - 200].index;
	return lines.slice(keepFrom).join("\n");
}
/**
* Parse the note file into listing entries, newest first.
* @param text - note file text.
* @returns parsed entries.
*/
function parseNotes(text) {
	const entries = [];
	let current = null;
	for (const line of text.split("\n")) {
		const match = /^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((.*?)\)(.*)$/.exec(line);
		if (match !== null) {
			const [, time, target, rest] = match;
			current = {
				heading: `${time ?? ""}|${target ?? ""}|${(rest ?? "").trim()}`,
				body: []
			};
			entries.push(current);
		} else if (current !== null) current.body.push(line);
	}
	return entries;
}
/**
* Read the note file into the client listing shape, newest first.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @param notesFile - note file name.
* @returns the listing result.
*/
async function readNotes(fs, root, notesFile) {
	try {
		const target = await fs.resolve(notesFile, { cwd: root });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return {
			path: notesFile,
			entries: []
		};
		return {
			path: notesFile,
			entries: parseNotes(await fs.readText(target)).map((entry) => {
				const [time, targetName, rest] = entry.heading.split("|");
				return {
					time: time ?? "",
					target: targetName ?? "",
					preview: rest !== void 0 && rest.length > 0 ? rest.slice(0, 80) : "(讲解)"
				};
			}).reverse()
		};
	} catch (error) {
		return { error: `note read failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
//#endregion
//#region packages/arch-lens-backend/src/scan.ts
/** Max bytes read for package.json / README / entry source (guards huge files). */
const MAX_HEAD_BYTES = 262144;
/**
* Read a JSON file next to a package, bounded.
* @param fs - the filesystem service.
* @param base - absolute package directory path.
* @returns parsed JSON, or null when absent/unreadable/oversized.
*/
async function readJson(fs, base) {
	try {
		const target = await fs.resolve("package.json", { cwd: base });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file" || info.size !== void 0 && info.size > MAX_HEAD_BYTES) return null;
		return JSON.parse(await fs.readText(target));
	} catch {
		return null;
	}
}
/**
* Read the head of a text file, bounded.
* @param fs - the filesystem service.
* @param base - absolute package directory path.
* @param name - relative file name.
* @param max - max characters to keep.
* @returns the head text, or '' when absent/unreadable/oversized.
*/
async function readHead(fs, base, name, max) {
	try {
		const target = await fs.resolve(name, { cwd: base });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file" || info.size !== void 0 && info.size > MAX_HEAD_BYTES) return "";
		return (await fs.readText(target)).slice(0, max);
	} catch {
		return "";
	}
}
/**
* First non-empty, non-heading, non-comment paragraph of a README head.
* @param text - the README head text.
* @returns the trimmed first paragraph (bounded).
*/
function firstParagraph(text) {
	const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("<!--") && !line.startsWith("```"));
	return lines[0] !== void 0 ? lines[0].slice(0, 220) : "";
}
/**
* List src/ file names of a package, bounded.
* @param fs - the filesystem service.
* @param base - absolute package directory path.
* @returns up to 24 file names.
*/
async function listSrc(fs, base) {
	try {
		const src = await fs.resolve("src", { cwd: base });
		return (await fs.listDir(src)).filter((entry) => entry.type === "file").map((entry) => entry.name).slice(0, 24);
	} catch {
		return [];
	}
}
/**
* Classify a src file name into a role.
* @param name - file basename.
* @returns the role label.
*/
function roleOf(name) {
	if (name === "index.ts" || name === "index.js") return "entry";
	if (name === "types.ts") return "types";
	if (name === "invariant.ts") return "invariant";
	if (name === "apply.ts") return "assembly";
	if (name.endsWith(".spec.ts") || name.endsWith(".e2e.ts")) return "test";
	return "";
}
/**
* Scan the workspace `packages/<group>/<pkg>` tree into a graph.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @returns the graph, or an error result.
*/
async function scanWorkspace(fs, root) {
	const nodes = [];
	const edges = [];
	const groups = /* @__PURE__ */ new Set();
	try {
		const packagesTarget = await fs.resolve("packages", { cwd: root });
		const groupEntries = (await fs.listDir(packagesTarget)).filter((entry) => entry.type === "directory");
		for (const group of groupEntries) {
			groups.add(group.name);
			const pkgEntries = (await fs.listDir(group.target)).filter((entry) => entry.type === "directory");
			for (const pkg of pkgEntries) {
				const base = pkg.target.displayPath;
				const meta = await readJson(fs, base);
				if (meta === null || typeof meta.name !== "string" || meta.name.length === 0) continue;
				const short = meta.name.replace(/^@deepseek-ai\/dsh-/, "");
				const deps = typeof meta.peerDependencies === "object" && meta.peerDependencies !== null ? Object.keys(meta.peerDependencies).filter((key) => key.startsWith("@deepseek-ai/dsh-")).map((key) => key.replace(/^@deepseek-ai\/dsh-/, "")) : [];
				for (const dep of deps) edges.push({
					from: short,
					to: dep
				});
				const blurb = firstParagraph(await readHead(fs, base, "README.md", 400));
				const files = await listSrc(fs, base);
				nodes.push({
					id: short,
					short,
					group: group.name,
					blurb,
					files,
					deps,
					path: base
				});
			}
		}
	} catch (error) {
		return { error: `scan failed: ${error instanceof Error ? error.message : String(error)}` };
	}
	return {
		root,
		groups: [...groups].sort(),
		nodes,
		edges
	};
}
/**
* Project one package into its detail view.
* @param fs - the filesystem service.
* @param graph - the scanned graph.
* @param node - the package node.
* @returns the detail projection.
*/
async function componentDetail(fs, graph, node) {
	const files = node.files.map((name) => ({
		name,
		role: roleOf(name)
	}));
	let snippet = "";
	const keyLines = [];
	const entryName = node.files.includes("index.ts") ? "index.ts" : node.files.includes("index.js") ? "index.js" : node.files[0];
	if (entryName !== void 0) {
		const head = await readHead(fs, node.path, `src/${entryName}`, 12e3);
		snippet = head.split("\n").slice(0, 90).map((line) => line.length > 140 ? `${line.slice(0, 137)}…` : line).join("\n");
		const registration = /(ctx\.(on|provide|effect|emit|waterfall|serial|parallel|inject)\(|\.register\(|harness\.(handle|registerTool)\(|@Remote\()/;
		for (const line of head.split("\n")) {
			if (registration.test(line)) keyLines.push(line.trim().slice(0, 120));
			if (keyLines.length >= 18) break;
		}
	}
	const dependents = graph.nodes.filter((candidate) => candidate.deps.includes(node.short)).map((candidate) => candidate.short);
	return {
		id: node.short,
		short: node.short,
		group: node.group,
		blurb: node.blurb,
		files,
		deps: node.deps.slice(0, 40),
		dependents: dependents.slice(0, 40),
		snippet,
		keyLines
	};
}
//#endregion
//#region packages/arch-lens-backend/src/analyze.ts
/** Max entry source bytes scanned per package. */
const MAX_SOURCE_BYTES = 65536;
/** Match service keys provided via ctx.provide('key') / super(ctx, 'key'). */
const PROVIDE_PATTERN = /(?:ctx\.provide\(\s*'([^']+)'|super\(\s*ctx\s*,\s*'([^']+)')/g;
/** Match event names listened via ctx.on('event', / ctx.once('event'. */
const LISTEN_PATTERN = /(?:ctx\.on(?:ce)?\(\s*'([^']+)'|@Remote\(\s*'([^']+)'\))/g;
/** Match tool names registered via tools.register / harness.registerTool / defineTool. */
const TOOL_PATTERN = /(?:\.register(?:Tool)?\(\s*(?:defineTool\(\s*)?\{\s*name\s*:\s*'([^']+)'|name\s*:\s*'([^']+)')/g;
/**
* Analyze one package's entry source for code-derived insights.
* @param fs - the filesystem service.
* @param node - package node carrying its path and file list.
* @returns the insight record (empty arrays when no entry source exists).
*/
async function analyzePackage(fs, node) {
	const entryName = node.files.includes("index.ts") ? "index.ts" : node.files.includes("index.js") ? "index.js" : void 0;
	if (entryName === void 0) return {
		id: node.id,
		provides: [],
		listens: [],
		tools: [],
		remotes: []
	};
	let head = "";
	try {
		const target = await fs.resolve(`src/${entryName}`, { cwd: node.path });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file" || info.size !== void 0 && info.size > MAX_SOURCE_BYTES) return {
			id: node.id,
			provides: [],
			listens: [],
			tools: [],
			remotes: []
		};
		head = await fs.readText(target);
	} catch {
		return {
			id: node.id,
			provides: [],
			listens: [],
			tools: [],
			remotes: []
		};
	}
	const provides = /* @__PURE__ */ new Set();
	const listens = /* @__PURE__ */ new Set();
	const remotes = /* @__PURE__ */ new Set();
	for (const match of head.matchAll(PROVIDE_PATTERN)) {
		const key = match[1] ?? match[2];
		if (key !== void 0) provides.add(key);
	}
	for (const match of head.matchAll(LISTEN_PATTERN)) {
		const event = match[1] ?? match[2];
		if (match[2] !== void 0) remotes.add(match[2]);
		if (event !== void 0) listens.add(event);
	}
	const tools = /* @__PURE__ */ new Set();
	for (const match of head.matchAll(TOOL_PATTERN)) {
		const name = match[1] ?? match[2];
		if (name !== void 0) tools.add(name);
	}
	return {
		id: node.id,
		provides: [...provides],
		listens: [...listens],
		tools: [...tools],
		remotes: [...remotes]
	};
}
/**
* Analyze every package in the graph (bounded parallel: runs over the entry
* heads only, sequential per package to keep fs usage flat).
* @param fs - the filesystem service.
* @param graph - scanned graph.
* @returns insight records for packages with any finding.
*/
async function analyzeWorkspace(fs, graph) {
	const insights = [];
	for (const node of graph.nodes) {
		const insight = await analyzePackage(fs, node);
		if (insight.provides.length > 0 || insight.listens.length > 0 || insight.tools.length > 0 || insight.remotes.length > 0) insights.push(insight);
	}
	return insights;
}
//#endregion
//#region packages/arch-lens-backend/src/mermaid.ts
/** Escape a mermaid node label. */
function label(text) {
	return text.replace(/["\\]/g, "");
}
/**
* Dependency flowchart: one node per package, one edge per dsh-* peer
* dependency, grouped by subgraph.
* @param graph - scanned graph.
* @returns mermaid flowchart source.
*/
function dependencyFlowchart(graph) {
	const lines = ["flowchart TD"];
	const byGroup = /* @__PURE__ */ new Map();
	for (const node of graph.nodes) {
		const list = byGroup.get(node.group) ?? [];
		list.push(node.id);
		byGroup.set(node.group, list);
	}
	for (const [group, ids] of byGroup) {
		lines.push(`  subgraph ${label(group)}["${label(group)}"]`);
		for (const id of ids) lines.push(`    ${id}["${label(id)}"]`);
		lines.push("  end");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const edge of graph.edges) {
		const key = `${edge.from}>${edge.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${edge.from} --> ${edge.to}`);
	}
	return lines.join("\n");
}
/**
* ER-style package relationship diagram: packages as entities, dsh-*
* peerDependencies as relationships. This is a package-dependency ER view —
* useful for spotting coupling between package groups.
* @param graph - scanned graph.
* @returns mermaid erDiagram source.
*/
function packageErDiagram(graph) {
	const lines = ["erDiagram"];
	const emitted = /* @__PURE__ */ new Set();
	for (const node of graph.nodes) {
		lines.push(`  ${label(node.id)} {`);
		lines.push("    string name");
		lines.push(`    string group "${label(node.group)}"`);
		lines.push("  }");
		emitted.add(node.id);
	}
	const seen = /* @__PURE__ */ new Set();
	for (const edge of graph.edges) {
		const key = `${edge.from}>${edge.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${label(edge.from)} ||--o{ ${label(edge.to)} : depends`);
	}
	return lines.join("\n");
}
//#endregion
//#region packages/arch-lens-backend/src/index.ts
/**
* Arch Lens backend host service: workspace graph scanning, component detail
* projection, and answer-level note recording. Read-only graph/component/notes
* methods cross to the browser via Typert Remote; note file WRITES have exactly
* one path — the session/event listener below. notePending only stages in-memory
* question metadata; it never touches the file.
* @module @deepseek-ai/dsh-arch-lens-backend
*/
/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = "ARCH-NOTES.md";
/** Per-workspace prompt configuration file in the workspace root. */
const PROMPT_CONFIG_FILE = ".arch-lens-prompts.json";
/**
* The Arch Lens backend Remote service (`ctx.archLens`).
*/
var ArchLensService = class extends TypertRemoteService {
	static inject = ["fs", "sandboxPolicy"];
	/** Loader validation for the optional note file name. */
	static Config = s.object({ notesFile: s.string() });
	notesFile;
	graphCache = null;
	graphInFlight = null;
	pending = null;
	/**
	* @param ctx - host context carrying fs and sandboxPolicy.
	* @param config - optional notes file name.
	*/
	constructor(ctx, config = {}) {
		super(ctx, "archLens");
		this.notesFile = config.notesFile ?? DEFAULT_NOTES_FILE;
	}
	/** Resolve the workspace root from the session sandbox policy. */
	resolveRoot() {
		const root = this.ctx.get("sandboxPolicy")?.workspaceRoot;
		if (root === void 0) return { error: "cannot resolve workspace root (sandboxPolicy.workspaceRoot missing)" };
		return root;
	}
	/** Scan (with cache) the workspace package tree; concurrent callers share one scan. */
	graph() {
		if (this.graphCache !== null) return Promise.resolve(this.graphCache);
		if (this.graphInFlight !== null) return this.graphInFlight;
		const root = this.resolveRoot();
		if (typeof root !== "string") return Promise.resolve(root);
		const fs = this.ctx.fs;
		this.graphInFlight = scanWorkspace(fs, root).then((result) => {
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
	@Remote("graph") async remoteGraph() {
		return this.graph();
	}
	/**
	* Invalidate the graph cache and rescan.
	* @returns the fresh graph or error.
	*/
	@Remote("refresh") async remoteRefresh() {
		this.graphCache = null;
		return this.graph();
	}
	/**
	* Detail projection for one package.
	* @param request - package id.
	* @returns detail or error.
	*/
	@Remote("component") async remoteComponent(request) {
		const graph = await this.graph();
		if ("error" in graph) return graph;
		const node = graph.nodes.find((candidate) => candidate.id === request.id);
		if (node === void 0) return { error: `unknown component: ${request.id}` };
		return componentDetail(this.ctx.fs, graph, node);
	}
	/**
	* The note file listing, newest first.
	* @returns notes listing or an error.
	*/
	@Remote("notes") async remoteNotes() {
		const root = this.resolveRoot();
		if (typeof root !== "string") return {
			path: this.notesFile,
			entries: []
		};
		return readNotes(this.ctx.fs, root, this.notesFile);
	}
	/**
	* Mermaid dependency flowchart for the scanned graph.
	* @returns flowchart source or an error.
	*/
	@Remote("mermaidDeps") async remoteMermaidDeps() {
		const graph = await this.graph();
		if ("error" in graph) return graph;
		return {
			kind: "flowchart",
			source: dependencyFlowchart(graph)
		};
	}
	/**
	* Mermaid ER diagram of package relationships for the scanned graph.
	* @returns erDiagram source or an error.
	*/
	@Remote("mermaidEr") async remoteMermaidEr() {
		const graph = await this.graph();
		if ("error" in graph) return graph;
		return {
			kind: "erDiagram",
			source: packageErDiagram(graph)
		};
	}
	/**
	* Code-derived insights: services/events/tools/remotes extracted from each
	* package's entry source. This is the "code-first" view — documentation is
	* a reference, but the analysis never depends on it.
	* @returns insight records or an error.
	*/
	@Remote("analyze") async remoteAnalyze() {
		const graph = await this.graph();
		if ("error" in graph) return graph;
		return analyzeWorkspace(this.ctx.fs, graph);
	}
	/**
	* Stage question metadata for the next assistant/message answer. Memory
	* only — the file write stays exclusively on the event path below.
	* @param request - target label, question text, and calling session id.
	* @returns acknowledgement.
	*/
	@Remote("notePending") async remoteNotePending(request) {
		this.pending = {
			target: request.target ?? "架构讲解",
			question: request.text ?? "",
			sessionId: request.sessionId ?? null
		};
		return { ok: true };
	}
	/**
	* Read the persisted per-workspace prompt configuration.
	* @returns the config and its storage path.
	*/
	@Remote("promptConfig") async remotePromptConfig() {
		const root = this.resolveRoot();
		if (typeof root !== "string") return {
			path: PROMPT_CONFIG_FILE,
			config: {}
		};
		const fs = this.ctx.fs;
		try {
			const target = await fs.resolve(PROMPT_CONFIG_FILE, { cwd: root });
			const info = await fs.stat(target);
			if (info === void 0 || info.type !== "file") return {
				path: PROMPT_CONFIG_FILE,
				config: {}
			};
			const text = await fs.readText(target);
			return {
				path: PROMPT_CONFIG_FILE,
				config: JSON.parse(text)
			};
		} catch {
			return {
				path: PROMPT_CONFIG_FILE,
				config: {}
			};
		}
	}
	/**
	* Persist the per-workspace prompt configuration.
	* @param request - config fields to store (absent fields keep their stored value).
	* @returns the stored config and its path.
	*/
	@Remote("promptConfigSave") async remotePromptConfigSave(request) {
		const root = this.resolveRoot();
		if (typeof root !== "string") return root;
		const fs = this.ctx.fs;
		try {
			const target = await fs.resolve(PROMPT_CONFIG_FILE, { cwd: root });
			const info = await fs.stat(target);
			const existing = info !== void 0 && info.type === "file" ? JSON.parse(await fs.readText(target)) : {};
			const merged = {};
			if (request.overviewPrompt !== void 0) merged.overviewPrompt = request.overviewPrompt;
			else if (existing.overviewPrompt !== void 0) merged.overviewPrompt = existing.overviewPrompt;
			if (request.explainStyle !== void 0) merged.explainStyle = request.explainStyle;
			else if (existing.explainStyle !== void 0) merged.explainStyle = existing.explainStyle;
			await fs.writeText(target, JSON.stringify(merged, null, 2));
			return {
				path: PROMPT_CONFIG_FILE,
				config: merged
			};
		} catch (error) {
			return { error: `prompt config save failed: ${error instanceof Error ? error.message : String(error)}` };
		}
	}
	/** Register the single note-write path: assistant/message events. */
	async [Service.init]() {
		this.ctx.on("session/event", (session, event) => {
			if (event.type !== "assistant/message") return;
			if (this.pending !== null && this.pending.sessionId !== null && session.id !== this.pending.sessionId) return;
			const message = event.data.message;
			let answer = "";
			for (const block of message.content) if (block.type === "text") answer += block.text;
			const staged = this.pending;
			this.pending = null;
			const root = this.resolveRoot();
			if (typeof root !== "string") return;
			appendNote(this.ctx.fs, root, {
				target: staged?.target ?? "架构讲解",
				question: staged?.question ?? "",
				answer
			}, this.notesFile);
		});
	}
};
//#endregion
export { ArchLensService, ArchLensService as default };
