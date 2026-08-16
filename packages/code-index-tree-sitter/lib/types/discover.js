/**
 * Workspace discovery for the code-index provider: detect the primary
 * language, locate package/module roots, and collect source files per
 * language, plus manifest-level dependency extraction. File operations flow
 * through the fs service's FsTarget identities; display paths cross the
 * boundary only for reporting.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/discover
 */
/** Max source files indexed per package (guards pathological repos). */
const MAX_FILES_PER_PACKAGE = 400;
/** Directories never indexed. */
const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.dsh',
    'venv', '.venv', 'target', 'generated', '.next', '.turbo', 'lib', 'site-packages',
]);
/** Source extensions per language. */
const EXTENSIONS = {
    typescript: ['.ts', '.tsx'],
    python: ['.py'],
    java: ['.java'],
};
/** Manifest files that mark a package root per language. */
const MANIFESTS = {
    typescript: ['package.json'],
    python: ['pyproject.toml', 'setup.py'],
    java: ['build.gradle', 'build.gradle.kts', 'pom.xml'],
};
/** Resolve a relative name under a display-path directory. */
async function resolveUnder(fs, base, name) {
    try {
        return await fs.resolve(name, { cwd: base });
    }
    catch {
        return null;
    }
}
/** Whether a file exists under a directory. */
async function fileExists(fs, base, name) {
    const target = await resolveUnder(fs, base, name);
    if (target === null)
        return false;
    try {
        const info = await fs.stat(target);
        return info !== undefined && info.type === 'file';
    }
    catch {
        return false;
    }
}
/** Whether a directory exists under a directory. */
async function dirExists(fs, base, name) {
    const target = await resolveUnder(fs, base, name);
    if (target === null)
        return false;
    try {
        const info = await fs.stat(target);
        return info !== undefined && info.type === 'directory';
    }
    catch {
        return false;
    }
}
/** Detect the primary language of a workspace by probing manifests. */
export async function detectLanguage(fs, root) {
    for (const candidate of MANIFESTS.typescript) {
        if (await fileExists(fs, root, candidate))
            return 'typescript';
    }
    for (const candidate of MANIFESTS.python) {
        if (await fileExists(fs, root, candidate))
            return 'python';
    }
    for (const candidate of MANIFESTS.java) {
        if (await fileExists(fs, root, candidate))
            return 'java';
    }
    return 'unknown';
}
/**
 * Discover package roots for a workspace of one language.
 * TypeScript: `packages/<group>/<pkg>` dirs (plus a root package with source).
 * Python/Java: manifest-bearing dirs up to depth 3.
 * @param fs - filesystem service.
 * @param root - workspace root.
 * @param language - primary language.
 * @returns absolute package root display paths.
 */
export async function discoverPackageRoots(fs, root, language) {
    if (language === 'unknown')
        return [];
    if (language === 'typescript') {
        const roots = [];
        if (await dirExists(fs, root, 'packages')) {
            const groups = await listDirs(fs, root, 'packages');
            for (const group of groups) {
                const pkgs = await listDirs(fs, group, '.');
                for (const pkg of pkgs) {
                    if (await fileExists(fs, pkg, 'package.json'))
                        roots.push(pkg);
                }
            }
        }
        // A root-level package that owns source files (single-module repos).
        if (roots.length === 0 && (await dirExists(fs, root, 'src')))
            roots.push(root);
        return roots;
    }
    const roots = [];
    const walk = async (dir, depth) => {
        if (depth > 3)
            return;
        for (const manifest of MANIFESTS[language]) {
            if (await fileExists(fs, dir, manifest)) {
                roots.push(dir);
                return; // one manifest marks the root; do not descend into it
            }
        }
        const entries = await listDirs(fs, dir, '.');
        for (const entry of entries) {
            if (SKIP_DIRS.has(entry.split(/[\\/]/).at(-1) ?? ''))
                continue;
            await walk(entry, depth + 1);
        }
    };
    await walk(root, 0);
    return roots;
}
/** List subdirectories of a directory (display paths). */
async function listDirs(fs, base, rel) {
    try {
        const target = rel === '.' ? await fs.resolve('.', { cwd: base }) : await resolveUnder(fs, base, rel);
        if (target === null)
            return [];
        const entries = await fs.listDir(target);
        return entries.filter(entry => entry.type === 'directory').map(entry => entry.target.displayPath);
    }
    catch {
        return [];
    }
}
/** Relative path of a file under the workspace root, `/`-separated. */
export function relPath(root, file) {
    return file.replace(root.replace(/\\/g, '/'), '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
}
/**
 * Collect source files of a package (bounded, skip dirs excluded).
 * @param fs - filesystem service.
 * @param pkgDir - absolute package root display path.
 * @param language - package language.
 * @returns resolved source file targets.
 */
export async function collectSources(fs, pkgDir, language) {
    const extensions = EXTENSIONS[language];
    const files = [];
    const walk = async (dir) => {
        if (files.length >= MAX_FILES_PER_PACKAGE)
            return;
        let entries;
        try {
            entries = await fs.listDir(dir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (files.length >= MAX_FILES_PER_PACKAGE)
                return;
            if (entry.type === 'directory') {
                if (SKIP_DIRS.has(entry.name))
                    continue;
                await walk(entry.target);
            }
            else if (entry.type === 'file') {
                if (extensions.some(ext => entry.name.endsWith(ext)))
                    files.push(entry.target);
            }
        }
    };
    const root = await fs.resolve('.', { cwd: pkgDir });
    await walk(root);
    return files;
}
/** Read a small text file via its target, or return null. */
export async function readSmall(fs, target, maxBytes = 262144) {
    try {
        const info = await fs.stat(target);
        if (info === undefined || info.type !== 'file')
            return null;
        if (info.size !== undefined && info.size > maxBytes)
            return null;
        return await fs.readText(target);
    }
    catch {
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
export async function manifestDeps(fs, pkgDir, language) {
    const deps = [];
    if (language === 'typescript') {
        const target = await resolveUnder(fs, pkgDir, 'package.json');
        const meta = target === null ? null : await readSmall(fs, target, 262144);
        if (meta !== null) {
            try {
                const parsed = JSON.parse(meta);
                for (const section of [parsed.dependencies, parsed.peerDependencies]) {
                    if (section !== undefined)
                        for (const name of Object.keys(section))
                            deps.push(name);
                }
            }
            catch {
                // malformed manifest → no deps
            }
        }
    }
    else if (language === 'python') {
        const target = await resolveUnder(fs, pkgDir, 'pyproject.toml');
        const pyproject = target === null ? null : await readSmall(fs, target, 262144);
        if (pyproject !== null) {
            for (const line of pyproject.split('\n')) {
                const match = /^\s*["']([A-Za-z0-9_.-]+)["']/.exec(line);
                if (match !== null)
                    deps.push(match[1]);
            }
        }
    }
    else if (language === 'java') {
        const target = await resolveUnder(fs, pkgDir, 'pom.xml');
        const pom = target === null ? null : await readSmall(fs, target, 262144);
        if (pom !== null) {
            const pattern = /<artifactId>([^<]+)<\/artifactId>/g;
            let match;
            while ((match = pattern.exec(pom)) !== null)
                deps.push(match[1]);
        }
    }
    return [...new Set(deps)];
}
//# sourceMappingURL=discover.js.map