/**
 * Arch Lens learning desk, browser half: registers the 'arch' entry in the
 * conversation view ring and renders the study units over the archLens Remote.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */
import { ArchView } from "./arch-view.js";
/** Required services: the slot registry and the archLens Remote namespace. */
export const inject = ['slots', 'remote', 'remote.archLens'];
/**
 * Client plugin body: register the 'arch' conversation view entry. The
 * registration rides the slot service's effect wrapper, so plugin unload
 * removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    const config = {};
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'arch',
        order: 20,
        label: '架构',
    }, props => ArchView({ ...props, archLens: ctx.remote.archLens, config })));
}
//# sourceMappingURL=index.js.map