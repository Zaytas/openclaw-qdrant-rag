# 🦠 OpenClaw Qdrant RAG

**Automatic deep memory retrieval for OpenClaw agents using Qdrant vector database.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)

---

## Scripts Overview

This repository provides several scripts for working with Qdrant-based memory indexing and retrieval. Below is a categorized summary of their implementation status:

### Fully Implemented Scripts
- `recall.mjs`: Memory recall for query answering.
- `debug-recall.mjs`: Debugging and inspection of recall process.
- `index-memory.mjs`: Index structured memory into Qdrant.
- `index-transcripts.mjs`: Index transcripts into Qdrant for memory retrieval.
- `nightly-index.sh`: Orchestrates nightly memory indexing flows.

### Stub Scripts (Planned for Phase 2)
- `generate-summaries.mjs` *(Phase 2 — stub)*: Planned for summarization of large memory blocks.
- `embed-summaries.mjs` *(Phase 2 — stub)*: Planned for embedding summaries into the vector database.
- `summarize-worker.mjs` *(Phase 2 — stub)*: Worker script for parallelized summarization tasks.
- `query-memory.mjs` *(Phase 2 — stub)*: Under development for querying across indexed memory.
- `find-unsummarized.mjs` *(Phase 2 — stub)*: Will locate unsummarized memory chunks.
- `validate-summaries.mjs` *(Phase 2 — stub)*: Planned for validating summary completeness and accuracy.

---

These scripts provide the foundation for integrating vector-based retrieval with OpenClaw. Contributions and feedback are welcome to enhance the functionality and coverage.

For detailed usage, see the documentation in the respective script files, or open an issue for clarifications!