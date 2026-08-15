/**
 * Arch Lens learning desk, browser half: registers a floating robot in the
 * shell overlay layer. The robot hosts the study units (concept tree, graphs,
 * catalog) and asks questions through the core conversation pipeline —
 * prompts go via `sessions.binding(id).session.prompt(...)`, so answers are
 * rendered by the main chat view with zero custom chat UI.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */
import { FloatingBot } from "./floating-bot.js";
/** Required services: the slot registry and the archLens Remote namespace. */
export const inject = ['slots', 'remote', 'remote.archLens', 'sessions'];
/**
 * Client plugin body: register the floating robot in the shell overlay. The
 * registration rides the slot service's effect wrapper, so plugin unload
 * removes the robot.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    const config = {};
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'arch-lens-bot',
        order: 100,
        inject: () => {
            const sessions = ctx.get('sessions');
            return {
                send: async (sessionId, text) => {
                    const binding = sessions?.binding(sessionId);
                    if (binding === undefined)
                        throw new Error(`arch-lens: session "${sessionId}" resolved no binding`);
                    const result = await binding.session.prompt([{ type: 'text', text }], 'queue');
                    if (!result.ok)
                        throw new Error(`arch-lens: prompt failed: ${result.error.code}: ${result.error.message}`);
                },
            };
        },
    }, props => FloatingBot({ ...props, archLens: ctx.remote.archLens, config })));
}
//# sourceMappingURL=index.js.map