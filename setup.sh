#!/bin/bash

set -euo pipefail

# Define color codes
green='\033[0;32m'
yellow='\033[0;33m'
red='\033[0;31m'
reset='\033[0m'

color_echo() {
  local color="$1"; shift
  echo -e "${color}$@${reset}"
}

# Step 1: Check prerequisites
color_echo "$green" "Step 1: Checking prerequisites..."

if ! command -v node &> /dev/null; then
  color_echo "$red" "✗ Node.js is not installed. Please install Node.js >= 18. Aborting."
  exit 1
fi

if ! command -v npm &> /dev/null; then
  color_echo "$red" "✗ npm is not installed. Aborting."
  exit 1
fi

if ! command -v docker &> /dev/null; then
  color_echo "$yellow" "⚠ Docker is not installed. Optional step to start Qdrant will be skipped."
fi

NODE_VERSION=$(node -v | grep -oE "[0-9]+" | head -1)
if [ "$NODE_VERSION" -lt 18 ]; then
  color_echo "$red" "✗ Node.js version must be >= 18. Found: $(node -v). Aborting."
  exit 1
fi

color_echo "$green" "✓ Prerequisites check passed."

# Step 2: Install npm dependencies
color_echo "$green" "Step 2: Installing npm dependencies..."
npm install

color_echo "$green" "✓ npm dependencies installed."

# Step 3: Build TypeScript packages
color_echo "$green" "Step 3: Building TypeScript packages..."
ROOT_DIR=$(pwd)
RAG_CORE_SRC="$ROOT_DIR/packages/rag-core/src/index.ts"
RAG_CORE_DIST="$ROOT_DIR/packages/rag-core/dist/index.js"

if [ ! -f "$RAG_CORE_DIST" ] || [ "$RAG_CORE_SRC" -nt "$RAG_CORE_DIST" ]; then
  color_echo "$yellow" "⚠ Compiling TypeScript packages as dist/ is stale or missing."
  npm install typescript --no-save
  npx tsc -p packages/rag-core/tsconfig.json
  npx tsc -p packages/plugin/tsconfig.json
  color_echo "$green" "✓ TypeScript packages built."
else
  color_echo "$green" "✓ TypeScript packages are up-to-date. Skipping build."
fi

# Step 4: Create config file
color_echo "$green" "Step 4: Ensuring configuration file exists..."
CONFIG_SOURCE="$ROOT_DIR/packages/skill/qdrant-rag.config.example.json"
OPENCLAW_HOME=${OPENCLAW_HOME:-~/.openclaw}
CONFIG_TARGET="$OPENCLAW_HOME/workspace/skills/qdrant-rag/qdrant-rag.config.json"

mkdir -p "$(dirname "$CONFIG_TARGET")"

if [ ! -f "$CONFIG_TARGET" ]; then
  cp "$CONFIG_SOURCE" "$CONFIG_TARGET"
  color_echo "$yellow" "⚠ Configuration file created at $CONFIG_TARGET"

  if [ -z "${GEMINI_API_KEY:-}" ]; then
    color_echo "$yellow" "⚠ GEMINI_API_KEY is not set. Please export it in your environment."
  fi
else
  color_echo "$green" "✓ Configuration file already exists. Skipping."
fi

# Step 5: Register the plugin
color_echo "$green" "Step 5: Guiding plugin registration..."
OPENCLAW_CONFIG="$OPENCLAW_HOME/openclaw.json"

if [ ! -f "$OPENCLAW_CONFIG" ]; then
  color_echo "$red" "✗ OpenClaw configuration file not found at $OPENCLAW_CONFIG. Please ensure OpenClaw is installed and initialized."
else
  PLUGIN_SNIPPET=$(cat << 'EOM'
{
  "id": "qdrant-rag",
  "path": "<path-to-repo>/packages/plugin"
}
EOM
  )
  color_echo "$yellow" "⚠ Add the following to the 'plugins' array in $OPENCLAW_CONFIG:"
  echo "$PLUGIN_SNIPPET"
  color_echo "$yellow" "  Replace <path-to-repo> with the absolute path to this cloned repository."
  color_echo "$yellow" "  Example: $(pwd)/packages/plugin"
  color_echo "$yellow" "  After editing, restart the OpenClaw gateway for the plugin to load."
fi

# Step 6: Optional - Start Qdrant via Docker
color_echo "$green" "Step 6: Optional Qdrant setup..."
if command -v docker &> /dev/null; then
  read -p "Do you want to start Qdrant via Docker (y/n)? " START_QDRANT
  if [[ "$START_QDRANT" =~ ^[Yy]$ ]]; then
    docker compose -f docker/docker-compose.qdrant.yml up -d
    color_echo "$green" "✓ Qdrant started."
  else
    color_echo "$yellow" "⚠ Qdrant start skipped."
  fi
else
  color_echo "$yellow" "⚠ Docker not found. Skipping Qdrant setup."
fi

# Step 7: Smoke test
color_echo "$green" "Step 7: Running smoke tests..."
if command -v curl &> /dev/null; then
  QDRANT_HEALTH=$(curl -s http://localhost:6333/healthz || true)
  if [ "$QDRANT_HEALTH" == "{\"status\":\"ok\"}" ]; then
    color_echo "$green" "✓ Qdrant is healthy."
  else
    color_echo "$yellow" "⚠ Qdrant health check failed. Ensure it's running and accessible."
  fi

  MEMORY_COLLECTION_EXISTS=$(curl -s http://localhost:6333/collections | grep -q 'memory' && echo 'yes' || echo 'no')
  if [ "$MEMORY_COLLECTION_EXISTS" == "no" ]; then
    color_echo "$yellow" "⚠ memory collection not found. Creating it now..."
    curl -s -X PUT http://localhost:6333/collections/memory \
      -H 'Content-Type: application/json' \
      -d '{
        "vectors": {
          "size": 3072,
          "distance": "Cosine"
        }
      }' > /dev/null 2>&1

    # Verify creation
    VERIFY=$(curl -s http://localhost:6333/collections | grep -q 'memory' && echo 'yes' || echo 'no')
    if [ "$VERIFY" == "yes" ]; then
      color_echo "$green" "✓ memory collection created (3072 dimensions, cosine distance)."
    else
      color_echo "$red" "✗ Failed to create memory collection. Check Qdrant logs."
    fi
  else
    color_echo "$green" "✓ memory collection exists."
  fi
else
  color_echo "$yellow" "⚠ curl not installed. Skipping Qdrant smoke tests."
fi

# Step 8: Print summary
color_echo "$green" "Step 8: Summary..."
color_echo "$green" "✓ Setup completed successfully. Please review any warnings above."
color_echo "$yellow" "⚠ Ensure that GEMINI_API_KEY is set for the skill to function properly."
color_echo "$yellow" "⚠ If Qdrant was not started, launch it manually or rerun this script."

exit 0