/**
 * Code-derived insights panel: services/events/tools/remotes extracted from
 * package source. Shown per package in the detail popup when code analysis is
 * enabled — the "code-first" view that never depends on documentation.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/insights-panel
 */
import type { ArchLensCodeInsight } from '@deepseek-ai/dsh-arch-lens-backend';
/**
 * Insights-panel props.
 */
export interface InsightsPanelProps {
    insight: ArchLensCodeInsight | undefined;
}
/** Render one package's code-derived insights. */
export declare function InsightsPanel(props: InsightsPanelProps): React.JSX.Element;
//# sourceMappingURL=insights-panel.d.ts.map