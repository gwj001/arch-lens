/**
 * Catalog unit: the flat `src/<pkg> # duty` listing over the scanned graph.
 * Duty text prefers the AI summary, then the localized README paragraph.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/catalog
 */
import type { ArchLensGraph } from '@deepseek-ai/dsh-arch-lens-backend';
/**
 * Catalog-unit props.
 */
export interface CatalogProps {
    graph: ArchLensGraph;
    onSelectPkg: (id: string) => void;
    /** Output language ('中文' prefers README.zh.md duty text). */
    language: string;
    /** AI duty summaries (id → one-line summary), when generated. */
    summaries?: Record<string, string>;
}
/** Duty text for one node — delegated to the shared duty-facts leaf:
 * AI summary → blurbZh (README.zh.md, 中文 only) → blurb (package.json
 * description, README paragraph as scan-time fallback). */
export declare function dutyText(node: ArchLensGraph['nodes'][number], language: string, summaries?: Record<string, string> | null): string;
/** Render the package catalog grouped by packages/<group>. */
export declare function Catalog(props: CatalogProps): React.JSX.Element;
//# sourceMappingURL=catalog.d.ts.map