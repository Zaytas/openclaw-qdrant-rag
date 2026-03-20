/**
 * @openclaw-qdrant-rag/core — Gemini embedding client
 *
 * Features:
 *   - LRU cache with configurable size and TTL
 *   - Rate-limit handling (429 + Retry-After + exponential backoff)
 *   - Batch embedding support
 *   - Fails open — throws on error so callers can decide fallback strategy
 */
export declare class Embedder {
    private readonly apiKey;
    private readonly model;
    private readonly dimensions;
    /** LRU cache keyed by `taskType:text` */
    private cache;
    private readonly maxCacheSize;
    private readonly cacheTtlMs;
    /** Backoff state for rate limiting. */
    private backoffMs;
    private backoffUntil;
    private static readonly BASE_URL;
    private static readonly MAX_BACKOFF_MS;
    private static readonly MAX_RETRIES;
    /** Per-request timeout for fetch calls. */
    private readonly requestTimeoutMs;
    constructor(apiKey: string, model?: string, dimensions?: number, options?: {
        maxCacheSize?: number;
        cacheTtlMs?: number;
        requestTimeoutMs?: number;
    });
    /**
     * Embed a single text string.
     * Results are cached by (taskType, text).
     */
    embed(text: string, taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'): Promise<number[]>;
    /**
     * Embed multiple texts in a single batch request.
     * Individual results are cached.
     */
    embedBatch(texts: string[], taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'): Promise<number[][]>;
    private callApi;
    private callBatchApi;
    private fetchWithRetry;
    private applyBackoff;
    private waitForBackoff;
    private getFromCache;
    private putInCache;
}
//# sourceMappingURL=embedder.d.ts.map