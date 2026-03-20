/**
 * @openclaw-qdrant-rag/core — Qdrant HTTP client
 *
 * Lightweight client using native fetch — no external dependencies.
 * All methods handle connection errors gracefully.
 */
// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export class QdrantClient {
    url;
    collection;
    timeoutMs;
    constructor(url, collection, timeoutMs = 5000) {
        // Strip trailing slash
        this.url = url.replace(/\/+$/, '');
        this.collection = collection;
        this.timeoutMs = timeoutMs;
    }
    /**
     * Search for nearest vectors.
     */
    async search(vector, options) {
        const body = {
            vector,
            limit: options.limit,
            with_payload: options.withPayload ?? true,
        };
        if (options.filter) {
            body['filter'] = options.filter;
        }
        if (options.scoreThreshold !== undefined) {
            body['score_threshold'] = options.scoreThreshold;
        }
        const response = await this.post(`/collections/${this.collection}/points/search`, body);
        const data = (await response.json());
        return data.result ?? [];
    }
    /**
     * Upsert (insert or update) points into the collection.
     */
    async upsertPoints(points) {
        if (points.length === 0)
            return;
        await this.put(`/collections/${this.collection}/points`, {
            points: points.map((p) => ({
                id: p.id,
                vector: p.vector,
                payload: p.payload ?? {},
            })),
        });
    }
    /**
     * Check whether the configured collection exists.
     */
    async collectionExists() {
        try {
            const response = await this.get(`/collections/${this.collection}`);
            if (!response.ok)
                return false;
            const data = (await response.json());
            return !!data.result;
        }
        catch {
            return false;
        }
    }
    /**
     * Create a new collection with the given vector dimensions.
     *
     * @param dimensions - Vector size (e.g. 3072 for Gemini embeddings).
     * @param distance - Distance metric. Defaults to 'Cosine'.
     */
    async createCollection(dimensions, distance = 'Cosine') {
        await this.put(`/collections/${this.collection}`, {
            vectors: {
                size: dimensions,
                distance,
            },
        });
    }
    /**
     * Check if Qdrant is reachable and healthy.
     */
    async healthCheck() {
        try {
            const response = await this.get('/healthz');
            return response.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Get collection info (useful for diagnostics).
     */
    async getCollectionInfo() {
        try {
            const response = await this.get(`/collections/${this.collection}`);
            if (!response.ok)
                return { exists: false };
            const data = (await response.json());
            return {
                exists: true,
                vectorsCount: data.result?.vectors_count,
            };
        }
        catch {
            return { exists: false };
        }
    }
    /**
     * List all collections.
     */
    async listCollections() {
        try {
            const response = await this.get('/collections');
            if (!response.ok)
                return [];
            const data = (await response.json());
            return (data.result?.collections ?? []).map((c) => c.name);
        }
        catch {
            return [];
        }
    }
    // -------------------------------------------------------------------------
    // HTTP helpers
    // -------------------------------------------------------------------------
    async get(path) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            return await fetch(`${this.url}${path}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timer);
        }
    }
    async post(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(`${this.url}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                const text = await response.text().catch(() => 'unknown');
                throw new Error(`Qdrant POST ${path} failed (${response.status}): ${text.slice(0, 500)}`);
            }
            return response;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async put(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(`${this.url}${path}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                const text = await response.text().catch(() => 'unknown');
                throw new Error(`Qdrant PUT ${path} failed (${response.status}): ${text.slice(0, 500)}`);
            }
            return response;
        }
        finally {
            clearTimeout(timer);
        }
    }
}
//# sourceMappingURL=qdrant-client.js.map