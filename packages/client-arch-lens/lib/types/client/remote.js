/**
 * The archLens Remote face injected through `ctx.remote.archLens`. Method
 * signatures come from the generated remote-client artifact (TypertRemoteMap
 * merge); this alias keeps the component import surface small.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/remote
 */
/** Unwrap a RemoteResult envelope to the business value or a thrown error. */
export async function unwrapRemote(promise) {
    const result = await promise;
    if (result.ok)
        return result.value;
    throw new Error(result.error.message);
}
/**
 * Direct gateway call for Remote methods that may be missing from the
 * injected namespace: the client method table can lag a host upgrade (the
 * injected `ctx.remote.archLens` is a snapshot taken when the page loaded).
 * Uses the same client-request envelope as the harness remote channel, so
 * new methods (llmStats / regenerateFigure) work immediately after a host
 * restart without waiting for the client table to catch up.
 * @param method - the wire method name (e.g. 'llmStats').
 * @param args - the remote parameters (descriptor field names, e.g. { request }).
 * @returns the business value (envelope unwrapped).
 */
export async function directRemote(method, args) {
    const rpcId = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const response = await fetch(`/api/archLens/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'client-request',
            rpcId,
            method: `archLens/${method}`,
            payload: { args },
        }),
    });
    const json = await response.json();
    if (json.result?.ok !== true) {
        throw new Error(json.result?.error?.message ?? `archLens/${method} call failed`);
    }
    return json.result.value;
}
//# sourceMappingURL=remote.js.map