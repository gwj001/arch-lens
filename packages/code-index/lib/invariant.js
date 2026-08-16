//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-code-index`.
* @module @deepseek-ai/dsh-code-index/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-code-index";
/** Cordis companion plugin name. */
const name = "code-index-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: this package is a pure contract (abstract Service
* Definition); observable relationships live in the provider package, which
* owns its own invariant companion and specs.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
