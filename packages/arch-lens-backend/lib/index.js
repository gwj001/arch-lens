import { Service } from "@deepseek-ai/cordis";
import { unlink } from "node:fs/promises";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import s from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { createHash } from "node:crypto";
/** Timestamp format for note headings (seconds included for summary display). */
function timestamp(now) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
/**
* Append one note entry to `ARCH-NOTES.md` under the workspace root and bound
* the file to {@link MAX_NOTE_ENTRIES} entries. This is the only write path.
* Duplicate questions are skipped: an entry whose target AND question head
* (first line, first 100 chars) both match an existing entry is not written,
* so repeating the same explain button never duplicates, while follow-ups
* from a different angle (different question) still record.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @param input - target label, question head, and answer text.
* @param notesFile - note file name (default ARCH-NOTES.md).
* @returns success (possibly skipped) or error result.
*/
async function appendNote(fs, root, input, notesFile, sandboxPolicy) {
	try {
		const target = await fs.resolve(notesFile, { cwd: root });
		const info = await fs.stat(target);
		const questionHead = input.question.split("\n")[0]?.slice(0, 100) ?? "架构讲解";
		const answer = input.answer.trim().slice(0, 600) || "（回答为空）";
		const entry = `\n## [${timestamp(/* @__PURE__ */ new Date())}] (${input.target}) ${questionHead}\n\n**问**：${questionHead}\n\n**答**：${answer}\n`;
		if (info !== void 0 && info.type === "file") {
			const existing = await fs.readText(target);
			if (isDuplicate(existing, input.target, questionHead)) return {
				ok: true,
				skipped: true
			};
			await fs.writeText(target, trimToLimit(existing + entry), void 0, void 0, sandboxPolicy);
			return { ok: true };
		}
		await fs.writeText(target, "# 架构笔记（ARCH-NOTES）\n\n由架构学习台自动维护：每次 AI 讲解（含回答）追加一条记录。\n" + entry, void 0, void 0, sandboxPolicy);
		return { ok: true };
	} catch (error) {
		return { error: `note write failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
/**
* Whether the note file already holds an entry for the same target and
* question head — the "same question" duplicate rule. Different questions
* about the same target (new angles) are NOT duplicates.
* @param text - existing note file text.
* @param target - the new entry's target label.
* @param questionHead - the new entry's question head.
* @returns true when a matching entry exists.
*/
function isDuplicate(text, target, questionHead) {
	return parseNotes(text).some((entry) => {
		const [, entryTarget, rest] = entry.heading.split("|");
		if (entryTarget !== target) return false;
		const question = entry.body.find((line) => line.startsWith("**问**："));
		if (question === void 0) return (rest ?? "").trim() === questionHead;
		return question.slice(6).trim() === questionHead;
	});
}
/**
* Trim a note file to at most {@link MAX_NOTE_ENTRIES} `## [` headings,
* keeping the file header (everything before the first entry) and the most
* recent entries.
* @param text - full note file text.
* @returns text with old entries removed from the head.
*/
function trimToLimit(text) {
	const lines = text.split("\n");
	const heads = lines.map((line, index) => ({
		line,
		index
	})).filter(({ line }) => /^## \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?\]/.test(line));
	if (heads.length <= 200) return text;
	const keepFrom = heads[heads.length - 200].index;
	const headerEnd = heads[0].index;
	return [...lines.slice(0, headerEnd), ...lines.slice(keepFrom)].join("\n");
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
		const match = /^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\] \((.*?)\)(.*)$/.exec(line);
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
* First non-empty, non-heading, non-comment, non-language-switch paragraph of
* a README head.
* @param text - the README head text.
* @returns the trimmed first paragraph (bounded).
*/
function firstParagraph(text) {
	const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("<!--") && !line.startsWith("```")).filter((line) => !LANG_SWITCH_LINE.test(line));
	return lines[0] !== void 0 ? lines[0].slice(0, 220) : "";
}
/** README language-switch rows like `English | [中文](README.zh.md)` or `[English](README.md) | 中文`. */
const LANG_SWITCH_LINE = /^(?:\[)?(English|中文|简体中文|繁体中文|日本語|한국어|Deutsch|Français|Español|Русский)(?:\]\([^)]*\))?\s*\|/;
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
* Scan the workspace package tree into a graph. Both layouts are supported:
* grouped `packages/<group>/<pkg>` (deepseek-harness) and flat
* `packages/<pkg>` (arch-lens): an entry under `packages/` that owns a
* package.json is a package with no group, otherwise it is a group whose
* subdirectories are packages. Each node carries its precomputed popup
* detail, so the client can open package details instantly without a second
* round trip.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @returns the graph, or an error result.
*/
async function scanWorkspace(fs, root) {
	const nodes = [];
	const edges = [];
	const groups = /* @__PURE__ */ new Set();
	const addPackage = async (base, groupName, meta) => {
		if (typeof meta.name !== "string" || meta.name.length === 0) return;
		const short = meta.name.replace(/^@deepseek-ai\/dsh-/, "");
		const deps = typeof meta.peerDependencies === "object" && meta.peerDependencies !== null ? Object.keys(meta.peerDependencies).filter((key) => key.startsWith("@deepseek-ai/dsh-")).map((key) => key.replace(/^@deepseek-ai\/dsh-/, "")) : [];
		for (const dep of deps) edges.push({
			from: short,
			to: dep
		});
		const description = typeof meta.description === "string" ? meta.description.trim() : "";
		const readme = await readHead(fs, base, "README.md", 400);
		const blurb = description !== "" ? description.slice(0, 220) : firstParagraph(readme);
		const blurbZh = firstParagraph(await readHead(fs, base, "README.zh.md", 400));
		const files = await listSrc(fs, base);
		nodes.push({
			id: short,
			short,
			group: groupName,
			blurb,
			files,
			deps,
			path: base,
			...blurbZh !== "" ? { blurbZh } : {},
			detail: emptyDetail(short, groupName, blurb)
		});
	};
	try {
		const packagesTarget = await fs.resolve("packages", { cwd: root });
		const groupEntries = (await fs.listDir(packagesTarget)).filter((entry) => entry.type === "directory");
		for (const group of groupEntries) {
			const flatMeta = await readJson(fs, group.target.displayPath);
			if (flatMeta !== null) {
				await addPackage(group.target.displayPath, "", flatMeta);
				continue;
			}
			groups.add(group.name);
			const pkgEntries = (await fs.listDir(group.target)).filter((entry) => entry.type === "directory");
			for (const pkg of pkgEntries) {
				const meta = await readJson(fs, pkg.target.displayPath);
				if (meta === null) continue;
				await addPackage(pkg.target.displayPath, group.name, meta);
			}
		}
	} catch (error) {
		return { error: `scan failed: ${error instanceof Error ? error.message : String(error)}` };
	}
	for (const node of nodes) {
		const dependents = nodes.filter((candidate) => candidate.deps.includes(node.short)).map((candidate) => candidate.short);
		try {
			node.detail = await componentDetail(fs, node, dependents);
		} catch (error) {
			node.detail = {
				...node.detail,
				deps: node.deps.slice(0, 40),
				dependents: dependents.slice(0, 40)
			};
			console.warn(`arch-lens: detail failed for ${node.short}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return {
		root,
		groups: [...groups].sort(),
		nodes,
		edges
	};
}
/** Placeholder detail until the graph-wide pass fills it in. */
function emptyDetail(id, group, blurb) {
	return {
		id,
		short: id,
		group,
		blurb,
		files: [],
		deps: [],
		dependents: [],
		snippet: "",
		keyLines: []
	};
}
/**
* Project one package into its detail view.
* @param fs - the filesystem service.
* @param node - the package node.
* @param dependents - short ids of packages that depend on this one.
* @returns the detail projection.
*/
async function componentDetail(fs, node, dependents) {
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
	const dependentsList = dependents.slice(0, 40);
	return {
		id: node.short,
		short: node.short,
		group: node.group,
		blurb: node.blurb,
		files,
		deps: node.deps.slice(0, 40),
		dependents: dependentsList,
		snippet,
		keyLines
	};
}
//#endregion
//#region packages/arch-lens-backend/src/cache-dir.ts
/**
* Workspace-relative directory holding EVERY `.arch-lens-*.json` cache
* (scan graph, code index, per-kind figure caches, llm stats, prompts).
* The code-index tree-sitter provider mirrors this literal (`index/`) so all
* artifacts land in one place; keep the two in sync.
* @module @deepseek-ai/dsh-arch-lens-backend/src/cache-dir
*/
/** Cache directory name, relative to the workspace root. */
const CACHE_DIR = "index";
//#endregion
//#region packages/arch-lens-backend/src/fact-cache.ts
/** The graph cache file whose generatedAt is the facts version. */
const GRAPH_CACHE_FILE$1 = `${CACHE_DIR}/.arch-lens-graph.json`;
/**
* Current facts version (graph.generatedAt), or 0 when the graph is
* unavailable. Version 0 disables caching entirely (safest direction: an
* unknown facts version must never serve or persist a cache).
*/
async function readFactVersion(fs, root) {
	try {
		const target = await fs.resolve(GRAPH_CACHE_FILE$1, { cwd: root });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return 0;
		const parsed = JSON.parse(await fs.readText(target));
		return typeof parsed.generatedAt === "number" && Number.isFinite(parsed.generatedAt) ? parsed.generatedAt : 0;
	} catch {
		return 0;
	}
}
/**
* Versioned cache read: only data written against the CURRENT facts version
* is served. Old-version, unversioned-legacy, corrupt or missing files all
* read as null → the chain regenerates and rewrites the cache.
*/
async function readVersionedCache(fs, target, version) {
	if (version === 0) return null;
	try {
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return null;
		const parsed = JSON.parse(await fs.readText(target));
		if (parsed.v !== version) return null;
		return parsed.data;
	} catch {
		return null;
	}
}
/**
* Versioned cache write. Skipped entirely when the facts version is unknown
* (0) so an unverifiable cache can never be served later. `deps` records the
* package ids this figure was derived from; the rescan invalidation uses it to
* invalidate only the figures whose facts actually moved (selective
* invalidation). Absent `deps` ⇒ no field is written (legacy-compatible) and
* the invalidation treats the cache as depending on every package.
*
* A FAILED write THROWS instead of being swallowed: a write path that just
* spent minutes on LLM generation must surface "could not persist" to the
* user (e.g. the session sandbox is read-only) rather than silently reporting
* success while every cache stays stale — that produced the "生成成功但图全空"
* symptom. Callers either let it propagate (generateAll steps collect it) or
* convert it into an error result.
*/
async function writeVersionedCache(fs, target, data, version, sandboxPolicy, deps) {
	if (version === 0) return;
	const wrapped = {
		v: version,
		data
	};
	if (deps !== void 0 && deps.length > 0) wrapped.deps = [...new Set(deps)];
	await fs.writeText(target, JSON.stringify(wrapped), void 0, void 0, sandboxPolicy);
}
/**
* Read a cache file's `{ v, deps, data }` envelope regardless of whether its
* version is current. Non-versioned, corrupt or missing files read as null.
*/
async function readRawCache(fs, target) {
	try {
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return null;
		const parsed = JSON.parse(await fs.readText(target));
		if (typeof parsed.v !== "number") return null;
		const deps = Array.isArray(parsed.deps) ? parsed.deps.filter((d) => typeof d === "string") : [];
		return {
			v: parsed.v,
			deps,
			depsPresent: Array.isArray(parsed.deps),
			data: parsed.data
		};
	} catch {
		return null;
	}
}
/** Cache files the rescan invalidation must never touch (they are either the
* facts source itself, or non-figure artifacts). */
const SKIP_INVALIDATION = /* @__PURE__ */ new Set([
	".arch-lens-graph.json",
	".arch-lens-file-manifest.json",
	".arch-lens-index.json",
	".arch-lens-llm-stats.json",
	".arch-lens-progress-default.json"
]);
/** Entity cache file prefix → kind-family label (the key the dynamic-figure
* cascade matches on: a drill-down dies together with its parent figure). */
const ENTITY_KIND_PREFIXES = [
	[".arch-lens-concept", "concept"],
	[".arch-lens-sequence", "sequence"],
	[".arch-lens-events", "events"],
	[".arch-lens-flow", "flow"],
	[".arch-lens-core", "core"],
	[".arch-lens-summaries", "summaries"],
	[".arch-lens-analysis", "analysis"]
];
/**
* Selective invalidation (rescan with changes) — TWO passes.
*
* Pass 1 (entity/profile caches): a cache whose `deps` intersects
* `changedPackages` is invalidated (written as `{ v: 0 }`, which no read can
* ever match), while every other cache has its version re-stamped to
* `newFactsVersion` (content and deps unchanged) so it keeps being served
* after the graph rebuild. A legacy cache without a deps field depends on
* every package → invalidated. A cache with an explicit empty deps (e.g. a
* doc-sourced flow) depends on nothing → only re-stamped, never invalidated.
* Each invalidated figure kind is recorded for the cascade below.
*
* Pass 2 (dynamic drill-down figures, D1): a versioned `.arch-lens-dynamic-*`
* cache is invalidated when its own `deps` hit the change set, OR its parent
* entity figure was invalidated in pass 1 (seq-edge→sequence,
* flow-subgraph→flow), OR it is an overview (whole-workspace view: depends on
* every package), OR it is a legacy unversioned file (no longer servable by
* the version-bound read anyway — mark it so the hover regenerates cleanly).
* Survivors are re-stamped like entity caches. `.arch-lens-draw-*` (user
* assets) are never touched.
*/
async function selectiveInvalidate(fs, root, changedPackages, newFactsVersion, sandboxPolicy) {
	const dir = await fs.resolve(CACHE_DIR, { cwd: root }).catch(() => null);
	if (dir === null) return;
	let entries;
	try {
		entries = await fs.listDir(dir);
	} catch {
		return;
	}
	/** Invalidated in pass 1, cascaded in pass 2. */
	const invalidatedKinds = /* @__PURE__ */ new Set();
	const dynamicFiles = [];
	for (const entry of entries) {
		if (entry.type !== "file") continue;
		if (!entry.name.startsWith(".arch-lens-") || !entry.name.endsWith(".json")) continue;
		if (SKIP_INVALIDATION.has(entry.name) || entry.name.startsWith(".arch-lens-draw-")) continue;
		if (entry.name.startsWith(".arch-lens-dynamic-")) {
			dynamicFiles.push({
				name: entry.name,
				target: entry.target
			});
			continue;
		}
		const raw = await readRawCache(fs, entry.target);
		if (raw === null) continue;
		if (!raw.depsPresent || raw.deps.some((d) => changedPackages.has(d))) {
			await fs.writeText(entry.target, JSON.stringify({ v: 0 }), void 0, void 0, sandboxPolicy).catch(() => {});
			const family = ENTITY_KIND_PREFIXES.find(([prefix]) => entry.name.startsWith(prefix));
			if (family !== void 0) invalidatedKinds.add(family[1]);
		} else {
			const wrapped = {
				v: newFactsVersion,
				data: raw.data
			};
			if (raw.depsPresent) wrapped.deps = raw.deps;
			await fs.writeText(entry.target, JSON.stringify(wrapped), void 0, void 0, sandboxPolicy).catch(() => {});
		}
	}
	for (const file of dynamicFiles) {
		const parentKind = file.name.includes("-seq-edge-") ? "sequence" : file.name.includes("-flow-subgraph-") ? "flow" : file.name.includes("-overview-") ? "overview" : void 0;
		if (parentKind === void 0) continue;
		const raw = await readRawCache(fs, file.target);
		if (raw === null || parentKind === "overview" || !raw.depsPresent || raw.deps.some((d) => changedPackages.has(d)) || invalidatedKinds.has(parentKind)) await fs.writeText(file.target, JSON.stringify({ v: 0 }), void 0, void 0, sandboxPolicy).catch(() => {});
		else {
			const wrapped = {
				v: newFactsVersion,
				data: raw.data
			};
			if (raw.depsPresent) wrapped.deps = raw.deps;
			await fs.writeText(file.target, JSON.stringify(wrapped), void 0, void 0, sandboxPolicy).catch(() => {});
		}
	}
}
//#endregion
//#region packages/arch-lens-backend/src/paths.ts
/**
* Path helpers shared by every LLM-facing prompt builder: facts handed to
* the model must read workspace-relative (`packages/a/src/index.ts`) — the
* absolute workspace root is stated ONCE per prompt, never per path.
* @module @deepseek-ai/dsh-arch-lens-backend/src/paths
*/
/** Strip the workspace root prefix so a path reads workspace-relative.
* Separators are normalized to `/`; already-relative or foreign paths pass
* through unchanged. */
function workspaceRelative(root, path) {
	const r = root.replace(/\\/g, "/");
	const p = path.replace(/\\/g, "/");
	return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}
//#endregion
//#region packages/arch-lens-backend/src/types.ts
/**
* Display label for a package group. `''` means a flat `packages/<pkg>`
* layout (the node has no group directory); render it as `packages` so
* subgraphs/entities never carry an empty label.
* @param group - the node's group name ('' for flat layouts).
* @returns the display label.
*/
function groupLabel(group) {
	return group === "" ? "packages" : group;
}
//#endregion
//#region packages/arch-lens-backend/src/mermaid.ts
/**
* Mermaid diagram generation from the scanned workspace graph: a dependency
* flowchart and an ER-style package relationship diagram. Both are pure
* functions of the graph so the client can render any mermaid via the generic
* renderer. Indexed variants derive edges from the code-index imports (real
* source-level dependencies) instead of npm peerDependencies.
* @module @deepseek-ai/dsh-arch-lens-backend/src/mermaid
*/
/** Escape a mermaid node label. */
function label(text) {
	return text.replace(/["\\]/g, "");
}
/**
* ER relationship lines are nearly invisible under the default theme (same
* hue as the diagram background); pin a dark amber so the import/dependency
* edges read clearly. The client renders with securityLevel 'loose', which
* permits %%{init} directives.
*/
const ER_LINE_STYLE = "%%{init: {\"themeVariables\": {\"er\": {\"lineColor\": \"#b45309\", \"stroke\": \"#b45309\"}}}}%%";
/**
* Aggregate code-index imports into package-level edges: package A → package B
* when a source file of A imports a module that resolves to B (B's id is a
* path segment of the import specifier, or B's entry imports land in A).
* External modules (npm/python/java packages outside the workspace) are
* dropped so the graph stays workspace-internal.
* @param index - code index result.
* @returns package id → package ids it imports.
*/
function importEdges(index) {
	const byId = /* @__PURE__ */ new Map();
	for (const pkg of index.packages) byId.set(pkg.id, pkg.id);
	const prefixes = index.packages.map((pkg) => pkg.id);
	const edges = /* @__PURE__ */ new Map();
	for (const pkg of index.packages) {
		const targets = /* @__PURE__ */ new Set();
		for (const imp of pkg.imports) {
			const spec = imp.to;
			if (spec.startsWith(".")) {
				const resolved = [...imp.from.split("/").slice(0, -1), ...spec.split("/").filter((part) => part !== "." && part !== "..")].filter(Boolean);
				for (const candidate of resolved.slice(1)) {
					if (candidate === void 0) continue;
					if (byId.has(candidate) || byId.has(candidate.replace(/^dsh-/, ""))) {
						const id = candidate.replace(/^dsh-/, "");
						targets.add(id);
						break;
					}
				}
				continue;
			}
			for (const id of prefixes) {
				const parts = spec.split("/");
				const normalized = parts.map((part) => part.replace(/^dsh-/, ""));
				const first = parts[0];
				if (normalized.includes(id) || first === id || first !== void 0 && first.startsWith(id)) {
					targets.add(id);
					break;
				}
			}
		}
		if (targets.size > 0) edges.set(pkg.id, targets);
	}
	return new Map([...edges].map(([from, tos]) => [from, [...tos].filter((to) => to !== from)]));
}
/**
* Dependency flowchart over the code-index imports (source-level edges).
* @param index - code index result.
* @returns mermaid flowchart source.
*/
function importFlowchart(index) {
	const lines = ["flowchart TD"];
	const byLanguage = /* @__PURE__ */ new Map();
	for (const pkg of index.packages) {
		const list = byLanguage.get(pkg.language) ?? [];
		list.push(pkg.id);
		byLanguage.set(pkg.language, list);
	}
	for (const [language, ids] of byLanguage) {
		lines.push(`  subgraph g_${label(language)}["${label(language)}"]`);
		for (const id of ids) lines.push(`    ${id}["${label(id)}"]`);
		lines.push("  end");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const [from, tos] of importEdges(index)) for (const to of tos) {
		const key = `${from}>${to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${from} --> ${to}`);
	}
	return lines.join("\n");
}
/**
* ER-style package diagram over the code-index imports: packages as entities,
* source-level import edges as relationships.
* @param index - code index result.
* @returns mermaid erDiagram source.
*/
function entityErDiagram(index) {
	const lines = ["erDiagram"];
	for (const pkg of index.packages) {
		lines.push(`  ${label(pkg.id)} {`);
		lines.push("    string language");
		const classCount = pkg.entities.filter((entity) => entity.kind === "class" || entity.kind === "interface").length;
		if (classCount > 0) lines.push(`    int classes "${classCount}"`);
		lines.push("  }");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const [from, tos] of importEdges(index)) for (const to of tos) {
		const key = `${from}>${to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${label(from)} ||--o{ ${label(to)} : imports`);
	}
	return `${ER_LINE_STYLE}\n${lines.join("\n")}`;
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
		lines.push(`  subgraph g_${label(groupLabel(group))}["${label(groupLabel(group))}"]`);
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
		lines.push(`    string group "${label(groupLabel(node.group))}"`);
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
	return `${ER_LINE_STYLE}\n${lines.join("\n")}`;
}
/**
* Core-flow dependency flowchart: only the packages selected as core (by the
* LLM picker or the deterministic fallback), with edges restricted to
* source-level imports between selected packages. Pure function of the index.
* @param index - code index result.
* @param ids - selected core package ids.
* @returns mermaid flowchart source (may be near-empty when the set is tiny).
*/
function coreFlowchart(index, ids) {
	const idSet = new Set(ids);
	const lines = ["flowchart TD"];
	const byLanguage = /* @__PURE__ */ new Map();
	for (const pkg of index.packages) {
		if (!idSet.has(pkg.id)) continue;
		const list = byLanguage.get(pkg.language) ?? [];
		list.push(pkg.id);
		byLanguage.set(pkg.language, list);
	}
	for (const [language, pkgIds] of byLanguage) {
		lines.push(`  subgraph g_${label(language)}["${label(language)}"]`);
		for (const id of pkgIds) lines.push(`    ${id}["${label(id)}"]`);
		lines.push("  end");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const [from, tos] of importEdges(index)) {
		if (!idSet.has(from)) continue;
		for (const to of tos) {
			if (!idSet.has(to)) continue;
			const key = `${from}>${to}`;
			if (seen.has(key)) continue;
			seen.add(key);
			lines.push(`  ${from} --> ${to}`);
		}
	}
	return lines.join("\n");
}
/**
* 架构概览 flowchart, READ path (graph-only): the core packages with their
* one-line duty (blurb) under the name, and dependency edges between core
* packages from the SCAN GRAPH (not the code index — the read path never
* walks source). Pure function of structured facts (zero LLM, zero I/O).
* @param graph - scanned workspace graph.
* @param ids - selected core package ids.
* @param blurbOf - one-line duty per package id (graph blurb), '' when absent.
* @returns mermaid flowchart source.
*/
function overviewFigureFromGraph(graph, ids, blurbOf) {
	const idSet = new Set(ids);
	const lines = ["flowchart TD"];
	for (const node of graph.nodes) {
		if (!idSet.has(node.id)) continue;
		const blurb = blurbOf(node.id).trim();
		const text = blurb === "" ? label(node.id) : `${label(node.id)}<br/><small>${label(blurb.slice(0, 40))}</small>`;
		lines.push(`  ${node.id}["${text}"]`);
	}
	const seen = /* @__PURE__ */ new Set();
	for (const edge of graph.edges) {
		if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
		const key = `${edge.from}>${edge.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${edge.from} -->|import| ${edge.to}`);
	}
	return lines.join("\n");
}
/**
* Core-flow flowchart, READ path (graph-only): selected packages grouped by
* scan group, with dependency edges from the scan graph. Zero LLM, zero I/O.
* @param graph - scanned workspace graph.
* @param ids - selected core package ids.
* @returns mermaid flowchart source.
*/
function coreFlowchartFromGraph(graph, ids) {
	const idSet = new Set(ids);
	const lines = ["flowchart TD"];
	const byGroup = /* @__PURE__ */ new Map();
	for (const node of graph.nodes) {
		if (!idSet.has(node.id)) continue;
		const list = byGroup.get(node.group) ?? [];
		list.push(node.id);
		byGroup.set(node.group, list);
	}
	for (const [group, pkgIds] of byGroup) {
		lines.push(`  subgraph g_${label(group)}["${label(groupLabel(group))}"]`);
		for (const id of pkgIds) lines.push(`    ${id}["${label(id)}"]`);
		lines.push("  end");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const edge of graph.edges) {
		if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
		const key = `${edge.from}>${edge.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${edge.from} --> ${edge.to}`);
	}
	return lines.join("\n");
}
/**
* Core-flow ER diagram, READ path (graph-only): selected packages as
* entities, dependency edges between selected packages as relationships.
* Zero LLM, zero I/O.
* @param graph - scanned workspace graph.
* @param ids - selected core package ids.
* @returns mermaid erDiagram source.
*/
function coreErDiagramFromGraph(graph, ids) {
	const idSet = new Set(ids);
	const lines = ["erDiagram"];
	for (const node of graph.nodes) {
		if (!idSet.has(node.id)) continue;
		lines.push(`  ${label(node.id)} {`);
		lines.push("    string group");
		lines.push(`    string blurb "${label((node.blurbZh ?? node.blurb).slice(0, 40))}"`);
		lines.push("  }");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const edge of graph.edges) {
		if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
		const key = `${edge.from}>${edge.to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(`  ${label(edge.from)} ||--o{ ${label(edge.to)} : imports`);
	}
	return lines.join("\n");
}
//#endregion
//#region packages/arch-lens-backend/src/llm-stats.ts
const MAX_RECORDS = 10;
const records = [];
/** Running totals over EVERY recorded call (records list is capped). */
let totalCalls = 0;
let totalInTokens = 0;
let totalOutTokens = 0;
let totalUsageInTokens = 0;
let totalUsageOutTokens = 0;
let totalMs = 0;
/**
* Estimate the token count of a text from its character mix:
* ASCII ≈ 4 chars/token, non-ASCII (CJK…) ≈ 1.5 chars/token.
* @param text - the text to estimate.
* @returns the estimated token count.
*/
function estimateTokens(text) {
	let ascii = 0;
	let other = 0;
	for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) < 128) ascii += 1;
	else other += 1;
	return Math.ceil(ascii / 4 + other / 1.5);
}
/**
* Normalize a provider `usage` chunk (dsh-llm TokenUsage) into the compact
* record shape. Billed input = uncached input + cache-read + cache-write;
* output stays the completion count; reasoning is reported separately.
* @param usage - the raw stream usage chunk, or undefined.
* @returns the normalized record, or undefined when absent.
*/
function normalizeUsage(usage) {
	if (usage === void 0) return void 0;
	const record = {
		inTokens: usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
		outTokens: usage.outputTokens
	};
	if (usage.cacheReadTokens !== void 0) record.cacheReadTokens = usage.cacheReadTokens;
	if (usage.cacheWriteTokens !== void 0) record.cacheWriteTokens = usage.cacheWriteTokens;
	if (usage.reasoningTokens !== void 0) record.reasoningTokens = usage.reasoningTokens;
	return record;
}
/**
* Record one model call in memory (newest first, capped).
* @param kind - call site kind (see {@link LlmCallRecord.kind}).
* @param prompt - the full prompt text (input side).
* @param output - the full model output text.
* @param ms - wall time of the call.
* @param usage - provider-reported usage, when the stream emitted one.
* @param label - optional human-readable label (session-driven calls).
*/
function recordLlmCall(kind, prompt, output, ms, usage, label) {
	totalCalls += 1;
	totalInTokens += estimateTokens(prompt);
	totalOutTokens += estimateTokens(output);
	if (usage !== void 0) {
		totalUsageInTokens += usage.inTokens;
		totalUsageOutTokens += usage.outTokens;
	}
	totalMs += ms;
	const record = {
		kind,
		at: Date.now(),
		inChars: prompt.length,
		outChars: output.length,
		estInTokens: estimateTokens(prompt),
		estOutTokens: estimateTokens(output),
		ms
	};
	if (label !== void 0) record.label = label;
	if (usage !== void 0) record.usage = usage;
	records.unshift(record);
	if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
}
/**
* Fold a persisted snapshot into the running accounting so totals and the
* newest records SURVIVE a host restart. The disk file IS the historical
* ledger: adoption folds it in ADDITIVELY and happens exactly ONCE per
* process (`adopted` gate — a process that already recorded calls must still
* gain its workspace's past totals, and repeated adoption from the panel's
* refresh loop must never double-count). Records merge newest-first, capped.
* @param disk - the snapshot previously persisted to disk, or null.
*/
let adopted = false;
function hydrateLlmStats(disk) {
	if (adopted || disk === null || disk === void 0) return;
	adopted = true;
	totalCalls += disk.totalCalls;
	totalInTokens += disk.totalInTokens;
	totalOutTokens += disk.totalOutTokens;
	totalUsageInTokens += disk.totalUsageInTokens;
	totalUsageOutTokens += disk.totalUsageOutTokens;
	totalMs += disk.totalMs;
	if (Array.isArray(disk.records)) {
		records.push(...disk.records.slice(0, MAX_RECORDS));
		if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
	}
}
/** Whether the persisted ledger has already been adopted this process. */
function llmStatsAdopted() {
	return adopted;
}
/**
* Current in-memory accounting (newest first). Totals cover every recorded
* call, not just the capped records list.
* @returns the snapshot.
*/
function llmStatsSnapshot() {
	return {
		totalCalls,
		totalInTokens,
		totalOutTokens,
		totalUsageInTokens,
		totalUsageOutTokens,
		totalMs,
		records: [...records]
	};
}
//#endregion
//#region packages/arch-lens-backend/src/abort.ts
const controllers = /* @__PURE__ */ new Map();
const slots = /* @__PURE__ */ new WeakMap();
const waiters = /* @__PURE__ */ new Map();
/** Push throttle: at most one waiter wakeup per this interval per signal
* (the provider streams per-token; the panel needs a smooth cadence, not
* every delta). */
const NOTIFY_MIN_INTERVAL_MS = 150;
/** Default long-poll hold: how long a status request waits for a change
* before returning the current snapshot (client re-issues immediately). */
const STATUS_POLL_TIMEOUT_MS = 2e4;
/**
* The active abort signal for one workspace root (created on first use;
* a fresh controller is allocated after a previous abort).
* @param root - absolute workspace root.
* @returns the live AbortSignal.
*/
function generationSignal(root) {
	const existing = controllers.get(root);
	if (existing !== void 0 && !existing.signal.aborted) return existing.signal;
	const next = new AbortController();
	controllers.set(root, next);
	return next.signal;
}
/**
* Abort every in-flight generation for one workspace root.
* @param root - absolute workspace root.
* @returns whether an active controller was aborted.
*/
function abortGeneration(root) {
	const existing = controllers.get(root);
	if (existing === void 0) return false;
	existing.abort();
	return true;
}
/** Sentinel error message for aborted generations (callers surface it as-is). */
const ABORTED_MESSAGE = "generation aborted";
/** The status slot attached to one root's live signal (created on demand). */
function slotFor(signal) {
	let slot = slots.get(signal);
	if (slot === void 0) {
		slot = {
			startedAt: Date.now(),
			seq: 0,
			lastNotify: 0,
			status: {
				active: false,
				stage: "",
				elapsedMs: 0,
				outputChars: 0,
				preview: "",
				seq: 0
			}
		};
		slots.set(signal, slot);
	}
	return slot;
}
/** Wake the signal's long-poll waiters (throttled to the push cadence). */
function notify(signal) {
	const slot = slots.get(signal);
	if (slot === void 0) return;
	const now = Date.now();
	if (now - slot.lastNotify < NOTIFY_MIN_INTERVAL_MS) return;
	slot.lastNotify = now;
	const list = waiters.get(signal);
	if (list === void 0) return;
	for (const waiter of [...list]) waiter();
}
/**
* Mark a generation as active for the given signal (a new LLM call started).
* @param signal - the root's generation signal (optional callers skip status).
* @param stage - human stage label (e.g. `LLM：analysis-figures`).
*/
function beginGenerationStage(signal, stage) {
	if (signal === void 0) return;
	const slot = slotFor(signal);
	slot.startedAt = Date.now();
	slot.seq += 1;
	slot.status = {
		active: true,
		stage,
		elapsedMs: 0,
		outputChars: 0,
		preview: "",
		seq: slot.seq
	};
	notify(signal);
}
/**
* Update the live status while a generation streams.
* @param signal - the root's generation signal.
* @param outputChars - accumulated output characters of the current call.
* @param preview - the preview tail (reasoning tail while thinking, else text).
*/
function reportGeneration(signal, outputChars, preview) {
	if (signal === void 0) return;
	const slot = slotFor(signal);
	slot.seq += 1;
	slot.status = {
		...slot.status,
		active: true,
		elapsedMs: Date.now() - slot.startedAt,
		outputChars,
		preview: preview.slice(-300),
		seq: slot.seq
	};
	notify(signal);
}
/** Mark the current generation finished (active=false keeps the last label). */
function endGenerationStage(signal) {
	if (signal === void 0) return;
	const slot = slotFor(signal);
	slot.seq += 1;
	slot.status = {
		...slot.status,
		active: false,
		elapsedMs: Date.now() - slot.startedAt,
		seq: slot.seq
	};
	notify(signal);
}
/** Tail helper for streaming callers: keep the last PREVIEW_MAX chars. */
function tailPreview(accumulated, delta) {
	return `${accumulated}${delta}`.slice(-300);
}
/**
* The current live generation status of one workspace root (null when no
* signal was ever created — nothing generated yet).
* @param root - absolute workspace root.
* @returns the status, or null.
*/
function currentGenerationStatus(root) {
	const controller = controllers.get(root);
	if (controller === void 0) return null;
	const slot = slots.get(controller.signal);
	return slot === void 0 ? null : slot.status;
}
/**
* LONG-POLL push: resolve with the status snapshot whose seq differs from
* `since` — immediately when one already exists, otherwise when the next
* status mutation arrives (throttled cadence), or after `timeoutMs` with the
* current snapshot (the client re-issues right away, so the only cost is a
* reconnect). One in-flight request at a time = SSE-like delivery inside the
* RPC channel.
* @param root - absolute workspace root.
* @param since - the client's last seen seq.
* @param timeoutMs - max hold before returning the current snapshot.
* @returns `{ status, seq }`, or null when nothing was ever generated.
*/
async function waitForGenerationStatus(root, since, timeoutMs = STATUS_POLL_TIMEOUT_MS) {
	const controller = controllers.get(root);
	if (controller === void 0) return null;
	const signal = controller.signal;
	const slot = slotFor(signal);
	if (slot.seq !== since) return {
		status: slot.status,
		seq: slot.seq
	};
	return await new Promise((resolve) => {
		const onUpdate = () => {
			cleanup();
			resolve({
				status: slot.status,
				seq: slot.seq
			});
		};
		const onTimeout = () => {
			cleanup();
			resolve({
				status: slot.status,
				seq: slot.seq
			});
		};
		const cleanup = () => {
			clearTimeout(timer);
			const list = waiters.get(signal);
			if (list !== void 0) {
				const index = list.indexOf(onUpdate);
				if (index >= 0) list.splice(index, 1);
			}
		};
		const timer = setTimeout(onTimeout, timeoutMs);
		let list = waiters.get(signal);
		if (list === void 0) {
			list = [];
			waiters.set(signal, list);
		}
		list.push(onUpdate);
	});
}
//#endregion
//#region packages/arch-lens-backend/src/docsgen.ts
/** Marker proving a doc file was produced by this tool. */
const DOC_MARK = "<!-- arch-lens generated -->";
/** The only doc target the generator ever writes (overwritten each time). */
const DOC_FILE_AI = "docs/architecture.generated.md";
/** Method-level summary bounds: per-class methods (6), per-package classes
* with methods (6), total call edges (120) — detail without blowup. */
const MAX_SUMMARY_CALLS = 120;
/** Section titles per dimension, used as `##` headings in the doc.
* 'flow' (D2a) renders BOTH registry viewpoints in one section. */
const SECTION_TITLES = {
	concepts: "概念层级",
	flow: "流程图",
	seq: "时序",
	interaction: "核心交互",
	deps: "依赖",
	er: "实体关系",
	catalog: "包目录职责"
};
/** Cache file names for structured figure data (sequence/events). */
const SEQ_CACHE$1 = ".arch-lens-sequence";
const EVENTS_CACHE = ".arch-lens-events";
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName$7(base, language, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/${base}-${safe === "" ? "default" : safe}${methods ? "-methods" : ""}.json`;
}
/**
* The AUTHORITATIVE sequence / interaction cache file names, exported for the
* figure registry (`figures.ts`): consumers must never re-spell cache names.
* @param language - role language.
* @param methods - 🔬 method-level variant.
* @returns the CACHE_DIR-relative cache file name.
*/
function seqCacheName(language, methods = false) {
	return cacheName$7(SEQ_CACHE$1, language, methods);
}
/** See `seqCacheName`. @param language - role language. @param methods - method-level variant. @returns the cache file name. */
function eventsCacheName(language, methods = false) {
	return cacheName$7(EVENTS_CACHE, language, methods);
}
/**
* Resolve the doc target: ALWAYS `docs/architecture.generated.md`.
* `docs/architecture.md` belongs to the user and is never written, whether it
* carries a generated marker or not. Every generation overwrites the AI
* variant (per-section merge for generateDocSection, full rewrite for the
* docbuild.ts assembly chain). Users adopt a generated doc by renaming/copying
* it over `architecture.md` (dropping the "generated" suffix) — the generator
* keeps writing the AI variant afterwards.
* @param fs - filesystem service.
* @param root - workspace root.
* @returns the AI variant display path.
*/
async function resolveDocTarget(fs, root) {
	return (await fs.resolve(DOC_FILE_AI, { cwd: root })).displayPath;
}
/**
* Bounded summary lines of the code index for prompts (shared with flow.ts
* and analysis.ts). Each caller picks only the fields its task needs —
* e.g. core selection never reads edges, so it drops the `deps` field.
* With `methods: true` the summary also lists per-class method names and a
* capped block of real call edges (`from → to（file:line）`) — the fact
* source for method-level figures.
* @param index - code index result.
* @param options - field / package / bound selection.
* @returns the summary lines.
*/
function indexSummary(index, options = {}) {
	const wanted = options.packages === void 0 ? void 0 : new Set(options.packages);
	const depsOn = options.fields?.deps !== false;
	const entitiesOn = options.fields?.entities !== false;
	const entryOn = options.fields?.entryFiles !== false;
	const maxPackages = options.maxPackages ?? 60;
	const maxDeps = options.maxDeps ?? 6;
	const lines = [];
	for (const pkg of index.packages) {
		if (lines.length >= maxPackages) break;
		if (wanted !== void 0 && !wanted.has(pkg.id)) continue;
		const parts = [`- ${pkg.id}（${pkg.language}）`];
		if (depsOn) parts.push(`依赖: ${pkg.deps.slice(0, maxDeps).join(", ") || "无"}`);
		if (entitiesOn) {
			const entities = pkg.entities.filter((e) => e.kind !== "method" && e.kind !== "field").slice(0, 8).map((e) => e.name);
			parts.push(`顶层实体: ${entities.join(", ") || "无"}`);
			if (options.methods === true) {
				const methodLines = [];
				for (const entity of pkg.entities) if (entity.kind === "class" && Array.isArray(entity.children)) {
					const methods = entity.children.filter((child) => child.kind === "method" || child.kind === "function").slice(0, 6).map((child) => child.name);
					if (methods.length > 0) methodLines.push(`${entity.name}{${methods.join(", ")}}`);
					if (methodLines.length >= 6) break;
				}
				if (methodLines.length > 0) parts.push(`方法: ${methodLines.join("；")}`);
			}
		}
		if (entryOn) parts.push(`入口: ${pkg.entryFiles.slice(0, 2).join(", ") || "无"}`);
		lines.push(parts.join("；"));
	}
	if (options.methods === true) {
		const edges = (index.calls ?? []).filter((edge) => edge.from !== void 0 && edge.from !== "").slice(0, MAX_SUMMARY_CALLS).map((edge) => `- ${edge.from} → ${edge.to}（${workspaceRelative(index.root, edge.fromFile)}${edge.line !== void 0 ? `:${edge.line}` : ""}）`);
		if (edges.length > 0) {
			lines.push("");
			lines.push(`真实调用边（方法级，含调用点文件行号；路径相对工作区根 ${index.root}）:`);
			lines.push(...edges);
		}
	}
	return lines.join("\n");
}
/**
* One LLM generation call with the standard config contract (shared with
* flow.ts). The output cap is optional: omitted, the request inherits the
* adapter's Config-owned default maxTokens instead of a local literal.
* Every call is recorded in the LLM usage accounting (see llm-stats.ts).
* An optional AbortSignal cancels the provider stream promptly (the「⏹ 终止」
* button); an aborted call throws `ABORTED_MESSAGE` and is not recorded.
* @param ctx - host context carrying llm and agentDefaultModel services.
* @param prompt - the full prompt text.
* @param temperature - sampling temperature.
* @param maxTokens - optional output cap.
* @param kind - accounting kind for llm-stats.ts.
* @param signal - optional cancellation for this call.
* @returns the model output text.
*/
async function llmText(ctx, prompt, temperature, maxTokens, kind = "llm", signal) {
	const llm = ctx.get("llm");
	const defaultModel = ctx.get("agentDefaultModel");
	if (llm === void 0 || defaultModel === void 0) throw new Error("llm or agentDefaultModel service missing");
	const selection = defaultModel.currentSelection();
	const prepared = await llm.prepareCall({
		provider: selection.provider,
		model: selection.model,
		temperature,
		...maxTokens === void 0 ? {} : { maxTokens }
	}, signal);
	const cfg = prepared.config;
	const started = Date.now();
	let out = "";
	let usage;
	const chunkTypes = /* @__PURE__ */ new Map();
	let finishInfo = "";
	beginGenerationStage(signal, `LLM：${kind}`);
	let textTail = "";
	let reasoningTail = "";
	for await (const chunk of prepared.stream({
		provider: cfg.provider,
		model: cfg.model,
		...cfg.reasoningEffort === void 0 ? {} : { reasoningEffort: cfg.reasoningEffort },
		...cfg.temperature === void 0 ? {} : { temperature: cfg.temperature },
		...cfg.maxTokens === void 0 ? {} : { maxTokens: cfg.maxTokens },
		...cfg.stop === void 0 ? {} : { stop: cfg.stop },
		...signal === void 0 ? {} : { signal },
		messages: [createUserMessage({
			content: [{
				type: "text",
				text: prompt
			}],
			source: { kind: "user" }
		})]
	})) {
		if (signal?.aborted === true) throw new Error(ABORTED_MESSAGE);
		chunkTypes.set(chunk.type, (chunkTypes.get(chunk.type) ?? 0) + 1);
		if (chunk.type === "text-delta") {
			out += chunk.text;
			textTail = tailPreview(textTail, chunk.text);
			reportGeneration(signal, out.length, textTail);
		} else if (chunk.type === "reasoning-delta") {
			reasoningTail = tailPreview(reasoningTail, chunk.text);
			reportGeneration(signal, out.length, `🧠 ${reasoningTail}`);
		}
		if (chunk.type === "usage") usage = chunk.usage;
		if (chunk.type === "finish") {
			finishInfo = JSON.stringify(chunk.reason);
			if (chunk.reason.kind === "error" && chunk.reason.failure !== void 0) {
				endGenerationStage(signal);
				throw new Error(`llm call failed: ${chunk.reason.failure.message}`);
			}
			if (chunk.reason.kind === "aborted") {
				endGenerationStage(signal);
				throw new Error(ABORTED_MESSAGE);
			}
		}
	}
	if (signal?.aborted === true) {
		endGenerationStage(signal);
		throw new Error(ABORTED_MESSAGE);
	}
	endGenerationStage(signal);
	const text = out.trim();
	if (text === "") console.warn(`[arch-lens] llmText returned empty text (provider=${cfg.provider}, model=${cfg.model}, temperature=${cfg.temperature}, maxTokens=${cfg.maxTokens ?? "default"}) chunks=${JSON.stringify([...chunkTypes])} finish=${finishInfo} — output budget may have been fully consumed by reasoning`);
	recordLlmCall(kind, prompt, text, Date.now() - started, normalizeUsage(usage));
	return text;
}
/** Merge one section into the doc: drop EVERY existing section with exactly
* this title, then append the fresh one.
*
* Why a line scan instead of a regex replace: the first attempt replaced only
* the first occurrence (stale copies accumulated), and a regex with an end
* lookahead (`(?=^## |$)`) terminates too early under `m` — `$` matches any
* line end, so the non-greedy body stopped at the first blank line and only
* the heading lines were removed, leaving the content behind. The line scan
* is exact: a `## ` heading switches in/out of the dropped section, every
* other line is kept verbatim. The model also tends to echo the requested
* heading back in its output, so a leading `#+ <title>` line is stripped
* before appending (otherwise every merge leaves an empty twin heading). */
function mergeSection(existing, title, sectionBody) {
	const header = `## ${title}`;
	const block = `${header}\n\n${sectionBody.trim().replace(new RegExp(`^#{1,6}\\s+${title}\\s*\\n+`), "")}\n\n`;
	const kept = [];
	let inTarget = false;
	for (const line of existing.split("\n")) {
		if (/^##\s/.test(line)) inTarget = line.trimEnd() === header;
		if (!inTarget) kept.push(line);
	}
	return kept.join("\n").replace(/\s+$/, "\n\n") + block;
}
/** Write text to the doc target (create with marker when new). Exported for
* the assembly chain in docbuild.ts (the ONLY other doc writer). */
async function writeDoc(fs, targetPath, text, sandboxPolicy) {
	const target = await fs.resolve(targetPath);
	const info = await fs.stat(target).catch(() => void 0);
	const finalTarget = info !== void 0 && info.type === "file" ? target : await fs.resolve(targetPath);
	const existing = info !== void 0 && info.type === "file" ? await fs.readText(finalTarget) : "";
	const body = existing.includes(DOC_MARK) ? existing.replace(DOC_MARK, "").trim() : existing.trim();
	const next = `${DOC_MARK}\n\n${body === "" ? "" : `${body}\n\n`}${text.trim()}\n`;
	await fs.writeText(finalTarget, next, void 0, void 0, sandboxPolicy);
}
/**
* Build the LLM induction prompt for the main-flow sequence figure: the
* project-core main flow, entry → core loop → key capabilities → output.
* The main line is pinned by name: entry packages (with entry files) start
* the flow and the most-imported packages (in-degree over source imports)
* form the core it must pass through. Every from/to must be a real package
* id from the index summary (the anti-fabrication clause), so the figure
* stays code-grounded.
* @param index - code index result.
* @param language - output language.
* @param summary - the summary lines to embed (entity-level by default,
*   method-level when the 🔬 switch is on — callers choose the granularity).
* @returns the prompt text.
*/
function seqInductionPrompt(index, language, summary) {
	const entryIds = index.packages.filter((pkg) => pkg.entryFiles.length > 0).slice(0, 8).map((pkg) => pkg.id);
	const inDegree = /* @__PURE__ */ new Map();
	for (const targets of importEdges(index).values()) for (const target of targets) inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
	const coreIds = [...inDegree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
	const line = entryIds.length > 0 && coreIds.length > 0 ? `主线约束：主线必须从这些入口包之一出发：${entryIds.join("、")}；并必须经过这些被依赖最多的核心包：${coreIds.join("、")}。其余包只能作为主线的前置/后续步骤出现；禁止以客户端 UI 包或测试包作为主线起点。\n` : "";
	return `你是代码时序分析师。根据项目摘要归纳【项目核心】的一次典型主流程的调用顺序。\n输出语言：${language}。\n` + line + `结构要求：从入口包开始 → 核心循环/驱动（被依赖最多的包）→ 关键能力（工具/存储/LLM/会话等）→ 输出/回复结束；共 10-16 条。
硬性约束：每条消息的 "from" / "to" 只能是摘要中列出的包 id；"label" 写短动宾短语或「调用 xxx()」；只依据摘要事实，禁止编造摘要中不存在的包、机制或数据关系。
严格输出 JSON 数组：[{ "from": "...", "to": "...", "label": "..." }]，不要其他内容。\n\n${summary ?? indexSummary(index, { fields: { deps: false } })}`;
}
/**
* Structured figure data for the sequence/interaction tabs, generated by LLM
* from the code index and cached per language.
* @param ctx - host context.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result.
* @param language - role language.
* @param kind - 'seq' or 'interaction'.
* @param sandboxPolicy - session-scoped policy for the cache write.
* @param methodLevel - 🔬 方法级: feed the method-level summary (methods +
*   real call edges with file:line) instead of the entity-level one.
* @returns the parsed structured data, or an error.
*/
async function writeStructuredCache(ctx, fs, root, index, language, kind, sandboxPolicy, methodLevel = false) {
	try {
		const summary = indexSummary(index, {
			fields: { deps: false },
			methods: methodLevel
		});
		const text = await llmText(ctx, kind === "seq" ? seqInductionPrompt(index, language, summary) : `你是代码交互分析师。根据项目摘要归纳这个项目的【核心事件流】。\n输出语言：${language}。\n粒度要求：事件应是项目运作的核心事件流大类（如：事实构建、AI 图生成、缓存读写、进度通知、结果持久化），禁止把每个具体功能/remote 方法/接口拆成独立事件，同类调用合并为一条。\n每条事件必须写明「消费结果」：note 里说明消费者收到该事件/数据后执行什么动作、产生什么可观察效果（如"前端据此刷新时序图缓存"）。\n严格输出 JSON 数组：[{ "event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..." }]（5-8 条），不要其他内容。\n\n${summary}`, .3, void 0, kind === "seq" ? "seq" : "events", generationSignal(root));
		const start = text.indexOf("[");
		const end = text.lastIndexOf("]");
		if (start < 0 || end <= start) return { error: "structured generation returned no JSON array" };
		const parsed = JSON.parse(text.slice(start, end + 1));
		if (!Array.isArray(parsed) || parsed.length === 0) return { error: "structured generation returned an empty array" };
		await writeFigure(fs, root, kind, language, await readFactVersion(fs, root), kind === "seq" ? {
			source: "flow",
			messages: parsed
		} : parsed, {
			methods: methodLevel,
			policy: sandboxPolicy
		});
		return parsed;
	} catch (error) {
		return { error: `structured cache failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
/**
* Read the structured figure cache for a language, if present.
* @param fs - filesystem service.
* @param root - workspace root.
* @param language - role language.
* @param kind - 'seq' or 'interaction'.
* @returns the cached array, or null.
*/
async function readStructuredCache(fs, root, language, kind, methods = false) {
	try {
		const parsed = await readVersionedCache(fs, await fs.resolve(cacheName$7(kind === "seq" ? SEQ_CACHE$1 : EVENTS_CACHE, language, methods), { cwd: root }), await readFactVersion(fs, root));
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
//#endregion
//#region packages/arch-lens-backend/src/flow-angle.ts
/** Short user-facing label per angle (used in prompts and the client UI). */
const FLOW_ANGLE_LABEL = {
	event: "事件驱动",
	pipeline: "数据管道"
};
/** Angle-specific instruction: what story the diagram must tell. */
function flowAngleRule(angle) {
	switch (angle) {
		case "event": return "- flow 采用「事件驱动」视角：节点是事件或触发点（用户操作、系统事件、内部钩子等，按项目实际归纳），边标注触发/消费关系，回答「什么触发了什么」；触发关系的命名沿用项目自身的术语，不要硬套外部词汇；";
		default: return "- flow 采用「数据管道」视角：节点是数据产物（按项目实际流转归纳：输入 → 中间产物 → 最终输出），边标注转换动作（采集/解析/构建/写入/渲染等，按项目实际），回答「数据如何流转」；";
	}
}
/**
* The style bar shared by every angle — structure plus the information
* density of hand-written architecture diagrams: two-line labels (action +
* mechanism), diamond decision nodes with 是/否 branches, stage subgraphs
* with a duty line, and a compact few-shot example the model must match in
* density. The example is a NEUTRAL style template: the model must replace
* its content with the analyzed project's own facts, never copy the stage
* names or node labels.
*/
const FLOW_STYLE_RULES = [
	"- flow 用 subgraph 按【阶段】分组（阶段名按项目的实际运行阶段归纳，如 入口/请求 → 校验/解析 → 处理/调度 → 存储/输出 → 响应/呈现，不要照搬示例阶段名），不要按包分组；每个阶段 2-4 个节点；",
	"- flow 节点总数 ≤ 16；节点用「动作 + 机制」两行标签：`N[\"动作<br/>（机制/对象/依据）\"]`——第一行是做什么，第二行括注机制、关键对象或依据（只能来自摘要），禁止只写裸函数名/类名；",
	"- flow 的分支点用菱形决策节点 `D{\"条件？\"}`，出边必须标「是」/「否」并说明后果（如 `D -->|\"是：命中\"| N`）；",
	"- flow 的 subgraph 标题也用两行：`subgraph s1[\"阶段名<br/>（阶段职责）\"]`；",
	"- flow 每条边必须有动作标签（如 请求/校验/写入/返回 或 是/否，按项目实际动作命名），说明两个节点之间发生了什么；",
	"- flow 边标签只用纯动词短语，禁止半角括号、分号等符号；",
	"- flow 必须是单条主线：有明确开始与结束，无环、无交叉连线，最多一个分支；",
	"- flow 风格参考（只学风格与信息密度，节点/阶段内容必须换成该项目摘要里的事实）：\n```\nflowchart TD\n  subgraph s1[\"入口<br/>（接收与校验）\"]\n    A[\"接收请求<br/>（HTTP 入口）\"]\n    B{\"参数有效？\"}\n  end\n  A -->|\"请求\"| B\n  B -->|\"否：拒绝\"| E[\"返回错误<br/>（错误码）\"]\n  B -->|\"是：处理\"| D[\"业务处理<br/>（服务层）\"]\n  D -->|\"写入\"| F[\"持久化<br/>（存储层）\"]\n  F -->|\"完成\"| G[\"返回响应<br/>（结果体）\"]\n```"
].join("\n");
/**
* The full rule set for one angle: its viewpoint plus the shared style bar.
* Used by the chain induction (flow.ts); the profile figures call
* (analysis.ts) emits the shared style block ONCE for both angles.
*/
function flowAngleRules(angle) {
	return [flowAngleRule(angle), FLOW_STYLE_RULES].join("\n");
}
/**
* Repair mermaid syntax the LLM tends to break: half-width parentheses /
* semicolons inside edge labels (`-->|触发(emit)|`) are rejected by the
* flowchart grammar (parse error at the `(`). They are replaced with their
* full-width forms, preserving the semantics. Applied to every LLM-produced
* flow source (profile figures, chain induction, doc transcodes) and to
* cached/profile reads, so stale caches render again without a rescan.
* @param source - mermaid flowchart source.
* @returns the repaired source.
*/
function sanitizeMermaid(source) {
	return source.replace(/(-\.->|-->|==>)\|([^|\n]*)\|/g, (_all, arrow, label) => {
		return `${arrow}|${label.replace(/[();]/g, (ch) => ch === "(" ? "（" : ch === ")" ? "）" : "；")}|`;
	});
}
//#endregion
//#region packages/arch-lens-backend/src/analysis.ts
/** Flow viewpoints generated together (order = UI order on the flow tab). */
const FLOW_ANGLES = ["event", "pipeline"];
/** Cache file base name; the role language is appended (sanitized). */
const ANALYSIS_FILE_BASE = ".arch-lens-analysis";
/** Caps mirrored from the chain prompts so one profile stays bounded. */
const MAX_ROOT_CONCEPTS = 12;
const MAX_CONCEPT_DEPTH = 3;
const MIN_CORE_IDS = 4;
const MAX_CORE_IDS = 25;
const MAX_SEQ_MESSAGES = 16;
const MAX_EVENTS = 14;
/** Allowed interaction modes (same vocabulary as the events figure). */
const EVENT_MODES = /* @__PURE__ */ new Set([
	"emit",
	"waterfall",
	"parallel",
	"serial"
]);
/** Keep cache file names filesystem-safe. */
function cacheName$6(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/${ANALYSIS_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
}
/** Single-flight: one in-memory generation per root+language. */
const inflight = /* @__PURE__ */ new Map();
/** The latest known profile per root+language (kept in sync with disk; the
* single source the chains and field regenerations read). */
const currentProfiles = /* @__PURE__ */ new Map();
/** Serialized field-level regenerations per root+language (each per-tab AI
* generate mutates the profile; concurrent ones must not interleave). */
const mutations = /* @__PURE__ */ new Map();
/** Drop every in-flight profile and mutation (rescan invalidates the
* analysis layer too). */
function clearAnalysisProfileCache() {
	inflight.clear();
	currentProfiles.clear();
	mutations.clear();
}
/**
* Resolve the shared analysis profile: memory → disk cache → generate
* (single-flight). Returns a profile whose missing fields mean "this chain
* must fall back to its own LLM"; it never throws.
* @param ctx - host context (llm / agentDefaultModel services).
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result (summary source).
* @param language - role language.
* @param sandboxPolicy - session-scoped policy for the cache write.
* @returns the profile (possibly with empty/missing fields).
*/
async function ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy) {
	const key = `${root}\u0000${language}`;
	const current = currentProfiles.get(key);
	if (current !== void 0) return current;
	const existing = inflight.get(key);
	if (existing !== void 0) return existing;
	const promise = resolveProfile(ctx, fs, root, index, language, sandboxPolicy).then((profile) => {
		currentProfiles.set(key, profile);
		return profile;
	});
	inflight.set(key, promise);
	return promise;
}
async function resolveProfile(ctx, fs, root, index, language, sandboxPolicy) {
	const target = await fs.resolve(cacheName$6(language), { cwd: root }).catch(() => null);
	const factsVersion = await readFactVersion(fs, root);
	if (target !== null) {
		const data = await readVersionedCache(fs, target, factsVersion);
		if (data !== null) {
			const cached = profileFromText(JSON.stringify(data));
			if (cached !== null) {
				console.log(`[arch-lens] analysis: served from cache (lang=${language})`);
				return cached;
			}
		}
	}
	console.log("[arch-lens] analysis: generating shared profile (2 serial LLM calls)");
	const structure = await generateStructure(ctx, index, language, {
		core: true,
		concept: true
	}, generationSignal(root));
	const figures = structure.coreIds !== void 0 && structure.coreIds.length >= MIN_CORE_IDS ? await generateFigures(ctx, index, structure.coreIds, language, {
		flow: true,
		seq: true,
		events: true
	}, generationSignal(root)) : null;
	const profile = {
		version: 2,
		generatedAt: Date.now(),
		language,
		coreIds: structure.coreIds ?? [],
		...structure.conceptTree !== void 0 && structure.conceptTree.length > 0 ? { conceptTree: structure.conceptTree } : {},
		...figures?.flow !== void 0 ? { flow: figures.flow } : {},
		...figures?.seqMessages !== void 0 && figures.seqMessages.length > 0 ? { seqMessages: figures.seqMessages } : {},
		...figures?.events !== void 0 && figures.events.length > 0 ? { events: figures.events } : {}
	};
	if (target !== null) {
		await writeVersionedCache(fs, target, profile, factsVersion, sandboxPolicy, index.packages.map((pkg) => pkg.id));
		console.log("[arch-lens] analysis: profile cached");
	}
	return profile;
}
/** Parse a persisted profile, validating only what readers rely on. */
function profileFromText(text) {
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null) return null;
		if (parsed.version !== 2) return null;
		if (!Array.isArray(parsed.coreIds)) return null;
		return parsed;
	} catch {
		return null;
	}
}
/** Pull the outermost JSON object out of a model answer, tolerating prose. */
function parseProfileObject(text) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const parsed = JSON.parse(text.slice(start, end + 1));
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}
/**
* Validate and bound an LLM id list against the indexed packages:
* strings only, must exist in the index, deduplicated, capped at 25.
* Mirrors core.ts `validateIds` so the profile's coreIds obey the same rule.
* @param index - code index result.
* @param raw - the raw `coreIds` field of a model answer.
* @returns the sanitized id list.
*/
function sanitizeCoreIds(index, raw) {
	if (!Array.isArray(raw)) return [];
	const known = new Set(index.packages.map((pkg) => pkg.id));
	const ids = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		if (!known.has(item)) continue;
		if (ids.includes(item)) continue;
		ids.push(item);
		if (ids.length >= MAX_CORE_IDS) break;
	}
	return ids;
}
/**
* Build concept-tree nodes from a raw model array: names required (trimmed),
* bounded text, depth ≤3, at most 12 roots. Nodes carry source:'flow' like
* the chain-own induction fallback.
* @param raw - raw `conceptTree` field of a model answer.
* @param idPrefix - node id prefix (unique per profile).
* @returns the sanitized tree (possibly empty).
*/
function buildProfileConceptTree(raw, idPrefix) {
	return buildTree(raw, idPrefix, 0);
}
function buildTree(raw, idPrefix, depth) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (let i = 0; i < raw.length; i += 1) {
		const item = raw[i];
		if (typeof item !== "object" || item === null) continue;
		const record = item;
		if (typeof record.name !== "string" || record.name.trim() === "") continue;
		const node = {
			id: `${idPrefix}-${depth}-${i}`,
			name: record.name.trim().slice(0, 60),
			desc: typeof record.desc === "string" ? record.desc.slice(0, 220) : "",
			source: "flow"
		};
		if (typeof record.inside === "string" && record.inside !== "") node.inside = record.inside.slice(0, 400);
		if (depth < MAX_CONCEPT_DEPTH - 1 && Array.isArray(record.children)) {
			const children = buildTree(record.children, `${idPrefix}-${depth}-${i}`, depth + 1);
			if (children.length > 0) node.children = children;
		}
		out.push(node);
		if (out.length >= MAX_ROOT_CONCEPTS) break;
	}
	return out;
}
/** Extract a mermaid flowchart from raw text (fenced or bare), like flow.ts,
* then repair syntax the model tends to break (see sanitizeMermaid). */
function extractMermaidLocal(out) {
	const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
	if (fenced !== null) return sanitizeMermaid(fenced[1].trim());
	const idx = out.search(/\b(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/);
	if (idx < 0) return "";
	return sanitizeMermaid(out.slice(idx).trim().replace(/```\s*$/, "").trim());
}
/**
* Sanitize a raw flow object: mermaid source required (cleaned), title
* bounded with a neutral default. The generation viewpoint is stamped from
* the caller (the model never chooses it).
* @param raw - raw `flow.<angle>` field of a model answer.
* @param angle - the requested generation viewpoint.
* @returns the sanitized flow, or undefined.
*/
function sanitizeFlow(raw, angle) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const record = raw;
	if (typeof record.mermaid !== "string") return void 0;
	const mermaid = extractMermaidLocal(record.mermaid);
	if (mermaid === "") return void 0;
	return {
		title: typeof record.title === "string" && record.title.trim() !== "" ? record.title.trim().slice(0, 60) : "核心流程",
		angle,
		mermaid
	};
}
/**
* Sanitize raw sequence messages: strings only, from/to must be core ids,
* no self-loops, label bounded, capped at 16.
* @param raw - raw `seqMessages` field of a model answer.
* @param coreIds - the profile's validated core ids (the only legal endpoints).
* @returns the sanitized messages.
*/
function sanitizeSeqMessages(raw, coreIds) {
	if (!Array.isArray(raw)) return [];
	const idSet = new Set(coreIds);
	const out = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const record = item;
		if (typeof record.from !== "string" || typeof record.to !== "string") continue;
		if (!idSet.has(record.from) || !idSet.has(record.to) || record.from === record.to) continue;
		const label = typeof record.label === "string" ? record.label.trim().slice(0, 60) : "";
		if (label === "") continue;
		out.push({
			from: record.from,
			to: record.to,
			label
		});
		if (out.length >= MAX_SEQ_MESSAGES) break;
	}
	return out;
}
/**
* Sanitize raw interaction events: event name required, mode restricted to
* the four cordis dispatch modes, producers/consumers bounded, capped at 14.
* @param raw - raw `events` field of a model answer.
* @returns the sanitized events.
*/
function sanitizeEvents(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const record = item;
		if (typeof record.event !== "string" || record.event.trim() === "") continue;
		const producers = Array.isArray(record.producers) ? record.producers.filter((p) => typeof p === "string").slice(0, 8) : [];
		const consumers = Array.isArray(record.consumers) ? record.consumers.filter((c) => typeof c === "string").slice(0, 8) : [];
		const mode = typeof record.mode === "string" && EVENT_MODES.has(record.mode) ? record.mode : "emit";
		out.push({
			event: record.event.trim().slice(0, 80),
			mode,
			producers,
			consumers,
			note: typeof record.note === "string" ? record.note.slice(0, 200) : ""
		});
		if (out.length >= MAX_EVENTS) break;
	}
	return out;
}
/**
* Call 1 (structure): core ids and/or concept tree from the trimmed summary.
* The caller selects which fields it wants: the full cold-start generation
* wants both; a per-tab regenerate wants exactly one.
* @param ctx - host context.
* @param index - code index result.
* @param language - role language.
* @param want - which structure fields to ask for.
* @param signal - optional cancellation (⏹ 终止).
* @returns the requested fields (absent = the model produced none).
*/
async function generateStructure(ctx, index, language, want, signal) {
	try {
		const items = [];
		if (want.core) items.push("  \"coreIds\": [\"构成项目核心流程的包 id，4-25 个，只能从摘要出现过的 id 中选，不要编造\"]");
		if (want.concept) items.push("  \"conceptTree\": [{ \"name\": \"...\", \"desc\": \"...\", \"inside\": \"...\", \"children\": [] }]");
		const parsed = parseProfileObject(await llmText(ctx, `你是代码架构分析师。以下是某项目的代码索引摘要（包 id / 语言 / 顶层实体 / 入口文件）。\n请完成以下任务，严格输出一个 JSON 对象，不要输出其他内容：\n{\n${items.join(",\n")}\n}\n` + (want.concept ? `conceptTree 要求：归纳项目「是怎么运作的」的运行核心概念（如入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳，不要生搬硬套），组织成层级树，最多 ${MAX_ROOT_CONCEPTS} 个根节点、深度最多 ${MAX_CONCEPT_DEPTH} 层。\n` : "") + `输出语言：${language}。\n\n项目摘要：\n${indexSummary(index, { fields: { deps: false } })}`, .3, void 0, want.core && want.concept ? "analysis-structure" : want.core ? "analysis-core" : "analysis-concept", signal));
		if (parsed === null) return {};
		const result = {};
		if (want.core) {
			const coreIds = sanitizeCoreIds(index, parsed.coreIds);
			if (coreIds.length > 0) result.coreIds = coreIds;
		}
		if (want.concept) {
			const tree = buildProfileConceptTree(parsed.conceptTree, "analysis");
			if (tree.length > 0) result.conceptTree = tree;
		}
		return result;
	} catch (error) {
		console.warn(`[arch-lens] analysis structure failed: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
}
/**
* Call 2 (figures): flow / seq / events over the core-only summary. The
* caller selects which figure fields it wants (full generation = all three;
* a per-tab regenerate = exactly one). The flow figure generates BOTH
* viewpoints (event + pipeline) in this single call — the profile carries
* them as a map, so switching angles never costs another LLM call.
* @param ctx - host context.
* @param index - code index result.
* @param coreIds - the profile's validated core ids (endpoint constraint).
* @param language - role language.
* @param want - which figure fields to ask for.
* @param signal - optional cancellation (⏹ 终止).
* @returns the requested fields (absent = the model produced none).
*/
async function generateFigures(ctx, index, coreIds, language, want, signal) {
	try {
		const items = [];
		if (want.flow) items.push("  \"flow\": { \"event\": { \"title\": \"事件驱动流程标题\", \"mermaid\": \"flowchart TD\\n...\" }, \"pipeline\": { \"title\": \"数据管道流程标题\", \"mermaid\": \"flowchart TD\\n...\" } }");
		if (want.seq) items.push("  \"seqMessages\": [{ \"from\": \"包id\", \"to\": \"包id\", \"label\": \"短动宾短语或 调用 xxx()\" }]");
		if (want.events) items.push("  \"events\": [{ \"event\": \"事件名\", \"mode\": \"emit|waterfall|parallel|serial\", \"producers\": [\"包id\"], \"consumers\": [\"包id\"], \"note\": \"一句话说明\" }]");
		const requirements = [];
		if (want.flow) {
			for (const angle of FLOW_ANGLES) requirements.push(`- flow.${angle}：以「${FLOW_ANGLE_LABEL[angle]}」视角归纳一张可学习的核心流程图，mermaid 字段是完整 flowchart 源码（flowchart TD 开头，不要代码块围栏）；${flowAngleRule(angle)}`);
			requirements.push(FLOW_STYLE_RULES);
			requirements.push("- flow 的 event 与 pipeline 是两张不同的图，不要互相复制内容；");
		}
		if (want.seq) requirements.push("- seqMessages：主线 10-16 条，from/to 只能使用上面列出的包 id，从入口包开始 → 核心循环/驱动 → 关键能力 → 输出/回复结束；");
		if (want.events) requirements.push("- events：核心事件/交互 8-14 条，producers/consumers 也只能使用上面列出的包 id；");
		requirements.push("- 禁止编造摘要中不存在的包、机制或数据关系。");
		const parsed = parseProfileObject(await llmText(ctx, `你是代码架构分析师。以下是某项目核心流程涉及的包（已由结构分析选出）及其顶层实体。\n请基于这些包归纳对应图元，严格输出一个 JSON 对象，不要输出其他内容：\n{\n${items.join(",\n")}\n}\n要求：\n${requirements.join("\n")}\n输出语言：${language}。\n\n核心包摘要：\n${indexSummary(index, {
			packages: coreIds,
			fields: { deps: false }
		})}`, .3, void 0, "analysis-figures", signal));
		if (parsed === null) return {};
		const result = {};
		if (want.flow) {
			const rawFlow = parsed.flow;
			const flows = {};
			if (typeof rawFlow === "object" && rawFlow !== null) {
				const record = rawFlow;
				for (const angle of FLOW_ANGLES) {
					const flow = sanitizeFlow(record[angle], angle);
					if (flow !== void 0) flows[angle] = flow;
				}
			}
			if (Object.keys(flows).length > 0) result.flow = flows;
		}
		if (want.seq) {
			const seqMessages = sanitizeSeqMessages(parsed.seqMessages, coreIds);
			if (seqMessages.length > 0) result.seqMessages = seqMessages;
		}
		if (want.events) {
			const events = sanitizeEvents(parsed.events);
			if (events.length > 0) result.events = events;
		}
		return result;
	} catch (error) {
		console.warn(`[arch-lens] analysis figures failed: ${error instanceof Error ? error.message : String(error)}`);
		return {};
	}
}
/**
* Per-tab "AI generate": regenerate ONE profile field with one trimmed-summary
* LLM call, update the shared profile in memory and on disk, and return it.
* Serialized per root+language so concurrent tab generations never interleave.
*
* Regenerating the core selection INVALIDATES flow/seq/events: their
* endpoints are cross-checked against coreIds, so after a new selection the
* old figures could reference dropped packages. They are cleared and
* re-generated on demand when their tabs are opened.
*
* A field whose regeneration produced nothing throws (the profile keeps its
* previous value — no stale data is frozen in).
* @param ctx - host context.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result.
* @param language - role language.
* @param kind - the profile field to regenerate.
* @param sandboxPolicy - session-scoped policy for the cache write.
* @returns the updated profile.
*/
async function regenerateProfileField(ctx, fs, root, index, language, kind, sandboxPolicy) {
	const key = `${root}\u0000${language}`;
	const next = (mutations.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
		const updated = { ...await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy) };
		if (kind === "core" || kind === "concept") {
			const structure = await generateStructure(ctx, index, language, {
				core: kind === "core",
				concept: kind === "concept"
			}, generationSignal(root));
			if (kind === "core") {
				const coreIds = structure.coreIds;
				if (coreIds === void 0 || coreIds.length < MIN_CORE_IDS) throw new Error("core regeneration produced too few packages");
				updated.coreIds = coreIds;
				delete updated.flow;
				delete updated.seqMessages;
				delete updated.events;
			} else {
				if (structure.conceptTree === void 0) throw new Error("concept regeneration produced no tree");
				updated.conceptTree = structure.conceptTree;
			}
		} else {
			const figures = await generateFigures(ctx, index, updated.coreIds, language, {
				flow: kind === "flow",
				seq: kind === "seq",
				events: kind === "events"
			}, generationSignal(root));
			if (kind === "flow") {
				if (figures.flow === void 0) throw new Error("flow regeneration produced no diagram");
				updated.flow = figures.flow;
			} else if (kind === "seq") {
				if (figures.seqMessages === void 0) throw new Error("seq regeneration produced no messages");
				updated.seqMessages = figures.seqMessages;
			} else {
				if (figures.events === void 0) throw new Error("events regeneration produced no events");
				updated.events = figures.events;
			}
		}
		updated.generatedAt = Date.now();
		currentProfiles.set(key, updated);
		const target = await fs.resolve(cacheName$6(language), { cwd: root }).catch(() => null);
		if (target !== null) try {
			await fs.writeText(target, JSON.stringify(updated), void 0, void 0, sandboxPolicy);
		} catch {}
		return updated;
	});
	mutations.set(key, next);
	return next;
}
//#endregion
//#region packages/arch-lens-backend/src/concept.ts
/** Cache file base name; the role language is appended (sanitized). */
const CONCEPT_FILE_BASE = ".arch-lens-concept";
/** Candidate architecture-doc files, relative to the workspace root. */
const DOC_CANDIDATES = [
	"docs/architecture.md",
	"docs/architecture.zh.md",
	"ARCHITECTURE.md",
	"docs/ARCHITECTURE.md",
	"docs/design.md",
	"docs/overview.md",
	"README.md"
];
/**
* Language-ordered doc candidates: non-English roles read the zh translation
* first (docs/architecture.zh.md), English keeps the primary doc first.
* @param language - role language ('English' or a non-English default).
* @returns the candidate list in probe order.
*/
function docCandidates(language) {
	if (language === "English") return DOC_CANDIDATES;
	const [primary, zh, ...rest] = DOC_CANDIDATES;
	return [
		zh,
		primary,
		...rest
	];
}
/** Markdown heading levels that become tree depth (shared with flow.ts). */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName$5(language, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/${CONCEPT_FILE_BASE}-${safe === "" ? "default" : safe}${methods ? "-methods" : ""}.json`;
}
/**
* The AUTHORITATIVE concept cache file name, exported for the figure
* registry (`figures.ts`): consumers must never re-spell cache names.
* @param language - role language.
* @param methods - 🔬 method-level variant.
* @returns the CACHE_DIR-relative cache file name.
*/
function conceptCacheName(language, methods = false) {
	return cacheName$5(language, methods);
}
/** Logical-doc cap for the doc set (whitelist hits + followed refs), guarding hub-style READMEs. */
const DOC_SET_LIMIT = 8;
/**
* Verbatim read window every doc chain applies per doc (extractDocTree /
* flow block / sequence section). The ONE source: chains must never re-spell
* the number.
*/
const DOC_READ_BYTES = 262144;
/** Per-hub read window used for link extraction (links past the cap are not followed). */
const LINK_SCAN_BYTES = 65536;
/** Inline markdown link targets (image links `![](...)` are excluded). */
const INLINE_LINK_RE = /(?<!!)\[[^\]]*\]\(\s*<?([^<>()\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
/** Normalize a workspace-relative path for grouping and comparison. */
function normalizeRel(path) {
	const slashed = path.replace(/\\/g, "/").toLowerCase();
	return slashed.startsWith("./") ? slashed.slice(2) : slashed;
}
/**
* Language tag of a normalized path: suffix style (`x.zh.md`) or directory
* style (`zh/x.md`). Only zh/en participate in merging (roles are zh/en).
* @param rel - normalized workspace-relative path.
* @returns 'zh' | 'en' | null (null = untagged primary).
*/
function localeTag(rel) {
	if (/(^|[/.])zh(?:-[a-z]+)?(?=\.|\/)/.test(rel)) return "zh";
	if (/(^|[/.])en(?:-[a-z]+)?(?=\.|\/)/.test(rel)) return "en";
	return null;
}
/** Logical-doc key: the path stripped of zh/en suffix and directory markers. */
function logicalKey(rel) {
	return rel.replace(/\.zh(?:-[a-z]+)?(?=\.)/, "").replace(/\.en(?:-[a-z]+)?(?=\.)/, "").replace(/(^|\/)zh(?:-[a-z]+)?\//, "$1").replace(/(^|\/)en(?:-[a-z]+)?\//, "$1");
}
/** .md link targets of a doc body: #fragments stripped, schemes/anchors/non-md skipped. */
function extractMdLinks(text) {
	const out = [];
	for (const match of text.matchAll(INLINE_LINK_RE)) {
		let target = match[1] ?? "";
		const hash = target.indexOf("#");
		if (hash >= 0) target = target.slice(0, hash);
		try {
			target = decodeURIComponent(target);
		} catch {}
		if (target === "" || target.startsWith("#")) continue;
		if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
		if (!target.toLowerCase().endsWith(".md")) continue;
		out.push(target.startsWith("/") ? target.slice(1) : target);
	}
	return out;
}
/** Join a link target with the linking doc's directory (resolves ./ and ../). */
function joinDocPath(dir, target) {
	const segments = (dir === "" ? [] : dir.split("/")).concat(target.split("/"));
	const stack = [];
	for (const segment of segments) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") stack.pop();
		else stack.push(segment);
	}
	return stack.join("/");
}
/**
* Pick the ONE variant a role reads: Chinese roles prefer zh > primary > en,
* English roles prefer primary > en > zh.
* @param variants - discovered variants of a single logical doc.
* @param language - role language ('English' or a non-English default).
* @returns the chosen variant.
*/
function pickVariant(variants, language) {
	const priority = language === "English" ? [
		null,
		"en",
		"zh"
	] : [
		"zh",
		null,
		"en"
	];
	for (const tag of priority) {
		const index = variants.findIndex((v) => localeTag(v.rel) === tag);
		if (index >= 0) return variants[index];
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
* @returns chosen display paths: hubs first, followed refs in link order.
*/
async function resolveDocSet(fs, root, language) {
	const groups = /* @__PURE__ */ new Map();
	const order = [];
	const add = (displayPath) => {
		const rel = normalizeRel(workspaceRelative(root, displayPath));
		const key = logicalKey(rel);
		let list = groups.get(key);
		if (list === void 0) {
			if (groups.size >= DOC_SET_LIMIT) return;
			list = [];
			groups.set(key, list);
			order.push(key);
		}
		if (!list.some((v) => v.rel === rel)) list.push({
			rel,
			displayPath
		});
	};
	const statFile = async (wsRel) => {
		try {
			const target = await fs.resolve(wsRel, { cwd: root });
			const info = await fs.stat(target);
			return info !== void 0 && info.type === "file" ? target.displayPath : null;
		} catch {
			return null;
		}
	};
	const hubKeys = [];
	for (const candidate of docCandidates(language)) {
		const found = await statFile(candidate);
		if (found === null) continue;
		const key = logicalKey(normalizeRel(workspaceRelative(root, found)));
		if (groups.has(key)) continue;
		add(found);
		hubKeys.push(key);
		if (groups.size >= DOC_SET_LIMIT) break;
	}
	for (const key of hubKeys) {
		if (groups.size >= DOC_SET_LIMIT) break;
		const hub = pickVariant(groups.get(key), language);
		let text = "";
		try {
			text = (await fs.readText(await fs.resolve(hub.displayPath))).slice(0, LINK_SCAN_BYTES);
		} catch {
			continue;
		}
		const dir = hub.rel.slice(0, hub.rel.lastIndexOf("/") + 1);
		for (const target of extractMdLinks(text)) {
			if (groups.size >= DOC_SET_LIMIT) break;
			const found = await statFile(joinDocPath(dir, target));
			if (found !== null) add(found);
		}
	}
	return order.map((key) => pickVariant(groups.get(key), language).displayPath);
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
async function extractDocTree(fs, docPath, root) {
	const info = await fs.stat(await fs.resolve(docPath));
	if (info === void 0 || info.type !== "file") return [];
	const text = (await fs.readText(await fs.resolve(docPath))).slice(0, DOC_READ_BYTES);
	const roots = [];
	const stack = [];
	let currentDesc = "";
	let currentText = [];
	let pendingNode = null;
	let seq = 0;
	const flush = () => {
		if (pendingNode !== null) {
			pendingNode.desc = currentDesc.trim().slice(0, 220);
			const full = currentText.join("\n").trim();
			if (full !== "") pendingNode.sourceText = full.slice(0, 2e3);
			pendingNode = null;
		}
		currentDesc = "";
		currentText = [];
	};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		const heading = HEADING_RE.exec(trimmed);
		if (heading !== null) {
			flush();
			const level = heading[1].length;
			const name = heading[2].trim().replace(/[`*_]/g, "").slice(0, 60);
			const node = {
				id: `doc:${seq}`,
				name,
				desc: "",
				source: "doc",
				ref: `${workspaceRelative(root, docPath)}#${heading[2].trim().replace(/\s+/g, "-")}`
			};
			seq += 1;
			while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
			if (stack.length === 0) roots.push(node);
			else {
				const parent = stack[stack.length - 1].node;
				if (parent.children === void 0) parent.children = [];
				parent.children.push(node);
			}
			stack.push({
				level,
				node
			});
			pendingNode = node;
			continue;
		}
		if (trimmed === "" || trimmed.startsWith("<!--")) {
			if (pendingNode !== null && currentText.length > 0) currentText.push("");
			continue;
		}
		if (pendingNode !== null) {
			const content = trimmed.slice(0, 400);
			currentText.push(content);
			currentDesc += (currentDesc === "" ? "" : " ") + content;
			if (currentDesc.length > 600) currentDesc = currentDesc.slice(0, 600);
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
* @returns the induced tree (empty on failure).
*/
async function generateFromFlow(ctx, index, language, signal, methods = false) {
	const llm = ctx.get("llm");
	const defaultModel = ctx.get("agentDefaultModel");
	if (llm === void 0 || defaultModel === void 0) return [];
	try {
		const selection = defaultModel.currentSelection();
		const prepared = await llm.prepareCall({
			provider: selection.provider,
			model: selection.model,
			temperature: .3
		}, signal);
		const cfg = prepared.config;
		const entryLines = index.packages.filter((pkg) => pkg.entryFiles.length > 0).slice(0, 30).map((pkg) => {
			const base = `- ${pkg.id}（入口：${pkg.entryFiles.slice(0, 3).join(", ")}，依赖：${pkg.deps.slice(0, 3).join(", ") || "无"}`;
			if (!methods) return `${base}）`;
			const methodLines = [];
			for (const entity of pkg.entities) if (entity.kind === "class" && Array.isArray(entity.children)) {
				const names = entity.children.filter((child) => child.kind === "method" || child.kind === "function").slice(0, 6).map((child) => child.name);
				if (names.length > 0) methodLines.push(`${entity.name}{${names.join(", ")}}`);
				if (methodLines.length >= 4) break;
			}
			return `${base}；方法：${methodLines.join("；") || "无"}）`;
		}).join("\n");
		const prompt = `你是代码架构分析师。以下是某项目的包入口与依赖元数据${methods ? "（含类方法，🔬方法级）" : ""}。\n请归纳这个项目「是怎么运作的」：识别运行核心概念（如入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳，不要生搬硬套），组织成概念层级树。\n输出语言：${language}。\n严格输出 JSON 对象数组（最多 12 个根节点，每个节点含 name/desc/inside/children）：[{ "name": "...", "desc": "...", "inside": "...", "children": [] }]，不要输出其他内容。\n\n` + entryLines;
		const started = Date.now();
		let out = "";
		let usage;
		beginGenerationStage(signal, "LLM：concept");
		let textTail = "";
		for await (const chunk of prepared.stream({
			provider: cfg.provider,
			model: cfg.model,
			...cfg.reasoningEffort === void 0 ? {} : { reasoningEffort: cfg.reasoningEffort },
			...cfg.temperature === void 0 ? {} : { temperature: cfg.temperature },
			...cfg.maxTokens === void 0 ? {} : { maxTokens: cfg.maxTokens },
			...cfg.stop === void 0 ? {} : { stop: cfg.stop },
			...signal === void 0 ? {} : { signal },
			messages: [createUserMessage({
				content: [{
					type: "text",
					text: prompt
				}],
				source: { kind: "user" }
			})]
		})) {
			if (signal?.aborted === true) {
				endGenerationStage(signal);
				throw new Error(ABORTED_MESSAGE);
			}
			if (chunk.type === "text-delta") {
				out += chunk.text;
				textTail = tailPreview(textTail, chunk.text);
				reportGeneration(signal, out.length, textTail);
			}
			if (chunk.type === "usage") usage = chunk.usage;
		}
		if (signal?.aborted === true) {
			endGenerationStage(signal);
			throw new Error(ABORTED_MESSAGE);
		}
		endGenerationStage(signal);
		recordLlmCall("concept", prompt, out, Date.now() - started, normalizeUsage(usage));
		const start = out.indexOf("[");
		const end = out.lastIndexOf("]");
		if (start < 0 || end <= start) return [];
		const parsed = JSON.parse(out.slice(start, end + 1));
		const build = (item, idPrefix, depth) => {
			if (typeof item.name !== "string" || item.name === "") return null;
			const node = {
				id: `${idPrefix}-${depth}`,
				name: item.name.slice(0, 60),
				desc: typeof item.desc === "string" ? item.desc.slice(0, 220) : "",
				source: "flow"
			};
			if (typeof item.inside === "string" && item.inside !== "") node.inside = item.inside.slice(0, 400);
			if (Array.isArray(item.children) && depth < 3) {
				const children = item.children.map((child, i) => build(child, `${idPrefix}-${depth}-${i}`, depth + 1)).filter((child) => child !== null);
				if (children.length > 0) node.children = children;
			}
			return node;
		};
		return parsed.map((item, i) => build(item, `flow-${i}`, 0)).filter((node) => node !== null);
	} catch (error) {
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
async function readConceptTree(fs, root, language, methods = false) {
	const cacheTarget = await fs.resolve(cacheName$5(language, methods), { cwd: root }).catch(() => null);
	if (cacheTarget === null) return null;
	const cached = await readVersionedCache(fs, cacheTarget, await readFactVersion(fs, root));
	if (cached !== null) console.log(`[arch-lens] concept: served from cache (read-only, lang=${language})`);
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
async function conceptTree(ctx, fs, root, index, language, force, sandboxPolicy, methods = false) {
	const cacheTarget = await fs.resolve(cacheName$5(language, methods), { cwd: root }).catch(() => null);
	const factsVersion = await readFactVersion(fs, root);
	if (!force && cacheTarget !== null) {
		const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
		if (cached !== null) {
			console.log(`[arch-lens] concept: served from cache (lang=${language})`);
			return cached;
		}
	}
	const writeCache = async (tree) => {
		await writeFigure(fs, root, "concepts", language, factsVersion, tree, {
			index,
			methods,
			policy: sandboxPolicy
		});
	};
	const docSet = await resolveDocSet(fs, root, language);
	for (const docPath of docSet) {
		const tree = await extractDocTree(fs, docPath, root);
		if (isUsableDocTree(tree)) {
			console.log(`[arch-lens] concept: doc chain (${docPath})`);
			await writeCache(tree);
			return tree;
		}
	}
	if (docSet.length > 0) console.log(`[arch-lens] concept: no usable doc tree across ${docSet.length} docs — falling through`);
	if (!methods) {
		const profile = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy);
		if (profile.conceptTree !== void 0 && profile.conceptTree.length > 0) {
			console.log("[arch-lens] concept: shared analysis profile");
			await writeCache(profile.conceptTree);
			return profile.conceptTree;
		}
	}
	console.log(`[arch-lens] concept: no usable doc headings — generating from flow${methods ? " (method-level)" : ""}`);
	const tree = await generateFromFlow(ctx, index, language, generationSignal(root), methods);
	if (tree.length === 0) return { error: "concept generation failed: no doc and LLM flow generation returned nothing" };
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
function isUsableDocTree(tree) {
	if (tree.length >= 2) return true;
	return tree.some((node) => node.children !== void 0 && node.children.length > 0);
}
//#endregion
//#region packages/arch-lens-backend/src/flow.ts
/** Cache file base name; the role language + viewpoint are appended
* (sanitized), so switching angles never reuses another angle's diagram. */
const FLOW_FILE_BASE = ".arch-lens-flow";
/** Fenced-code-block opener; the captured group is the fence language. */
const FENCE_RE = /^```(\S*)\s*$/;
/** Keep cache file names filesystem-safe (language + angle + method level). */
function cacheName$4(language, angle, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/${FLOW_FILE_BASE}-${safe === "" ? "default" : safe}-${angle}${methods ? "-methods" : ""}.json`;
}
/**
* The AUTHORITATIVE flow cache file name, exported for the figure registry
* (`figures.ts`): the old generateAll hand-spelled a different name and
* never matched this file, so flow figures could never be skipped.
* Consumers must never re-spell cache names.
* @param language - role language.
* @param angle - flow viewpoint.
* @param methods - 🔬 method-level variant.
* @returns the CACHE_DIR-relative cache file name.
*/
function flowCacheName(language, angle, methods = false) {
	return cacheName$4(language, angle, methods);
}
/**
* Stage: locate the first flow block in an architecture doc. A fenced
* `mermaid` block whose body starts with `flowchart`/`graph` is returned
* verbatim; a fenced `text`/`txt` block containing `->` arrows is returned as
* pseudo-code for transcoding. The nearest preceding heading becomes the
* source anchor. Pure rule stage — zero LLM, deterministic.
* @param fs - filesystem service.
* @param docPath - display path of the doc.
* @param root - workspace root (refs are workspace-relative).
* @returns the flow block, or null when the doc has none.
*/
async function extractFlowBlock(fs, docPath, root) {
	const info = await fs.stat(await fs.resolve(docPath));
	if (info === void 0 || info.type !== "file") return null;
	const lines = (await fs.readText(await fs.resolve(docPath))).slice(0, DOC_READ_BYTES).split("\n");
	let currentHeading = "";
	let i = 0;
	while (i < lines.length) {
		const trimmed = lines[i].trim();
		const heading = HEADING_RE.exec(trimmed);
		if (heading !== null) currentHeading = heading[2].trim().replace(/[`*_]/g, "").slice(0, 60);
		const fence = FENCE_RE.exec(trimmed);
		if (fence !== null) {
			const lang = fence[1];
			const body = [];
			i += 1;
			while (i < lines.length && !lines[i].trim().startsWith("```")) {
				body.push(lines[i]);
				i += 1;
			}
			if (i < lines.length) i += 1;
			const content = body.join("\n").trim();
			const anchor = `${workspaceRelative(root, docPath)}#${currentHeading === "" ? "top" : currentHeading.replace(/\s+/g, "-")}`;
			const title = currentHeading === "" ? "流程" : currentHeading;
			if ((lang === "mermaid" || lang === "") && /\b(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/.test(content)) return {
				mermaid: content,
				ref: anchor,
				title
			};
			if ((lang === "text" || lang === "txt") && content.includes("->")) return {
				pseudo: content,
				ref: anchor,
				title
			};
			continue;
		}
		i += 1;
	}
	return null;
}
/** Extract mermaid source from an LLM answer (fenced block, or bare source),
* then repair syntax the model tends to break (see sanitizeMermaid). */
function extractMermaid(out) {
	const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
	if (fenced !== null) return sanitizeMermaid(fenced[1].trim());
	const idx = out.search(/\b(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/);
	if (idx < 0) return "";
	return sanitizeMermaid(out.slice(idx).trim().replace(/```\s*$/, "").trim());
}
/**
* Stage: LLM format-transcode of a pseudo-code flow block into a mermaid
* flowchart. Format only — steps, branches, order and semantics are preserved;
* labels keep their original terms. The result stays `source: 'doc'` because
* the evidence is the doc's own text.
* @param ctx - host context.
* @param pseudo - the doc's pseudo-code flow block.
* @param language - role language.
* @param signal - optional cancellation (⏹ 终止).
* @returns mermaid flowchart source ('' on failure).
*/
async function transcodeFlow(ctx, pseudo, language, signal) {
	return extractMermaid(await llmText(ctx, `你是流程图转换器。把下面的流程伪代码块转换成 Mermaid flowchart：
- 只转换表示形式，不增删任何步骤、分支、顺序或语义；
- 节点 label 保留原文术语（不翻译）；分支条件作为边的 label；
- 输出语言：${language}（仅用于必要的中文说明，节点术语保持原文）；\n- 严格只输出 mermaid 源码（flowchart TD 开头），不要代码块围栏，不要任何解释。\n\n流程块：\n${pseudo}`, .2, void 0, "flow-transcode", signal));
}
/**
* Fallback stage: LLM induces a core flow (entity → entity) from the code
* index metadata — the "no doc flow block" path, language-independent.
* The requested viewpoint shapes the diagram: event (trigger/consumer story)
* or pipeline (data-product flow). Result is `source: 'flow'` (non-authoritative).
* @param ctx - host context.
* @param index - code index result.
* @param language - role language.
* @param angle - flow generation viewpoint.
* @param signal - optional cancellation (⏹ 终止).
* @param methods - 🔬 方法级: feed the method-level summary (methods + real
*   call edges with file:line) so labels can cite real functions.
* @returns the induced flow, or null on failure.
*/
async function generateFlowFromCode(ctx, index, language, angle = "event", signal, methods = false) {
	try {
		const out = await llmText(ctx, `你是代码架构分析师。以下是某项目的代码索引摘要（包/依赖/实体/入口${methods ? "/方法/真实调用边" : ""}）。\n请以「${FLOW_ANGLE_LABEL[angle]}」视角归纳一张可学习的核心流程图。\n` + flowAngleRules(angle) + (methods ? `- 已开启🔬方法级：节点第二行尽量引用真实方法名/文件（如 \`N["解析配置<br/>（parseConfig，config.ts:41）"]\`），只使用摘要中列出的方法名与调用边；\n` : "") + `输出语言：${language}。\n严格输出 JSON：{"title": "流程标题", "mermaid": "flowchart TD\\n..."}，mermaid 字段是完整 mermaid flowchart 源码（flowchart TD 开头，不要代码块围栏），不要输出其他内容。\n\n项目摘要：\n${indexSummary(index, {
			fields: { deps: false },
			methods
		})}`, .3, void 0, "flow", signal);
		const start = out.indexOf("{");
		const end = out.lastIndexOf("}");
		if (start < 0 || end <= start) return null;
		const parsed = JSON.parse(out.slice(start, end + 1));
		const mermaid = typeof parsed.mermaid === "string" ? extractMermaid(parsed.mermaid) : "";
		if (mermaid === "") return null;
		return {
			title: typeof parsed.title === "string" && parsed.title !== "" ? parsed.title.slice(0, 60) : "核心流程",
			source: "flow",
			angle,
			mermaid
		};
	} catch (error) {
		console.warn(`[arch-lens] flow induction failed: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}
/**
* READ-ONLY flow diagram: serve the versioned cache when its facts version
* matches; null when absent/stale. NEVER generates (no doc scan, no
* transcode, no profile, no LLM, no cache write) — generation is owned by
* the write paths (AI 生成 / regenerate).
* @param fs - filesystem service.
* @param root - workspace root.
* @param language - role language (cache key).
* @param angle - flow viewpoint (cache key).
* @param methods - 🔬 方法级 cache variant.
* @returns the cached diagram, or null when no matching cache exists.
*/
async function readFlow(fs, root, language, angle = "event", methods = false) {
	const cacheTarget = await fs.resolve(cacheName$4(language, angle, methods), { cwd: root }).catch(() => null);
	if (cacheTarget === null) return null;
	const cached = await readVersionedCache(fs, cacheTarget, await readFactVersion(fs, root));
	if (cached !== null && typeof cached === "object" && typeof cached.mermaid === "string") {
		console.log(`[arch-lens] flow: served from cache (read-only, lang=${language}, angle=${angle})`);
		return {
			...cached,
			mermaid: sanitizeMermaid(cached.mermaid)
		};
	}
	return null;
}
/**
* The full flow chain: cache → doc (verbatim mermaid, else LLM transcode of a
* pseudo-code block) → shared analysis profile → LLM induction from code
* metadata. `force` bypasses the cache and rebuilds the figure's facts.
* WRITE path only: reads happen through readFlow().
* The cache and the induced results are keyed by the requested viewpoint
* (angle); doc flows are angle-independent and win whenever a doc carries a
* flow block (documented authority order is unchanged).
* @param ctx - host context.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result (for the induction fallback).
* @param language - role language.
* @param force - regenerate even when cached.
* @param angle - flow generation viewpoint (default 'event').
* @param sandboxPolicy - session-scoped policy for the cache write.
* @param methods - 🔬 方法级: skip the shared (entity-level) profile and
*   induce from the method-level summary; caches get a `-methods` suffix so
*   entity and method diagrams never collide.
* @returns the flow diagram, or an error result.
*/
async function flowDiagram(ctx, fs, root, index, language, force, angle = "event", sandboxPolicy, methods = false) {
	const cacheTarget = await fs.resolve(cacheName$4(language, angle, methods), { cwd: root }).catch(() => null);
	const factsVersion = await readFactVersion(fs, root);
	if (!force && cacheTarget !== null) {
		const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
		if (cached !== null && typeof cached === "object" && typeof cached.mermaid === "string") {
			console.log(`[arch-lens] flow: served from cache (lang=${language}, angle=${angle})`);
			return {
				...cached,
				mermaid: sanitizeMermaid(cached.mermaid)
			};
		}
	}
	const writeCache = async (result) => {
		await writeFigure(fs, root, angle === "pipeline" ? "flow-pipeline" : "flow-event", language, factsVersion, result, {
			index,
			methods,
			policy: sandboxPolicy
		});
	};
	for (const docPath of await resolveDocSet(fs, root, language)) {
		const block = await extractFlowBlock(fs, docPath, root);
		if (block === null) continue;
		if (block.mermaid !== void 0) {
			const result = {
				title: block.title,
				source: "doc",
				ref: block.ref,
				sourceText: block.mermaid,
				mermaid: block.mermaid
			};
			await writeCache(result);
			return result;
		}
		if (block.pseudo !== void 0) {
			const mermaid = await transcodeFlow(ctx, block.pseudo, language, generationSignal(root));
			if (mermaid !== "") {
				const result = {
					title: block.title,
					source: "doc",
					ref: block.ref,
					sourceText: block.pseudo,
					mermaid
				};
				await writeCache(result);
				return result;
			}
		}
		break;
	}
	if (!methods) {
		const profileFlow = (await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy)).flow?.[angle];
		if (profileFlow !== void 0 && profileFlow.mermaid !== "") {
			console.log(`[arch-lens] flow: shared analysis profile (angle=${angle})`);
			const result = {
				title: profileFlow.title,
				source: "flow",
				angle,
				mermaid: sanitizeMermaid(profileFlow.mermaid)
			};
			await writeCache(result);
			return result;
		}
	}
	console.log(`[arch-lens] flow: no doc flow block — inducing from code metadata (angle=${angle}${methods ? ", method-level" : ""})`);
	const induced = await generateFlowFromCode(ctx, index, language, angle, generationSignal(root), methods);
	if (induced === null) return { error: "flow generation failed: no doc flow block and LLM induction returned nothing" };
	await writeCache(induced);
	return induced;
}
//#endregion
//#region packages/arch-lens-backend/src/core.ts
/** Cache file base name; the role language is appended (sanitized). */
const CORE_FILE_BASE = ".arch-lens-core";
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName$3(language, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/${CORE_FILE_BASE}-${safe === "" ? "default" : safe}${methods ? "-methods" : ""}.json`;
}
/**
* The AUTHORITATIVE core cache file name, exported for the figure registry
* (`figures.ts`): consumers must never re-spell cache names.
* @param language - role language.
* @param methods - 🔬 method-level variant.
* @returns the CACHE_DIR-relative cache file name.
*/
function coreCacheName(language, methods = false) {
	return cacheName$3(language, methods);
}
/** LLM selection bounds: small enough to read, large enough to be a graph. */
const MIN_CORE = 4;
const MAX_CORE = 25;
/** Validate and bound the LLM's id list against the indexed packages. */
function validateIds(index, raw) {
	if (!Array.isArray(raw)) return [];
	const known = new Set(index.packages.map((pkg) => pkg.id));
	const ids = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		if (!known.has(item)) continue;
		if (ids.includes(item)) continue;
		ids.push(item);
		if (ids.length >= MAX_CORE) break;
	}
	return ids;
}
/** Deterministic fallback: entry packages plus their import neighbors (depth 1). */
function fallbackIds(index) {
	const picked = new Set(index.packages.filter((pkg) => pkg.entryFiles.length > 0).map((pkg) => pkg.id));
	const edges = importEdges(index);
	for (const [from, tos] of edges) {
		if (picked.has(from)) for (const to of tos) picked.add(to);
		if (tos.some((to) => picked.has(to))) picked.add(from);
	}
	return [...picked];
}
/** Pull the `{ "core": [...] }` object out of a model answer, tolerating prose. */
function extractCoreJson(text) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return void 0;
	try {
		const parsed = JSON.parse(text.slice(start, end + 1));
		if (typeof parsed !== "object" || parsed === null) return void 0;
		return parsed.core;
	} catch {
		return;
	}
}
/** LLM pick: return the ids the model selects from the index summary. */
async function llmPick(ctx, index, language, signal, methods = false) {
	return validateIds(index, extractCoreJson(await llmText(ctx, `你是代码架构分析师。以下是某项目的代码索引摘要（包 id / 语言 / 顶层实体 / 入口文件${methods ? "/方法/真实调用边" : ""}）。\n请从摘要中选出构成这个项目核心流程的 ${MIN_CORE}-${MAX_CORE} 个核心包 id（如启动、请求处理、主循环涉及的关键包）。\n只能使用摘要中出现的包 id，不要编造。\n输出语言：${language}。\n严格按以下格式输出，不要输出其他内容：\n{"core": ["id1", "id2", ...]}\n\n项目摘要：\n${indexSummary(index, {
		fields: { deps: false },
		methods
	})}`, .3, void 0, "core", signal)));
}
/**
* READ-ONLY core selection: serve the versioned cache when its facts version
* matches; null when absent/stale. NEVER generates (no profile, no LLM pick,
* no deterministic fallback, no cache write) — generation is owned by the
* write paths (AI 生成 / regenerate). D2: 架构概览 has no rule fallback on
* read — facts appear only after a rescan plus the user's generate action.
* @param fs - filesystem service.
* @param root - workspace root.
* @param language - role language (cache key).
* @param methods - 🔬 方法级 cache variant.
* @returns the cached selection, or null when no matching cache exists.
*/
async function readCore(fs, root, language, methods = false) {
	const cacheTarget = await fs.resolve(cacheName$3(language, methods), { cwd: root }).catch(() => null);
	if (cacheTarget === null) return null;
	const cached = await readVersionedCache(fs, cacheTarget, await readFactVersion(fs, root));
	if (cached !== null && typeof cached === "object" && Array.isArray(cached.ids) && (cached.source === "flow" || cached.source === "curated")) {
		console.log(`[arch-lens] core: served from cache (read-only, lang=${language})`);
		return cached;
	}
	return null;
}
/**
* The full core-selection chain: cache → LLM pick (validated) → deterministic
* fallback. `force` bypasses the cache and rebuilds the selection facts.
* WRITE path only: reads happen through readCore().
* @param ctx - host context.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result.
* @param language - role language.
* @param force - regenerate even when cached.
* @returns the core selection, or an error result.
*/
async function coreGraph(ctx, fs, root, index, language, force, sandboxPolicy, methods = false) {
	const cacheTarget = await fs.resolve(cacheName$3(language, methods), { cwd: root }).catch(() => null);
	const factsVersion = await readFactVersion(fs, root);
	if (!force && cacheTarget !== null) {
		const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
		if (cached !== null && typeof cached === "object" && Array.isArray(cached.ids) && (cached.source === "flow" || cached.source === "curated")) {
			console.log(`[arch-lens] core: served from cache (lang=${language}${methods ? ", method-level" : ""})`);
			return cached;
		}
	}
	const writeCache = async (result) => {
		await writeFigure(fs, root, "core", language, factsVersion, result, {
			methods,
			policy: sandboxPolicy
		});
	};
	if (!methods) {
		const profileIds = validateIds(index, (await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy)).coreIds);
		if (profileIds.length >= MIN_CORE) {
			console.log("[arch-lens] core: shared analysis profile");
			const result = {
				ids: profileIds,
				source: "flow"
			};
			await writeCache(result);
			return result;
		}
	}
	let ids = [];
	try {
		ids = await llmPick(ctx, index, language, generationSignal(root), methods);
	} catch (error) {
		console.warn(`[arch-lens] core: LLM pick failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (ids.length >= MIN_CORE) {
		const result = {
			ids,
			source: "flow"
		};
		await writeCache(result);
		return result;
	}
	console.log("[arch-lens] core: LLM pick empty or too small — using deterministic fallback");
	const fallback = fallbackIds(index);
	if (fallback.length === 0) return { error: "core selection failed: no entry packages in the index" };
	return {
		ids: fallback,
		source: "curated",
		ref: "entry packages plus their source-import neighbors"
	};
}
//#endregion
//#region packages/arch-lens-backend/src/sequence.ts
/** Cache file base name for the sequence figure (same file as LLM writes). */
const SEQ_CACHE = ".arch-lens-sequence";
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName$2(base, language, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/${base}-${safe === "" ? "default" : safe}${methods ? "-methods" : ""}.json`;
}
/** Normalize a path for map keys (`\` → `/`, strip `./` segments anywhere). */
function norm(path) {
	return path.replace(/\\/g, "/").replace(/\/\.\//g, "/").replace(/^\.\//, "");
}
/** Whether a source file is a test file: test-directory paths (`tests/`,
* `__tests__/`, `test/`) or test-suffixed names (`*.spec.ts`, `*.test.ts`,
* `*_test.py`). Used to keep fixture-only call edges out of the production
* call graph. */
function isTestFile$1(path) {
	return /(^|\/)(__tests__|tests?)(\/|$)/.test(path) || /\.(spec|test)\.[a-z]+$/i.test(path) || /_test\.py$/i.test(path);
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
function buildSequenceFromCalls(index, language) {
	const calls = index.calls;
	if (calls === void 0 || calls.length === 0) return null;
	const fileToPkg = /* @__PURE__ */ new Map();
	for (const pkg of index.packages) {
		for (const entity of pkg.entities) fileToPkg.set(norm(entity.file), pkg.id);
		for (const imp of pkg.imports) fileToPkg.set(norm(imp.from), pkg.id);
	}
	const fileImports = /* @__PURE__ */ new Map();
	for (const pkg of index.packages) for (const imp of pkg.imports) {
		const list = fileImports.get(norm(imp.from)) ?? [];
		list.push({
			to: imp.to,
			names: imp.names
		});
		fileImports.set(norm(imp.from), list);
	}
	const resolveModule = (spec, fromFile) => {
		if (spec.startsWith("./") || spec.startsWith("../")) {
			const dir = fromFile.slice(0, fromFile.lastIndexOf("/") + 1);
			const candidates = [
				dir + spec,
				`${dir}${spec}.ts`,
				`${dir}${spec}.tsx`,
				`${dir}${spec}.js`,
				`${dir}${spec}/index.ts`,
				`${dir}${spec}/index.tsx`,
				`${dir}${spec}/index.js`
			];
			for (const candidate of candidates) {
				const pkg = fileToPkg.get(norm(candidate));
				if (pkg !== void 0) return pkg;
			}
			return;
		}
		const stripped = spec.replace(/^@[^/]+\//, "");
		const candidates = /* @__PURE__ */ new Set([
			spec,
			stripped,
			spec.split("/").at(-1) ?? spec,
			stripped.replace(/^dsh-/, "")
		]);
		for (const pkg of index.packages) if (candidates.has(pkg.id)) return pkg.id;
	};
	const edges = /* @__PURE__ */ new Map();
	for (const edge of calls) {
		if (isTestFile$1(norm(edge.fromFile))) continue;
		const callerPkg = fileToPkg.get(norm(edge.fromFile));
		if (callerPkg === void 0) continue;
		const imports = fileImports.get(norm(edge.fromFile)) ?? [];
		const binding = edge.root ?? edge.to;
		let module;
		for (const imp of imports) if (imp.names.includes(binding)) {
			module = imp.to;
			break;
		}
		if (module === void 0) continue;
		const calleePkg = resolveModule(module, norm(edge.fromFile));
		if (calleePkg === void 0 || calleePkg === callerPkg) continue;
		const key = `${callerPkg}\u0000${calleePkg}`;
		const existing = edges.get(key);
		if (existing !== void 0) {
			existing.syms.add(edge.to);
			if (existing.file === void 0) existing.file = norm(edge.fromFile);
		} else edges.set(key, {
			to: calleePkg,
			syms: /* @__PURE__ */ new Set([edge.to]),
			file: norm(edge.fromFile)
		});
	}
	if (edges.size === 0) return null;
	const adjacency = /* @__PURE__ */ new Map();
	for (const [key, info] of edges) {
		const [from] = key.split("\0");
		const list = adjacency.get(from) ?? [];
		const edge = {
			to: info.to,
			syms: info.syms
		};
		if (info.file !== void 0) edge.file = info.file;
		list.push(edge);
		adjacency.set(from, list);
	}
	const queue = [];
	for (const pkg of index.packages) if (pkg.entryFiles.length > 0) queue.push(pkg.id);
	if (queue.length === 0) {
		const inDegree = /* @__PURE__ */ new Map();
		for (const [key] of edges) {
			const [, to] = key.split("\0");
			inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
		}
		const sorted = [...index.packages].sort((a, b) => (inDegree.get(b.id) ?? 0) - (inDegree.get(a.id) ?? 0));
		queue.push(...sorted.map((pkg) => pkg.id));
	}
	const messages = [];
	const visited = /* @__PURE__ */ new Set();
	const callVerb = language === "English" ? "calls" : "调用";
	while (queue.length > 0 && messages.length < CODE_MESSAGE_LIMIT) {
		const pkg = queue.shift();
		if (visited.has(pkg)) continue;
		visited.add(pkg);
		for (const edge of adjacency.get(pkg) ?? []) {
			if (messages.length >= CODE_MESSAGE_LIMIT) break;
			const symList = [...edge.syms];
			const shown = symList.slice(0, LABEL_SYMS);
			const more = symList.length - shown.length;
			const label = `${callVerb} ${shown.map((sym) => `${sym}()`).join("、")}${more > 0 ? ` 等 ${symList.length} 个` : ""}`;
			const message = {
				from: pkg,
				to: edge.to,
				label
			};
			if (symList.length > LABEL_SYMS) message.syms = symList.slice(0, SYMS_EVIDENCE);
			if (edge.file !== void 0) message.file = edge.file;
			messages.push(message);
			if (!visited.has(edge.to)) queue.push(edge.to);
		}
	}
	if (messages.length < MIN_MESSAGES) return null;
	return {
		source: "code",
		messages,
		nodes: buildSequenceNodes(index, messages)
	};
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
function buildSequenceFromImports(index, language) {
	const edges = importEdges(index);
	const verb = language === "English" ? "references" : "引用";
	const messages = [];
	for (const pkg of index.packages) {
		const targets = edges.get(pkg.id);
		if (targets === void 0) continue;
		for (const to of targets) {
			messages.push({
				from: pkg.id,
				to,
				label: `${verb} ${to}`
			});
			if (messages.length >= CODE_MESSAGE_LIMIT) break;
		}
		if (messages.length >= CODE_MESSAGE_LIMIT) break;
	}
	if (messages.length < MIN_MESSAGES) return null;
	return {
		source: "code",
		messages,
		nodes: buildSequenceNodes(index, messages)
	};
}
/** Workspace-relative package path: entry file when available, else the
* first source file, else the package directory. Entry files and entity
* files are already workspace-relative in the code index. */
function packagePath(pkg, root) {
	if (pkg === void 0) return "";
	const entry = pkg.entryFiles[0];
	if (entry !== void 0) return entry.replace(/\\/g, "/");
	const firstEntity = pkg.entities.find((entity) => entity.file !== "");
	if (firstEntity !== void 0) return norm(firstEntity.file);
	return norm(pkg.path).replace(norm(root), "").replace(/^\/+/, "");
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
	const inDegree = /* @__PURE__ */ new Map();
	const outDegree = /* @__PURE__ */ new Map();
	for (const message of messages) {
		inDegree.set(message.to, (inDegree.get(message.to) ?? 0) + 1);
		outDegree.set(message.from, (outDegree.get(message.from) ?? 0) + 1);
	}
	const pkgById = new Map(index.packages.map((pkg) => [pkg.id, pkg]));
	const nodes = [];
	const seen = /* @__PURE__ */ new Set();
	const push = (id) => {
		if (seen.has(id)) return;
		seen.add(id);
		const pkg = pkgById.get(id);
		const citedBy = inDegree.get(id) ?? 0;
		const cites = outDegree.get(id) ?? 0;
		const role = citedBy >= HUB_CITED_BY ? "hub" : citedBy === 0 && cites >= ENTRY_CITES ? "entry" : "leaf";
		nodes.push({
			id,
			role,
			citedBy,
			cites,
			path: packagePath(pkg, index.root)
		});
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
function parseSequenceSection(text) {
	const messages = [];
	const aliases = /* @__PURE__ */ new Map();
	const block = /```mermaid\s*\n([\s\S]*?)```/.exec(text);
	const body = block === null ? text : block[1];
	const inDiagram = block !== null;
	const lineRe = /^\s*(?:\d+[.、]\s+)?([^\s:>\-]+)\s*(?:->>|-->>|->|-->|→)\s*([^\s:>\-]+)\s*(?::\s*(.+))?$/;
	for (const raw of body.split("\n")) {
		const line = raw.trim();
		if (line === "" || line.startsWith("```")) continue;
		if (inDiagram) {
			const participant = /^participant\s+([A-Za-z0-9_\-./]+)(?:\s+as\s+(.+))?$/.exec(line);
			if (participant !== null) {
				if (participant[2] !== void 0) aliases.set(participant[1], participant[2].trim());
				continue;
			}
			if (/^(note|activate|deactivate|loop|alt|else|opt|par|end)\b/i.test(line)) continue;
		}
		const match = lineRe.exec(line);
		if (match === null) continue;
		const from = aliases.get(match[1]) ?? match[1];
		const to = aliases.get(match[2]) ?? match[2];
		if (from === to) continue;
		const label = (match[3] ?? "").trim().slice(0, 60);
		messages.push({
			from,
			to,
			label
		});
		if (messages.length >= MESSAGE_LIMIT) break;
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
async function extractSequenceFromDoc(fs, root, language) {
	for (const docPath of await resolveDocSet(fs, root, language)) {
		const target = await fs.resolve(docPath);
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") continue;
		const section = sectionText((await fs.readText(target)).slice(0, DOC_READ_BYTES), "时序");
		if (section === null) continue;
		const messages = parseSequenceSection(section);
		if (messages.length < MIN_MESSAGES) continue;
		return {
			source: "doc",
			messages,
			ref: `${workspaceRelative(root, docPath)}#时序`
		};
	}
	return null;
}
/** Extract the level-2 section with the given title (until the next ≤2 heading). */
function sectionText(text, title) {
	const lines = text.split("\n");
	let start = -1;
	for (let i = 0; i < lines.length; i += 1) {
		const heading = HEADING_RE.exec(lines[i].trim());
		if (heading !== null && heading[1].length === 2 && heading[2].trim() === title) {
			start = i + 1;
			break;
		}
	}
	if (start < 0) return null;
	const out = [];
	for (let i = start; i < lines.length; i += 1) {
		const heading = HEADING_RE.exec(lines[i].trim());
		if (heading !== null && heading[1].length <= 2) break;
		out.push(lines[i]);
	}
	return out.join("\n").trim();
}
/** Read the sequence cache: object format, legacy raw arrays map to 'flow'.
* Method-level results live under a `-methods` suffix so entity and method
* figures never collide. Only a cache written against the CURRENT facts
* version is served (stale → null → regenerate). */
async function readSeqCache(fs, root, language, methods = false) {
	try {
		const data = await readVersionedCache(fs, await fs.resolve(cacheName$2(SEQ_CACHE, language, methods), { cwd: root }), await readFactVersion(fs, root));
		if (data === null) return null;
		const parsed = data;
		if (Array.isArray(parsed)) {
			const messages = parsed;
			if (messages.length === 0) return null;
			return {
				source: "flow",
				messages
			};
		}
		if (typeof parsed === "object" && parsed !== null) {
			const obj = parsed;
			if ((obj.source === "doc" || obj.source === "flow") && Array.isArray(obj.messages) && obj.messages.length > 0) {
				const result = {
					source: obj.source,
					messages: obj.messages
				};
				if (typeof obj.ref === "string" && obj.ref !== "") result.ref = obj.ref;
				return result;
			}
		}
		return null;
	} catch {
		return null;
	}
}
/** Persist a doc-sourced figure so subsequent reads skip the doc scan.
* 统一写入口：时序图依赖图上出现的包（from/to，规则在 figureDeps）。 */
async function writeSeqCache(fs, root, language, result, sandboxPolicy, methods = false) {
	await writeFigure(fs, root, "seq", language, await readFactVersion(fs, root), result, {
		methods,
		policy: sandboxPolicy
	});
}
/**
* READ-ONLY sequence figure: serve the versioned cache when its facts
* version matches; null when absent/stale. NEVER generates (no code-graph
* computation, no doc extraction, no LLM, no cache write) — generation is
* owned by the write paths (AI 生成 / regenerate).
* @param fs - filesystem service.
* @param root - workspace root.
* @param language - role language (cache key).
* @param methods - 🔬 方法级 cache variant.
* @returns the cached figure, or null when no matching cache exists.
*/
async function readSequence(fs, root, language, methods = false) {
	const cached = await readSeqCache(fs, root, language, methods);
	if (cached !== null) console.log(`[arch-lens] sequence: served from cache (read-only, lang=${language})`);
	return cached;
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
* @param force - regenerate even when the versioned cache would hit (the
*   registry's unified force semantic; doc/profile/LLM stages still write).
* @returns the figure, or null when no stage produced usable data.
*/
async function resolveSequence(ctx, fs, root, index, language, sandboxPolicy, prefer = "code", methodLevel = false, force = false) {
	console.log(`[arch-lens] resolveSequence: prefer=${prefer} force=${force} calls=${index.calls?.length ?? 0} packages=${index.packages.length}`);
	if (prefer === "code") {
		const fromCalls = buildSequenceFromCalls(index, language);
		if (fromCalls !== null) {
			console.log(`[arch-lens] resolveSequence: source=code (${fromCalls.messages.length} messages)`);
			return fromCalls;
		}
		const fromImports = buildSequenceFromImports(index, language);
		if (fromImports !== null) {
			console.log(`[arch-lens] resolveSequence: source=code (import references, ${fromImports.messages.length} messages)`);
			return fromImports;
		}
	}
	const cached = force ? null : await readSeqCache(fs, root, language, methodLevel);
	if (cached !== null) {
		console.log(`[arch-lens] resolveSequence: source=${cached.source} (cached${methodLevel ? ", method-level" : ""})`);
		return cached;
	}
	const fromDoc = await extractSequenceFromDoc(fs, root, language);
	if (fromDoc !== null) {
		console.log(`[arch-lens] resolveSequence: source=doc (${fromDoc.messages.length} messages)`);
		await writeSeqCache(fs, root, language, fromDoc, sandboxPolicy, methodLevel);
		return fromDoc;
	}
	if (!methodLevel) {
		const profile = await ensureAnalysisProfile(ctx, fs, root, index, language, sandboxPolicy);
		if (profile.seqMessages !== void 0 && profile.seqMessages.length >= MIN_MESSAGES) {
			const idSet = new Set(profile.coreIds);
			const messages = profile.seqMessages.filter((message) => idSet.has(message.from) && idSet.has(message.to) && message.from !== message.to && message.label !== "");
			if (messages.length >= MIN_MESSAGES) {
				console.log(`[arch-lens] resolveSequence: source=flow (shared profile, ${messages.length} messages)`);
				const result = {
					source: "flow",
					messages
				};
				await writeSeqCache(fs, root, language, result, sandboxPolicy, methodLevel);
				return result;
			}
		}
	}
	console.log(`[arch-lens] resolveSequence: no code/doc data — falling to LLM induction${methodLevel ? " (method-level)" : ""}`);
	const generated = await writeStructuredCache(ctx, fs, root, index, language, "seq", sandboxPolicy, methodLevel);
	if (Array.isArray(generated) && generated.length > 0) return {
		source: "flow",
		messages: generated
	};
	return null;
}
//#endregion
//#region packages/arch-lens-backend/src/figures.ts
/** The ONE entity-level figure list (order = historical generateAll steps). */
const FIGURE_SPECS = [
	{
		id: "concepts",
		cacheName: (language, methods) => conceptCacheName(language, methods === true),
		build: (env, force) => conceptTree(env.ctx, env.fs, env.root, env.index, env.language, force, env.policy)
	},
	{
		id: "flow-event",
		cacheName: (language, methods) => flowCacheName(language, "event", methods === true),
		build: (env, force) => flowDiagram(env.ctx, env.fs, env.root, env.index, env.language, force, "event", env.policy)
	},
	{
		id: "flow-pipeline",
		cacheName: (language, methods) => flowCacheName(language, "pipeline", methods === true),
		build: (env, force) => flowDiagram(env.ctx, env.fs, env.root, env.index, env.language, force, "pipeline", env.policy)
	},
	{
		id: "seq",
		cacheName: (language, methods) => seqCacheName(language, methods === true),
		build: async (env, force) => {
			return await resolveSequence(env.ctx, env.fs, env.root, env.index, env.language, env.policy, "flow", false, force) ?? { error: "sequence chain produced no usable data" };
		}
	},
	{
		id: "interaction",
		cacheName: (language, methods) => eventsCacheName(language, methods === true),
		build: async (env, force) => {
			if (!force) {
				const cached = await readStructuredCache(env.fs, env.root, env.language, "interaction");
				if (cached !== null) return cached;
			}
			const events = (await ensureAnalysisProfile(env.ctx, env.fs, env.root, env.index, env.language, env.policy)).events;
			if (events !== void 0 && events.length > 0) {
				const factsVersion = await readFactVersion(env.fs, env.root);
				await writeFigure(env.fs, env.root, "interaction", env.language, factsVersion, events, {
					index: env.index,
					policy: env.policy
				});
				return events;
			}
			return writeStructuredCache(env.ctx, env.fs, env.root, env.index, env.language, "interaction", env.policy);
		}
	},
	{
		id: "core",
		cacheName: (language, methods) => coreCacheName(language, methods === true),
		build: (env, force) => coreGraph(env.ctx, env.fs, env.root, env.index, env.language, force, env.policy)
	},
	{
		id: "duties",
		cacheName: (language) => summariesCacheName(language),
		build: (env) => summarizeDuties(env.ctx, env.fs, env.root, env.graph, env.language, env.policy)
	}
];
/** Registry lookup by kind (throws on unknown — a programming error). */
function specOrThrow(kind) {
	const spec = FIGURE_SPECS.find((candidate) => candidate.id === kind);
	if (spec === void 0) throw new Error(`unknown figure kind: ${kind}`);
	return spec;
}
/** The AUTHORITATIVE cache file name for one kind. */
function specCacheName(kind, language, methods = false) {
	return specOrThrow(kind).cacheName(language, methods);
}
/** The ONE dependency-package rule for every figure cache write. */
function figureDeps(kind, data, index) {
	const all = index === void 0 ? void 0 : index.packages.map((pkg) => pkg.id);
	switch (kind) {
		case "concepts": return all;
		case "flow-event":
		case "flow-pipeline": return data?.source === "doc" ? [] : all;
		case "seq": {
			const messages = Array.isArray(data) ? data : data?.messages;
			if (!Array.isArray(messages)) return all;
			const ids = messages.flatMap((message) => [message.from, message.to]).filter((id) => typeof id === "string" && id !== "");
			return ids.length > 0 ? [...new Set(ids)] : all;
		}
		case "interaction": {
			const events = Array.isArray(data) ? data : [];
			const ids = [];
			for (const event of events) for (const list of [event?.producers, event?.consumers]) if (Array.isArray(list)) {
				for (const id of list) if (typeof id === "string" && id !== "") ids.push(id);
			}
			return ids.length > 0 ? [...new Set(ids)] : all;
		}
		case "core": {
			const ids = data?.ids;
			return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : all;
		}
		case "duties": return typeof data === "object" && data !== null ? Object.keys(data) : all;
	}
}
/**
* The ONE versioned write entry for every tab figure cache: resolves the
* authoritative file name through the registry and delegates to
* `writeVersionedCache` — a failed write THROWS by design (callers decide
* whether persistence failure is fatal). `factsVersion` is the version read
* AT THE START of the generation (never re-read after the LLM call: facts
* that moved mid-generation must not get stamped as current). `deps` defaults
* to the registry rule (`figureDeps`).
* @param fs - filesystem service.
* @param root - workspace root.
* @param kind - the figure kind (registry key).
* @param language - role language (cache key).
* @param factsVersion - the facts version the data was generated against.
* @param data - the figure payload (chain's canonical shape).
* @param options - index for the deps rule, method-level variant, explicit
*   deps override, session sandbox policy.
*/
async function writeFigure(fs, root, kind, language, factsVersion, data, options = {}) {
	await writeVersionedCache(fs, await fs.resolve(specCacheName(kind, language, options.methods === true), { cwd: root }), data, factsVersion, options.policy, options.deps ?? figureDeps(kind, data, options.index));
}
/**
* Whether a figure cache exists and was written against the CURRENT facts
* version (a versioned envelope with `v === factsVersion`; legacy/corrupt/
* invalidated files and an unknown facts version all read as invalid).
* @param fs - filesystem service.
* @param root - workspace root.
* @param cacheFile - the CACHE_DIR-relative file name from a spec.
* @param factsVersion - the current facts version (0 = unknown ⇒ never valid).
* @returns whether the cached figure may be served.
*/
async function isFigureCacheValid(fs, root, cacheFile, factsVersion) {
	if (factsVersion === 0) return false;
	const target = await fs.resolve(cacheFile, { cwd: root }).catch(() => null);
	if (target === null) return false;
	const raw = await readRawCache(fs, target);
	return raw !== null && raw.v === factsVersion;
}
/**
* READ-ONLY code-index facts: parse the versioned `{ v, data }` envelope of
* `index/.arch-lens-index.json` (written by the codeIndex provider during
* 「↻ 重新扫描」) and refuse anything that is not the CURRENT facts version —
* legacy unversioned files, foreign versions and missing files all return the
* "rescan first" error (same shape as before the envelope existed). No index
* service call, no LLM.
* @param fs - filesystem service.
* @param root - workspace root.
* @returns the current index, or a user-facing error string.
*/
async function readIndexFacts(fs, root) {
	const factsVersion = await readFactVersion(fs, root);
	if (factsVersion === 0) return { error: "尚未建立当前索引，请先点击「↻ 重新扫描」" };
	const target = await fs.resolve(`${CACHE_DIR}/.arch-lens-index.json`, { cwd: root }).catch(() => null);
	if (target === null) return { error: "找不到代码索引缓存，请先点击「↻ 重新扫描」" };
	const envelope = await readRawCache(fs, target);
	if (envelope === null || envelope.v !== factsVersion) return { error: "代码索引与当前事实版本不一致，请先点击「↻ 重新扫描」" };
	const index = envelope.data;
	if (index === void 0 || !Array.isArray(index.packages) || index.packages.length === 0) return { error: "代码索引为空，请先点击「↻ 重新扫描」" };
	return { index };
}
/**
* The generateAll loop shared by「🔁 全量重建」/「⚡ 变动更新」(behavior
* unchanged from the hand-rolled steps): incremental mode skips every figure
* whose cache is valid against the current facts version and force-redraws
* only the missing/stale ones; non-incremental force-redraws everything.
* Every step runs even when one fails; the caller formats `errors`.
* @param env - the figure environment.
* @param incremental - smart-incremental mode (frontend default: true).
* @param specs - the figure list (defaults to the registry; parameterized for tests).
* @returns the rebuilt/skipped ids and collected errors.
*/
async function runEntityFigurePass(env, incremental, specs = FIGURE_SPECS) {
	const factsVersion = incremental ? await readFactVersion(env.fs, env.root) : 0;
	const rebuilt = [];
	const skipped = [];
	const errors = [];
	for (const spec of specs) {
		if (incremental && await isFigureCacheValid(env.fs, env.root, spec.cacheName(env.language), factsVersion)) {
			skipped.push(spec.id);
			continue;
		}
		try {
			const result = await spec.build(env, true);
			if (typeof result === "object" && result !== null && "error" in result) errors.push(`${spec.id}: ${result.error}`);
			else rebuilt.push(spec.id);
		} catch (error) {
			errors.push(`${spec.id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return {
		rebuilt,
		skipped,
		errors
	};
}
//#endregion
//#region packages/arch-lens-backend/src/summarize.ts
/** Cache file base name; the role language is appended (sanitized). */
const SUMMARY_FILE_BASE = ".arch-lens-summaries";
/** Keep cache file names filesystem-safe. */
function cacheName$1(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/${SUMMARY_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
}
/**
* The AUTHORITATIVE duty-summaries cache file name, exported for the figure
* registry (`figures.ts`): consumers must never re-spell cache names.
* @param language - role language.
* @returns the CACHE_DIR-relative cache file name.
*/
function summariesCacheName(language) {
	return cacheName$1(language);
}
/** Pull the JSON object out of a model answer, tolerating extra prose. */
function extractJson$1(text) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	let parsed;
	try {
		parsed = JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const out = {};
	for (const [key, value] of Object.entries(parsed)) if (typeof value === "string" && value.trim() !== "") out[key] = value.trim().slice(0, 200);
	return Object.keys(out).length > 0 ? out : null;
}
/**
* READ-ONLY duty summaries: serve the versioned cache (facts version must
* match); null when absent/stale. NEVER generates — generation is owned by
* the write paths (「🤖 AI 生成」 on the catalog tab).
* @param fs - filesystem service.
* @param root - workspace root.
* @param language - role language (cache key).
* @returns the cached id → summary map (possibly partial), or null when the
*   cache file is missing, stale or corrupt.
*/
async function readDutySummaries(fs, root, language) {
	const target = await fs.resolve(cacheName$1(language), { cwd: root }).catch(() => null);
	if (target === null) return null;
	const cached = await readVersionedCache(fs, target, await readFactVersion(fs, root));
	if (cached !== null) console.log(`[arch-lens] summarize: served from cache (read-only, lang=${language})`);
	return cached;
}
/**
* Generate (or read cached) one-line AI duty summaries for every scanned
* package, in the configured role language.
* @param ctx - host context carrying llm and agentDefaultModel services.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @param graph - scanned graph.
* @param language - role language for the summaries (default '中文').
* @returns id → summary map, or an error result.
*/
async function summarizeDuties(ctx, fs, root, graph, language, sandboxPolicy) {
	const target = await fs.resolve(cacheName$1(language), { cwd: root }).catch(() => null);
	let cached = {};
	if (target !== null) {
		const fromCache = await readVersionedCache(fs, target, await readFactVersion(fs, root));
		if (fromCache !== null) cached = fromCache;
	}
	const missing = graph.nodes.filter((node) => cached[node.id] === void 0 || cached[node.id] === "").map((node) => node.id);
	if (missing.length === 0) {
		console.log(`[arch-lens] summarize: all ${graph.nodes.length} packages cached (lang=${language})`);
		return cached;
	}
	console.log(`[arch-lens] summarize: ${missing.length} missing of ${graph.nodes.length} (lang=${language})`);
	const llm = ctx.get("llm");
	const defaultModel = ctx.get("agentDefaultModel");
	if (llm === void 0 || defaultModel === void 0) {
		console.warn("[arch-lens] summarize unavailable: llm or agentDefaultModel service missing");
		return { error: "summarize unavailable: llm or agentDefaultModel service missing" };
	}
	const selection = defaultModel.currentSelection();
	const BATCH_SIZE = 40;
	const MAX_BATCHES_PER_CALL = 2;
	const missingBatches = [];
	for (let i = 0; i < missing.length; i += BATCH_SIZE) missingBatches.push(missing.slice(i, i + BATCH_SIZE));
	const merged = { ...cached };
	const signal = generationSignal(root);
	for (const batch of missingBatches.slice(0, MAX_BATCHES_PER_CALL)) {
		const lines = graph.nodes.filter((node) => batch.includes(node.id)).map((node) => `- ${node.id}: ${node.blurb}`).join("\n");
		const prompt = `你是代码仓库分析助手。以下是一个代码仓库中 ${batch.length} 个 npm 包的短名与其官方英文描述。\n请为每个包写一行「职责总结」（简洁、准确、用自然语言说明这个包干什么）。\n输出语言：${language}。\n严格输出 JSON 对象（键=包短名，值=一行总结），不要输出任何其他内容：\n\n${lines}`;
		try {
			const prepared = await llm.prepareCall({
				provider: selection.provider,
				model: selection.model,
				temperature: 0
			}, signal);
			const cfg = prepared.config;
			const started = Date.now();
			let out = "";
			let usage;
			beginGenerationStage(signal, "LLM：duties");
			let textTail = "";
			for await (const chunk of prepared.stream({
				provider: cfg.provider,
				model: cfg.model,
				...cfg.reasoningEffort === void 0 ? {} : { reasoningEffort: cfg.reasoningEffort },
				...cfg.temperature === void 0 ? {} : { temperature: cfg.temperature },
				...cfg.maxTokens === void 0 ? {} : { maxTokens: cfg.maxTokens },
				...cfg.stop === void 0 ? {} : { stop: cfg.stop },
				...signal.aborted ? {} : { signal },
				messages: [createUserMessage({
					content: [{
						type: "text",
						text: prompt
					}],
					source: { kind: "user" }
				})]
			})) {
				if (signal.aborted) {
					endGenerationStage(signal);
					throw new Error(ABORTED_MESSAGE);
				}
				if (chunk.type === "text-delta") {
					out += chunk.text;
					textTail = tailPreview(textTail, chunk.text);
					reportGeneration(signal, out.length, textTail);
				}
				if (chunk.type === "usage") usage = chunk.usage;
			}
			if (signal.aborted) {
				endGenerationStage(signal);
				throw new Error(ABORTED_MESSAGE);
			}
			endGenerationStage(signal);
			recordLlmCall("duties", prompt, out, Date.now() - started, normalizeUsage(usage));
			const parsed = extractJson$1(out);
			if (parsed === null) {
				console.warn(`[arch-lens] summarize: batch output had no JSON object (${out.length} chars): ${out.slice(0, 300)}`);
				return { error: "summarize failed: model output did not contain a JSON object" };
			}
			console.log(`[arch-lens] summarize: batch generated ${Object.keys(parsed).length} summaries`);
			Object.assign(merged, parsed);
		} catch (error) {
			console.warn(`[arch-lens] summarize failed: ${error instanceof Error ? error.message : String(error)}`);
			return { error: `summarize failed: ${error instanceof Error ? error.message : String(error)}` };
		}
	}
	await writeFigure(fs, root, "duties", language, await readFactVersion(fs, root), merged, { policy: sandboxPolicy });
	return merged;
}
//#endregion
//#region packages/arch-lens-backend/src/progress.ts
/** Cache file base name; the role language is appended (sanitized). */
const PROGRESS_FILE_BASE = ".arch-lens-progress";
/** Keep cache file names filesystem-safe. */
function cacheName(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/${PROGRESS_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
}
/**
* Component ids already explained: note targets written by the explain
* buttons carry the `组件 <short>` prefix; extract the short name and match
* it against the scanned nodes (id or short). Non-component targets
* (事件/图/进度总结/默认架构讲解) are excluded from the coverage math.
* @param entries - parsed note entries (target labels).
* @param nodes - scanned graph nodes.
* @returns the set of explained node ids.
*/
function askedComponentIds(entries, nodes) {
	const ids = /* @__PURE__ */ new Set();
	for (const entry of entries) {
		const target = entry.target.trim();
		if (!target.startsWith("组件 ")) continue;
		const candidate = target.slice(3).trim();
		for (const node of nodes) if (node.id === candidate || node.short === candidate) ids.add(node.id);
	}
	return ids;
}
/**
* Generate (or read cached) an AI learning-progress summary and append it to
* the note file. The summary contrasts already-explained targets against the
* scanned packages and asks the model for understanding level, gaps, and
* next-step suggestions in the role language.
* @param ctx - host context carrying llm and agentDefaultModel services.
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @param graph - scanned graph.
* @param notesFile - note file name.
* @param language - role language for the summary (default '中文').
* @param force - regenerate even when a cached summary exists.
* @returns the progress result, or an error result.
*/
async function summarizeProgress(ctx, fs, root, graph, notesFile, language, force, sandboxPolicy) {
	const cacheTarget = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null);
	const factsVersion = await readFactVersion(fs, root);
	if (!force && cacheTarget !== null) {
		const cached = await readVersionedCache(fs, cacheTarget, factsVersion);
		if (cached !== null) {
			console.log(`[arch-lens] progress: served from cache (lang=${language})`);
			return {
				...cached,
				fromCache: true
			};
		}
	}
	const notes = await readNotes(fs, root, notesFile);
	if ("error" in notes) return notes;
	const rawTargets = notes.entries.map((entry) => entry.target.trim()).filter(Boolean);
	const askedSet = askedComponentIds(notes.entries, graph.nodes);
	const asked = [...askedSet];
	const allIds = graph.nodes.map((node) => node.id);
	const unasked = allIds.filter((id) => !askedSet.has(id));
	const total = allIds.length;
	const progress = total === 0 ? 0 : Math.round((total - unasked.length) / total * 100);
	const llm = ctx.get("llm");
	const defaultModel = ctx.get("agentDefaultModel");
	if (llm === void 0 || defaultModel === void 0) {
		console.warn("[arch-lens] progress unavailable: llm or agentDefaultModel service missing");
		return { error: "progress unavailable: llm or agentDefaultModel service missing" };
	}
	const selection = defaultModel.currentSelection();
	const askedLines = rawTargets.slice(-15).map((target) => `- ${target}`).join("\n");
	const unaskedLines = unasked.slice(0, 40).map((id) => `- ${id}`).join("\n");
	const prompt = `你是代码仓库学习教练。学习者在用「架构学习台」学习一个代码仓库，已通过 AI 讲解记录如下笔记。
请评估学习者的了解程度，指出还没讲过的重点组件，并给 3-5 条下一步学习建议（按优先级排序）。
输出语言：${language}。\n输出格式：纯文本 Markdown，小标题分段（了解程度评估 / 未覆盖的重点 / 学习建议），不要代码块。\n\n已讲解目标（最近 15 条）：\n${askedLines === "" ? "（暂无）" : askedLines}\n\n尚未提问的组件（最多列 40 个）：\n${unaskedLines === "" ? "（全部已覆盖）" : unaskedLines}\n\n总组件数：${total}，已覆盖 ${progress}%。`;
	const signal = generationSignal(root);
	try {
		const prepared = await llm.prepareCall({
			provider: selection.provider,
			model: selection.model,
			temperature: .3
		}, signal);
		const cfg = prepared.config;
		const started = Date.now();
		let out = "";
		let usage;
		beginGenerationStage(signal, "LLM：progress");
		let textTail = "";
		for await (const chunk of prepared.stream({
			provider: cfg.provider,
			model: cfg.model,
			...cfg.reasoningEffort === void 0 ? {} : { reasoningEffort: cfg.reasoningEffort },
			...cfg.temperature === void 0 ? {} : { temperature: cfg.temperature },
			...cfg.maxTokens === void 0 ? {} : { maxTokens: cfg.maxTokens },
			...cfg.stop === void 0 ? {} : { stop: cfg.stop },
			...signal.aborted ? {} : { signal },
			messages: [createUserMessage({
				content: [{
					type: "text",
					text: prompt
				}],
				source: { kind: "user" }
			})]
		})) {
			if (signal.aborted) {
				endGenerationStage(signal);
				throw new Error(ABORTED_MESSAGE);
			}
			if (chunk.type === "text-delta") {
				out += chunk.text;
				textTail = tailPreview(textTail, chunk.text);
				reportGeneration(signal, out.length, textTail);
			}
			if (chunk.type === "usage") usage = chunk.usage;
		}
		if (signal.aborted) {
			endGenerationStage(signal);
			throw new Error(ABORTED_MESSAGE);
		}
		endGenerationStage(signal);
		recordLlmCall("progress", prompt, out, Date.now() - started, normalizeUsage(usage));
		const summary = out.trim();
		if (summary === "") return { error: "progress failed: model returned an empty summary" };
		console.log(`[arch-lens] progress: generated ${summary.length} chars (lang=${language})`);
		const result = {
			path: notesFile,
			summary,
			asked,
			unasked,
			total,
			progress,
			generatedAt: Date.now()
		};
		if (cacheTarget !== null) try {
			await writeVersionedCache(fs, cacheTarget, result, factsVersion, sandboxPolicy, allIds);
		} catch (error) {
			console.warn(`[arch-lens] progress cache write failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		const appended = await appendNote(fs, root, {
			target: "📊 学习进度总结",
			question: `学习进度（已覆盖 ${progress}%）`,
			answer: summary
		}, notesFile, sandboxPolicy);
		if ("error" in appended) console.warn(`[arch-lens] progress: note append failed: ${appended.error}`);
		return result;
	} catch (error) {
		console.warn(`[arch-lens] progress failed: ${error instanceof Error ? error.message : String(error)}`);
		return { error: `progress failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
/** Parse-only export so the Remote method can report asked/unasked without LLM. */
function progressStats(fs, root, graph, notesFile) {
	return readNotes(fs, root, notesFile).then((notes) => {
		if ("error" in notes) return notes;
		const askedSet = askedComponentIds(notes.entries, graph.nodes);
		const asked = [...askedSet];
		const allIds = graph.nodes.map((node) => node.id);
		const unasked = allIds.filter((id) => !askedSet.has(id));
		const total = allIds.length;
		return {
			asked,
			unasked,
			total,
			progress: total === 0 ? 0 : Math.round((total - unasked.length) / total * 100)
		};
	});
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
//#region packages/arch-lens-backend/src/docbuild.ts
/** Section order of the assembled doc (SECTION_TITLES is the title source). */
const DOC_SECTIONS = [
	"concepts",
	"flow",
	"seq",
	"interaction",
	"deps",
	"er",
	"catalog"
];
/** Registry lookup (throws on unknown id — a programming error). */
function specOf(id) {
	const spec = FIGURE_SPECS.find((candidate) => candidate.id === id);
	if (spec === void 0) throw new Error(`unknown figure id: ${id}`);
	return spec;
}
/** Version-bound read of one figure's cache payload (null = miss/stale). */
async function readFigureData(fs, root, id, language, factsVersion) {
	try {
		return await readVersionedCache(fs, await fs.resolve(specOf(id).cacheName(language), { cwd: root }), factsVersion);
	} catch {
		return null;
	}
}
/**
* The figure a doc section renders FROM: current-cache hit serves instantly
* (zero LLM); a missing/stale figure triggers THAT figure's own rebuild chain
* (`force = false` → the chain re-checks its cache, then doc → profile → LLM
* stages, persisting through the unified write path). This is exactly the
* user-facing semantic「哪个 tab 落后就触发哪个的变动更新；没有 tab 也先建」.
* @returns the figure payload, or `{ error }` when it could not be produced.
*/
async function ensureFigure(env, id) {
	const factsVersion = await readFactVersion(env.fs, env.root);
	const cached = await readFigureData(env.fs, env.root, id, env.language, factsVersion);
	if (cached !== null) return { data: cached };
	const built = await specOf(id).build(env, false);
	if (typeof built === "object" && built !== null && "error" in built) return { error: `${id}: ${built.error}` };
	return { data: await readFigureData(env.fs, env.root, id, env.language, await readFactVersion(env.fs, env.root)) ?? built };
}
/** ```mermaid fence. */
function fence(source) {
	return `\`\`\`mermaid\n${source.trim()}\n\`\`\``;
}
/** Provenance line under a rendered figure (doc = authoritative anchor, flow = AI). */
function sourceNote(source, ref) {
	if (source === "doc") return ref !== void 0 && ref !== "" ? `> 来源：架构文档（${ref}）` : "> 来源：架构文档";
	return "> 来源：AI 归纳（非权威）";
}
/** Optional natural-language figure description (D3 extension point). */
function descriptionNote(data) {
	return data.description !== void 0 && data.description.trim() !== "" ? `\n\n${data.description.trim()}` : "";
}
/** concepts: the hierarchy tree → nested markdown bullets (+doc anchors). */
function renderConcepts(tree) {
	const lines = [];
	const walk = (nodes, depth) => {
		for (const node of nodes) {
			const anchor = node.source === "doc" && node.ref !== void 0 && node.ref !== "" ? `（${node.ref}）` : "";
			const inside = node.inside !== void 0 && node.inside !== "" ? `；内部：${node.inside}` : "";
			lines.push(`${"  ".repeat(depth)}- **${node.name}** — ${node.desc ?? ""}${inside}${anchor}`);
			if (Array.isArray(node.children) && node.children.length > 0) walk(node.children, depth + 1);
		}
	};
	walk(tree, 0);
	return lines.length > 0 ? lines.join("\n") : "（暂无概念层级）";
}
/** flow (D2a): one mermaid block per viewpoint + provenance. */
function renderFlow(event, pipeline) {
	const parts = [];
	for (const [label, figure] of [["事件视角", event], ["管线视角", pipeline]]) {
		if (figure === null || typeof figure.mermaid !== "string" || figure.mermaid === "") continue;
		parts.push(`### ${label}：${figure.title ?? ""}\n\n${fence(figure.mermaid)}\n\n${sourceNote(figure.source, figure.ref)}${descriptionNote(figure)}`);
	}
	return parts.length > 0 ? parts.join("\n\n") : "（暂无流程图）";
}
/** seq: ordered `from → to：label` list + provenance (accepts the legacy
* bare-array cache shape — normalized, disk files are never migrated). */
function renderSeq(figure) {
	const result = Array.isArray(figure) ? {
		source: "flow",
		messages: figure
	} : figure;
	return `${result.messages.map((message, i) => `${i + 1}. \`${message.from}\` → \`${message.to}\`：${message.label}`).join("\n")}\n\n${sourceNote(result.source, result.ref)}${descriptionNote(result)}`;
}
/** interaction: the event table. */
function renderInteraction(events) {
	return `| 事件 | 模式 | 生产者 | 消费者 | 说明 |\n| --- | --- | --- | --- | --- |\n${events.map((event) => `| ${event.event ?? ""} | ${event.mode ?? ""} | ${(event.producers ?? []).join("、")} | ${(event.consumers ?? []).join("、")} | ${event.note ?? ""} |`).join("\n")}`;
}
/** deps: the core subgraph flowchart + its real import edge list (rules, no LLM). */
function renderDeps(core, graph, index) {
	const selected = new Set(core.ids);
	const edges = [];
	for (const [from, targets] of importEdges(index)) {
		if (!selected.has(from)) continue;
		for (const to of new Set(targets)) if (selected.has(to)) edges.push(`- \`${from}\` → \`${to}\``);
		if (edges.length >= 120) break;
	}
	const list = edges.length > 0 ? `\n\n${edges.slice(0, 120).join("\n")}` : "";
	return `${fence(coreFlowchartFromGraph(graph, core.ids))}\n\n核心包：${core.ids.map((id) => `\`${id}\``).join("、")}${list}${descriptionNote(core)}`;
}
/** er (D2b kept): package-level entity-relationship diagram of the core set. */
function renderEr(core, graph) {
	return fence(coreErDiagramFromGraph(graph, core.ids));
}
/** catalog: package duties table. */
function renderCatalog(duties) {
	const rows = Object.entries(duties).map(([id, duty]) => `| \`${id}\` | ${duty} |`);
	return rows.length > 0 ? `| 包 | 职责 |\n| --- | --- |\n${rows.join("\n")}` : "（暂无职责总结）";
}
/**
* One figure (or figure pair) → its doc section body. A figure that could not
* be produced skips its section (error recorded by the caller).
*/
async function renderSection(kind, env, graph) {
	switch (kind) {
		case "concepts": {
			const figure = await ensureFigure(env, "concepts");
			if ("error" in figure) return figure;
			return { body: renderConcepts(figure.data) };
		}
		case "flow": {
			const eventFigure = await ensureFigure(env, "flow-event");
			const pipelineFigure = await ensureFigure(env, "flow-pipeline");
			const event = "error" in eventFigure ? null : eventFigure.data;
			const pipeline = "error" in pipelineFigure ? null : pipelineFigure.data;
			if (event === null && pipeline === null) return { error: `flow: ${"error" in eventFigure ? eventFigure.error : ""}${"error" in pipelineFigure ? ` ${pipelineFigure.error}` : ""}`.trim() };
			return { body: renderFlow(event, pipeline) };
		}
		case "seq": {
			const figure = await ensureFigure(env, "seq");
			if ("error" in figure) return figure;
			return { body: renderSeq(figure.data) };
		}
		case "interaction": {
			const figure = await ensureFigure(env, "interaction");
			if ("error" in figure) return figure;
			return { body: renderInteraction(figure.data) };
		}
		case "deps":
		case "er": {
			const figure = await ensureFigure(env, "core");
			if ("error" in figure) return figure;
			const core = figure.data;
			return { body: kind === "deps" ? renderDeps(core, graph, env.index) : renderEr(core, graph) };
		}
		case "catalog": {
			const figure = await ensureFigure(env, "duties");
			if ("error" in figure) return figure;
			return { body: renderCatalog(figure.data) };
		}
	}
}
/**
* D3 (optional, off by default): ONE batched LLM call writes a natural-language
* description for every object-shaped figure still missing one, then each
* description is read-modify-written back into the SAME versioned envelope
* (original `v` and `deps` preserved — a description must never re-stamp or
* invalidate a figure). Failures are non-fatal: the doc still assembles.
*/
async function describeFigures(env, errors) {
	const factsVersion = await readFactVersion(env.fs, env.root);
	const pending = [];
	for (const id of [
		"flow-event",
		"flow-pipeline",
		"seq",
		"core"
	]) {
		const data = await readFigureData(env.fs, env.root, id, env.language, factsVersion);
		if (data === null || typeof data !== "object" || Array.isArray(data)) continue;
		const figure = data;
		if (typeof figure.description === "string" && figure.description.trim() !== "") continue;
		pending.push({
			id,
			data
		});
	}
	if (pending.length === 0) return;
	const brief = pending.map(({ id, data }) => `- ${id}：${JSON.stringify({
		...data,
		sourceText: void 0
	}).slice(0, 700)}`).join("\n");
	const prompt = `你是代码架构讲解者。下面是同一个项目的几张架构图（mermaid/时序/核心包选择）的原始数据。为每张图各写一句不超过 80 字的说明（description），概括这张图【在讲什么主线】，只依据数据本身，禁止编造。\n输出语言：${env.language}。\n严格输出 JSON 对象：{"<图id>": "<说明>"}，不要其他内容。\n\n图清单：\n${brief}`;
	try {
		const text = await llmText(env.ctx, prompt, .3, void 0, "docs-descriptions", generationSignal(env.root));
		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start < 0 || end <= start) {
			errors.push("descriptions: no JSON object in model output");
			return;
		}
		const parsed = JSON.parse(text.slice(start, end + 1));
		for (const { id } of pending) {
			const note = parsed[id];
			if (typeof note !== "string" || note.trim() === "") continue;
			const target = await env.fs.resolve(specOf(id).cacheName(env.language), { cwd: env.root });
			const raw = await readRawCache(env.fs, target);
			if (raw === null || raw.v !== factsVersion || !Number.isFinite(raw.v) || raw.v <= 0) continue;
			await writeVersionedCache(env.fs, target, {
				...raw.data,
				description: note.trim()
			}, raw.v, env.policy, raw.depsPresent ? raw.deps : void 0);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "generation aborted") throw error;
		errors.push(`descriptions: ${message}`);
	}
}
/**
* The「📄 一键生成文档」core chain (D8): assemble the architecture doc purely
* from the figure caches, rebuilding only figures that are missing/stale
* (through their own chains, unified write path) — zero LLM for the doc body
* itself. Overwrites docs/architecture.generated.md only.
* @param ctx - host context (only figure chains / optional descriptions call LLM).
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index facts.
* @param graph - scanned workspace graph facts (deps/er rendering).
* @param language - role language.
* @param sandboxPolicy - session-scoped policy for cache/doc writes.
* @param options - `withDescriptions`: ONE batched LLM pass fills figure
*   `description` fields first (D3, default off → fully deterministic).
* @returns `{ path, errors }` (per-section errors collected, doc still
*   written with the sections that could render), or one fatal `{ error }`.
*/
async function generateDocsFromFigures(ctx, fs, root, index, graph, language, sandboxPolicy, options = {}) {
	const env = {
		ctx,
		fs,
		root,
		index,
		graph,
		language,
		...sandboxPolicy === void 0 ? {} : { policy: sandboxPolicy }
	};
	const errors = [];
	const sections = [];
	try {
		if (options.withDescriptions === true) await describeFigures(env, errors);
		for (const kind of DOC_SECTIONS) {
			const rendered = await renderSection(kind, env, graph);
			if ("error" in rendered) {
				errors.push(`${kind}: ${rendered.error}`);
				continue;
			}
			sections.push({
				title: SECTION_TITLES[kind],
				body: rendered.body
			});
		}
		if (sections.length === 0) return { error: `doc assembly produced no sections: ${errors.join("; ")}` };
		let body = `# 架构文档\n\n> 由 Arch Lens 从图缓存组装生成（零 LLM 正文；缺失/过期的图先经各自的构建链补齐再组装）。共 ${sections.length} 节。\n`;
		for (const section of sections) body = mergeSection(body, section.title, section.body);
		const targetPath = await resolveDocTarget(fs, root);
		await writeDoc(fs, targetPath, body, sandboxPolicy);
		return {
			path: targetPath,
			errors
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "generation aborted") return { error: message };
		return { error: `doc assembly failed: ${message}` };
	}
}
/**
* Regenerate ONE doc section (per-tab「AI 生成」) from the figure caches:
* ensure the section's figure(s) (missing/stale → that figure's own chain),
* render, merge into docs/architecture.generated.md under its `## 标题`
* (every stale copy of the heading is replaced — same rule as the full doc).
* Zero LLM for the section body itself.
* @returns `{ path }` or `{ error }`.
*/
async function generateDocSection(ctx, fs, root, index, graph, language, kind, sandboxPolicy) {
	const env = {
		ctx,
		fs,
		root,
		index,
		graph,
		language,
		...sandboxPolicy === void 0 ? {} : { policy: sandboxPolicy }
	};
	try {
		const rendered = await renderSection(kind, env, graph);
		if ("error" in rendered) return { error: `doc section failed: ${rendered.error}` };
		const targetPath = await resolveDocTarget(fs, root);
		const target = await fs.resolve(targetPath);
		const info = await fs.stat(target).catch(() => void 0);
		await writeDoc(fs, targetPath, mergeSection(info !== void 0 && info.type === "file" ? await fs.readText(target) : "", SECTION_TITLES[kind], rendered.body), sandboxPolicy);
		return { path: targetPath };
	} catch (error) {
		return { error: `doc section failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
//#endregion
//#region packages/arch-lens-backend/src/manifest.ts
/**
* Workspace file-change detection (增量重建的层 1): a persisted manifest of
* every scanned file — `{ path → { version, size, md5 } }` — lets rescan
* decide whether ANY fact source changed WITHOUT rebuilding everything.
*
* Compare flow (cheap first, precise second):
*   1. stat every file: `FsInfo.version` (inode + size + mtime + ctime) is an
*      opaque freshness token — identical version ⇒ unchanged, no read needed.
*   2. version changed ⇒ read the file and md5 it: identical md5 ⇒ the change
*      was cosmetic (same content, touched mtime) ⇒ still unchanged.
*   3. otherwise (new file, removed file, or content genuinely changed) the
*      workspace counts as CHANGED.
*
* The manifest itself lives under the cache dir (excluded from the walk), so
* its own rewrite never triggers a rebuild. Downsides of a stale manifest are
* benign: a missing/invalid manifest ⇒ "changed" ⇒ one full rebuild.
*
* @module @deepseek-ai/dsh-arch-lens-backend/src/manifest
*/
const MANIFEST_FILE = `${CACHE_DIR}/.arch-lens-file-manifest.json`;
/** Directories excluded from the walk (vendored / VCS / the cache dir). */
const SKIP_DIRS = /* @__PURE__ */ new Set([
	".git",
	"node_modules",
	".dsh",
	"dist",
	"out"
]);
/** Test-suite directory names, excluded by name at ANY depth (nodejs
* `test/` `__tests__/`, python `tests/`, java `src/test/…` all surface as a
* path segment named `test`/`tests`/…). Test code does not shape the
* architecture facts, so its churn must not trigger a rescan rebuild. */
const SKIP_TEST_DIRS = /* @__PURE__ */ new Set([
	"test",
	"tests",
	"__tests__",
	"__mocks__",
	"__snapshots__",
	"spec",
	"specs",
	"testing",
	"testdata",
	"fixtures"
]);
/** Whether a file follows a test-suite naming convention (nodejs / python /
* java). Matched on the file NAME only — `src/test` is already covered by
* the directory rule above. */
function isTestFile(rel) {
	const base = rel.slice(rel.lastIndexOf("/") + 1);
	if (/\.(test|spec)\.(c|m)?[jt]sx?$/.test(base)) return true;
	if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base)) return true;
	if (/(?:Test|Tests|TestCase)\.java$/.test(base)) return true;
	return false;
}
/** Files larger than this are never md5'd (readText would be costly); their
* version token alone decides change. */
const MAX_MD5_BYTES = 2 * 1024 * 1024;
/** Recursively list every file under the workspace root (excluding the skip
* dirs and the cache dir), returning cache-relative paths. */
async function walk(fs, dirTarget, rel, out) {
	let entries;
	try {
		entries = await fs.listDir(dirTarget);
	} catch {
		return;
	}
	for (const entry of entries) {
		const childRel = `${rel}${entry.name}`;
		if (entry.type === "directory") {
			if (SKIP_DIRS.has(entry.name) || SKIP_TEST_DIRS.has(entry.name) || childRel === "index" || childRel.startsWith(`index/`)) continue;
			await walk(fs, entry.target, `${childRel}/`, out);
		} else if (entry.type === "file") {
			if (isTestFile(childRel)) continue;
			out.push({
				rel: childRel,
				target: entry.target
			});
		}
	}
}
/** Read the persisted manifest; null when absent or unreadable. */
async function readManifest(fs, root) {
	try {
		const target = await fs.resolve(MANIFEST_FILE, { cwd: root });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return null;
		const parsed = JSON.parse(await fs.readText(target));
		if (typeof parsed.root !== "string" || typeof parsed.files !== "object" || parsed.files === null) return null;
		return parsed;
	} catch {
		return null;
	}
}
/** Persist the fresh manifest. */
async function writeManifest(fs, root, files, sandboxPolicy) {
	try {
		const manifest = {
			root,
			at: Date.now(),
			files
		};
		const target = await fs.resolve(MANIFEST_FILE, { cwd: root });
		await fs.writeText(target, JSON.stringify(manifest), void 0, void 0, sandboxPolicy);
	} catch {}
}
/**
* Decide whether ANY scanned file changed since the last rescan, and persist
* the fresh manifest. Never throws — a comparison failure counts as changed
* (safe direction: one unnecessary rebuild, never a missed one).
* @param fs - the filesystem service.
* @param root - absolute workspace root.
* @param sandboxPolicy - session policy for the manifest WRITE (reads need
*   none); without it the policy layer rejects the write and the manifest is
*   never persisted, so every rescan rebuilds.
* @returns whether the workspace changed, plus the changed file paths
*   classified by CRUD (for selective AI-cache invalidation).
*/
async function checkWorkspaceChanges(fs, root, sandboxPolicy) {
	const previous = await readManifest(fs, root);
	const walked = [];
	try {
		await walk(fs, await fs.resolve(".", { cwd: root }), "", walked);
	} catch {
		return {
			changed: true,
			added: [],
			modified: [],
			removed: [],
			changedFiles: []
		};
	}
	const previousFiles = previous?.files ?? {};
	const next = {};
	const added = [];
	const modified = [];
	const removed = [];
	let changed = false;
	for (const file of walked) {
		let info;
		try {
			info = await fs.stat(file.target);
		} catch {
			continue;
		}
		if (info === void 0 || info.type !== "file") continue;
		const prev = previousFiles[file.rel];
		if (prev !== void 0 && prev.version === info.version) {
			next[file.rel] = prev;
			continue;
		}
		let md5;
		if (info.size === void 0 || info.size <= MAX_MD5_BYTES) try {
			md5 = createHash("md5").update(await fs.readText(file.target)).digest("hex");
		} catch {
			md5 = void 0;
		}
		if (prev !== void 0 && md5 !== void 0 && prev.md5 === md5) {
			next[file.rel] = {
				...prev,
				version: info.version
			};
			continue;
		}
		changed = true;
		if (prev === void 0) added.push(file.rel);
		else modified.push(file.rel);
		next[file.rel] = {
			version: info.version,
			...info.size === void 0 ? {} : { size: info.size },
			...md5 === void 0 ? {} : { md5 }
		};
	}
	for (const rel of Object.keys(previousFiles)) if (!(rel in next)) {
		changed = true;
		removed.push(rel);
	}
	await writeManifest(fs, root, next, sandboxPolicy);
	return {
		changed,
		added,
		modified,
		removed,
		changedFiles: [
			...added,
			...modified,
			...removed
		]
	};
}
//#endregion
//#region packages/arch-lens-backend/src/change-pack.ts
/**
* Extract the package id from a workspace-relative file path, disambiguating
* the two layouts against the KNOWN package ids: `packages/<pkg>/src/…`
* (flat) vs `packages/<group>/<pkg>/…` (grouped). The first segment is the
* package when it is a known id; otherwise the second segment is — `src/` is
* never a package, so a flat path can never misread as a group layout.
*/
function packageOfRel(rel, known) {
	const m = /^packages\/([^/]+)(?:\/([^/]+))?\//.exec(rel);
	if (m === null) return null;
	const first = m[1];
	const second = m[2];
	if (known.has(first)) return first;
	if (second !== void 0 && known.has(second)) return second;
	return null;
}
/**
* Compute the changed-package set from file changes and the old/new package
* id sets. A package directory name is only counted when it matches a known
* package id (old or new), so non-package paths (docs, root config) never
* produce phantom packages.
*/
function computeChangedPackages(fileChanges, oldIds, newIds) {
	const known = /* @__PURE__ */ new Set([...oldIds, ...newIds]);
	const changedPackages = /* @__PURE__ */ new Set();
	for (const rel of [
		...fileChanges.added,
		...fileChanges.modified,
		...fileChanges.removed
	]) {
		const pkg = packageOfRel(rel, known);
		if (pkg !== null) changedPackages.add(pkg);
	}
	const oldSet = new Set(oldIds);
	const newSet = new Set(newIds);
	const addedPackages = newIds.filter((id) => !oldSet.has(id));
	const removedPackages = oldIds.filter((id) => !newSet.has(id));
	for (const id of addedPackages) changedPackages.add(id);
	for (const id of removedPackages) changedPackages.add(id);
	return {
		added: fileChanges.added,
		modified: fileChanges.modified,
		removed: fileChanges.removed,
		changedPackages: [...changedPackages].sort(),
		addedPackages,
		removedPackages
	};
}
//#endregion
//#region packages/arch-lens-backend/src/session-figure.ts
/**
* Stable djb2 hash → filesystem-safe suffix. The CLIENT keeps a local mirror
* (arch-view.tsx) so hover caches line up between panel and backend.
* @param text - the string to hash.
* @returns a base-36 string of the unsigned 32-bit hash.
*/
function hashString(text) {
	let hash = 5381;
	for (let i = 0; i < text.length; i += 1) hash = (hash << 5) + hash + text.charCodeAt(i) | 0;
	return (hash >>> 0).toString(36);
}
/**
* Serialize one dynamic-figure target into a stable key (the client mirror
* must produce the same string, so the same cache file is hit).
* @param kind - the dynamic figure kind.
* @param target - the hovered element: seq-edge → from/to/label, flow-subgraph → stage.
* @returns the target key (embedded in cache names).
*/
function dynamicTargetKey(kind, target) {
	if (kind === "seq-edge") return `seq:${target.from ?? ""}|${target.to ?? ""}|${target.label ?? ""}`;
	if (kind === "overview") return "overview:all";
	return `flow:${target.stage ?? ""}`;
}
/** Cache file for one dynamic figure: `index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`. */
function dynamicFigureCacheName(kind, targetKey, language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CACHE_DIR}/.arch-lens-dynamic-${kind}-${hashString(targetKey)}-${safe === "" ? "default" : safe}.json`;
}
/** Session figure kind (+ flow viewpoint) → the registry entity id. */
function entityFigureId(kind, angle) {
	if (kind === "flow") return angle === "pipeline" ? "flow-pipeline" : "flow-event";
	return kind;
}
/** The JSON output contract the agent must satisfy (echoes the figId). */
function jsonContract(kind) {
	switch (kind) {
		case "flow": return "{\"figId\": \"<figId>\", \"title\": \"流程标题\", \"mermaid\": \"flowchart TD\\n...\"}";
		case "concepts": return "{\"figId\": \"<figId>\", \"conceptTree\": [{\"name\": \"...\", \"desc\": \"...\", \"inside\": \"...\", \"children\": []}]}";
		case "seq": return "{\"figId\": \"<figId>\", \"seqMessages\": [{\"from\": \"包id\", \"to\": \"包id\", \"label\": \"短动宾短语或 调用 xxx()\"}]}";
		case "interaction": return "{\"figId\": \"<figId>\", \"events\": [{\"event\": \"...\", \"mode\": \"emit|waterfall|parallel|serial\", \"producers\": [\"...\"], \"consumers\": [\"...\"], \"note\": \"...\"}]}";
		default: return "{\"figId\": \"<figId>\", \"core\": [\"包id\", \"包id\"]}";
	}
}
/**
* Build the session message that asks the agent to produce ONE figure.
* The code facts (index summary, entity- or method-level) are embedded so
* the agent is grounded; it MAY read source files with its tools to verify,
* but its final answer must be the strict JSON below (echoing the figId).
* @param kind - the figure kind.
* @param index - code index result (fact source).
* @param language - role language.
* @param figId - unique marker the answer must echo.
* @param angle - flow viewpoint (flow only).
* @param methodLevel - 🔬 method-level summary (methods + call edges).
* @returns the user-message text.
*/
function buildFigurePrompt(kind, index, language, figId, angle, methodLevel = false) {
	const angleRule = kind === "flow" && angle !== void 0 ? flowAngleRule(angle) : "";
	const styleRules = kind === "flow" ? flowAngleRules(angle ?? "event") : "";
	const methodRule = methodLevel ? "- 已开启🔬方法级：节点/消息尽量引用真实方法名与文件（如 `Svc.handle（api.ts:41）`），只使用摘要中列出的方法名与调用边；\n" : "";
	const summary = indexSummary(index, {
		fields: { deps: false },
		methods: methodLevel
	});
	const mission = (() => {
		switch (kind) {
			case "flow": return `请以「${FLOW_ANGLE_LABEL[angle ?? "event"]}」视角生成一张可学习的核心流程图。`;
			case "concepts": return "请归纳这个项目「是怎么运作的」：识别运行核心概念（入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳），组织成概念层级树。";
			case "seq": return "请归纳【项目核心】的一次典型主流程的调用顺序。";
			case "interaction": return "请归纳这个项目的【核心事件流】：事件应是项目运作的核心事件大类（如事实构建、AI 生成、缓存读写、进度通知、结果持久化），不要枚举具体功能/remote 方法；每条事件写明谁生产（producers）、谁消费（consumers）、以及消费结果（消费者收到后执行什么、产生什么效果）。";
			default: return "请从摘要中选出构成这个项目核心流程的 4-25 个核心包 id（启动、请求处理、主循环涉及的关键包）。";
		}
	})();
	return `你是代码架构分析师。请为当前工作区生成一张架构图（这是 Arch Lens 学习台的「🤖 AI 生成」请求，figId=${figId}）。\n你可以使用工作区工具读源码核实事实，但最终回答必须且只能是一个 JSON 对象，格式：${jsonContract(kind)}（把 figId 原样填成 ${figId}），不要输出任何解释、代码块围栏或额外文字。\n` + mission + "\n" + (kind === "flow" ? `${angleRule}\n${styleRules}\n` : "") + (kind === "seq" ? seqInductionPrompt(index, language, summary) : "") + methodRule + (kind !== "seq" ? `输出语言：${language}。\n\n项目摘要：\n${summary}` : "");
}
/**
* Find the answer's JSON object that carries the expected figId. Tolerates
* prose, fenced ```json blocks and multiple JSON candidates (scans the last
* balanced brace groups first).
* @param answer - the assistant's full answer text.
* @param figId - the expected marker.
* @returns the parsed object, or null.
*/
function extractFigureJson(answer, figId) {
	const fenced = /```(?:json)?\s*\n([\s\S]*?)```/g;
	const candidates = [];
	let match;
	while ((match = fenced.exec(answer)) !== null) candidates.push(match[1]);
	candidates.push(answer);
	for (const text of candidates) {
		const parsed = extractBalancedJson(text, figId);
		if (parsed !== null) return parsed;
	}
	return null;
}
/** Accept the JSON object whose figId matches. A whole-text parse is tried
* first (the prompt demands a pure JSON answer — the common shape), then
* every `{` position is scanned from the end with brace balancing (nested
* trees and prose-wrapped objects parse correctly). The cap only bounds
* pathological answers; a real figure answer with a dozen inner objects
* must still reach its outer `{` (regression: the old 8-start cap silently
* skipped the outer object of answers with >8 inner objects). */
function extractBalancedJson(text, figId) {
	const whole = text.trim();
	if (whole.startsWith("{") && whole.endsWith("}")) try {
		const parsed = JSON.parse(whole);
		if (typeof parsed === "object" && parsed !== null && parsed.figId === figId) return parsed;
	} catch {}
	const starts = [];
	for (let i = text.lastIndexOf("{"); i >= 0 && starts.length < 256; i = text.lastIndexOf("{", i - 1)) starts.push(i);
	for (const start of starts) {
		let depth = 0;
		let end = -1;
		for (let i = start; i < text.length; i += 1) {
			const ch = text[i];
			if (ch === "{") depth += 1;
			else if (ch === "}") {
				depth -= 1;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end < 0) continue;
		try {
			const parsed = JSON.parse(text.slice(start, end + 1));
			if (typeof parsed === "object" && parsed !== null && parsed.figId === figId) return parsed;
		} catch {}
	}
	return null;
}
/**
* Sanitize the parsed answer into the figure's cache shape and persist it to
* the same file the chain reads, so a plain refetch renders the fresh figure.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result (id validation for seq/core answers).
* @param kind - the figure kind.
* @param parsed - the answer JSON (figId matched already).
* @param language - role language.
* @param angle - flow viewpoint (flow only).
* @param methodLevel - cache suffix.
* @param sandboxPolicy - session-scoped policy for the cache write.
* @returns `{ ok: true }` or `{ error }`.
*/
async function writeFigureCache(fs, root, index, kind, parsed, language, angle, methodLevel = false, sandboxPolicy) {
	let value;
	if (kind === "flow") {
		const flow = sanitizeFlow(parsed, angle ?? "event");
		if (flow === void 0) return { error: "flow answer did not parse into a diagram" };
		value = {
			title: flow.title,
			source: "flow",
			angle: flow.angle,
			mermaid: sanitizeMermaid(flow.mermaid)
		};
	} else if (kind === "concepts") {
		const tree = buildProfileConceptTree(parsed.conceptTree, "session-figure");
		if (tree.length === 0) return { error: "concept answer produced no tree" };
		value = tree;
	} else if (kind === "seq") {
		const messages = sanitizeSeqMessages(parsed.seqMessages, index.packages.map((pkg) => pkg.id));
		if (messages.length === 0) return { error: "seq answer produced no messages" };
		value = {
			source: "flow",
			messages
		};
	} else if (kind === "interaction") {
		const events = sanitizeEvents(parsed.events);
		if (events.length === 0) return { error: "events answer produced no events" };
		value = events;
	} else {
		const ids = sanitizeCoreIds(index, parsed.core);
		if (ids.length === 0) return { error: "core answer produced no ids" };
		value = {
			ids,
			source: "flow"
		};
	}
	try {
		const factsVersion = await readFactVersion(fs, root);
		await writeFigure(fs, root, entityFigureId(kind, angle), language, factsVersion, value, {
			index,
			methods: methodLevel,
			policy: sandboxPolicy
		});
		return { ok: true };
	} catch (error) {
		return { error: `figure cache write failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
/** The JSON output contract the agent must satisfy for a dynamic figure. */
function dynamicJsonContract(kind) {
	return kind === "seq-edge" ? "{\"figId\": \"<figId>\", \"title\": \"简短标题\", \"diagram\": \"sequenceDiagram\\n  participant A as ...\\n  A->>B: ...\"}" : "{\"figId\": \"<figId>\", \"title\": \"简短标题\", \"diagram\": \"flowchart TD\\n  A --> B\"}";
}
/** The package's absolute path prefix (with trailing separator, `/` separators
* normalized), used to attribute real call edges to a package id. fromFile is
* ABSOLUTE with `/` separators (e.g. `D:/.../packages/arch-lens-backend/src/
* abort.ts`), while pkg.path keeps the platform's native separators — on
* Windows that is BACKSLASHES, so the prefix must be normalized or every
* startsWith() silently misses (regression: drill-down facts claimed "no call
* edges" even when the index had plenty). */
function pkgPathPrefix(index, id) {
	const pkg = index.packages.find((candidate) => candidate.id === id);
	if (pkg === void 0) return "";
	const normalized = pkg.path.replace(/\\/g, "/");
	return normalized.endsWith("/") ? normalized : `${normalized}/`;
}
/** The hovered edge's TWO packages' method lines + ONLY the call edges the
* label actually mentions. Token discipline: the whole point of a drill-down
* is "give the LLM the necessary facts" — the summary is two short method
* lines (class{methods}, no entity lists, no absolute entry paths), and the
* edge list is filtered to symbols named in the hovered label (from/to ===
* symbol, capped at 20, package-relative paths). Only when the label carries
* no symbols (e.g. pure-Chinese labels) does it fall back to the two
* packages' own edges, capped tighter (15). Edges whose caller lives in a
* THIRD package (outside the hovered pair) fall back to a workspace-relative
* path (`packages/arch-lens-backend/src/index.ts`) — the absolute workspace
* root is stated once at the top of the facts. */
function seqEdgeFacts(index, target) {
	const ids = [target.from, target.to].filter((id) => typeof id === "string" && id !== "");
	const summary = ids.map((id) => pkgMethodLine(index, id)).filter((line) => line !== "").join("\n");
	const symbols = symbolTokens(target.label ?? "");
	const prefixes = ids.map((id) => pkgPathPrefix(index, id)).filter((prefix) => prefix !== "");
	const bySymbol = symbols.length > 0 ? (index.calls ?? []).filter((edge) => symbols.some((symbol) => edge.from === symbol || edge.to === symbol)).slice(0, 20).map((edge) => edgeToString(edge, prefixes, index.root)) : [];
	const edges = bySymbol.length > 0 ? bySymbol : packageEdges(index, ids, 15, index.root);
	return `工作区根：${index.root}\n涉及包的类方法（供引用真实方法名）：\n${summary}\n\n相关真实调用边（含调用点文件行号）：\n${edges.length > 0 ? edges.join("\n") : "（无调用边记录——只能基于摘要推断，请标注【推断】）"}`;
}
/** One short method line per package: `- id（lang）方法：Class{a, b}…`. */
function pkgMethodLine(index, id) {
	const pkg = index.packages.find((candidate) => candidate.id === id);
	if (pkg === void 0) return "";
	const methodLines = [];
	for (const entity of pkg.entities) if (entity.kind === "class" && Array.isArray(entity.children)) {
		const methods = entity.children.filter((child) => child.kind === "method" || child.kind === "function").slice(0, 6).map((child) => child.name);
		if (methods.length > 0) methodLines.push(`${entity.name}{${methods.join(", ")}}`);
		if (methodLines.length >= 6) break;
	}
	return `- ${id}（${pkg.language}）方法：${methodLines.length > 0 ? methodLines.join("；") : "（无类方法记录）"}`;
}
/** English-ish symbols (length ≥ 3) mentioned in the hovered edge label. */
function symbolTokens(label) {
	const tokens = label.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? [];
	const stop = /* @__PURE__ */ new Set([
		"the",
		"and",
		"for",
		"with",
		"from",
		"into",
		"call",
		"calls",
		"via",
		"via",
		"using",
		"this",
		"that"
	]);
	return [...new Set(tokens.filter((token) => !stop.has(token.toLowerCase())))];
}
/** One edge line with a package-relative path: `from → to（src/abort.ts:45）`.
* Callers that live in a THIRD package (outside the hovered pair, e.g. the
* backend calling into the hovered service) fall back to a workspace-relative
* path (`packages/arch-lens-backend/src/index.ts`) — never the raw absolute
* path. */
function edgeToString(edge, prefixes, root) {
	const prefix = prefixes.find((candidate) => edge.fromFile.startsWith(candidate)) ?? "";
	const rel = prefix !== "" ? edge.fromFile.slice(prefix.length) : workspaceRelative(root, edge.fromFile);
	return `- ${edge.from ?? "?"} → ${edge.to}（${rel}${edge.line !== void 0 ? `:${edge.line}` : ""}）`;
}
/** The two packages' own call edges, package-relative paths, tight cap. */
function packageEdges(index, ids, cap, root) {
	const prefixes = ids.map((id) => pkgPathPrefix(index, id)).filter((prefix) => prefix !== "");
	return (index.calls ?? []).filter((edge) => prefixes.some((prefix) => edge.fromFile.startsWith(prefix))).slice(0, cap).map((edge) => edgeToString(edge, prefixes, root));
}
/**
* Build the session message that asks the agent to draw ONE dynamic detail
* figure. Facts are embedded (the hovered edge's two packages with their
* method-level summary + real call edges, or the flow subgraph's source
* block + the code summary); the answer must be the strict JSON below.
* @param kind - seq-edge (edge drill-down) or flow-subgraph (stage expansion).
* @param index - code index result (fact source).
* @param language - role language.
* @param figId - unique marker the answer must echo.
* @param target - the hovered element (from/to/label or stage).
* @param mermaidSource - the current flow diagram source (flow-subgraph only).
* @returns the user-message text.
*/
function buildDynamicFigurePrompt(kind, index, language, figId, target, mermaidSource, blurbs, existing) {
	const mission = kind === "seq-edge" ? `主流程时序中有一条消息 ${target.from ?? "?"} → ${target.to ?? "?"}（${target.label ?? ""}）。请钻取这两个包之间的【方法级调用时序】，输出 mermaid sequenceDiagram（参与者用包 id；消息 label 尽量引用真实方法名与文件，如 \`Svc.handle（api.ts:41）\`；只使用下面摘要/调用边中的事实）。` : kind === "flow-subgraph" ? `当前流程图中有一个阶段子块「${target.stage ?? "?"}」。请展开该子块，生成一张更详细的 flowchart 图：保留子块内的节点与边，补充子块内部的步骤细节（仅基于代码事实；源码中没有证据的环节必须标注【推断】）。` : "请为当前工作区绘制一张【架构总览图】（flowchart）：先选出构成项目核心的 4-12 个包作为节点；用 subgraph 按职责分层（如 入口/调度/能力/数据/外部接口，按项目实际调整）；边表达关键依赖、数据流或事件流，并在边上标注类型（如 |import|、|数据流|、|事件流|）；仅基于下面的职责与摘要事实，没有证据的环节必须标注【推断】。";
	const context = kind === "seq-edge" ? seqEdgeFacts(index, target) : kind === "flow-subgraph" ? flowSubgraphFacts(index, mermaidSource ?? "", target.stage ?? "") : overviewFacts(index, blurbs ?? {});
	const existingBlock = existing !== void 0 && existing.diagram !== void 0 && existing.diagram !== "" ? `\n该目标已有一张下钻图（同族复用，请保持目标一致，在现有图上扩展/重画细节，图类型可不变或按需调整）：\n标题：${existing.title ?? ""}\n现有图（mermaid）：\n${existing.diagram}${existing.summary !== void 0 && existing.summary !== "" ? `\n现有概要：${existing.summary}` : ""}\n` : "";
	return `你是代码架构分析师。请为当前工作区生成一张【动态细节图】（这是 Arch Lens 学习台的「动态画图」请求，figId=${figId}）。\n你可以使用工作区工具读源码核实事实，但最终回答必须且只能是一个 JSON 对象，格式：${dynamicJsonContract(kind)}（把 figId 原样填成 ${figId}），不要输出任何解释、代码块围栏或额外文字。\n` + mission + "\n" + existingBlock + `输出语言：${language}。\n\n${context}`;
}
/** Facts for the PURE-LLM 架构总览: per-package one-line duties (graph blurbs)
* + a trimmed dependency summary. The LLM picks the core and the layering —
* that is the point of this branch (compare with the rule-built
* overviewFigure remote). */
function overviewFacts(index, blurbs) {
	return `各包职责（一句话）：\n${index.packages.slice(0, 24).map((pkg) => `- ${pkg.id}：${(blurbs[pkg.id] ?? "").trim().slice(0, 60) || "（无职责描述）"}`).join("\n")}\n\n代码摘要（含依赖，供判断核心与分层）：\n${indexSummary(index, {
		fields: { deps: true },
		maxPackages: 24
	})}`;
}
/** Facts for a flow-subgraph expansion: the hovered subgraph block itself,
* the OTHER stage titles (where it sits in the overall flow), the edges that
* touch its nodes (cross-stage handoffs included), and a broader code
* summary — a stage expansion needs more context than an edge drill-down. */
function flowSubgraphFacts(index, source, stage) {
	const block = extractSubgraphBlock(source, stage);
	const titles = subgraphTitles(source).filter((title) => title !== stage);
	const touching = edgesTouching(source, nodeIdsInBlock(block), 15);
	return `当前流程图源中的子块（只展开「${stage}」子块，不要重画整图）：\n\`\`\`mermaid\n${block}\n\`\`\`\n流程图中的其他阶段（供定位该子块在整体流程中的位置）：\n${titles.length > 0 ? titles.map((title) => `- ${title}`).join("\n") : "（无其他阶段）"}\n与子块节点相连的边（含跨阶段衔接）：\n${touching.length > 0 ? touching.join("\n") : "（子块内无边）"}\n代码摘要（供核实子块内的包/实体）：\n${indexSummary(index, {
		fields: { deps: false },
		maxPackages: 40
	})}`;
}
/** All subgraph titles in a flowchart source, in order, quotes stripped. */
function subgraphTitles(source) {
	const titles = [];
	for (const line of source.split("\n")) {
		const m = /^\s*subgraph\s+(.+?)\s*$/.exec(line);
		if (m !== null) titles.push(m[1].trim().replace(/["']/g, ""));
	}
	return titles;
}
/** Node ids appearing in a subgraph block (edge endpoints + definitions). */
function nodeIdsInBlock(block) {
	const ids = /* @__PURE__ */ new Set();
	for (const line of block.split("\n")) {
		for (const m of line.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:-->|==>|\.->)/g)) ids.add(m[1]);
		for (const m of line.matchAll(/(?:-->|==>|\.->)\s*([A-Za-z_][A-Za-z0-9_]*)/g)) ids.add(m[1]);
	}
	return ids;
}
/** Edges of the whole diagram that touch the given node ids, capped. */
function edgesTouching(source, ids, cap) {
	const out = [];
	for (const line of source.split("\n")) {
		const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:-->|==>|\.->)\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
		if (m !== null && (ids.has(m[1]) || ids.has(m[2]))) out.push(line.trim());
		if (out.length >= cap) break;
	}
	return out;
}
/** Extract ONE subgraph block (matched by title, quotes stripped) from a
* flowchart source; falls back to the whole source when the block cannot be
* isolated. Keeps the drill-down prompt small — only the hovered stage's
* nodes/edges are embedded, not the entire diagram. */
function extractSubgraphBlock(source, stage) {
	if (stage === "") return source;
	const wanted = stage.trim().replace(/["']/g, "");
	const lines = source.split("\n");
	const start = lines.findIndex((line) => {
		const m = /^\s*subgraph\s+(.+?)\s*$/.exec(line);
		return m !== null && m[1].trim().replace(/["']/g, "") === wanted;
	});
	if (start < 0) return source;
	let depth = 0;
	for (let i = start; i < lines.length; i += 1) if (/^\s*subgraph\b/.test(lines[i])) depth += 1;
	else if (/^\s*end\s*$/.test(lines[i])) {
		depth -= 1;
		if (depth === 0) return lines.slice(start, i + 1).join("\n");
	}
	return source;
}
/** Extract the diagram body from a dynamic answer ({title?, diagram}): strips
* fences and stray prose, keeps the first diagram statement, repairs edge
* labels. @returns the clean value, or undefined when unusable. */
function extractDynamicDiagram(parsed) {
	const record = parsed;
	if (typeof record.diagram !== "string") return void 0;
	const diagram = extractDiagramText(record.diagram);
	if (diagram === "") return void 0;
	return {
		title: typeof record.title === "string" && record.title.trim() !== "" ? record.title.trim().slice(0, 60) : "动态细节图",
		diagram
	};
}
/** Strip fences / trailing prose from a diagram answer; '' when no diagram. */
function extractDiagramText(out) {
	const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
	if (fenced !== null) return sanitizeMermaid(fenced[1].trim());
	const idx = out.search(/\b(?:flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|journey|gantt)\b/);
	if (idx < 0) return "";
	return sanitizeMermaid(out.slice(idx).trim().replace(/```\s*$/, "").trim());
}
/**
* Facts version + dependency packages a dynamic drill-down write must stamp
* (§6.2, the ONE rule): seq-edge → the two endpoint packages parsed back out
* of the target key; flow-subgraph → the parent flow envelope's deps (absent
* or unreadable parent → all packages); overview → all packages.
*/
async function dynamicFigureWriteFacts(fs, root, dynamic, language, angle, index) {
	const factsVersion = await readFactVersion(fs, root);
	const all = index.packages.map((pkg) => pkg.id);
	if (dynamic.kind === "seq-edge") {
		const [from, to] = dynamic.targetKey.replace(/^seq:/, "").split("|");
		const deps = [from ?? "", to ?? ""].filter((id) => id !== "");
		return {
			factsVersion,
			deps: deps.length > 0 ? deps : all
		};
	}
	if (dynamic.kind === "flow-subgraph") try {
		const raw = await readRawCache(fs, await fs.resolve(flowCacheName(language, angle ?? "event"), { cwd: root }));
		return {
			factsVersion,
			deps: raw !== null && raw.depsPresent ? raw.deps : all
		};
	} catch {
		return {
			factsVersion,
			deps: all
		};
	}
	return {
		factsVersion,
		deps: all
	};
}
/**
* Persist one dynamic figure to its per-target cache file — versioned
* envelope `{ v, deps, data }` (D1): an invalid/stale drill-down becomes
* unreadable and the next hover regenerates it; selective invalidation
* cascades it with its parent figure.
* @param fs - filesystem service.
* @param root - workspace root.
* @param kind - the dynamic figure kind.
* @param targetKey - the serialized hover target (cache identity).
* @param parsed - the answer JSON (figId matched already).
* @param language - role language.
* @param factsVersion - facts version to stamp (read at write time).
* @param deps - dependency package ids (see dynamicFigureWriteFacts).
* @param sandboxPolicy - session-scoped policy for the cache write.
* @returns `{ ok: true }` or `{ error }`.
*/
async function writeDynamicFigureCache(fs, root, kind, targetKey, parsed, language, factsVersion, deps, sandboxPolicy) {
	const value = extractDynamicDiagram(parsed);
	if (value === void 0) return { error: "dynamic answer did not parse into a diagram" };
	try {
		await writeVersionedCache(fs, await fs.resolve(dynamicFigureCacheName(kind, targetKey, language), { cwd: root }), {
			...value,
			source: "flow",
			kind,
			targetKey
		}, factsVersion, sandboxPolicy, deps);
		return { ok: true };
	} catch (error) {
		return { error: `dynamic figure cache write failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
/**
* Build the session message for the CUSTOM figure branch (「🎨 动态出图」): the
* user types ANY request ("存图的逻辑，怎么存的，存哪、怎么读的…") and the agent
* draws a matching diagram PLUS a short summary. Same evidence discipline as
* the other session figures — the FULL scan facts (per-package one-line duties
* + bounded index summary with deps and top-level entities) are embedded.
* @param index - code index result (fact source).
* @param text - the user's figure request (for a follow-up: the refinement
*   instruction targeting the existing figure).
* @param language - role language.
* @param figId - unique marker the answer must echo.
* @param blurbs - per-package one-line duties (graph blurbs).
* @param existing - the figure of the SAME scene (follow-up): its diagram +
*   title + summary are embedded so the LLM extends/redraws the details
*   instead of starting from scratch. Undefined = brand-new scene.
* @returns the user-message text.
*/
function buildCustomFigurePrompt(index, text, language, figId, blurbs, existing) {
	const dutyLines = index.packages.slice(0, 24).map((pkg) => `- ${pkg.id}：${(blurbs[pkg.id] ?? "").trim().slice(0, 60) || "（无职责描述）"}`).join("\n");
	const existingBlock = existing !== void 0 && existing.diagram !== void 0 && existing.diagram !== "" ? `\n这是同一场景的现有图（图号已锁定，追问时保持场景一致，在现有图上扩展/重画细节）：\n标题：${existing.title ?? ""}\n现有图（mermaid）：\n${existing.diagram}\n${existing.summary !== void 0 && existing.summary !== "" ? `现有概要：${existing.summary}\n` : ""}` : "";
	const instruction = existing !== void 0 && existing.diagram !== void 0 && existing.diagram !== "" ? `用户对现有图提出追问/扩展要求（请基于上面的现有图重画或扩展细节，保持图号和场景一致，图类型可不变或按需调整）：` : `用户要求画的图：`;
	return `你是代码架构分析师。请根据用户下面的要求，为当前工作区绘制一张图（这是 Arch Lens 学习台的「动态出图」请求，figId=${figId}）。\n你可以使用工作区工具读源码核实事实，但最终回答必须且只能是一个 JSON 对象，格式：{"figId": "${figId}", "title": "简短标题", "diagram": "flowchart TD\\n  A --> B（或 sequenceDiagram / erDiagram / stateDiagram 等，按问题选择合适的图类型）", "summary": "图的概要描述（120-300 字：这张图画了什么、关键节点、核心机制，供学习者快速理解）"}，不要输出任何解释、代码块围栏或额外文字。\n` + existingBlock + `${instruction}${text.trim()}\n请只基于下面的扫描数据作答（LLM 推断查证，非代码事实）；代码中没有证据的环节必须在图上标注【推断】。\n输出语言：${language}。\n\n各包职责（一句话）：\n${dutyLines}\n\n代码摘要（扫描数据：依赖 + 顶层实体，供推断查证）：\n${indexSummary(index, {
		fields: {
			deps: true,
			entities: true
		},
		maxPackages: 40
	})}`;
}
/**
* Sanitize a CUSTOM figure answer ({figId, title, diagram, summary}): diagram
* via the same fence/statement extraction + label repair as the dynamic
* branch; title and summary trimmed. @returns the clean value, or undefined
* when no usable diagram.
*/
function extractCustomFigure(parsed) {
	const record = parsed;
	if (typeof record.diagram !== "string") return void 0;
	const diagram = extractDiagramText(record.diagram);
	if (diagram === "") return void 0;
	return {
		title: typeof record.title === "string" && record.title.trim() !== "" ? record.title.trim().slice(0, 80) : "动态出图",
		diagram,
		summary: typeof record.summary === "string" ? record.summary.trim().slice(0, 2e3) : ""
	};
}
//#endregion
//#region packages/arch-lens-backend/src/followup.ts
/** Follow-up entity kind → the registry entity id ('overview' is a dynamic
* drill-down figure, not a registered entity figure). */
function followUpEntityKind(kind, angle) {
	switch (kind) {
		case "flow": return angle === "pipeline" ? "flow-pipeline" : "flow-event";
		case "seq": return "seq";
		case "concepts": return "concepts";
		case "events": return "interaction";
		case "core": return "core";
		default: return null;
	}
}
/** Read a versioned cache file; null when absent/stale/unreadable. */
async function readCache(fs, root, name) {
	try {
		return await readVersionedCache(fs, await fs.resolve(name, { cwd: root }), await readFactVersion(fs, root));
	} catch {
		return null;
	}
}
/** Write an ENTITY figure cache through the unified registry entry, keeping
* the follow-up's historical non-fatal write discipline (a persistence failure
* must not discard the freshly drawn figure for this session turn).
* v = facts version re-read at write time (same stamping as before). */
async function writeEntityFigure(fs, root, kind, language, data, options) {
	try {
		await writeFigure(fs, root, kind, language, await readFactVersion(fs, root), data, options);
	} catch {}
}
/** Write a DYNAMIC (overview) cache file, non-fatal (until stage 3 unifies it).
* @param fs - filesystem service. @param root - workspace root. @param name - cache file name.
* @param value - the figure payload. @param sandboxPolicy - session policy. */
async function writeDynamicCache(fs, root, name, value, sandboxPolicy) {
	try {
		await writeVersionedCache(fs, await fs.resolve(name, { cwd: root }), value, await readFactVersion(fs, root), sandboxPolicy);
	} catch {}
}
/** The existing figure of one kind, rendered as prompt context text. */
async function existingText(fs, root, kind, language, angle, methods) {
	try {
		const entityKind = followUpEntityKind(kind, angle);
		const name = entityKind !== null ? specCacheName(entityKind, language, methods) : dynamicFigureCacheName("overview", "overview:all", language);
		switch (kind) {
			case "flow": {
				const cached = await readCache(fs, root, name);
				return cached !== null && typeof cached.mermaid === "string" ? `标题：${cached.title ?? ""}\n现有图（mermaid）：\n${cached.mermaid}` : "";
			}
			case "seq": {
				const cached = await readCache(fs, root, name);
				return cached !== null ? `现有时序消息（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : "";
			}
			case "concepts": {
				const cached = await readCache(fs, root, name);
				return cached !== null ? `现有概念树（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : "";
			}
			case "events": {
				const cached = await readCache(fs, root, name);
				return cached !== null ? `现有核心交互（JSON）：\n${JSON.stringify(cached).slice(0, 2400)}` : "";
			}
			case "core": {
				const cached = await readCache(fs, root, name);
				return cached !== null && Array.isArray(cached.ids) ? `现有核心包：${cached.ids.join("、")}` : "";
			}
			case "overview": {
				const cached = await readCache(fs, root, name);
				return cached !== null && typeof cached.diagram === "string" ? `标题：${typeof cached.title === "string" ? cached.title : ""}\n现有总览图（mermaid）：\n${cached.diagram}` : "";
			}
		}
	} catch {
		return "";
	}
}
/** Per-kind JSON contract appended to every follow-up prompt. */
function contractOf(kind) {
	switch (kind) {
		case "flow": return "严格输出 JSON：{\"title\": \"流程标题\", \"mermaid\": \"flowchart TD\\n...\"}（mermaid 为完整 flowchart 源码，不要代码块围栏），不要输出其他内容。";
		case "seq": return "严格输出 JSON 数组：[{ \"from\": \"包id\", \"to\": \"包id\", \"label\": \"短动宾短语或 调用 xxx()\" }]（10-16 条，from/to 只能是摘要中的包 id），不要输出其他内容。";
		case "concepts": return "严格输出 JSON 数组：[{ \"name\": \"概念名\", \"desc\": \"一句话\", \"inside\": \"一句话\", \"children\": [] }]（层级小节），不要输出其他内容。";
		case "events": return "严格输出 JSON 数组：[{ \"event\": \"...\", \"mode\": \"emit|waterfall|parallel|serial\", \"producers\": [\"...\"], \"consumers\": [\"...\"], \"note\": \"...\" }]（8-14 条），不要输出其他内容。";
		case "core": return "严格输出 JSON：{\"core\": [\"包id\", ...]}（4-25 个核心包 id，只能是摘要中的包 id），不要输出其他内容。";
		default: return "严格输出 JSON：{\"title\": \"简短标题\", \"diagram\": \"flowchart TD\\n...\"}（架构总览图），不要输出其他内容。";
	}
}
/** Build the follow-up prompt: summary + existing figure + user's ask + contract. */
function followUpPrompt(kind, language, followUp, summary, existing) {
	const base = `你是代码架构分析师。以下是某项目的代码索引摘要（包/依赖/实体/入口）。\n输出语言：${language}。\n只依据摘要事实作答；源码中没有证据的环节必须在图上标注【推断】。\n\n项目摘要：\n${summary}\n\n`;
	const existingBlock = existing !== "" ? `该图已有以下版本（保持同一场景，在现有图上扩展/重画细节）：\n${existing}\n\n` : "";
	const ask = `用户对现有图提出追问/扩展要求：${followUp}\n请基于现有图重画或扩展细节。\n`;
	return base + existingBlock + ask + contractOf(kind);
}
/** Pull the first {...} object out of a model answer, tolerating prose. */
function extractJson(text) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const value = JSON.parse(text.slice(start, end + 1));
		return typeof value === "object" && value !== null ? value : null;
	} catch {
		return null;
	}
}
/** Pull the first [...] array out of a model answer; null when empty. */
function extractArray(text) {
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start < 0 || end <= start) return null;
	try {
		const value = JSON.parse(text.slice(start, end + 1));
		return Array.isArray(value) && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}
/** Validate and bound the LLM's core ids against the indexed packages. */
function validateCoreIds(index, raw) {
	if (!Array.isArray(raw)) return [];
	const known = new Set(index.packages.map((pkg) => pkg.id));
	const ids = [];
	for (const item of raw) {
		if (typeof item !== "string") continue;
		if (!known.has(item)) continue;
		if (ids.includes(item)) continue;
		ids.push(item);
		if (ids.length >= 25) break;
	}
	return ids;
}
/** Strip fences / stray prose from a mermaid answer; '' when no diagram. */
function cleanMermaid(out) {
	const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
	if (fenced !== null) return fenced[1].trim();
	const idx = out.search(/\b(?:flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|journey|gantt)\b/);
	if (idx < 0) return "";
	return out.slice(idx).trim().replace(/```\s*$/, "").trim();
}
/**
* In-place follow-up redraw for ONE tab figure. Reads the existing figure,
* asks the LLM to extend/redraw it with the follow-up, overwrites the SAME
* cache, and returns the new figure (same contract as the tab's RPC).
* @param request - figure kind, role language, viewpoint (flow), method-level
*   switch, and the user's follow-up instruction.
* @param signal - optional cancellation: aborting it stops the LLM stream
*   promptly (the panel's「取消」button while a redraw is running).
* @returns the new figure data, or an error.
*/
async function figureFollowUp(ctx, fs, root, index, request, sandboxPolicy, signal) {
	const { kind, language } = request;
	const methods = request.methodLevel === true;
	const angle = request.angle ?? "event";
	try {
		const summary = indexSummary(index, {
			fields: { deps: false },
			methods
		});
		const existing = await existingText(fs, root, kind, language, angle, methods);
		const text = await llmText(ctx, followUpPrompt(kind, language, request.followUp, summary, existing), .3, void 0, `followup-${kind}`, signal);
		if (text === "") return { error: "follow-up generation returned empty text" };
		switch (kind) {
			case "flow": {
				const parsed = extractJson(text);
				if (parsed === null || typeof parsed.mermaid !== "string") return { error: "flow follow-up did not parse into a diagram" };
				const mermaid = cleanMermaid(parsed.mermaid);
				if (mermaid === "") return { error: "flow follow-up produced no mermaid" };
				const result = {
					title: typeof parsed.title === "string" && parsed.title !== "" ? parsed.title.slice(0, 60) : "核心流程",
					source: "flow",
					angle,
					mermaid
				};
				await writeEntityFigure(fs, root, angle === "pipeline" ? "flow-pipeline" : "flow-event", language, result, {
					index,
					methods,
					policy: sandboxPolicy
				});
				return result;
			}
			case "seq": {
				const messages = extractArray(text);
				if (messages === null) return { error: "seq follow-up produced no messages" };
				const result = {
					messages,
					source: "flow"
				};
				await writeEntityFigure(fs, root, "seq", language, result, {
					methods,
					policy: sandboxPolicy
				});
				return result;
			}
			case "concepts": {
				const tree = extractArray(text);
				if (tree === null) return { error: "concepts follow-up produced no tree" };
				await writeEntityFigure(fs, root, "concepts", language, tree, {
					index,
					methods,
					policy: sandboxPolicy
				});
				return tree;
			}
			case "events": {
				const events = extractArray(text);
				if (events === null) return { error: "events follow-up produced no events" };
				await writeEntityFigure(fs, root, "interaction", language, events, {
					index,
					methods,
					policy: sandboxPolicy
				});
				return events;
			}
			case "core": {
				const ids = validateCoreIds(index, extractJson(text)?.core);
				if (ids.length < 4) return { error: "core follow-up produced no valid package ids" };
				const core = {
					ids,
					source: "flow"
				};
				await writeEntityFigure(fs, root, "core", language, core, {
					methods,
					policy: sandboxPolicy
				});
				return {
					kind: "flowchart",
					source: coreFlowchart(index, ids),
					core
				};
			}
			case "overview": {
				const parsed = extractJson(text);
				const value = parsed !== null ? extractDynamicDiagram(parsed) : void 0;
				if (value === void 0) return { error: "overview follow-up did not parse into a diagram" };
				const targetKey = "overview:all";
				await writeDynamicCache(fs, root, dynamicFigureCacheName("overview", targetKey, language), {
					...value,
					source: "flow",
					kind: "overview",
					targetKey
				}, sandboxPolicy);
				return {
					...value,
					kind: "overview",
					targetKey
				};
			}
		}
	} catch (error) {
		return { error: `follow-up failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
//#endregion
//#region packages/arch-lens-backend/src/policy.ts
/**
* Resolve the policy for one session's writes (or the deployment fallback).
* @param ctx - host context carrying sessions and sandboxPolicy services.
* @param sessionId - target session id, or null for the deployment policy.
* @returns the per-call mode and workspace root for fs mutations.
*/
function sessionPolicy(ctx, sessionId) {
	const sessions = ctx.get("sessions");
	const session = sessionId === null ? void 0 : sessions?.get(sessionId);
	const sandboxPolicy = ctx.get("sandboxPolicy");
	if (sandboxPolicy === void 0) return {
		mode: "read-only",
		workspaceRoot: process.cwd()
	};
	return sandboxPolicy.resolve(session === void 0 ? {} : { session });
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
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = "ARCH-NOTES.md";
/** Persisted scan-graph cache under the workspace `index/` cache directory
* (reopening after a host restart must not re-walk the filesystem; refresh()
* invalidates it). */
const GRAPH_CACHE_FILE = `${CACHE_DIR}/.arch-lens-graph.json`;
/** Persisted code-index cache written by the codeIndex provider under the same
* `index/` directory, now as a versioned `{ v, data }` envelope (v = the facts
* version it was built against; see code-index-tree-sitter/src/envelope.ts). */
const INDEX_CACHE_FILE = `${CACHE_DIR}/.arch-lens-index.json`;
/** How long a rescan waits inline for a code-index rebuild before letting it
* finish in the background (kept under the desk's ~30s RPC budget). */
const INDEX_ENVELOPE_TIMEBOX_MS = 2e4;
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
	let _remoteCallGraph_decorators;
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
			__esDecorate(this, null, _remoteGraph_decorators, {
				kind: "method",
				name: "remoteGraph",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteGraph" in obj,
					get: (obj) => obj.remoteGraph
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteRefresh_decorators, {
				kind: "method",
				name: "remoteRefresh",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteRefresh" in obj,
					get: (obj) => obj.remoteRefresh
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteRefreshIndex_decorators, {
				kind: "method",
				name: "remoteRefreshIndex",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteRefreshIndex" in obj,
					get: (obj) => obj.remoteRefreshIndex
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteGenerateAll_decorators, {
				kind: "method",
				name: "remoteGenerateAll",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteGenerateAll" in obj,
					get: (obj) => obj.remoteGenerateAll
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteSetSession_decorators, {
				kind: "method",
				name: "remoteSetSession",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteSetSession" in obj,
					get: (obj) => obj.remoteSetSession
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteComponent_decorators, {
				kind: "method",
				name: "remoteComponent",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteComponent" in obj,
					get: (obj) => obj.remoteComponent
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteNotes_decorators, {
				kind: "method",
				name: "remoteNotes",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteNotes" in obj,
					get: (obj) => obj.remoteNotes
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteMermaidDeps_decorators, {
				kind: "method",
				name: "remoteMermaidDeps",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteMermaidDeps" in obj,
					get: (obj) => obj.remoteMermaidDeps
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteMermaidEr_decorators, {
				kind: "method",
				name: "remoteMermaidEr",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteMermaidEr" in obj,
					get: (obj) => obj.remoteMermaidEr
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteMermaidIndexed_decorators, {
				kind: "method",
				name: "remoteMermaidIndexed",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteMermaidIndexed" in obj,
					get: (obj) => obj.remoteMermaidIndexed
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteCallGraph_decorators, {
				kind: "method",
				name: "remoteCallGraph",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteCallGraph" in obj,
					get: (obj) => obj.remoteCallGraph
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteMermaidCore_decorators, {
				kind: "method",
				name: "remoteMermaidCore",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteMermaidCore" in obj,
					get: (obj) => obj.remoteMermaidCore
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteOverviewFigure_decorators, {
				kind: "method",
				name: "remoteOverviewFigure",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteOverviewFigure" in obj,
					get: (obj) => obj.remoteOverviewFigure
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteConceptTree_decorators, {
				kind: "method",
				name: "remoteConceptTree",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteConceptTree" in obj,
					get: (obj) => obj.remoteConceptTree
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteGenerateDocs_decorators, {
				kind: "method",
				name: "remoteGenerateDocs",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteGenerateDocs" in obj,
					get: (obj) => obj.remoteGenerateDocs
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteGenerateDocSection_decorators, {
				kind: "method",
				name: "remoteGenerateDocSection",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteGenerateDocSection" in obj,
					get: (obj) => obj.remoteGenerateDocSection
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteSequence_decorators, {
				kind: "method",
				name: "remoteSequence",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteSequence" in obj,
					get: (obj) => obj.remoteSequence
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteRegenerateFigure_decorators, {
				kind: "method",
				name: "remoteRegenerateFigure",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteRegenerateFigure" in obj,
					get: (obj) => obj.remoteRegenerateFigure
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteLastAnswer_decorators, {
				kind: "method",
				name: "remoteLastAnswer",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteLastAnswer" in obj,
					get: (obj) => obj.remoteLastAnswer
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteGenerationStatus_decorators, {
				kind: "method",
				name: "remoteGenerationStatus",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteGenerationStatus" in obj,
					get: (obj) => obj.remoteGenerationStatus
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteGenerationStatusNext_decorators, {
				kind: "method",
				name: "remoteGenerationStatusNext",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteGenerationStatusNext" in obj,
					get: (obj) => obj.remoteGenerationStatusNext
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteFigurePrompt_decorators, {
				kind: "method",
				name: "remoteFigurePrompt",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteFigurePrompt" in obj,
					get: (obj) => obj.remoteFigurePrompt
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteDynamicFigurePrompt_decorators, {
				kind: "method",
				name: "remoteDynamicFigurePrompt",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteDynamicFigurePrompt" in obj,
					get: (obj) => obj.remoteDynamicFigurePrompt
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteDynamicFigure_decorators, {
				kind: "method",
				name: "remoteDynamicFigure",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteDynamicFigure" in obj,
					get: (obj) => obj.remoteDynamicFigure
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteCustomFigurePrompt_decorators, {
				kind: "method",
				name: "remoteCustomFigurePrompt",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteCustomFigurePrompt" in obj,
					get: (obj) => obj.remoteCustomFigurePrompt
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteCustomFigure_decorators, {
				kind: "method",
				name: "remoteCustomFigure",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteCustomFigure" in obj,
					get: (obj) => obj.remoteCustomFigure
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteCustomFigureList_decorators, {
				kind: "method",
				name: "remoteCustomFigureList",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteCustomFigureList" in obj,
					get: (obj) => obj.remoteCustomFigureList
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteSaveCustomFigure_decorators, {
				kind: "method",
				name: "remoteSaveCustomFigure",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteSaveCustomFigure" in obj,
					get: (obj) => obj.remoteSaveCustomFigure
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteCustomFigureDelete_decorators, {
				kind: "method",
				name: "remoteCustomFigureDelete",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteCustomFigureDelete" in obj,
					get: (obj) => obj.remoteCustomFigureDelete
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteFigureFollowUp_decorators, {
				kind: "method",
				name: "remoteFigureFollowUp",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteFigureFollowUp" in obj,
					get: (obj) => obj.remoteFigureFollowUp
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteCancelFollowUp_decorators, {
				kind: "method",
				name: "remoteCancelFollowUp",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteCancelFollowUp" in obj,
					get: (obj) => obj.remoteCancelFollowUp
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteCancelGeneration_decorators, {
				kind: "method",
				name: "remoteCancelGeneration",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteCancelGeneration" in obj,
					get: (obj) => obj.remoteCancelGeneration
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteEvents_decorators, {
				kind: "method",
				name: "remoteEvents",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteEvents" in obj,
					get: (obj) => obj.remoteEvents
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteFlow_decorators, {
				kind: "method",
				name: "remoteFlow",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteFlow" in obj,
					get: (obj) => obj.remoteFlow
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteAnalyze_decorators, {
				kind: "method",
				name: "remoteAnalyze",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteAnalyze" in obj,
					get: (obj) => obj.remoteAnalyze
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteSummarizeDuties_decorators, {
				kind: "method",
				name: "remoteSummarizeDuties",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteSummarizeDuties" in obj,
					get: (obj) => obj.remoteSummarizeDuties
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteProgress_decorators, {
				kind: "method",
				name: "remoteProgress",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteProgress" in obj,
					get: (obj) => obj.remoteProgress
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteProgressStats_decorators, {
				kind: "method",
				name: "remoteProgressStats",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteProgressStats" in obj,
					get: (obj) => obj.remoteProgressStats
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteLlmStats_decorators, {
				kind: "method",
				name: "remoteLlmStats",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteLlmStats" in obj,
					get: (obj) => obj.remoteLlmStats
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteNotePending_decorators, {
				kind: "method",
				name: "remoteNotePending",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteNotePending" in obj,
					get: (obj) => obj.remoteNotePending
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remotePromptConfig_decorators, {
				kind: "method",
				name: "remotePromptConfig",
				static: false,
				private: false,
				access: {
					has: (obj) => "remotePromptConfig" in obj,
					get: (obj) => obj.remotePromptConfig
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remotePromptConfigSave_decorators, {
				kind: "method",
				name: "remotePromptConfigSave",
				static: false,
				private: false,
				access: {
					has: (obj) => "remotePromptConfigSave" in obj,
					get: (obj) => obj.remotePromptConfigSave
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = ["fs", "sandboxPolicy"];
		/** Loader validation for the optional note file name. */
		static Config = s.object({ notesFile: s.string() });
		notesFile = __runInitializers(this, _instanceExtraInitializers);
		/** Per-workspace scan cache: keyed by the resolved workspace root, so
		* re-loading the desk on the same workspace never rescans, while switching
		* to a different workspace rescans automatically on the next graph(). */
		graphCaches = /* @__PURE__ */ new Map();
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
		customFigures = /* @__PURE__ */ new Map();
		/** In-flight code-index load per root: CONCURRENT figure RPCs share ONE
		* indexWorkspace call instead of each re-loading/re-parsing the workspace
		* (the disk cache already avoids re-scanning source; this dedups the load). */
		indexInFlight = null;
		/** Shared workspace index load: concurrent calls for the SAME root await the
		* same in-flight promise (dedup); sequential calls behave exactly like a
		* plain indexWorkspace. The on-disk index cache is bound to the current
		* facts version (「↻ 重新扫描」's generatedAt): an unknown version (0) makes
		* the provider neither read nor persist, and a mismatched envelope on disk
		* triggers exactly one forced rebuild (defense in depth).
		* @throws when the codeIndex service is unavailable. */
		async indexWorkspaceShared(root) {
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) throw new Error("codeIndex service unavailable");
			const inFlight = this.indexInFlight;
			if (inFlight !== null && inFlight.root === root) return inFlight.promise;
			const promise = (async () => {
				const factsVersion = await readFactVersion(this.ctx.fs, root);
				const policy = this.sessionPolicy();
				const index = await codeIndex.indexWorkspace(root, policy, factsVersion);
				const target = await this.ctx.fs.resolve(INDEX_CACHE_FILE, { cwd: root }).catch(() => null);
				if (target === null || factsVersion === 0) return index;
				const envelope = await readRawCache(this.ctx.fs, target);
				if (envelope !== null && envelope.v !== factsVersion) {
					await codeIndex.refresh(root, policy);
					return codeIndex.indexWorkspace(root, policy, factsVersion);
				}
				return index;
			})().finally(() => {
				if (this.indexInFlight?.root === root) this.indexInFlight = null;
			});
			this.indexInFlight = {
				root,
				promise
			};
			return promise;
		}
		/** Session whose cwd anchors the workspace root; null falls back to the sandbox policy. */
		targetSessionId = null;
		/**
		* @param ctx - host context carrying fs and sandboxPolicy.
		* @param config - optional notes file name.
		*/
		constructor(ctx, config = {}) {
			super(ctx, "archLens");
			this.notesFile = config.notesFile ?? DEFAULT_NOTES_FILE;
		}
		/** Resolve the workspace root from the target session's cwd, else the sandbox policy. */
		resolveRoot() {
			const target = this.targetSessionId;
			if (target !== null) {
				const cwd = (this.ctx.get("sessions")?.get(target))?.header.cwd;
				if (cwd !== void 0) return cwd;
			}
			const root = this.ctx.get("sandboxPolicy")?.workspaceRoot;
			if (root === void 0) return { error: "cannot resolve workspace root (sandboxPolicy.workspaceRoot missing)" };
			return root;
		}
		/** Snapshot the session's cumulative token usage (the tokenUsage projection
		* from token-meter), or undefined when the session or projection is
		* unavailable. The delta between two snapshots around one staged request
		* attributes that request's provider-reported spend to the arch-lens
		* action (AI 生成 / 动态出图 / 讲解 run inside the session's agent turn). */
		sessionUsageSnapshot(sessionId) {
			if (sessionId === null || sessionId === void 0) return void 0;
			const session = this.ctx.get("sessions")?.get(sessionId);
			if (session === void 0) return void 0;
			return this.ctx.get("sessionProjections")?.snapshot(session).values.tokenUsage;
		}
		/** Attribute one staged session-driven request's token spend (delta between
		* the staged and the current session tokenUsage) to the LLM ledger. */
		recordSessionUsage(kind, label, stagedAt, usageStart, sessionId) {
			const end = this.sessionUsageSnapshot(sessionId);
			if (usageStart === void 0 || end === void 0) return;
			const delta = {
				uncachedInputTokens: Math.max(0, end.uncachedInputTokens - usageStart.uncachedInputTokens),
				outputTokens: Math.max(0, end.outputTokens - usageStart.outputTokens),
				cacheReadTokens: Math.max(0, end.cacheReadTokens - usageStart.cacheReadTokens),
				cacheWriteTokens: Math.max(0, end.cacheWriteTokens - usageStart.cacheWriteTokens)
			};
			if (delta.uncachedInputTokens === 0 && delta.outputTokens === 0 && delta.cacheReadTokens === 0 && delta.cacheWriteTokens === 0) return;
			const usage = {
				inTokens: delta.uncachedInputTokens + delta.cacheReadTokens + delta.cacheWriteTokens,
				outTokens: delta.outputTokens
			};
			if (delta.cacheReadTokens > 0) usage.cacheReadTokens = delta.cacheReadTokens;
			if (delta.cacheWriteTokens > 0) usage.cacheWriteTokens = delta.cacheWriteTokens;
			recordLlmCall(kind, "", "", Math.max(0, Date.now() - stagedAt), usage, label);
		}
		/** In-flight follow-up redraw AbortControllers per workspace root: the
		* panel's「取消」button (while a redraw is running) aborts the matching
		* controller so the LLM stream stops and the cache is never overwritten. */
		followUpAbort = /* @__PURE__ */ new Map();
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
			if (typeof root !== "string") return Promise.resolve(root);
			const cached = this.graphCaches.get(root);
			if (cached !== void 0) return Promise.resolve(cached);
			if (this.graphInFlight !== null && this.graphInFlight.root === root) return this.graphInFlight.promise;
			const promise = this.graphFromDisk(root).then((fromDisk) => {
				if (fromDisk !== null) {
					console.log(`[arch-lens] graph: served from disk cache (root=${root})`);
					this.graphCaches.set(root, fromDisk);
					return fromDisk;
				}
				console.log(`[arch-lens] graph: no disk cache (root=${root}) — null; facts are built by rescan`);
				return null;
			});
			this.graphInFlight = {
				root,
				promise
			};
			return promise;
		}
		/** Read the persisted scan graph; null when absent, invalidated or foreign. */
		async graphFromDisk(root) {
			try {
				const fs = this.ctx.fs;
				const target = await fs.resolve(GRAPH_CACHE_FILE, { cwd: root }).catch(() => null);
				if (target === null) return null;
				const info = await fs.stat(target).catch(() => void 0);
				if (info === void 0 || info.type !== "file") return null;
				const parsed = JSON.parse(await fs.readText(target));
				if (typeof parsed !== "object" || parsed === null) return null;
				if (parsed.root !== root) return null;
				const graph = parsed.graph;
				if (typeof graph !== "object" || graph === null || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
				return graph;
			} catch {
				return null;
			}
		}
		/** Persist a fresh scan graph (non-fatal on failure) and return the new
		* facts version (generatedAt) written, or 0 when the write failed. */
		async writeGraphDisk(root, graph) {
			const generatedAt = Date.now();
			try {
				const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
				await this.ctx.fs.writeText(target, JSON.stringify({
					root,
					generatedAt,
					graph
				}), void 0, void 0, this.sessionPolicy());
				return generatedAt;
			} catch {
				return 0;
			}
		}
		/** Graph read for internal consumers: null (no facts built yet) collapses
		* to an error so callers never touch undefined nodes/edges. */
		async requireGraph() {
			const graph = await this.graph();
			if (graph === null) return { error: "no facts yet: run 重新扫描 (refresh) first" };
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
			if (typeof root !== "string") return root;
			const fileChanges = await checkWorkspaceChanges(this.ctx.fs, root, this.sessionPolicy());
			if (!fileChanges.changed) {
				const graph = await this.graph();
				if (graph === null) return {
					graph: null,
					changed: false,
					changes: null
				};
				if ("error" in graph) return graph;
				await this.ensureIndexEnvelope(root);
				return {
					graph,
					changed: false,
					changes: null
				};
			}
			const oldGraph = await this.graph();
			const oldIds = oldGraph !== null && !("error" in oldGraph) ? oldGraph.nodes.map((node) => node.id) : [];
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `refresh: ${blocked}` };
			this.graphCaches.clear();
			this.graphInFlight = null;
			try {
				const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
				await this.ctx.fs.writeText(target, JSON.stringify({
					root,
					invalidated: true,
					generatedAt: Date.now()
				}), void 0, void 0, this.sessionPolicy());
			} catch {}
			await this.refreshCodeIndex();
			await this.removeAICaches();
			const scanned = await scanWorkspace(this.ctx.fs, root);
			if ("error" in scanned) return scanned;
			const changes = computeChangedPackages(fileChanges, oldIds, scanned.nodes.map((node) => node.id));
			const newVersion = await this.writeGraphDisk(root, scanned);
			await selectiveInvalidate(this.ctx.fs, root, new Set(changes.changedPackages), newVersion, this.sessionPolicy());
			await this.ensureIndexEnvelope(root);
			this.graphCaches.set(root, scanned);
			return {
				graph: scanned,
				changed: true,
				changes
			};
		}
		/**
		* Refresh only the code-index facts (in-memory + disk invalidated). Used by
		* "refresh this figure": the figure then re-derives from a fresh index.
		* @returns acknowledgement.
		*/
		async remoteRefreshIndex() {
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `refresh index: ${blocked}` };
			await this.refreshCodeIndex();
			return { ok: true };
		}
		/**
		* 「全量重建」: regenerate AI figures from the CURRENT facts. 智能增量
		* (incremental=true, 前端「全量重建」/「变动更新」按钮的默认路径)：每张
		* 实体级图先检查缓存是否失效（v ≠ 当前 factsVersion 或缺失），失效才
		* force=true 重绘，未失效直接跳过——重新扫描已做精确失效，所以这里只补
		* 涉及变动包的图；全部有效时零 LLM、秒回。incremental=false 保持旧语义
		* （无条件全部重绘）。方法级（-methods）不在此路径（按需生成）。
		* @param request - role language + 是否智能增量。
		* @returns rebuilt/skipped 图清单，或第一个生成错误（所有步骤都跑）。
		*/
		async remoteGenerateAll(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const graph = await this.requireGraph();
			if ("error" in graph) return graph;
			const language = request.language ?? "中文";
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `generateAll: ${blocked}` };
			let index;
			try {
				index = await this.indexWorkspaceShared(root);
			} catch (error) {
				return { error: `codeIndex unavailable: ${error instanceof Error ? error.message : String(error)}` };
			}
			const policy = this.sessionPolicy();
			const fs = this.ctx.fs;
			const incremental = request.incremental === true;
			const outcome = await runEntityFigurePass({
				ctx: this.ctx,
				fs,
				root,
				index,
				graph,
				language,
				policy
			}, incremental);
			if (outcome.errors.length > 0) return { error: `generateAll: ${outcome.errors.join("; ")}` };
			return {
				ok: true,
				rebuilt: outcome.rebuilt,
				skipped: outcome.skipped
			};
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
			await this.adoptLlmStats();
			return { ok: true };
		}
		/**
		* Fold the workspace's persisted LLM ledger (`index/.arch-lens-llm-stats.json`)
		* into the running accounting. The disk file is treated as the historical
		* ledger and adoption is once-per-process (llmStatsAdopted gate), so this
		* is safe to call from every entry point that runs before the first write.
		*/
		async adoptLlmStats() {
			if (llmStatsAdopted()) return;
			const root = this.resolveRoot();
			if (typeof root !== "string") return;
			try {
				const target = await this.ctx.fs.resolve(`${CACHE_DIR}/.arch-lens-llm-stats.json`, { cwd: root });
				const info = await this.ctx.fs.stat(target);
				if (info === void 0 || info.type !== "file") return;
				const text = await this.ctx.fs.readText(target);
				hydrateLlmStats(JSON.parse(text));
			} catch {}
		}
		/** Invalidate the code-index for the workspace (no-op when unavailable). */
		async refreshCodeIndex() {
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return;
			const root = this.resolveRoot();
			if (typeof root !== "string") return;
			try {
				await codeIndex.refresh(root, this.sessionPolicy());
			} catch (error) {
				console.warn(`[arch-lens] code-index refresh failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		/**
		* Ensure the on-disk code-index envelope is valid against the CURRENT facts
		* version, rebuilding through the shared loader when it is not (blanked by
		* provider.refresh, stale, or lost to a crashed rescan).
		*
		* Best-effort AND time-boxed: a full-workspace parse can run for minutes on
		* a large monorepo, far beyond the rescan RPC budget, so the shared loader
		* is started (or joined if already in flight) and awaited only up to a cap.
		* Small workspaces finish inline so the call graph opens on the first try;
		* big ones keep building in the background — the in-flight promise survives
		* on `indexInFlight`, writes the envelope when done, and later reads serve
		* from it. A rebuild failure never fails the caller's rescan: the graph
		* facts are already established and the affected tabs keep their rescan hint.
		* @param root - workspace root.
		*/
		async ensureIndexEnvelope(root) {
			if (!("error" in await readIndexFacts(this.ctx.fs, root))) return;
			const rebuild = this.indexWorkspaceShared(root).then(() => void 0, (error) => {
				console.warn(`[arch-lens] refresh: code index rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
			});
			if (await Promise.race([rebuild.then(() => "done"), new Promise((resolve) => {
				setTimeout(() => resolve("pending"), INDEX_ENVELOPE_TIMEBOX_MS).unref?.();
			})]) === "pending") console.log("[arch-lens] refresh: code index rebuild continues in background (large workspace)");
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
			if ("error" in graph) return graph;
			const node = graph.nodes.find((candidate) => candidate.id === request.id);
			if (node === void 0) return { error: `unknown component: ${request.id}` };
			return node.detail;
		}
		/**
		* The note file listing, newest first.
		* @returns notes listing or an error.
		*/
		async remoteNotes() {
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
		async remoteMermaidDeps() {
			const graph = await this.requireGraph();
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
		async remoteMermaidEr() {
			const graph = await this.requireGraph();
			if ("error" in graph) return graph;
			return {
				kind: "erDiagram",
				source: packageErDiagram(graph)
			};
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
			if (typeof root !== "string") return root;
			if (this.ctx.get("codeIndex") === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await this.indexWorkspaceShared(root);
				if (index.language === "unknown") return { error: "unsupported workspace language (no package.json / pyproject.toml / pom.xml)" };
				return request.kind === "flowchart" ? {
					kind: "flowchart",
					source: importFlowchart(index)
				} : {
					kind: "erDiagram",
					source: entityErDiagram(index)
				};
			} catch (error) {
				return { error: `indexed mermaid failed: ${error instanceof Error ? error.message : String(error)}` };
			}
		}
		/**
		* 「调用关系图」真实数据源 — READ ONLY: the real cross-package import
		* reference edges from the versioned code-index disk cache (facts written
		* by 「↻ 重新扫描」 only, never by AI; version binding lives in
		* `readIndexFacts`). Pure cache read: no index-service call, no LLM. Edges
		* are returned in message shape so the client renders them with the same
		* call-graph view.
		* @param request - role language for edge labels.
		* @returns package-level edges, or an error telling the user to rescan first.
		*/
		async remoteCallGraph(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			try {
				const facts = await readIndexFacts(this.ctx.fs, root);
				if ("error" in facts) return facts;
				const edges = importEdges(facts.index);
				const verb = request.language === "English" ? "references" : "引用";
				const messages = [];
				for (const [from, tos] of edges) for (const to of tos) messages.push({
					from,
					to,
					label: `${verb} ${to}`
				});
				if (messages.length === 0) return { error: "工作区没有跨包 import 引用边" };
				return {
					ok: true,
					edges: messages
				};
			} catch (error) {
				return { error: `读取代码索引失败：${error instanceof Error ? error.message : String(error)}` };
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
			if (typeof root !== "string") return root;
			try {
				const core = await readCore(this.ctx.fs, root, request.language ?? "中文", request.methodLevel === true);
				if (core === null) return null;
				const graph = await this.requireGraph();
				if ("error" in graph) return graph;
				const source = request.kind === "flowchart" ? coreFlowchartFromGraph(graph, core.ids) : coreErDiagramFromGraph(graph, core.ids);
				return {
					kind: request.kind,
					source,
					core
				};
			} catch (error) {
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
			if (typeof root !== "string") return root;
			try {
				const language = request.language ?? "中文";
				const core = await readCore(this.ctx.fs, root, language, false);
				if (core === null) return null;
				const graph = await this.requireGraph();
				if ("error" in graph) return graph;
				const blurbOf = (id) => {
					const node = graph.nodes.find((candidate) => candidate.id === id);
					if (node === void 0) return "";
					return language === "English" ? node.blurb : node.blurbZh ?? node.blurb;
				};
				return {
					title: "架构概览",
					mermaid: overviewFigureFromGraph(graph, core.ids, blurbOf),
					core
				};
			} catch (error) {
				return { error: `overview figure failed: ${error instanceof Error ? error.message : String(error)}` };
			}
		}
		/** Shared codeIndex accessor for the concept/docs remotes. The optional
		* third `factsVersion` argument binds the provider's disk cache to the
		* single change anchor (see indexWorkspaceShared). */
		codeIndexService() {
			return this.ctx.get("codeIndex");
		}
		/**
		* Session-scoped sandbox policy for every file write: the fs sandbox
		* derives its workspace-write containment root from the calling session's
		* cwd — the same root this service writes to — so passing it approves the
		* writes.
		*/
		sessionPolicy() {
			return sessionPolicy(this.ctx, this.targetSessionId);
		}
		/**
		* Pre-flight write check for the LLM-generating write paths (generateAll,
		* AI 生成, 追问重画, 文档, rescan rebuild): when the session sandbox is
		* read-only every cache write would be denied — refusing BEFORE the (often
		* minutes-long) LLM passes saves the user from "生成跑完了但一个缓存都没写
		* 进去" (the symptom reported from a read-only generateAll). Callers return
		* the message as their error result.
		* @returns an error message when writes are impossible, null when OK.
		*/
		ensureWritable() {
			if (this.sessionPolicy().mode === "read-only") return "会话为只读模式，无法写入图缓存（生成结果无处落盘）：请将文件策略切换为「可写」后再试。本次未执行 AI 生成。";
			return null;
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
			if (typeof root !== "string") return root;
			try {
				return await readConceptTree(this.ctx.fs, root, request.language ?? "中文", request.methodLevel === true);
			} catch (error) {
				return { error: `concept tree read failed: ${error instanceof Error ? error.message : String(error)}` };
			}
		}
		/**
		* Generate the complete architecture doc (global button) — 阶段 4 组装链
		* (D8)：文档正文【零 LLM】，全部章节由图缓存渲染；某节对应图缺失/过期时，
		* 先经该图自己的构建链补建（缓存→文档→档案→LLM，统一写路径回缓存），再
		* 组装。文档不再反哺任何图缓存（旧"文档后补写/重建概念树"回灌已删）。
		* @param request - role language.
		* @returns the doc path or an error.
		*/
		async remoteGenerateDocs(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `generate docs: ${blocked}` };
			const inFlight = this.docInFlight;
			if (inFlight !== null && inFlight.root === root) return inFlight.promise;
			const promise = (async () => {
				try {
					if (this.codeIndexService() === void 0) return { error: "codeIndex service unavailable" };
					const graph = await this.requireGraph();
					if ("error" in graph) return graph;
					const index = await this.indexWorkspaceShared(root);
					const result = await generateDocsFromFigures(this.ctx, this.ctx.fs, root, index, graph, request.language ?? "中文", this.sessionPolicy());
					if ("error" in result) return result;
					for (const failure of result.errors) console.warn(`[arch-lens] doc assembly section skipped: ${failure}`);
					return { path: result.path };
				} catch (error) {
					return { error: `generate docs failed: ${error instanceof Error ? error.message : String(error)}` };
				}
			})().finally(() => {
				if (this.docInFlight?.root === root) this.docInFlight = null;
			});
			this.docInFlight = {
				root,
				promise
			};
			return promise;
		}
		/**
		* Regenerate one doc section on demand (per-tab "AI 生成") — 组装链单节版：
		* 该节的图走注册表缓存/构建链，正文渲染零 LLM，merge 进生成文档的对应
		* `## 标题` 节。
		* @param request - section kind and role language.
		* @returns the doc path or an error.
		*/
		async remoteGenerateDocSection(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `generate doc section: ${blocked}` };
			if (this.codeIndexService() === void 0) return { error: "codeIndex service unavailable" };
			try {
				const graph = await this.requireGraph();
				if ("error" in graph) return graph;
				const index = await this.indexWorkspaceShared(root);
				return await generateDocSection(this.ctx, this.ctx.fs, root, index, graph, request.language ?? "中文", request.kind, this.sessionPolicy());
			} catch (error) {
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
			if (typeof root !== "string") return root;
			try {
				return await readSequence(this.ctx.fs, root, request.language ?? "中文", request.methodLevel === true);
			} catch (error) {
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
			if (typeof root !== "string") return root;
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `regenerate figure: ${blocked}` };
			if (this.codeIndexService() === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await this.indexWorkspaceShared(root);
				const language = request.language ?? "中文";
				const methods = request.methodLevel === true;
				if (methods) return await this.regenerateFigureMethodLevel(request.kind, index, language);
				const kind = request.kind === "concepts" ? "concept" : request.kind === "deps" || request.kind === "er" ? "core" : request.kind === "interaction" ? "events" : request.kind;
				const profile = await regenerateProfileField(this.ctx, this.ctx.fs, root, index, language, kind, this.sessionPolicy());
				const writeFigure = async (figureKind, parsed, angle) => {
					try {
						await writeFigureCache(this.ctx.fs, root, index, figureKind, parsed, language, angle, methods, this.sessionPolicy());
					} catch (error) {
						console.warn(`[arch-lens] regenerate cache write failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				};
				switch (request.kind) {
					case "concepts": {
						const tree = profile.conceptTree;
						if (tree === void 0 || tree.length === 0) return { error: "concept regeneration produced no tree" };
						writeFigure("concepts", { conceptTree: tree });
						return {
							kind: "concepts",
							tree
						};
					}
					case "seq": {
						const messages = profile.seqMessages;
						if (messages === void 0 || messages.length === 0) return { error: "seq regeneration produced no messages" };
						writeFigure("seq", { seqMessages: messages });
						return {
							kind: "seq",
							messages
						};
					}
					case "flow": {
						if (profile.flow === void 0 || Object.keys(profile.flow).length === 0) return { error: "flow regeneration produced no diagram" };
						const flows = {};
						for (const [angle, flow] of Object.entries(profile.flow)) {
							flows[angle] = {
								title: flow.title,
								source: "flow",
								angle,
								mermaid: sanitizeMermaid(flow.mermaid)
							};
							writeFigure("flow", {
								title: flow.title,
								mermaid: flow.mermaid
							}, angle);
						}
						return {
							kind: "flow",
							flows
						};
					}
					case "interaction": {
						const events = profile.events;
						if (events === void 0 || events.length === 0) return { error: "events regeneration produced no events" };
						writeFigure("interaction", { events });
						return {
							kind: "interaction",
							events
						};
					}
					default:
						if (profile.coreIds.length < 4) return { error: "core regeneration produced too few packages" };
						writeFigure("core", { core: profile.coreIds });
						return {
							kind: "core",
							core: {
								ids: profile.coreIds,
								source: "flow"
							}
						};
				}
			} catch (error) {
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
			if (typeof root !== "string") return root;
			try {
				switch (kind) {
					case "concepts": {
						const tree = await generateFromFlow(this.ctx, index, language, generationSignal(root), true);
						if (tree.length === 0) return { error: "concept method-level generation produced no tree" };
						return {
							kind: "concepts",
							tree
						};
					}
					case "seq": {
						const generated = await writeStructuredCache(this.ctx, this.ctx.fs, root, index, language, "seq", this.sessionPolicy(), true);
						if (!Array.isArray(generated) || generated.length === 0) return { error: "seq method-level generation produced no messages" };
						return {
							kind: "seq",
							messages: generated
						};
					}
					case "flow": {
						const flows = {};
						for (const angle of ["event", "pipeline"]) {
							const flow = await flowDiagram(this.ctx, this.ctx.fs, root, index, language, true, angle, this.sessionPolicy(), true);
							if (!("error" in flow)) flows[angle] = flow;
						}
						if (Object.keys(flows).length === 0) return { error: "flow method-level generation produced no diagram" };
						return {
							kind: "flow",
							flows
						};
					}
					case "interaction": {
						const generated = await writeStructuredCache(this.ctx, this.ctx.fs, root, index, language, "interaction", this.sessionPolicy(), true);
						if (!Array.isArray(generated) || generated.length === 0) return { error: "events method-level generation produced no events" };
						return {
							kind: "interaction",
							events: generated
						};
					}
					default: {
						const core = await coreGraph(this.ctx, this.ctx.fs, root, index, language, true, this.sessionPolicy(), true);
						if ("error" in core) return { error: core.error };
						return {
							kind: "core",
							core: {
								ids: core.ids,
								source: core.source
							}
						};
					}
				}
			} catch (error) {
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
			if (sessionId === null) return { error: "no target session" };
			const session = this.ctx.get("sessions")?.get(sessionId);
			if (session === void 0) return { error: "session not found" };
			try {
				const messages = session.deriveMessages();
				for (let i = messages.length - 1; i >= 0; i -= 1) {
					const message = messages[i];
					if (message === void 0 || message.role !== "assistant") continue;
					let text = "";
					let reasoning = "";
					for (const block of message.content) if (block.type === "text") text += block.text;
					else if (block.type === "reasoning") reasoning += block.text;
					if (text.trim() !== "" || reasoning.trim() !== "") return {
						text,
						reasoning
					};
				}
				return {
					text: "",
					reasoning: ""
				};
			} catch (error) {
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
			if (typeof root !== "string") return null;
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
			if (typeof root !== "string") return null;
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
			if (typeof root !== "string") return root;
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `figure prompt: ${blocked}` };
			if (this.codeIndexService() === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await this.indexWorkspaceShared(root);
				const language = request.language ?? "中文";
				const kind = request.kind === "deps" || request.kind === "er" ? "core" : request.kind === "interaction" ? "interaction" : request.kind;
				const angle = request.kind === "flow" ? request.angle ?? "event" : void 0;
				const methodLevel = request.methodLevel === true;
				const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
				const prompt = buildFigurePrompt(kind, index, language, figId, angle, methodLevel);
				const usageStart = this.sessionUsageSnapshot(this.targetSessionId);
				this.pendingFigure = {
					figId,
					kind,
					language,
					...angle !== void 0 ? { angle } : {},
					methodLevel,
					sessionId: this.targetSessionId,
					stagedAt: Date.now(),
					...usageStart !== void 0 ? { usageStart } : {},
					index
				};
				setTimeout(() => {
					if (this.pendingFigure?.figId === figId) this.pendingFigure = null;
				}, 1800 * 1e3);
				return {
					figId,
					prompt
				};
			} catch (error) {
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
			if (typeof root !== "string") return root;
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `dynamic figure prompt: ${blocked}` };
			if (this.codeIndexService() === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await this.indexWorkspaceShared(root);
				const language = request.language ?? "中文";
				const kind = request.kind === "seq-edge" ? "seq-edge" : request.kind === "overview" ? "overview" : "flow-subgraph";
				const targetKey = dynamicTargetKey(kind, request.target);
				const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
				const existing = await this.readDynamicFigureFromDisk(root, kind, targetKey, language);
				const prompt = buildDynamicFigurePrompt(kind, index, language, figId, request.target, request.context?.mermaid, request.context?.blurbs, existing ?? void 0);
				const usageStart = this.sessionUsageSnapshot(this.targetSessionId);
				this.pendingFigure = {
					figId,
					kind,
					language,
					sessionId: this.targetSessionId,
					stagedAt: Date.now(),
					...usageStart !== void 0 ? { usageStart } : {},
					index,
					dynamic: {
						kind,
						targetKey
					}
				};
				setTimeout(() => {
					if (this.pendingFigure?.figId === figId) this.pendingFigure = null;
				}, 1800 * 1e3);
				return {
					figId,
					prompt
				};
			} catch (error) {
				return { error: `dynamic figure prompt failed: ${error instanceof Error ? error.message : String(error)}` };
			}
		}
		/** Read one cached dynamic figure (`index/.arch-lens-dynamic-<kind>-<hash>[-<lang>].json`),
		* or null when absent / unreadable / stale (version-bound read, D1: an
		* invalidated or outdated drill-down must NOT be served — the client's hover
		* then re-triggers generation; legacy unversioned files read as null too).
		* Shared by the read RPC and the re-drill prompt builder (same-family
		* incremental reuse). */
		async readDynamicFigureFromDisk(root, kind, targetKey, language) {
			try {
				const target = await this.ctx.fs.resolve(dynamicFigureCacheName(kind, targetKey, language), { cwd: root });
				const factsVersion = await readFactVersion(this.ctx.fs, root);
				const parsed = await readVersionedCache(this.ctx.fs, target, factsVersion);
				if (parsed === null || typeof parsed.diagram !== "string" || parsed.diagram === "") return null;
				return {
					title: typeof parsed.title === "string" ? parsed.title : "",
					diagram: parsed.diagram,
					summary: typeof parsed.summary === "string" ? parsed.summary : ""
				};
			} catch {
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
			if (typeof root !== "string") return root;
			const kind = request.kind === "seq-edge" ? "seq-edge" : request.kind === "overview" ? "overview" : "flow-subgraph";
			const language = request.language ?? "中文";
			const cached = await this.readDynamicFigureFromDisk(root, kind, request.targetKey, language);
			if (cached === null) return null;
			return {
				title: cached.title,
				diagram: cached.diagram,
				kind,
				targetKey: request.targetKey
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
			if (typeof root !== "string") return root;
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `custom figure prompt: ${blocked}` };
			if (this.codeIndexService() === void 0) return { error: "codeIndex service unavailable" };
			const text = (request.text ?? "").trim();
			if (text === "") return { error: "empty draw request" };
			try {
				const index = await this.indexWorkspaceShared(root);
				const language = request.language ?? "中文";
				let figureId = request.figureId;
				const existing = figureId !== void 0 ? this.customFigures.get(figureId) ?? await this.readDrawFromDisk(root, figureId) : null;
				if (figureId === void 0) figureId = await this.allocateFigureId(root);
				const figId = `fig-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
				const prompt = buildCustomFigurePrompt(index, text, language, figId, request.context?.blurbs ?? {}, existing === null ? void 0 : {
					title: existing.title,
					diagram: existing.diagram,
					summary: existing.summary
				});
				const usageStart = this.sessionUsageSnapshot(this.targetSessionId);
				this.pendingCustomFigure = {
					figId,
					figureId,
					text,
					language,
					stagedAt: Date.now(),
					...usageStart !== void 0 ? { usageStart } : {}
				};
				setTimeout(() => {
					if (this.pendingCustomFigure?.figId === figId) this.pendingCustomFigure = null;
				}, 1800 * 1e3);
				return {
					figId,
					figureId,
					prompt
				};
			} catch (error) {
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
			if (typeof root !== "string") return root;
			if (request.figureId !== void 0 && request.figureId !== "") {
				const mem = this.customFigures.get(request.figureId);
				if (mem !== void 0) return {
					figureId: mem.figureId,
					title: mem.title,
					diagram: mem.diagram,
					summary: mem.summary,
					text: mem.text,
					saved: mem.saved
				};
				const disk = await this.readDrawFromDisk(root, request.figureId);
				if (disk !== null) return {
					...disk,
					saved: true
				};
				return null;
			}
			let newestMem = null;
			for (const entry of this.customFigures.values()) if (newestMem === null || entry.at > newestMem.at) newestMem = {
				figureId: entry.figureId,
				title: entry.title,
				diagram: entry.diagram,
				summary: entry.summary,
				text: entry.text,
				at: entry.at
			};
			if (newestMem !== null) return {
				figureId: newestMem.figureId,
				title: newestMem.title,
				diagram: newestMem.diagram,
				summary: newestMem.summary,
				text: newestMem.text
			};
			const saved = await this.readNewestDraw(root);
			if (saved !== null) return {
				...saved,
				saved: true
			};
			return null;
		}
		/** Parse one `.arch-lens-draw-*.json` file into its figure record. figureId
		* comes from the file's `figureId` field when present, else the file name
		* (`dynamic-N` for scene saves, the hash part for legacy text-hash saves).
		* Returns null for unreadable, diagram-less, or tombstoned (deleted) files. */
		drawFileRecord(name, parsed) {
			if (parsed.deleted === true) return null;
			if (typeof parsed.diagram !== "string" || parsed.diagram === "") return null;
			const match = /^\.arch-lens-draw-dynamic-(\d+)-/.exec(name);
			return {
				figureId: typeof parsed.figureId === "string" && parsed.figureId !== "" ? parsed.figureId : match !== null ? `dynamic-${match[1]}` : name.replace(/^\.arch-lens-draw-/, "").replace(/-[A-Za-z0-9_-]*\.json$/, ""),
				title: typeof parsed.title === "string" ? parsed.title : "",
				diagram: parsed.diagram,
				summary: typeof parsed.summary === "string" ? parsed.summary : "",
				text: typeof parsed.text === "string" ? parsed.text : "",
				savedAt: typeof parsed.savedAt === "string" ? Date.parse(parsed.savedAt) : 0
			};
		}
		/** Scan `index/` then the workspace root (legacy saves) for every saved
		* custom figure file. Tombstoned (deleted) files are filtered out. */
		async readSavedDraws(root) {
			const fs = this.ctx.fs;
			const out = [];
			for (const dir of [CACHE_DIR, "."]) try {
				const dirTarget = await fs.resolve(dir === "." ? "." : dir, { cwd: root });
				const entries = await fs.listDir(dirTarget);
				for (const entry of entries) {
					if (entry.type !== "file" || !entry.name.startsWith(".arch-lens-draw-") || !entry.name.endsWith(".json")) continue;
					try {
						const parsed = JSON.parse(await fs.readText(entry.target));
						const record = this.drawFileRecord(entry.name, parsed);
						if (record !== null) out.push(record);
					} catch {}
				}
			} catch {}
			return out;
		}
		/** Read ONE saved custom figure by figureId, or null. */
		async readDrawFromDisk(root, figureId) {
			const found = (await this.readSavedDraws(root)).find((record) => record.figureId === figureId);
			return found === void 0 ? null : {
				figureId: found.figureId,
				title: found.title,
				diagram: found.diagram,
				summary: found.summary,
				text: found.text
			};
		}
		/** Newest saved custom figure across disk (memory lost on restart), or null. */
		async readNewestDraw(root) {
			const records = await this.readSavedDraws(root);
			let newest = null;
			for (const record of records) if (newest === null || record.savedAt > newest.savedAt) newest = record;
			return newest === null ? null : {
				figureId: newest.figureId,
				title: newest.title,
				diagram: newest.diagram,
				summary: newest.summary,
				text: newest.text
			};
		}
		/** Next free per-workspace scene id: `dynamic-<maxExisting+1>`. Scans raw
		* file names (INCLUDING tombstoned ones) plus memory, so deleted numbers
		* never get reused. */
		async allocateFigureId(root) {
			const fs = this.ctx.fs;
			let max = 0;
			for (const dir of [CACHE_DIR, "."]) try {
				const dirTarget = await fs.resolve(dir === "." ? "." : dir, { cwd: root });
				const entries = await fs.listDir(dirTarget);
				for (const entry of entries) {
					if (entry.type !== "file") continue;
					const match = /^\.arch-lens-draw-dynamic-(\d+)-/.exec(entry.name);
					if (match !== null) max = Math.max(max, Number(match[1]));
				}
			} catch {}
			for (const key of this.customFigures.keys()) {
				const match = /^dynamic-(\d+)$/.exec(key);
				if (match !== null) max = Math.max(max, Number(match[1]));
			}
			return `dynamic-${max + 1}`;
		}
		/** Cache file name for a scene figure: `index/.arch-lens-draw-<figureId>[-<lang>].json`. */
		drawFileName(figureId, language) {
			const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
			return `${CACHE_DIR}/.arch-lens-draw-${figureId}-${safe === "" ? "default" : safe}.json`;
		}
		/**
		* List every custom figure scene: saved ones from disk (saved: true) merged
		* with this session's memory figures (unsaved ones show saved: false so the
		* panel can offer 保存). Ordered dynamic-N ascending, then legacy hashes.
		* @returns the scene list (figureId, title, text, saved), or an error.
		*/
		async remoteCustomFigureList() {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			try {
				const byId = /* @__PURE__ */ new Map();
				for (const record of await this.readSavedDraws(root)) {
					const entry = {
						figureId: record.figureId,
						title: record.title,
						text: record.text,
						saved: true
					};
					if (record.savedAt > 0) entry.savedAt = new Date(record.savedAt).toISOString();
					byId.set(record.figureId, entry);
				}
				for (const entry of this.customFigures.values()) byId.set(entry.figureId, {
					figureId: entry.figureId,
					title: entry.title,
					text: entry.text,
					saved: entry.saved
				});
				return [...byId.values()].sort((a, b) => {
					const na = /^dynamic-(\d+)$/.exec(a.figureId);
					const nb = /^dynamic-(\d+)$/.exec(b.figureId);
					if (na !== null && nb !== null) return Number(na[1]) - Number(nb[1]);
					if (na !== null) return -1;
					if (nb !== null) return 1;
					return a.figureId.localeCompare(b.figureId);
				});
			} catch (error) {
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
			if (typeof root !== "string") return root;
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `save custom figure: ${blocked}` };
			const result = this.customFigures.get(request.figureId);
			if (result === void 0) return { error: "figure not found: generate the scene first" };
			const language = request.language ?? "中文";
			try {
				const name = this.drawFileName(request.figureId, language);
				const target = await this.ctx.fs.resolve(name, { cwd: root });
				await this.ctx.fs.writeText(target, JSON.stringify({
					figureId: result.figureId,
					title: result.title,
					diagram: result.diagram,
					summary: result.summary,
					text: result.text,
					savedAt: (/* @__PURE__ */ new Date()).toISOString()
				}, null, 2), void 0, void 0, this.sessionPolicy());
				result.saved = true;
				return {
					ok: true,
					path: target.displayPath
				};
			} catch (error) {
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
			if (typeof root !== "string") return root;
			if (request.figureId === "") return { error: "empty figureId" };
			try {
				const fs = this.ctx.fs;
				for (const dir of [CACHE_DIR, "."]) try {
					const dirTarget = await fs.resolve(dir === "." ? "." : dir, { cwd: root });
					const entries = await fs.listDir(dirTarget);
					for (const entry of entries) {
						if (entry.type !== "file" || !entry.name.startsWith(`.arch-lens-draw-${request.figureId}-`) || !entry.name.endsWith(".json")) continue;
						try {
							await unlink(fs.processPath(entry.target));
						} catch {}
					}
				} catch {}
				this.customFigures.delete(request.figureId);
				return { ok: true };
			} catch (error) {
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
			if (typeof root !== "string") return root;
			if (request.followUp.trim() === "") return { error: "empty follow-up text" };
			const blocked = this.ensureWritable();
			if (blocked !== null) return { error: `figure follow-up: ${blocked}` };
			if (this.codeIndexService() === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await this.indexWorkspaceShared(root);
				const controller = new AbortController();
				this.followUpAbort.set(root, controller);
				try {
					return await figureFollowUp(this.ctx, this.ctx.fs, root, index, {
						...request,
						language: request.language ?? "中文"
					}, this.sessionPolicy(), controller.signal);
				} finally {
					if (this.followUpAbort.get(root) === controller) this.followUpAbort.delete(root);
				}
			} catch (error) {
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
			if (typeof root !== "string") return { ok: false };
			const controller = this.followUpAbort.get(root);
			if (controller === void 0) return { ok: false };
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
			if (typeof root !== "string") return { ok: false };
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
			if (typeof root !== "string") return root;
			try {
				const cached = await readStructuredCache(this.ctx.fs, root, request.language ?? "中文", "interaction", request.methodLevel === true);
				if (cached !== null) console.log(`[arch-lens] events: served from cache (read-only, methodLevel=${request.methodLevel === true})`);
				return cached;
			} catch (error) {
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
			if (typeof root !== "string") return root;
			try {
				return await readFlow(this.ctx.fs, root, request.language ?? "中文", request.angle ?? "event", request.methodLevel === true);
			} catch (error) {
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
			if ("error" in graph) return graph;
			return analyzeWorkspace(this.ctx.fs, graph);
		}
		/**
		* AI one-line duty summaries for the package catalog. READ (default): serve
		* the persisted cache AS IS — possibly partial (generation batches stop at
		* the RPC budget). The catalog is a SCAN fact (每包的 README/description 兜底
		* 是 dutyText 的行级契约), so withholding the whole table over uncovered rows
		* turns "AI 覆盖了 80/247" into a永久空态: the incremental pass judges the
		* cache stamp-valid and never fills it, while a completeness-gated read never
		* serves it — the half-generated cache could neither grow nor be seen.
		* WRITE (force=true, the catalog「🤖 AI 生成」): generate the missing
		* summaries (LLM) and persist them (merges over the existing partial map).
		* @param request - output language (default 中文) and force flag.
		* @returns id → summary map (whatever is current), null when no cache exists
		*   at this facts version, or an error.
		*/
		async remoteSummarizeDuties(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const graph = await this.requireGraph();
			if ("error" in graph) return graph;
			const language = request.language ?? "中文";
			if (request.force === true) {
				const blocked = this.ensureWritable();
				if (blocked !== null) return { error: `summarize duties: ${blocked}` };
				return summarizeDuties(this.ctx, this.ctx.fs, root, graph, language, this.sessionPolicy());
			}
			return await readDutySummaries(this.ctx.fs, root, language);
		}
		/**
		* AI learning-progress summary: contrasts the note targets against the
		* scanned graph and appends a model-generated entry to the note file bottom.
		* @param request - role language and whether to force regeneration.
		* @returns progress stats plus the generated summary, or an error.
		*/
		async remoteProgress(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const graph = await this.requireGraph();
			if ("error" in graph) return graph;
			return summarizeProgress(this.ctx, this.ctx.fs, root, graph, this.notesFile, request.language ?? "中文", request.force === true, this.sessionPolicy());
		}
		/**
		* Read-only learning-progress statistics (no LLM call).
		* @returns asked/unasked lists and the coverage percentage.
		*/
		async remoteProgressStats() {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const graph = await this.requireGraph();
			if ("error" in graph) return graph;
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
			await this.adoptLlmStats();
			const snapshot = llmStatsSnapshot();
			const root = this.resolveRoot();
			if (typeof root === "string") try {
				const target = await this.ctx.fs.resolve(`${CACHE_DIR}/.arch-lens-llm-stats.json`, { cwd: root });
				await this.ctx.fs.writeText(target, JSON.stringify(snapshot, null, 2), void 0, void 0, this.sessionPolicy());
			} catch {}
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
			if (request.text === "") {
				this.pending = null;
				return { ok: true };
			}
			const usageStart = this.sessionUsageSnapshot(request.sessionId ?? null);
			this.pending = {
				target: request.target ?? "架构讲解",
				question: request.text ?? "",
				sessionId: request.sessionId ?? null,
				stagedAt: Date.now(),
				...usageStart !== void 0 ? { usageStart } : {}
			};
			return { ok: true };
		}
		/**
		* Read the persisted per-workspace prompt configuration.
		* @returns the config and its storage path.
		*/
		async remotePromptConfig() {
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
		async remotePromptConfigSave(request) {
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
				if (request.language !== void 0) merged.language = request.language;
				else if (existing.language !== void 0) merged.language = existing.language;
				if (request.useDefaults !== void 0) merged.useDefaults = request.useDefaults;
				else if (existing.useDefaults !== void 0) merged.useDefaults = existing.useDefaults;
				await fs.writeText(target, JSON.stringify(merged, null, 2), void 0, void 0, this.sessionPolicy());
				return {
					path: PROMPT_CONFIG_FILE,
					config: merged
				};
			} catch (error) {
				return { error: `prompt config save failed: ${error instanceof Error ? error.message : String(error)}` };
			}
		}
		/** Register the single note-write path: assistant/message events. */
		async [(_remoteGraph_decorators = [Remote("graph")], _remoteRefresh_decorators = [Remote("refresh")], _remoteRefreshIndex_decorators = [Remote("refreshIndex")], _remoteGenerateAll_decorators = [Remote("generateAll")], _remoteSetSession_decorators = [Remote("setSession")], _remoteComponent_decorators = [Remote("component")], _remoteNotes_decorators = [Remote("notes")], _remoteMermaidDeps_decorators = [Remote("mermaidDeps")], _remoteMermaidEr_decorators = [Remote("mermaidEr")], _remoteMermaidIndexed_decorators = [Remote("mermaidIndexed")], _remoteCallGraph_decorators = [Remote("callGraph")], _remoteMermaidCore_decorators = [Remote("mermaidCore")], _remoteOverviewFigure_decorators = [Remote("overviewFigure")], _remoteConceptTree_decorators = [Remote("conceptTree")], _remoteGenerateDocs_decorators = [Remote("generateDocs")], _remoteGenerateDocSection_decorators = [Remote("generateDocSection")], _remoteSequence_decorators = [Remote("sequence")], _remoteRegenerateFigure_decorators = [Remote("regenerateFigure")], _remoteLastAnswer_decorators = [Remote("lastAnswer")], _remoteGenerationStatus_decorators = [Remote("generationStatus")], _remoteGenerationStatusNext_decorators = [Remote("generationStatusNext")], _remoteFigurePrompt_decorators = [Remote("figurePrompt")], _remoteDynamicFigurePrompt_decorators = [Remote("dynamicFigurePrompt")], _remoteDynamicFigure_decorators = [Remote("dynamicFigure")], _remoteCustomFigurePrompt_decorators = [Remote("customFigurePrompt")], _remoteCustomFigure_decorators = [Remote("customFigure")], _remoteCustomFigureList_decorators = [Remote("customFigureList")], _remoteSaveCustomFigure_decorators = [Remote("saveCustomFigure")], _remoteCustomFigureDelete_decorators = [Remote("customFigureDelete")], _remoteFigureFollowUp_decorators = [Remote("figureFollowUp")], _remoteCancelFollowUp_decorators = [Remote("cancelFollowUp")], _remoteCancelGeneration_decorators = [Remote("cancelGeneration")], _remoteEvents_decorators = [Remote("events")], _remoteFlow_decorators = [Remote("flow")], _remoteAnalyze_decorators = [Remote("analyze")], _remoteSummarizeDuties_decorators = [Remote("summarizeDuties")], _remoteProgress_decorators = [Remote("progress")], _remoteProgressStats_decorators = [Remote("progressStats")], _remoteLlmStats_decorators = [Remote("llmStats")], _remoteNotePending_decorators = [Remote("notePending")], _remotePromptConfig_decorators = [Remote("promptConfig")], _remotePromptConfigSave_decorators = [Remote("promptConfigSave")], Service.init)]() {
			this.ctx.on("session/event", (session, event) => {
				if (event.type !== "assistant/message") return;
				const message = event.data.message;
				let answer = "";
				for (const block of message.content) if (block.type === "text") answer += block.text;
				if (answer.trim() === "") return;
				const stagedFigure = this.pendingFigure;
				if (stagedFigure !== null) {
					const parsed = extractFigureJson(answer, stagedFigure.figId);
					if (parsed !== null) {
						this.pendingFigure = null;
						this.recordSessionUsage("figure", stagedFigure.dynamic === void 0 ? "AI 生成" : "动态下钻", stagedFigure.stagedAt, stagedFigure.usageStart, session.id);
						const root = session.header.cwd ?? this.rootFromPolicy();
						if (root !== void 0) (stagedFigure.dynamic === void 0 ? writeFigureCache(this.ctx.fs, root, stagedFigure.index, stagedFigure.kind, parsed, stagedFigure.language, stagedFigure.angle, stagedFigure.methodLevel, sessionPolicy(this.ctx, session.id)) : (async () => {
							const dyn = stagedFigure.dynamic;
							const facts = await dynamicFigureWriteFacts(this.ctx.fs, root, dyn, stagedFigure.language, stagedFigure.angle, stagedFigure.index);
							return writeDynamicFigureCache(this.ctx.fs, root, dyn.kind, dyn.targetKey, parsed, stagedFigure.language, facts.factsVersion, facts.deps, sessionPolicy(this.ctx, session.id));
						})()).then((result) => {
							console.log(`[arch-lens] session figure ${stagedFigure.figId} (${stagedFigure.kind}): ${"ok" in result ? "cached" : result.error}`);
						});
					}
				}
				const stagedCustom = this.pendingCustomFigure;
				if (stagedCustom !== null) {
					const parsed = extractFigureJson(answer, stagedCustom.figId);
					if (parsed !== null) {
						this.pendingCustomFigure = null;
						this.recordSessionUsage("draw", "动态出图", stagedCustom.stagedAt, stagedCustom.usageStart, session.id);
						const value = extractCustomFigure(parsed);
						if (value !== void 0) {
							this.customFigures.set(stagedCustom.figureId, {
								figureId: stagedCustom.figureId,
								...value,
								text: stagedCustom.text,
								at: Date.now(),
								saved: false
							});
							console.log(`[arch-lens] custom figure ${stagedCustom.figureId} captured (memory only, not persisted)`);
						}
					}
				}
				if (this.pending !== null && this.pending.sessionId !== null && session.id !== this.pending.sessionId) return;
				const staged = this.pending;
				if (staged === null) return;
				this.pending = null;
				this.recordSessionUsage("explain", "讲解", staged.stagedAt, staged.usageStart, session.id);
				const root = session.header.cwd ?? this.rootFromPolicy();
				if (root === void 0) return;
				appendNote(this.ctx.fs, root, {
					target: staged.target,
					question: staged.question,
					answer
				}, this.notesFile, sessionPolicy(this.ctx, session.id)).then((result) => {
					if ("ok" in result && result.skipped === true) console.log("[arch-lens] note skipped: duplicate question (same target and question head)");
				});
			});
		}
		/** Policy-derived workspace root, used only when the event session has no cwd. */
		rootFromPolicy() {
			return this.ctx.get("sandboxPolicy")?.workspaceRoot;
		}
	};
})();
//#endregion
export { ArchLensService, ArchLensService as default, groupLabel };
