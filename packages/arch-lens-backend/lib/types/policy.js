/**
 * Session-scoped sandbox policy resolution for arch-lens file writes.
 *
 * harness's fs sandbox (`dsh-fs-sandbox`) computes the `workspace-write`
 * containment root from the CALLING session's immutable cwd — the same root
 * arch-lens resolves as its learned workspace. Passing the resolved policy
 * with every mutation (the `sandboxPolicy` argument of `writeText`/`editText`,
 * exactly like `dsh-tool-fs` does per model tool call) lets harness approve
 * writes into the learned workspace instead of falling back to the deployment
 * root (which is a different directory and gets every write denied).
 *
 * Without a session the deployment fallback root applies, matching
 * `resolveRoot()`'s fallback — the two stay consistent by construction.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/policy
 */
/**
 * Resolve the policy for one session's writes (or the deployment fallback).
 * @param ctx - host context carrying sessions and sandboxPolicy services.
 * @param sessionId - target session id, or null for the deployment policy.
 * @returns the per-call mode and workspace root for fs mutations.
 */
export function sessionPolicy(ctx, sessionId) {
    const sessions = ctx.get('sessions');
    const session = sessionId === null ? undefined : sessions?.get(sessionId);
    const sandboxPolicy = ctx.get('sandboxPolicy');
    if (sandboxPolicy === undefined) {
        // No policy service (test hosts): deny writes by default.
        return { mode: 'read-only', workspaceRoot: process.cwd() };
    }
    return sandboxPolicy.resolve(session === undefined ? {} : { session });
}
//# sourceMappingURL=policy.js.map