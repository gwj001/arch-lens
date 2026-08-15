/**
 * Explain-prompt assembly for the Arch Lens learning desk. Prompts stay
 * learning-object-agnostic: the scanned graph injects the repository identity
 * and core components, so the same templates serve any workspace.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/explain
 */
import type { ArchLensGraph } from '@deepseek-ai/dsh-arch-lens-backend';
/** Default output language (Config/promptConfig.language may replace it). */
export declare const DEFAULT_LANGUAGE = "\u4E2D\u6587";
/** Default unit explain style (Config.explainStyle may replace it). */
export declare const DEFAULT_EXPLAIN_STYLE: string;
/** Default overview prompt (Config.overviewPrompt may replace it). */
export declare const DEFAULT_OVERVIEW_PROMPT: string;
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
/**
 * Assemble the overview explain request for a workspace graph.
 * @param graph - scanned graph.
 * @param overviewPrompt - configured or default template.
 * @param language - output language name.
 * @returns the question text.
 */
export declare function overviewQuestion(graph: ArchLensGraph, overviewPrompt: string, language: string): string;
/**
 * Assemble the per-component explain request.
 * @param id - package short id.
 * @param group - package group.
 * @param blurb - duty text (localized when available).
 * @param files - src file names.
 * @param explainStyle - configured or default style.
 * @param language - output language name.
 * @returns the question text.
 */
export declare function componentQuestion(id: string, group: string, blurb: string, files: string[], explainStyle: string, language: string): string;
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
export declare function eventQuestion(event: string, mode: string, producers: string[], consumers: string[], note: string, explainStyle: string, language: string): string;
/**
 * Assemble a unit-data explain request (figure/catalog).
 * @param title - unit title.
 * @param data - unit data JSON.
 * @param explainStyle - configured or default style.
 * @param language - output language name.
 * @returns the question text.
 */
export declare function dataQuestion(title: string, data: unknown, explainStyle: string, language: string): string;
//# sourceMappingURL=explain.d.ts.map