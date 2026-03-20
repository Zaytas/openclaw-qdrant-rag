/**
 * @openclaw-qdrant-rag/core — Gemini embedding client
 *
 * Features:
 *   - LRU cache with configurable size and TTL
 *   - Rate-limit handling (429 + Retry-After + exponential backoff)
 *   - Batch embedding support
 *   - Fails open — throws on error so callers can decide fallback strategy
 */
// ---------------------------------------------------------------------------
// Embedder
// ---------------------------------------------------------------------------
export class Embedder {
    apiKey;
    model;
    dimensions;
    /** LRU cache keyed by `taskType:text` */
    cache = new Map();
    maxCacheSize;
    cacheTtlMs;
    /** Backoff state for rate limiting. */
    backoffMs = 0;
    backoffUntil = 0;
    static BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
    static MAX_BACKOFF_MS = 60_000;
    static MAX_RETRIES = 3;
    /** Per-request timeout for fetch calls. */
    requestTimeoutMs;
    constructor(apiKey, model = 'models/gemini-embedding-001', dimensions = 3072, options) {
        this.apiKey = apiKey;
        this.model = model;
        this.dimensions = dimensions;
        this.maxCacheSize = options?.maxCacheSize ?? 100;
        this.cacheTtlMs = options?.cacheTtlMs ?? 5 * 60 * 1000; // 5 minutes
        this.requestTimeoutMs = options?.requestTimeoutMs ?? 15_000;
    }
    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    /**
     * Embed a single text string.
     * Results are cached by (taskType, text).
     */
    async embed(text, taskType) {
        const cacheKey = `${taskType}:${text}`;
        const cached = this.getFromCache(cacheKey);
        if (cached)
            return cached;
        const vector = await this.callApi(text, taskType);
        this.putInCache(cacheKey, vector);
        return vector;
    }
    /**
     * Embed multiple texts in a single batch request.
     * Individual results are cached.
     */
    async embedBatch(texts, taskType) {
        if (texts.length === 0)
            return [];
        // Check cache first, collect misses
        const results = texts.map((t) => {
            const cached = this.getFromCache(`${taskType}:${t}`);
            return cached ?? null;
        });
        const missIndices = results
            .map((r, i) => (r === null ? i : -1))
            .filter((i) => i >= 0);
        if (missIndices.length === 0) {
            return results;
        }
        // Batch embed misses
        const missTexts = missIndices.map((i) => texts[i]);
        const embedded = await this.callBatchApi(missTexts, taskType);
        // Merge back and cache
        for (let j = 0; j < missIndices.length; j++) {
            const idx = missIndices[j];
            const vec = embedded[j];
            results[idx] = vec;
            this.putInCache(`${taskType}:${texts[idx]}`, vec);
        }
        return results;
    }
    // -------------------------------------------------------------------------
    // API calls with retry
    // -------------------------------------------------------------------------
    async callApi(text, taskType) {
        const url = `${Embedder.BASE_URL}/${this.model}:embedContent?key=${this.apiKey}`;
        const body = {
            model: this.model,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: this.dimensions,
        };
        const response = await this.fetchWithRetry(url, body);
        const data = (await response.json());
        if (!data.embedding?.values) {
            throw new Error(`Embedding API returned no values: ${JSON.stringify(data).slice(0, 500)}`);
        }
        return data.embedding.values;
    }
    async callBatchApi(texts, taskType) {
        const url = `${Embedder.BASE_URL}/${this.model}:batchEmbedContents?key=${this.apiKey}`;
        const body = {
            requests: texts.map((text) => ({
                model: this.model,
                content: { parts: [{ text }] },
                taskType,
                outputDimensionality: this.dimensions,
            })),
        };
        const response = await this.fetchWithRetry(url, body);
        const data = (await response.json());
        if (!data.embeddings || data.embeddings.length !== texts.length) {
            throw new Error(`Batch embedding returned unexpected shape: expected ${texts.length} embeddings, got ${data.embeddings?.length ?? 0}`);
        }
        return data.embeddings.map((e) => e.values);
    }
    async fetchWithRetry(url, body) {
        let lastError;
        for (let attempt = 0; attempt <= Embedder.MAX_RETRIES; attempt++) {
            // Respect backoff from previous 429
            await this.waitForBackoff();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                clearTimeout(timer);
                if (response.ok) {
                    this.backoffMs = 0; // Reset on success
                    return response;
                }
                if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    this.applyBackoff(retryAfter);
                    lastError = new Error(`Rate limited (429). Retry-After: ${retryAfter ?? 'not set'}`);
                    continue;
                }
                // Non-retryable error
                const errorText = await response.text().catch(() => 'unknown');
                throw new Error(`Embedding API error ${response.status}: ${errorText.slice(0, 500)}`);
            }
            catch (err) {
                clearTimeout(timer);
                if (err instanceof Error && err.message.startsWith('Embedding API error')) {
                    throw err; // Don't retry non-429 API errors
                }
                // Timeout aborts get a clear error message and retry
                if (err instanceof Error && err.name === 'AbortError') {
                    lastError = new Error(`Embedding request timed out after ${this.requestTimeoutMs}ms`);
                    this.applyBackoff(null);
                    continue;
                }
                lastError = err instanceof Error ? err : new Error(String(err));
                // Network error — apply backoff and retry
                this.applyBackoff(null);
            }
        }
        throw lastError ?? new Error('Embedding request failed after retries');
    }
    // -------------------------------------------------------------------------
    // Backoff helpers
    // -------------------------------------------------------------------------
    applyBackoff(retryAfterHeader) {
        if (retryAfterHeader) {
            const seconds = Number(retryAfterHeader);
            if (!Number.isNaN(seconds) && seconds > 0) {
                this.backoffMs = seconds * 1000;
            }
            else {
                // Retry-After might be an HTTP date — fallback to exponential
                this.backoffMs = Math.min((this.backoffMs || 1000) * 2, Embedder.MAX_BACKOFF_MS);
            }
        }
        else {
            this.backoffMs = Math.min((this.backoffMs || 1000) * 2, Embedder.MAX_BACKOFF_MS);
        }
        this.backoffUntil = Date.now() + this.backoffMs;
    }
    async waitForBackoff() {
        const wait = this.backoffUntil - Date.now();
        if (wait > 0) {
            await new Promise((resolve) => setTimeout(resolve, wait));
        }
    }
    // -------------------------------------------------------------------------
    // LRU cache
    // -------------------------------------------------------------------------
    getFromCache(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        // Check TTL
        if (Date.now() - entry.createdAt > this.cacheTtlMs) {
            this.cache.delete(key);
            return undefined;
        }
        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.vector;
    }
    putInCache(key, vector) {
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxCacheSize) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined)
                this.cache.delete(oldest);
        }
        this.cache.set(key, { vector, createdAt: Date.now() });
    }
}
//# sourceMappingURL=embedder.js.map