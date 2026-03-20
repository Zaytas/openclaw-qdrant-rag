/**
 * @openclaw-qdrant-rag/plugin — Main plugin entry point
 *
 * Hooks into OpenClaw's `before_prompt_build` event to automatically retrieve
 * relevant context from a Qdrant vector database and inject it into the
 * agent's system prompt. The agent never decides whether to search — it's
 * enforced by the system.
 *
 * Follows the OpenClaw plugin pattern: export default register(api).
 */

import type {
  PluginApi,
  PluginConfig,
  AutoRecallConfig,
  PreGateConfig,
  DebugConfig,
  EmbeddingCacheConfig,
  SessionMeta,
} from './types.js';

// Core imports — shared RAG library
// These are resolved at runtime from the sibling rag-core package.
// In the monorepo, rag-core must be built first (dist/ populated).
import type { RagConfig, SearchResult } from '@openclaw-qdrant-rag/core';

import { shouldRetrieve } from './pre-gate.js';
import { createLogger } from './debug.js';
import type { PluginLogger } from './debug.js';

// ---------------------------------------------------------------------------
// Default configuration values (match configSchema defaults)
// ---------------------------------------------------------------------------

const DEFAULT_AUTO_RECALL: AutoRecallConfig = {
  enabled: true,
  maxResults: 6,
  minScore: 0.4,
  maxTokens: 2000,
  hardCapTokens: 3000,
  skipSubagents: true,
};

const DEFAULT_PRE_GATE: PreGateConfig = {
  minMessageLength: 10,
  skipPatterns: ['^\\s*$', '^(ok|thanks|yes|no|sure|got it)\\s*$'],
};

const DEFAULT_EMBEDDING_CACHE: EmbeddingCacheConfig = {
  cacheTtlMs: 300000,
  cacheMaxSize: 100,
};

const DEFAULT_DEBUG: DebugConfig = {
  logQueries: false,
  logInjections: false,
  logSkips: false,
};

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

/** Merge user-provided plugin config with defaults. */
function parseConfig(raw: unknown): PluginConfig {
  const cfg = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  return {
    enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : true,
    configPath: typeof cfg.configPath === 'string' ? cfg.configPath : undefined,
    autoRecall: { ...DEFAULT_AUTO_RECALL, ...safeObj(cfg.autoRecall) },
    preGate: { ...DEFAULT_PRE_GATE, ...safeObj(cfg.preGate) },
    embedding: { ...DEFAULT_EMBEDDING_CACHE, ...safeObj(cfg.embedding) },
    debug: { ...DEFAULT_DEBUG, ...safeObj(cfg.debug) },
  };
}

function safeObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ---------------------------------------------------------------------------
// Message extraction helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort extraction of the inbound user message from the event/ctx.
 * OpenClaw's event shape may vary — try multiple known paths.
 */
