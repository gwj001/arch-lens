//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-client-arch-lens`.
* @module @deepseek-ai/dsh-client-arch-lens/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-client-arch-lens";
/** Cordis companion plugin name. */
const name = "client-arch-lens-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: a pure-consumer plugin — its view-slot registration is
* a plain effect whose disposal the slot ledger's own specs and this package's
* behavior specs observe directly, and its data comes from the backend Remote.
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
