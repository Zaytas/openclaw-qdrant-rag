/**
 * @openclaw-qdrant-rag/core — Shared type definitions
 *
 * All types used across the RAG plugin and skill live here
 * so both packages stay in sync.
 */

// ---------------------------------------------------------------------------
// Source & confidence types
// ---------------------------------------------------------------------------

/** The origin type of a retrieved chunk. */
export type SourceType = 'file' | 'summary' | 'transcript';

/** Human-readable confidence label derived from score. */
export type ConfidenceLabel = 'high' | 'medium' | 'low';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Weight multipliers applied per source type during ranking. */
export interface SourceWeights {
  summary: number;
  file: number;
  transcript: number;
}

/** Pre-gate decides whether to skip RAG for trivial messages. */
export interface PreGateConfig {
  /** Messages shorter than this (chars) skip RAG. */
  minMessageLength: number;
  /** Regex patterns — if any match the message, skip RAG. */
  skipPatterns: string[];
}

/** Controls the auto-recall behaviour in the plugin. */
export interface AutoRecallConfig {
  enabled: boolean;
  maxResults: number;
  minScore: number;
  /** Soft token budget for injected context. */
  maxTokens: number;
  /** Hard cap — never exceed this regardless of result quality. */
  hardCapTokens: number;
  /** When true, subagent sessions skip auto-recall. */
  skipSubagents: boolean;
  preGate: PreGateConfig;
}

/** Options forwarded to the embedding provider. */
export interface EmbeddingOptions {
  model: string;
  dimensions: number;
  apiKey: string;
}

/** Full RAG configuration. Shared between plugin and skill. */
export interface RagConfig {
  // -- Qdrant connection
  qdrantUrl: string;
  collection: string;

  // -- Embedding
  embeddingModel: string;
  embeddingDimensions: number;
  apiKey: string;

  // -- Retrieval tuning
  scoreThreshold: number;
  sourceWeights: SourceWeights;
  snippetLength: number;
  dualMatchBonus: number;
  recencyBonus: number;
  recencyWindowDays: number;

  // -- Chunk sizing (used by indexer)
  chunkSize: number;
  chunkOverlap: number;

  // -- Workspace path for lexical search
  workspacePath: string;

  // -- Agent filtering
  validAgents: string[];

  // -- Auto-recall (plugin-side)
  autoRecall: AutoRecallConfig;
}

// ---------------------------------------------------------------------------
// Search result types
// ---------------------------------------------------------------------------

/** A single retrieved result after ranking. */
export interface SearchResult {
  /** Final weighted score (0–1+). */
  score: number;
  sourceType: SourceType;
  /** Human-readable source label (filename, summary date, etc.). */
  source: string;
  /** Channel the content originated from, if known. */
  channel?: string;
  /** Truncated snippet for injection. */
  snippet: string;
  /** Full text of the chunk (available for deeper processing). */
  fullText?: string;
  /** Originating file path (relative to workspace). */
  file?: string;
  /** Start line in the source file. */
  startLine?: number;
  /** End line in the source file. */
  endLine?: number;
  /** ISO timestamp of the content (for recency ranking). */
  timestamp?: string;
  /** True when both vector and lexical search found this chunk. */
  dualMatch: boolean;
  /** Confidence label derived from final score. */
  confidence: ConfidenceLabel;
}

/** Full response returned by the retrieval pipeline. */
export interface RecallResponse {
  query: string;
  /** Overall confidence label based on top result. */
  confidence: ConfidenceLabel;
  results: SearchResult[];
  /** True when vector search failed and only lexical was used. */
  fallbackUsed: boolean;
  /** Optional warning message (e.g. embedder timeout). */
  warning?: string;
}

// ---------------------------------------------------------------------------
// Qdrant-specific types (used internally by qdrant-client)
// ---------------------------------------------------------------------------

/** A raw search result from the Qdrant HTTP API. */
export interface QdrantSearchResult {
  id: string | number;
  version?: number;
  score: number;
  payload?: Record<string, unknown>;
  vector?: number[];
}

/** A point to upsert into Qdrant. */
export interface QdrantPoint {
  id: string | number;
  vector: number[];
  payload?: Record<string, unknown>;
}
