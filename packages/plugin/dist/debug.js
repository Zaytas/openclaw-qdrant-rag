/**
 * Debug/observability logger for the RAG plugin.
 *
 * Each method checks its corresponding debug flag before emitting.
 * Uses the OpenClaw-provided logger when available, falls back to console.
 */
const PREFIX = '[qdrant-rag]';
/**
 * Create a logger bound to the plugin's API and debug configuration.
 */
export function createLogger(api, debugConfig) {
    const emit = (msg) => {
        if (api.logger?.info) {
            api.logger.info(msg);
        }
        else {
            console.log(msg);
        }
    };
    const emitError = (msg) => {
        if (api.logger?.error) {
            api.logger.error(msg);
        }
        else {
            console.error(msg);
        }
    };
    return {
        logQuery(query) {
            if (debugConfig.logQueries) {
                emit(`${PREFIX} query: "${query.substring(0, 200)}${query.length > 200 ? '…' : ''}"`);
            }
        },
        logInjection(text, resultCount) {
            if (debugConfig.logInjections) {
                emit(`${PREFIX} injecting ${resultCount} result(s), ` +
                    `${text.length} chars into system context`);
            }
        },
        logSkip(reason) {
            if (debugConfig.logSkips) {
                emit(`${PREFIX} skip: ${reason}`);
            }
        },
        logError(error) {
            const msg = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? `\n${error.stack}` : '';
            emitError(`${PREFIX} error: ${msg}${stack}`);
        },
        info(msg) {
            emit(`${PREFIX} ${msg}`);
        },
    };
}
