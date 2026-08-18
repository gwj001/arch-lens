import { CodeIndex } from "@deepseek-ai/dsh-code-index";
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import Java from "tree-sitter-java";
//#region src/discover.ts
/** Max source files indexed per package (guards pathological repos). */
const MAX_FILES_PER_PACKAGE = 400;
/** Directories never indexed. */
const SKIP_DIRS = /* @__PURE__ */ new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	".git",
	".dsh",
	"venv",
	".venv",
	"target",
	"generated",
	".next",
	".turbo",
	"lib",
	"site-packages"
]);
/** Source extensions per language. */
const EXTENSIONS = {
	typescript: [".ts", ".tsx"],
	python: [".py"],
	java: [".java"]
};
/** Manifest files that mark a package root per language. */
const MANIFESTS = {
	typescript: ["package.json"],
	python: ["pyproject.toml", "setup.py"],
	java: [
		"build.gradle",
		"build.gradle.kts",
		"pom.xml"
	]
};
/** Resolve a relative name under a display-path directory. */
async function resolveUnder(fs, base, name) {
	try {
		return await fs.resolve(name, { cwd: base });
	} catch {
		return null;
	}
}
/** Whether a file exists under a directory. */
async function fileExists(fs, base, name) {
	const target = await resolveUnder(fs, base, name);
	if (target === null) return false;
	try {
		const info = await fs.stat(target);
		return info !== void 0 && info.type === "file";
	} catch {
		return false;
	}
}
/** Whether a directory exists under a directory. */
async function dirExists(fs, base, name) {
	const target = await resolveUnder(fs, base, name);
	if (target === null) return false;
	try {
		const info = await fs.stat(target);
		return info !== void 0 && info.type === "directory";
	} catch {
		return false;
	}
}
/** Detect the primary language of a workspace by probing manifests. */
async function detectLanguage(fs, root) {
	for (const candidate of MANIFESTS.typescript) if (await fileExists(fs, root, candidate)) return "typescript";
	for (const candidate of MANIFESTS.python) if (await fileExists(fs, root, candidate)) return "python";
	for (const candidate of MANIFESTS.java) if (await fileExists(fs, root, candidate)) return "java";
	return "unknown";
}
/**
* Discover package roots for a workspace of one language.
* TypeScript: `packages/<group>/<pkg>` dirs, or flat `packages/<pkg>` dirs
* (an entry under `packages/` that owns a package.json is itself a package),
* plus a root package with source for single-module repos.
* Python/Java: manifest-bearing dirs up to depth 3.
* @param fs - filesystem service.
* @param root - workspace root.
* @param language - primary language.
* @returns absolute package root display paths.
*/
async function discoverPackageRoots(fs, root, language) {
	if (language === "unknown") return [];
	if (language === "typescript") {
		const roots = [];
		if (await dirExists(fs, root, "packages")) {
			const groups = await listDirs(fs, root, "packages");
			for (const group of groups) {
				if (await fileExists(fs, group, "package.json")) {
					roots.push(group);
					continue;
				}
				const pkgs = await listDirs(fs, group, ".");
				for (const pkg of pkgs) if (await fileExists(fs, pkg, "package.json")) roots.push(pkg);
			}
		}
		if (roots.length === 0 && await dirExists(fs, root, "src")) roots.push(root);
		return roots;
	}
	const roots = [];
	const walk = async (dir, depth) => {
		if (depth > 3) return;
		for (const manifest of MANIFESTS[language]) if (await fileExists(fs, dir, manifest)) {
			roots.push(dir);
			return;
		}
		const entries = await listDirs(fs, dir, ".");
		for (const entry of entries) {
			if (SKIP_DIRS.has(entry.split(/[\\/]/).at(-1) ?? "")) continue;
			await walk(entry, depth + 1);
		}
	};
	await walk(root, 0);
	return roots;
}
/** List subdirectories of a directory (display paths). */
async function listDirs(fs, base, rel) {
	try {
		const target = rel === "." ? await fs.resolve(".", { cwd: base }) : await resolveUnder(fs, base, rel);
		if (target === null) return [];
		return (await fs.listDir(target)).filter((entry) => entry.type === "directory").map((entry) => entry.target.displayPath);
	} catch {
		return [];
	}
}
/** Relative path of a file under the workspace root, `/`-separated. */
function relPath(root, file) {
	return file.replace(root.replace(/\\/g, "/"), "").replace(/^[\\/]+/, "").replace(/\\/g, "/");
}
/**
* Collect source files of a package (bounded, skip dirs excluded).
* @param fs - filesystem service.
* @param pkgDir - absolute package root display path.
* @param language - package language.
* @returns resolved source file targets.
*/
async function collectSources(fs, pkgDir, language) {
	const extensions = EXTENSIONS[language];
	const files = [];
	const walk = async (dir) => {
		if (files.length >= MAX_FILES_PER_PACKAGE) return;
		let entries;
		try {
			entries = await fs.listDir(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (files.length >= MAX_FILES_PER_PACKAGE) return;
			if (entry.type === "directory") {
				if (SKIP_DIRS.has(entry.name)) continue;
				await walk(entry.target);
			} else if (entry.type === "file") {
				if (extensions.some((ext) => entry.name.endsWith(ext))) files.push(entry.target);
			}
		}
	};
	await walk(await fs.resolve(".", { cwd: pkgDir }));
	return files;
}
/** Read a small text file via its target, or return null. */
async function readSmall(fs, target, maxBytes = 262144) {
	try {
		const info = await fs.stat(target);
		if (info === void 0 || info.type !== "file") return null;
		if (info.size !== void 0 && info.size > maxBytes) return null;
		return await fs.readText(target);
	} catch {
		return null;
	}
}
/**
* Package-level dependencies from the manifest, best-effort per language.
* @param fs - filesystem service.
* @param pkgDir - absolute package root display path.
* @param language - package language.
* @returns dependency names.
*/
async function manifestDeps(fs, pkgDir, language) {
	const deps = [];
	if (language === "typescript") {
		const target = await resolveUnder(fs, pkgDir, "package.json");
		const meta = target === null ? null : await readSmall(fs, target, 262144);
		if (meta !== null) try {
			const parsed = JSON.parse(meta);
			for (const section of [parsed.dependencies, parsed.peerDependencies]) if (section !== void 0) for (const name of Object.keys(section)) deps.push(name);
		} catch {}
	} else if (language === "python") {
		const target = await resolveUnder(fs, pkgDir, "pyproject.toml");
		const pyproject = target === null ? null : await readSmall(fs, target, 262144);
		if (pyproject !== null) for (const line of pyproject.split("\n")) {
			const match = /^\s*["']([A-Za-z0-9_.-]+)["']/.exec(line);
			if (match !== null) deps.push(match[1]);
		}
	} else if (language === "java") {
		const target = await resolveUnder(fs, pkgDir, "pom.xml");
		const pom = target === null ? null : await readSmall(fs, target, 262144);
		if (pom !== null) {
			const pattern = /<artifactId>([^<]+)<\/artifactId>/g;
			let match;
			while ((match = pattern.exec(pom)) !== null) deps.push(match[1]);
		}
	}
	return [...new Set(deps)];
}
//#endregion
//#region src/parser.ts
/**
* Typed surface over the tree-sitter native bindings. The core package ships
* its own declarations; the grammar packages are shimmed in globals.d.ts.
* @module @deepseek-ai/dsh-code-index-tree-sitter/src/parser
*/
/** Load one grammar's language object. */
function languageFor(id) {
	switch (id) {
		case "typescript": return TypeScript.typescript;
		case "python": return Python;
		case "java": return Java;
	}
}
/**
* Parse a source string with the given language.
* @param id - language id.
* @param source - source text.
* @returns the parse tree.
*/
function parse(id, source) {
	const parser = new Parser();
	parser.setLanguage(languageFor(id));
	return parser.parse(source);
}
//#endregion
//#region src/java-adapter.ts
/**
* Java adapter: import edges, class/interface/enum entities, class-body
* method/field composition, and annotations, via tree-sitter-java.
* @module @deepseek-ai/dsh-code-index-tree-sitter/src/java-adapter
*/
/** Recursively collect nodes of one type. */
function collect$2(node, type, out = []) {
	if (node.type === type) out.push(node);
	for (const child of node.children) collect$2(child, type, out);
	return out;
}
/** First direct child with the given type. */
function childOf$2(node, type) {
	return node.children.find((candidate) => candidate.type === type);
}
/** Direct children with the given type. */
function childrenOf$2(node, type) {
	return node.children.filter((candidate) => candidate.type === type);
}
/** Annotation names (e.g. `Service` from `@Service` / `@Service("x")`). */
function annotationsOf(node) {
	const annotations = [];
	for (const child of childrenOf$2(node, "annotation")) {
		const name = child.children.find((candidate) => candidate.type === "identifier" || candidate.type === "scoped_identifier");
		if (name === void 0) continue;
		const text = name.text.replace(/@/, "");
		if (text !== "") annotations.push(text);
	}
	return annotations;
}
/** Extract imports from one source file. */
function importsOf$2(relPath, statements) {
	const imports = [];
	for (const statement of statements) {
		const text = statement.text.replace(/^import\s+/, "").replace(/;\s*$/, "").trim();
		if (text === "") continue;
		const isStatic = text.startsWith("static ");
		const path = (isStatic ? text.slice(7) : text).trim();
		if (path === "") continue;
		imports.push({
			from: relPath,
			to: path,
			names: [],
			...isStatic ? {} : {}
		});
	}
	return imports;
}
/** Extract entities (with class-body composition) from one source file. */
function entitiesOf$2(relPath, declarations) {
	const entities = [];
	for (const declaration of declarations) {
		const kind = declaration.type === "interface_declaration" ? "interface" : declaration.type === "enum_declaration" ? "enum" : declaration.type === "record_declaration" ? "class" : "class";
		const name = childOf$2(declaration, "identifier");
		if (name === void 0) continue;
		const entity = {
			name: name.text,
			kind,
			file: relPath,
			line: declaration.startPosition.row + 1
		};
		const modifiers = annotationsOf(declaration);
		if (modifiers.length > 0) entity.modifiers = modifiers;
		const body = childOf$2(declaration, "class_body");
		if (body !== void 0) {
			const children = [];
			for (const member of body.children) if (member.type === "method_declaration" || member.type === "constructor_declaration") {
				const methodName = childOf$2(member, "identifier");
				if (methodName === void 0) continue;
				children.push({
					name: methodName.text,
					kind: "method",
					file: relPath,
					line: member.startPosition.row + 1
				});
			} else if (member.type === "field_declaration") for (const declarator of childrenOf$2(member, "variable_declarator")) {
				const fieldName = childOf$2(declarator, "identifier");
				if (fieldName === void 0) continue;
				children.push({
					name: fieldName.text,
					kind: "field",
					file: relPath,
					line: declarator.startPosition.row + 1
				});
			}
			if (children.length > 0) entity.children = children;
		}
		entities.push(entity);
	}
	return entities;
}
/**
* Extract imports and entities from a Java source file.
* @param relPath - file path relative to the workspace root.
* @param source - source text.
* @returns imports and entities.
*/
function extractJava(relPath, source) {
	const root = parse("java", source).rootNode;
	return {
		imports: importsOf$2(relPath, collect$2(root, "import_declaration")),
		entities: entitiesOf$2(relPath, collect$2(root, "class_declaration").concat(collect$2(root, "interface_declaration")).concat(collect$2(root, "enum_declaration")).concat(collect$2(root, "record_declaration")))
	};
}
//#endregion
//#region src/python-adapter.ts
/**
* Python adapter: import edges, class/function entities, class-body method
* composition, and decorators, via tree-sitter-python.
* @module @deepseek-ai/dsh-code-index-tree-sitter/src/python-adapter
*/
/** Recursively collect nodes of one type. */
function collect$1(node, type, out = []) {
	if (node.type === type) out.push(node);
	for (const child of node.children) collect$1(child, type, out);
	return out;
}
/** First direct child with the given type. */
function childOf$1(node, type) {
	return node.children.find((candidate) => candidate.type === type);
}
/** Direct children with the given type. */
function childrenOf$1(node, type) {
	return node.children.filter((candidate) => candidate.type === type);
}
/** Decorator names (e.g. `app.route` from `@app.route('/x')`). */
function decoratorsOf$1(node) {
	const decorators = [];
	for (const child of childrenOf$1(node, "decorator")) {
		const inner = child.children.find((candidate) => candidate.type === "identifier" || candidate.type === "dotted_name" || candidate.type === "attribute" || candidate.type === "call");
		if (inner === void 0) continue;
		const text = inner.text.replace(/\(.*$/, "").trim();
		if (text !== "") decorators.push(text);
	}
	return decorators;
}
/** Extract imports from one source file. */
function importsOf$1(relPath, statements) {
	const imports = [];
	for (const statement of statements) if (statement.type === "import_statement") {
		for (const dotted of collect$1(statement, "dotted_name")) if (dotted.text !== "") imports.push({
			from: relPath,
			to: dotted.text,
			names: []
		});
	} else if (statement.type === "import_from_statement") {
		const moduleName = childOf$1(statement, "module_name") ?? childOf$1(statement, "dotted_name") ?? childOf$1(statement, "relative_import");
		const to = moduleName === void 0 ? "" : moduleName.text.replace(/^\.+/, "");
		if (to === "") continue;
		const names = [];
		let afterImport = false;
		for (const child of statement.children) {
			if (child.type === "import") {
				afterImport = true;
				continue;
			}
			if (!afterImport) continue;
			if (child.type === "aliased_import") {
				const first = child.children.find((candidate) => candidate.type === "dotted_name" || candidate.type === "identifier");
				if (first !== void 0) names.push(first.text.split(".")[0] ?? first.text);
			} else if (child.type === "dotted_name" || child.type === "identifier") names.push(child.text.split(".")[0] ?? child.text);
		}
		imports.push({
			from: relPath,
			to,
			names
		});
	}
	return imports;
}
/** Extract entities (with class-body method composition) from one source file. */
function entitiesOf$1(relPath, classes, functions) {
	const entities = [];
	const classSpans = [];
	for (const klass of classes) {
		classSpans.push({
			start: klass.startPosition.row,
			end: klass.endPosition.row
		});
		const name = childOf$1(klass, "identifier");
		if (name === void 0) continue;
		const entity = {
			name: name.text,
			kind: "class",
			file: relPath,
			line: klass.startPosition.row + 1
		};
		const modifiers = decoratorsOf$1(klass);
		if (modifiers.length > 0) entity.modifiers = modifiers;
		const body = childOf$1(klass, "block");
		if (body !== void 0) {
			const children = [];
			for (const member of childrenOf$1(body, "function_definition")) {
				const methodName = childOf$1(member, "identifier");
				if (methodName === void 0) continue;
				children.push({
					name: methodName.text,
					kind: "method",
					file: relPath,
					line: member.startPosition.row + 1
				});
			}
			if (children.length > 0) entity.children = children;
		}
		entities.push(entity);
	}
	for (const fn of functions) {
		if (classSpans.some((span) => fn.startPosition.row > span.start && fn.startPosition.row < span.end)) continue;
		const name = childOf$1(fn, "identifier");
		if (name === void 0) continue;
		const entity = {
			name: name.text,
			kind: "function",
			file: relPath,
			line: fn.startPosition.row + 1
		};
		const modifiers = decoratorsOf$1(fn);
		if (modifiers.length > 0) entity.modifiers = modifiers;
		entities.push(entity);
	}
	return entities;
}
/**
* Extract imports and entities from a Python source file.
* @param relPath - file path relative to the workspace root.
* @param source - source text.
* @returns imports and entities.
*/
function extractPython(relPath, source) {
	const root = parse("python", source).rootNode;
	return {
		imports: importsOf$1(relPath, collect$1(root, "import_statement").concat(collect$1(root, "import_from_statement"))),
		entities: entitiesOf$1(relPath, collect$1(root, "class_definition"), collect$1(root, "function_definition"))
	};
}
//#endregion
//#region src/ts-adapter.ts
/**
* TypeScript adapter: import edges, class/interface/enum/function entities,
* class-body composition, and decorators, via tree-sitter-typescript.
* @module @deepseek-ai/dsh-code-index-tree-sitter/src/ts-adapter
*/
/** Recursively collect nodes of one type. */
function collect(node, type, out = []) {
	if (node.type === type) out.push(node);
	for (const child of node.children) collect(child, type, out);
	return out;
}
/** First direct child with the given type. */
function childOf(node, type) {
	return node.children.find((candidate) => candidate.type === type);
}
/** Direct children with the given type. */
function childrenOf(node, type) {
	return node.children.filter((candidate) => candidate.type === type);
}
/** Text of the node's `name` field child (identifier/type_identifier/property_identifier). */
function nameOf(node) {
	const name = node.children.find((candidate) => candidate.type === "identifier" || candidate.type === "type_identifier" || candidate.type === "property_identifier" || candidate.type === "abstract");
	return name === void 0 ? "" : name.text;
}
/** Decorator names attached to a declaration (e.g. `Component` from `@Component()`). */
function decoratorsOf(node) {
	const decorators = [];
	for (const child of node.children) {
		if (child.type !== "decorator") continue;
		const inner = child.children.find((candidate) => candidate.type === "identifier" || candidate.type === "call_expression" || candidate.type === "member_expression");
		if (inner === void 0) continue;
		const text = inner.text.replace(/\(.*$/, "").trim();
		if (text !== "") decorators.push(text);
	}
	return decorators;
}
/** Extract imports from one source file. */
function importsOf(relPath, statements) {
	const imports = [];
	for (const statement of statements) {
		const source = childOf(statement, "string");
		if (source === void 0) continue;
		const to = source.text.slice(1, -1);
		if (to === "") continue;
		const typeOnly = statement.text.startsWith("import type");
		const names = [];
		const clause = childOf(statement, "import_clause");
		if (clause !== void 0) {
			for (const spec of childrenOf(clause, "import_specifier")) {
				const name = childOf(spec, "identifier") ?? childOf(spec, "type_identifier");
				if (name !== void 0) names.push(name.text);
			}
			for (const ns of childrenOf(clause, "namespace_import")) {
				const alias = childOf(ns, "identifier");
				if (alias !== void 0) names.push(alias.text);
			}
			for (const ns of childrenOf(clause, "named_imports")) for (const spec of childrenOf(ns, "import_specifier")) {
				const name = childOf(spec, "identifier") ?? childOf(spec, "type_identifier");
				if (name !== void 0) names.push(name.text);
			}
		}
		imports.push({
			from: relPath,
			to,
			names,
			...typeOnly ? { typeOnly: true } : {}
		});
	}
	return imports;
}
/** Extract entities (with class-body composition) from one source file. */
function entitiesOf(relPath, declarations) {
	const entities = [];
	for (const declaration of declarations) {
		const kind = declaration.type === "class_declaration" || declaration.type === "abstract_class_declaration" ? "class" : declaration.type === "interface_declaration" ? "interface" : declaration.type === "enum_declaration" ? "enum" : declaration.type === "type_alias_declaration" ? "type" : "function";
		const name = nameOf(declaration);
		if (name === "") continue;
		const entity = {
			name,
			kind,
			file: relPath,
			line: declaration.startPosition.row + 1
		};
		const modifiers = decoratorsOf(declaration);
		if (modifiers.length > 0) entity.modifiers = modifiers;
		if (kind === "class" || kind === "interface" || kind === "enum") {
			const body = childOf(declaration, "class_body");
			if (body !== void 0) {
				const children = [];
				for (const member of body.children) if (member.type === "method_definition" || member.type === "abstract_method_signature") {
					const methodName = nameOf(member);
					if (methodName === "") continue;
					children.push({
						name: methodName,
						kind: "method",
						file: relPath,
						line: member.startPosition.row + 1
					});
				} else if (member.type === "public_field_definition" || member.type === "field_definition") {
					const fieldName = nameOf(member);
					if (fieldName === "") continue;
					children.push({
						name: fieldName,
						kind: "field",
						file: relPath,
						line: member.startPosition.row + 1
					});
				}
				if (children.length > 0) entity.children = children;
			}
		}
		entities.push(entity);
	}
	return entities;
}
/**
* Extract imports and entities from a TypeScript source file.
* @param relPath - file path relative to the workspace root.
* @param source - source text.
* @returns imports and entities.
*/
function extractTs(relPath, source) {
	const root = parse("typescript", source).rootNode;
	return {
		imports: importsOf(relPath, collect(root, "import_statement")),
		entities: entitiesOf(relPath, collect(root, "class_declaration").concat(collect(root, "abstract_class_declaration")).concat(collect(root, "interface_declaration")).concat(collect(root, "enum_declaration")).concat(collect(root, "type_alias_declaration")).concat(collect(root, "function_declaration")))
	};
}
//#endregion
//#region src/index.ts
/** Disk cache file in the workspace root. */
const INDEX_CACHE_FILE = ".arch-lens-index.json";
/** Max packages indexed concurrently (fs IO is the bottleneck). */
const CONCURRENCY = 8;
/** Service required before indexing can read files. */
const inject = ["fs"];
/**
* The tree-sitter provider body: provide the codeIndex service.
* @param ctx - host context.
*/
function apply(ctx) {
	const fs = ctx.get("fs");
	if (fs === void 0) throw new Error("code-index-tree-sitter requires the fs service");
	new CodeIndexTreeSitter(ctx, fs);
}
/** Extract one source file into imports and entities by language. */
function extractFile(rel, source, language) {
	switch (language) {
		case "typescript": return extractTs(rel, source);
		case "python": return extractPython(rel, source);
		case "java": return extractJava(rel, source);
	}
}
/** Run `work` over items with bounded concurrency. */
async function mapLimit(items, limit, work) {
	const out = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			out[index] = await work(items[index]);
		}
	});
	await Promise.all(workers);
	return out;
}
/** The provider implementation. */
var CodeIndexTreeSitter = class extends CodeIndex {
	fs;
	cache = /* @__PURE__ */ new Map();
	constructor(ctx, fs) {
		super(ctx);
		this.fs = fs;
	}
	indexWorkspace(root) {
		let run = this.cache.get(root);
		if (run === void 0) {
			run = this.index(root);
			this.cache.set(root, run);
		}
		return run;
	}
	/**
	* Force-invalidate: drop the in-memory run and blank the on-disk cache (an
	* unparseable file reads back as "no cache", so the next indexWorkspace
	* re-indexes from current sources). Used by rescan and "refresh this
	* figure" — a stale index after code changed is never legal.
	* @param root - absolute workspace root.
	*/
	async refresh(root) {
		this.cache.delete(root);
		try {
			const target = await this.resolveCacheFile(root);
			if (target !== null) await this.fs.writeText(target, "");
		} catch {}
		console.log(`[code-index] refresh: index invalidated for ${root}`);
	}
	async index(root) {
		const language = await detectLanguage(this.fs, root);
		if (language === "unknown") return {
			root,
			language,
			packages: []
		};
		const cacheFile = await this.resolveCacheFile(root);
		const cached = cacheFile === null ? null : await this.readCache(cacheFile, language);
		if (cached !== null) {
			console.log(`[code-index] serving disk cache (${cached.packages.length} packages)`);
			return cached;
		}
		const packages = (await mapLimit(await discoverPackageRoots(this.fs, root, language), CONCURRENCY, (pkgDir) => this.indexPackage(root, pkgDir, language))).filter((pkg) => pkg !== void 0);
		const result = {
			root,
			language,
			packages
		};
		if (cacheFile !== null) try {
			await this.fs.writeText(cacheFile, JSON.stringify(result));
			console.log(`[code-index] disk cache written (${packages.length} packages)`);
		} catch (error) {
			console.warn(`[code-index] cache write failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		return result;
	}
	/** Resolve the cache file target under the workspace root, or null. */
	async resolveCacheFile(root) {
		try {
			return await this.fs.resolve(INDEX_CACHE_FILE, { cwd: root });
		} catch {
			return null;
		}
	}
	/** Read a cache file whose language matches; stale languages re-index. */
	async readCache(target, language) {
		try {
			const info = await this.fs.stat(target);
			if (info === void 0 || info.type !== "file") return null;
			const text = await this.fs.readText(target);
			const parsed = JSON.parse(text);
			if (parsed.language !== language) return null;
			return parsed;
		} catch {
			return null;
		}
	}
	async indexPackage(root, pkgDir, language) {
		const files = await collectSources(this.fs, pkgDir, language);
		if (files.length === 0) return void 0;
		const deps = await manifestDeps(this.fs, pkgDir, language);
		const entities = [];
		const imports = [];
		const entryFiles = [];
		for (const file of files) {
			const rel = relPath(root, file.displayPath);
			const source = await readSmall(this.fs, file);
			if (source === null) continue;
			const extracted = extractFile(rel, source, language);
			entities.push(...extracted.entities);
			imports.push(...extracted.imports);
			if (isEntryFile(rel, language)) entryFiles.push(rel);
		}
		return {
			id: shortId(pkgDir, language),
			path: pkgDir,
			language,
			deps,
			entities,
			imports,
			entryFiles
		};
	}
};
/** Whether a relative file looks like an entry point for the language. */
function isEntryFile(rel, language) {
	const name = rel.split("/").at(-1) ?? "";
	if (language === "typescript") return name === "index.ts" || name === "index.tsx" || name === "index.js";
	if (language === "python") return name === "__init__.py" || name === "main.py" || name === "cli.py";
	return /(Main|Application|App|Launcher)\.java$/.test(name);
}
/** Short package id: last path segment, npm scope stripped. */
function shortId(pkgDir, language) {
	const last = pkgDir.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? pkgDir;
	if (language === "typescript") return last.replace(/^@[^/]+\//, "");
	return last;
}
//#endregion
export { apply, inject };
