import type { ListeningRecord } from "@/types/domain";
import type { ApiSignalArtist, ApiSignalTrack } from "@/lib/music/graph";
import { albumKey } from "@/lib/music/aggregate";
import { compositeTrackKey } from "@/lib/music/keys";
import type { RecentlyPlayedItem, SpotifyArtistObject, SpotifyTrackObject } from "./api";

/**
 * Convert API results into graph signals.
 *
 * Spotify top/recent results are NOT a listening ledger: they carry no
 * measured play durations. Signal tracks/artists are used for sizing fallbacks
 * and genre enrichment only — never added to listening-time totals.
 */
export function apiTopToSignals(
  topArtists: SpotifyArtistObject[],
  topTracks: SpotifyTrackObject[],
): { apiArtists: ApiSignalArtist[]; apiTracks: ApiSignalTrack[] } {
  const apiArtists: ApiSignalArtist[] = topArtists.map((a) => ({
    id: a.id,
    name: a.name,
    genres: [...(a.genres ?? [])],
    popularity: a.popularity ?? 0,
    followers: a.followers?.total ?? 0,
  }));
  const apiTracks: ApiSignalTrack[] = topTracks
    .filter((t) => t.id && t.name)
    .map((t) => ({
      id: t.id,
      name: t.name,
      artistNames: (t.artists ?? []).map((a) => a.name).filter(Boolean),
      albumName: t.album?.name ?? null,
      artworkUrl: t.album?.images?.[0]?.url ?? null,
      popularity: t.popularity ?? 0,
    }));
  return { apiArtists, apiTracks };
}

/**
 * Recently played items become *observed* play records: a real timestamp with
 * zero measured duration (Spotify does not report how much was listened to).
 * They contribute play counts and timelines only — listening totals stay 0,
 * so imported history and API data can never double-count listening time.
 */
export function recentlyPlayedToRecords(
  items: RecentlyPlayedItem[],
  importBatchId = "spotify:recently-played",
): ListeningRecord[] {
  const records: ListeningRecord[] = [];
  for (const item of items) {
    const track = item.track;
    if (!track || !track.name) continue;
    const artistNames = (track.artists ?? [])
      .map((a) => a.name)
      .filter((n): n is string => typeof n === "string" && n.trim() !== "");
    if (artistNames.length === 0) continue;
    const timestamp = Date.parse(item.played_at);
    records.push({
      trackKey:
        track.id && track.id.length > 0
          ? `s:${track.id}`
          : compositeTrackKey(track.name, artistNames, track.album?.name ?? null),
      timestamp: Number.isNaN(timestamp) ? null : timestamp,
      trackName: track.name,
      artistNames,
      albumName: track.album?.name ?? null,
      spotifyTrackId: track.id && track.id.length > 0 ? track.id : null,
      // Spotify reports track duration, NOT time listened — record 0 ms.
      msPlayed: 0,
      source: "spotify-api",
      importBatchId,
    });
  }
  return records;
}

/** Album artwork lookup keyed like aggregation's album keys. */
export function artworkEnrichmentFromTracks(
  topTracks: SpotifyTrackObject[],
): { artworkByAlbumKey: Record<string, string> } {
  const artworkByAlbumKey: Record<string, string> = {};
  for (const track of topTracks) {
    const albumName = track.album?.name;
    const image = track.album?.images?.[0]?.url;
    if (!albumName || !image) continue;
    const artists = (track.artists ?? []).map((a) => a.name).filter(Boolean);
    if (artists.length === 0) continue;
    const key = albumKey(artists, albumName);
    artworkByAlbumKey[key] ??= image;
  }
  return { artworkByAlbumKey };
}
