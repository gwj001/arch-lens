//#region packages/arch-lens-backend/src/invariant.ts
const PACKAGE_NAME = "@deepseek-ai/dsh-arch-lens-backend";
/** Cordis companion plugin name. */
const name = "arch-lens-backend-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the service's observable relationships are asserted by
* its own specs (scan fixture → node/edge counts; one staged notePending plus
* one matching assistant/message → exactly one appended entry) and the note
* file bound is a pure function tested directly.
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
