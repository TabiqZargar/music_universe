import type {
  Album,
  Artist,
  Genre,
  ListeningPeriod,
  ListeningRecord,
  Track,
  UniverseStats,
} from "@/types/domain";
import { compositeTrackKey, normalizeName } from "./keys";

/**
 * Optional enrichment joined onto history-derived entities by normalized
 * artist name (Spotify API genres/artwork, or the bundled demo's genre map).
 */
export interface ArtistEnrichment {
  genresByArtistName?: Record<string, string[]>;
  spotifyIdByArtistName?: Record<string, string>;
  artworkByAlbumKey?: Record<string, string>;
}

export interface Aggregates {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
  stats: UniverseStats;
  /** Distinct years/months present in the data (measured records only). */
  periods: ListeningPeriod[];
  hasTimestamps: boolean;
}

export function albumKey(artistNames: string[], albumName: string): string {
  const primary = artistNames[0] ?? "";
  return `n:${normalizeName(primary)}|${normalizeName(albumName)}`;
}

export function genreId(name: string): string {
  return `g:${normalizeName(name)}`;
}

/**
 * Deterministic aggregation from normalized records.
 * - track listening time = sum of msPlayed for the same track identity
 * - artist/album totals derive from track totals (full attribution for each
 *   credited artist, so artist sums overlap and must never be re-summed)
 * - the global total is the sum of record durations, each play counted once
 */
export function aggregateRecords(
  records: ListeningRecord[],
  enrichment: ArtistEnrichment = {},
): Aggregates {
  const trackMap = new Map<string, Track>();
  const artistMap = new Map<string, Artist>();
  const albumMap = new Map<string, Album>();

  const artistNameKey = (name: string) => normalizeName(name);

  const ensureArtist = (rawName: string): Artist => {
    const key = artistNameKey(rawName);
    let artist = artistMap.get(key);
    if (!artist) {
      const spotifyId = enrichment.spotifyIdByArtistName?.[key] ?? null;
      artist = {
        id: `n:${key}`,
        name: rawName.trim(),
        spotifyId,
        genres: [...(enrichment.genresByArtistName?.[key] ?? [])],
        listeningMs: 0,
        trackIds: [],
        albumIds: [],
      };
      artistMap.set(key, artist);
    }
    return artist;
  };

  for (const record of records) {
    let track = trackMap.get(record.trackKey);
    if (!track) {
      track = {
        id: record.trackKey,
        name: record.trackName,
        artistIds: [],
        albumId: null,
        spotifyId: record.spotifyTrackId,
        listeningMs: 0,
        playRecordCount: 0,
      };
      trackMap.set(record.trackKey, track);
    }
    track.listeningMs += record.msPlayed;
    track.playRecordCount += 1;

    for (const rawName of record.artistNames) {
      const artist = ensureArtist(rawName);
      if (!track.artistIds.includes(artist.id)) track.artistIds.push(artist.id);
      if (!artist.trackIds.includes(track.id)) artist.trackIds.push(track.id);
    }

    if (record.albumName) {
      const key = albumKey(record.artistNames, record.albumName);
      let album = albumMap.get(key);
      if (!album) {
        album = {
          id: key,
          name: record.albumName,
          artistIds: [],
          listeningMs: 0,
          trackIds: [],
          artworkUrl: enrichment.artworkByAlbumKey?.[key] ?? null,
        };
        albumMap.set(key, album);
      }
      if (!album.trackIds.includes(track.id)) album.trackIds.push(track.id);
      track.albumId = album.id;
      for (const rawName of record.artistNames) {
        const artist = ensureArtist(rawName);
        if (!album.artistIds.includes(artist.id)) album.artistIds.push(artist.id);
        if (!artist.albumIds.includes(album.id)) artist.albumIds.push(album.id);
      }
    }
  }

  // Derive artist totals from their tracks' totals (full attribution).
  for (const artist of artistMap.values()) {
    let total = 0;
    for (const trackId of artist.trackIds) {
      total += trackMap.get(trackId)?.listeningMs ?? 0;
    }
    artist.listeningMs = total;
  }
  for (const album of albumMap.values()) {
    let total = 0;
    for (const trackId of album.trackIds) {
      total += trackMap.get(trackId)?.listeningMs ?? 0;
    }
    album.listeningMs = total;
  }

  const artists = [...artistMap.values()];
  const tracks = [...trackMap.values()];
  const albums = [...albumMap.values()];

  const topArtists = [...artists]
    .sort((a, b) => b.listeningMs - a.listeningMs || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((a) => ({ id: a.id, name: a.name, listeningMs: a.listeningMs }));

  const topTracks = [...tracks]
    .sort((a, b) => b.listeningMs - a.listeningMs || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      name: t.name,
      artistName:
        artists.find((a) => a.id === t.artistIds[0])?.name ?? t.artistIds[0] ?? "",
      listeningMs: t.listeningMs,
    }));

  const timestamps = records
    .map((r) => r.timestamp)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  const stats: UniverseStats = {
    totalListeningMs: records.reduce((sum, r) => sum + r.msPlayed, 0),
    uniqueTracks: tracks.length,
    uniqueArtists: artists.length,
    uniqueAlbums: albums.length,
    uniqueGenres: 0,
    topArtists,
    topTracks,
    firstListeningMs: timestamps[0] ?? null,
    lastListeningMs: timestamps[timestamps.length - 1] ?? null,
  };

  return {
    tracks,
    artists,
    albums,
    stats,
    periods: buildPeriods(timestamps),
    hasTimestamps: timestamps.length > 0,
  };
}

