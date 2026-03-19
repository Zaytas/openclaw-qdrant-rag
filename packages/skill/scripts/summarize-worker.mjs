#!/usr/bin/env node
import { loadConfig } from '../lib/core.mjs';

function showHelp() {
  console.log(`Usage: summarize-worker [options]

Options:
  --batch <N>     Process N items in a batch
  --dry-run       Perform a dry run with no changes
  --status        Check the status (placeholder)
  --force <ID>    Force processing of a specific ID
  --help          Show this help message
`);
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  showHelp();
  process.exit(0);
}
if (args.includes('--status')) {
  console.log('Status check not yet implemented');
  process.exit(0);
}

const config = loadConfig();
// TODO: Discover → Prepare Input → Validate → Embed → Complete
console.log('Summarize worker: implementation pending');