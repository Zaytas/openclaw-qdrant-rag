/**
 * Debug/observability logger for the RAG plugin.
 *
 * Each method checks its corresponding debug flag before emitting.
 * Uses the OpenClaw-provided logger when available, falls back to console.
 */
import type { PluginApi, DebugConfig } from './types.js';
export interface PluginLogger {
    logQuery(query: string): void;
    logInjection(text: string, resultCount: number): void;
    logSkip(reason: string): void;
    logError(error: unknown): void;
    /** Always logs, regardless of debug flags. Used for startup/shutdown. */
    info(msg: string): void;
}
/**
 * Create a logger bound to the plugin's API and debug configuration.
 */
export declare function createLogger(api: PluginApi, debugConfig: DebugConfig): PluginLogger;
