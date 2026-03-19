#!/usr/bin/env node

function showHelp() {
  console.log(`Usage: validate-summaries [options] <file-paths...>

Options:
  --all           Validate all summaries
  --help          Show this help message
`);
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  showHelp();
  process.exit(0);
}

if (!args.includes('--all') && args.length === 0) {
  console.error('No file paths provided. Use --help for usage information.');
  process.exit(1);
}

// TODO: Validate summary JSON files have required fields
console.log('Validate summaries: implementation pending');