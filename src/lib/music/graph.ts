import type {
  DataSourceMetadata,
  GraphEdge,
  GraphNode,
  MusicGraph,
} from "@/types/domain";
import {
  aggregateRecords,
  albumKey,
  buildGenres,
  genreId,
  type ArtistEnrichment,
} from "./aggregate";
import { normalizeName, seededRandom } from "./keys";
import { normalizedRadius, radiusFor, type RadiusKind } from "./sizing";
import type { Album, Artist, ListeningRecord, Track } from "@/types/domain";

export interface ApiSignalArtist {
  id: string;
  name: string;
  genres: string[];
  /** 1-based position in the merged Spotify top ranking (sizing fallback). */
  rank: number;
  /** Present only when Spotify still returns it (removed for dev-mode apps). */
  popularity?: number;
}

export interface ApiSignalTrack {
  id: string;
  name: string;
  artistNames: string[];
  albumName: string | null;
  artworkUrl: string | null;
  rank: number;
  popularity?: number;
}

export interface BuildGraphInput {
  records: ListeningRecord[];
  enrichment?: ArtistEnrichment;
  source: DataSourceMetadata;
  apiArtists?: ApiSignalArtist[];
  apiTracks?: ApiSignalTrack[];
}

const PHI = Math.PI * (3 - Math.sqrt(5));

function ringPosition(index: number, count: number, radius: number): [number, number, number] {
  // Spherical Fibonacci lattice: deterministic, well-spread regions in 3D.
  const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
  const rAtY = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = PHI * index;
  return [Math.cos(theta) * rAtY * radius, y * radius, Math.sin(theta) * rAtY * radius];
}

/**
 * Deterministic 3D layout: genre regions on a shell around the origin,
 * artists distributed inside their regions, albums near artists, tracks near
 * albums. All jitter comes from `seededRandom(stableId)`, so the same dataset
 * always produces the same universe.
 */
