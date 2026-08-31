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

/** The scanned-node fields the chain reads (ArchLensGraph nodes satisfy it). */
export interface DutyNodeFacts {
  id: string
  blurb: string
  blurbZh?: string
}

/** One node's duty line: AI summary first, then localized scanned text. */
export function dutyForNode(
  id: string,
  node: { blurb: string; blurbZh?: string },
  language: string,
  summaries?: Record<string, string> | null,
): string {
  const ai = summaries?.[id]
  if (ai !== undefined && ai !== '') return ai
  if (language === '中文' && node.blurbZh !== undefined && node.blurbZh !== '') return node.blurbZh
  return node.blurb ?? ''
}

/**
 * The whole id → duty map the figure prompts embed.
 * @param summaries - versioned AI duty cache (null = absent/stale → chain down).
 * @param nodes - scanned graph nodes (the authoritative facts).
 * @param language - role language ('中文' enables the README.zh.md tier).
 * @param clientBlurbs - LEGACY fallback map from an older client: only fills
 * ids the scan side could not serve (empty blurb), or the whole map when the
 * host could not read the graph at all. Never overrides AI or scanned text.
 */
export function mergeDutyFacts(
  summaries: Record<string, string> | null,
  nodes: readonly DutyNodeFacts[],
  language: string,
  clientBlurbs?: Record<string, string>,
): Record<string, string> {
  const source: readonly DutyNodeFacts[] = nodes.length > 0
    ? nodes
    : Object.entries(clientBlurbs ?? {}).map(([id, blurb]) => ({ id, blurb }))
  const out: Record<string, string> = {}
  for (const node of source) {
    const text = dutyForNode(node.id, node, language, summaries)
    out[node.id] = text !== '' ? text : clientBlurbs?.[node.id] ?? ''
  }
  return out
}
