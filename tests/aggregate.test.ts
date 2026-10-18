import { describe, expect, it } from "vitest";
import {
  aggregateRecords,
  buildGenres,
  genreId,
} from "@/lib/music/aggregate";
import { buildMusicGraph } from "@/lib/music/graph";
import { radiusFor, normalizedRadius, RADIUS_RANGES } from "@/lib/music/sizing";
import { timeframeOptions, timeframeRange, recordsInRange } from "@/lib/music/timeframe";
import { applyFilters, DEFAULT_FILTERS } from "@/lib/music/filters";
import { searchGraph } from "@/lib/music/search";
import { buildDemoDataset } from "@/lib/music/demo";
import type { DataSourceMetadata, ListeningRecord } from "@/types/domain";

const source: DataSourceMetadata = {
  kind: "imported",
  periodStartMs: null,
  periodEndMs: null,
  recordCount: 0,
  batches: [],
  apiSources: [],
};

function rec(over: Partial<ListeningRecord>): ListeningRecord {
  return {
    trackKey: "c:t|a|",
    timestamp: null,
    trackName: "T",
    artistNames: ["A"],
    albumName: null,
    spotifyTrackId: null,
    msPlayed: 0,
    source: "imported",
    importBatchId: "b",
    ...over,
  };
}

describe("aggregation", () => {
  it("sums track listening from records and derives artist totals without double counting globally", () => {
    const records = [
      rec({ trackKey: "s:1", trackName: "One", msPlayed: 100, artistNames: ["Solo"] }),
      rec({ trackKey: "s:1", trackName: "One", msPlayed: 50, artistNames: ["Solo"] }),
      rec({ trackKey: "s:2", trackName: "Two", msPlayed: 70, artistNames: ["Solo"] }),
    ];
    const agg = aggregateRecords(records);
    const track = agg.tracks.find((t) => t.id === "s:1")!;
    expect(track.listeningMs).toBe(150);
    expect(track.playRecordCount).toBe(2);
    const solo = agg.artists.find((a) => a.name === "Solo")!;
    expect(solo.listeningMs).toBe(220);
    // Global total counts each play exactly once.
    expect(agg.stats.totalListeningMs).toBe(220);
  });

  it("attributes full track time to every collaborating artist (documented overlap)", () => {
    const records = [
      rec({
        trackKey: "c:duet|x|y",
        trackName: "Duet",
        artistNames: ["X", "Y"],
        albumName: "LP",
        msPlayed: 1000,
      }),
    ];
    const agg = aggregateRecords(records);
    const x = agg.artists.find((a) => a.name === "X")!;
    const y = agg.artists.find((a) => a.name === "Y")!;
    expect(x.listeningMs).toBe(1000);
    expect(y.listeningMs).toBe(1000);
    // Overlapping artist totals (2000) must exceed the global total (1000).
    expect(agg.stats.totalListeningMs).toBe(1000);
    expect(x.listeningMs + y.listeningMs).toBeGreaterThan(agg.stats.totalListeningMs);
  });

  it("handles empty and all-zero datasets without NaN", () => {
    const agg = aggregateRecords([]);
    expect(agg.stats.totalListeningMs).toBe(0);
    expect(agg.stats.uniqueTracks).toBe(0);
    expect(normalizedRadius(0, 0)).toBe(0);
    expect(radiusFor("artist", 0, 0)).toBe(RADIUS_RANGES.artist.min);

    const zero = aggregateRecords([rec({ msPlayed: 0 })]);
    expect(zero.stats.totalListeningMs).toBe(0);
    expect(Number.isFinite(radiusFor("track", 0, 100))).toBe(true);
  });

  it("keeps same-named tracks by different artists apart", () => {
    const records = [
      rec({ trackKey: "a", trackName: "Intro", artistNames: ["Artist One"], albumName: "X" }),
      rec({ trackKey: "b", trackName: "Intro", artistNames: ["Artist Two"], albumName: "Y" }),
    ];
    const agg = aggregateRecords(records);
    expect(agg.stats.uniqueTracks).toBe(2);
  });

  it("places artists without genre metadata in Unclassified, never invented genres", () => {
    const agg = aggregateRecords([rec({ artistNames: ["Mystery"] })]);
    const { genres } = buildGenres(agg.artists, agg.tracks);
    expect(genres).toHaveLength(1);
    expect(genres[0].name).toBe("Unclassified");
    expect(genres[0].artistIds).toHaveLength(1);
  });

  it("supports one artist in several genres without duplicating the entity", () => {
    const artists = [
      { id: "n:x", name: "X", spotifyId: null, genres: ["Jazz", "Ambient"], listeningMs: 10, trackIds: [], albumIds: [] },
    ];
    const { genres, artistsWithGenres } = buildGenres(artists, []);
    expect(artistsWithGenres).toHaveLength(1);
    expect(genres.map((g) => g.name).sort()).toEqual(["Ambient", "Jazz"]);
    expect(new Set(genres.flatMap((g) => g.artistIds)).size).toBe(1);
  });
});

