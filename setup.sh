#!/bin/bash

set -euo pipefail

# Define color codes (degrade gracefully if not supported)
if [ -t 1 ] && command -v tput &> /dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  green='\033[0;32m'
  yellow='\033[0;33m'
  red='\033[0;31m'
  reset='\033[0m'
else
  green='' yellow='' red='' reset=''
fi

color_echo() {
  local color="$1"; shift
  echo -e "${color}$*${reset}"
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

# Step 3: Build TypeScript packages (if dist/ is stale or missing)
color_echo "$green" "Step 3: Building TypeScript packages..."
ROOT_DIR=$(pwd)
RAG_CORE_SRC="$ROOT_DIR/packages/rag-core/src/index.ts"
RAG_CORE_DIST="$ROOT_DIR/packages/rag-core/dist/index.js"
PLUGIN_SRC_TS="$ROOT_DIR/packages/plugin/src/index.ts"
PLUGIN_DIST_JS="$ROOT_DIR/packages/plugin/dist/index.js"

if [ ! -f "$RAG_CORE_DIST" ] || [ "$RAG_CORE_SRC" -nt "$RAG_CORE_DIST" ] \
   || [ ! -f "$PLUGIN_DIST_JS" ] || [ "$PLUGIN_SRC_TS" -nt "$PLUGIN_DIST_JS" ]; then
  color_echo "$yellow" "⚠ Compiling TypeScript packages as dist/ is stale or missing."
  npm install typescript@latest --save-dev
  npx tsc -p packages/rag-core/tsconfig.json
  npx tsc -p packages/plugin/tsconfig.json
  color_echo "$green" "✓ TypeScript packages built."
else
  color_echo "$green" "✓ TypeScript packages are up-to-date. Skipping build."
fi

# Step 4: Create config file
color_echo "$green" "Step 4: Ensuring configuration file exists..."
CONFIG_SOURCE="$ROOT_DIR/packages/skill/qdrant-rag.config.example.json"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
CONFIG_TARGET="$OPENCLAW_HOME/workspace/skills/qdrant-rag/qdrant-rag.config.json"

mkdir -p "$(dirname "$CONFIG_TARGET")"

if [ ! -f "$CONFIG_TARGET" ]; then
  cp "$CONFIG_SOURCE" "$CONFIG_TARGET"
  color_echo "$yellow" "⚠ Configuration file created at $CONFIG_TARGET"

  if [ -z "${GEMINI_API_KEY:-}" ]; then
    color_echo "$yellow" "⚠ GEMINI_API_KEY is not set. Please export it in your environment or add it to the config file."
  fi
else
  color_echo "$green" "✓ Configuration file already exists. Skipping."
fi

# Step 5: Install plugin
# NOTE: We use cp -r, NOT symlinks. OpenClaw's plugin scanner uses fs.readdirSync
# with withFileTypes:true, which reports symlinks as isDirectory()=false. Symlinked
# plugin directories are silently skipped during discovery.
color_echo "$green" "Step 5: Installing plugin to OpenClaw workspace..."
PLUGIN_SRC="$ROOT_DIR/packages/plugin"
PLUGIN_DEST="$OPENCLAW_HOME/workspace/plugins/qdrant-rag"

if [ -d "$PLUGIN_DEST" ]; then
  BACKUP="$PLUGIN_DEST.bak.$(date +%s)"
  color_echo "$yellow" "⚠ Existing plugin directory found. Backing up to $BACKUP"
  mv "$PLUGIN_DEST" "$BACKUP"
fi

mkdir -p "$PLUGIN_DEST"
cp -r "$PLUGIN_SRC"/. "$PLUGIN_DEST"/

# Copy the shared dependency into the plugin's node_modules for dependency resolution.
# Use -rL to dereference symlinks — npm workspaces create symlinks in node_modules
# that won't resolve once copied outside the repo tree.
mkdir -p "$PLUGIN_DEST/node_modules/@openclaw-qdrant-rag"
cp -rL "$ROOT_DIR/node_modules/@openclaw-qdrant-rag"/. "$PLUGIN_DEST/node_modules/@openclaw-qdrant-rag"/

# Verify the plugin loads
if node -e "require('$PLUGIN_DEST')" 2>/dev/null; then
  color_echo "$green" "✓ Plugin installed and verified at $PLUGIN_DEST"
else
  color_echo "$red" "✗ Plugin installed but failed to load via require(). Check build output."
fi

# Verify rag-core is resolvable from the installed plugin
if node -e "require('$PLUGIN_DEST/node_modules/@openclaw-qdrant-rag/core/dist/index.js'); console.log('rag-core: OK')" 2>/dev/null; then
  color_echo "$green" "✓ rag-core dependency verified inside installed plugin."
else
  color_echo "$red" "✗ rag-core not resolvable from installed plugin. Symlinks may not have been dereferenced."
fi

# Print the openclaw.json config snippet
OPENCLAW_CONFIG="$OPENCLAW_HOME/openclaw.json"
color_echo "$yellow" "⚠ Add 'qdrant-rag' to plugins.allow and plugins.entries in $OPENCLAW_CONFIG:"
cat << EOM

  {
    "plugins": {
      "allow": ["...", "qdrant-rag"],
      "entries": {
        "qdrant-rag": {
          "enabled": true,
          "config": {
            "configPath": "$CONFIG_TARGET"
          }
        }
      }
    }
  }

EOM
color_echo "$yellow" "  The plugin directory is auto-discovered from plugins.load.paths (workspace/plugins/)."

# Step 5b: Install skill
color_echo "$green" "Step 5b: Installing skill to OpenClaw workspace..."
SKILL_SRC="$ROOT_DIR/packages/skill"
SKILL_DEST="$OPENCLAW_HOME/workspace/skills/qdrant-rag"

if [ -d "$SKILL_DEST" ]; then
  # Only back up if it's not already the config target from Step 4
  # (Step 4 may have created the directory for the config file)
  EXISTING_FILES=$(find "$SKILL_DEST" -maxdepth 1 -not -name "qdrant-rag.config.json" -not -name "." | head -1)
  if [ -n "$EXISTING_FILES" ]; then
    BACKUP="$SKILL_DEST.bak.$(date +%s)"
    color_echo "$yellow" "⚠ Existing skill directory found. Backing up to $BACKUP"
    # Preserve the config file if it exists
    if [ -f "$SKILL_DEST/qdrant-rag.config.json" ]; then
      SAVED_CONFIG=$(mktemp)
      cp "$SKILL_DEST/qdrant-rag.config.json" "$SAVED_CONFIG"
    fi
    mv "$SKILL_DEST" "$BACKUP"
    mkdir -p "$SKILL_DEST"
    if [ -n "${SAVED_CONFIG:-}" ] && [ -f "$SAVED_CONFIG" ]; then
      mv "$SAVED_CONFIG" "$SKILL_DEST/qdrant-rag.config.json"
    fi
  fi
fi

# Copy skill files (preserve any existing config file)
if [ -f "$SKILL_DEST/qdrant-rag.config.json" ]; then
  SAVED_CONFIG=$(mktemp)
  cp "$SKILL_DEST/qdrant-rag.config.json" "$SAVED_CONFIG"
fi

cp -r "$SKILL_SRC"/. "$SKILL_DEST"/

if [ -n "${SAVED_CONFIG:-}" ] && [ -f "${SAVED_CONFIG:-}" ]; then
  mv "$SAVED_CONFIG" "$SKILL_DEST/qdrant-rag.config.json"
fi

# Copy the shared dependency into the skill's node_modules for dependency resolution.
# Same approach as the plugin — dereference workspace symlinks with -rL.
mkdir -p "$SKILL_DEST/node_modules/@openclaw-qdrant-rag"
cp -rL "$ROOT_DIR/node_modules/@openclaw-qdrant-rag"/. "$SKILL_DEST/node_modules/@openclaw-qdrant-rag"/

# Verify rag-core is resolvable from the installed skill
if node -e "import('$SKILL_DEST/lib/core.mjs').then(() => console.log('skill core: OK'))" 2>/dev/null; then
  color_echo "$green" "✓ rag-core dependency verified inside installed skill."
else
  color_echo "$red" "✗ rag-core not resolvable from installed skill. Scripts will not work."
fi

color_echo "$green" "✓ Skill installed at $SKILL_DEST"

# Step 6: Optional - Start Qdrant via Docker
color_echo "$green" "Step 6: Optional Qdrant setup..."
if command -v docker &> /dev/null; then
  START_QDRANT=n
  if [ -t 0 ]; then
    read -r -p "Do you want to start Qdrant via Docker? (y/n) " START_QDRANT
  else
    color_echo "$yellow" "⚠ Non-interactive shell detected. Skipping Qdrant Docker prompt."
  fi
  if [[ "$START_QDRANT" =~ ^[Yy]$ ]]; then
    docker compose -f docker/docker-compose.qdrant.yml up -d
    color_echo "$green" "✓ Qdrant started."
  else
    color_echo "$yellow" "⚠ Qdrant start skipped. Run manually: docker compose -f docker/docker-compose.qdrant.yml up -d"
  fi
else
  color_echo "$yellow" "⚠ Docker not found. Skipping Qdrant setup."
  color_echo "$yellow" "  Install Docker and run: docker compose -f docker/docker-compose.qdrant.yml up -d"
fi

# Step 7: Smoke test
color_echo "$green" "Step 7: Running smoke tests..."
if command -v curl &> /dev/null; then
  # Health check
  if curl -fsS http://localhost:6333/healthz > /dev/null 2>&1; then
    color_echo "$green" "✓ Qdrant is healthy."

    # Collection check
    MEMORY_COLLECTION_EXISTS=$(curl -s http://localhost:6333/collections | grep -q 'memory' && echo 'yes' || echo 'no')
    if [ "$MEMORY_COLLECTION_EXISTS" == "no" ]; then
      color_echo "$yellow" "⚠ memory collection not found. Creating it now..."
      if curl -fsS -X PUT http://localhost:6333/collections/memory \
        -H 'Content-Type: application/json' \
        -d '{"vectors":{"size":3072,"distance":"Cosine"}}' > /dev/null 2>&1; then
        color_echo "$green" "✓ memory collection created (3072 dimensions, cosine distance)."
      else
        color_echo "$red" "✗ Failed to create memory collection. Check Qdrant logs."
      fi
    else
      color_echo "$green" "✓ memory collection exists."
    fi
  else
    color_echo "$yellow" "⚠ Qdrant is not reachable at http://localhost:6333. Start it first, then rerun this script."
  fi
else
  color_echo "$yellow" "⚠ curl not installed. Skipping Qdrant smoke tests."
fi

# Step 8: Print summary
echo ""
color_echo "$green" "═══════════════════════════════════════"
color_echo "$green" "  Setup complete. Review any warnings above."
color_echo "$green" "═══════════════════════════════════════"
echo ""
color_echo "$yellow" "Next steps:"
color_echo "$yellow" "  1. Ensure GEMINI_API_KEY is set in your environment"
color_echo "$yellow" "  2. Add the plugin entry to your openclaw.json (see Step 5 output)"
color_echo "$yellow" "  3. Start Qdrant if not already running"
color_echo "$yellow" "  4. Restart the OpenClaw gateway"
color_echo "$yellow" "  5. Run: node packages/skill/scripts/index-memory.mjs --help"

exit 0
