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
  kind: string
  startedAt: number
}

/** Per-root set of in-flight generation operations. Keyed by KIND so a second
 * operation of the same kind is idempotent (re-enter refreshes startedAt),
 * while distinct kinds can run concurrently without clobbering each other. */
export class GenerationActivity {
  private readonly byRoot = new Map<string, Map<string, GenerationActivityEntry>>()

  enter(root: string, kind: string): void {
    let table = this.byRoot.get(root)
    if (table === undefined) {
      table = new Map()
      this.byRoot.set(root, table)
    }
    table.set(kind, { kind, startedAt: Date.now() })
  }

  exit(root: string, kind: string): void {
    const table = this.byRoot.get(root)
    if (table === undefined) return
    table.delete(kind)
    if (table.size === 0) this.byRoot.delete(root)
  }

  list(root: string): GenerationActivityEntry[] {
    const table = this.byRoot.get(root)
    if (table === undefined) return []
    return [...table.values()]
  }
}

/** Structural shape the decorator reaches into on the host (avoids importing
 * the concrete service class, which would be a circular dependency). */
interface GenerationTrackedHost {
  readonly generationActivity: GenerationActivity
  resolveRoot(): string | { error: string }
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
export function TrackGeneration(kind: string) {
  return function <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): (this: This, ...args: Args) => Result {
    if (context.static || context.private || typeof context.name !== 'string') {
      throw new TypeError('arch-lens: @TrackGeneration requires a public instance method with a string name')
    }
    return function (this: This, ...args: Args): Result {
      const host = this as unknown as GenerationTrackedHost
      const root = host.resolveRoot()
      if (typeof root !== 'string') return method.apply(this, args)
      host.generationActivity.enter(root, kind)
      try {
        // Promise.resolve covers both async and (theoretically) sync methods;
        // .finally runs exit exactly once on settle or rejection.
        return (Promise.resolve(method.apply(this, args)) as Promise<unknown>)
          .finally(() => host.generationActivity.exit(root, kind)) as Result
      } catch (error) {
        host.generationActivity.exit(root, kind)
        throw error
      }
    }
  }
}
