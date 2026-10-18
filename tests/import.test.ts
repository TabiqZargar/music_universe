import { describe, expect, it } from "vitest";
import {
  compositeTrackKey,
  normalizeName,
  seededRandom,
  spotifyIdFromUri,
} from "@/lib/music/keys";
import {
  applyImport,
  dedupeRecords,
  previewImportSelection,
} from "@/lib/import";
import { parseHistoryJson, parseTimestamp } from "@/lib/import/parse";
import { detectFormat } from "@/lib/import/detect";
import type { ListeningRecord } from "@/types/domain";

const EXTENDED = JSON.stringify([
  {
    ts: "2024-03-01T10:00:00.000Z",
    platform: "iOS",
    ms_played: 145000,
    conn_country: "US",
    ip_address_truncated: "1.2.3",
    user_agent_decrypted: "Mozilla/5.0",
    master_metadata_track_name: "Night Bloom",
    master_metadata_album_artist_name: "Aurora Vale",
    master_metadata_album_album_name: "First Seasons",
    spotify_track_uri: "spotify:track:abc123XYZ",
    episode_uri: null,
  },
  {
    ts: "2024-03-01T11:00:00.000Z",
    ms_played: 3000000,
    master_metadata_track_name: null,
    master_metadata_album_artist_name: null,
    master_metadata_album_album_name: null,
    episode_uri: "spotify:episode:xyz",
  },
  {
    ts: "2024-03-01T12:00:00.000Z",
    ms_played: -5,
    master_metadata_track_name: "Bad Row",
    master_metadata_album_artist_name: "Someone",
    spotify_track_uri: null,
  },
]);

const STREAMING = JSON.stringify([
  { endTime: "2015-12-31 23:59:59", artistName: "Ida Farrow", trackName: "Copper Vine", albumName: "Late Set", msPlayed: 61000 },
  { endTime: "2016-01-01 00:01:02", artistName: ["A", "B"], trackName: "Two Artists", msPlayed: 0 },
  { endTime: "not-a-date", artistName: "X", trackName: "T" },
]);

describe("name normalization and identity", () => {
  it("normalizes case, punctuation, whitespace and diacritics", () => {
    expect(normalizeName("  BÉYONCÉ —  Halo! ")).toBe("beyonce halo");
  });

  it("produces the same composite key regardless of artist order", () => {
    const a = compositeTrackKey("Song", ["B", "A"], "Album");
    const b = compositeTrackKey("song", ["A", "B"], "album");
    expect(a).toBe(b);
  });

  it("keeps missing-album keys distinct from real-album keys", () => {
    expect(compositeTrackKey("T", ["A"], null)).not.toBe(
      compositeTrackKey("T", ["A"], "Unknown"),
    );
  });

  it("extracts spotify ids from URIs only", () => {
    expect(spotifyIdFromUri("spotify:track:abc123")).toBe("abc123");
    expect(spotifyIdFromUri("spotify:episode:abc")).toBeNull();
    expect(spotifyIdFromUri(null)).toBeNull();
  });

  it("falls back to the composite key when no identifier exists", () => {
    const result = parseHistoryJson(STREAMING, { fileName: "s.json", batchId: "b1" });
    const track = result.records.find((r) => r.trackName === "Two Artists");
    expect(track?.trackKey.startsWith("c:")).toBe(true);
    expect(track?.spotifyTrackId).toBeNull();
  });
});

