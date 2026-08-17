/**
 * Explain-prompt assembly for the Arch Lens learning desk. Prompts stay
 * learning-object-agnostic: the scanned graph injects the repository identity
 * and core components, so the same templates serve any workspace.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/explain
 */
import type { ArchLensCodeInsight, ArchLensGraph, ArchLensPromptConfig } from '@deepseek-ai/dsh-arch-lens-backend';
/** Default output language (Config/promptConfig.language may replace it). */
export declare const DEFAULT_LANGUAGE = "\u4E2D\u6587";
/** Default unit explain style (Config.explainStyle may replace it). */
export declare const DEFAULT_EXPLAIN_STYLE: string;
/** Default overview prompt (Config.overviewPrompt may replace it). */
export declare const DEFAULT_OVERVIEW_PROMPT: string;
/** English default overview prompt (used when the role language is English). */
export declare const DEFAULT_OVERVIEW_PROMPT_EN: string;
/** English default explain style (used when the role language is English). */
export declare const DEFAULT_EXPLAIN_STYLE_EN: string;
/** Default overview template for the configured role language. */
export declare function defaultOverview(language: string): string;
/** Default explain style for the configured role language. */
export declare function defaultStyle(language: string): string;
/**
 * Whether the per-language default templates should be used for prompts.
 * An explicit `useDefaults` wins; otherwise a config that already carries a
 * saved override behaves like "my prompts", and an empty one like defaults.
 * @param config - persisted prompt configuration.
 * @returns true when the default templates apply.
 */
export declare function useDefaultsConfig(config: ArchLensPromptConfig): boolean;
/**
 * Repository display name from the graph root path.
 * @param root - absolute workspace root.
 * @returns last path segment, or a fallback.
 */
export declare function repoName(root: string): string;
/**
 * The most-depended-upon package ids (core candidate heuristic).
 * @param graph - scanned graph.
 * @param limit - how many to return.
 * @returns short ids ordered by in-degree descending.
 */
export declare function coreCandidates(graph: ArchLensGraph, limit?: number): string[];
/**
 * Language directive appended to every explain prompt: the configured
 * "role language" governs all output (summaries, duty text, terminology,
 * code comments) and forbids mixing languages.
 * @param language - configured language name (e.g. '中文', 'English').
 * @returns the directive clause, or '' for the default language.
 */
export declare function languageClause(language: string): string;
/** One evidence entry for an explain: what it is, its source anchor, its facts. */
export interface EvidenceEntry {
    label: string;
    ref: string;
    text: string;
}
/**
 * Evidence + answering-discipline clause appended to EVERY explain prompt:
 * the model must answer only from the given facts (each with its source
 * anchor), flag conflicts, and call out documents it can prove wrong.
 * @param entries - evidence items (label / source anchor / bounded text).
 * @returns the clause, or '' when there is no evidence.
 */
export declare function evidenceClause(entries?: readonly EvidenceEntry[]): string;
/**
 * Assemble the overview explain request for a workspace graph.
 * @param graph - scanned graph.
 * @param overviewPrompt - configured or default template.
 * @param language - output language name.
 * @param evidence - optional evidence entries appended to the prompt.
 * @returns the question text.
 */
export declare function overviewQuestion(graph: ArchLensGraph, overviewPrompt: string, language: string, evidence?: readonly EvidenceEntry[]): string;
/**
 * Code-derived insight clause appended to component/concept explains: the
 * entry-source registrations (services/events/remotes/tools) so the model
 * explains from real code, not just README blurbs. Empty when no insight.
 * @param insight - code-derived insight for the package.
 * @returns the clause text, or '' when absent.
 */
export declare function codeInsightClause(insight: ArchLensCodeInsight | undefined): string;
/**
 * Assemble the per-component explain request.
 * @param id - package short id.
 * @param group - package group.
 * @param blurb - duty text (localized when available).
 * @param files - src file names.
 * @param explainStyle - configured or default style.
 * @param language - output language name.
 * @param insight - optional code-derived insight injected into the prompt.
 * @returns the question text.
 */
export declare function componentQuestion(id: string, group: string, blurb: string, files: string[], explainStyle: string, language: string, insight?: ArchLensCodeInsight, evidence?: readonly EvidenceEntry[]): string;
/**
 * Assemble the per-event explain request.
 * @param event - event name.
 * @param mode - dispatch mode.
 * @param producers - producer names.
 * @param consumers - consumer names.
 * @param note - event note.
 * @param explainStyle - configured or default style.
 * @param language - output language name.
 * @returns the question text.
 */
export declare function eventQuestion(event: string, mode: string, producers: string[], consumers: string[], note: string, explainStyle: string, language: string, evidence?: readonly EvidenceEntry[]): string;
/**
 * Assemble a unit-data explain request (figure/catalog).
 * @param title - unit title.
 * @param data - unit data JSON.
 * @param explainStyle - configured or default style.
 * @param language - output language name.
 * @param evidence - optional evidence entries appended to the prompt.
 * @returns the question text.
 */
export declare function dataQuestion(title: string, data: unknown, explainStyle: string, language: string, evidence?: readonly EvidenceEntry[]): string;
//# sourceMappingURL=explain.d.ts.map