# Troubleshooting

Common issues and how to resolve them.

---

## "Qdrant is not reachable"

**Symptoms:** Plugin logs errors about connection refused, timeout, or unreachable Qdrant. Auto-recall silently returns no results.

**Fixes:**

1. **Check if Qdrant is running:**
   ```bash
   docker ps | grep qdrant
   ```
   If not running:
   ```bash
   docker compose -f docker/docker-compose.qdrant.yml up -d
   ```

2. **Check the URL in your config:**
   Default is `http://localhost:6333`. If Qdrant runs on a different host or port, update the `qdrant.url` in your plugin config.

3. **Check connectivity:**
   ```bash
   curl http://localhost:6333/collections
   ```
   Should return a JSON response listing collections.

4. **Docker networking:** If OpenClaw runs in a container and Qdrant runs in another container, `localhost` won't work. Use the Docker network name or host IP instead:
   ```json
   "qdrant": {
     "url": "http://host.docker.internal:6333"
   }
   ```

---

## "No results returned"

**Symptoms:** Auto-recall is active but never injects any context. Debug logs show searches returning empty results.

**Fixes:**

1. **Verify the collection exists:**
   ```bash
   curl http://localhost:6333/collections/openclaw_memory
   ```
   If it doesn't exist, run the setup script or create it manually.

2. **Check if data has been indexed:**
   ```bash
   node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/stats.mjs
   ```
   If point count is 0, run the indexing scripts:
   ```bash
   node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/index-memory.mjs
   ```

3. **Test a direct search:**
   ```bash
   node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/search.mjs "your search query"
   ```

4. **Check the confidence threshold:** If your threshold is too high, results may be filtered out. Try lowering it:
   ```json
   "autoRecall": {
     "confidenceThreshold": 0.20
   }
   ```

5. **Check skip patterns:** Your message might match a skip pattern (e.g., short greetings). Try a longer, more specific message.

---

## "Plugin not loading"

**Symptoms:** No RAG context injected. No plugin-related entries in gateway logs. The system behaves as if the plugin doesn't exist.

**Fixes:**

1. **Check openclaw.json registration:**
   ```bash
   cat ~/.openclaw/openclaw.json | grep -A 5 qdrant-rag
   ```
   The plugin entry must be in the `plugins` array with the correct `path`.

2. **Check the plugin path exists:**
   ```bash
   ls ~/.openclaw/workspace/skills/qdrant-rag/packages/plugin/
   ```
   Should contain `openclaw.plugin.json`, `dist/index.js` (or `index.ts`/`index.js` at root).

3. **Check that dist/ was built:**
   ```bash
   ls ~/.openclaw/workspace/skills/qdrant-rag/packages/plugin/dist/
   ```
   If `dist/` is missing or empty, rebuild:
   ```bash
   cd ~/.openclaw/workspace/skills/qdrant-rag
   npm run build
   ```

4. **Restart the gateway:**
   ```bash
   openclaw gateway restart
   ```
   Plugin loading happens at startup. Config changes alone don't reload plugins.

5. **Check for startup errors** in the gateway log — look for errors mentioning the plugin name.

---

## "Rate limited by Gemini"

**Symptoms:** Embedding calls fail with 429 errors. Indexing stalls or completes with errors. Auto-recall intermittently fails.

**Fixes:**

1. **Check your Gemini API quota:** Free tier has limits on requests per minute. Visit [Google AI Studio](https://aistudio.google.com/) to check your usage.

2. **Enable embedding cache:** The plugin caches query embeddings in memory. Ensure caching is enabled:
   ```json
   "embedding": {
     "cacheTtlMs": 300000
   }
   ```

3. **Reduce indexing batch size:**
   ```json
   "embedding": {
     "batchSize": 50
   }
   ```

4. **Stagger indexing scripts:** Don't run all three scripts simultaneously. Use the staggered schedule from [cron-setup.md](cron-setup.md).

5. **Consider a paid Gemini plan** if you have a large workspace or high message volume.

---

## "Auto-recall not injecting context"

**Symptoms:** Plugin loads, Qdrant is reachable, data is indexed, but the agent still doesn't receive RAG context.

**Fixes:**

1. **Enable debug mode:**
   ```json
   "debug": {
     "enabled": true
   }
   ```
   Restart the gateway and send a test message. Check logs for:
   - "Pre-gate extracted query: ..."
   - "Qdrant returned N results"
   - "Injecting N results (X tokens)"
   - Or any error messages

2. **Check auto-recall is enabled:**
   ```json
   "autoRecall": {
     "enabled": true
   }
   ```

3. **Check channel filters:** If you've configured `channels` or `excludeChannels`, make sure your current channel isn't excluded.

4. **Check pre-gate:** If `preGate.enabled` is `true` but it's extracting empty queries, try setting `method` to `"keywords"` or disabling pre-gate to use raw messages:
   ```json
   "preGate": {
     "enabled": false
   }
   ```

5. **Try dry-run mode:**
   ```json
   "debug": {
     "enabled": true,
     "dryRun": true
   }
   ```
   This searches and logs but doesn't inject. Check if results are found but not injected (a ranking/threshold issue) vs. no results found at all (a search/indexing issue).

---

## Enabling Debug Logging

Add to your plugin config:

```json
"debug": {
  "enabled": true,
  "logFile": "~/.openclaw/workspace/skills/qdrant-rag/packages/skill/logs/rag-debug.log"
}
```

Restart the gateway. Debug output includes:
- Pre-gate query extraction results
- Embedding generation timing
- Qdrant search results with raw scores
- Ranking pipeline (weights, bonuses, final scores)
- Injection decisions (what was included/excluded and why)

To watch the log in real time:
```bash
tail -f ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/logs/rag-debug.log
```

---

## Verifying What Was Injected

To see exactly what the agent received as RAG context:

1. **Enable score display:**
   ```json
   "debug": {
     "includeScoresInContext": true
   }
   ```
   This adds confidence scores to the injected context block, making them visible to the agent (and in conversation logs).

2. **Ask the agent:** Send a message like "What RAG context did you receive for this message?" The agent can see the `[RAG Context]` block in its prompt.

3. **Check session transcripts:** The injected context appears in the system prompt portion of the session transcript.

---

## Common Error Messages

| Error | Meaning | Fix |
|-------|---------|-----|
| `ECONNREFUSED 127.0.0.1:6333` | Qdrant not running | Start Qdrant container |
| `Collection not found: openclaw_memory` | Collection doesn't exist | Run `setup.sh` or create manually |
| `403 Forbidden` (Gemini) | Invalid API key | Check `GEMINI_API_KEY` |
| `429 Too Many Requests` (Gemini) | Rate limited | Reduce frequency, enable cache |
| `Plugin initialization failed` | Build error or missing deps | Run `npm run build`, check for errors |
| `Cannot find module 'dist/index.js'` | Plugin not built | Run `npm run build:plugin` |
