/**
 * Arch Lens learning desk, browser half: registers a floating robot in the
 * shell overlay layer. The robot hosts the study units (concept tree, graphs,
 * catalog) and asks questions through the core conversation pipeline —
 * prompts go via `sessions.binding(id).session.prompt(...)`, so answers are
 * rendered by the main chat view with zero custom chat UI.
 * @module @deepseek-ai/dsh-client-arch-lens/client
 */
import z from '@deepseek-ai/schemastery';
// Runtime: the generated remote contribution, mounted by THIS plugin. The
// release harness no longer assembles archLens into its api-remotes, so the
// standalone plugin must mount its own backend namespace.
import archLensRemote from '@deepseek-ai/dsh-arch-lens-backend/remote';
import { FloatingBot } from "./floating-bot.js";
/** Required services: the slot registry, the Remote mount seat, and sessions. */
export const inject = ['slots', 'remote', 'sessions'];
export const Config = z.object({
    botIcon: z.string().default('🤖'),
    busyIcon: z.string().default('…'),
});
/**
 * Client plugin body: mount the generated archLens Remote contribution, then
 * register the floating robot in the shell overlay. The Remote namespace does
 * not exist at plugin activation — the release harness no longer mounts it —
 * so the UI waits for it in a nested fiber, and activation never blocks boot.
 * The registration rides the slot service's effect wrapper, so plugin unload
 * removes the robot.
 * @param ctx - client root context.
 * @param config - validated plugin config (icon overrides).
 * @returns disposer unwinding the Remote namespace and the overlay registration.
 */
export async function apply(ctx, config = {}) {
    const deskConfig = {};
    const disposeRemote = await ctx.remote.$mount(archLensRemote);
    const ui = ctx.inject(['remote.archLens'], (scope) => {
        // Capture the remote namespace ONCE: the property access may rebuild the
        // namespace each time, which would re-run every effect keyed on it (an
        // infinite request loop).
        const archLens = scope.remote.archLens;
        scope.effect(() => scope.slots.inject('shell.overlay', () => scope.slots.register({
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
                    cancel: async (sessionId) => {
                        const binding = sessions?.binding(sessionId);
                        if (binding === undefined)
                            return;
                        await binding.session.cancel();
                    },
                };
            },
        }, props => FloatingBot({
            ...props,
            archLens,
            config: deskConfig,
            icon: config.botIcon ?? '🤖',
            busyIcon: config.busyIcon ?? '…',
        }))), 'arch-lens: floating-bot overlay');
    });
    try {
        await ui;
    }
    catch (error) {
        await ui.dispose();
        await disposeRemote();
        throw error;
    }
    return async () => {
        await ui.dispose();
        await disposeRemote();
    };
}
//# sourceMappingURL=index.js.map