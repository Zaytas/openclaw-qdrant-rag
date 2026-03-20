#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${SKILL_DIR}/logs"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/nightly-${TIMESTAMP}.log"
echo "=== Nightly Index Pipeline ===" | tee "$LOG_FILE"
echo "Started: $(date -u)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "--- Step 1: Index workspace files ---" | tee -a "$LOG_FILE"
node "${SCRIPT_DIR}/index-memory.mjs" 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "--- Step 2: Index transcripts ---" | tee -a "$LOG_FILE"
node "${SCRIPT_DIR}/index-transcripts.mjs" 2>&1 | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
# Step 3: Summarization (NOT YET IMPLEMENTED — uncomment when summarize-worker.mjs is complete)
# echo "Step 3: Generating summaries..."
# node "$SCRIPT_DIR/summarize-worker.mjs" --config "$CONFIG" 2>&1 | tee -a "$LOG_FILE"
echo "Step 3: Summarization — skipped (not yet implemented)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Completed: $(date -u)" | tee -a "$LOG_FILE"
echo "Log: ${LOG_FILE}"