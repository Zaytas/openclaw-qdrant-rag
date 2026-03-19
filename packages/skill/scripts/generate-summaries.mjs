#!/usr/bin/env node

function showHelp() {
  console.log(`Usage: generate-summaries [options]

Options:
  --batch <N>     Process N items in a batch
  --dry-run       Perform a dry run with no changes
  --help          Show this help message
`);
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  showHelp();
  process.exit(0);
}

// TODO: Generate LLM summaries for session transcripts
console.log('Generate summaries: implementation pending');