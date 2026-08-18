import { Service } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import s from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
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
//#region packages/arch-lens-backend/src/summarize.ts
/** Cache file base name; the role language is appended (sanitized). */
const SUMMARY_FILE_BASE = ".arch-lens-summaries";
/** Keep cache file names filesystem-safe. */
function cacheName$5(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${SUMMARY_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
}
/** Pull the JSON object out of a model answer, tolerating extra prose. */
function extractJson(text) {
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
	const target = await fs.resolve(cacheName$5(language), { cwd: root }).catch(() => null);
	let cached = {};
	if (target !== null) try {
		const info = await fs.stat(target);
		if (info !== void 0 && info.type === "file") cached = JSON.parse(await fs.readText(target));
	} catch {
		cached = {};
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
	for (const batch of missingBatches.slice(0, MAX_BATCHES_PER_CALL)) {
		const lines = graph.nodes.filter((node) => batch.includes(node.id)).map((node) => `- ${node.id}: ${node.blurb}`).join("\n");
		const prompt = `你是代码仓库分析助手。以下是一个代码仓库中 ${batch.length} 个 npm 包的短名与其官方英文描述。\n请为每个包写一行「职责总结」（简洁、准确、用自然语言说明这个包干什么）。\n输出语言：${language}。\n严格输出 JSON 对象（键=包短名，值=一行总结），不要输出任何其他内容：\n\n${lines}`;
		try {
			const prepared = await llm.prepareCall({
				provider: selection.provider,
				model: selection.model,
				temperature: 0
			});
			const cfg = prepared.config;
			let out = "";
			for await (const chunk of prepared.stream({
				provider: cfg.provider,
				model: cfg.model,
				...cfg.reasoningEffort === void 0 ? {} : { reasoningEffort: cfg.reasoningEffort },
				...cfg.temperature === void 0 ? {} : { temperature: cfg.temperature },
				...cfg.maxTokens === void 0 ? {} : { maxTokens: cfg.maxTokens },
				...cfg.stop === void 0 ? {} : { stop: cfg.stop },
				messages: [createUserMessage({
					content: [{
						type: "text",
						text: prompt
					}],
					source: { kind: "user" }
				})]
			})) if (chunk.type === "text-delta") out += chunk.text;
			const parsed = extractJson(out);
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
	if (target !== null) try {
		await fs.writeText(target, JSON.stringify(merged, null, 2), void 0, void 0, sandboxPolicy);
	} catch {}
	return merged;
}
//#endregion
//#region packages/arch-lens-backend/src/progress.ts
/** Cache file base name; the role language is appended (sanitized). */
const PROGRESS_FILE_BASE = ".arch-lens-progress";
/** Keep cache file names filesystem-safe. */
function cacheName$4(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${PROGRESS_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
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
	const cacheTarget = await fs.resolve(cacheName$4(language), { cwd: root }).catch(() => null);
	if (!force && cacheTarget !== null) try {
		const info = await fs.stat(cacheTarget);
		if (info !== void 0 && info.type === "file") {
			const cached = JSON.parse(await fs.readText(cacheTarget));
			console.log(`[arch-lens] progress: served from cache (lang=${language})`);
			return cached;
		}
	} catch {}
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
	try {
		const prepared = await llm.prepareCall({
			provider: selection.provider,
			model: selection.model,
			temperature: .3
		});
		const cfg = prepared.config;
		let out = "";
		for await (const chunk of prepared.stream({
			provider: cfg.provider,
			model: cfg.model,
			...cfg.reasoningEffort === void 0 ? {} : { reasoningEffort: cfg.reasoningEffort },
			...cfg.temperature === void 0 ? {} : { temperature: cfg.temperature },
			...cfg.maxTokens === void 0 ? {} : { maxTokens: cfg.maxTokens },
			...cfg.stop === void 0 ? {} : { stop: cfg.stop },
			messages: [createUserMessage({
				content: [{
					type: "text",
					text: prompt
				}],
				source: { kind: "user" }
			})]
		})) if (chunk.type === "text-delta") out += chunk.text;
		const summary = out.trim();
		if (summary === "") return { error: "progress failed: model returned an empty summary" };
		console.log(`[arch-lens] progress: generated ${summary.length} chars (lang=${language})`);
		const result = {
			path: notesFile,
			summary,
			asked,
			unasked,
			total,
			progress
		};
		if (cacheTarget !== null) try {
			await fs.writeText(cacheTarget, JSON.stringify(result, null, 2), void 0, void 0, sandboxPolicy);
		} catch {}
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
/** Keep cache file names filesystem-safe. */
function cacheName$3(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CONCEPT_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
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
async function detectArchDocs(fs, root, language) {
	for (const candidate of docCandidates(language)) try {
		const target = await fs.resolve(candidate, { cwd: root });
		const info = await fs.stat(target);
		if (info !== void 0 && info.type === "file") return target.displayPath;
	} catch {}
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
async function extractDocTree(fs, docPath) {
	const info = await fs.stat(await fs.resolve(docPath));
	if (info === void 0 || info.type !== "file") return [];
	const text = (await fs.readText(await fs.resolve(docPath))).slice(0, 262144);
	const roots = [];
	const stack = [];
	let currentDesc = "";
	let currentText = [];
	let pendingNode = null;
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
				id: `doc:${roots.length}-${stack.length}`,
				name,
				desc: "",
				source: "doc",
				ref: `${docPath.replace(/\\/g, "/")}#${heading[2].trim().replace(/\s+/g, "-")}`
			};
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
* @returns the induced tree (empty on failure).
*/
async function generateFromFlow(ctx, index, language) {
	const llm = ctx.get("llm");
	const defaultModel = ctx.get("agentDefaultModel");
	if (llm === void 0 || defaultModel === void 0) return [];
	try {
		const selection = defaultModel.currentSelection();
		const prepared = await llm.prepareCall({
			provider: selection.provider,
			model: selection.model,
			temperature: .3,
			maxTokens: 3e3
		});
		const cfg = prepared.config;
		const entryLines = index.packages.filter((pkg) => pkg.entryFiles.length > 0).slice(0, 30).map((pkg) => `- ${pkg.id}（入口：${pkg.entryFiles.slice(0, 3).join(", ")}，依赖：${pkg.deps.slice(0, 5).join(", ") || "无"}）`).join("\n");
		const prompt = `你是代码架构分析师。以下是某项目的包入口与依赖元数据。
请归纳这个项目「是怎么运作的」：识别运行核心概念（如入口、调度/主循环、能力模块、数据层、外部接口等，按项目实际归纳，不要生搬硬套），组织成概念层级树。
输出语言：${language}。\n严格输出 JSON 对象数组（最多 12 个根节点，每个节点含 name/desc/inside/children）：[{ "name": "...", "desc": "...", "inside": "...", "children": [] }]，不要输出其他内容。\n\n` + entryLines;
		let out = "";
		for await (const chunk of prepared.stream({
			provider: cfg.provider,
			model: cfg.model,
			...cfg.reasoningEffort === void 0 ? {} : { reasoningEffort: cfg.reasoningEffort },
			...cfg.temperature === void 0 ? {} : { temperature: cfg.temperature },
			...cfg.maxTokens === void 0 ? {} : { maxTokens: cfg.maxTokens },
			...cfg.stop === void 0 ? {} : { stop: cfg.stop },
			messages: [createUserMessage({
				content: [{
					type: "text",
					text: prompt
				}],
				source: { kind: "user" }
			})]
		})) if (chunk.type === "text-delta") out += chunk.text;
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
async function conceptTree(ctx, fs, root, index, language, force, sandboxPolicy) {
	const cacheTarget = await fs.resolve(cacheName$3(language), { cwd: root }).catch(() => null);
	if (!force && cacheTarget !== null) try {
		const info = await fs.stat(cacheTarget);
		if (info !== void 0 && info.type === "file") {
			const cached = JSON.parse(await fs.readText(cacheTarget));
			console.log(`[arch-lens] concept: served from cache (lang=${language})`);
			return cached;
		}
	} catch {}
	const writeCache = async (tree) => {
		if (cacheTarget === null) return;
		try {
			await fs.writeText(cacheTarget, JSON.stringify(tree), void 0, void 0, sandboxPolicy);
		} catch {}
	};
	const docPath = await detectArchDocs(fs, root, language);
	if (docPath !== null) {
		console.log(`[arch-lens] concept: doc chain (${docPath})`);
		const tree = await extractDocTree(fs, docPath);
		if (tree.length > 0) {
			await writeCache(tree);
			return tree;
		}
	}
	console.log("[arch-lens] concept: no usable doc headings — generating from flow");
	const tree = await generateFromFlow(ctx, index, language);
	if (tree.length === 0) return { error: "concept generation failed: no doc and LLM flow generation returned nothing" };
	await writeCache(tree);
	return tree;
}
//#endregion
//#region packages/arch-lens-backend/src/docsgen.ts
/** Marker proving a doc file was produced by this tool. */
const DOC_MARK = "<!-- arch-lens generated -->";
/** Primary target for generated docs. */
const DOC_FILE = "docs/architecture.md";
/** Alternative target when the primary exists without the marker. */
const DOC_FILE_AI = "docs/architecture.generated.md";
/** Section titles per dimension, used as `##` headings in the doc. */
const SECTION_TITLES = {
	concepts: "概念层级",
	seq: "时序",
	interaction: "核心交互",
	deps: "依赖",
	er: "实体关系",
	catalog: "包目录职责"
};
/** Cache file names for structured figure data (sequence/events). */
const SEQ_CACHE = ".arch-lens-sequence";
const EVENTS_CACHE = ".arch-lens-events";
/** Keep cache file names filesystem-safe. */
function cacheName$2(base, language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${base}-${safe === "" ? "default" : safe}.json`;
}
/** Resolve the doc target: primary when absent or already generated; else the AI variant. */
async function resolveDocTarget(fs, root) {
	try {
		const primary = await fs.resolve(DOC_FILE, { cwd: root });
		const info = await fs.stat(primary);
		if (info !== void 0 && info.type === "file") {
			if ((await fs.readText(primary)).includes(DOC_MARK)) return primary.displayPath;
			const ai = await fs.resolve(DOC_FILE_AI, { cwd: root });
			const aiInfo = await fs.stat(ai);
			return (aiInfo !== void 0 && aiInfo.type === "file" ? ai : await fs.resolve(DOC_FILE_AI, { cwd: root })).displayPath;
		}
	} catch {}
	return (await fs.resolve(DOC_FILE, { cwd: root })).displayPath;
}
/** Bounded summary lines of the code index for prompts (shared with flow.ts). */
function indexSummary(index) {
	const lines = [];
	for (const pkg of index.packages.slice(0, 60)) {
		const entities = pkg.entities.filter((e) => e.kind !== "method" && e.kind !== "field").slice(0, 8).map((e) => e.name);
		lines.push(`- ${pkg.id}（${pkg.language}）依赖: ${pkg.deps.slice(0, 6).join(", ") || "无"}；顶层实体: ${entities.join(", ") || "无"}；入口: ${pkg.entryFiles.slice(0, 2).join(", ") || "无"}`);
	}
	return lines.join("\n");
}
/**
* One LLM generation call with the standard config contract (shared with
* flow.ts). The output cap is optional: omitted, the request inherits the
* adapter's Config-owned default maxTokens instead of a local literal.
*/
async function llmText(ctx, prompt, temperature, maxTokens) {
	const llm = ctx.get("llm");
	const defaultModel = ctx.get("agentDefaultModel");
	if (llm === void 0 || defaultModel === void 0) throw new Error("llm or agentDefaultModel service missing");
	const selection = defaultModel.currentSelection();
	const prepared = await llm.prepareCall({
		provider: selection.provider,
		model: selection.model,
		temperature,
		...maxTokens === void 0 ? {} : { maxTokens }
	});
	const cfg = prepared.config;
	let out = "";
	for await (const chunk of prepared.stream({
		provider: cfg.provider,
		model: cfg.model,
		...cfg.reasoningEffort === void 0 ? {} : { reasoningEffort: cfg.reasoningEffort },
		...cfg.temperature === void 0 ? {} : { temperature: cfg.temperature },
		...cfg.maxTokens === void 0 ? {} : { maxTokens: cfg.maxTokens },
		...cfg.stop === void 0 ? {} : { stop: cfg.stop },
		messages: [createUserMessage({
			content: [{
				type: "text",
				text: prompt
			}],
			source: { kind: "user" }
		})]
	})) if (chunk.type === "text-delta") out += chunk.text;
	return out.trim();
}
/** Build the LLM prompt for one doc section. */
function sectionPrompt(kind, index, language) {
	const base = `你是代码架构文档作者。以下是某项目的代码索引摘要（包/依赖/实体/入口）。\n输出语言：${language}。\n不要输出代码块，直接输出 Markdown。\n\n项目摘要：\n${indexSummary(index)}\n\n`;
	switch (kind) {
		case "concepts": return base + "请输出「## 概念层级」章节：归纳项目是怎么运作的核心概念（运行角色/机制，不要列包清单），层级小节（### 子节）。";
		case "seq": return base + "请输出「## 时序」章节：描述一次典型主流程的调用顺序（谁→谁，什么顺序），用 Markdown 有序列表或 mermaid sequenceDiagram。";
		case "interaction": return base + "请输出「## 核心交互」章节：列出核心事件/服务交互（生产者→事件→消费者），用 Markdown 列表或 mermaid。";
		case "deps": return base + "请输出「## 依赖」章节：说明包/模块之间的依赖关系与分层，重点讲清楚谁依赖谁、为什么。";
		case "er": return base + "请输出「## 实体关系」章节：列出核心类/接口实体及其关系（继承/实现/引用），用 Markdown 列表或 mermaid erDiagram。";
		case "catalog": return base + "请输出「## 包目录职责」章节：为每个包写一行职责说明（简洁准确）。";
	}
}
/** Merge one section into the doc: replace the same-titled section or append. */
function mergeSection(existing, title, sectionBody) {
	const header = `## ${title}`;
	const pattern = new RegExp(`## ${title}\\s*[\\s\\S]*?(?=^## |\\z)`, "m");
	const block = `${header}\n\n${sectionBody.trim()}\n\n`;
	if (pattern.test(existing)) return existing.replace(pattern, block);
	return existing.replace(/\s*\z/, "\n\n") + block;
}
/** Write text to the doc target (create with marker when new). */
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
* Generate one doc section on demand (per-tab "AI generate"). Sequence and
* interaction also write structured caches for their figures.
* @param ctx - host context.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result.
* @param language - role language.
* @param kind - section dimension.
* @returns the doc target path, or an error.
*/
async function generateDocSection(ctx, fs, root, index, language, kind, sandboxPolicy) {
	try {
		const title = SECTION_TITLES[kind];
		const text = await llmText(ctx, sectionPrompt(kind, index, language), .3, 2e3);
		if (text === "") return { error: "doc section generation returned empty text" };
		const targetPath = await resolveDocTarget(fs, root);
		const target = await fs.resolve(targetPath);
		const info = await fs.stat(target).catch(() => void 0);
		await writeDoc(fs, targetPath, mergeSection(info !== void 0 && info.type === "file" ? await fs.readText(target) : "", title, text), sandboxPolicy);
		if (kind === "seq" || kind === "interaction") await writeStructuredCache(ctx, fs, root, index, language, kind, sandboxPolicy);
		return { path: targetPath };
	} catch (error) {
		return { error: `doc section failed: ${error instanceof Error ? error.message : String(error)}` };
	}
}
/**
* Generate the complete architecture doc in one pass (global button).
* @param ctx - host context.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result.
* @param language - role language.
* @returns the doc target path, or an error.
*/
async function generateFullDocs(ctx, fs, root, index, language, sandboxPolicy) {
	try {
		const kinds = [
			"concepts",
			"seq",
			"interaction",
			"deps",
			"er",
			"catalog"
		];
		const targetPath = await resolveDocTarget(fs, root);
		const target = await fs.resolve(targetPath);
		const info = await fs.stat(target).catch(() => void 0);
		let existing = info !== void 0 && info.type === "file" ? await fs.readText(target) : "";
		for (const kind of kinds) {
			const text = await llmText(ctx, sectionPrompt(kind, index, language), .3);
			if (text === "") continue;
			existing = mergeSection(existing, SECTION_TITLES[kind], text);
		}
		await writeDoc(fs, targetPath, existing, sandboxPolicy);
		if (await fs.stat(target).then((i) => i?.type === "file")) {
			await writeStructuredCache(ctx, fs, root, index, language, "seq", sandboxPolicy);
			await writeStructuredCache(ctx, fs, root, index, language, "interaction", sandboxPolicy);
		}
		return { path: targetPath };
	} catch (error) {
		return { error: `full docs failed: ${error instanceof Error ? error.message : String(error)}` };
	}
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
* @returns the parsed structured data, or an error.
*/
async function writeStructuredCache(ctx, fs, root, index, language, kind, sandboxPolicy) {
	try {
		const text = await llmText(ctx, kind === "seq" ? `你是代码时序分析师。根据项目摘要归纳一次典型主流程的消息流。\n输出语言：${language}。\n严格输出 JSON 数组：[{ "from": "...", "to": "...", "label": "..." }]（10-16 条），不要其他内容。\n\n${indexSummary(index)}` : `你是代码交互分析师。根据项目摘要列出核心事件/交互。\n输出语言：${language}。\n严格输出 JSON 数组：[{ "event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..." }]（8-14 条），不要其他内容。\n\n${indexSummary(index)}`, .3);
		const start = text.indexOf("[");
		const end = text.lastIndexOf("]");
		if (start < 0 || end <= start) return { error: "structured generation returned no JSON array" };
		const parsed = JSON.parse(text.slice(start, end + 1));
		if (!Array.isArray(parsed) || parsed.length === 0) return { error: "structured generation returned an empty array" };
		const target = await fs.resolve(cacheName$2(kind === "seq" ? SEQ_CACHE : EVENTS_CACHE, language), { cwd: root });
		await fs.writeText(target, JSON.stringify(parsed), void 0, void 0, sandboxPolicy);
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
async function readStructuredCache(fs, root, language, kind) {
	try {
		const target = await fs.resolve(cacheName$2(kind === "seq" ? SEQ_CACHE : EVENTS_CACHE, language), { cwd: root });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return null;
		const parsed = JSON.parse(await fs.readText(target));
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
//#endregion
//#region packages/arch-lens-backend/src/flow.ts
/** Cache file base name; the role language is appended (sanitized). */
const FLOW_FILE_BASE = ".arch-lens-flow";
/** Fenced-code-block opener; the captured group is the fence language. */
const FENCE_RE = /^```(\S*)\s*$/;
/** Keep cache file names filesystem-safe. */
function cacheName$1(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${FLOW_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
}
/**
* Stage: locate the first flow block in an architecture doc. A fenced
* `mermaid` block whose body starts with `flowchart`/`graph` is returned
* verbatim; a fenced `text`/`txt` block containing `->` arrows is returned as
* pseudo-code for transcoding. The nearest preceding heading becomes the
* source anchor. Pure rule stage — zero LLM, deterministic.
* @param fs - filesystem service.
* @param docPath - display path of the doc.
* @returns the flow block, or null when the doc has none.
*/
async function extractFlowBlock(fs, docPath) {
	const info = await fs.stat(await fs.resolve(docPath));
	if (info === void 0 || info.type !== "file") return null;
	const lines = (await fs.readText(await fs.resolve(docPath))).slice(0, 262144).split("\n");
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
			const anchor = `${docPath.replace(/\\/g, "/")}#${currentHeading === "" ? "top" : currentHeading.replace(/\s+/g, "-")}`;
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
/** Extract mermaid source from an LLM answer (fenced block, or bare source). */
function extractMermaid(out) {
	const fenced = /```(?:mermaid)?\s*\n([\s\S]*?)```/.exec(out);
	if (fenced !== null) return fenced[1].trim();
	const idx = out.search(/\b(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/);
	if (idx < 0) return "";
	return out.slice(idx).trim().replace(/```\s*$/, "").trim();
}
/**
* Stage: LLM format-transcode of a pseudo-code flow block into a mermaid
* flowchart. Format only — steps, branches, order and semantics are preserved;
* labels keep their original terms. The result stays `source: 'doc'` because
* the evidence is the doc's own text.
* @param ctx - host context.
* @param pseudo - the doc's pseudo-code flow block.
* @param language - role language.
* @returns mermaid flowchart source ('' on failure).
*/
async function transcodeFlow(ctx, pseudo, language) {
	return extractMermaid(await llmText(ctx, `你是流程图转换器。把下面的流程伪代码块转换成 Mermaid flowchart：
- 只转换表示形式，不增删任何步骤、分支、顺序或语义；
- 节点 label 保留原文术语（不翻译）；分支条件作为边的 label；
- 输出语言：${language}（仅用于必要的中文说明，节点术语保持原文）；\n- 严格只输出 mermaid 源码（flowchart TD 开头），不要代码块围栏，不要任何解释。\n\n流程块：\n${pseudo}`, .2));
}
/**
* Fallback stage: LLM induces a core flow (entity → entity) from the code
* index metadata — the "no doc flow block" path, language-independent.
* Result is `source: 'flow'` (non-authoritative).
* @param ctx - host context.
* @param index - code index result.
* @param language - role language.
* @returns the induced flow, or null on failure.
*/
async function generateFlowFromCode(ctx, index, language) {
	try {
		const out = await llmText(ctx, `你是代码架构分析师。以下是某项目的代码索引摘要（包/依赖/实体/入口）。
请归纳出这个项目最有代表性的一条核心流程（如启动、请求处理、主循环——选一条，不要多条）：谁 → 谁，按什么顺序流转，含关键分支。
输出语言：${language}。\n严格输出 JSON：{"title": "流程标题", "mermaid": "flowchart TD\\n..."}，mermaid 字段是完整 mermaid flowchart 源码（flowchart TD 开头，不要代码块围栏），不要输出其他内容。\n\n项目摘要：\n${indexSummary(index)}`, .3);
		const start = out.indexOf("{");
		const end = out.lastIndexOf("}");
		if (start < 0 || end <= start) return null;
		const parsed = JSON.parse(out.slice(start, end + 1));
		const mermaid = typeof parsed.mermaid === "string" ? extractMermaid(parsed.mermaid) : "";
		if (mermaid === "") return null;
		return {
			title: typeof parsed.title === "string" && parsed.title !== "" ? parsed.title.slice(0, 60) : "核心流程",
			source: "flow",
			mermaid
		};
	} catch (error) {
		console.warn(`[arch-lens] flow induction failed: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}
/**
* The full flow chain: cache → doc (verbatim mermaid, else LLM transcode of a
* pseudo-code block) → (none) LLM induction from code metadata. `force`
* bypasses the cache and rebuilds the figure's facts.
* @param ctx - host context.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result (for the induction fallback).
* @param language - role language.
* @param force - regenerate even when cached.
* @returns the flow diagram, or an error result.
*/
async function flowDiagram(ctx, fs, root, index, language, force, sandboxPolicy) {
	const cacheTarget = await fs.resolve(cacheName$1(language), { cwd: root }).catch(() => null);
	if (!force && cacheTarget !== null) try {
		const info = await fs.stat(cacheTarget);
		if (info !== void 0 && info.type === "file") {
			const cached = JSON.parse(await fs.readText(cacheTarget));
			if (typeof cached === "object" && typeof cached.mermaid === "string") {
				console.log(`[arch-lens] flow: served from cache (lang=${language})`);
				return cached;
			}
		}
	} catch {}
	const writeCache = async (result) => {
		if (cacheTarget === null) return;
		try {
			await fs.writeText(cacheTarget, JSON.stringify(result), void 0, void 0, sandboxPolicy);
		} catch {}
	};
	for (const candidate of docCandidates(language)) {
		const target = await fs.resolve(candidate, { cwd: root }).catch(() => null);
		if (target === null) continue;
		const info = await fs.stat(target).catch(() => void 0);
		if (info === void 0 || info.type !== "file") continue;
		const block = await extractFlowBlock(fs, target.displayPath);
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
			const mermaid = await transcodeFlow(ctx, block.pseudo, language);
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
	console.log("[arch-lens] flow: no doc flow block — inducing from code metadata");
	const induced = await generateFlowFromCode(ctx, index, language);
	if (induced === null) return { error: "flow generation failed: no doc flow block and LLM induction returned nothing" };
	await writeCache(induced);
	return induced;
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
	return lines.join("\n");
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
	return lines.join("\n");
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
* Core-flow ER diagram: selected packages as entities, source-level import
* edges between selected packages as relationships.
* @param index - code index result.
* @param ids - selected core package ids.
* @returns mermaid erDiagram source.
*/
function coreErDiagram(index, ids) {
	const idSet = new Set(ids);
	const lines = ["erDiagram"];
	for (const pkg of index.packages) {
		if (!idSet.has(pkg.id)) continue;
		lines.push(`  ${label(pkg.id)} {`);
		lines.push("    string language");
		const classCount = pkg.entities.filter((entity) => entity.kind === "class" || entity.kind === "interface").length;
		if (classCount > 0) lines.push(`    int classes "${classCount}"`);
		lines.push("  }");
	}
	const seen = /* @__PURE__ */ new Set();
	for (const [from, tos] of importEdges(index)) {
		if (!idSet.has(from)) continue;
		for (const to of tos) {
			if (!idSet.has(to)) continue;
			const key = `${from}>${to}`;
			if (seen.has(key)) continue;
			seen.add(key);
			lines.push(`  ${label(from)} ||--o{ ${label(to)} : imports`);
		}
	}
	return lines.join("\n");
}
//#endregion
//#region packages/arch-lens-backend/src/core.ts
/** Cache file base name; the role language is appended (sanitized). */
const CORE_FILE_BASE = ".arch-lens-core";
/** Keep cache file names filesystem-safe. */
function cacheName(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CORE_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
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
async function llmPick(ctx, index, language) {
	return validateIds(index, extractCoreJson(await llmText(ctx, `你是代码架构分析师。以下是某项目的代码索引摘要（包 id / 语言 / 顶层实体 / 入口文件）。\n请从摘要中选出构成这个项目核心流程的 ${MIN_CORE}-${MAX_CORE} 个核心包 id（如启动、请求处理、主循环涉及的关键包）。\n只能使用摘要中出现的包 id，不要编造。\n输出语言：${language}。\n严格按以下格式输出，不要输出其他内容：\n{"core": ["id1", "id2", ...]}\n\n项目摘要：\n${indexSummary(index)}`, .3)));
}
/**
* The full core-selection chain: cache → LLM pick (validated) → deterministic
* fallback. `force` bypasses the cache and rebuilds the selection facts.
* @param ctx - host context.
* @param fs - filesystem service.
* @param root - workspace root.
* @param index - code index result.
* @param language - role language.
* @param force - regenerate even when cached.
* @returns the core selection, or an error result.
*/
async function coreGraph(ctx, fs, root, index, language, force, sandboxPolicy) {
	const cacheTarget = await fs.resolve(cacheName(language), { cwd: root }).catch(() => null);
	if (!force && cacheTarget !== null) try {
		const info = await fs.stat(cacheTarget);
		if (info !== void 0 && info.type === "file") {
			const cached = JSON.parse(await fs.readText(cacheTarget));
			if (typeof cached === "object" && cached !== null && Array.isArray(cached.ids) && (cached.source === "flow" || cached.source === "curated")) {
				console.log(`[arch-lens] core: served from cache (lang=${language})`);
				return cached;
			}
		}
	} catch {}
	const writeCache = async (result) => {
		if (cacheTarget === null) return;
		try {
			await fs.writeText(cacheTarget, JSON.stringify(result), void 0, void 0, sandboxPolicy);
		} catch {}
	};
	let ids = [];
	try {
		ids = await llmPick(ctx, index, language);
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
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Default note file name in the workspace root. */
const DEFAULT_NOTES_FILE = "ARCH-NOTES.md";
/** Per-workspace prompt configuration file in the workspace root. */
const PROMPT_CONFIG_FILE = ".arch-lens-prompts.json";
/**
* The Arch Lens backend Remote service (`ctx.archLens`).
*/
let ArchLensService = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _remoteGraph_decorators;
	let _remoteRefresh_decorators;
	let _remoteRefreshIndex_decorators;
	let _remoteLoad_decorators;
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
			__esDecorate(this, null, _remoteLoad_decorators, {
				kind: "method",
				name: "remoteLoad",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteLoad" in obj,
					get: (obj) => obj.remoteLoad
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
			__esDecorate(this, null, _remoteNotePendingClear_decorators, {
				kind: "method",
				name: "remoteNotePendingClear",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteNotePendingClear" in obj,
					get: (obj) => obj.remoteNotePendingClear
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
		/** One in-flight scan (root + promise) so concurrent callers share one scan
		* per root; a scan of another root can run alongside without clobbering it. */
		graphInFlight = null;
		pending = null;
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
		/** Scan (with cache) the workspace package tree; concurrent callers share
		* one scan per root. Cache-first: a previously scanned workspace (any
		* session of it) resolves instantly; only a new root triggers a scan. */
		graph() {
			const root = this.resolveRoot();
			if (typeof root !== "string") return Promise.resolve(root);
			const cached = this.graphCaches.get(root);
			if (cached !== void 0) return Promise.resolve(cached);
			if (this.graphInFlight !== null && this.graphInFlight.root === root) return this.graphInFlight.promise;
			const fs = this.ctx.fs;
			const promise = scanWorkspace(fs, root).then((result) => {
				if (this.graphInFlight !== null && this.graphInFlight.promise === promise) this.graphInFlight = null;
				this.graphCaches.set(root, result);
				return result;
			});
			this.graphInFlight = {
				root,
				promise
			};
			return promise;
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
		* Load the desk's data source for one session's workspace — a pure LOAD,
		* never an invalidation: only the target session id is set, and no cache is
		* touched. The scan cache is keyed by workspace root, so re-loading the
		* same workspace (reopening the panel, switching between its sessions) is
		* instant, while a different workspace rescans automatically on the next
		* graph() call. Explicit invalidation stays exclusively on refresh().
		* @param sessionId - target session id, or null for the policy root.
		* @returns acknowledgement.
		*/
		async remoteLoad(sessionId) {
			this.targetSessionId = sessionId;
			return { ok: true };
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
		/** Remove the per-language AI caches (concept tree / sequence / events). */
		async removeAICaches() {
			const root = this.resolveRoot();
			if (typeof root !== "string") return;
			const fs = this.ctx.fs;
			try {
				const rootTarget = await fs.resolve(".", { cwd: root });
				const entries = await fs.listDir(rootTarget);
				for (const entry of entries) {
					if (entry.type !== "file") continue;
					const name = entry.name;
					if ([
						".arch-lens-concept-",
						".arch-lens-sequence-",
						".arch-lens-events-",
						".arch-lens-flow-",
						".arch-lens-core-"
					].some((prefix) => name.startsWith(prefix)) && name.endsWith(".json")) try {
						await fs.writeText(entry.target, "", void 0, void 0, this.sessionPolicy());
						console.log(`[arch-lens] invalidated AI cache ${name}`);
					} catch {}
				}
			} catch {}
		}
		/**
		* Detail projection for one package. The graph carries precomputed details,
		* so this is a plain lookup (kept as a Remote for compatibility).
		* @param request - package id.
		* @returns detail or error.
		*/
		async remoteComponent(request) {
			const graph = await this.graph();
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
		async remoteMermaidEr() {
			const graph = await this.graph();
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
			const codeIndex = this.ctx.get("codeIndex");
			if (codeIndex === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
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
		* Core-flow diagram (deps/ER overview): the LLM-selected core packages with
		* rule-derived source-import edges. Returns the mermaid source plus the
		* selection provenance so the client can badge/explain it.
		* @param request - diagram kind, role language, and whether to force a new selection.
		* @returns mermaid source and core selection, or an error.
		*/
		async remoteMermaidCore(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
				const core = await coreGraph(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", request.force === true, this.sessionPolicy());
				if ("error" in core) return core;
				const source = request.kind === "flowchart" ? coreFlowchart(index, core.ids) : coreErDiagram(index, core.ids);
				return {
					kind: request.kind,
					source,
					core
				};
			} catch (error) {
				return { error: `core diagram failed: ${error instanceof Error ? error.message : String(error)}` };
			}
		}
		/** Shared codeIndex accessor for the concept/docs remotes. */
		codeIndexService() {
			return this.ctx.get("codeIndex");
		}
		/**
		* Session-scoped sandbox policy for every file write: the fs sandbox
		* derives its workspace-write root from the calling session's cwd — the
		* same root this service writes to — so passing it approves the writes.
		*/
		sessionPolicy() {
			return sessionPolicy(this.ctx, this.targetSessionId);
		}
		/**
		* Concept hierarchy via the one-way chain: architecture doc (extract +
		* LLM enhance) first, LLM-from-flow as fallback. Cached per language.
		* @param request - role language and whether to force regeneration.
		* @returns concept-tree nodes or an error.
		*/
		async remoteConceptTree(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
				const tree = await conceptTree(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", request.force === true, this.sessionPolicy());
				if ("error" in tree) return tree;
				return tree;
			} catch (error) {
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
			if (typeof root !== "string") return root;
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
				return await generateFullDocs(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", this.sessionPolicy());
			} catch (error) {
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
			if (typeof root !== "string") return root;
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
				return await generateDocSection(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", request.kind, this.sessionPolicy());
			} catch (error) {
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
			if (typeof root !== "string") return root;
			return await readStructuredCache(this.ctx.fs, root, request.language ?? "中文", "seq");
		}
		/**
		* Structured figure data for the interaction tab (cached per language).
		* @param request - role language.
		* @returns event array, null, or an error.
		*/
		async remoteEvents(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			return await readStructuredCache(this.ctx.fs, root, request.language ?? "中文", "interaction");
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
			if (typeof root !== "string") return root;
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
				return await flowDiagram(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", request.force === true, this.sessionPolicy());
			} catch (error) {
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
			if ("error" in graph) return graph;
			return analyzeWorkspace(this.ctx.fs, graph);
		}
		/**
		* AI one-line duty summaries for the package catalog, in the role language.
		* @param request - output language (default 中文).
		* @returns id → summary map, or an error.
		*/
		async remoteSummarizeDuties(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const graph = await this.graph();
			if ("error" in graph) return graph;
			return summarizeDuties(this.ctx, this.ctx.fs, root, graph, request.language ?? "中文", this.sessionPolicy());
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
			const graph = await this.graph();
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
			const graph = await this.graph();
			if ("error" in graph) return graph;
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
				target: request.target ?? "架构讲解",
				question: request.text ?? "",
				sessionId: request.sessionId ?? null
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
		async [(_remoteGraph_decorators = [Remote("graph")], _remoteRefresh_decorators = [Remote("refresh")], _remoteRefreshIndex_decorators = [Remote("refreshIndex")], _remoteLoad_decorators = [Remote("load")], _remoteComponent_decorators = [Remote("component")], _remoteNotes_decorators = [Remote("notes")], _remoteMermaidDeps_decorators = [Remote("mermaidDeps")], _remoteMermaidEr_decorators = [Remote("mermaidEr")], _remoteMermaidIndexed_decorators = [Remote("mermaidIndexed")], _remoteMermaidCore_decorators = [Remote("mermaidCore")], _remoteConceptTree_decorators = [Remote("conceptTree")], _remoteGenerateDocs_decorators = [Remote("generateDocs")], _remoteGenerateDocSection_decorators = [Remote("generateDocSection")], _remoteSequence_decorators = [Remote("sequence")], _remoteEvents_decorators = [Remote("events")], _remoteFlow_decorators = [Remote("flow")], _remoteAnalyze_decorators = [Remote("analyze")], _remoteSummarizeDuties_decorators = [Remote("summarizeDuties")], _remoteProgress_decorators = [Remote("progress")], _remoteProgressStats_decorators = [Remote("progressStats")], _remoteNotePending_decorators = [Remote("notePending")], _remoteNotePendingClear_decorators = [Remote("notePendingClear")], _remotePromptConfig_decorators = [Remote("promptConfig")], _remotePromptConfigSave_decorators = [Remote("promptConfigSave")], Service.init)]() {
			this.ctx.on("session/event", (session, event) => {
				if (event.type !== "assistant/message") return;
				const message = event.data.message;
				let answer = "";
				for (const block of message.content) if (block.type === "text") answer += block.text;
				if (answer.trim() === "") return;
				if (this.pending !== null && this.pending.sessionId !== null && session.id !== this.pending.sessionId) return;
				const staged = this.pending;
				if (staged === null) return;
				this.pending = null;
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
