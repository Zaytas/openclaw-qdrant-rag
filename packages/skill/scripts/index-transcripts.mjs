#!/usr/bin/env node

/**
 * index-transcripts.mjs — Session transcript indexer (Layer A)
 *
 * Indexes OpenClaw session transcripts (.jsonl files) into Qdrant
 * for vector-based retrieval. Groups messages into chunks for
 * context-rich embeddings.
 *
 * Usage:
 *   node scripts/index-transcripts.mjs              # Incremental
 *   node scripts/index-transcripts.mjs --full       # Full reindex
 *   node scripts/index-transcripts.mjs --dry-run    # Preview only
 */

import { init, SKILL_DIR } from '../lib/core.mjs';
import { cleanupStalePoints } from '../lib/cleanup.mjs';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import {
  readFileSync, writeFileSync, existsSync, statSync, readdirSync,
} from 'node:fs';
import { join, relative, resolve, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `
Usage: index-transcripts.mjs [options]

Index OpenClaw session transcripts (.jsonl) into Qdrant.

Options:
  --full       Full reindex (ignore incremental state)
  --cleanup    After indexing, delete stale/orphaned points
  --dry-run    Preview what would be indexed (and cleaned) without changes
  --config F   Path to config file
  --help       Show this help

Transcript location:
  Looks for .jsonl files under the OpenClaw agents directory:
    ~/.openclaw/agents/<agentId>/sessions/
  Configured via validAgents in config (default: ["main"]).
`.trim();

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      full: { type: 'boolean' },
      cleanup: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      config: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  return {
    full: values.full || false,
    cleanup: values.cleanup || false,
    dryRun: values['dry-run'] || false,
    configPath: values.config || undefined,
  };
}

// ---------------------------------------------------------------------------
// Transcript discovery
// ---------------------------------------------------------------------------

/**
 * Find all .jsonl session files for configured agents.
 *
 * @param {string[]} agents - Agent IDs to scan.
 * @param {string} openclawDir - Path to ~/.openclaw
 * @returns {Array<{filePath: string, agentId: string, sessionId: string}>}
 */
