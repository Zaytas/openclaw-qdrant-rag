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

The plugin folder name must match the `"id"` field in the plugin's `openclaw.plugin.json`.

**Example:** If the manifest declares `"id": "qdrant-rag"`, the folder must be named `qdrant-rag` — not `qdrant_rag`, not `qdrantRag`, not `my-rag-plugin`.

```
plugins/
  qdrant-rag/               ← folder name must match manifest id
    openclaw.plugin.json     ← { "id": "qdrant-rag", ... }
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
cp -rL /path/to/repo/node_modules/@openclaw-qdrant-rag/core \
      plugins/qdrant-rag/node_modules/@openclaw-qdrant-rag/core
```

> **Note:** The `-L` flag dereferences symlinks. This is important because workspace-linked packages (e.g. from `npm link` or pnpm workspaces) are often symlinks — without `-L`, you'd copy the symlink itself rather than the actual files.

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

---

## 5. Plugin Loads But Recall Never Happens

The plugin uses lazy initialization — it registers at startup but only imports rag-core on the first qualifying message. If that import fails, it fails silently (fail-open design).

**Symptoms:** Plugin shows registered in logs, no errors at startup, but no RAG context injected.

**Causes:**
- `@openclaw-qdrant-rag/core` not resolvable from installed location
- Qdrant not reachable from the gateway container
- `GEMINI_API_KEY` not set in gateway's environment (not just your shell)
- Pre-gate filtering all messages (minMessageLength, skipPatterns)

**Diagnosis:**
- Enable debug: set `debug.logQueries`, `debug.logInjections`, `debug.logSkips` to true
- Check logs for `[qdrant-rag]` entries after sending a message
- Test rag-core: `node -e "require('/path/to/plugins/qdrant-rag/node_modules/@openclaw-qdrant-rag/core/dist/index.js')"`
- Test Qdrant: `curl http://your-qdrant:6333/healthz`

---

## Start Fresh (Nuclear Option)

When everything is broken:

1. Remove qdrant-rag from `openclaw.json`:
   - Remove `"qdrant-rag"` from `plugins.allow`
   - Remove `plugins.entries.qdrant-rag`
2. Delete plugin: `rm -rf ~/.openclaw/workspace/plugins/qdrant-rag`
3. Delete skill: `rm -rf ~/.openclaw/workspace/skills/qdrant-rag`
4. Restart container/gateway — verify clean start (no qdrant-rag warnings)
5. Reinstall from scratch: `cd openclaw-qdrant-rag && ./setup.sh`
