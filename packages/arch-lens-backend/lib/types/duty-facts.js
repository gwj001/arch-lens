/**
 * Single source of the package-duty priority chain (mirrors the mermaid-fix
 * leaf precedent: ZERO imports, browser-safe via a package subpath export so
 * BOTH halves consume one implementation — the host assembles figure prompts
 * with it, the browser catalog renders rows with it).
 *
 * Priority (review-confirmed against code, catalog dutyText semantics):
 *   AI duty summary (versioned cache, when supplied) → wins even if a README
 *   blurb exists; then blurbZh (README.zh.md first paragraph, 中文 interface
 *   only); then blurb (package.json description, falling back to the first
 *   README paragraph — see scan.ts).
 *
 * ZERO-LLM BY CONSTRUCTION: pure function over data already read; the LLM
 * generator lives in summarize.ts behind the force path and is unreachable
 * from here — an import of this module can never spend a token.
 * @module @deepseek-ai/dsh-arch-lens-backend/duty-facts
 */
/** One node's duty line: AI summary first, then localized scanned text. */
export function dutyForNode(id, node, language, summaries) {
    const ai = summaries?.[id];
    if (ai !== undefined && ai !== '')
        return ai;
    if (language === '中文' && node.blurbZh !== undefined && node.blurbZh !== '')
        return node.blurbZh;
    return node.blurb ?? '';
}
/**
 * The whole id → duty map the figure prompts embed. Holes (a package with
 * neither an AI summary nor any scanned text) stay EMPTY: the host reads the
 * same facts from disk the catalog renders from, so there is exactly ONE fact
 * source — a second, client-supplied map could only diverge (it existed as a
 * LEGACY fallback until the disk chain proved live and was then removed).
 * @param summaries - versioned AI duty cache (null = absent/stale → chain down).
 * @param nodes - scanned graph nodes (the authoritative facts).
 * @param language - role language ('中文' enables the README.zh.md tier).
 */
export function mergeDutyFacts(summaries, nodes, language) {
    const out = {};
    for (const node of nodes) {
        out[node.id] = dutyForNode(node.id, node, language, summaries);
    }
    return out;
}
//# sourceMappingURL=duty-facts.js.map