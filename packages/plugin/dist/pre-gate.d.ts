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
export declare function shouldRetrieve(message: string, config: PreGateConfig, isSubagent: boolean, skipSubagents: boolean): PreGateResult;
