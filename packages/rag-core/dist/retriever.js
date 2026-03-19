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
import { cleanQuery } from './query-cleaner.js';
import { rankAndDedup } from './ranker.js';
import { execSync } from 'node:child_process';
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Run the full retrieval pipeline: clean → embed → vector search →
 * lexical search → rank & merge.
 *
 * Falls back to lexical-only if the embedder fails.
 */
export async function retrieve(query, options) {
    const { embedder, qdrantClient, config, recentTurns, maxResults = 10 } = options;
    // Step 1: Clean the query
    const cleaned = cleanQuery(query, recentTurns);
    if (!cleaned.semantic.trim()) {
        return { results: [], fallbackUsed: false };
    }
    // Step 2 & 3: Vector search (with fallback)
    let vectorResults = [];
    let fallbackUsed = false;
    let warning;
    try {
        const vector = await embedder.embed(cleaned.semantic, 'RETRIEVAL_QUERY');
        const qdrantResults = await qdrantClient.search(vector, {
            limit: maxResults * 2, // Over-fetch for ranking
            withPayload: true,
            scoreThreshold: config.scoreThreshold * 0.8, // Slightly below threshold — ranker decides
        });
        vectorResults = qdrantResults.map((r) => ({
            score: r.score,
            sourceType: r.payload?.['sourceType'] ?? 'file',
            source: r.payload?.['source'] ?? 'unknown',
            channel: r.payload?.['channel'],
            snippet: truncateSnippet(r.payload?.['text'] ?? '', config.snippetLength),
            fullText: r.payload?.['text'],
            file: r.payload?.['file'],
            startLine: r.payload?.['startLine'],
            endLine: r.payload?.['endLine'],
            timestamp: r.payload?.['timestamp'],
            dualMatch: false,
            confidence: 'low', // Will be recalculated by ranker
        }));
    }
    catch (err) {
        fallbackUsed = true;
        warning = `Vector search failed: ${err instanceof Error ? err.message : String(err)}. Using lexical-only.`;
    }
    // Step 4: Lexical/grep search
    const grepResults = lexicalSearch(cleaned.lexical, config);
    // Step 5: Rank and merge
    const ranked = rankAndDedup(vectorResults, grepResults, config);
    return {
        results: ranked.slice(0, maxResults),
        fallbackUsed,
        warning,
    };
}
// ---------------------------------------------------------------------------
// Lexical search via grep
// ---------------------------------------------------------------------------
/**
 * Search workspace files using grep for keyword matches.
 * Returns results with scores based on match density.
 */
function lexicalSearch(keywords, config) {
    if (!keywords.trim() || !config.workspacePath)
        return [];
    const terms = keywords.split(/\s+/).filter(Boolean).slice(0, 8); // Cap terms
    if (terms.length === 0)
        return [];
    // Build a grep pattern that matches any of the terms
    const pattern = terms.join('|');
    const results = [];
    try {
        // Use grep to find matching files and lines
        // -r recursive, -i case insensitive, -n line numbers, -l list files
        const output = execSync(`grep -rin --include='*.md' --include='*.txt' --include='*.json' --include='*.yaml' --include='*.yml' -l '${pattern.replace(/'/g, "'\\''")}' '${config.workspacePath}' 2>/dev/null | head -20`, { encoding: 'utf-8', timeout: 5000 }).trim();
        if (!output)
            return [];
        const files = output.split('\n').filter(Boolean);
        for (const file of files) {
            try {
                // Get matching lines with context
                const matches = execSync(`grep -in -C 2 '${pattern.replace(/'/g, "'\\''")}' '${file}' 2>/dev/null | head -30`, { encoding: 'utf-8', timeout: 3000 }).trim();
                if (!matches)
                    continue;
                // Count how many distinct terms matched
                const matchedTerms = terms.filter((t) => matches.toLowerCase().includes(t.toLowerCase()));
                const matchRatio = matchedTerms.length / terms.length;
                // Extract first line number from grep output
                const lineMatch = matches.match(/^(\d+)[:-]/);
                const startLine = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
                // Determine source type from file path
                const sourceType = inferSourceType(file);
                const relativePath = config.workspacePath
                    ? file.replace(config.workspacePath, '').replace(/^\//, '')
                    : file;
                results.push({
                    score: 0.3 + matchRatio * 0.4, // Base 0.3 + up to 0.4 for full match
                    sourceType,
                    source: relativePath,
                    snippet: truncateSnippet(matches, config.snippetLength),
                    fullText: matches,
                    file: relativePath,
                    startLine,
                    dualMatch: false,
                    confidence: 'low', // Will be recalculated by ranker
                });
            }
            catch {
                // Skip files that fail to grep
                continue;
            }
        }
    }
    catch {
        // Grep failed entirely — return empty
        return [];
    }
    return results;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Infer source type from file path conventions. */
function inferSourceType(filePath) {
    const lower = filePath.toLowerCase();
    if (lower.includes('summary') || lower.includes('summaries'))
        return 'summary';
    if (lower.includes('transcript') || lower.includes('session'))
        return 'transcript';
    return 'file';
}
/** Truncate text to a maximum length, breaking at word boundaries. */
function truncateSnippet(text, maxLength) {
    if (text.length <= maxLength)
        return text;
    const truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > maxLength * 0.5 ? truncated.slice(0, lastSpace) : truncated) + '…';
}
//# sourceMappingURL=retriever.js.map