function extractMessage(
  event: Record<string, unknown>,
  ctx: Record<string, unknown>,
): string | undefined {
  // Direct message property
  if (typeof event.message === 'string' && event.message.trim()) {
    return event.message;
  }
  if (typeof event.lastUserMessage === 'string' && event.lastUserMessage.trim()) {
    return event.lastUserMessage;
  }

  // Messages array — get the last user message
  if (Array.isArray(event.messages)) {
    for (let i = event.messages.length - 1; i >= 0; i--) {
      const msg = event.messages[i] as Record<string, unknown> | undefined;
      if (msg && msg.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content;
      }
    }
  }

  // Context-level fallbacks
  if (typeof ctx.message === 'string' && ctx.message.trim()) {
    return ctx.message;
  }
  if (typeof ctx.lastUserMessage === 'string' && ctx.lastUserMessage.trim()) {
    return ctx.lastUserMessage;
  }

  // Nested inbound message
  const inbound = safeObj(ctx.inbound);
  if (typeof inbound.message === 'string' && (inbound.message as string).trim()) {
    return inbound.message as string;
  }
  if (typeof inbound.text === 'string' && (inbound.text as string).trim()) {
    return inbound.text as string;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Session metadata extraction
// ---------------------------------------------------------------------------

/**
 * Detect whether the current session is a subagent.
 * Looks for ':subagent:' in the session key or id string.
 */
function extractSessionMeta(ctx: Record<string, unknown>): SessionMeta {
  const session = safeObj(ctx.session);

  const sessionKey = typeof session.key === 'string' ? session.key : undefined;
  const sessionId = typeof session.id === 'string' ? session.id : undefined;

  const keyOrId = sessionKey ?? sessionId ?? '';
  const isSubagent = keyOrId.includes(':subagent:');

  return { isSubagent, sessionKey };
}

// ---------------------------------------------------------------------------
// Rough token estimation (for budget enforcement)
// ---------------------------------------------------------------------------

/** Estimate token count from text (~4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Format results for injection into system context
// ---------------------------------------------------------------------------

/**
 * Format retrieved search results into a text block for system prompt injection.
 * Respects the token budget (soft cap: maxTokens, hard cap: hardCapTokens).
 */
function formatForInjection(
  results: SearchResult[],
  maxTokens: number,
  hardCapTokens: number,
): string {
  if (!results || results.length === 0) return '';

  const lines: string[] = [
    '## Retrieved Context (auto-recall from Qdrant)',
    '',
  ];

  let tokenCount = estimateTokens(lines.join('\n'));

  for (const result of results) {
    const header = `### [${result.confidence}] ${result.source}${result.channel ? ` (${result.channel})` : ''}`;
    const body = result.snippet || result.fullText || '';
    const entry = `${header}\n${body}\n`;

    const entryTokens = estimateTokens(entry);

    // Hard cap — never exceed
    if (tokenCount + entryTokens > hardCapTokens) {
      break;
    }

    lines.push(entry);
    tokenCount += entryTokens;

    // Soft cap — stop adding after this
    if (tokenCount >= maxTokens) {
      break;
    }
  }

  if (lines.length <= 2) return ''; // Only header, no results fit
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Dynamic core imports
// ---------------------------------------------------------------------------

/**
 * Dynamically import classes/functions from @openclaw-qdrant-rag/core.
 * Uses dynamic import so the plugin can fail gracefully if core isn't built yet.
 *
 * rag-core exports:
 *   - loadConfig(configPath?: string): RagConfig
 *   - Embedder class: constructor(apiKey, model, dimensions, cacheOptions?)
 *   - QdrantClient class: constructor(url, collection)
 */
interface CoreModules {
  loadConfig: (configPath?: string) => RagConfig;
  Embedder: new (
    apiKey: string,
    model: string,
    dimensions: number,
    options?: { maxCacheSize?: number; cacheTtlMs?: number },
  ) => { embed(text: string, taskType?: string): Promise<number[]> };
  QdrantClient: new (
    url: string,
    collection: string,
  ) => {
    search(vector: number[], options: { limit: number; scoreThreshold?: number; withPayload?: boolean }): Promise<Array<{ score: number; payload?: Record<string, unknown> }>>;
    healthCheck(): Promise<boolean>;
  };
}

async function importCore(): Promise<CoreModules> {
  const core = await import('@openclaw-qdrant-rag/core');
  return {
    loadConfig: core.loadConfig,
    Embedder: core.Embedder,
    QdrantClient: core.QdrantClient,
  };
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

/**
 * Register the Qdrant RAG auto-recall plugin with OpenClaw.
 *
 * This is the default export — OpenClaw calls register(api) at startup.
 * The plugin:
 *   1. Parses configuration
 *   2. Initializes the embedding client and Qdrant connection
 *   3. Hooks into before_prompt_build to inject relevant context
 */
export default function register(api: PluginApi): void {
  // 1. Parse plugin configuration
  const config = parseConfig(api.pluginConfig);

  if (!config.enabled) {
    const earlyLogger = createLogger(api, config.debug);
    earlyLogger.info('plugin disabled via config');
    return;
  }

  // We set up the hook immediately but defer heavy initialization
  // (config loading, embedder, qdrant client) to the first call.
  // This avoids blocking gateway startup if Qdrant is temporarily unavailable.

  let logger: PluginLogger;
  let initialized = false;
  let initFailed = false;
  let embedder: { embed(text: string, taskType?: string): Promise<number[]> } | null = null;
  let qdrantClient: {
    search(vector: number[], options: { limit: number; scoreThreshold?: number; withPayload?: boolean }): Promise<Array<{ score: number; payload?: Record<string, unknown> }>>;
  } | null = null;

  // Create logger immediately (only needs api + debug config)
  logger = createLogger(api, config.debug);

  /**
   * Lazy initialization of core services.
   * Called on the first qualifying message. Fails open on error.
   */
  async function initializeCore(): Promise<boolean> {
    if (initialized) return !initFailed;
    if (initFailed) return false;

    try {
      const core = await importCore();

      // Load shared RAG config (merges with plugin's configPath if provided)
      const ragConfig = core.loadConfig(config.configPath);

      // Initialize embedder (created once, reused across calls)
      embedder = new core.Embedder(
        ragConfig.apiKey,
        ragConfig.embeddingModel,
        ragConfig.embeddingDimensions,
        { maxCacheSize: config.embedding.cacheMaxSize, cacheTtlMs: config.embedding.cacheTtlMs },
      );

      // Initialize Qdrant client (created once, reused across calls)
      qdrantClient = new core.QdrantClient(ragConfig.qdrantUrl, ragConfig.collection);

      initialized = true;
      logger.info('core initialized successfully');
      return true;
    } catch (error) {
      logger.logError(error);
      logger.info('core initialization failed — plugin will retry on next message');
      // Don't set initFailed permanently — allow retry on next message
      // in case Qdrant was temporarily unavailable at startup
      return false;
    }
  }

  // 6. Register the before_prompt_build hook
  api.on('before_prompt_build', async (
    event: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ): Promise<{ appendSystemContext: string } | undefined> => {
    try {
      // Bail early if auto-recall is disabled
      if (!config.autoRecall.enabled) {
        logger.logSkip('autoRecall disabled');
        return undefined;
      }

      // a. Extract the inbound user message
      const message = extractMessage(event, ctx);
      if (!message) {
        logger.logSkip('no user message found in event/ctx');
        return undefined;
      }

      // b. Extract session metadata
      const session = extractSessionMeta(ctx);

      // c. Run pre-gate check
      const gate = shouldRetrieve(
        message,
        config.preGate,
        session.isSubagent,
        config.autoRecall.skipSubagents,
      );

      if (!gate.shouldRetrieve) {
        logger.logSkip(gate.reason);
        return undefined;
      }

      // Lazy-initialize core services
      const coreReady = await initializeCore();
      if (!coreReady || !embedder || !qdrantClient) {
        logger.logSkip('core not initialized — failing open');
        return undefined;
      }

      logger.logQuery(message);

      // d. Generate embedding and search Qdrant
      const vector = await embedder.embed(message);
      const results = await qdrantClient.search(vector, {
        limit: config.autoRecall.maxResults,
        scoreThreshold: config.autoRecall.minScore,
        withPayload: true,
      });

      if (!results || results.length === 0) {
        logger.logSkip('no results above score threshold');
        return undefined;
      }

      // Map raw Qdrant results to SearchResult shape for formatting
      const searchResults: SearchResult[] = results.map((r: { score: number; payload?: Record<string, unknown> }) => {
        const p = r.payload || {};
        const sourceType = (p.sourceType || p.source_type || 'file') as string;
        return {
          score: r.score,
          sourceType: sourceType as 'file' | 'summary' | 'transcript',
          source: (p.fileName || p.file || p.sessionId || 'unknown') as string,
          channel: (p.channel || 'unknown') as string,
          snippet: ((p.text || p.keyFacts || '') as string).slice(0, 300),
          fullText: (p.text || p.keyFacts || '') as string,
          file: (p.fileName || p.file || undefined) as string | undefined,
          startLine: (p.startLine || undefined) as number | undefined,
          endLine: (p.endLine || undefined) as number | undefined,
          timestamp: undefined,
          dualMatch: false,
          confidence: r.score >= 0.7 ? 'high' as const : r.score >= 0.5 ? 'medium' as const : 'low' as const,
        };
      });

      // e. Format results for injection (respecting token budget)
      const formatted = formatForInjection(
        searchResults,
        config.autoRecall.maxTokens,
        config.autoRecall.hardCapTokens,
      );

      if (!formatted) {
        logger.logSkip('formatted context was empty after token budgeting');
        return undefined;
      }

      // f. Log injection if debug enabled
      logger.logInjection(formatted, searchResults.length);

      // g. Return context for system prompt injection
      return { appendSystemContext: formatted };
    } catch (error) {
      // FAIL OPEN — never crash the gateway
      logger.logError(error);
      return undefined;
    }
  });

  // 7. Log startup
  logger.info(
    `registered (autoRecall=${config.autoRecall.enabled}, ` +
    `maxResults=${config.autoRecall.maxResults}, ` +
    `minScore=${config.autoRecall.minScore}, ` +
    `skipSubagents=${config.autoRecall.skipSubagents})`,
  );
}
