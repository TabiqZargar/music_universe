import type { ActiveFilters, GraphNode, MusicGraph } from "@/types/domain";

export const DEFAULT_FILTERS: ActiveFilters = {
  entityKinds: { genre: true, artist: true, album: true, track: true },
  genreIds: null,
  minListeningMs: 0,
  rangeStartMs: null,
  rangeEndMs: null,
};

export interface FilterResult {
  graph: MusicGraph;
  /** Node ids currently visible after filters (scene renders these). */
  visibleIds: Set<string>;
  visibleStats: {
    totalListeningMs: number;
    uniqueArtists: number;
    uniqueTracks: number;
    uniqueAlbums: number;
    uniqueGenres: number;
    topArtists: { id: string; name: string; listeningMs: number }[];
    topTracks: { id: string; name: string; artistName: string; listeningMs: number }[];
  };
  artistNameById: Map<string, string>;
}

/**
 * Compute the visible node set for the scene. Statistics are recomputed from
 * the same visible nodes so the scene and the overlay never disagree.
 *
 * Every node is evaluated independently against kind, genre and minimum
 * listening-time rules — hiding one layer (e.g. albums) never cascades into
 * hiding another (e.g. tracks).
 */
export function applyFilters(
  graph: MusicGraph,
  filters: ActiveFilters,
): FilterResult {
  const genreFilter = filters.genreIds;

  const isVisible = (node: GraphNode): boolean => {
    if (!filters.entityKinds[node.kind]) return false;
    if (
      filters.minListeningMs > 0 &&
      node.kind !== "genre" &&
      node.listeningMs < filters.minListeningMs
    ) {
      return false;
    }
    if (genreFilter && genreFilter.length > 0) {
      if (node.kind === "genre") return genreFilter.includes(node.id);
      if (!node.genreIds.some((g) => genreFilter.includes(g))) return false;
    }
    return true;
  };

  const visibleIds = new Set<string>();
  for (const node of graph.nodes) {
    if (isVisible(node)) visibleIds.add(node.id);
  }

  const visibleNodes = graph.nodes.filter((n) => visibleIds.has(n.id));
  const artistNameById = new Map<string, string>();
  const tracks = visibleNodes.filter((n) => n.kind === "track");
  const artists = visibleNodes.filter((n) => n.kind === "artist");
  for (const artist of artists) artistNameById.set(artist.id, artist.label);

  const topArtists = [...artists]
    .sort((a, b) => b.listeningMs - a.listeningMs || a.label.localeCompare(b.label))
    .slice(0, 5)
    .map((n) => ({ id: n.id, name: n.label, listeningMs: n.listeningMs }));

  const topTracks = [...tracks]
    .sort((a, b) => b.listeningMs - a.listeningMs || a.label.localeCompare(b.label))
    .slice(0, 5)
    .map((n) => ({
      id: n.id,
      name: n.label,
      artistName: n.meta.artistNames?.[0] ?? "",
      listeningMs: n.listeningMs,
    }));

  return {
    graph,
    visibleIds,
    artistNameById,
    visibleStats: {
      // Track nodes are each counted once, so this is the honest in-view total.
      totalListeningMs: tracks.reduce((sum, n) => sum + n.listeningMs, 0),
      uniqueArtists: artists.length,
      uniqueTracks: tracks.length,
      uniqueAlbums: visibleNodes.filter((n) => n.kind === "album").length,
      uniqueGenres: visibleNodes.filter((n) => n.kind === "genre").length,
      topArtists,
      topTracks,
    },
  };
}
