#!/usr/bin/env node

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