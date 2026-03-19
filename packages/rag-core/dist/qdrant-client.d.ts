/**
 * @openclaw-qdrant-rag/core — Qdrant HTTP client
 *
 * Lightweight client using native fetch — no external dependencies.
 * All methods handle connection errors gracefully.
 */
import type { QdrantSearchResult, QdrantPoint } from './types.js';
export interface SearchOptions {
    limit: number;
    filter?: Record<string, unknown>;
    withPayload?: boolean;
    scoreThreshold?: number;
}
export declare class QdrantClient {
    private readonly url;
    private readonly collection;
    constructor(url: string, collection: string);
    /**
     * Search for nearest vectors.
     */
    search(vector: number[], options: SearchOptions): Promise<QdrantSearchResult[]>;
    /**
     * Upsert (insert or update) points into the collection.
     */
    upsertPoints(points: QdrantPoint[]): Promise<void>;
    /**
     * Check whether the configured collection exists.
     */
    collectionExists(): Promise<boolean>;
    /**
     * Create a new collection with the given vector dimensions.
     *
     * @param dimensions - Vector size (e.g. 3072 for Gemini embeddings).
     * @param distance - Distance metric. Defaults to 'Cosine'.
     */
    createCollection(dimensions: number, distance?: string): Promise<void>;
    /**
     * Check if Qdrant is reachable and healthy.
     */
    healthCheck(): Promise<boolean>;
    /**
     * Get collection info (useful for diagnostics).
     */
    getCollectionInfo(): Promise<{
        exists: boolean;
        vectorsCount?: number;
    }>;
    /**
     * List all collections.
     */
    listCollections(): Promise<string[]>;
    private get;
    private post;
    private put;
}
//# sourceMappingURL=qdrant-client.d.ts.map