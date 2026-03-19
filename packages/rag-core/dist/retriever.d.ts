/**
 * @openclaw-qdrant-rag/core — Unified retriever
 *
 * Orchestrates the full retrieval pipeline:
 *   1. Clean the query
 *   2. Embed for vector search
 *   3. Search Qdrant
 *   4. Lexical/grep fallback
 *   5. Rank and merge results
 */
import type { Embedder } from './embedder.js';
import type { QdrantClient } from './qdrant-client.js';
import type { RagConfig, SearchResult } from './types.js';
export interface RetrieveOptions {
    embedder: Embedder;
    qdrantClient: QdrantClient;
    config: RagConfig;
    recentTurns?: string[];
    /** Maximum results to return. Defaults to 10. */
    maxResults?: number;
}
interface RetrieveResult {
    results: SearchResult[];
    fallbackUsed: boolean;
    warning?: string;
}
/**
 * Run the full retrieval pipeline: clean → embed → vector search →
 * lexical search → rank & merge.
 *
 * Falls back to lexical-only if the embedder fails.
 */
export declare function retrieve(query: string, options: RetrieveOptions): Promise<RetrieveResult>;
export {};
//# sourceMappingURL=retriever.d.ts.map