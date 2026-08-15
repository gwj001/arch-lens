/**
 * Catalog unit: the flat `src/<pkg> # duty` listing over the scanned graph.
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
}
/** Duty text for one node in the configured language. */
export declare function dutyText(node: ArchLensGraph['nodes'][number], language: string): string;
/** Render the package catalog grouped by packages/<group>. */
export declare function Catalog(props: CatalogProps): React.JSX.Element;
//# sourceMappingURL=catalog.d.ts.map