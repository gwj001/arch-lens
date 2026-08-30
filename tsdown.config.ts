import { defineConfig } from 'tsdown'
import { clientBundleConfig, nodeLibrary } from './packages/tsdown.helpers.ts'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

/**
 * Independent-repo tsdown config: builds the two packages explicitly.
 * The host face bundles the backend service; the client face bundles the
 * browser half with mermaid inlined into one client.js.
 */
export default defineConfig(({ env }) => {
  const client = env?.DSH_BUILD_FACE === 'client'
  return client
    ? clientBundleConfig('@deepseek-ai/dsh-client-arch-lens', 'packages/client-arch-lens/lib/types/client/index.js')
    : [
        {
          ...nodeLibrary('@deepseek-ai/dsh-arch-lens-backend', [
            'packages/arch-lens-backend/src/index.ts',
            'packages/arch-lens-backend/src/invariant.ts',
          ], 'packages/arch-lens-backend/lib'),
          plugins: [typertPlugin({ mode: 'workspace', faces: ['host'] })],
        },
        // The tree-sitter code-index provider is mounted by the profile as
        // its own plugin row (lib/index.js); it must rebuild with the host
        // face, or a stale bundle silently serves the deployed provider.
        nodeLibrary('@deepseek-ai/dsh-code-index-tree-sitter', [
          'packages/code-index-tree-sitter/src/index.ts',
        ], 'packages/code-index-tree-sitter/lib'),
      ]
})
