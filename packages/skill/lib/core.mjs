/**
 * Core module loader — resolves rag-core from the sibling package.
 *
 * This module provides a single init() function that loads config,
 * creates an Embedder and QdrantClient, and returns them ready to use.
 *
 * Import path resolution:
 *   - Built distribution: @openclaw-qdrant-rag/core (npm workspace)
 *   - Dev fallback: ../../rag-core/dist/index.js (relative)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Skill root is one level up from lib/
export const SKILL_DIR = resolve(__dirname, '..');

/**
 * Dynamically import rag-core, trying npm workspace resolution first,
 * then falling back to the relative path in the monorepo.
 */
async function importCore() {
  try {
    return await import('@openclaw-qdrant-rag/core');
  } catch {
    // Fallback: relative path in monorepo
    const relPath = join(__dirname, '..', '..', 'rag-core', 'dist', 'index.js');
    if (existsSync(relPath)) {
      return await import(relPath);
    }
    throw new Error(
      'Could not import @openclaw-qdrant-rag/core. ' +
      'Make sure the core package is built (cd packages/rag-core && npm run build) ' +
      'or install dependencies with npm install from the monorepo root.'
    );
  }
}

/**
 * Load a skill-local config file if it exists.
 * Merges skill-level config (qdrant-rag.config.json) path into loadConfig.
 */
function findSkillConfig() {
  const candidates = [
    join(SKILL_DIR, 'qdrant-rag.config.json'),
    join(SKILL_DIR, '.qdrant-rag.config.json'),
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * Initialize all core components.
 *
 * @param {string} [configPath] - Optional explicit config file path.
 * @returns {{ config, embedder, qdrant, core }} Ready-to-use instances.
 */
export async function init(configPath) {
  const core = await importCore();
  const cfgPath = configPath ?? findSkillConfig();
  const config = core.loadConfig(cfgPath);

  if (!config.apiKey) {
    throw new Error(
      'GEMINI_API_KEY not set. Export it as an environment variable or add "apiKey" to your config file.'
    );
  }

  const embedder = new core.Embedder(
    config.apiKey,
    config.embeddingModel,
    config.embeddingDimensions,
  );

  const qdrant = new core.QdrantClient(
    config.qdrantUrl,
    config.collection,
  );

  return { config, embedder, qdrant, core };
}

/**
 * Load config only (no embedder/qdrant init — useful for dry-run or status commands).
 */
export async function loadConfigOnly(configPath) {
  const core = await importCore();
  const cfgPath = configPath ?? findSkillConfig();
  return { config: core.loadConfig(cfgPath), core };
}
