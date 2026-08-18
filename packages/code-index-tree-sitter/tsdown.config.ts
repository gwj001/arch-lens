import { defineConfig } from 'tsdown'

/**
 * Standalone bundle for the tree-sitter code-index provider. The root
 * tsdown config only builds the backend and client faces; this package keeps
 * its own config so the local build (mounted by the web profile) can be
 * regenerated from src. Tree-sitter native bindings and the platform
 * @deepseek-ai packages stay external — the DSH host provides the platform
 * modules, and tree-sitter loads native artifacts at runtime.
 */
export default defineConfig({
  name: '@deepseek-ai/dsh-code-index-tree-sitter',
  entry: {
    index: 'src/index.ts',
    invariant: 'src/invariant.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  deps: {
    neverBundle: [
      /^@deepseek-ai\//,
      'tree-sitter',
      'tree-sitter-typescript',
      'tree-sitter-python',
      'tree-sitter-java',
    ],
  },
  outputOptions: { entryFileNames: '[name].js' },
})
