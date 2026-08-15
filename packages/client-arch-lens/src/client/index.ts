/**
 * Arch Lens learning desk, browser half: registers the 'arch' entry in the
 * conversation view ring and renders the study units over the archLens Remote.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the archLens Remote namespace merge (TypertRemoteNamespaceMap).
import type {} from '@deepseek-ai/dsh-arch-lens-backend/remote'
// Type-only: pulls the ui-conversation SlotMap merge (the conversation.view entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ArchView } from './arch-view.tsx'
import type { ArchViewConfig } from './arch-view.tsx'

export type { ArchViewConfig } from './arch-view.tsx'
export type { ArchLensRemote, unwrapRemote } from './remote.ts'

/** Required services: the slot registry and the archLens Remote namespace. */
export const inject = ['slots', 'remote', 'remote.archLens']

/**
 * Client plugin body: register the 'arch' conversation view entry. The
 * registration rides the slot service's effect wrapper, so plugin unload
 * removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const config: ArchViewConfig = {}
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'arch',
    order: 20,
    label: '架构',
  }, props => ArchView({ ...props, archLens: ctx.remote.archLens, config })))
}
