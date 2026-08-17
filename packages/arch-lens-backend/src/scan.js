/**
 * Workspace repository scanning for the Arch Lens backend: package graph,
 * README blurbs, src file lists, and per-package detail projection.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/scan
 */
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
        const target = await fs.resolve('package.json', { cwd: base });
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file' || (info.size !== undefined && info.size > MAX_HEAD_BYTES))
            return null;
        return JSON.parse(await fs.readText(target));
    }
    catch {
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
        if (info === undefined || info.type !== 'file' || (info.size !== undefined && info.size > MAX_HEAD_BYTES))
            return '';
        const text = await fs.readText(target);
        return text.slice(0, max);
    }
    catch {
        return '';
    }
}
/**
 * First non-empty, non-heading, non-comment, non-language-switch paragraph of
 * a README head.
 * @param text - the README head text.
 * @returns the trimmed first paragraph (bounded).
 */
export function firstParagraph(text) {
    const lines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('<!--') && !line.startsWith('```'))
        .filter(line => !LANG_SWITCH_LINE.test(line));
    return lines[0] !== undefined ? lines[0].slice(0, 220) : '';
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
        const src = await fs.resolve('src', { cwd: base });
        const entries = await fs.listDir(src);
        return entries.filter(entry => entry.type === 'file').map(entry => entry.name).slice(0, 24);
    }
    catch {
        return [];
    }
}
/**
 * Classify a src file name into a role.
 * @param name - file basename.
 * @returns the role label.
 */
export function roleOf(name) {
    if (name === 'index.ts' || name === 'index.js')
        return 'entry';
    if (name === 'types.ts')
        return 'types';
    if (name === 'invariant.ts')
        return 'invariant';
    if (name === 'apply.ts')
        return 'assembly';
    if (name.endsWith('.spec.ts') || name.endsWith('.e2e.ts'))
        return 'test';
    return '';
}
/**
 * Scan the workspace `packages/<group>/<pkg>` tree into a graph. Each node
 * carries its precomputed popup detail, so the client can open package
 * details instantly without a second round trip.
 * @param fs - the filesystem service.
 * @param root - absolute workspace root.
 * @returns the graph, or an error result.
 */
export async function scanWorkspace(fs, root) {
    const nodes = [];
    const edges = [];
    const groups = new Set();
    try {
        const packagesTarget = await fs.resolve('packages', { cwd: root });
        const groupEntries = (await fs.listDir(packagesTarget)).filter(entry => entry.type === 'directory');
        for (const group of groupEntries) {
            groups.add(group.name);
            const pkgEntries = (await fs.listDir(group.target)).filter(entry => entry.type === 'directory');
            for (const pkg of pkgEntries) {
                const base = pkg.target.displayPath;
                const meta = await readJson(fs, base);
                if (meta === null || typeof meta.name !== 'string' || meta.name.length === 0)
                    continue;
                const short = meta.name.replace(/^@deepseek-ai\/dsh-/, '');
                const deps = typeof meta.peerDependencies === 'object' && meta.peerDependencies !== null
                    ? Object.keys(meta.peerDependencies)
                        .filter(key => key.startsWith('@deepseek-ai/dsh-'))
                        .map(key => key.replace(/^@deepseek-ai\/dsh-/, ''))
                    : [];
                for (const dep of deps)
                    edges.push({ from: short, to: dep });
                // package.json description is authored, one-line duty text; fall back
                // to the first README paragraph only when it is missing.
                const description = typeof meta.description === 'string' ? meta.description.trim() : '';
                const readme = await readHead(fs, base, 'README.md', 400);
                const blurb = description !== '' ? description.slice(0, 220) : firstParagraph(readme);
                // Localized duty text from README.zh.md, when the package ships one.
                const readmeZh = await readHead(fs, base, 'README.zh.md', 400);
                const blurbZh = firstParagraph(readmeZh);
                const files = await listSrc(fs, base);
                nodes.push({
                    id: short, short, group: group.name, blurb, files, deps, path: base,
                    ...(blurbZh !== '' ? { blurbZh } : {}),
                    detail: emptyDetail(short, group.name, blurb),
                });
            }
        }
    }
    catch (error) {
        return { error: `scan failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    // Dependents are a graph-wide relation: fill them in after every node is
    // known, then project each node's popup detail (entry head + key lines).
    // One package failing its detail must not sink the whole graph.
    for (const node of nodes) {
        const dependents = nodes.filter(candidate => candidate.deps.includes(node.short)).map(candidate => candidate.short);
        try {
            node.detail = await componentDetail(fs, node, dependents);
        }
        catch (error) {
            node.detail = { ...node.detail, deps: node.deps.slice(0, 40), dependents: dependents.slice(0, 40) };
            console.warn(`arch-lens: detail failed for ${node.short}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { root, groups: [...groups].sort(), nodes, edges };
}
/** Placeholder detail until the graph-wide pass fills it in. */
function emptyDetail(id, group, blurb) {
    return { id, short: id, group, blurb, files: [], deps: [], dependents: [], snippet: '', keyLines: [] };
}
/**
 * Project one package into its detail view.
 * @param fs - the filesystem service.
 * @param node - the package node.
 * @param dependents - short ids of packages that depend on this one.
 * @returns the detail projection.
 */
export async function componentDetail(fs, node, dependents) {
    const files = node.files.map(name => ({ name, role: roleOf(name) }));
    let snippet = '';
    const keyLines = [];
    const entryName = node.files.includes('index.ts')
        ? 'index.ts'
        : node.files.includes('index.js')
            ? 'index.js'
            : node.files[0];
    if (entryName !== undefined) {
        const head = await readHead(fs, node.path, `src/${entryName}`, 12000);
        snippet = head.split('\n').slice(0, 90)
            .map(line => line.length > 140 ? `${line.slice(0, 137)}…` : line)
            .join('\n');
        const registration = /(ctx\.(on|provide|effect|emit|waterfall|serial|parallel|inject)\(|\.register\(|harness\.(handle|registerTool)\(|@Remote\()/;
        for (const line of head.split('\n')) {
            if (registration.test(line))
                keyLines.push(line.trim().slice(0, 120));
            if (keyLines.length >= 18)
                break;
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
        keyLines,
    };
}
//# sourceMappingURL=scan.js.map