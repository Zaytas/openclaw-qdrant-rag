#!/usr/bin/env node

/**
 * debug-recall.mjs — Debug what auto-recall would inject for a given message
 *
 * Simulates the auto-recall pipeline: pre-gate check → embed → search → format.
 * Useful for debugging and tuning the RAG retrieval system.
 *
 * Usage:
 *   node scripts/debug-recall.mjs "How do I deploy the app?"
 *   node scripts/debug-recall.mjs "hi" --verbose
 */

import { init } from '../lib/core.mjs';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `
Usage: debug-recall.mjs <message> [options]

Simulates auto-recall: shows pre-gate result, search results,
formatted injection text, and token estimate.

Options:
  --verbose    Show raw search payloads
  --limit N    Override max results (default: from config autoRecall.maxResults)
  --help       Show this help

Examples:
  node scripts/debug-recall.mjs "How do I set up Docker?"
  node scripts/debug-recall.mjs "hi" --verbose
`.trim();

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      verbose: { type: 'boolean', short: 'v' },
      limit: { type: 'string', short: 'l' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const message = positionals.join(' ').trim();
  if (!message) {
    console.error('Error: No message provided.\n');
    console.log(HELP);
    process.exit(1);
  }

  return {
    message,
    verbose: values.verbose || false,
    limit: values.limit ? parseInt(values.limit, 10) : null,
  };
}

// ---------------------------------------------------------------------------
// Pre-gate simulation
// ---------------------------------------------------------------------------

/**
 * Simulate the pre-gate check that the plugin runs before auto-recall.
 * Returns { pass: boolean, reason: string }
 */
function preGateCheck(message, preGateConfig) {
  // Check minimum length
  if (message.length < preGateConfig.minMessageLength) {
    return {
      pass: false,
      reason: `Message too short (${message.length} chars < ${preGateConfig.minMessageLength} min)`,
    };
  }

  // Check skip patterns
  for (const pattern of preGateConfig.skipPatterns) {
    try {
      const re = new RegExp(pattern, 'i');
      if (re.test(message)) {
        return {
          pass: false,
          reason: `Matched skip pattern: ${pattern}`,
        };
      }
    } catch {
      // Invalid regex — skip it
    }
  }

  return { pass: true, reason: 'Passed all pre-gate checks' };
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Format for injection (simulates what the plugin injects into context)
// ---------------------------------------------------------------------------

function formatForInjection(results, maxTokens) {
  if (results.length === 0) return '(no results — nothing would be injected)';

  const lines = ['<relevant-memories>'];
  let tokenBudget = maxTokens;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const p = r.payload || {};
    const sourceLabel = p.fileName || p.sessionId || p.sourceType || 'unknown';
    const text = (p.text || '').trim();

    // Truncate to snippet length
    const snippet = text.length > 300 ? text.slice(0, 300) + '…' : text;
    const entry = `${i + 1}. [${r.payload?.sourceType || 'unknown'}] (${sourceLabel}) ${snippet}`;
    const entryTokens = estimateTokens(entry);

    if (entryTokens > tokenBudget) break;
    tokenBudget -= entryTokens;
    lines.push(entry);
  }

  lines.push('</relevant-memories>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs();

  console.log('=== Debug Auto-Recall ===\n');
  console.log(`Message: "${args.message}"`);
  console.log(`Length:  ${args.message.length} chars\n`);

  let config, embedder, qdrant;
  try {
    const ctx = await init();
    config = ctx.config;
    embedder = ctx.embedder;
    qdrant = ctx.qdrant;
  } catch (err) {
    console.error(`Init error: ${err.message}`);
    process.exit(1);
  }

  // Step 1: Pre-gate
  console.log('--- Pre-Gate Check ---');
  const gateResult = preGateCheck(args.message, config.autoRecall.preGate);
  console.log(`Result: ${gateResult.pass ? 'PASS ✓' : 'SKIP ✗'}`);
  console.log(`Reason: ${gateResult.reason}\n`);

  if (!gateResult.pass) {
    console.log('Auto-recall would be SKIPPED for this message.');
    console.log('(The plugin would not inject any memory context.)\n');
    return;
  }

  // Step 2: Embed
  console.log('--- Embedding ---');
  const startEmbed = Date.now();
  let vector;
  try {
    vector = await embedder.embed(args.message, 'RETRIEVAL_QUERY');
    console.log(`Dimensions: ${vector.length}`);
    console.log(`Time: ${Date.now() - startEmbed}ms\n`);
  } catch (err) {
    console.error(`Embedding failed: ${err.message}`);
    console.log('Auto-recall would fall back to lexical search only.\n');
    return;
  }

  // Step 3: Search
  console.log('--- Qdrant Search ---');
  const limit = args.limit ?? config.autoRecall.maxResults;
  const startSearch = Date.now();
  let results;
  try {
    results = await qdrant.search(vector, {
      limit,
      scoreThreshold: config.autoRecall.minScore,
      withPayload: true,
    });
    console.log(`Results: ${results.length} (limit=${limit}, minScore=${config.autoRecall.minScore})`);
    console.log(`Time: ${Date.now() - startSearch}ms\n`);
  } catch (err) {
    console.error(`Search failed: ${err.message}`);
    return;
  }

  // Step 4: Show raw results
  if (results.length === 0) {
    console.log('No results found. Nothing would be injected.\n');
    return;
  }

  console.log('--- Raw Results ---');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const p = r.payload || {};
    const st = p.sourceType || '?';
    const weight = config.sourceWeights[st] ?? 1.0;
    const weightedScore = r.score * weight;

    console.log(`[${i + 1}] score=${r.score.toFixed(4)} weighted=${weightedScore.toFixed(4)} type=${st}`);

    if (p.fileName) console.log(`    file: ${p.fileName}`);
    if (p.sessionId) console.log(`    session: ${p.sessionId}`);
    if (p.agentId) console.log(`    agent: ${p.agentId}`);

    if (args.verbose) {
      console.log(`    payload: ${JSON.stringify(p, null, 2).replace(/\n/g, '\n    ')}`);
    } else {
      const text = (p.text || '').trim();
      const preview = text.length > 120 ? text.slice(0, 120) + '...' : text;
      console.log(`    text: ${preview}`);
    }
    console.log('');
  }

  // Step 5: Format injection
  console.log('--- Formatted Injection ---');
  const injection = formatForInjection(results, config.autoRecall.maxTokens);
  console.log(injection);
  console.log('');

  // Step 6: Token estimate
  const tokenEst = estimateTokens(injection);
  console.log('--- Token Estimate ---');
  console.log(`Injection: ~${tokenEst} tokens`);
  console.log(`Budget:    ${config.autoRecall.maxTokens} (soft) / ${config.autoRecall.hardCapTokens} (hard)`);
  console.log(`Status:    ${tokenEst <= config.autoRecall.maxTokens ? 'Within budget ✓' : 'Over soft budget ⚠'}`);
  console.log('');
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
