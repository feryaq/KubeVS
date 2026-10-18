import type { PagedRecipeSnapshots, RecipeSnapshotEntry } from '@kubevs/protocol';

/** Shared by the MCP and graph UI. Never return a silently partial catalog. */
export async function fetchRecipeSnapshot(
  fetchPage: (offset: number, limit: number, revision?: string) => Promise<PagedRecipeSnapshots>,
  progress?: (loaded: number, total: number, added: number) => void,
): Promise<RecipeSnapshotEntry[]> {
  const entries: RecipeSnapshotEntry[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let bytes = 0;
  let revision: string | undefined;
  for (;;) {
    const offset = entries.length;
    const page = await fetchPage(offset, 500, revision);
    if (entries.length > 0 && page.revision !== revision)
      throw new Error('Recipe catalog revision changed while loading. Retry after reload.');
    revision = page.revision;
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.offset !== offset)
      throw new Error('Connector returned invalid recipe pagination.');
    if (total !== undefined && total !== page.total)
      throw new Error('Recipe catalog changed while loading. Retry after reload has finished.');
    total = page.total;
    if (total > 250_000)
      throw new Error(
        'Recipe snapshot exceeds the 250000-entry safety limit; no partial graph was built.',
      );
    if (page.entries.length > 500 || offset + page.entries.length > total)
      throw new Error('Connector returned an inconsistent recipe page.');
    bytes += Buffer.byteLength(JSON.stringify(page.entries), 'utf8');
    if (bytes > 256 * 1024 * 1024)
      throw new Error('Recipe snapshot exceeds 256 MiB; no partial graph was built.');
    for (const entry of page.entries) {
      if (seen.has(entry.id))
        throw new Error('Duplicate recipe in snapshot. Retry after reload has finished.');
      seen.add(entry.id);
      entries.push(entry);
    }
    progress?.(entries.length, total, page.entries.length);
    if (page.hasMore !== entries.length < total || (page.hasMore && entries.length === offset))
      throw new Error('Connector returned a non-advancing or incomplete recipe snapshot.');
    if (!page.hasMore) return entries;
  }
}
