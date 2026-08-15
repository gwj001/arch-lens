/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-arch-lens-backend`.
 * @module @deepseek-ai/dsh-arch-lens-backend/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-arch-lens-backend'

/** Cordis companion plugin name. */
export const name = 'arch-lens-backend-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service's observable relationships are asserted by
 * its own specs (scan fixture → node/edge counts; one staged notePending plus
 * one matching assistant/message → exactly one appended entry) and the note
 * file bound is a pure function tested directly.
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
