/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-code-index-tree-sitter`.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-code-index-tree-sitter'

/** Cordis companion plugin name. */
export const name = 'code-index-tree-sitter-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider's observable relationship (workspace
 * root → packages/entities/imports) is asserted by its own specs on fixed
 * source fixtures (import counts, entity kinds, composition depth) rather
 * than a live runtime relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
