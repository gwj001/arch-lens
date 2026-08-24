import { nodeLibrary } from '../tsdown.helpers.ts'

/**
 * Backend package build: node-half lib entries only. Typert artifacts are
 * generated separately by scripts/gen-typert.mjs (the tsdown typert plugin
 * integration cannot discover the Remote methods in this standalone layout).
 */
export default nodeLibrary('@deepseek-ai/dsh-arch-lens-backend', [
  'lib/types/index.js',
  'lib/types/invariant.js',
], 'packages/arch-lens-backend/lib')
