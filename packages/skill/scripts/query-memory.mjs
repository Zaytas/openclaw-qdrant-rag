#!/usr/bin/env node

function showHelp() {
  console.log(`Usage: query-memory [options] <query-string>

Options:
  --limit <N>     Limit the number of results
  --json          Output results in JSON format
  --help          Show this help message
`);
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  showHelp();
  process.exit(0);
}

if (args.length === 0) {
  console.error('No query string provided. Use --help for usage information.');
  process.exit(1);
}

// TODO: Implement direct Qdrant vector query (no grep, no ranking)
console.log('Query memory: implementation pending');