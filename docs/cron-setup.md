# Cron Setup — Periodic Indexing Pipeline

The indexing pipeline keeps Qdrant up to date with your workspace files and session transcripts. The recommended setup is a **single OpenClaw cron job** that runs **4x daily** and executes both indexers with `--limit 15`.

## What Runs

| Script | Layer | What it does |
|--------|-------|-------------|
| `index-memory.mjs --limit 15` | C (files) | Scans workspace files, chunks them, embeds and upserts into Qdrant. Tracks file hashes to skip unchanged files. `--limit 15` caps each run to at most 15 changed files. |
| `index-transcripts.mjs --limit 15` | A (transcripts) | Scans session transcript files, chunks conversations, embeds and upserts. Tracks last-indexed position per session. `--limit 15` caps each run to at most 15 changed sessions. |
| `summarize-worker.mjs` | B (summaries) | ⚠️ **WIP / Not yet implemented.** Keep the summary pipeline unscheduled for now. |

Each implemented script is **incremental** — it only processes new or changed content since the last run. State is tracked in JSON files in the skill directory.

## Recommended OpenClaw Cron Configuration

Use the OpenClaw cron API / `agentTurn` payload format:

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

### Schedule Details

- Runs at **00:15, 06:15, 12:15, 18:15 UTC**
- Uses **one cron job**, not separate per-script jobs
- Uses `--limit 15` so each run stays bounded and incremental
- Uses a **180 second** timeout to leave enough room for both indexers

## Why the single-job pattern?

The older 3-job pattern is obsolete. One job is simpler to operate and keeps file + transcript indexing together in the same maintenance pass. With `--limit 15`, it also avoids long catch-up runs while still making steady progress throughout the day.

## Summary pipeline status

Summary pipeline scripts remain **WIP stubs**. Keep those warnings intact and **do not schedule** any summary cron yet. In particular, do not add cron jobs for:

- `summarize-worker.mjs`
- `generate-summaries.mjs`
- `embed-summaries.mjs`
- `find-unsummarized.mjs`
- `validate-summaries.mjs`

## Environment

The cron job needs access to the `GEMINI_API_KEY` environment variable. Ensure it's set in the OpenClaw environment or in a `.env` file that OpenClaw loads.

If using Qdrant Cloud or an authenticated instance, also set the Qdrant API key in your plugin config or environment.

## Verifying the Pipeline Ran

### Check state files

After a successful run, state files are updated with timestamps:

```bash
# Last file indexing run
cat ~/.openclaw/workspace/skills/qdrant-rag/index-state.json

# Last transcript indexing run
cat ~/.openclaw/workspace/skills/qdrant-rag/transcript-state.json
```

### Check Qdrant collection stats

```bash
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/stats.mjs
```

This shows the total point count and index status. Compare before and after a pipeline run to see what was added.

### Check logs

If you've configured a log directory:

```bash
ls -la ~/.openclaw/workspace/skills/qdrant-rag/logs/
```

Each implemented script writes a log entry with the number of chunks processed, skipped, and any errors.

## Manual Run

Run the same commands directly:

```bash
# Index workspace files (bounded incremental run)
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-memory.mjs --limit 15

# Index transcripts (bounded incremental run)
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-transcripts.mjs --limit 15
```

For a full catch-up or maintenance run, omit `--limit` or use `--full` as needed.

### Force re-indexing

To re-index everything from scratch (e.g., after changing chunk size or embedding model):

```bash
# Delete state files to force full re-index
rm ~/.openclaw/workspace/skills/qdrant-rag/index-state.json
rm ~/.openclaw/workspace/skills/qdrant-rag/transcript-state.json

# Optionally reset the collection
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/reset-collection.mjs

# Run indexing
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-memory.mjs --full
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-transcripts.mjs --full
```

> ⚠️ `reset-collection.mjs` deletes all data in the Qdrant collection. Only use this when you want a full rebuild.
