/**
 * @openclaw-qdrant-rag/core — Qdrant HTTP client
 *
 * Lightweight client using native fetch — no external dependencies.
 * All methods handle connection errors gracefully.
 */

import type { QdrantSearchResult, QdrantPoint } from './types.js';

// ---------------------------------------------------------------------------
// Types for Qdrant API responses
// ---------------------------------------------------------------------------

interface QdrantSearchResponse {
  result: QdrantSearchResult[];
}

interface QdrantCollectionResponse {
  result: {
    status: string;
    vectors_count: number;
  };
}

interface QdrantCollectionsListResponse {
  result: {
    collections: Array<{ name: string }>;
  };
}

// ---------------------------------------------------------------------------
// Search options
// ---------------------------------------------------------------------------

export interface SearchOptions {
  limit: number;
  filter?: Record<string, unknown>;
  withPayload?: boolean;
  scoreThreshold?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class QdrantClient {
  private readonly url: string;
  private readonly collection: string;

  constructor(url: string, collection: string) {
    // Strip trailing slash
    this.url = url.replace(/\/+$/, '');
    this.collection = collection;
  }

  /**
   * Search for nearest vectors.
   */
  async search(
    vector: number[],
    options: SearchOptions,
  ): Promise<QdrantSearchResult[]> {
    const body: Record<string, unknown> = {
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

    const response = await this.post(
      `/collections/${this.collection}/points/search`,
      body,
    );

    const data = (await response.json()) as QdrantSearchResponse;
    return data.result ?? [];
  }

  /**
   * Upsert (insert or update) points into the collection.
   */
  async upsertPoints(points: QdrantPoint[]): Promise<void> {
    if (points.length === 0) return;

    await this.put(
      `/collections/${this.collection}/points`,
      {
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload ?? {},
        })),
      },
    );
  }

  /**
   * Check whether the configured collection exists.
   */
  async collectionExists(): Promise<boolean> {
    try {
      const response = await this.get(`/collections/${this.collection}`);
      if (!response.ok) return false;
      const data = (await response.json()) as QdrantCollectionResponse;
      return !!data.result;
    } catch {
      return false;
    }
  }

  /**
   * Create a new collection with the given vector dimensions.
   *
   * @param dimensions - Vector size (e.g. 3072 for Gemini embeddings).
   * @param distance - Distance metric. Defaults to 'Cosine'.
   */
  async createCollection(
    dimensions: number,
    distance: string = 'Cosine',
  ): Promise<void> {
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
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.get('/healthz');
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get collection info (useful for diagnostics).
   */
  async getCollectionInfo(): Promise<{ exists: boolean; vectorsCount?: number }> {
    try {
      const response = await this.get(`/collections/${this.collection}`);
      if (!response.ok) return { exists: false };
      const data = (await response.json()) as QdrantCollectionResponse;
      return {
        exists: true,
        vectorsCount: data.result?.vectors_count,
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * List all collections.
   */
  async listCollections(): Promise<string[]> {
    try {
      const response = await this.get('/collections');
      if (!response.ok) return [];
      const data = (await response.json()) as QdrantCollectionsListResponse;
      return (data.result?.collections ?? []).map((c) => c.name);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

  private async get(path: string): Promise<Response> {
    return fetch(`${this.url}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const response = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown');
      throw new Error(`Qdrant POST ${path} failed (${response.status}): ${text.slice(0, 500)}`);
    }

    return response;
  }

  private async put(path: string, body: unknown): Promise<Response> {
    const response = await fetch(`${this.url}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown');
      throw new Error(`Qdrant PUT ${path} failed (${response.status}): ${text.slice(0, 500)}`);
    }

    return response;
  }
}
