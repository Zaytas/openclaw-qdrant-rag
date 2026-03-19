# Architecture

## Overview

OpenClaw Qdrant RAG implements a three-tier memory model that gives your agent access to deep, searchable context without bloating the prompt window or relying on the agent to decide what to recall.

## Three-Tier Memory Model

```
┌─────────────────────────────────────────────────┐
│  Tier 1: Hot Context (boot-time)                │
│  AGENTS.md, SOUL.md, workspace files injected   │
│  at session start. Always present.              │
├─────────────────────────────────────────────────┤
│  Tier 2: Warm Memory (native OpenClaw)          │
│  memory_store / memory_recall — LanceDB-backed  │
│  fact storage. Agent-initiated retrieval.        │
├─────────────────────────────────────────────────┤
│  Tier 3: Deep Memory (Qdrant RAG)               │
│  Vector-indexed documents, transcripts, and     │
│  summaries. Automatic retrieval on every message.│
└─────────────────────────────────────────────────┘
```

**Tier 1** is always loaded — it's your workspace files, identity, and configuration. Small, static, high-signal.

**Tier 2** is OpenClaw's built-in memory system (LanceDB). It stores discrete facts, preferences, and decisions. The agent explicitly calls `memory_store` and `memory_recall`. Great for structured knowledge ("user prefers dark mode", "deploy key is X").

**Tier 3** is this system. It stores full document chunks, conversation transcripts, and session summaries. Retrieval is *automatic* — the plugin searches on every message and injects relevant context before the agent sees the prompt. Great for "what did we discuss about the auth refactor last week?" or "what's in that config file I edited?"

### How They Complement Each Other

| Aspect | Built-in Memory (Tier 2) | Qdrant RAG (Tier 3) |
|--------|--------------------------|----------------------|
| Storage | LanceDB (local) | Qdrant (Docker/hosted) |
| Data type | Discrete facts & preferences | Documents, transcripts, summaries |
| Retrieval | Agent-initiated (`memory_recall`) | Automatic (plugin-enforced) |
| Granularity | Single facts | Chunked passages (200-800 tokens) |
| Best for | "What does the user prefer?" | "What context is relevant right now?" |

They're complementary, not competing. Built-in memory handles structured facts; Qdrant RAG handles unstructured context retrieval.

## Data Layers in Qdrant

All data lives in a single Qdrant collection (`openclaw_memory` by default) with three logical layers distinguished by metadata:

### Layer A: Transcript Chunks

- **Source**: Raw session transcripts from `~/.openclaw/sessions/`
- **Indexed by**: `index-transcripts.mjs`
- **Chunk size**: ~500 tokens with overlap
- **Metadata**: `source: "transcript"`, session ID, timestamp, participant roles
- **Use case**: "What did we talk about regarding X?"

### Layer B: Session Summaries

- **Source**: AI-generated summaries of completed sessions
- **Indexed by**: `summarize-worker.mjs`
- **Content**: Condensed session overviews — decisions, outcomes, key topics
- **Metadata**: `source: "summary"`, session ID, date range, topic tags
- **Use case**: High-signal overview of past work. One summary covers an entire session.

### Layer C: File Chunks

- **Source**: Workspace files (markdown, code, config, docs)
- **Indexed by**: `index-memory.mjs`
- **Chunk size**: ~400 tokens with overlap
- **Metadata**: `source: "file"`, file path, last modified date
- **Use case**: "What's in that architecture doc?" or "How is the deploy script configured?"

## Auto-Recall Pipeline

```
Inbound message
      │
      ▼
┌──────────────────────────┐
│  before_prompt_build     │  Plugin hook fires
│  hook                    │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  Pre-gate query          │  Extract search terms from the message.
│  extraction              │  Uses keyword extraction + entity detection.
│                          │  Short/trivial messages ("hi", "thanks") are
│                          │  skipped (no search performed).
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  Embedding               │  Query embedded via Gemini
│  (text-embedding-004)    │  (cached for repeated queries)
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  Qdrant vector search    │  Searches all three layers simultaneously.
│  + optional grep         │  Grep provides keyword verification.
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  Ranking & scoring       │  Source weighting, dual-match bonus,
│                          │  deduplication, confidence threshold
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  Context injection       │  Top N results formatted and inserted
│                          │  into the system prompt as [RAG Context]
└──────────────────────────┘
```

## Source Weighting

Not all sources are created equal. Results are weighted by source type:

| Source | Weight | Rationale |
|--------|--------|-----------|
| Session summaries (Layer B) | **1.15×** | Highest signal-to-noise. AI-distilled, covers key decisions and outcomes. |
| File chunks (Layer C) | **1.0×** | Direct source material. Authoritative but may include boilerplate. |
| Transcript chunks (Layer A) | **0.9×** | Raw conversation. Valuable but noisy — includes back-and-forth, corrections, tangents. |

The raw Qdrant similarity score is multiplied by the source weight before ranking.

## Dual-Match Bonus

When a result is found by *both* vector similarity search and keyword grep, it receives a **1.2× bonus** on top of its weighted score. This rewards results that match both semantically and lexically — a strong signal of true relevance.

Example:
- Vector search finds a chunk about "Docker networking" with score 0.78
- Grep also finds "Docker" in the same chunk
- Final score: `0.78 × 1.0 (file weight) × 1.2 (dual-match) = 0.936`

## Confidence Scoring

Each result has a final confidence score (0–1) after weighting and bonuses. The plugin applies a **confidence threshold** (default: 0.35) — results below this threshold are discarded.

The threshold is intentionally low. It's better to include a marginally relevant chunk than to miss something important. The agent can ignore irrelevant context, but it can't use context it never received.

## Fail-Open Design

Every component in the pipeline is designed to fail open:

- **Qdrant unreachable** → Plugin logs a warning and proceeds. The agent gets no RAG context but functions normally.
- **Gemini embedding fails** → Falls back to cached embeddings if available, otherwise skips search.
- **No results above threshold** → No context injected. Agent proceeds with standard prompt.
- **Plugin crashes** → OpenClaw catches the error and continues without the plugin for that message.

The philosophy: RAG context is an enhancement, not a dependency. The agent should *never* fail because of the memory system.
