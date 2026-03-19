/**
 * @openclaw-qdrant-rag/core — Query cleaner
 *
 * Transforms raw user messages into clean search queries
 * by stripping noise (code blocks, stack traces, URLs, etc.)
 * and extracting meaningful keywords for lexical search.
 */
// ---------------------------------------------------------------------------
// Patterns to strip
// ---------------------------------------------------------------------------
/** Fenced code blocks (```...```) */
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
/** Inline code (`...`) */
const INLINE_CODE_RE = /`[^`]+`/g;
/** URLs (http/https/ftp) */
const URL_RE = /https?:\/\/\S+|ftp:\/\/\S+/gi;
/** Base64 blobs (at least 40 chars of base64 alphabet) */
const BASE64_RE = /[A-Za-z0-9+/=]{40,}/g;
/** Stack trace lines (common patterns across JS, Python, Java, etc.) */
const STACK_TRACE_RE = /^\s*(at\s+|Traceback|File\s+"|\.{3}\s+\d+\s+more|Caused by:)/;
/** Quoted lines (markdown-style > prefix) */
const QUOTE_RE = /^>\s?/;
/** Stop words to exclude from lexical keywords */
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
    'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
    'too', 'very', 'just', 'because', 'as', 'until', 'while', 'of',
    'at', 'by', 'for', 'with', 'about', 'against', 'between', 'through',
    'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up',
    'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
    'how', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
    'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you',
    'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it',
    'its', 'they', 'them', 'their', 'theirs',
]);
/**
 * Clean a raw user message into search-optimised queries.
 *
 * @param message - The raw user message.
 * @param recentTurns - Optional recent conversation turns for context
 *   enrichment when the message is very short.
 */
export function cleanQuery(message, recentTurns) {
    let text = message;
    // Strip code blocks (fenced first, then inline)
    text = text.replace(CODE_BLOCK_RE, ' ');
    text = text.replace(INLINE_CODE_RE, ' ');
    // Strip URLs and base64 blobs
    text = text.replace(URL_RE, ' ');
    text = text.replace(BASE64_RE, ' ');
    // Process line-by-line: strip stack traces and quoted lines
    const lines = text.split('\n');
    const cleanedLines = [];
    for (const line of lines) {
        // Skip stack trace lines
        if (STACK_TRACE_RE.test(line))
            continue;
        // Strip quote prefix but keep the text (useful context)
        if (QUOTE_RE.test(line)) {
            cleanedLines.push(line.replace(QUOTE_RE, ''));
            continue;
        }
        cleanedLines.push(line);
    }
    text = cleanedLines.join(' ');
    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();
    // If message is very short, enrich with recent turns
    if (text.length < 30 && recentTurns && recentTurns.length > 0) {
        const context = recentTurns.slice(-3).join(' ').replace(/\s+/g, ' ').trim();
        if (context) {
            text = `${text} ${context}`.trim();
        }
    }
    // Cap semantic query length
    const semantic = text.slice(0, 1500);
    // Extract lexical keywords
    const lexical = extractKeywords(text);
    return { semantic, lexical };
}
// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------
/**
 * Extract unique, meaningful keywords from text for lexical search.
 * Filters out stop words, short tokens, and duplicates.
 */
function extractKeywords(text) {
    const words = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ') // Keep word chars, spaces, hyphens
        .split(/\s+/)
        .filter((w) => w.length > 2) // Skip very short tokens
        .filter((w) => !STOP_WORDS.has(w)) // Skip stop words
        .filter((w) => !/^\d+$/.test(w)); // Skip pure numbers
    // Deduplicate while preserving order
    const seen = new Set();
    const unique = [];
    for (const word of words) {
        if (!seen.has(word)) {
            seen.add(word);
            unique.push(word);
        }
    }
    return unique.join(' ');
}
//# sourceMappingURL=query-cleaner.js.map