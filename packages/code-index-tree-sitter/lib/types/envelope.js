/**
 * Versioned disk envelope for the code-index cache: `{ v, data }` where `v`
 * is the facts version the index was built against (the arch-lens scanned
 * graph's `generatedAt` — the single change anchor). A disk file without a
 * version (legacy) or with a foreign version is stale data: readers must miss
 * and the provider must rebuild. Mirrors the `writeVersionedCache` v=0
 * discipline: an unknown facts version is never persisted.
 * @module @deepseek-ai/dsh-code-index-tree-sitter/src/envelope
 */
/**
 * Serialize an index result as a versioned envelope.
 * @param v - the facts version (0/unknown/∞ → refused: an unversionable index
 *   must not reach disk, matching the writeVersionedCache discipline).
 * @param result - the freshly built index.
 * @returns the JSON text to write.
 * @throws when the facts version is not a positive finite number.
 */
export function wrapIndexEnvelope(v, result) {
    if (!Number.isFinite(v) || v <= 0)
        throw new Error(`index cache envelope requires a positive facts version, got ${String(v)}`);
    const envelope = { v, data: result };
    return JSON.stringify(envelope);
}
/**
 * Parse and validate a cache file against the CURRENT facts version and the
 * detected language. Any mismatch (legacy unversioned file, foreign version,
 * wrong language, corrupt JSON) is a miss, never a partial serve.
 * @param text - the raw disk content.
 * @param expectedVersion - the current facts version (0/unknown ⇒ always miss).
 * @param language - the workspace language detected for this request.
 * @returns the cached index, or null when it may not be served.
 */
export function unwrapIndexEnvelope(text, expectedVersion, language) {
    if (!Number.isFinite(expectedVersion) || expectedVersion <= 0)
        return null;
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        const envelope = parsed;
        if (typeof envelope.v !== 'number' || envelope.v !== expectedVersion)
            return null;
        const data = envelope.data;
        if (typeof data !== 'object' || data === null)
            return null;
        const index = data;
        if (!Array.isArray(index.packages) || index.language !== language)
            return null;
        return data;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=envelope.js.map