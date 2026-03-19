/**
 * @openclaw-qdrant-rag/core — Ranker
 *
 * Merges vector and lexical search results, applies source weighting,
 * dual-match bonuses, recency bonuses, deduplication, and confidence gating.
 */
import type { SearchResult, RagConfig } from './types.js';
/**
 * Rank, deduplicate, and filter search results from both vector and
 * lexical sources.
 *
 * @param vectorResults - Results from Qdrant vector search.
 * @param grepResults - Results from lexical/grep search.
 * @param config - RAG configuration for tuning parameters.
 * @returns Ranked, deduplicated, and filtered results.
 */
export declare function rankAndDedup(vectorResults: SearchResult[], grepResults: SearchResult[], config: RagConfig): SearchResult[];
//# sourceMappingURL=ranker.d.ts.map