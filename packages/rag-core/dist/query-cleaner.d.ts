/**
 * @openclaw-qdrant-rag/core — Query cleaner
 *
 * Transforms raw user messages into clean search queries
 * by stripping noise (code blocks, stack traces, URLs, etc.)
 * and extracting meaningful keywords for lexical search.
 */
export interface CleanedQuery {
    /** Cleaned natural-language text for semantic embedding. */
    semantic: string;
    /** Space-separated keywords for lexical/grep search. */
    lexical: string;
}
/**
 * Clean a raw user message into search-optimised queries.
 *
 * @param message - The raw user message.
 * @param recentTurns - Optional recent conversation turns for context
 *   enrichment when the message is very short.
 */
export declare function cleanQuery(message: string, recentTurns?: string[]): CleanedQuery;
//# sourceMappingURL=query-cleaner.d.ts.map