/**
 * Code-first analysis for the Arch Lens backend: scans each package's entry
 * source for service registrations, event listeners, Remote methods, and tool
 * registrations, so the learning desk can derive architecture from CODE even
 * when documentation is missing or stale. The analysis is bounded (entry
 * source head only) and heuristic (regex over source text), and its results
 * are explicitly "code-derived insights" — not a substitute for curated data,
 * but a fallback and cross-check.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/analyze
 */
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
export async function analyzePackage(fs, node) {
    const entryName = node.files.includes('index.ts')
        ? 'index.ts'
        : node.files.includes('index.js')
            ? 'index.js'
            : undefined;
    if (entryName === undefined)
        return { id: node.id, provides: [], listens: [], tools: [], remotes: [] };
    let head = '';
    try {
        const target = await fs.resolve(`src/${entryName}`, { cwd: node.path });
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file' || (info.size !== undefined && info.size > MAX_SOURCE_BYTES)) {
            return { id: node.id, provides: [], listens: [], tools: [], remotes: [] };
        }
        head = await fs.readText(target);
    }
    catch {
        return { id: node.id, provides: [], listens: [], tools: [], remotes: [] };
    }
    const provides = new Set();
    const listens = new Set();
    const remotes = new Set();
    for (const match of head.matchAll(PROVIDE_PATTERN)) {
        const key = match[1] ?? match[2];
        if (key !== undefined)
            provides.add(key);
    }
    for (const match of head.matchAll(LISTEN_PATTERN)) {
        const event = match[1] ?? match[2];
        if (match[2] !== undefined)
            remotes.add(match[2]);
        if (event !== undefined)
            listens.add(event);
    }
    const tools = new Set();
    for (const match of head.matchAll(TOOL_PATTERN)) {
        const name = match[1] ?? match[2];
        if (name !== undefined)
            tools.add(name);
    }
    return {
        id: node.id,
        provides: [...provides],
        listens: [...listens],
        tools: [...tools],
        remotes: [...remotes],
    };
}
/**
 * Analyze every package in the graph (bounded parallel: runs over the entry
 * heads only, sequential per package to keep fs usage flat).
 * @param fs - the filesystem service.
 * @param graph - scanned graph.
 * @returns insight records for packages with any finding.
 */
export async function analyzeWorkspace(fs, graph) {
    const insights = [];
    for (const node of graph.nodes) {
        const insight = await analyzePackage(fs, node);
        if (insight.provides.length > 0 || insight.listens.length > 0 || insight.tools.length > 0 || insight.remotes.length > 0) {
            insights.push(insight);
        }
    }
    return insights;
}
//# sourceMappingURL=analyze.js.map