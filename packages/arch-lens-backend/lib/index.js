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
//#region packages/arch-lens-backend/src/llm-stats.ts
const MAX_RECORDS = 100;
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
*/
function recordLlmCall(kind, prompt, output, ms, usage) {
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
	if (usage !== void 0) record.usage = usage;
	records.unshift(record);
	if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
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
//#region packages/arch-lens-backend/src/summarize.ts
/** Cache file base name; the role language is appended (sanitized). */
const SUMMARY_FILE_BASE = ".arch-lens-summaries";
/** Keep cache file names filesystem-safe. */
function cacheName$7(language) {
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
	const target = await fs.resolve(cacheName$7(language), { cwd: root }).catch(() => null);
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
function cacheName$6(language) {
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
	const cacheTarget = await fs.resolve(cacheName$6(language), { cwd: root }).catch(() => null);
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
	return `${ER_LINE_STYLE}\n${lines.join("\n")}`;
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
const SEQ_CACHE$1 = ".arch-lens-sequence";
const EVENTS_CACHE = ".arch-lens-events";
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName$5(base, language, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${base}-${safe === "" ? "default" : safe}${methods ? "-methods" : ""}.json`;
}
/**
* Resolve the doc target: ALWAYS `docs/architecture.generated.md`.
* `docs/architecture.md` belongs to the user and is never written, whether it
* carries a generated marker or not. Every generation overwrites the AI
* variant (per-section merge for generateDocSection, full rewrite for
* generateFullDocs). Users adopt a generated doc by renaming/copying it over
* `architecture.md` (dropping the "generated" suffix) — the generator keeps
* writing the AI variant afterwards.
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
		const edges = (index.calls ?? []).filter((edge) => edge.from !== void 0 && edge.from !== "").slice(0, MAX_SUMMARY_CALLS).map((edge) => `- ${edge.from} → ${edge.to}（${edge.fromFile}${edge.line !== void 0 ? `:${edge.line}` : ""}）`);
		if (edges.length > 0) {
			lines.push("");
			lines.push("真实调用边（方法级，含调用点文件行号）:");
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
/** Build the LLM prompt for one doc section. */
function sectionPrompt(kind, index, language) {
	const base = `你是代码架构文档作者。以下是某项目的代码索引摘要（包/依赖/实体/入口）。\n输出语言：${language}。\n不要输出代码块，直接输出 Markdown。\n所有内容必须只基于上面摘要中列出的包/依赖/实体/入口事实；禁止编造摘要中不存在的分析机制、流程步骤或数据关系（例如"系统通过分析X构建Y"这类摘要里没有的机制描述）。\n\n项目摘要：\n${indexSummary(index)}\n\n`;
	switch (kind) {
		case "concepts": return base + "请输出「## 概念层级」章节：归纳项目是怎么运作的核心概念（运行角色/机制，不要列包清单），层级小节（### 子节）。";
		case "seq": return base + "请输出「## 时序」章节：描述【项目核心】的一次典型主流程的调用顺序（从用户输入/入口到输出/回复：谁→谁，什么顺序），用 Markdown 有序列表或 mermaid sequenceDiagram。";
		case "interaction": return base + "请输出「## 核心交互」章节：列出核心事件/服务交互（生产者→事件→消费者），用 Markdown 列表或 mermaid。";
		case "deps": return base + "请输出「## 依赖」章节：说明包/模块之间的依赖关系与分层，重点讲清楚谁依赖谁、为什么。";
		case "er": return base + "请输出「## 实体关系」章节：列出核心类/接口实体及其关系（继承/实现/引用），用 Markdown 列表或 mermaid erDiagram。";
		case "catalog": return base + "请输出「## 包目录职责」章节：为每个包写一行职责说明（简洁准确）。";
	}
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
		const text = await llmText(ctx, sectionPrompt(kind, index, language), .3, void 0, "docs-section", generationSignal(root));
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
			const text = await llmText(ctx, sectionPrompt(kind, index, language), .3, void 0, "docs-full", generationSignal(root));
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
		const text = await llmText(ctx, kind === "seq" ? seqInductionPrompt(index, language, summary) : `你是代码交互分析师。根据项目摘要列出核心事件/交互。\n输出语言：${language}。\n严格输出 JSON 数组：[{ "event": "...", "mode": "emit|waterfall|parallel|serial", "producers": ["..."], "consumers": ["..."], "note": "..." }]（8-14 条），不要其他内容。\n\n${summary}`, .3, void 0, kind === "seq" ? "seq" : "events", generationSignal(root));
		const start = text.indexOf("[");
		const end = text.lastIndexOf("]");
		if (start < 0 || end <= start) return { error: "structured generation returned no JSON array" };
		const parsed = JSON.parse(text.slice(start, end + 1));
		if (!Array.isArray(parsed) || parsed.length === 0) return { error: "structured generation returned an empty array" };
		const target = await fs.resolve(cacheName$5(kind === "seq" ? SEQ_CACHE$1 : EVENTS_CACHE, language, methodLevel), { cwd: root });
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
async function readStructuredCache(fs, root, language, kind, methods = false) {
	try {
		const target = await fs.resolve(cacheName$5(kind === "seq" ? SEQ_CACHE$1 : EVENTS_CACHE, language, methods), { cwd: root });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return null;
		const parsed = JSON.parse(await fs.readText(target));
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
function cacheName$4(language) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${ANALYSIS_FILE_BASE}-${safe === "" ? "default" : safe}.json`;
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
	const target = await fs.resolve(cacheName$4(language), { cwd: root }).catch(() => null);
	if (target !== null) try {
		const info = await fs.stat(target);
		if (info !== void 0 && info.type === "file") {
			const cached = profileFromText(await fs.readText(target));
			if (cached !== null) {
				console.log(`[arch-lens] analysis: served from cache (lang=${language})`);
				return cached;
			}
		}
	} catch {}
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
	if (target !== null) try {
		await fs.writeText(target, JSON.stringify(profile), void 0, void 0, sandboxPolicy);
		console.log("[arch-lens] analysis: profile cached");
	} catch {}
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
		if (depth < 2 && Array.isArray(record.children)) {
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
		const target = await fs.resolve(cacheName$4(language), { cwd: root }).catch(() => null);
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
function cacheName$3(language, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CONCEPT_FILE_BASE}-${safe === "" ? "default" : safe}${methods ? "-methods" : ""}.json`;
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
				ref: `${docPath.replace(/\\/g, "/")}#${heading[2].trim().replace(/\s+/g, "-")}`
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
* @param sandboxPolicy - session-scoped policy for the cache write.
* @param methods - 🔬 方法级: skip the shared (entity-level) profile and
*   induce from the method-level summary (methods + call edges).
* @returns the concept tree, or an error result.
*/
async function conceptTree(ctx, fs, root, index, language, force, sandboxPolicy, methods = false) {
	const cacheTarget = await fs.resolve(cacheName$3(language, methods), { cwd: root }).catch(() => null);
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
		if (isUsableDocTree(tree)) {
			await writeCache(tree);
			return tree;
		}
		console.log(`[arch-lens] concept: doc tree too shallow (${tree.length} roots) — falling through`);
	}
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
function cacheName$2(language, angle, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${FLOW_FILE_BASE}-${safe === "" ? "default" : safe}-${angle}${methods ? "-methods" : ""}.json`;
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
* The full flow chain: cache → doc (verbatim mermaid, else LLM transcode of a
* pseudo-code block) → shared analysis profile → LLM induction from code
* metadata. `force` bypasses the cache and rebuilds the figure's facts.
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
	const cacheTarget = await fs.resolve(cacheName$2(language, angle, methods), { cwd: root }).catch(() => null);
	if (!force && cacheTarget !== null) try {
		const info = await fs.stat(cacheTarget);
		if (info !== void 0 && info.type === "file") {
			const cached = JSON.parse(await fs.readText(cacheTarget));
			if (typeof cached === "object" && typeof cached.mermaid === "string") {
				console.log(`[arch-lens] flow: served from cache (lang=${language}, angle=${angle})`);
				return {
					...cached,
					mermaid: sanitizeMermaid(cached.mermaid)
				};
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
//#region packages/arch-lens-backend/src/sequence.ts
/** Cache file base name for the sequence figure (same file as LLM writes). */
const SEQ_CACHE = ".arch-lens-sequence";
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName$1(base, language, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${base}-${safe === "" ? "default" : safe}${methods ? "-methods" : ""}.json`;
}
/** Normalize a path for map keys (`\` → `/`, strip `./` segments anywhere). */
function norm(path) {
	return path.replace(/\\/g, "/").replace(/\/\.\//g, "/").replace(/^\.\//, "");
}
/** Whether a source file is a test file: test-directory paths (`tests/`,
* `__tests__/`, `test/`) or test-suffixed names (`*.spec.ts`, `*.test.ts`,
* `*_test.py`). Used to keep fixture-only call edges out of the production
* call graph. */
function isTestFile(path) {
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
		if (isTestFile(norm(edge.fromFile))) continue;
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
	const docPath = await detectArchDocs(fs, root, language);
	if (docPath === null) return null;
	const target = await fs.resolve(docPath);
	const info = await fs.stat(target);
	if (info === void 0 || info.type !== "file") return null;
	const section = sectionText((await fs.readText(target)).slice(0, 262144), "时序");
	if (section === null) return null;
	const messages = parseSequenceSection(section);
	if (messages.length < MIN_MESSAGES) return null;
	return {
		source: "doc",
		messages,
		ref: `${docPath.replace(/\\/g, "/")}#时序`
	};
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
* figures never collide. */
async function readSeqCache(fs, root, language, methods = false) {
	try {
		const target = await fs.resolve(cacheName$1(SEQ_CACHE, language, methods), { cwd: root });
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return null;
		const text = (await fs.readText(target)).trim();
		if (text === "") return null;
		const parsed = JSON.parse(text);
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
/** Persist a doc-sourced figure so subsequent reads skip the doc scan. */
async function writeSeqCache(fs, root, language, result, sandboxPolicy, methods = false) {
	const target = await fs.resolve(cacheName$1(SEQ_CACHE, language, methods), { cwd: root });
	await fs.writeText(target, JSON.stringify(result), void 0, void 0, sandboxPolicy);
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
async function resolveSequence(ctx, fs, root, index, language, sandboxPolicy, prefer = "code", methodLevel = false) {
	console.log(`[arch-lens] resolveSequence: prefer=${prefer} calls=${index.calls?.length ?? 0} packages=${index.packages.length}`);
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
	const cached = await readSeqCache(fs, root, language, methodLevel);
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
//#region packages/arch-lens-backend/src/core.ts
/** Cache file base name; the role language is appended (sanitized). */
const CORE_FILE_BASE = ".arch-lens-core";
/** Keep cache file names filesystem-safe (language + method level). */
function cacheName(language, methods = false) {
	const safe = language.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
	return `${CORE_FILE_BASE}-${safe === "" ? "default" : safe}${methods ? "-methods" : ""}.json`;
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
async function coreGraph(ctx, fs, root, index, language, force, sandboxPolicy, methods = false) {
	const cacheTarget = await fs.resolve(cacheName(language, methods), { cwd: root }).catch(() => null);
	if (!force && cacheTarget !== null) try {
		const info = await fs.stat(cacheTarget);
		if (info !== void 0 && info.type === "file") {
			const cached = JSON.parse(await fs.readText(cacheTarget));
			if (typeof cached === "object" && cached !== null && Array.isArray(cached.ids) && (cached.source === "flow" || cached.source === "curated")) {
				console.log(`[arch-lens] core: served from cache (lang=${language}${methods ? ", method-level" : ""})`);
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
/** Persisted scan-graph cache in the workspace root (reopening after a host
* restart must not re-walk the filesystem; refresh() invalidates it). */
const GRAPH_CACHE_FILE = ".arch-lens-graph.json";
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
	let _remoteRegenerateFigure_decorators;
	let _remoteLastAnswer_decorators;
	let _remoteGenerationStatus_decorators;
	let _remoteGenerationStatusNext_decorators;
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
		* session of it) resolves instantly; only a new root triggers a scan.
		* The scan graph is ALSO persisted to `.arch-lens-graph.json` in the
		* workspace root, so reopening the desk after a host restart serves the
		* cached graph instead of re-walking the filesystem. refresh() marks the
		* disk copy invalid before it rescans (the FileSystem has no delete). */
		graph() {
			const root = this.resolveRoot();
			if (typeof root !== "string") return Promise.resolve(root);
			const cached = this.graphCaches.get(root);
			if (cached !== void 0) return Promise.resolve(cached);
			if (this.graphInFlight !== null && this.graphInFlight.root === root) return this.graphInFlight.promise;
			const fs = this.ctx.fs;
			const promise = this.graphFromDisk(root).then((fromDisk) => {
				if (fromDisk !== null) {
					console.log(`[arch-lens] graph: served from disk cache (root=${root})`);
					this.graphCaches.set(root, fromDisk);
					return fromDisk;
				}
				return scanWorkspace(fs, root).then((result) => {
					if (this.graphInFlight !== null && this.graphInFlight.promise === promise) this.graphInFlight = null;
					this.graphCaches.set(root, result);
					if (!("error" in result)) this.writeGraphDisk(root, result);
					return result;
				});
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
		/** Persist a fresh scan graph (non-fatal on failure). */
		async writeGraphDisk(root, graph) {
			try {
				const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
				await this.ctx.fs.writeText(target, JSON.stringify({
					root,
					generatedAt: Date.now(),
					graph
				}), void 0, void 0, this.sessionPolicy());
			} catch {}
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
			const root = this.resolveRoot();
			if (typeof root === "string") try {
				const target = await this.ctx.fs.resolve(GRAPH_CACHE_FILE, { cwd: root });
				await this.ctx.fs.writeText(target, JSON.stringify({
					root,
					invalidated: true,
					generatedAt: Date.now()
				}), void 0, void 0, this.sessionPolicy());
			} catch {}
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
						".arch-lens-core-",
						".arch-lens-analysis-"
					].some((prefix) => name.startsWith(prefix)) && name.endsWith(".json")) try {
						await fs.writeText(entry.target, "", void 0, void 0, this.sessionPolicy());
						console.log(`[arch-lens] invalidated AI cache ${name}`);
					} catch {}
				}
				clearAnalysisProfileCache();
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
				const core = await coreGraph(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", request.force === true, this.sessionPolicy(), request.methodLevel === true);
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
				const tree = await conceptTree(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", request.force === true, this.sessionPolicy(), request.methodLevel === true);
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
			if (typeof root !== "string") return root;
			const codeIndex = this.codeIndexService();
			try {
				const index = codeIndex === void 0 ? {
					root,
					language: "unknown",
					packages: []
				} : await codeIndex.indexWorkspace(root, this.sessionPolicy());
				return await resolveSequence(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", this.sessionPolicy(), request.prefer ?? "code", request.methodLevel === true);
			} catch (error) {
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
			if (typeof root !== "string") return root;
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
				const language = request.language ?? "中文";
				if (request.methodLevel === true) return await this.regenerateFigureMethodLevel(request.kind, index, language);
				const kind = request.kind === "concepts" ? "concept" : request.kind === "deps" || request.kind === "er" ? "core" : request.kind === "interaction" ? "events" : request.kind;
				const profile = await regenerateProfileField(this.ctx, this.ctx.fs, root, index, language, kind, this.sessionPolicy());
				switch (request.kind) {
					case "concepts": {
						const tree = profile.conceptTree;
						if (tree === void 0 || tree.length === 0) return { error: "concept regeneration produced no tree" };
						return {
							kind: "concepts",
							tree
						};
					}
					case "seq": {
						const messages = profile.seqMessages;
						if (messages === void 0 || messages.length === 0) return { error: "seq regeneration produced no messages" };
						return {
							kind: "seq",
							messages
						};
					}
					case "flow": {
						if (profile.flow === void 0 || Object.keys(profile.flow).length === 0) return { error: "flow regeneration produced no diagram" };
						const flows = {};
						for (const [angle, flow] of Object.entries(profile.flow)) flows[angle] = {
							title: flow.title,
							source: "flow",
							angle,
							mermaid: sanitizeMermaid(flow.mermaid)
						};
						return {
							kind: "flow",
							flows
						};
					}
					case "interaction": {
						const events = profile.events;
						if (events === void 0 || events.length === 0) return { error: "events regeneration produced no events" };
						return {
							kind: "interaction",
							events
						};
					}
					default:
						if (profile.coreIds.length < 4) return { error: "core regeneration produced too few packages" };
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
		* Structured figure data for the interaction tab (cached per language).
		* @param request - role language.
		* @returns event array, null, or an error.
		*/
		async remoteEvents(request) {
			const root = this.resolveRoot();
			if (typeof root !== "string") return root;
			const language = request.language ?? "中文";
			const methods = request.methodLevel === true;
			const cached = await readStructuredCache(this.ctx.fs, root, language, "interaction", methods);
			if (cached !== null) return cached;
			if (methods) return null;
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return null;
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
				const events = (await ensureAnalysisProfile(this.ctx, this.ctx.fs, root, index, language, this.sessionPolicy())).events;
				if (events !== void 0 && events.length > 0) return events;
			} catch (error) {
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
			if (typeof root !== "string") return root;
			const codeIndex = this.codeIndexService();
			if (codeIndex === void 0) return { error: "codeIndex service unavailable" };
			try {
				const index = await codeIndex.indexWorkspace(root, this.sessionPolicy());
				return await flowDiagram(this.ctx, this.ctx.fs, root, index, request.language ?? "中文", request.force === true, request.angle ?? "event", this.sessionPolicy(), request.methodLevel === true);
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
		* LLM usage accounting: totals and the newest recorded calls (see
		* llm-stats.ts for the estimation rule). The snapshot is also persisted to
		* `.arch-lens-llm-stats.json` in the workspace root so token spend is
		* inspectable outside the panel and survives restarts.
		* @returns the accounting snapshot.
		*/
		async remoteLlmStats() {
			const snapshot = llmStatsSnapshot();
			const root = this.resolveRoot();
			if (typeof root === "string") try {
				const target = await this.ctx.fs.resolve(".arch-lens-llm-stats.json", { cwd: root });
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
		async [(_remoteGraph_decorators = [Remote("graph")], _remoteRefresh_decorators = [Remote("refresh")], _remoteRefreshIndex_decorators = [Remote("refreshIndex")], _remoteSetSession_decorators = [Remote("setSession")], _remoteComponent_decorators = [Remote("component")], _remoteNotes_decorators = [Remote("notes")], _remoteMermaidDeps_decorators = [Remote("mermaidDeps")], _remoteMermaidEr_decorators = [Remote("mermaidEr")], _remoteMermaidIndexed_decorators = [Remote("mermaidIndexed")], _remoteMermaidCore_decorators = [Remote("mermaidCore")], _remoteConceptTree_decorators = [Remote("conceptTree")], _remoteGenerateDocs_decorators = [Remote("generateDocs")], _remoteGenerateDocSection_decorators = [Remote("generateDocSection")], _remoteSequence_decorators = [Remote("sequence")], _remoteRegenerateFigure_decorators = [Remote("regenerateFigure")], _remoteLastAnswer_decorators = [Remote("lastAnswer")], _remoteGenerationStatus_decorators = [Remote("generationStatus")], _remoteGenerationStatusNext_decorators = [Remote("generationStatusNext")], _remoteCancelGeneration_decorators = [Remote("cancelGeneration")], _remoteEvents_decorators = [Remote("events")], _remoteFlow_decorators = [Remote("flow")], _remoteAnalyze_decorators = [Remote("analyze")], _remoteSummarizeDuties_decorators = [Remote("summarizeDuties")], _remoteProgress_decorators = [Remote("progress")], _remoteProgressStats_decorators = [Remote("progressStats")], _remoteLlmStats_decorators = [Remote("llmStats")], _remoteNotePending_decorators = [Remote("notePending")], _remotePromptConfig_decorators = [Remote("promptConfig")], _remotePromptConfigSave_decorators = [Remote("promptConfigSave")], Service.init)]() {
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