/**
 * Build monthly/annual listening periods from measured timestamps.
 * Only periods present in the data are offered — never an implied range.
 */
export function buildPeriods(timestamps: number[]): ListeningPeriod[] {
  if (timestamps.length === 0) return [];
  const months = new Map<string, ListeningPeriod>();
  for (const ts of timestamps) {
    const d = new Date(ts);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
    const existing = months.get(key);
    if (existing) {
      existing.startMs = Math.min(existing.startMs, start);
      existing.endMs = Math.max(existing.endMs, end);
    } else {
      months.set(key, {
        label: key,
        startMs: start,
        endMs: end,
      });
    }
  }
  return [...months.values()].sort((a, b) => a.startMs - b.startMs);
}

/**
 * Genre list for the universe. Artists without any genre metadata land in the
 * Unclassified region — unknown genres are never fabricated.
 */
export function buildGenres(
  artists: Artist[],
  tracks: Track[],
  unclassifiedLabel = "Unclassified",
): { genres: Genre[]; artistsWithGenres: Artist[] } {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const genreMap = new Map<string, Genre>();
  const genreMembers = new Map<string, Set<string>>();
  const result: Artist[] = [];
  const resultById = new Map<string, Artist>();

  for (const artist of artists) {
    const names = artist.genres.length > 0 ? artist.genres : [unclassifiedLabel];
    const updated: Artist = { ...artist, genres: names };
    result.push(updated);
    resultById.set(updated.id, updated);
    for (const name of names) {
      const id = genreId(name);
      let genre = genreMap.get(id);
      if (!genre) {
        genre = { id, name, artistIds: [], listeningMs: 0 };
        genreMap.set(id, genre);
        genreMembers.set(id, new Set());
      }
      const members = genreMembers.get(id)!;
      if (!members.has(updated.id)) {
        members.add(updated.id);
        genre.artistIds.push(updated.id);
      }
    }
  }

  for (const genre of genreMap.values()) {
    const credited = new Set<string>();
    for (const artistId of genre.artistIds) {
      const artist = resultById.get(artistId);
      if (!artist) continue;
      for (const trackId of artist.trackIds) {
        credited.add(trackId);
      }
    }
    let total = 0;
    for (const trackId of credited) total += trackById.get(trackId)?.listeningMs ?? 0;
    genre.listeningMs = total;
  }

  return { genres: [...genreMap.values()], artistsWithGenres: result };
}

/**
 * Map a raw artist-name genre list (from the Spotify API or demo data)
 * into the enrichment shape.
 */
export function genresToEnrichment(
  entries: { artistName: string; genres: string[]; spotifyId?: string }[],
): Required<Pick<ArtistEnrichment, "genresByArtistName" | "spotifyIdByArtistName">> {
  const genresByArtistName: Record<string, string[]> = {};
  const spotifyIdByArtistName: Record<string, string> = {};
  for (const entry of entries) {
    const key = normalizeName(entry.artistName);
    genresByArtistName[key] = entry.genres;
    if (entry.spotifyId) spotifyIdByArtistName[key] = entry.spotifyId;
  }
  return { genresByArtistName, spotifyIdByArtistName };
}

export { compositeTrackKey };
