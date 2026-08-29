/**
 * Shared tsdown helpers for the independent Arch Lens repo.
 *
 * The browser bundle must be loadable by the DSH client module table:
 * - the bundle calls `window.__ModuleLoader__.load({ id, factory })` (banner/footer)
 * - every `@deepseek-ai/*` platform module stays EXTERNAL (the runtime's module
 *   table provides it); mermaid and other own deps are inlined
 * - CSS Modules are compiled to hashed class maps and injected as style tags
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * Absolute repo root, derived from this file's location (packages/ -> repo
 * root). outDir entries MUST be absolute: tsdown resolves a relative outDir
 * against the config directory (not the repo root / cwd), which silently
 * emits bundles into a nested packages/<pkg>/packages/<pkg>/lib/ tree when
 * the build is run from inside the package.
 */
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * The frozen DSH browser module table (mirror of the harness
 * `packages/client/web/src/platform.ts` seed plus the documented
 * runtime-store exemption). A client bundle may require ONLY these
 * specifiers at runtime — the table answers seed words, shell-own modules,
 * and registered plugin factories, nothing else. Every other
 * `@deepseek-ai/*` module must inline into the bundle (wire layers) or is a
 * forbidden cross-plugin value import (collaboration goes through cordis
 * services); listing a non-table module here externalizes it into a
 * `require()` the table cannot answer at runtime.
 */
export const PLATFORM_EXTERNALS: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Node-half library config: emits ESM from the given entries into lib/.
 * Platform and own runtime dependencies stay external — the DSH host
 * provides them at runtime, so bundling them in would create duplicate
 * cordis/typert instances.
 *
 * IMPORTANT: outDir is per-package and must be passed explicitly. The helper
 * used to hard-code `packages/arch-lens-backend/lib`, which made the CLIENT
 * build overwrite the BACKEND's index.js with the client's node-half stub
 * (both packages call nodeLibrary). Every caller must pass its own outDir.
 * @param id - package name for diagnostics.
 * @param entries - entry files (src/*.ts, or lib/types/*.js after tsc).
 * @param outDir - repo-relative output directory (e.g. 'packages/arch-lens-backend/lib').
 */
export function nodeLibrary(id: string, entries: readonly string[], outDir: string): UserConfig {
  return {
    name: id,
    entry: entries.map(entry => ({ [basename(entry).replace(/\.(js|ts)$/, '')]: entry })),
    outDir: resolvePath(REPO_ROOT, outDir),
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    deps: { neverBundle: [...PLATFORM_EXTERNALS, /^@deepseek-ai\//, 'zod'] },
    outputOptions: { entryFileNames: '[name].js' },
  }
}

/**
 * Browser bundle config: CJS bundle named exactly client.js, loadable by the
 * DSH module table.
 * @param id - package name.
 * @param entry - client entry source (src/client/index.ts).
 */
export function clientBundleConfig(id: string, entry: string): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: resolvePath(REPO_ROOT, 'packages/client-arch-lens/lib'),
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...PLATFORM_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (moduleId: string) => (PLATFORM_EXTERNALS.includes(moduleId) ? undefined : true),
    plugins: [{
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(id)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      // DSH loads ONE bundle per plugin; forbid rolldown's code splitting so
      // mermaid's dynamic imports inline into client.js instead of emitting
      // 180+ chunks the module table never fetches.
      inlineDynamicImports: true,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}
