/**
 * Curated learning data for the Arch Lens units: concept tree, turn sequence,
 * and core event catalog. These are packaged defaults maintained with the
 * harness documentation; the sequence and events derive from
 * docs/architecture.md.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/curated
 */
/** One concept-tree node: a concept with optional children and an optional backing package id. */
export interface ConceptNode {
    id: string;
    name: string;
    desc: string;
    inside?: string;
    pkg?: string;
    children?: ConceptNode[];
    /** 'doc' = extracted from an architecture doc; 'flow' = AI-induced; undefined = curated. */
    source?: 'doc' | 'flow';
    /** Source anchor: doc path + heading (evidence for explains). */
    ref?: string;
    /** The section's full original text (evidence for explains). */
    sourceText?: string;
}
/** The curated concept hierarchy for deepseek-harness. */
export declare const CONCEPT_TREE: ConceptNode[];
/** One turn-sequence message. */
export interface SequenceMessage {
    from: string;
    to: string;
    label: string;
}
/** One sequence participant lane. */
export interface SequenceActor {
    name: string;
}
/** The curated actors of the turn flow. */
export declare const SEQUENCE_ACTORS: string[];
/** The curated turn message flow (derived from docs/architecture.md). */
export declare const SEQUENCE: SequenceMessage[];
/** One core interaction event row. */
export interface CoreEvent {
    event: string;
    mode: string;
    producers: string[];
    consumers: string[];
    note: string;
}
/** The curated core event catalog (derived from docs/architecture.md). */
export declare const CORE_EVENTS: CoreEvent[];
/** English concept hierarchy (mirror of CONCEPT_TREE, shown when the role language is English). */
export declare const CONCEPT_TREE_EN: ConceptNode[];
/** English turn message flow (mirror of SEQUENCE). */
export declare const SEQUENCE_EN: SequenceMessage[];
/** English core event catalog (mirror of CORE_EVENTS). */
export declare const CORE_EVENTS_EN: CoreEvent[];
//# sourceMappingURL=curated.d.ts.map