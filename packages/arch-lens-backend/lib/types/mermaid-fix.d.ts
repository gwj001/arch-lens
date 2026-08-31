/**
 * Mermaid syntax repair — the ONE shared leaf: imported by the backend chains
 * (re-exported through `flow-angle.ts`) AND by the browser renderer
 * (`@deepseek-ai/dsh-arch-lens-backend/mermaid-fix`). The client must never
 * import values from the backend MAIN entry (it would drag the whole service
 * bundle into the browser module table), which is why the repair lives here as
 * a zero-import leaf shipped as its own package export — one implementation,
 * both halves (a mirrored copy would be a third "two competing standards"
 * deadlock: the historical failure mode of this project).
 *
 * Role discipline (review-mandated): this is a REPAIRER, never a validator.
 * The only authority on diagram validity is the browser's version-matched
 * mermaid itself (render = validate); nothing here may ever stamp a figure
 * "valid", and every rule must be conservative — repair only what is
 * provably safe, otherwise leave the source byte-identical.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/mermaid-fix
 */
/**
 * The output-syntax contract line handed to LLM figure prompts (dynamic
 * drill-down / custom draw): the prompt pushes models to quote real code
 * symbols like `generateAll(incremental)` in titles, and a BARE subgraph
 * title containing ASCII parens is a hard parse error in mermaid 11
 * (incident: `subgraph 增量IO[⚡ 变动更新 · generateAll(incremental) ...]` →
 * `Parse error ... got 'PS'`, whole figure unrenderable). Quoted titles make
 * ASCII parens safe (browser-verified against mermaid 11.16.0).
 */
export declare const MERMAID_SYNTAX_RULE: string;
/**
 * Repair 2: quote a BARE subgraph title that contains ASCII parentheses —
 * the exact parse breaker above. Deliberately narrow (review-mandated v1
 * scope): titles already quoted, containing any quote character, or without
 * ASCII parens pass through byte-identical; node labels, `%%` comment lines
 * and every other diagram type are never touched. Idempotent.
 * @param source - mermaid source.
 * @returns source with safe bare subgraph titles quoted.
 */
export declare function quoteBareSubgraphTitles(source: string): string;
/**
 * Repair mermaid syntax the LLM tends to break. Applied to every LLM-produced
 * flow source (profile figures, chain induction, doc transcodes), to session
 * capture, and to cached/profile reads on BOTH halves (host via flow-angle
 * re-export, browser via the package export), so stale caches render again
 * after a plain page refresh.
 * @param source - mermaid flowchart source.
 * @returns the repaired source.
 */
export declare function sanitizeMermaid(source: string): string;
//# sourceMappingURL=mermaid-fix.d.ts.map