/**
 * @openclaw-qdrant-rag/plugin — Plugin-specific type definitions
 *
 * Types for the OpenClaw plugin configuration, API surface, and internal use.
 * The shared RAG types (SearchResult, RagConfig, etc.) live in @openclaw-qdrant-rag/core.
 */
/** Debug/observability flags. */
export interface DebugConfig {
    logQueries: boolean;
    logInjections: boolean;
    logSkips: boolean;
}
/** Pre-gate settings for trivial-message filtering. */
export interface PreGateConfig {
    minMessageLength: number;
    skipPatterns: string[];
}
/** Auto-recall retrieval settings. */
export interface AutoRecallConfig {
    enabled: boolean;
    maxResults: number;
    minScore: number;
    maxTokens: number;
    hardCapTokens: number;
    skipSubagents: boolean;
}
/** Embedding cache settings. */
export interface EmbeddingCacheConfig {
    cacheTtlMs: number;
    cacheMaxSize: number;
}
/** Full plugin configuration shape (from openclaw.plugin.json configSchema). */
export interface PluginConfig {
    enabled: boolean;
    configPath?: string;
    autoRecall: AutoRecallConfig;
    preGate: PreGateConfig;
    embedding: EmbeddingCacheConfig;
    debug: DebugConfig;
}
/**
 * The API object passed to the plugin's register() function by OpenClaw.
 * This is a minimal interface — OpenClaw may provide additional methods.
 */
export interface PluginApi {
    /** Subscribe to OpenClaw lifecycle events. */
    on(event: string, handler: (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown): void;
    /** Plugin configuration as defined in the user's openclaw config. */
    pluginConfig?: unknown;
    /** Optional logger provided by the OpenClaw runtime. */
    logger?: {
        info?: (msg: string) => void;
        warn?: (msg: string) => void;
        error?: (msg: string) => void;
    };
}
/** Result of the pre-gate check — determines if RAG retrieval should proceed. */
export interface PreGateResult {
    shouldRetrieve: boolean;
    reason: string;
}
export interface SessionMeta {
    isSubagent: boolean;
    sessionKey: string | undefined;
}
