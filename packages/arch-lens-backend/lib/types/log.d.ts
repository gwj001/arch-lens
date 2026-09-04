/**
 * Debug channel for high-frequency diagnostics. Off by default so regular
 * runs stay quiet (harness-like terminal silence); `ARCH_LENS_DEBUG=1`
 * restores the full generation/cache path traces for troubleshooting.
 * Failures and one-shot lifecycle events keep their unguarded logging — only
 * the every-request noise routes here.
 */
/** Emit one debug line, or drop it when the channel is off. */
export declare function debug(...args: unknown[]): void;
//# sourceMappingURL=log.d.ts.map