function discoverTranscripts(agents, openclawDir) {
  const found = [];

  for (const agentId of agents) {
    const sessionsDir = join(openclawDir, 'agents', agentId, 'sessions');
    if (!existsSync(sessionsDir)) continue;

    let entries;
    try {
      entries = readdirSync(sessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const sessionId = entry.name.replace(/\.jsonl$/, '');
      found.push({
        filePath: join(sessionsDir, entry.name),
        agentId,
        sessionId,
      });
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a session JSONL file and extract user + assistant messages.
 *
 * OpenClaw session JSONL format:
 *   - Each line is a JSON object with a `type` field
 *   - Only `type === "message"` entries contain conversation content
 *   - Message role is at `entry.message.role`
 *   - Content is an array at `entry.message.content`, each element has
 *     `{type: "text", text: "..."}` or `{type: "tool_use", ...}` etc.
 *   - The `type === "session"` entry contains session metadata
 *
 * @param {string} filePath - Path to the .jsonl file.
 * @returns {Promise<Array<{role: string, content: string, timestamp?: string, byteOffset: number}>>}
 */
async function parseTranscript(filePath) {
  const messages = [];
  let byteOffset = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const lineBytes = Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline
    if (!line.trim()) {
      byteOffset += lineBytes;
      continue;
    }

    try {
      const entry = JSON.parse(line);

      // Only process message entries
      if (entry.type !== 'message' || !entry.message) {
        byteOffset += lineBytes;
        continue;
      }

      const role = entry.message.role;
      if (role !== 'user' && role !== 'assistant') {
        byteOffset += lineBytes;
        continue;
      }

      // Extract text from content array
      const contentParts = entry.message.content;
      let text = '';

      if (typeof contentParts === 'string') {
        // Handle edge case: content might be a plain string
        text = contentParts;
      } else if (Array.isArray(contentParts)) {
        const textParts = [];
        let hasToolUse = false;

        for (const part of contentParts) {
          if (part.type === 'text' && part.text) {
            textParts.push(part.text);
          } else if (part.type === 'tool_use') {
            hasToolUse = true;
          }
          // Skip tool_result, image, and other non-text content types
        }

        text = textParts.join('\n');
        // If assistant message was only tool calls with no text, add a brief marker
        if (!text && hasToolUse) {
          text = '[tool call]';
        }
      }

      if (text.trim()) {
        messages.push({
          role,
          content: text.trim(),
          timestamp: entry.timestamp || undefined,
          byteOffset,
        });
      }
    } catch {
      // Skip malformed lines
    }
    byteOffset += lineBytes;
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Message chunking
// ---------------------------------------------------------------------------

/**
 * Group messages into chunks for embedding.
 *
 * @param {Array} messages - Parsed messages.
 * @param {number} chunkSize - Max chars per chunk.
 * @param {number} chunkOverlap - Number of messages to overlap.
 * @returns {Array<{text: string, byteStart: number, byteEnd: number, messageCount: number, timestampStart?: string, timestampEnd?: string}>}
 */
function chunkMessages(messages, chunkSize, chunkOverlap) {
  if (messages.length === 0) return [];

  const chunks = [];
  let i = 0;
  const msgsPerChunk = Math.max(1, Math.floor(chunkSize / 200)); // rough estimate: 200 chars per msg
  const overlapMsgs = Math.min(chunkOverlap, Math.floor(msgsPerChunk / 2));

  while (i < messages.length) {
    const chunkMsgs = [];
    let charCount = 0;
    const startIdx = i;

    while (i < messages.length && (charCount + messages[i].content.length < chunkSize || chunkMsgs.length === 0)) {
      chunkMsgs.push(messages[i]);
      charCount += messages[i].content.length;
      i++;
    }

    // Format as conversation text
    const text = chunkMsgs
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');

    const first = chunkMsgs[0];
    const last = chunkMsgs[chunkMsgs.length - 1];

    chunks.push({
      text,
      byteStart: first.byteOffset,
      byteEnd: last.byteOffset + Buffer.byteLength(last.content, 'utf-8'),
      messageCount: chunkMsgs.length,
      timestampStart: first.timestamp,
      timestampEnd: last.timestamp,
    });

    // Back up for overlap
    if (overlapMsgs > 0 && i < messages.length) {
      i = Math.max(startIdx + 1, i - overlapMsgs);
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

const STATE_FILE = join(SKILL_DIR, 'transcript-state.json');

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function fileFingerprint(filePath) {
  const stat = statSync(filePath);
  return `${stat.mtimeMs}:${stat.size}`;
}

// ---------------------------------------------------------------------------
// Point ID generation
// ---------------------------------------------------------------------------

function generatePointId(agentId, sessionId, chunkIndex) {
  const hash = createHash('sha256')
    .update(`transcript:${agentId}:${sessionId}:${chunkIndex}`)
    .digest('hex')
    .slice(0, 32);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs();
  const startTime = Date.now();

  console.log('=== Index Transcripts ===');
  console.log(`Mode: ${args.full ? 'FULL reindex' : 'incremental'}`);
  if (args.cleanup) console.log('CLEANUP — will remove stale points after indexing');
  if (args.dryRun) console.log('DRY RUN — no changes will be made');
  console.log('');

  // Initialize core
  let config, embedder, qdrant;
  try {
    const ctx = await init(args.configPath);
    config = ctx.config;
    embedder = ctx.embedder;
    qdrant = ctx.qdrant;
  } catch (err) {
    console.error(`Init error: ${err.message}`);
    process.exit(1);
  }

  // Load indexer-specific settings
  const skillConfig = (() => {
    const p = join(SKILL_DIR, 'qdrant-rag.config.json');
    if (!existsSync(p)) return {};
    try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return {}; }
  })();

  const batchSize = skillConfig.batchSize ?? 10;
  const chunkSize = skillConfig.chunkSize ?? config.chunkSize;
  const chunkOverlap = skillConfig.chunkOverlap ?? Math.floor((skillConfig.chunkSize ?? config.chunkSize) * 0.1);

  // Determine OpenClaw home directory
  const openclawDir = process.env.OPENCLAW_HOME || join(process.env.HOME || homedir(), '.openclaw');

  console.log(`OpenClaw dir: ${openclawDir}`);
  console.log(`Agents: ${config.validAgents.join(', ')}`);
  console.log(`Chunk size: ${chunkSize} chars`);
  console.log('');

  // Ensure collection exists
  if (!args.dryRun) {
    const exists = await qdrant.collectionExists();
    if (!exists) {
      console.log(`Creating collection "${config.collection}" (${config.embeddingDimensions}d)...`);
      await qdrant.createCollection(config.embeddingDimensions);
    }
  }

  // Discover transcripts
  const transcripts = discoverTranscripts(config.validAgents, openclawDir);
  console.log(`Discovered ${transcripts.length} transcript(s)`);

  // Load state for incremental
  const state = args.full ? {} : loadState();
  const newState = {};

  // Filter to changed transcripts
  const toIndex = [];
  for (const t of transcripts) {
    const key = `${t.agentId}/${t.sessionId}`;
    const fp = fileFingerprint(t.filePath);
    newState[key] = fp;

    if (!args.full && state[key] === fp) {
      // Unchanged — but if cleanup is enabled, compute expected point IDs
      if (args.cleanup) {
        try {
          const messages = await parseTranscript(t.filePath);
          if (messages.length > 0) {
            const chunks = chunkMessages(messages, chunkSize, Math.min(3, Math.floor(messages.length * 0.1)));
            for (let i = 0; i < chunks.length; i++) {
              upsertedIds.add(generatePointId(t.agentId, t.sessionId, i));
            }
          }
        } catch {
          // Skip — points may get cleaned if we can't read
        }
      }
      continue;
    }
    toIndex.push(t);
  }

  console.log(`Transcripts to index: ${toIndex.length} (${transcripts.length - toIndex.length} unchanged)`);
  console.log('');

  if (toIndex.length === 0) {
    console.log('Nothing to index. All transcripts up to date.');
    if (!args.dryRun) saveState(newState);
    return;
  }

  // Process transcripts
  let totalChunks = 0;
  let totalPoints = 0;
  let errors = 0;
  const upsertedIds = new Set();

  for (const { filePath, agentId, sessionId } of toIndex) {
    let messages;
    try {
      messages = await parseTranscript(filePath);
    } catch (err) {
      console.error(`  ✗ Parse error: ${agentId}/${sessionId} — ${err.message}`);
      errors++;
      continue;
    }

    if (messages.length === 0) {
      continue;
    }

    const chunks = chunkMessages(messages, chunkSize, Math.min(3, Math.floor(messages.length * 0.1)));
    totalChunks += chunks.length;

    if (args.dryRun) {
      console.log(`  [dry-run] ${agentId}/${sessionId}: ${messages.length} msgs → ${chunks.length} chunks`);
      for (let i = 0; i < chunks.length; i++) {
        upsertedIds.add(generatePointId(agentId, sessionId, i));
      }
      continue;
    }

    console.log(`  Indexing: ${agentId}/${sessionId} (${messages.length} msgs → ${chunks.length} chunks)`);

    // Detect channel from first message if available
    // (Channel might be in transcript metadata — we leave it undefined if not found)
    const channel = undefined; // Could be enhanced to extract from JSONL metadata

    // Process in batches
    for (let batchStart = 0; batchStart < chunks.length; batchStart += batchSize) {
      const batch = chunks.slice(batchStart, batchStart + batchSize);
      const texts = batch.map((c) => c.text);

      try {
        const vectors = await embedder.embedBatch(texts, 'RETRIEVAL_DOCUMENT');

        const points = batch.map((chunk, i) => {
          const id = generatePointId(agentId, sessionId, batchStart + i);
          upsertedIds.add(id);
          return {
            id,
            vector: vectors[i],
            payload: {
              sourceType: 'transcript',
              agentId,
              sessionId,
              channel,
              text: chunk.text,
              byteStart: chunk.byteStart,
              byteEnd: chunk.byteEnd,
              messageCount: chunk.messageCount,
              timestampStart: chunk.timestampStart,
              timestampEnd: chunk.timestampEnd,
              indexedAt: new Date().toISOString(),
            },
          };
        });

        await qdrant.upsertPoints(points);
        totalPoints += points.length;
      } catch (err) {
        console.error(`    ✗ Batch error at chunk ${batchStart}: ${err.message}`);
        errors++;
      }
    }
  }

  // Save state
  if (!args.dryRun) {
    saveState(newState);
  }

  // Cleanup stale points
  if (args.cleanup) {
    try {
      const cleanupResult = await cleanupStalePoints({
        qdrantUrl: config.qdrantUrl,
        collection: config.collection,
        filter: { must: [{ key: 'sourceType', match: { value: 'transcript' } }] },
        upsertedIds,
        dryRun: args.dryRun,
        label: 'transcript',
      });
      if (cleanupResult.deleted > 0 || cleanupResult.stale > 0) {
        console.log(`Stale cleanup: ${cleanupResult.stale} stale of ${cleanupResult.total} total`);
      }
    } catch (err) {
      console.error(`Cleanup error: ${err.message}`);
      errors++;
    }
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('=== Summary ===');
  console.log(`Transcripts processed: ${toIndex.length}`);
  console.log(`Chunks: ${totalChunks}`);
  console.log(`Points upserted: ${totalPoints}`);
  if (errors > 0) console.log(`Errors: ${errors}`);
  console.log(`Time: ${elapsed}s`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
