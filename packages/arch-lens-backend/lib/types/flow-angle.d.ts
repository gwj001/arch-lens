/**
 * Flow-diagram generation viewpoints: the prompt text that turns the flow
 * figure from a free-form "draw something" into a learnable diagram with a
 * chosen storytelling angle. Shared by the shared-analysis-profile figure
 * call (analysis.ts) and the flow chain's induction fallback (flow.ts) so a
 * regenerate and a cold start always ask for the same structure.
 *
 * The rules are PROJECT-NEUTRAL: stage names, data products and event terms
 * are always derived from the analyzed project's own index summary — the
 * examples below only demonstrate STYLE (two-line labels, decision diamonds,
 * labeled edges), never a fixed vocabulary.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/flow-angle
 */
import type { FlowAngle } from './types.ts';
/** Short user-facing label per angle (used in prompts and the client UI). */
export declare const FLOW_ANGLE_LABEL: Record<FlowAngle, string>;
/** Angle-specific instruction: what story the diagram must tell. */
export declare function flowAngleRule(angle: FlowAngle): string;
/**
 * The style bar shared by every angle — structure plus the information
 * density of hand-written architecture diagrams: two-line labels (action +
 * mechanism), diamond decision nodes with 是/否 branches, stage subgraphs
 * with a duty line, and a compact few-shot example the model must match in
 * density. The example is a NEUTRAL style template: the model must replace
 * its content with the analyzed project's own facts, never copy the stage
 * names or node labels.
 */
export declare const FLOW_STYLE_RULES: string;
/**
 * The full rule set for one angle: its viewpoint plus the shared style bar.
 * Used by the chain induction (flow.ts); the profile figures call
 * (analysis.ts) emits the shared style block ONCE for both angles.
 */
export declare function flowAngleRules(angle: FlowAngle): string;
/**
 * Mermaid syntax repair — RE-EXPORT of the shared leaf (`mermaid-fix.ts`).
 * The implementation lives there because the browser renderer imports the
 * same single source through the package's `./mermaid-fix` export; a mirrored
 * copy in the client was a third "two competing standards" hazard (this
 * project's historical failure mode), so both halves must repair identically.
 * Existing backend importers keep importing it from here.
 */
export { MERMAID_SYNTAX_RULE, quoteBareSubgraphTitles, sanitizeMermaid } from './mermaid-fix.ts';
//# sourceMappingURL=flow-angle.d.ts.map