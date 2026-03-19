/**
 * @openclaw-qdrant-rag/core — Ranker
 *
 * Merges vector and lexical search results, applies source weighting,
 * dual-match bonuses, recency bonuses, deduplication, and confidence gating.
 */
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Generate a dedup key from file path + approximate line range. */
function chunkKey(result) {
    if (!result.file)
        return `${result.sourceType}:${result.source}`;
    // Quantize line ranges to detect overlapping chunks
    const startBucket = result.startLine ? Math.floor(result.startLine / 20) * 20 : 0;
    return `${result.file}:${startBucket}`;
}
/** Derive a confidence label from a score. */
function confidenceFromScore(score) {
    if (score >= 0.7)
        return 'high';
    if (score >= 0.5)
        return 'medium';
    return 'low';
}
/** Check if a timestamp is within the recency window. */
function isRecent(timestamp, windowDays) {
    if (!timestamp)
        return false;
    try {
        const ts = new Date(timestamp).getTime();
        const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
        return ts >= cutoff;
    }
    catch {
        return false;
    }
}
/** Get the source weight multiplier for a given source type. */
function getSourceWeight(sourceType, weights) {
    return weights[sourceType] ?? 1.0;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Rank, deduplicate, and filter search results from both vector and
 * lexical sources.
 *
 * @param vectorResults - Results from Qdrant vector search.
 * @param grepResults - Results from lexical/grep search.
 * @param config - RAG configuration for tuning parameters.
 * @returns Ranked, deduplicated, and filtered results.
 */
export function rankAndDedup(vectorResults, grepResults, config) {
    // Index vector results by chunk key for dual-match detection
    const vectorByKey = new Map();
    for (const r of vectorResults) {
        const key = chunkKey(r);
        const existing = vectorByKey.get(key);
        // Keep the higher-scoring one if duplicates within vector results
        if (!existing || r.score > existing.score) {
            vectorByKey.set(key, r);
        }
    }
    // Index grep results by chunk key
    const grepByKey = new Map();
    for (const r of grepResults) {
        const key = chunkKey(r);
        const existing = grepByKey.get(key);
        if (!existing || r.score > existing.score) {
            grepByKey.set(key, r);
        }
    }
    // Merge: start with all unique chunk keys
    const allKeys = new Set([...vectorByKey.keys(), ...grepByKey.keys()]);
    const merged = [];
    for (const key of allKeys) {
        const vec = vectorByKey.get(key);
        const grep = grepByKey.get(key);
        const isDualMatch = !!(vec && grep);
        // Pick the base result (prefer vector since it has richer metadata)
        const base = vec ?? grep;
        // Calculate weighted score
        let score = base.score;
        // Source type weighting
        score *= getSourceWeight(base.sourceType, config.sourceWeights);
        // Dual-match bonus
        if (isDualMatch) {
            score += config.dualMatchBonus;
        }
        // Recency bonus
        if (isRecent(base.timestamp, config.recencyWindowDays)) {
            score += config.recencyBonus;
        }
        merged.push({
            ...base,
            score,
            dualMatch: isDualMatch,
            confidence: confidenceFromScore(score),
        });
    }
    // Sort by score descending
    merged.sort((a, b) => b.score - a.score);
    // Filter below threshold
    const filtered = merged.filter((r) => r.score >= config.scoreThreshold);
    // Final dedup pass: remove overlapping chunks from the same file
    // that might have slightly different line ranges
    const seen = new Set();
    const deduped = [];
    for (const result of filtered) {
        const dedupKey = result.file
            ? `${result.file}:${Math.floor((result.startLine ?? 0) / 40) * 40}`
            : `${result.sourceType}:${result.source}:${result.snippet.slice(0, 50)}`;
        if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            deduped.push(result);
        }
    }
    return deduped;
}
//# sourceMappingURL=ranker.js.map