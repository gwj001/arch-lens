/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-code-index`.
 * @module @deepseek-ai/dsh-code-index/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-code-index';
/** Cordis companion plugin name. */
export const name = 'code-index-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: this package is a pure contract (abstract Service
 * Definition); observable relationships live in the provider package, which
 * owns its own invariant companion and specs.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map