export function buildMusicGraph(input: BuildGraphInput): MusicGraph {
  const { records, enrichment, source } = input;

  const aggregates = aggregateRecords(records, enrichment);
  const useSignals = source.kind === "spotify-api";
  const { artists: allArtists, albums: allAlbums, tracks: allTracks } = useSignals
    ? synthesizeSignalEntities(aggregates, input)
    : {
        artists: aggregates.artists,
        albums: aggregates.albums,
        tracks: aggregates.tracks,
      };
  const { genres, artistsWithGenres } = buildGenres(allArtists, allTracks);

  const stats = { ...aggregates.stats, uniqueGenres: genres.length };

  const maxArtistMs = Math.max(0, ...artistsWithGenres.map((a) => a.listeningMs));
  const maxTrackMs = Math.max(0, ...allTracks.map((t) => t.listeningMs));
  const maxAlbumMs = Math.max(0, ...allAlbums.map((a) => a.listeningMs));
  const maxGenreMs = Math.max(0, ...genres.map((g) => g.listeningMs));
  const apiArtists = input.apiArtists ?? [];
  const apiTracks = input.apiTracks ?? [];
  // Spotify removed `popularity` for dev-mode apps (Feb 2026 migration); fall
  // back to ranking position so API-only nodes still vary in size. When
  // popularity is present it wins, keeping extended-quota apps unchanged.
  const artistByPopularity = apiArtists.some((a) => (a.popularity ?? 0) > 0);
  const trackByPopularity = apiTracks.some((t) => (t.popularity ?? 0) > 0);
  const artistScore = (a: ApiSignalArtist) =>
    artistByPopularity ? a.popularity ?? 0 : Math.max(1, apiArtists.length - a.rank + 1);
  const trackScore = (t: ApiSignalTrack) =>
    trackByPopularity ? t.popularity ?? 0 : Math.max(1, apiTracks.length - t.rank + 1);
  const maxApiArtistScore = Math.max(1, ...apiArtists.map(artistScore));
  const maxApiTrackScore = Math.max(1, ...apiTracks.map(trackScore));

  const hasMeasured = source.kind !== "spotify-api";

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // --- Genre regions ---
  // Positions are keyed by stable ids (never listening order), so the same
  // dataset always renders in the same arrangement; only sizes track data.
  const shellRadius = 46;
  const sortedGenres = [...genres].sort((a, b) => a.id.localeCompare(b.id));
  const artistGenre = new Map<string, string[]>();
  for (const g of sortedGenres) {
    for (const artistId of g.artistIds) {
      const list = artistGenre.get(artistId) ?? [];
      list.push(g.id);
      artistGenre.set(artistId, list);
    }
  }

  sortedGenres.forEach((genre, i) => {
    const center = ringPosition(i, sortedGenres.length, shellRadius);
    const rand = seededRandom(`genre:${genre.id}`);
    const wobble: [number, number, number] = [
      (rand() - 0.5) * 6,
      (rand() - 0.5) * 6,
      (rand() - 0.5) * 6,
    ];
    const position: [number, number, number] = [
      center[0] + wobble[0],
      center[1] + wobble[1],
      center[2] + wobble[2],
    ];
    nodes.push({
      id: genre.id,
      kind: "genre",
      label: genre.name,
      listeningMs: genre.listeningMs,
      normRadius: normalizedRadius(genre.listeningMs, maxGenreMs),
      position,
      parentIds: [],
      childIds: genre.artistIds,
      genreIds: [genre.id],
      meta: {
        artistCount: genre.artistIds.length,
        trackCount: countTracksForGenre(genre.artistIds, artistsWithGenres),
        genres: [genre.name],
      },
    });
  });

  const genreNodeById = new Map(nodes.map((n) => [n.id, n]));

  // --- Artists inside their primary (first) genre region ---
  // Placement iterates in stable id order so positions never depend on the
  // current listening ranking; ranks are assigned in a separate pass below.
  const placementArtists = [...artistsWithGenres].sort((a, b) => a.id.localeCompare(b.id));
  const genreMembers = new Map<string, number>();
  for (const artist of placementArtists) {
    const genreIds = artistGenre.get(artist.id) ?? [genreId("Unclassified")];
    const primary = genreIds[0];
    const genreNode = genreNodeById.get(primary);
    if (!genreNode) continue;
    // Children spread proportionally to the region's listening-driven radius
    // (with margin) while keeping their angles fixed — regions breathe with
    // the data, the arrangement never rearranges.
    const regionRadius =
      radiusFor("genre", genreNode.listeningMs, maxGenreMs) + 3.5;
    const count = (genreMembers.get(primary) ?? 0) + 1;
    genreMembers.set(primary, count);
    const rand = seededRandom(`artist:${artist.id}:${primary}`);
    const golden = count * 2.399963229728653;
    const radial = regionRadius * (0.35 + 0.6 * Math.sqrt(rand()));
    const ySpread = (rand() - 0.5) * regionRadius * 0.55;
    const position: [number, number, number] = [
      genreNode.position[0] + Math.cos(golden) * radial,
      genreNode.position[1] + ySpread,
      genreNode.position[2] + Math.sin(golden) * radial,
    ];
    const apiSignal = apiArtists.find((a) => a.name === artist.name);
    const apiScore = apiSignal ? artistScore(apiSignal) : 0;
    nodes.push({
      id: artist.id,
      kind: "artist",
      label: artist.name,
      listeningMs: artist.listeningMs,
      normRadius: hasMeasured
        ? normalizedRadius(artist.listeningMs, maxArtistMs)
        : normalizedRadius(apiScore, maxApiArtistScore),
      position,
      parentIds: genreIds,
      childIds: [...artist.albumIds, ...artist.trackIds.filter((t) => !allAlbums.some((al) => al.trackIds.includes(t)))],
      genreIds,
      meta: {
        trackIds: [...artist.trackIds].sort(),
        albumIds: [...artist.albumIds].sort(),
        spotifyId: artist.spotifyId,
        genres: [...artist.genres].sort(),
        rankByListening: 0,
        ...(apiSignal && !hasMeasured ? { apiRank: apiSignal.rank } : {}),
        ...(apiSignal && !hasMeasured && (apiSignal.popularity ?? 0) > 0
          ? { apiPopularity: apiSignal.popularity }
          : {}),
      },
    });
    for (const gid of genreIds) {
      edges.push({ from: gid, to: artist.id, kind: "genre-artist" });
    }
  }

  const artistNodeById = new Map(nodes.filter((n) => n.kind === "artist").map((n) => [n.id, n]));

  // Rank artists/tracks by listening (or API popularity when unmeasured).
  const rankedArtists = [...artistsWithGenres].sort(
    (a, b) => b.listeningMs - a.listeningMs || a.id.localeCompare(b.id),
  );
  rankedArtists.forEach((a, i) => {
    const node = artistNodeById.get(a.id);
    if (node) node.meta.rankByListening = i + 1;
  });

  // --- Albums near artists ---
  const sortedAlbums = [...allAlbums].sort(
    (a, b) => b.listeningMs - a.listeningMs || a.id.localeCompare(b.id),
  );
  const albumNode = new Map<string, GraphNode>();
  for (const album of sortedAlbums) {
    const primaryArtistId = album.artistIds[0];
    const artistNode = primaryArtistId ? artistNodeById.get(primaryArtistId) : undefined;
    if (!artistNode) continue;
    const rand = seededRandom(`album:${album.id}`);
    const angle = rand() * Math.PI * 2;
    const dist = 3.4 + rand() * 4.2;
    const y = (rand() - 0.5) * 3.4;
    const position: [number, number, number] = [
      artistNode.position[0] + Math.cos(angle) * dist,
      artistNode.position[1] + y,
      artistNode.position[2] + Math.sin(angle) * dist,
    ];
    const albumSignal = apiTracks
      .filter((t) => t.albumName === album.name && t.artistNames[0] === artistNode.label)
      .reduce<ApiSignalTrack | null>(
        (best, t) => (best === null || t.rank < best.rank ? t : best),
        null,
      );
    const apiScore = albumSignal ? trackScore(albumSignal) : 0;
    const node: GraphNode = {
      id: album.id,
      kind: "album",
      label: album.name,
      listeningMs: album.listeningMs,
      normRadius: hasMeasured
        ? normalizedRadius(album.listeningMs, maxAlbumMs)
        : normalizedRadius(apiScore, maxApiTrackScore),
      position,
      parentIds: album.artistIds,
      childIds: [...album.trackIds],
      genreIds: artistNode.genreIds,
      meta: {
        albumName: album.name,
        albumId: album.id,
        artistNames: album.artistIds
          .map((id) => artistNodeById.get(id)?.label)
          .filter((n): n is string => Boolean(n)),
        trackIds: [...album.trackIds].sort(),
        artworkUrl: album.artworkUrl,
        trackCount: album.trackIds.length,
      },
    };
    albumNode.set(album.id, node);
    nodes.push(node);
    for (const aid of album.artistIds) {
      if (artistNodeById.has(aid)) edges.push({ from: aid, to: album.id, kind: "artist-album" });
    }
  }

  // --- Tracks near album (or artist when albumless) ---
  const sortedTracks = [...allTracks].sort(
    (a, b) => b.listeningMs - a.listeningMs || a.id.localeCompare(b.id),
  );
  const trackNode = new Map<string, GraphNode>();
  for (const track of sortedTracks) {
    const album = track.albumId ? albumNode.get(track.albumId) : undefined;
    const parent =
      album ??
      artistNodeById.get(track.artistIds[0]) ??
      [...artistNodeById.values()].find((a) => track.artistIds.includes(a.id));
    if (!parent) continue;
    const rand = seededRandom(`track:${track.id}`);
    const angle = rand() * Math.PI * 2;
    const dist = parent.kind === "album" ? 1.5 + rand() * 1.9 : 4.5 + rand() * 5;
    const y = (rand() - 0.5) * (parent.kind === "album" ? 1.6 : 3.6);
    const position: [number, number, number] = [
      parent.position[0] + Math.cos(angle) * dist,
      parent.position[1] + y,
      parent.position[2] + Math.sin(angle) * dist,
    ];
    const trackSignal = apiTracks.find((t) => t.id === track.spotifyId);
    const apiScore = trackSignal ? trackScore(trackSignal) : 0;
    const node: GraphNode = {
      id: track.id,
      kind: "track",
      label: track.name,
      listeningMs: track.listeningMs,
      normRadius: hasMeasured
        ? normalizedRadius(track.listeningMs, maxTrackMs)
        : normalizedRadius(apiScore, maxApiTrackScore),
      position,
      parentIds: parent.kind === "album" ? [parent.id, ...parent.parentIds] : parent.id ? [parent.id] : [],
      childIds: [],
      genreIds: parent.genreIds,
      meta: {
        artistNames: track.artistIds
          .map((id) => artistNodeById.get(id)?.label)
          .filter((n): n is string => Boolean(n)),
        albumName: track.albumId ? allAlbums.find((a) => a.id === track.albumId)?.name ?? null : null,
        albumId: track.albumId,
        spotifyTrackId: track.spotifyId,
        playRecordCount: track.playRecordCount,
        rankByListening: 0,
        ...(trackSignal && !hasMeasured ? { apiRank: trackSignal.rank } : {}),
        artworkUrl:
          (track.albumId ? albumNode.get(track.albumId)?.meta.artworkUrl : null) ??
          null,
      },
    };
    trackNode.set(track.id, node);
    nodes.push(node);
    if (album) {
      edges.push({ from: album.id, to: track.id, kind: "album-track" });
    } else {
      edges.push({ from: parent.id, to: track.id, kind: "artist-track" });
    }
  }

  sortedTracks.forEach((t, i) => {
    const node = trackNode.get(t.id);
    if (node) node.meta.rankByListening = i + 1;
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const neighbors = new Map<string, Set<string>>();
  const addNeighbor = (a: string, b: string) => {
    if (!nodeById.has(a) || !nodeById.has(b)) return;
    const set = neighbors.get(a) ?? new Set<string>();
    set.add(b);
    neighbors.set(a, set);
  };
  for (const edge of edges) {
    addNeighbor(edge.from, edge.to);
    addNeighbor(edge.to, edge.from);
  }

  return {
    nodes,
    edges: edges.filter((e) => nodeById.has(e.from) && nodeById.has(e.to)),
    nodeById,
    neighbors: new Map([...neighbors].map(([k, v]) => [k, [...v]])),
    stats,
    source,
    hasMeasuredListening: hasMeasured && stats.totalListeningMs > 0,
  };
}

function countTracksForGenre(
  artistIds: string[],
  artists: { id: string; trackIds: string[] }[],
): number {
  const set = new Set<string>();
  for (const id of artistIds) {
    const artist = artists.find((a) => a.id === id);
    if (artist) for (const t of artist.trackIds) set.add(t);
  }
  return set.size;
}

/**
 * Merge Spotify API genre metadata onto history-derived artists when names or
 * ids match. Artists without genre info keep their existing (possibly empty)
 * list — unknown genres are never invented.
 */
function mergeApiGenres(
  artists: ReturnType<typeof aggregateRecords>["artists"],
  apiArtists: ApiSignalArtist[],
): ReturnType<typeof aggregateRecords>["artists"] {
  const byName = new Map(apiArtists.map((a) => [a.name.toLowerCase(), a]));
  const byId = new Map(apiArtists.map((a) => [a.id, a]));
  return artists.map((artist) => {
    const api =
      (artist.spotifyId ? byId.get(artist.spotifyId) : undefined) ??
      byName.get(artist.name.toLowerCase());
    if (!api?.genres.length) return artist;
    return { ...artist, genres: [...new Set([...artist.genres, ...api.genres])] };
  });
}

/**
 * Enrich the record-derived entities with Spotify API signals when the app is
 * running on API data alone (source kind `spotify-api`):
 * - genres merge onto artists by id/name
 * - top artists/tracks not present in records become zero-listening entities
 *   so the universe stays explorable; they are clearly ranking signals, never
 *   listening totals.
 */
function synthesizeSignalEntities(
  aggregates: ReturnType<typeof aggregateRecords>,
  input: BuildGraphInput,
): { artists: Artist[]; albums: Album[]; tracks: Track[] } {
  const apiArtists = input.apiArtists ?? [];
  const apiTracks = input.apiTracks ?? [];

  const artists = apiArtists.length
    ? mergeApiGenres(aggregates.artists, apiArtists)
    : [...aggregates.artists];
  const albums = [...aggregates.albums];
  const tracks = [...aggregates.tracks];

  const artistByNorm = new Map(artists.map((a) => [normalizeName(a.name), a]));
  const trackIds = new Set(tracks.map((t) => t.id));
  const albumById = new Map(albums.map((a) => [a.id, a]));

  const ensureArtist = (name: string, spotifyId?: string): Artist => {
    const key = normalizeName(name);
    let artist = artistByNorm.get(key);
    if (!artist) {
      artist = {
        id: `n:${key}`,
        name,
        spotifyId: spotifyId ?? null,
        genres: [],
        listeningMs: 0,
        trackIds: [],
        albumIds: [],
      };
      artists.push(artist);
      artistByNorm.set(key, artist);
    } else if (spotifyId && !artist.spotifyId) {
      artist.spotifyId = spotifyId;
    }
    return artist;
  };

  for (const api of apiArtists) {
    const artist = ensureArtist(api.name, api.id);
    if (api.genres.length) {
      artist.genres = [...new Set([...artist.genres, ...api.genres])];
    }
  }

  for (const api of apiTracks) {
    const id = `s:${api.id}`;
    if (trackIds.has(id)) continue;
    const artistNames = api.artistNames.length > 0 ? api.artistNames : ["Unknown Artist"];
    const artistIds = artistNames.map((name) => ensureArtist(name).id);

    let albumId: string | null = null;
    if (api.albumName) {
      const key = albumKey(artistNames, api.albumName);
      let album = albumById.get(key);
      if (!album) {
        album = {
          id: key,
          name: api.albumName,
          artistIds: [...artistIds],
          listeningMs: 0,
          trackIds: [],
          artworkUrl: api.artworkUrl,
        };
        albums.push(album);
        albumById.set(key, album);
      }
      if (!album.trackIds.includes(id)) album.trackIds.push(id);
      albumId = key;
      for (const aid of artistIds) {
        const artist = artists.find((a) => a.id === aid);
        if (artist && !artist.albumIds.includes(key)) artist.albumIds.push(key);
      }
    }

    const track: Track = {
      id,
      name: api.name,
      artistIds,
      albumId,
      spotifyId: api.id,
      listeningMs: 0,
      playRecordCount: 0,
    };
    tracks.push(track);
    trackIds.add(id);
    for (const aid of artistIds) {
      const artist = artists.find((a) => a.id === aid);
      if (artist && !artist.trackIds.includes(id)) artist.trackIds.push(id);
    }
  }

  return { artists, albums, tracks };
}

export { radiusFor };
export type { RadiusKind };
export type MusicGraphOutput = MusicGraph;
