//#region src/invariant.ts
const PACKAGE_NAME = "@deepseek-ai/dsh-code-index-tree-sitter";
/** Cordis companion plugin name. */
const name = "code-index-tree-sitter-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the provider's observable relationship (workspace
* root → packages/entities/imports) is asserted by its own specs on fixed
* source fixtures (import counts, entity kinds, composition depth) rather
* than a live runtime relation.
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
