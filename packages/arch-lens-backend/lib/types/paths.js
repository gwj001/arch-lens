/**
 * Path helpers shared by every LLM-facing prompt builder: facts handed to
 * the model must read workspace-relative (`packages/a/src/index.ts`) — the
 * absolute workspace root is stated ONCE per prompt, never per path.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/paths
 */
/** Strip the workspace root prefix so a path reads workspace-relative.
 * Separators are normalized to `/`; already-relative or foreign paths pass
 * through unchanged. */
export function workspaceRelative(root, path) {
    const r = root.replace(/\\/g, '/');
    const p = path.replace(/\\/g, '/');
    return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}
//# sourceMappingURL=paths.js.map