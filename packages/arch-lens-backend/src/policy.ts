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

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'

/** The session shape the policy resolver reads: id, immutable cwd, and the
 * event log that carries any `sandbox/mode` override. */
interface SessionLike {
  id: string
  header: { cwd?: string }
  events?: readonly unknown[]
}

/** The sandbox-policy service surface arch-lens consumes. */
interface SandboxPolicyLike {
  resolve(request?: { session?: SessionLike }): SandboxExecutionPolicy
}

/**
 * Resolve the policy for one session's writes (or the deployment fallback).
 * @param ctx - host context carrying sessions and sandboxPolicy services.
 * @param sessionId - target session id, or null for the deployment policy.
 * @returns the per-call mode and workspace root for fs mutations.
 */
export function sessionPolicy(ctx: Context, sessionId: string | null): SandboxExecutionPolicy {
  const sessions = ctx.get('sessions') as { get(id: SessionId): SessionLike | undefined } | undefined
  const session = sessionId === null ? undefined : sessions?.get(sessionId as SessionId)
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyLike | undefined
  if (sandboxPolicy === undefined) {
    // No policy service (test hosts): deny writes by default.
    return { mode: 'read-only', workspaceRoot: process.cwd() }
  }
  return sandboxPolicy.resolve(session === undefined ? {} : { session })
}
