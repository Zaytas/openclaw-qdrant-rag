#!/usr/bin/env node

/**
 * recall.mjs — Unified RAG search CLI
 *
 * Searches the Qdrant memory collection using vector similarity,
 * with optional source-type filtering and JSON output.
 *
 * Usage:
 *   node scripts/recall.mjs "what is the deployment process?" [--limit 5] [--json]
 *   node scripts/recall.mjs "docker setup" --source-type file --limit 3
 *
 * Also exports recall() for module use.
 */

import { init } from '../lib/core.mjs';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const HELP = `
Usage: recall.mjs <query> [options]

Unified RAG search — queries the Qdrant memory index.

Options:
  --limit N          Max results to return (default: 5)
  --source-type TYPE Filter by source type: file, transcript, summary
  --no-vector        Skip vector search, only use lexical (grep) — not yet implemented
  --json             Output results as JSON
  --help             Show this help

Examples:
  node scripts/recall.mjs "deployment steps"
  node scripts/recall.mjs "docker" --limit 3 --json
  node scripts/recall.mjs "meeting notes" --source-type summary
`.trim();

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: 'string', short: 'l' },
      'source-type': { type: 'string', short: 's' },
      'no-vector': { type: 'boolean' },
      json: { type: 'boolean', short: 'j' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const query = positionals.join(' ').trim();
  if (!query) {
    console.error('Error: No query provided.\n');
    console.log(HELP);
    process.exit(1);
  }

  return {
    query,
    limit: values.limit ? parseInt(values.limit, 10) : 5,
    sourceType: values['source-type'] || null,
    noVector: values['no-vector'] || false,
    outputJson: values.json || false,
  };
}

// ---------------------------------------------------------------------------
// Recall function (exported for module use)
// ---------------------------------------------------------------------------

/**
 * Run a recall query against the Qdrant index.
 *
 * @param {string} query - The search query.
 * @param {object} [options] - Search options.
 * @param {number} [options.limit=5] - Max results.
 * @param {string|null} [options.sourceType=null] - Filter by source type.
 * @returns {Promise<Array<{score: number, sourceType: string, text: string, payload: object}>>}
 */
export async function recall(query, options = {}) {
  const { limit = 5, sourceType = null } = options;
  const { config, embedder, qdrant } = await init();

  // Embed the query
  const vector = await embedder.embed(query, 'RETRIEVAL_QUERY');

  // Build filter if source type specified
  const filter = sourceType
    ? { must: [{ key: 'sourceType', match: { value: sourceType } }] }
    : undefined;

  // Search Qdrant
  const results = await qdrant.search(vector, {
    limit,
    filter,
    scoreThreshold: config.scoreThreshold,
    withPayload: true,
  });

  // Apply source weights for ranking
  const weighted = results.map((r) => {
    const payload = r.payload || {};
    const st = (payload.sourceType || 'file');
    const weight = config.sourceWeights[st] ?? 1.0;
    return {
      score: r.score * weight,
      rawScore: r.score,
      sourceType: st,
      text: payload.text || '',
      payload,
    };
  });

  // Sort by weighted score descending
  weighted.sort((a, b) => b.score - a.score);

  return weighted;
}

// ---------------------------------------------------------------------------
// CLI output formatting
// ---------------------------------------------------------------------------

function formatResultForCli(result, index) {
  const lines = [];
  const label = `[${index + 1}] (${result.sourceType}) score=${result.score.toFixed(3)}`;
  lines.push(label);

  const p = result.payload;
  if (p.fileName) lines.push(`  File: ${p.fileName}`);
  if (p.sessionId) lines.push(`  Session: ${p.sessionId}`);
  if (p.agentId) lines.push(`  Agent: ${p.agentId}`);
  if (p.channel) lines.push(`  Channel: ${p.channel}`);
  if (p.startLine !== undefined) lines.push(`  Lines: ${p.startLine}–${p.endLine}`);
  if (p.indexedAt) lines.push(`  Indexed: ${p.indexedAt}`);

  // Truncate text for display
  const text = result.text || '';
  const preview = text.length > 300 ? text.slice(0, 300) + '...' : text;
  lines.push(`  ${preview.replace(/\n/g, '\n  ')}`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs();

  try {
    const results = await recall(args.query, {
      limit: args.limit,
      sourceType: args.sourceType,
    });

    if (args.outputJson) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log(`Found ${results.length} result(s) for: "${args.query}"\n`);
    for (let i = 0; i < results.length; i++) {
      console.log(formatResultForCli(results[i], i));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Run if invoked directly
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain || process.argv[1]?.endsWith('recall.mjs')) {
  main();
}
