/**
 * @openclaw-qdrant-rag/core — Unified config loader
 *
 * Resolution order:
 *   1. Environment variables
 *   2. Shared JSON config file (path passed in or auto-detected)
 *   3. Hardcoded defaults
 */
import type { RagConfig } from './types.js';
/**
 * Load RAG configuration by merging env vars → config file → defaults.
 *
 * @param configPath - Optional explicit path to a JSON config file.
 * @returns Fully resolved RagConfig.
 */
export declare function loadConfig(configPath?: string): RagConfig;
//# sourceMappingURL=config.d.ts.map