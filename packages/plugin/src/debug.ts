/**
 * Debug/observability logger for the RAG plugin.
 *
 * Each method checks its corresponding debug flag before emitting.
 * Uses the OpenClaw-provided logger when available, falls back to console.
 */

import type { PluginApi, DebugConfig } from './types.js';

const PREFIX = '[qdrant-rag]';

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
export function createLogger(api: PluginApi, debugConfig: DebugConfig): PluginLogger {
  const emit = (msg: string): void => {
    if (api.logger?.info) {
      api.logger.info(msg);
    } else {
      console.log(msg);
    }
  };

  const emitError = (msg: string): void => {
    if (api.logger?.error) {
      api.logger.error(msg);
    } else {
      console.error(msg);
    }
  };

  return {
    logQuery(query: string): void {
      if (debugConfig.logQueries) {
        emit(`${PREFIX} query: "${query.substring(0, 200)}${query.length > 200 ? '…' : ''}"`);
      }
    },

    logInjection(text: string, resultCount: number): void {
      if (debugConfig.logInjections) {
        emit(
          `${PREFIX} injecting ${resultCount} result(s), ` +
          `${text.length} chars into system context`,
        );
      }
    },

    logSkip(reason: string): void {
      if (debugConfig.logSkips) {
        emit(`${PREFIX} skip: ${reason}`);
      }
    },

    logError(error: unknown): void {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? `\n${error.stack}` : '';
      emitError(`${PREFIX} error: ${msg}${stack}`);
    },

    info(msg: string): void {
      emit(`${PREFIX} ${msg}`);
    },
  };
}
