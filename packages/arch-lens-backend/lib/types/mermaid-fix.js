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
export const MERMAID_SYNTAX_RULE = '若使用 flowchart：subgraph 标题一律写成引号形式 `subgraph id["标题"]`——裸标题里的半角括号 ( ) 会导致整图渲染失败；'
    + '多行文本用 <br/>；标签内的字面尖括号写成 &lt; &gt;，真正的 HTML 标签（<br/>、<small> 等）保持原样。';
/**
 * Repair 1 (original behavior, unchanged): half-width parentheses /
 * semicolons inside EDGE labels (`-->|触发(emit)|`) are rejected by the
 * flowchart grammar; full-width forms preserve the semantics.
 */
function repairEdgeLabels(source) {
    return source.replace(/(-\.->|-->|==>)\|([^|\n]*)\|/g, (_all, arrow, label) => {
        const clean = label.replace(/[();]/g, ch => ch === '(' ? '（' : ch === ')' ? '）' : '；');
        return `${arrow}|${clean}|`;
    });
}
/** A whole-line `subgraph id[裸标题]` statement (nothing after the final
 * `]`): head/id/optional space/open bracket/title/close bracket. The id
 * EXCLUDES brackets and quotes — that makes the first `[` after it the ONLY
 * open-bracket candidate (with `\S+` the backtracking engine happily swallows
 * `X[缓存` as "id" and injects quotes mid-title: a unit test caught this),
 * while the greedy title + `$`-anchored `]` make the LAST `]` the terminator,
 * so nested `标题[a]b` extracts unambiguously (browser-verified: quoted
 * titles may contain nested square brackets). Trailing junk (`] %% note`,
 * `] --> x`) cannot match — such lines are left untouched rather than guessed
 * at. An id-less `subgraph [标题]` / `subgraph "标题"` does not match
 * (fabricating an id would rewrite edge endpoints). The `gm` flags matter:
 * `m` so `^`/`$` bind to LINES (without it a multi-line source never matches
 * anything but its first line — a unit test caught this), `g` to repair every
 * subgraph line in one pass. */
const BARE_SUBGRAPH_LINE = /^(\s*subgraph\s+)([^\s[\]"']+)(\s*\[)([^\n]*)(\][ \t]*)$/gm;
/**
 * Repair 2: quote a BARE subgraph title that contains ASCII parentheses —
 * the exact parse breaker above. Deliberately narrow (review-mandated v1
 * scope): titles already quoted, containing any quote character, or without
 * ASCII parens pass through byte-identical; node labels, `%%` comment lines
 * and every other diagram type are never touched. Idempotent.
 * @param source - mermaid source.
 * @returns source with safe bare subgraph titles quoted.
 */
export function quoteBareSubgraphTitles(source) {
    return source.replace(BARE_SUBGRAPH_LINE, (line, head, id, open, title, close) => {
        if (title.includes('"') || title.includes("'"))
            return line;
        if (!title.includes('(') && !title.includes(')'))
            return line;
        return `${head}${id}${open}"${title}"${close}`;
    });
}
/**
 * Repair mermaid syntax the LLM tends to break. Applied to every LLM-produced
 * flow source (profile figures, chain induction, doc transcodes), to session
 * capture, and to cached/profile reads on BOTH halves (host via flow-angle
 * re-export, browser via the package export), so stale caches render again
 * after a plain page refresh.
 * @param source - mermaid flowchart source.
 * @returns the repaired source.
 */
export function sanitizeMermaid(source) {
    return quoteBareSubgraphTitles(repairEdgeLabels(source));
}
//# sourceMappingURL=mermaid-fix.js.map