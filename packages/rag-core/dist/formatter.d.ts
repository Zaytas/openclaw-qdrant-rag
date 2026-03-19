/**
 * @openclaw-qdrant-rag/core — Result formatter
 *
 * Formats search results for:
 *   - Context injection into agent prompts (structured, token-budgeted)
 *   - CLI display (human-readable)
 */
import type { SearchResult, RecallResponse } from './types.js';
/**
 * Format results for injection into an agent's context window.
 *
 * Each snippet is formatted as a structured block with metadata.
 * Stops adding snippets once the token budget is reached.
 *
 * @returns Formatted string, or empty string if no results qualify.
 */
export declare function formatForInjection(results: SearchResult[], options: {
    maxTokens: number;
    hardCapTokens: number;
}): string;
/**
 * Format a full RecallResponse for CLI display.
 */
export declare function formatForCli(response: RecallResponse): string;
//# sourceMappingURL=formatter.d.ts.map