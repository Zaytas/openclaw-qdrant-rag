/**
 * @openclaw-qdrant-rag/core — Result formatter
 *
 * Formats search results for:
 *   - Context injection into agent prompts (structured, token-budgeted)
 *   - CLI display (human-readable)
 */
// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------
/** Rough token estimate: ~4 characters per token. */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
// ---------------------------------------------------------------------------
// Confidence emoji
// ---------------------------------------------------------------------------
function confidenceEmoji(confidence) {
    switch (confidence) {
        case 'high':
            return '🟢';
        case 'medium':
            return '🟡';
        case 'low':
            return '🔴';
    }
}
// ---------------------------------------------------------------------------
// Injection formatter (for agent prompts)
// ---------------------------------------------------------------------------
/**
 * Format results for injection into an agent's context window.
 *
 * Each snippet is formatted as a structured block with metadata.
 * Stops adding snippets once the token budget is reached.
 *
 * @returns Formatted string, or empty string if no results qualify.
 */
export function formatForInjection(results, options) {
    if (results.length === 0)
        return '';
    const { maxTokens, hardCapTokens } = options;
    const blocks = [];
    let totalTokens = 0;
    // Header
    const header = '--- RAG Context ---';
    totalTokens += estimateTokens(header);
    for (const result of results) {
        // Format a single result block
        const block = formatResultBlock(result);
        const blockTokens = estimateTokens(block);
        // Check soft budget
        if (totalTokens + blockTokens > maxTokens && blocks.length > 0) {
            break;
        }
        // Check hard cap (never exceed)
        if (totalTokens + blockTokens > hardCapTokens) {
            // Try to fit a trimmed version
            const remaining = hardCapTokens - totalTokens;
            if (remaining > 50) {
                const trimmedBlock = trimBlock(result, remaining);
                blocks.push(trimmedBlock);
                totalTokens += estimateTokens(trimmedBlock);
            }
            break;
        }
        blocks.push(block);
        totalTokens += blockTokens;
    }
    if (blocks.length === 0)
        return '';
    return `${header}\n${blocks.join('\n')}\n--- End RAG Context ---`;
}
/**
 * Format a single result as a structured block.
 */
function formatResultBlock(result) {
    const lines = [];
    lines.push(`[${result.sourceType}] ${result.source}`);
    lines.push(`  Score: ${result.score.toFixed(3)} | Confidence: ${result.confidence}${result.dualMatch ? ' | Dual-match' : ''}`);
    if (result.file && result.startLine !== undefined) {
        const range = result.endLine
            ? `L${result.startLine}-${result.endLine}`
            : `L${result.startLine}`;
        lines.push(`  Location: ${result.file}:${range}`);
    }
    lines.push(`  ${result.snippet}`);
    lines.push('');
    return lines.join('\n');
}
/**
 * Create a trimmed block that fits within a token budget.
 */
function trimBlock(result, maxTokens) {
    const maxChars = maxTokens * 4;
    const header = `[${result.sourceType}] ${result.source} (${result.score.toFixed(2)})`;
    const remaining = maxChars - header.length - 10;
    if (remaining <= 0)
        return header;
    const snippet = result.snippet.slice(0, remaining);
    return `${header}\n  ${snippet}…`;
}
// ---------------------------------------------------------------------------
// CLI formatter (human-readable)
// ---------------------------------------------------------------------------
/**
 * Format a full RecallResponse for CLI display.
 */
export function formatForCli(response) {
    const lines = [];
    // Header
    lines.push(`🔍 Query: "${response.query}"`);
    lines.push(`📊 Confidence: ${confidenceEmoji(response.confidence)} ${response.confidence}`);
    if (response.fallbackUsed) {
        lines.push('⚠️  Fallback: lexical-only (vector search unavailable)');
    }
    if (response.warning) {
        lines.push(`⚠️  ${response.warning}`);
    }
    lines.push(`📄 Results: ${response.results.length}`);
    lines.push('');
    if (response.results.length === 0) {
        lines.push('  No relevant results found.');
        return lines.join('\n');
    }
    // Results
    for (let i = 0; i < response.results.length; i++) {
        const r = response.results[i];
        lines.push(`  ${i + 1}. ${confidenceEmoji(r.confidence)} [${r.sourceType}] ${r.source}`);
        lines.push(`     Score: ${r.score.toFixed(3)}${r.dualMatch ? ' (dual-match)' : ''}`);
        if (r.file && r.startLine !== undefined) {
            const range = r.endLine ? `${r.startLine}-${r.endLine}` : `${r.startLine}`;
            lines.push(`     File: ${r.file}:${range}`);
        }
        if (r.channel) {
            lines.push(`     Channel: ${r.channel}`);
        }
        // Show a preview of the snippet
        const preview = r.snippet.slice(0, 120).replace(/\n/g, ' ');
        lines.push(`     ${preview}${r.snippet.length > 120 ? '…' : ''}`);
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=formatter.js.map