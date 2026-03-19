/**
 * @openclaw-qdrant-rag/core — Unified config loader
 *
 * Resolution order:
 *   1. Environment variables
 *   2. Shared JSON config file (path passed in or auto-detected)
 *   3. Hardcoded defaults
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RagConfig, AutoRecallConfig, PreGateConfig, SourceWeights } from './types.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SOURCE_WEIGHTS: SourceWeights = {
  summary: 1.15,
  file: 1.0,
  transcript: 0.9,
};

const DEFAULT_PRE_GATE: PreGateConfig = {
  minMessageLength: 10,
  skipPatterns: [],
};

const DEFAULT_AUTO_RECALL: AutoRecallConfig = {
  enabled: true,
  maxResults: 5,
  minScore: 0.4,
  maxTokens: 2000,
  hardCapTokens: 4000,
  skipSubagents: true,
  preGate: { ...DEFAULT_PRE_GATE },
};

const DEFAULTS: RagConfig = {
  qdrantUrl: 'http://localhost:6333',
  collection: 'memory',
  embeddingModel: 'models/gemini-embedding-001',
  embeddingDimensions: 3072,
  apiKey: '',
  scoreThreshold: 0.4,
  sourceWeights: { ...DEFAULT_SOURCE_WEIGHTS },
  snippetLength: 300,
  dualMatchBonus: 0.1,
  recencyBonus: 0.05,
  recencyWindowDays: 7,
  chunkSize: 1500,
  chunkOverlap: 200,
  workspacePath: '',
  validAgents: ['main'],
  autoRecall: { ...DEFAULT_AUTO_RECALL },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Try to find a config file in common locations. */
function detectConfigPath(): string | undefined {
  const candidates = [
    join(process.cwd(), 'rag-config.json'),
    join(process.cwd(), '.rag-config.json'),
  ];

  // Also check workspace root if OPENCLAW_WORKSPACE is set
  const workspace = process.env['OPENCLAW_WORKSPACE'];
  if (workspace) {
    candidates.push(
      join(workspace, 'rag-config.json'),
      join(workspace, '.rag-config.json'),
    );
  }

  return candidates.find((p) => existsSync(p));
}

/** Read and parse a JSON config file. Returns empty object on failure. */
function readConfigFile(path: string): Record<string, unknown> {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Parse a comma-separated env var into a string array. */
function parseStringList(val: string | undefined): string[] | undefined {
  if (!val) return undefined;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Safely parse a number from an env var. */
function parseNum(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const n = Number(val);
  return Number.isNaN(n) ? undefined : n;
}

/** Safely parse a boolean from an env var. */
function parseBool(val: string | undefined): boolean | undefined {
  if (!val) return undefined;
  return val === 'true' || val === '1';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load RAG configuration by merging env vars → config file → defaults.
 *
 * @param configPath - Optional explicit path to a JSON config file.
 * @returns Fully resolved RagConfig.
 */
export function loadConfig(configPath?: string): RagConfig {
  // Layer 1: defaults (deep-copied)
  const config: RagConfig = {
    ...DEFAULTS,
    sourceWeights: { ...DEFAULT_SOURCE_WEIGHTS },
    autoRecall: {
      ...DEFAULT_AUTO_RECALL,
      preGate: { ...DEFAULT_PRE_GATE },
    },
  };

  // Layer 2: config file
  const filePath = configPath ?? detectConfigPath();
  if (filePath) {
    const file = readConfigFile(filePath);
    Object.assign(config, {
      qdrantUrl: (file['qdrantUrl'] as string) ?? config.qdrantUrl,
      collection: (file['collection'] as string) ?? config.collection,
      embeddingModel: (file['embeddingModel'] as string) ?? config.embeddingModel,
      embeddingDimensions: (file['embeddingDimensions'] as number) ?? config.embeddingDimensions,
      apiKey: (file['apiKey'] as string) ?? config.apiKey,
      scoreThreshold: (file['scoreThreshold'] as number) ?? config.scoreThreshold,
      snippetLength: (file['snippetLength'] as number) ?? config.snippetLength,
      dualMatchBonus: (file['dualMatchBonus'] as number) ?? config.dualMatchBonus,
      recencyBonus: (file['recencyBonus'] as number) ?? config.recencyBonus,
      recencyWindowDays: (file['recencyWindowDays'] as number) ?? config.recencyWindowDays,
      chunkSize: (file['chunkSize'] as number) ?? config.chunkSize,
      chunkOverlap: (file['chunkOverlap'] as number) ?? config.chunkOverlap,
      workspacePath: (file['workspacePath'] as string) ?? config.workspacePath,
    });

    if (file['sourceWeights'] && typeof file['sourceWeights'] === 'object') {
      Object.assign(config.sourceWeights, file['sourceWeights']);
    }
    if (Array.isArray(file['validAgents'])) {
      config.validAgents = file['validAgents'] as string[];
    }
    if (file['autoRecall'] && typeof file['autoRecall'] === 'object') {
      const ar = file['autoRecall'] as Record<string, unknown>;
      Object.assign(config.autoRecall, ar);
      if (ar['preGate'] && typeof ar['preGate'] === 'object') {
        Object.assign(config.autoRecall.preGate, ar['preGate']);
      }
    }
  }

  // Layer 3: environment variables (highest priority)
  const env = process.env;
  config.qdrantUrl = env['QDRANT_URL'] ?? config.qdrantUrl;
  config.collection = env['QDRANT_COLLECTION'] ?? config.collection;
  config.embeddingModel = env['EMBEDDING_MODEL'] ?? config.embeddingModel;
  config.apiKey = env['GEMINI_API_KEY'] ?? config.apiKey;
  config.workspacePath = env['OPENCLAW_WORKSPACE'] ?? config.workspacePath;

  config.embeddingDimensions = parseNum(env['EMBEDDING_DIMENSIONS']) ?? config.embeddingDimensions;
  config.scoreThreshold = parseNum(env['RAG_SCORE_THRESHOLD']) ?? config.scoreThreshold;
  config.snippetLength = parseNum(env['RAG_SNIPPET_LENGTH']) ?? config.snippetLength;
  config.chunkSize = parseNum(env['RAG_CHUNK_SIZE']) ?? config.chunkSize;
  config.chunkOverlap = parseNum(env['RAG_CHUNK_OVERLAP']) ?? config.chunkOverlap;

  const agents = parseStringList(env['RAG_VALID_AGENTS']);
  if (agents) config.validAgents = agents;

  // Auto-recall env overrides
  const arEnabled = parseBool(env['RAG_AUTO_RECALL']);
  if (arEnabled !== undefined) config.autoRecall.enabled = arEnabled;
  config.autoRecall.maxResults = parseNum(env['RAG_MAX_RESULTS']) ?? config.autoRecall.maxResults;
  config.autoRecall.maxTokens = parseNum(env['RAG_MAX_TOKENS']) ?? config.autoRecall.maxTokens;
  config.autoRecall.hardCapTokens = parseNum(env['RAG_HARD_CAP_TOKENS']) ?? config.autoRecall.hardCapTokens;

  return config;
}
