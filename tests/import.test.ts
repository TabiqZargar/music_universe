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

  it("flags zero-duration plays without dropping them", () => {
    const result = parseHistoryJson(STREAMING, { fileName: "s.json", batchId: "b" });
    expect(result.preview.zeroDurationPlays).toBe(1);
    expect(result.preview.totalListeningMs).toBeGreaterThan(0);
  });

  it("never persists sensitive export fields", () => {
    const result = parseHistoryJson(EXTENDED, { fileName: "e.json", batchId: "b" });
    const serialized = JSON.stringify(result.records);
    for (const field of ["ip_address", "platform", "user_agent", "conn_country"]) {
      expect(serialized).not.toContain(field);
    }
  });
});

describe("real Extended Streaming History shape", () => {
  // Spotify's endsong_*.json writes ms_played as a floating-point number; the
  // importer must round it rather than reject every record as malformed.
  const FLOAT_MS = JSON.stringify([
    {
      ts: "2024-05-01T10:00:00Z",
      ms_played: 123456.78,
      master_metadata_track_name: "Float Song",
      master_metadata_album_artist_name: "Float Artist",
      master_metadata_album_album_name: "Float Album",
      spotify_track_uri: "spotify:track:float1",
    },
  ]);

  it("imports records whose ms_played is a float and rounds to whole ms", () => {
    const result = parseHistoryJson(FLOAT_MS, { fileName: "endsong_0.json", batchId: "b" });
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].msPlayed).toBe(123457);
    expect(result.preview.malformedEntries).toBe(0);
  });

  it("parses a mixed real file (music + skipped podcast) without losing music", () => {
    const raw = JSON.stringify([
      {
        ts: "2024-05-01T10:00:00Z",
        ms_played: 0.0,
        master_metadata_track_name: "Instant Skip",
        master_metadata_album_artist_name: "Artist",
        spotify_track_uri: "spotify:track:z1",
      },
      {
        ts: "2024-05-01T10:05:00Z",
        ms_played: 300000,
        master_metadata_track_name: null,
        master_metadata_album_artist_name: null,
        episode_uri: "spotify:episode:e1",
        episode_name: "A Podcast",
      },
      {
        ts: "2024-05-01T10:30:00Z",
        ms_played: 90000.5,
        master_metadata_track_name: null,
        master_metadata_album_artist_name: null,
      },
    ]);
    const result = parseHistoryJson(raw, { fileName: "endsong_1.json", batchId: "b" });
    expect(result.records).toHaveLength(1);
    expect(result.preview.skippedPodcasts).toBe(1);
    expect(result.preview.malformedEntries).toBe(1);
    expect(result.preview.zeroDurationPlays).toBe(1);
    expect(result.preview.totalListeningMs).toBe(0);
  });
});

describe("empty and valueless files", () => {
  it("reports a clear error for an empty file", () => {
    const result = parseHistoryJson("", { fileName: "empty.json" });
    expect(result.ok).toBe(false);
    expect(result.records).toHaveLength(0);
    expect(result.errors[0]).toMatch(/not valid json/i);
  });

  it("flags a file with only podcasts / no music records", () => {
    const raw = JSON.stringify([
      { ts: "2024-01-01T00:00:00Z", ms_played: 100, episode_uri: "spotify:episode:x" },
    ]);
    const result = parseHistoryJson(raw, { fileName: "podcasts.json" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /no music play records/i.test(e))).toBe(true);
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

  it("re-importing the same file adds no records and no duplicate batch", () => {
    const { parsed } = previewImportSelection([{ name: "a.json", text: STREAMING }]);
    const first = applyImport(parsed, "merge", { records: [], batches: [] });
    expect(first.importedRecordCount).toBeGreaterThan(0);
    expect(first.batches).toHaveLength(1);

    const second = applyImport(parsed, "merge", {
      records: first.records,
      batches: first.batches,
    });
    expect(second.importedRecordCount).toBe(0);
    expect(second.batches).toHaveLength(1);
    expect(second.records).toHaveLength(first.records.length);
  });

  it("marks a file already stored by a prior import as a duplicate in the preview", () => {
    const { parsed } = previewImportSelection([{ name: "StreamingHistory0.json", text: STREAMING }]);
    const first = applyImport(parsed, "merge", { records: [], batches: [] });
    const [storedBatch] = first.batches;

    const known = new Map([[storedBatch.fileHash, storedBatch.fileName]]);
    const again = previewImportSelection(
      [{ name: "StreamingHistory0.json", text: STREAMING }],
      known,
    );
    expect(again.parsed[0].preview.duplicateOfFile).toBe("StreamingHistory0.json");
    expect(again.parsed[0].preview.recordCount).toBe(0);
    expect(again.parsed[0].records).toHaveLength(0);
  });

  it("imports several files at once and stays idempotent across them", () => {
    const other = JSON.stringify([
      { endTime: "2021-01-01 00:00:00", artistName: "Ida Farrow", trackName: "New Cut", msPlayed: 1000 },
    ]);
    const { parsed } = previewImportSelection([
      { name: "StreamingHistory0.json", text: STREAMING },
      { name: "StreamingHistory1.json", text: other },
    ]);
    const applied = applyImport(parsed, "merge", { records: [], batches: [] });
    expect(applied.batches).toHaveLength(2);
    expect(applied.importedRecordCount).toBe(applied.records.length);

    const again = applyImport(parsed, "merge", {
      records: applied.records,
      batches: applied.batches,
    });
    expect(again.importedRecordCount).toBe(0);
    expect(again.batches).toHaveLength(2);
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
