/**
 * Arch Lens learning desk, browser half: registers a floating robot in the
 * shell overlay layer. The robot hosts the study units (concept tree, graphs,
 * catalog) and asks questions through the core conversation pipeline —
 * prompts go via `sessions.binding(id).session.prompt(...)`, so answers are
 * rendered by the main chat view with zero custom chat UI.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */

import z from '@deepseek-ai/schemastery'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ArchViewConfig } from './arch-view.tsx'
import { FloatingBot } from './floating-bot.tsx'

export type { ArchViewConfig } from './arch-view.tsx'
export type { ArchLensRemote, unwrapRemote } from './remote.ts'

/** Required services: the slot registry and the archLens Remote namespace. */
export const inject = ['slots', 'remote', 'remote.archLens', 'sessions']

/**
 * Plugin config. The robot icon is a configurable surface: deployers (or
 * fork maintainers) change it in their cordis.yml without touching code.
 */
export interface Config {
  /** Floating-robot icon text/emoji shown when idle (default '🤖'). */
  botIcon?: string
  /** Floating-robot icon shown while the explainer is busy (default '…' with a pulse animation). */
  busyIcon?: string
}

export const Config: z<Config> = z.object({
  botIcon: z.string(),
  busyIcon: z.string(),
})

/**
 * The robot's injected face: one send verb bound to a target session. The
 * prompt rides the core session pipeline (`queue` mode), so the main chat
 * view renders the question and its streaming answer.
 */
export interface BotInjected {
  /** Send one prompt into the target session (queued turn). */
  send: (sessionId: string, text: string) => Promise<void>
}

/**
 * Client plugin body: register the floating robot in the shell overlay. The
 * registration rides the slot service's effect wrapper, so plugin unload
 * removes the robot.
 * @param ctx - client root context.
 * @param config - validated plugin config (icon overrides).
 */
export function apply(ctx: ClientContext, config: Config = {}): void {
  const deskConfig: ArchViewConfig = {}
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'arch-lens-bot',
    order: 100,
    inject: (): BotInjected => {
      const sessions = ctx.get('sessions')
      return {
        send: async (sessionId: string, text: string): Promise<void> => {
          const binding = sessions?.binding(sessionId as SessionId)
          if (binding === undefined) throw new Error(`arch-lens: session "${sessionId}" resolved no binding`)
          const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
          if (!result.ok) throw new Error(`arch-lens: prompt failed: ${result.error.code}: ${result.error.message}`)
        },
      }
    },
  }, props => FloatingBot({
    ...props,
    archLens: ctx.remote.archLens,
    config: deskConfig,
    icon: config.botIcon ?? '🤖',
    busyIcon: config.busyIcon ?? '…',
  })))
}