describe("timeframe filters", () => {
  const day = 86400000;
  const base = Date.UTC(2026, 0, 1);
  const records = [
    rec({ timestamp: base - 400 * day }),
    rec({ timestamp: base - 100 * day }),
    rec({ timestamp: base - 3 * day }),
  ];

  it("offers windows only when the data spans them", () => {
    const { options } = timeframeOptions(records);
    expect(options.map((o) => o.id)).toEqual(["4w", "6m", "all"]);
    const short = timeframeOptions([rec({ timestamp: base })]);
    expect(short.options.map((o) => o.id)).toEqual(["all"]);
  });

  it("anchors windows to the data end, not the current date", () => {
    const { dataEndMs } = timeframeOptions(records);
    expect(dataEndMs).toBe(base - 3 * day);
    const range = timeframeRange("4w", dataEndMs);
    expect(range!.endMs).toBe(dataEndMs);
    const inRange = recordsInRange(records, range);
    expect(inRange).toHaveLength(1);
    expect(timeframeRange("all", dataEndMs)).toBeNull();
  });

  it("drops timestamp-less records when a range is active", () => {
    const withNull = [...records, rec({ timestamp: null })];
    const range = timeframeRange("6m", base - 3 * day);
    expect(recordsInRange(withNull, range)).toHaveLength(2);
    expect(recordsInRange(withNull, null)).toHaveLength(4);
  });
});

describe("graph layout determinism", () => {
  const demo = buildDemoDataset();

  it("same dataset yields identical positions and radii", () => {
    const a = buildMusicGraph({ records: demo.records, enrichment: demo.enrichment, source: { ...source, kind: "demo" } });
    const b = buildMusicGraph({ records: demo.records, enrichment: demo.enrichment, source: { ...source, kind: "demo" } });
    expect(a.nodes.length).toBe(b.nodes.length);
    for (let i = 0; i < a.nodes.length; i++) {
      expect(a.nodes[i].position).toEqual(b.nodes[i].position);
      expect(a.nodes[i].normRadius).toBe(b.nodes[i].normRadius);
    }
    expect(a.edges.length).toBe(b.edges.length);
  });

  it("builds genre -> artist -> album -> track structure with connected components", () => {
    const g = buildMusicGraph({ records: demo.records, enrichment: demo.enrichment, source: { ...source, kind: "demo" } });
    const kinds = new Set(g.nodes.map((n) => n.kind));
    expect(kinds).toEqual(new Set(["genre", "artist", "album", "track"]));
    const genre = g.nodes.find((n) => n.kind === "genre")!;
    const someArtist = g.nodes.find((n) => n.kind === "artist" && n.genreIds.includes(genre.id))!;
    expect(g.neighbors.get(someArtist.id)).toContain(genre.id);
    const track = g.nodes.find((n) => n.kind === "track")!;
    expect((g.neighbors.get(track.id) ?? []).length).toBeGreaterThan(0);
    // Every node position is finite.
    expect(g.nodes.every((n) => n.position.every(Number.isFinite))).toBe(true);
  });

  it("keeps nodes separated from their parents (no exact overlap)", () => {
    const g = buildMusicGraph({ records: demo.records, enrichment: demo.enrichment, source: { ...source, kind: "demo" } });
    for (const node of g.nodes) {
      for (const parentId of node.parentIds) {
        const parent = g.nodeById.get(parentId);
        if (!parent) continue;
        expect(node.position).not.toEqual(parent.position);
      }
    }
  });

  it("builds a graph from an empty dataset without crashing", () => {
    const g = buildMusicGraph({ records: [], source });
    expect(g.nodes).toHaveLength(0);
    expect(g.stats.totalListeningMs).toBe(0);
    expect(g.hasMeasuredListening).toBe(false);
  });
});

