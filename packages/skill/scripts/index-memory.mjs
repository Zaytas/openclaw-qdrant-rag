#!/usr/bin/env node

/**
 * index-memory.mjs — Workspace file indexer (Layer C)
 *
 * Indexes markdown files from the OpenClaw workspace into Qdrant
 * for vector-based retrieval. Supports incremental indexing (default)
 * and full reindex.
 *
 * Usage:
 *   node scripts/index-memory.mjs              # Incremental (skip unchanged)
 *   node scripts/index-memory.mjs --full       # Full reindex
 *   node scripts/index-memory.mjs --dry-run    # Preview what would be indexed
 */

import { init, SKILL_DIR } from '../lib/core.mjs';
import { cleanupStalePoints } from '../lib/cleanup.mjs';
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `
Usage: index-memory.mjs [options]

Index workspace markdown files into Qdrant for vector search.

Options:
  --full       Full reindex (ignore incremental state)
  --cleanup    After indexing, delete stale/orphaned points
  --dry-run    Preview what would be indexed (and cleaned) without changes
  --config F   Path to config file
  --help       Show this help

Behavior:
  By default, runs incrementally: only re-indexes files that changed
  (based on mtime + size) since the last run. State is tracked in
  index-state.json in the skill directory.
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
// Config extension: skill-level indexer settings
// ---------------------------------------------------------------------------

/** Load extra indexer config from qdrant-rag.config.json if present. */
function loadIndexerConfig() {
  const configPath = join(SKILL_DIR, 'qdrant-rag.config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Recursively discover files matching the configured extensions.
 *
 * @param {string} baseDir - Root directory to scan.
 * @param {string[]} extensions - Allowed extensions (e.g. ['.md']).
 * @param {string[]} excludeDirs - Directory names to skip.
 * @param {string[]} excludeFiles - File names to skip.
 * @returns {string[]} Absolute file paths.
 */
function discoverFiles(baseDir, extensions, excludeDirs, excludeFiles) {
  const found = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Permission denied or missing — skip
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (excludeFiles.includes(entry.name)) continue;
        if (extensions.length > 0 && !extensions.includes(extname(entry.name))) continue;
        found.push(fullPath);
      }
    }
  }

  walk(baseDir);
  return found;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split text into overlapping chunks by line count.
 *
 * @param {string} text - Full file text.
 * @param {number} chunkSize - Max chars per chunk.
 * @param {number} chunkOverlap - Overlap chars between chunks.
 * @returns {Array<{text: string, startLine: number, endLine: number}>}
 */
function chunkText(text, chunkSize, chunkOverlap) {
  const lines = text.split('\n');
  const chunks = [];

  let charPos = 0;
  let lineIdx = 0;

  while (lineIdx < lines.length) {
    let chunkChars = 0;
    const startLine = lineIdx + 1; // 1-indexed
    const chunkLines = [];

    // Accumulate lines up to chunkSize chars
    while (lineIdx < lines.length && chunkChars + lines[lineIdx].length + 1 <= chunkSize) {
      chunkLines.push(lines[lineIdx]);
      chunkChars += lines[lineIdx].length + 1; // +1 for newline
      lineIdx++;
    }

    // If we couldn't fit even one line, take it anyway
    if (chunkLines.length === 0 && lineIdx < lines.length) {
      chunkLines.push(lines[lineIdx]);
      lineIdx++;
    }

    const endLine = startLine + chunkLines.length - 1;
    chunks.push({
      text: chunkLines.join('\n').trim(),
      startLine,
      endLine,
    });

    // Back up for overlap
    if (lineIdx < lines.length && chunkOverlap > 0) {
      let overlapChars = 0;
      let backtrack = 0;
      for (let i = chunkLines.length - 1; i >= 0 && overlapChars < chunkOverlap; i--) {
        overlapChars += chunkLines[i].length + 1;
        backtrack++;
      }
      lineIdx = Math.max(startLine - 1 + chunkLines.length - backtrack, startLine);
    }
  }

  return chunks.filter((c) => c.text.length > 0);
}

// ---------------------------------------------------------------------------
// State management (incremental indexing)
// ---------------------------------------------------------------------------

const STATE_FILE = join(SKILL_DIR, 'index-state.json');

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

function generatePointId(fileName, chunkIndex) {
  const hash = createHash('sha256')
    .update(`file:${fileName}:${chunkIndex}`)
    .digest('hex')
    .slice(0, 32);
  // Qdrant accepts string UUIDs — use a deterministic pseudo-UUID
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

  console.log('=== Index Workspace Files ===');
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

  // Load indexer-specific settings from skill config
  const skillConfig = loadIndexerConfig();
  const scanDirs = skillConfig.scanDirs ?? ['', 'memory'];
  const includeExtensions = skillConfig.includeExtensions ?? ['.md'];
  const excludeFiles = skillConfig.excludeFiles ?? ['SECRETS.md'];
  const excludeDirs = skillConfig.excludeDirs ?? ['node_modules', '.git', 'dist', 'logs'];
  const batchSize = skillConfig.batchSize ?? 10;
  const chunkSize = skillConfig.chunkSize ?? config.chunkSize;
  const chunkOverlap = skillConfig.chunkOverlap ?? config.chunkOverlap;

  // Determine workspace root
  const workspace = config.workspacePath || process.env.OPENCLAW_WORKSPACE || process.cwd();

  console.log(`Workspace: ${workspace}`);
  console.log(`Scan dirs: ${scanDirs.join(', ') || '(root)'}`);
  console.log(`Extensions: ${includeExtensions.join(', ')}`);
  console.log(`Chunk size: ${chunkSize} chars, overlap: ${chunkOverlap}`);
  console.log('');

  // Ensure collection exists
  if (!args.dryRun) {
    const exists = await qdrant.collectionExists();
    if (!exists) {
      console.log(`Creating collection "${config.collection}" (${config.embeddingDimensions}d)...`);
      await qdrant.createCollection(config.embeddingDimensions);
    }
  }

  // Discover files
  let allFiles = [];
  for (const dir of scanDirs) {
    const scanPath = dir ? resolve(workspace, dir) : workspace;
    if (!existsSync(scanPath)) {
      console.log(`  Skipping missing dir: ${dir || '(root)'}`);
      continue;
    }
    const files = discoverFiles(scanPath, includeExtensions, excludeDirs, excludeFiles);
    allFiles.push(...files);
  }

  // Deduplicate
  allFiles = [...new Set(allFiles)];
  console.log(`Discovered ${allFiles.length} file(s)`);

  // Load state for incremental
  const state = args.full ? {} : loadState();
  const newState = {};

  // Filter to changed files
  const toIndex = [];
  for (const filePath of allFiles) {
    const relPath = relative(workspace, filePath);
    const fp = fileFingerprint(filePath);
    newState[relPath] = fp;

    if (!args.full && state[relPath] === fp) {
      // Unchanged — but if cleanup is enabled, we still need to know these point IDs
      if (args.cleanup) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const chunks = chunkText(content, chunkSize, chunkOverlap);
          for (let i = 0; i < chunks.length; i++) {
            upsertedIds.add(generatePointId(relPath, i));
          }
        } catch {
          // If we can't read, we'll just skip — those points may get cleaned
        }
      }
      continue; // Unchanged
    }
    toIndex.push({ filePath, relPath });
  }

  console.log(`Files to index: ${toIndex.length} (${allFiles.length - toIndex.length} unchanged)`);
  console.log('');

  if (toIndex.length === 0) {
    console.log('Nothing to index. All files up to date.');
    if (!args.dryRun) saveState(newState);
    return;
  }

  // Process files
  let totalChunks = 0;
  let totalPoints = 0;
  let errors = 0;
  const upsertedIds = new Set();

  for (const { filePath, relPath } of toIndex) {
    let content;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.error(`  ✗ Read error: ${relPath} — ${err.message}`);
      errors++;
      continue;
    }

    const chunks = chunkText(content, chunkSize, chunkOverlap);
    totalChunks += chunks.length;

    if (args.dryRun) {
      console.log(`  [dry-run] ${relPath}: ${chunks.length} chunk(s)`);
      for (let i = 0; i < chunks.length; i++) {
        upsertedIds.add(generatePointId(relPath, i));
      }
      continue;
    }

    console.log(`  Indexing: ${relPath} (${chunks.length} chunks)`);

    // Process in batches
    for (let batchStart = 0; batchStart < chunks.length; batchStart += batchSize) {
      const batch = chunks.slice(batchStart, batchStart + batchSize);
      const texts = batch.map((c) => c.text);

      try {
        const vectors = await embedder.embedBatch(texts, 'RETRIEVAL_DOCUMENT');

        const points = batch.map((chunk, i) => {
          const id = generatePointId(relPath, batchStart + i);
          upsertedIds.add(id);
          return {
            id,
            vector: vectors[i],
            payload: {
              sourceType: 'file',
              fileName: relPath,
              text: chunk.text,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
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
        filter: { must: [{ key: 'sourceType', match: { value: 'file' } }] },
        upsertedIds,
        dryRun: args.dryRun,
        label: 'file',
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
  console.log(`Files processed: ${toIndex.length}`);
  console.log(`Chunks: ${totalChunks}`);
  console.log(`Points upserted: ${totalPoints}`);
  if (errors > 0) console.log(`Errors: ${errors}`);
  console.log(`Time: ${elapsed}s`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
