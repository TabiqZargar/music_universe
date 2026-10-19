import { describe, expect, it } from "vitest";
import {
  apiTopToSignals,
  recentlyPlayedToRecords,
  artworkEnrichmentFromTracks,
} from "@/lib/spotify/normalize";
import type { RecentlyPlayedItem, SpotifyArtistObject, SpotifyTrackObject } from "@/lib/spotify/api";
import { buildMusicGraph } from "@/lib/music/graph";
import type { DataSourceMetadata, ListeningRecord } from "@/types/domain";

const apiSource: DataSourceMetadata = {
  kind: "spotify-api",
  periodStartMs: null,
  periodEndMs: null,
  recordCount: 0,
  batches: [],
  apiSources: ["top-artists", "top-tracks"],
};

const artist = (id: string, name: string, over: Partial<SpotifyArtistObject> = {}): SpotifyArtistObject => ({
  id,
  name,
  ...over,
});

const track = (id: string, name: string, over: Partial<SpotifyTrackObject> = {}): SpotifyTrackObject => ({
  id,
  name,
  artists: [{ id: "a1", name: "Artist One" }],
  album: { name: "Album One", images: [] },
  ...over,
});

describe("apiTopToSignals", () => {
  it("assigns 1-based ranks in returned order", () => {
    const { apiArtists, apiTracks } = apiTopToSignals(
      [artist("1", "A"), artist("2", "B")],
      [track("t1", "T1"), track("t2", "T2"), track("t3", "T3")],
    );
    expect(apiArtists.map((a) => a.rank)).toEqual([1, 2]);
    expect(apiTracks.map((t) => t.rank)).toEqual([1, 2, 3]);
  });

  it("keeps popularity only when Spotify returns it (dev-mode omits it)", () => {
    const { apiArtists } = apiTopToSignals(
      [artist("1", "WithPop", { popularity: 77 }), artist("2", "NoPop")],
      [],
    );
    expect(apiArtists[0].popularity).toBe(77);
    expect("popularity" in apiArtists[1]).toBe(false);
  });

  it("defaults genres to an empty list and drops invalid tracks", () => {
    const { apiArtists, apiTracks } = apiTopToSignals(
      [artist("1", "A")],
      [track("", "no-id"), track("t2", "")],
    );
    expect(apiArtists[0].genres).toEqual([]);
    expect(apiTracks).toHaveLength(0);
  });
});

describe("recentlyPlayedToRecords", () => {
  const makeItem = (over: Partial<RecentlyPlayedItem> = {}): RecentlyPlayedItem => ({
    played_at: "2026-01-01T00:00:00.000Z",
    track: track("t1", "T1"),
    ...over,
  });

  it("records observed plays with zero measured duration", () => {
    const records = recentlyPlayedToRecords([makeItem()]);
    expect(records[0]).toMatchObject({
      trackKey: "s:t1",
      msPlayed: 0,
      source: "spotify-api",
    });
    expect(records[0].timestamp).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("skips entries without a track name or credited artist", () => {
    const records = recentlyPlayedToRecords([
      makeItem({ track: { id: "x", name: "", artists: [{ name: "A" }] } }),
      makeItem({ track: { id: "y", name: "Y", artists: [] } }),
    ]);
    expect(records).toHaveLength(0);
  });

  it("stores a null timestamp for unparseable played_at", () => {
    const records = recentlyPlayedToRecords([makeItem({ played_at: "not-a-date" })]);
    expect(records[0].timestamp).toBeNull();
  });
});

describe("artworkEnrichmentFromTracks", () => {
  it("keys artwork by album identity", () => {
    const { artworkByAlbumKey } = artworkEnrichmentFromTracks([
      track("t1", "T1", { album: { name: "LP", images: [{ url: "http://img" }] } }),
    ]);
    expect(Object.values(artworkByAlbumKey)).toContain("http://img");
  });
});

describe("API signals never enter listening totals", () => {
  it("sizes a popularity-less API universe by rank, with no measured time", () => {
    const topArtists = [artist("1", "A"), artist("2", "B"), artist("3", "C")];
    const topTracks = [track("t1", "T1"), track("t2", "T2"), track("t3", "T3")];
    const signals = apiTopToSignals(topArtists, topTracks);
    const records = recentlyPlayedToRecords([
      { played_at: "2026-01-01T00:00:00.000Z", track: topTracks[0] },
    ]);

    const graph = buildMusicGraph({
      records,
      source: apiSource,
      apiArtists: signals.apiArtists,
      apiTracks: signals.apiTracks,
    });

    // No measured listening: totals stay zero and the flag is honest.
    expect(graph.stats.totalListeningMs).toBe(0);
    expect(graph.hasMeasuredListening).toBe(false);

    const artistNodes = graph.nodes.filter((n) => n.kind === "artist");
    const ranked = artistNodes.filter((n) => n.meta.apiRank !== undefined);
    expect(ranked).toHaveLength(3);
    // Rank 1 must render larger than rank 3 without any popularity field.
    const a = artistNodes.find((n) => n.meta.apiRank === 1)!;
    const c = artistNodes.find((n) => n.meta.apiRank === 3)!;
    expect(a.normRadius).toBeGreaterThan(c.normRadius);
    expect(artistNodes.every((n) => n.meta.apiPopularity === undefined)).toBe(true);
  });

  it("uses popularity for sizing when it is present", () => {
    const signals = apiTopToSignals(
      [artist("1", "Popular", { popularity: 90 }), artist("2", "Niche", { popularity: 10 })],
      [],
    );
    const graph = buildMusicGraph({ records: [], source: apiSource, apiArtists: signals.apiArtists });
    const popular = graph.nodes.find((n) => n.label === "Popular")!;
    const niche = graph.nodes.find((n) => n.label === "Niche")!;
    expect(popular.meta.apiPopularity).toBe(90);
    expect(popular.normRadius).toBeGreaterThan(niche.normRadius);
  });
});

describe("combined sources keep measured totals authoritative", () => {
  const record = (over: Partial<ListeningRecord> = {}): ListeningRecord => ({
    trackKey: "s:t1",
    timestamp: Date.UTC(2026, 0, 1),
    trackName: "T1",
    artistNames: ["Artist One"],
    albumName: "Album One",
    spotifyTrackId: "t1",
    msPlayed: 120_000,
    source: "imported",
    importBatchId: "b",
    ...over,
  });

  it("imported totals are unchanged by API signals passed alongside", () => {
    const records = [record()];
    const signals = apiTopToSignals(
      [artist("1", "Artist One", { genres: ["indie"] })],
      [track("t1", "T1")],
    );
    const withoutApi = buildMusicGraph({
      records,
      source: { ...apiSource, kind: "combined" },
    });
    const withApi = buildMusicGraph({
      records,
      source: { ...apiSource, kind: "combined" },
      apiArtists: signals.apiArtists,
      apiTracks: signals.apiTracks,
    });
    expect(withApi.stats.totalListeningMs).toBe(withoutApi.stats.totalListeningMs);
    expect(withApi.stats.totalListeningMs).toBe(120_000);
    expect(withApi.hasMeasuredListening).toBe(true);
  });
});
