/**
 * cleanup.mjs — Stale point cleanup for Qdrant indexers.
 *
 * Scrolls the collection for all points matching a filter,
 * compares against the set of IDs upserted in the current run,
 * and deletes orphaned/stale points.
 */

/**
 * Scroll all point IDs matching a filter from Qdrant.
 *
 * @param {string} qdrantUrl - Qdrant base URL (e.g. http://host:6333)
 * @param {string} collection - Collection name
 * @param {object} filter - Qdrant filter object
 * @returns {Promise<string[]>} All matching point IDs
 */
async function scrollAllIds(qdrantUrl, collection, filter) {
  const ids = [];
  let offset = null;

  while (true) {
    const body = {
      filter,
      limit: 250,
      with_payload: false,
      with_vector: false,
    };
    if (offset !== null) body.offset = offset;

    const res = await fetch(`${qdrantUrl}/collections/${collection}/points/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Qdrant scroll failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const points = data.result?.points ?? [];
    for (const p of points) {
      ids.push(p.id);
    }

    offset = data.result?.next_page_offset ?? null;
    if (offset === null || points.length === 0) break;
  }

  return ids;
}

/**
 * Delete points by IDs from Qdrant.
 *
 * @param {string} qdrantUrl
 * @param {string} collection
 * @param {string[]} ids - Point IDs to delete
 */
async function deletePoints(qdrantUrl, collection, ids) {
  if (ids.length === 0) return;

  // Batch deletes in groups of 500
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const res = await fetch(`${qdrantUrl}/collections/${collection}/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: batch }),
    });

    if (!res.ok) {
      throw new Error(`Qdrant delete failed (${res.status}): ${await res.text()}`);
    }
  }
}

/**
 * Run stale point cleanup.
 *
 * @param {object} opts
 * @param {string} opts.qdrantUrl - Qdrant base URL
 * @param {string} opts.collection - Collection name
 * @param {object} opts.filter - Qdrant filter to scope points (e.g. sourceType match)
 * @param {Set<string>} opts.upsertedIds - IDs upserted during this run
 * @param {boolean} opts.dryRun - If true, only log what would be deleted
 * @param {string} opts.label - Label for log messages (e.g. "file" or "transcript")
 * @returns {Promise<{total: number, stale: number, deleted: number}>}
 */
export async function cleanupStalePoints({ qdrantUrl, collection, filter, upsertedIds, dryRun, label }) {
  console.log(`\n=== Cleanup: ${label} points ===`);

  const existingIds = await scrollAllIds(qdrantUrl, collection, filter);
  console.log(`  Points in collection (${label}): ${existingIds.length}`);
  console.log(`  Points upserted this run: ${upsertedIds.size}`);

  const staleIds = existingIds.filter((id) => !upsertedIds.has(id));
  console.log(`  Stale points to remove: ${staleIds.length}`);

  if (staleIds.length === 0) {
    console.log('  Nothing to clean up.');
    return { total: existingIds.length, stale: 0, deleted: 0 };
  }

  if (dryRun) {
    console.log('  [dry-run] Would delete the following point IDs:');
    for (const id of staleIds.slice(0, 20)) {
      console.log(`    - ${id}`);
    }
    if (staleIds.length > 20) {
      console.log(`    ... and ${staleIds.length - 20} more`);
    }
    return { total: existingIds.length, stale: staleIds.length, deleted: 0 };
  }

  await deletePoints(qdrantUrl, collection, staleIds);
  console.log(`  ✓ Deleted ${staleIds.length} stale point(s)`);

  return { total: existingIds.length, stale: staleIds.length, deleted: staleIds.length };
}
