# Migration Guide

For users migrating from an existing private `qdrant-rag` skill installation to this distributed package.

## What to Preserve

Before migrating, back up these files from your existing installation:

| File/Directory | Contains | Why it matters |
|---------------|----------|---------------|
| `index-state.json` | Hash map of indexed files | Prevents re-indexing unchanged files |
| `transcript-state.json` | Last-indexed transcript positions | Prevents re-indexing old transcripts |
| `summary-state.json` | Summarization progress | Tracks which sessions have been summarized |
| `pending-summaries.json` | Sessions queued for summarization | Work in progress — don't lose the queue |
| `summaries/` directory | Generated session summaries | The actual summary text files |
| `qdrant-rag.config.json` | Local config overrides | Your custom settings (if any) |

Your **Qdrant data** (the vector collection) does not need to be migrated if you're keeping the same Qdrant instance. The collection stays as-is.

## Step-by-Step Migration

### 1. Back up your existing installation

```bash
# Create a backup of state files
mkdir -p /tmp/rag-backup
cp ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/index-state.json /tmp/rag-backup/ 2>/dev/null
cp ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/transcript-state.json /tmp/rag-backup/ 2>/dev/null
cp ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/summary-state.json /tmp/rag-backup/ 2>/dev/null
cp ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/pending-summaries.json /tmp/rag-backup/ 2>/dev/null
cp -r ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/summaries/ /tmp/rag-backup/ 2>/dev/null
cp ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/qdrant-rag.config.json /tmp/rag-backup/ 2>/dev/null
```

### 2. Note your current plugin config

Check your `openclaw.json` for the existing plugin entry and note any custom config options:

```bash
cat ~/.openclaw/openclaw.json | grep -A 30 qdrant-rag
```

### 3. Remove the old installation

```bash
# Rename (don't delete yet — keep as fallback)
mv ~/.openclaw/workspace/skills/qdrant-rag ~/.openclaw/workspace/skills/qdrant-rag.old
```

### 4. Install the new version

```bash
git clone https://github.com/your-org/openclaw-qdrant-rag ~/.openclaw/workspace/skills/qdrant-rag
cd ~/.openclaw/workspace/skills/qdrant-rag
./setup.sh
```

### 5. Restore state files

```bash
cp /tmp/rag-backup/index-state.json ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/ 2>/dev/null
cp /tmp/rag-backup/transcript-state.json ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/ 2>/dev/null
cp /tmp/rag-backup/summary-state.json ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/ 2>/dev/null
cp /tmp/rag-backup/pending-summaries.json ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/ 2>/dev/null
cp -r /tmp/rag-backup/summaries/ ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/ 2>/dev/null
cp /tmp/rag-backup/qdrant-rag.config.json ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/ 2>/dev/null
```

### 6. Update openclaw.json plugin path

If the plugin path in your `openclaw.json` changed, update it:

```json
{
  "plugins": [
    {
      "name": "qdrant-rag",
      "path": "~/.openclaw/workspace/skills/qdrant-rag/packages/plugin",
      "config": {
        // ... your existing config options
      }
    }
  ]
}
```

### 7. Update cron job paths

If you have cron jobs configured, update the script paths in `openclaw.json`:

```json
{
  "cron": [
    {
      "name": "rag-index-files",
      "schedule": "0 5 * * *",
      "command": "node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/index-memory.mjs"
    },
    {
      "name": "rag-index-transcripts",
      "schedule": "10 5 * * *",
      "command": "node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/index-transcripts.mjs"
    },
    {
      "name": "rag-summarize-sessions",
      "schedule": "20 5 * * *",
      "command": "node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/summarize-worker.mjs"
    }
  ]
}
```

### 8. Restart OpenClaw gateway

```bash
openclaw gateway restart
```

## Verifying the Migration

### Check plugin loads

Send a test message and check if RAG context is being injected. Enable debug mode temporarily:

```json
"debug": { "enabled": true }
```

Then check the gateway logs for RAG-related output.

### Check collection integrity

```bash
node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/stats.mjs
```

Verify the point count matches what you had before migration. It should be the same since the Qdrant collection wasn't touched.

### Test a search

```bash
node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/search.mjs "test query about something you know was indexed"
```

### Run incremental indexing

```bash
node ~/.openclaw/workspace/skills/qdrant-rag/packages/skill/index-memory.mjs
```

With state files restored, this should report "0 new files to index" (or only files changed since the last run).

## Cleanup

Once you're satisfied the migration is complete:

```bash
# Remove the backup
rm -rf /tmp/rag-backup

# Remove the old installation
rm -rf ~/.openclaw/workspace/skills/qdrant-rag.old
```

## Troubleshooting Migration Issues

**Plugin won't load after migration:**
- Check that `setup.sh` completed successfully (builds `dist/` for core and plugin)
- Verify the path in `openclaw.json` points to the new location
- Restart the gateway

**State files not recognized:**
- State file format may have changed between versions. If indexing behaves unexpectedly, delete the state files and run a full re-index. Your Qdrant collection retains all existing data.

**Collection name mismatch:**
- If your old setup used a custom collection name, ensure the new config matches. Check `qdrant-rag.config.json` or the plugin config in `openclaw.json`.
