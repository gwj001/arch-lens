/**
 * Wire types for the Arch Lens backend service.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/types
 */
/**
 * Display label for a package group. `''` means a flat `packages/<pkg>`
 * layout (the node has no group directory); render it as `packages` so
 * subgraphs/entities never carry an empty label.
 * @param group - the node's group name ('' for flat layouts).
 * @returns the display label.
 */
export function groupLabel(group) {
    return group === '' ? 'packages' : group;
}
//# sourceMappingURL=types.js.map