describe("filters and search", () => {
  const demo = buildDemoDataset();
  const graph = buildMusicGraph({
    records: demo.records,
    enrichment: demo.enrichment,
    source: { ...source, kind: "demo" },
  });

  it("default filters show everything and stats match the full graph", () => {
    const result = applyFilters(graph, DEFAULT_FILTERS);
    expect(result.visibleIds.size).toBe(graph.nodes.length);
    const trackTotal = graph.nodes
      .filter((n) => n.kind === "track")
      .reduce((s, n) => s + n.listeningMs, 0);
    expect(result.visibleStats.totalListeningMs).toBe(trackTotal);
    expect(result.visibleStats.uniqueArtists).toBe(
      graph.nodes.filter((n) => n.kind === "artist").length,
    );
  });

  it("entity-kind toggle hides a whole layer consistently", () => {
    const filters = {
      ...DEFAULT_FILTERS,
      entityKinds: { genre: true, artist: true, album: false, track: true },
    };
    const result = applyFilters(graph, filters);
    expect([...result.visibleIds].some((id) => graph.nodeById.get(id)!.kind === "album")).toBe(false);
    expect(result.visibleStats.uniqueAlbums).toBe(0);
    expect(result.visibleStats.uniqueTracks).toBeGreaterThan(0);
  });

  it("genre filter hides artists and their children outside the genre", () => {
    const genre = graph.nodes.find((n) => n.kind === "genre")!;
    const result = applyFilters(graph, { ...DEFAULT_FILTERS, genreIds: [genre.id] });
    for (const id of result.visibleIds) {
      const node = graph.nodeById.get(id)!;
      expect(node.genreIds.includes(genre.id) || node.id === genre.id).toBe(true);
    }
    expect(result.visibleStats.uniqueGenres).toBe(1);
  });

  it("minimum listening threshold removes low-listening nodes", () => {
    const artistNodes = graph.nodes.filter((n) => n.kind === "artist");
    const max = Math.max(...artistNodes.map((n) => n.listeningMs));
    const result = applyFilters(graph, {
      ...DEFAULT_FILTERS,
      entityKinds: { genre: false, artist: true, album: false, track: false },
      minListeningMs: max,
    });
    const visibleArtists = [...result.visibleIds].filter((id) => graph.nodeById.get(id)!.kind === "artist");
    expect(visibleArtists).toHaveLength(1);
  });

  it("search finds artists, tracks and genres with type context", () => {
    const artist = graph.nodes.find((n) => n.kind === "artist")!;
    const results = searchGraph(graph, artist.label);
    expect(results[0].id).toBe(artist.id);
    expect(results[0].kind).toBe("artist");

    const track = graph.nodes.find((n) => n.kind === "track")!;
    const trackResults = searchGraph(graph, track.label);
    expect(trackResults.some((r) => r.id === track.id)).toBe(true);

    expect(searchGraph(graph, "zzz-no-match")).toHaveLength(0);
    expect(searchGraph(graph, "   ")).toHaveLength(0);
  });
});

describe("sizing scale", () => {
  it("follows the bounded sqrt curve", () => {
    expect(radiusFor("track", 0, 100)).toBe(RADIUS_RANGES.track.min);
    expect(radiusFor("track", 100, 100)).toBeCloseTo(RADIUS_RANGES.track.max);
    const mid = radiusFor("track", 25, 100);
    expect(mid).toBeCloseTo(
      RADIUS_RANGES.track.min + (RADIUS_RANGES.track.max - RADIUS_RANGES.track.min) * 0.5,
    );
    expect(radiusFor("track", 1000, 100)).toBeLessThanOrEqual(RADIUS_RANGES.track.max);
    expect(radiusFor("track", -5, 100)).toBe(RADIUS_RANGES.track.min);
  });

  it("genre ids are stable", () => {
    expect(genreId("Dream Pop")).toBe(genreId("  dream   POP "));
  });
});
