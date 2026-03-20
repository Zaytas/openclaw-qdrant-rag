#!/usr/bin/env node
// ============================================================================
// ⚠️  UNIMPLEMENTED / WIP — Part of the summarization pipeline (Phase 2).
//     This script is a stub and does not function yet.
// ============================================================================

function showHelp() {
  console.log(`Usage: find-unsummarized [options]

Options:
  --json          Output results in JSON format
  --help          Show this help message
`);
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  showHelp();
  process.exit(0);
}

// TODO: Scan session files and compare against summary state
console.log('Find unsummarized: implementation pending');