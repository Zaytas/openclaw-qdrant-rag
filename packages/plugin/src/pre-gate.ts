/**
 * Pre-gate — Deterministic check for whether RAG retrieval should run.
 *
 * The SYSTEM decides, not the agent. This runs before any embedding or
 * vector search, filtering out trivial messages that don't warrant retrieval.
 */

import type { PreGateConfig, PreGateResult } from './types.js';

/**
 * Evaluate whether a message warrants RAG retrieval.
 *
 * Checks are ordered from cheapest to most expensive:
 * 1. Empty/whitespace-only messages → skip
 * 2. Subagent sessions (when configured to skip) → skip
 * 3. Message too short → skip
 * 4. Message matches a skip pattern → skip
 * 5. Otherwise → retrieve
 */
export function shouldRetrieve(
  message: string,
  config: PreGateConfig,
  isSubagent: boolean,
  skipSubagents: boolean,
): PreGateResult {
  // 1. Empty or whitespace-only
  if (!message || message.trim().length === 0) {
    return { shouldRetrieve: false, reason: 'empty or whitespace-only message' };
  }

  // 2. Subagent check
  if (isSubagent && skipSubagents) {
    return { shouldRetrieve: false, reason: 'subagent session (skipSubagents enabled)' };
  }

  // 3. Message length check
  const trimmed = message.trim();
  if (trimmed.length < config.minMessageLength) {
    return {
      shouldRetrieve: false,
      reason: `message too short (${trimmed.length} < ${config.minMessageLength} chars)`,
    };
  }

  // 4. Skip patterns (regex match)
  for (const pattern of config.skipPatterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(trimmed)) {
        return {
          shouldRetrieve: false,
          reason: `matched skip pattern: ${pattern}`,
        };
      }
    } catch {
      // Invalid regex — ignore it rather than blocking retrieval
      continue;
    }
  }

  // 5. All checks passed — proceed with retrieval
  return { shouldRetrieve: true, reason: 'passed all pre-gate checks' };
}
