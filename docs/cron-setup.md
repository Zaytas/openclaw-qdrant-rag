# Cron Setup — Nightly Indexing Pipeline

The indexing pipeline keeps Qdrant up to date with your workspace files, session transcripts, and session summaries. It's designed to run nightly but can also be triggered manually.

## What Runs

| Script | Layer | What it does |
|--------|-------|-------------|
| `index-memory.mjs` | C (files) | Scans workspace files, chunks them, embeds and upserts into Qdrant. Tracks file hashes to skip unchanged files. |
| `index-transcripts.mjs` | A (transcripts) | Scans session transcript files, chunks conversations, embeds and upserts. Tracks last-indexed position per session. |
| `summarize-worker.mjs` | B (summaries) | ⚠️ **WIP / Not yet implemented.** Planned: identify sessions that need summarization, generate AI summaries, embed and upsert them. |

Each script is **incremental** — it only processes new or changed content since the last run. State is tracked in JSON files in the skill directory.

## OpenClaw Cron Configuration

Add cron jobs to your `openclaw.json`:

```json
{
  "cron": [
    {
      "name": "rag-index-files",
      "schedule": "0 5 * * *",
      "command": "node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-memory.mjs",
      "description": "Index workspace files into Qdrant"
    },
    {
      "name": "rag-index-transcripts",
      "schedule": "10 5 * * *",
      "command": "node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-transcripts.mjs",
      "description": "Index session transcripts into Qdrant"
    },
    {
      "name": "rag-summarize-sessions",
      "schedule": "20 5 * * *",
      "command": "node ~/.openclaw/workspace/skills/qdrant-rag/scripts/summarize-worker.mjs",
      "description": "Generate and index session summaries"
    }
  ]
}
```

> **Note:** The schedules above use UTC times (05:00, 05:10, 05:20 UTC). Adjust to your preferred local time. The 10-minute gaps ensure scripts don't compete for resources.

### Recommended Schedule

| Time (UTC) | Script | Duration (typical) |
|------------|--------|--------------------|
| 05:00 | `index-memory.mjs` | 1–5 minutes |
| 05:10 | `index-transcripts.mjs` | 2–10 minutes |
| 05:20 | `summarize-worker.mjs` | 5–15 minutes |

Summarization takes the longest because it calls an LLM to generate summaries. File and transcript indexing are primarily embedding calls.

## Environment

The cron jobs need access to the `GEMINI_API_KEY` environment variable. Ensure it's set in the OpenClaw environment or in a `.env` file that OpenClaw loads.

If using Qdrant Cloud or an authenticated instance, also set the Qdrant API key in your plugin config or environment.

## Verifying the Pipeline Ran

### Check state files

After a successful run, state files are updated with timestamps:

```bash
# Last file indexing run
cat ~/.openclaw/workspace/skills/qdrant-rag/index-state.json

# Last transcript indexing run
cat ~/.openclaw/workspace/skills/qdrant-rag/transcript-state.json

# Last summarization run
cat ~/.openclaw/workspace/skills/qdrant-rag/summary-state.json
```

### Check Qdrant collection stats

```bash
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/stats.mjs
```

This shows the total point count and index status. Compare before and after a pipeline run to see what was added.

### Check logs

If you've configured a log directory:

```bash
ls -la ~/.openclaw/workspace/skills/qdrant-rag/scripts/logs/
```

Each script writes a log entry with the number of chunks processed, skipped, and any errors.

## Manual Run

Run any script directly:

```bash
# Index workspace files
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-memory.mjs

# Index transcripts
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-transcripts.mjs

# Summarize sessions
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/summarize-worker.mjs
```

### Force re-indexing

To re-index everything from scratch (e.g., after changing chunk size or embedding model):

```bash
# Delete state files to force full re-index
rm ~/.openclaw/workspace/skills/qdrant-rag/index-state.json
rm ~/.openclaw/workspace/skills/qdrant-rag/transcript-state.json

# Optionally reset the collection
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/reset-collection.mjs

# Run indexing
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-memory.mjs
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-transcripts.mjs
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/summarize-worker.mjs
```

> ⚠️ `reset-collection.mjs` deletes all data in the Qdrant collection. Only use this when you want a full rebuild.

## System Crontab (Alternative)

If you prefer using the system crontab instead of OpenClaw's built-in cron:

```bash
crontab -e
```

```cron
# Qdrant RAG nightly indexing
0 5 * * * GEMINI_API_KEY=your-key node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-memory.mjs >> /tmp/rag-index.log 2>&1
10 5 * * * GEMINI_API_KEY=your-key node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-transcripts.mjs >> /tmp/rag-index.log 2>&1
20 5 * * * GEMINI_API_KEY=your-key node ~/.openclaw/workspace/skills/qdrant-rag/scripts/summarize-worker.mjs >> /tmp/rag-index.log 2>&1
```

Replace `your-key` with your actual Gemini API key or source it from an env file.
