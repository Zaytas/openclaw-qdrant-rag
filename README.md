# OpenClaw Qdrant RAG

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)

Enforced RAG memory retrieval for [OpenClaw](https://github.com/open-claw/openclaw) using [Qdrant](https://qdrant.tech/).

Auto-injects relevant context into every qualifying message via the `before_prompt_build` hook. The agent doesn't decide whether to remember — the system enforces it.

---

## Architecture

Three-package monorepo:

```
packages/
├── rag-core/    Shared library — config, Qdrant client, embedder, retriever, ranker, formatter
├── plugin/      Enforcement layer — hooks before_prompt_build, pre-gates messages, injects context
└── skill/       Maintenance — indexing scripts, periodic cron, manual query/debug tools
```

**`rag-core`** handles all Qdrant communication, embedding via Gemini, result ranking with source weights, and token-aware context formatting. Both the plugin and skill depend on it.

**`plugin`** is the enforcement layer. It registers a `before_prompt_build` hook that runs on every qualifying inbound message — embedding the query, retrieving from Qdrant, ranking results, and injecting formatted context into the system prompt. A deterministic pre-gate filters out trivial messages before any embedding call.

**`skill`** provides indexing scripts, a periodic cron helper, and debug/query tools for manual maintenance.

---

## Quick Start

```bash
git clone https://github.com/Zaytas/openclaw-qdrant-rag.git
cd openclaw-qdrant-rag
./setup.sh
```

`setup.sh` handles npm install, builds, copies files into the right OpenClaw directories, and walks you through config.

---

## Prerequisites

- **Node.js** >= 18
- **Docker** (for running Qdrant)
- **GEMINI_API_KEY** — used for embeddings via `gemini-embedding-001`
- **OpenClaw** installed and running

Start Qdrant if you haven't:

```bash
docker compose -f docker/docker-compose.qdrant.yml up -d
```

Or manually:

```bash
docker run -d --name qdrant -p 6333:6333 -v qdrant_data:/qdrant/storage qdrant/qdrant
```

---

## Manual Install

If you prefer to install manually instead of using `setup.sh`:

**1. Install dependencies**

```bash
cd openclaw-qdrant-rag
npm install
npm run build
```

**2. Copy the plugin directory**

```bash
cp -r packages/plugin/ ~/.openclaw/workspace/plugins/qdrant-rag/
```

> ⚠️ **Do NOT symlink** — use `cp -r`. See [Known Issues](#known-issues).

**3. Copy the shared core into the plugin's node_modules**

```bash
mkdir -p ~/.openclaw/workspace/plugins/qdrant-rag/node_modules/@openclaw-qdrant-rag
cp -rL node_modules/@openclaw-qdrant-rag/* ~/.openclaw/workspace/plugins/qdrant-rag/node_modules/@openclaw-qdrant-rag/
```

> The `-L` flag dereferences symlinks, which is required because npm workspaces use symlinks in `node_modules`.

**4. Register the plugin in `openclaw.json`**

```jsonc
{
  "plugins": {
    "allow": ["qdrant-rag"],
    "entries": {
      "qdrant-rag": {
        "enabled": true,
        "config": {
          "configPath": "/home/YOUR_USER/.openclaw/workspace/skills/qdrant-rag/qdrant-rag.config.json",
          "autoRecall": {
            "enabled": true,
            "maxResults": 6,
            "minScore": 0.4,
            "maxTokens": 1200,
            "hardCapTokens": 2000,
            "skipSubagents": true
          },
          "preGate": {
            "minMessageLength": 10,
            "skipPatterns": ["^\\s*$", "^(ok|thanks|yes|no|sure|got it)\\s*$"]
          },
          "debug": {
            "logQueries": false,
            "logInjections": false,
            "logSkips": false
          }
        }
      }
    }
  }
}
```

**5. Copy the skill**

```bash
cp -r packages/skill/ ~/.openclaw/workspace/skills/qdrant-rag/
```

> **Note:** `packages/skill/` may contain development state files. Only copy `scripts/`, `SKILL.md`, `config.mjs`, and the example config. Do not copy `.json` state files or `summaries/` — those are generated at runtime.

**6. Copy the shared core into the skill's node_modules**

```bash
mkdir -p ~/.openclaw/workspace/skills/qdrant-rag/node_modules/@openclaw-qdrant-rag
cp -rL node_modules/@openclaw-qdrant-rag/* ~/.openclaw/workspace/skills/qdrant-rag/node_modules/@openclaw-qdrant-rag/
```

> Without this, the skill's maintenance scripts cannot resolve `@openclaw-qdrant-rag/core` and will fail.

**7. Copy and edit the config**

```bash
cp packages/skill/qdrant-rag.config.example.json ~/.openclaw/workspace/skills/qdrant-rag/qdrant-rag.config.json
```

Edit `qdrant-rag.config.json` — set your Qdrant URL, collection name, scan directories, and any source weights.

**8. Set your API key**

```bash
export GEMINI_API_KEY="your-key-here"
```

Add to your shell profile or OpenClaw's environment config for persistence.

**9. Restart the gateway**

```bash
openclaw gateway restart
```

### Verify Installation

After completing the manual install steps, verify everything is wired correctly:

1. **Plugin loads without errors:**
   ```bash
   node -e "require('$HOME/.openclaw/workspace/plugins/qdrant-rag/dist/index.js')"
   ```

2. **rag-core resolves from the plugin's node_modules:**
   ```bash
   node -e "require('$HOME/.openclaw/workspace/plugins/qdrant-rag/node_modules/@openclaw-qdrant-rag/core/dist/index.js')"
   ```

3. **Restart the gateway:**
   ```bash
   openclaw gateway restart
   ```

4. **Check gateway logs** for a line like:
   ```
   [qdrant-rag] registered (autoRecall=true, ...)
   ```

5. **Send a test message** and check logs for auto-recall activity (embedding queries, retrieval results, or skip reasons).

---

## Plugin Configuration

Full schema for the `plugins.entries.qdrant-rag.config` block in `openclaw.json`:

> **Note:** All configuration keys below go inside `"config": { ... }` within the plugin entry. The entry itself only has `"enabled"` and `"config"`.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `configPath` | string | — | **Absolute path** to `qdrant-rag.config.json` |
| `autoRecall.enabled` | boolean | `true` | Enable/disable auto-recall |
| `autoRecall.maxResults` | integer | `6` | Max Qdrant results to retrieve (1–10) |
| `autoRecall.minScore` | number | `0.4` | Minimum similarity score threshold (0–1) |
| `autoRecall.maxTokens` | integer | `1200` | Soft cap on injected context tokens |
| `autoRecall.hardCapTokens` | integer | `2000` | Hard cap — context is truncated here |
| `autoRecall.skipSubagents` | boolean | `true` | Skip recall for subagent sessions |
| `preGate.minMessageLength` | integer | `10` | Messages shorter than this skip recall |
| `preGate.skipPatterns` | string[] | `["^\\s*$", ...]` | Regex patterns that skip recall |
| `embedding.cacheTtlMs` | integer | `300000` | Embedding cache TTL (ms) |
| `embedding.cacheMaxSize` | integer | `100` | Max cached embeddings |
| `debug.logQueries` | boolean | `false` | Log embedding queries |
| `debug.logInjections` | boolean | `false` | Log injected context |
| `debug.logSkips` | boolean | `false` | Log skipped messages |

---

## Scripts

Located in `packages/skill/scripts/`:

### Implemented

| Script | Purpose |
|--------|---------|
| `recall.mjs` | Query Qdrant and display ranked results — the same pipeline the plugin uses |
| `index-memory.mjs` | Index markdown files from workspace into Qdrant (`--limit N` supported for bounded incremental runs) |
| `index-transcripts.mjs` | Index session transcripts into Qdrant (`--limit N` supported for bounded incremental runs) |
| `nightly-index.sh` | Helper script — runs memory + transcript indexing (manual/legacy use; recommended cron calls both indexers directly) |
| `debug-recall.mjs` | Verbose recall with scoring breakdown for debugging |

### ⚠️ Not Yet Implemented (Phase 2 — Coming Soon)

These scripts exist as stubs but are **not functional**. Do not schedule them in cron.

| Script | Planned Purpose |
|--------|----------------|
| `generate-summaries.mjs` | Summarize large memory blocks |
| `embed-summaries.mjs` | Embed summaries into Qdrant |
| `summarize-worker.mjs` | Parallelized summarization worker |
| `query-memory.mjs` | Cross-index memory querying |
| `find-unsummarized.mjs` | Locate unsummarized memory chunks |
| `validate-summaries.mjs` | Validate summary completeness |

---

## Scheduled Indexing (Cron)

The plugin handles auto-recall (query-time). But you still need to **periodically** index new content into Qdrant. The recommended setup is a **single OpenClaw cron job** that runs **4x daily** and calls both indexers with `--limit 15` so each run stays bounded and catches up incrementally over time.

### Recommended periodic indexer

Runs at **00:15, 06:15, 12:15, and 18:15 UTC**.

Example OpenClaw cron job (via `/cron add` or the cron API):

```json
{
  "name": "Periodic RAG Indexer",
  "schedule": { "kind": "cron", "expr": "15 */6 * * *", "tz": "UTC" },
  "sessionTarget": "isolated",
  "payload": {
    "kind": "agentTurn",
    "message": "Run: node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-memory.mjs --limit 15 && node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-transcripts.mjs --limit 15\nReport what was indexed.",
    "timeoutSeconds": 180
  },
  "delivery": { "mode": "none" }
}
```

### Why `--limit 15`?

- Keeps each cron run bounded so it doesn't try to process an unbounded backlog in one turn
- Works well for steady-state maintenance when new files or transcripts arrive throughout the day
- Lets you run more frequently without needing a long timeout window

### Summarization pipeline status

Summary-generation scripts are still **WIP stubs**. Keep the existing warnings in mind and **do not schedule** `summarize-worker.mjs`, `generate-summaries.mjs`, or related summary pipeline scripts in cron yet.

---

## Coexistence with Built-in Memory (memory-lancedb)

OpenClaw includes a built-in memory system (lancedb-backed `memory_store`/`memory_recall` with auto-recall). This plugin is designed to **complement, not replace** that system.

### Role Split
- **Built-in memory (lancedb)**: Authoritative for structured personal memory — preferences, decisions, facts, entities, corrections
- **Qdrant RAG (this plugin)**: Documentary recall — workspace files, daily notes, conversation transcripts, project docs

### Design Principles
- Both systems inject context independently into each prompt
- Qdrant's token budget is kept conservative (1.2k default / 2k cap) since built-in auto-recall also injects
- If you correct a fact via `memory_store`, that correction takes authority over any stale version in Qdrant-indexed content
- The two systems index different corpora by design — avoid indexing files that simply mirror structured memories

### When to Revisit
This coexistence model works well when overlap is minimal. Consider revisiting if you observe:
- Frequent duplicate context from both systems
- Stale Qdrant content contradicting corrected memories
- Noticeable prompt bloat or quality degradation

---

## Known Issues

- ⚠️ **Do NOT symlink the plugin directory.** OpenClaw's plugin scanner uses `isDirectory()` on the resolved path, which returns `false` for symlinks. Copy with `cp -r` instead.
- **`configPath` must be absolute.** Relative paths will fail to resolve at plugin load time.
- **Plugin config validation depends on successful load.** If the plugin fails to load (missing dependencies, bad entry point), config validation for its `entries` block also fails — check gateway logs for the root cause.
- ⚠️ **First install timing:** `config.patch` validates against currently-loaded plugins. On first install, the plugin isn't loaded yet. Edit `openclaw.json` directly, then restart the gateway.

---

## License

[MIT](LICENSE)
