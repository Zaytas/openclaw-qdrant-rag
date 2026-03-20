# Plugin Configuration Reference

The Qdrant RAG plugin is configured via the `config` object in your `openclaw.json` plugin entry.

```json
{
  "plugins": [
    {
      "name": "qdrant-rag",
      "path": "~/.openclaw/workspace/skills/qdrant-rag/packages/plugin",
      "config": {
        // options documented below
      }
    }
  ]
}
```

---

## `autoRecall`

Controls the automatic context retrieval behavior.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable or disable automatic recall on every message. When `false`, the plugin is effectively dormant. |
| `maxResults` | `number` | `5` | Maximum number of results to inject into the prompt. Higher values provide more context but consume more of the context window. |
| `confidenceThreshold` | `number` | `0.35` | Minimum confidence score (0–1) for a result to be included. Lower values include more results; higher values are stricter. |
| `maxTokens` | `number` | `2000` | Maximum total tokens of injected RAG context. Results are added in score order until this budget is exhausted. |
| `skipPatterns` | `string[]` | `["^(hi|hello|hey|thanks|ok|bye)$"]` | Regex patterns for messages that should skip RAG search entirely. Matched case-insensitively against the raw message. |
| `channels` | `string[]` | `[]` | If non-empty, only activate auto-recall for these channel types (e.g., `["webchat", "discord-dm"]`). Empty = all channels. |
| `excludeChannels` | `string[]` | `[]` | Channel types to exclude from auto-recall (e.g., `["discord-group"]`). Takes priority over `channels`. |

**Example:**

```json
"autoRecall": {
  "enabled": true,
  "maxResults": 8,
  "confidenceThreshold": 0.30,
  "maxTokens": 3000,
  "skipPatterns": ["^(hi|hello|hey|thanks|ok|bye|yes|no)$"],
  "excludeChannels": ["discord-group"]
}
```

---

## `preGate`

Controls the query extraction step that runs before searching Qdrant.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable pre-gate query extraction. When `false`, the raw message text is used as the search query (less precise). |
| `method` | `string` | `"keywords"` | Query extraction method. Options: `"keywords"` (fast, regex-based), `"llm"` (uses the model to extract a search query — slower but more accurate for complex messages). |
| `maxQueryLength` | `number` | `200` | Maximum character length of the extracted query. Longer queries are truncated. |
| `minMessageLength` | `number` | `3` | Messages shorter than this (in characters) skip RAG search entirely. |

**Example:**

```json
"preGate": {
  "enabled": true,
  "method": "keywords",
  "maxQueryLength": 250,
  "minMessageLength": 5
}
```

---

## `embedding`

Controls how text is embedded for vector search.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | `string` | `"gemini"` | Embedding provider. Currently supported: `"gemini"`. |
| `model` | `string` | `"text-embedding-004"` | Embedding model name. |
| `dimensions` | `number` | `768` | Embedding vector dimensions. Must match the Qdrant collection configuration. |
| `batchSize` | `number` | `100` | Maximum texts to embed in a single API call (for indexing). |
| `cacheTtlMs` | `number` | `300000` | How long to cache query embeddings in memory (milliseconds). Default: 5 minutes. Set to `0` to disable caching. |
| `apiKey` | `string` | `null` | Gemini API key. If not set, falls back to the `GEMINI_API_KEY` environment variable. |

**Example:**

```json
"embedding": {
  "provider": "gemini",
  "model": "text-embedding-004",
  "dimensions": 768,
  "cacheTtlMs": 600000
}
```

---

## `qdrant`

Connection and collection settings for Qdrant.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | `"http://localhost:6333"` | Qdrant server URL. |
| `apiKey` | `string` | `null` | Qdrant API key (for Qdrant Cloud or authenticated instances). If not set, no auth header is sent. |
| `collection` | `string` | `"openclaw_memory"` | Name of the Qdrant collection to use. |
| `searchLimit` | `number` | `20` | Number of candidates to retrieve from Qdrant before ranking and filtering. Higher values search more broadly but take longer. |
| `timeout` | `number` | `5000` | Request timeout in milliseconds. If Qdrant doesn't respond within this time, the search is abandoned (fail-open). |

**Example:**

```json
"qdrant": {
  "url": "http://localhost:6333",
  "collection": "openclaw_memory",
  "searchLimit": 25,
  "timeout": 3000
}
```

---

## `ranking`

Controls how search results are scored and ranked.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sourceWeights` | `object` | `{"summary": 1.15, "file": 1.0, "transcript": 0.9}` | Multipliers applied to raw similarity scores by source type. |
| `dualMatchBonus` | `number` | `1.2` | Multiplier applied when a result is found by both vector search and grep. |
| `grepEnabled` | `boolean` | `true` | Enable keyword grep verification alongside vector search. Provides dual-match bonus but adds latency. |
| `deduplication` | `boolean` | `true` | Remove near-duplicate results (same source, overlapping content). |
| `deduplicationThreshold` | `number` | `0.85` | Cosine similarity threshold above which two results are considered duplicates. |

**Example:**

```json
"ranking": {
  "sourceWeights": {
    "summary": 1.2,
    "file": 1.0,
    "transcript": 0.85
  },
  "dualMatchBonus": 1.25,
  "grepEnabled": true
}
```

---

## `debug`

Diagnostic and logging options.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable debug logging. When `true`, the plugin logs search queries, results, scores, and injection details. |
| `logFile` | `string` | `null` | Path to a debug log file. If not set, debug output goes to the OpenClaw gateway log. |
| `includeScoresInContext` | `boolean` | `false` | When `true`, include confidence scores alongside injected context (visible to the agent). Useful for debugging ranking issues. |
| `dryRun` | `boolean` | `false` | When `true`, the plugin performs search and ranking but does not inject any context. Results are logged only. Useful for testing without affecting agent behavior. |

**Example:**

```json
"debug": {
  "enabled": true,
  "logFile": "~/.openclaw/workspace/skills/qdrant-rag/scripts/logs/rag-debug.log",
  "includeScoresInContext": false,
  "dryRun": false
}
```

---

## Full Example

```json
{
  "plugins": [
    {
      "name": "qdrant-rag",
      "path": "~/.openclaw/workspace/skills/qdrant-rag/packages/plugin",
      "config": {
        "autoRecall": {
          "enabled": true,
          "maxResults": 5,
          "confidenceThreshold": 0.35,
          "maxTokens": 2000,
          "skipPatterns": ["^(hi|hello|hey|thanks|ok|bye)$"]
        },
        "preGate": {
          "enabled": true,
          "method": "keywords"
        },
        "embedding": {
          "provider": "gemini",
          "model": "text-embedding-004",
          "dimensions": 768,
          "cacheTtlMs": 300000
        },
        "qdrant": {
          "url": "http://localhost:6333",
          "collection": "openclaw_memory",
          "searchLimit": 20,
          "timeout": 5000
        },
        "ranking": {
          "sourceWeights": {
            "summary": 1.15,
            "file": 1.0,
            "transcript": 0.9
          },
          "dualMatchBonus": 1.2,
          "grepEnabled": true
        },
        "debug": {
          "enabled": false
        }
      }
    }
  ]
}
```
