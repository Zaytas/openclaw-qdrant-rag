/**
 * @openclaw-qdrant-rag/core — Public API
 *
 * Re-exports all public types, classes, and functions from a single entry point.
 */

// Types
export type {
  RagConfig,
  SearchResult,
  RecallResponse,
  EmbeddingOptions,
  AutoRecallConfig,
  PreGateConfig,
  SourceWeights,
  SourceType,
  ConfidenceLabel,
  QdrantSearchResult,
  QdrantPoint,
} from './types.js';

// Config
export { loadConfig } from './config.js';

// Embedder
export { Embedder } from './embedder.js';

// Qdrant client
export { QdrantClient } from './qdrant-client.js';
export type { SearchOptions } from './qdrant-client.js';

// Query cleaner
export { cleanQuery } from './query-cleaner.js';
export type { CleanedQuery } from './query-cleaner.js';

// Retriever
export { retrieve } from './retriever.js';
export type { RetrieveOptions } from './retriever.js';

// Ranker
export { rankAndDedup } from './ranker.js';

// Formatter
export { formatForInjection, formatForCli } from './formatter.js';
