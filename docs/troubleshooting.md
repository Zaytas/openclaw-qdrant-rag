# Troubleshooting

Real issues encountered during plugin installation and migration — and how to fix them.

---

## 1. "plugin not found: qdrant-rag"

This error means OpenClaw's plugin scanner didn't detect the plugin at startup. Three common causes:

### The plugin directory is a symlink

OpenClaw scans `plugins/` using `fs.readdirSync` with `withFileTypes: true`. The resulting `Dirent.isDirectory()` returns **false** for symlinks — even symlinks pointing to directories. The scanner silently skips it.

**Fix:** Copy the plugin directory instead of symlinking it.

```bash
# Wrong — scanner won't see it
ln -s /path/to/source plugins/qdrant-rag

# Right
cp -r /path/to/source plugins/qdrant-rag
```

### The plugin entry point fails to load

The directory exists but the main module throws on import (usually a missing dependency). You can test this directly:

```bash
node -e "require('/path/to/plugins/qdrant-rag/dist/index.js')"
```

If it throws, fix the dependency issue (see [issue #3](#3-plugin-loads-but-openclaw-qdrant-ragcore-not-found) below) and try again.

### Config references the plugin before a restart

Plugin discovery happens **once at startup**. If you add a plugin reference to your config via `config.patch`, it validates against the currently-loaded plugin list — which doesn't include your new plugin yet.

**Fix:** Write the config directly to `openclaw.json` (bypassing live validation), then restart OpenClaw.

```bash
# Edit openclaw.json directly to add plugin config
# Then restart
openclaw gateway restart
```

---

## 2. "plugin id mismatch (manifest uses X, entry hints Y)"

The plugin folder name must match the `"id"` field in the plugin's `manifest.json`.

**Example:** If the manifest declares `"id": "qdrant-rag"`, the folder must be named `qdrant-rag` — not `qdrant_rag`, not `qdrantRag`, not `my-rag-plugin`.

```
plugins/
  qdrant-rag/          ← folder name must match manifest id
    manifest.json      ← { "id": "qdrant-rag", ... }
    dist/
      index.js
```

**Fix:** Rename the folder to match the manifest id exactly.

---

## 3. Plugin loads but `@openclaw-qdrant-rag/core` not found

When you copy the plugin out of the monorepo, Node can no longer resolve workspace dependencies that lived in the repo root's `node_modules/`.

**Fix:** Copy the workspace package into the plugin's own `node_modules/`:

```bash
mkdir -p plugins/qdrant-rag/node_modules/@openclaw-qdrant-rag
cp -r /path/to/repo/node_modules/@openclaw-qdrant-rag/core \
      plugins/qdrant-rag/node_modules/@openclaw-qdrant-rag/core
```

Verify it resolves:

```bash
node -e "require('/path/to/plugins/qdrant-rag/dist/index.js')"
```

---

## 4. Container won't start after adding plugin config

OpenClaw validates the full config at startup. If your config references a plugin (in `plugins.allow` or `plugins.entries`) but the plugin directory doesn't exist or fails to load, validation fails and the container won't start.

**Fix:** Order of operations matters:

1. **Install the plugin files first** — copy directory, dependencies, everything
2. **Verify the plugin loads** — `node -e "require(...)"` 
3. **Add the plugin config** to `openclaw.json`
4. **Restart** — `openclaw gateway restart`

If you're already stuck in a crash loop, remove the plugin references from `openclaw.json`, restart, fix the plugin installation, then re-add the config.
