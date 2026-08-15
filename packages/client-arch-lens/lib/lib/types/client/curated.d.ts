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
//# sourceMappingURL=curated.d.ts.map