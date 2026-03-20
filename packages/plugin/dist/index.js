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
// retrieve and formatForInjection are loaded dynamically from rag-core at init time
import { shouldRetrieve } from './pre-gate.js';
import { createLogger } from './debug.js';
// ---------------------------------------------------------------------------
// Default configuration values (match configSchema defaults)
// ---------------------------------------------------------------------------
const DEFAULT_AUTO_RECALL = {
    enabled: true,
    maxResults: 6,
    minScore: 0.4,
    maxTokens: 1200,
    hardCapTokens: 2000,
    skipSubagents: true,
};
const DEFAULT_PRE_GATE = {
    minMessageLength: 10,
    skipPatterns: ['^\\s*$', '^(ok|thanks|yes|no|sure|got it)\\s*$'],
};
const DEFAULT_EMBEDDING_CACHE = {
    cacheTtlMs: 300000,
    cacheMaxSize: 100,
};
const DEFAULT_DEBUG = {
    logQueries: false,
    logInjections: false,
    logSkips: false,
};
// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------
/** Merge user-provided plugin config with defaults. */
function parseConfig(raw) {
    const cfg = (raw && typeof raw === 'object' ? raw : {});
    return {
        enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : true,
        configPath: typeof cfg.configPath === 'string' ? cfg.configPath : undefined,
        autoRecall: { ...DEFAULT_AUTO_RECALL, ...safeObj(cfg.autoRecall) },
        preGate: { ...DEFAULT_PRE_GATE, ...safeObj(cfg.preGate) },
        embedding: { ...DEFAULT_EMBEDDING_CACHE, ...safeObj(cfg.embedding) },
        debug: { ...DEFAULT_DEBUG, ...safeObj(cfg.debug) },
    };
}
function safeObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v)
        ? v
        : {};
}
// ---------------------------------------------------------------------------
// Message extraction helpers
// ---------------------------------------------------------------------------
/**
 * Best-effort extraction of the inbound user message from the event/ctx.
 * OpenClaw's event shape may vary — try multiple known paths.
 */
function extractMessage(event, ctx) {
    // event.prompt is the canonical field for before_prompt_build
    if (typeof event.prompt === 'string' && event.prompt.trim()) {
        return event.prompt;
    }
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
            const msg = event.messages[i];
            if (msg && msg.role === 'user') {
                // Handle string content
                if (typeof msg.content === 'string' && msg.content.trim()) {
                    return msg.content;
                }
                // Handle Vercel AI SDK array content: [{type: 'text', text: '...'}]
                if (Array.isArray(msg.content)) {
                    const textParts = msg.content
                        .filter((p) => p.type === 'text' && typeof p.text === 'string')
                        .map((p) => p.text);
                    const joined = textParts.join('\n').trim();
                    if (joined)
                        return joined;
                }
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
    if (typeof inbound.message === 'string' && inbound.message.trim()) {
        return inbound.message;
    }
    if (typeof inbound.text === 'string' && inbound.text.trim()) {
        return inbound.text;
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
function extractSessionMeta(ctx) {
    const session = safeObj(ctx.session);
    // Check both flat and nested paths for session key/id
    const sessionKey = typeof ctx.sessionKey === 'string' ? ctx.sessionKey
        : typeof session.key === 'string' ? session.key
            : undefined;
    const sessionId = typeof ctx.sessionId === 'string' ? ctx.sessionId
        : typeof session.id === 'string' ? session.id
            : undefined;
    const keyOrId = sessionKey ?? sessionId ?? '';
    const isSubagent = keyOrId.includes(':subagent:');
    return { isSubagent, sessionKey };
}
async function importCore() {
    const core = await import('@openclaw-qdrant-rag/core');
    return {
        loadConfig: core.loadConfig,
        Embedder: core.Embedder,
        QdrantClient: core.QdrantClient,
        retrieve: core.retrieve,
        formatForInjection: core.formatForInjection,
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
export default function register(api) {
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
    let logger;
    let initialized = false;
    let initFailed = false;
    let embedder = null;
    let qdrantClient = null;
    let ragConfig = null;
    let coreRetrieve = null;
    let coreFormatForInjection = null;
    // Create logger immediately (only needs api + debug config)
    logger = createLogger(api, config.debug);
    /**
     * Lazy initialization of core services.
     * Called on the first qualifying message. Fails open on error.
     */
    async function initializeCore() {
        if (initialized)
            return !initFailed;
        if (initFailed)
            return false;
        try {
            const core = await importCore();
            // Load shared RAG config (merges with plugin's configPath if provided)
            ragConfig = core.loadConfig(config.configPath);
            // Store core retrieval and formatting functions
            coreRetrieve = core.retrieve;
            coreFormatForInjection = core.formatForInjection;
            // Initialize embedder (created once, reused across calls)
            embedder = new core.Embedder(ragConfig.apiKey, ragConfig.embeddingModel, ragConfig.embeddingDimensions, { maxCacheSize: config.embedding.cacheMaxSize, cacheTtlMs: config.embedding.cacheTtlMs });
            // Initialize Qdrant client (created once, reused across calls)
            qdrantClient = new core.QdrantClient(ragConfig.qdrantUrl, ragConfig.collection);
            initialized = true;
            logger.info('core initialized successfully');
            return true;
        }
        catch (error) {
            logger.logError(error);
            logger.info('core initialization failed — plugin will retry on next message');
            // Don't set initFailed permanently — allow retry on next message
            // in case Qdrant was temporarily unavailable at startup
            return false;
        }
    }
    // 6. Register the before_prompt_build hook
    api.on('before_prompt_build', async (event, ctx) => {
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
            const gate = shouldRetrieve(message, config.preGate, session.isSubagent, config.autoRecall.skipSubagents);
            if (!gate.shouldRetrieve) {
                logger.logSkip(gate.reason);
                return undefined;
            }
            // Lazy-initialize core services
            const coreReady = await initializeCore();
            if (!coreReady || !embedder || !qdrantClient || !coreRetrieve || !coreFormatForInjection || !ragConfig) {
                logger.logSkip('core not initialized — failing open');
                return undefined;
            }
            logger.logQuery(message);
            // d. Run full retrieval pipeline (embed + vector search + lexical fallback + rank)
            const { results, fallbackUsed, warning } = await coreRetrieve(message, {
                embedder,
                qdrantClient,
                config: ragConfig,
                maxResults: config.autoRecall.maxResults,
            });
            if (!results || results.length === 0) {
                logger.logSkip('no results above score threshold');
                return undefined;
            }
            if (warning) {
                logger.info(`retrieval warning: ${warning}`);
            }
            if (fallbackUsed) {
                logger.info('lexical fallback was used');
            }
            // e. Format results for injection (respecting token budget)
            const formatted = coreFormatForInjection(results, {
                maxTokens: config.autoRecall.maxTokens,
                hardCapTokens: config.autoRecall.hardCapTokens,
            });
            if (!formatted) {
                logger.logSkip('formatted context was empty after token budgeting');
                return undefined;
            }
            // f. Log injection if debug enabled
            logger.logInjection(formatted, results.length);
            // g. Return context for system prompt injection
            return { appendSystemContext: formatted };
        }
        catch (error) {
            // FAIL OPEN — never crash the gateway
            logger.logError(error);
            return undefined;
        }
    });
    // 7. Log startup
    logger.info(`registered (autoRecall=${config.autoRecall.enabled}, ` +
        `maxResults=${config.autoRecall.maxResults}, ` +
        `minScore=${config.autoRecall.minScore}, ` +
        `skipSubagents=${config.autoRecall.skipSubagents})`);
}