describe("schema detection", () => {
  it("detects extended history", () => {
    expect(detectFormat(JSON.parse(EXTENDED)).format).toBe("extended");
  });

  it("detects endTime streaming history", () => {
    expect(detectFormat(JSON.parse(STREAMING)).format).toBe("ends-with-time");
  });

  it("rejects non-array JSON", () => {
    const result = parseHistoryJson('{"nope": 1}', { fileName: "x.json" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/array/i);
  });

  it("rejects invalid JSON without throwing", () => {
    const result = parseHistoryJson("{broken", { fileName: "x.json" });
    expect(result.ok).toBe(false);
    expect(result.records).toHaveLength(0);
  });

  it("reports unrecognized arrays with zero records", () => {
    const result = parseHistoryJson(JSON.stringify([{ foo: 1 }]), { fileName: "x.json" });
    expect(result.ok).toBe(false);
    expect(result.preview.detectedFormat).toBe("Unrecognized");
  });
});

describe("parsing rules", () => {
  it("parses timestamps deterministically in UTC for space-separated times", () => {
    expect(parseTimestamp("2015-12-31 23:59:59")).toBe(Date.UTC(2015, 11, 31, 23, 59, 59));
    expect(parseTimestamp("2024-03-01T10:00:00.000Z")).toBe(Date.UTC(2024, 2, 1, 10));
    expect(parseTimestamp("garbage")).toBeNull();
    expect(parseTimestamp("")).toBeNull();
  });

  it("skips podcasts and counts them", () => {
    const result = parseHistoryJson(EXTENDED, { fileName: "e.json", batchId: "b" });
    expect(result.preview.skippedPodcasts).toBe(1);
    expect(result.records.every((r) => r.trackName !== null)).toBe(true);
  });

  it("counts malformed rows (negative or missing duration) instead of crashing", () => {
    const result = parseHistoryJson(EXTENDED, { fileName: "e.json", batchId: "b" });
    expect(result.preview.malformedEntries).toBe(1);
    expect(result.records.every((r) => r.msPlayed >= 0)).toBe(true);
  });

  it("treats negative durations as malformed rather than counting them", () => {
    const raw = JSON.stringify([
      { endTime: "2020-01-01 00:00:00", artistName: "A", trackName: "T", msPlayed: -10 },
    ]);
    const result = parseHistoryJson(raw, { fileName: "n.json", batchId: "b" });
    expect(result.preview.malformedEntries).toBe(1);
  });

  it("keeps legitimate zero-length plays", () => {
    const result = parseHistoryJson(STREAMING, { fileName: "s.json", batchId: "b" });
    expect(result.records.some((r) => r.msPlayed === 0 && r.trackName === "Two Artists")).toBe(true);
  });

  it("never persists sensitive export fields", () => {
    const result = parseHistoryJson(EXTENDED, { fileName: "e.json", batchId: "b" });
    const serialized = JSON.stringify(result.records);
    for (const field of ["ip_address", "platform", "user_agent", "conn_country"]) {
      expect(serialized).not.toContain(field);
    }
  });
});

describe("duplicate detection, merge and replace", () => {
  const makeRecord = (over: Partial<ListeningRecord> = {}): ListeningRecord => ({
    trackKey: "c:t|a|b",
    timestamp: 1000,
    trackName: "T",
    artistNames: ["A"],
    albumName: "B",
    spotifyTrackId: null,
    msPlayed: 100,
    source: "imported",
    importBatchId: "b1",
    ...over,
  });

  it("treats the same file uploaded twice as a duplicate, contributing no records", () => {
    const { parsed } = previewImportSelection([
      { name: "StreamingHistory0.json", text: STREAMING },
      { name: "copy.json", text: STREAMING },
    ]);
    expect(parsed[0].records.length).toBeGreaterThan(0);
    expect(parsed[1].preview.duplicateOfFile).toBe("StreamingHistory0.json");
    expect(parsed[1].records).toHaveLength(0);
  });

  it("merges without duplicating exact records and keeps existing batches", () => {
    const { parsed } = previewImportSelection([{ name: "a.json", text: STREAMING }]);
    const existing = { records: [makeRecord()], batches: [] };
    const merged = applyImport(parsed, "merge", existing);
    const sigs = new Set(
      merged.records.map((r) => `${r.trackKey}|${r.timestamp}|${r.msPlayed}`),
    );
    expect(sigs.size).toBe(merged.records.length);
    expect(merged.records.some((r) => r.importBatchId === "b1")).toBe(true);
    expect(merged.importedRecordCount).toBeGreaterThan(0);
  });

  it("replace discards previous records", () => {
    const { parsed } = previewImportSelection([{ name: "a.json", text: STREAMING }]);
    const existing = { records: [makeRecord({ trackKey: "old" })], batches: [] };
    const replaced = applyImport(parsed, "replace", existing);
    expect(replaced.records.some((r) => r.trackKey === "old")).toBe(false);
  });

  it("dedupeRecords collapses identical signatures only", () => {
    const a = makeRecord();
    const b = makeRecord();
    const c = makeRecord({ msPlayed: 999 });
    expect(dedupeRecords([a, b, c])).toHaveLength(2);
  });
});

describe("seeded randomness", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a1 = seededRandom("x");
    const a2 = seededRandom("x");
    const b = seededRandom("y");
    const seq1 = [a1(), a1(), a1()];
    const seq2 = [a2(), a2(), a2()];
    expect(seq1).toEqual(seq2);
    expect(seq1[0]).not.toBe(b());
  });
});
