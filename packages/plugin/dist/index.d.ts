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
import type { PluginApi } from './types.js';
/**
 * Register the Qdrant RAG auto-recall plugin with OpenClaw.
 *
 * This is the default export — OpenClaw calls register(api) at startup.
 * The plugin:
 *   1. Parses configuration
 *   2. Initializes the embedding client and Qdrant connection
 *   3. Hooks into before_prompt_build to inject relevant context
 */
export default function register(api: PluginApi): void;
