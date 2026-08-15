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
//# sourceMappingURL=remote.js.map