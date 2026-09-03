/**
 * Operation-level generation activity registry + the `@TrackGeneration`
 * standard-method decorator that arms it.
 *
 * The abort.ts `generationStatus` slot tracks LLM STREAMING: each `begin/end`
 * wraps ONE `prepareCall` (stage / elapsed / preview). This registry tracks the
 * OPERATION boundary instead — a whole `generateAll` / `generateDocs` /
 * `progress` … RPC, including its non-LLM phases (index/refresh scan, gaps
 * between per-figure LLM calls, post-processing). A page reopen during any of
 * those phases can therefore still restore the「生成中」state and wait for the
 * operation to finish, instead of only seeing it when an LLM call happens to be
 * streaming at that instant.
 *
 * The decorator is the single place that owns the enter/try/finally/exit
 * discipline: a generation method opts in with one annotation line
 * `@TrackGeneration('all')` above its `@Remote('...')`, and its body stays
 * untouched. (Direct try/finally per method would scatter the same exit logic
 * across N places and invite a forgotten `finally` that leaks a permanent
 * 「生成中」.)
 * @module @deepseek-ai/dsh-arch-lens-backend/src/generation-activity
 */
/** One in-flight host-direct generation operation (kind + start time). */
export interface GenerationActivityEntry {
    kind: string;
    startedAt: number;
}
/** Per-root set of in-flight generation operations. Keyed by KIND so a second
 * operation of the same kind is idempotent (re-enter refreshes startedAt),
 * while distinct kinds can run concurrently without clobbering each other. */
export declare class GenerationActivity {
    private readonly byRoot;
    enter(root: string, kind: string): void;
    exit(root: string, kind: string): void;
    list(root: string): GenerationActivityEntry[];
}
/**
 * Standard (TC39) method decorator: wrap a `@Remote` generation method so the
 * operation is registered in the host's `generationActivity` while it runs.
 * `resolveRoot()` is re-resolved at CALL time (same as every other remote);
 * when it does not yield a string (error branch) the method runs untracked.
 * @param kind - stable operation label surfaced by `generationActive` (e.g.
 *   'all', 'figure', 'docs', 'progress', 'duties', 'followup', 'dynamic',
 *   'custom'). The client maps it to the button's busy flag.
 */
export declare function TrackGeneration(kind: string): <This extends object, Args extends unknown[], Result>(method: (this: This, ...args: Args) => Result, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>) => (this: This, ...args: Args) => Result;
//# sourceMappingURL=generation-activity.d.ts.map