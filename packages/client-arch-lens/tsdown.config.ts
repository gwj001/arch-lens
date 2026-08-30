import { clientBundleConfig, nodeLibrary } from '../tsdown.helpers.ts'

/**
 * Client package build: node-half lib entries + the browser bundle.
 * The browser bundle keeps @deepseek-ai platform modules external (the DSH
 * module table provides them) and inlines mermaid + CSS Modules.
 */
export default [
  nodeLibrary('@deepseek-ai/dsh-client-arch-lens', [
    'lib/types/index.js',
    'lib/types/invariant.js',
  ], 'packages/client-arch-lens/lib'),
  clientBundleConfig('@deepseek-ai/dsh-client-arch-lens', 'lib/types/client/index.js'),
]
