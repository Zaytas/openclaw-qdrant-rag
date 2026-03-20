# qdrant-rag

RAG memory pipeline using Qdrant vector database and Gemini embeddings. Indexes workspace files, session transcripts, and conversation summaries into Qdrant for semantic search and retrieval.

## When to Use
- Indexing workspace content into vectors
- Searching memory via RAG (manual queries beyond auto-recall)
- Running the periodic indexing pipeline
- Managing session summaries
- Debugging or inspecting the memory index
- Querying the Qdrant memory collection directly

## When NOT to Use
- For built-in memory_store/memory_recall (that's OpenClaw native memory-lancedb)
- For general web search
- Auto-recall is handled by the qdrant-rag plugin automatically — these scripts are for maintenance

## Prerequisites
- Qdrant instance running (default: http://localhost:6333)
- GEMINI_API_KEY environment variable set

## Available Scripts

All scripts are in `scripts/` relative to this skill directory.

### Indexing
- `node scripts/index-memory.mjs [--full] [--limit N]` — Index workspace markdown files into Qdrant (incremental by default; `--limit N` caps how many changed files are processed in one run)
- `node scripts/index-transcripts.mjs [--full] [--limit N]` — Index session transcripts into Qdrant (`--limit N` caps how many changed sessions are processed in one run)
- `node scripts/summarize-worker.mjs` — ⚠️ **STUB / WIP** — Summarization pipeline not yet implemented; do not schedule in cron
- `node scripts/generate-summaries.mjs` — ⚠️ **STUB / WIP** — Not yet implemented
- `node scripts/embed-summaries.mjs` — ⚠️ **STUB / WIP** — Not yet implemented

### Query & Debug
- `node scripts/recall.mjs "query" [--limit N] [--json]` — Unified search (vector + grep)
- `node scripts/query-memory.mjs "query" [--limit N]` — Direct Qdrant vector query
- `node scripts/debug-recall.mjs "message text"` — Show what auto-recall would inject for a given message

### Maintenance
- `node scripts/find-unsummarized.mjs` — ⚠️ **STUB / WIP** — Not yet implemented
- `node scripts/validate-summaries.mjs` — ⚠️ **STUB / WIP** — Not yet implemented
- `node scripts/nightly-index.sh` — Helper script that runs file + transcript indexing; useful for manual runs, but the recommended cron setup calls both indexers directly

## Recommended Cron Pattern

Use one OpenClaw cron job that runs **4x daily** (`15 */6 * * *`) and executes:

```bash
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-memory.mjs --limit 15
node ~/.openclaw/workspace/skills/qdrant-rag/scripts/index-transcripts.mjs --limit 15
```

Recommended timeout: **180 seconds**.

## Configuration
Config file: `qdrant-rag.config.json` in this directory (optional — defaults work for most setups).
Environment variables: QDRANT_URL, GEMINI_API_KEY, QDRANT_COLLECTION
