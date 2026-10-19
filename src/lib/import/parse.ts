import type {
  ImportPreview,
  ImportResult,
  ListeningRecord,
} from "@/types/domain";
import { compositeTrackKey, spotifyIdFromUri } from "@/lib/music/keys";
import { detectFormat, validateEntry, type DetectedFormat } from "./detect";

export function hashContent(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Parse a Spotify `ts` / `endTime` / `startTime` value to epoch ms.
 * Space-separated times without a zone are read as UTC so results do not
 * depend on the machine timezone. Returns null when unparseable.
 */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const raw = value.trim();
  const space = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (space && !raw.includes("Z") && !/[+-]\d{2}:\d{2}$/.test(raw)) {
    const [, y, mo, d, h, mi, s] = space;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function asPositiveInt(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    n = Number(value);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function asArtistNames(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.trim());
  }
  return [];
}

function isPodcast(entry: Record<string, unknown>): boolean {
  const episodeUri =
    typeof entry.episode_uri === "string" ? entry.episode_uri : null;
  const uri = typeof entry.uri === "string" ? entry.uri : null;
  const trackUri =
    typeof entry.spotify_track_uri === "string" ? entry.spotify_track_uri : null;
  if (episodeUri || uri?.startsWith("spotify:episode:")) return true;
  if (trackUri?.startsWith("spotify:episode:")) return true;
  if (entry.episode_name != null) return true;
  return false;
}

function isVideo(entry: Record<string, unknown>): boolean {
  const uri =
    typeof entry.uri === "string"
      ? entry.uri
      : typeof entry.spotify_track_uri === "string"
        ? entry.spotify_track_uri
        : null;
  if (uri?.startsWith("spotify:video:")) return true;
  if (entry.video_name != null) return true;
  return false;
}

interface NormalizeCounts {
  skippedPodcasts: number;
  malformed: number;
  zeroDurationPlays: number;
}

function entryToRecord(
  entry: Record<string, unknown>,
  source: ListeningRecord["source"],
  importBatchId: string,
  counts: NormalizeCounts,
): ListeningRecord | null {
  if (isPodcast(entry) || isVideo(entry)) {
    counts.skippedPodcasts += 1;
    return null;
  }

  const trackName =
    (typeof entry.master_metadata_track_name === "string" &&
      entry.master_metadata_track_name) ||
    (typeof entry.trackName === "string" && entry.trackName) ||
    (typeof entry.track_name === "string" && entry.track_name) ||
    (typeof entry.name === "string" && entry.name) ||
    null;

  const artistNames = [
    ...asArtistNames(entry.master_metadata_album_artist_name),
    ...asArtistNames(entry.artistName),
    ...asArtistNames(entry.artist_name),
    ...asArtistNames(entry.artists),
  ].filter((name, i, arr) => arr.indexOf(name) === i);

  if (!trackName || artistNames.length === 0) {
    counts.malformed += 1;
    return null;
  }

  const albumName =
    (typeof entry.master_metadata_album_album_name === "string" &&
      entry.master_metadata_album_album_name) ||
    (typeof entry.albumName === "string" && entry.albumName) ||
    (typeof entry.album_name === "string" && entry.album_name) ||
    null;

  const msPlayed = asPositiveInt(entry.msPlayed ?? entry.ms_played ?? entry.msPlayTime);
  if (msPlayed === null) {
    counts.malformed += 1;
    return null;
  }
  // Kept as a measured play, but flagged: contributes no listening duration.
  if (msPlayed === 0) counts.zeroDurationPlays += 1;

  const tsValue = entry.ts ?? entry.endTime ?? entry.startTime ?? null;
  const timestamp = parseTimestamp(tsValue);

  const rawUri =
    typeof entry.spotify_track_uri === "string"
      ? entry.spotify_track_uri
      : typeof entry.uri === "string"
        ? entry.uri
        : null;
  if (rawUri?.startsWith("spotify:local:")) {
    // Local files have no stable id; composite key keeps them addressable.
    return {
      trackKey: compositeTrackKey(trackName, artistNames, albumName),
      timestamp,
      trackName: trackName.trim(),
      artistNames,
      albumName: albumName?.trim() || null,
      spotifyTrackId: null,
      msPlayed,
      source,
      importBatchId,
    };
  }
  const spotifyTrackId = spotifyIdFromUri(rawUri);

  return {
    trackKey:
      spotifyTrackId !== null
        ? `s:${spotifyTrackId}`
        : compositeTrackKey(trackName, artistNames, albumName),
    timestamp,
    trackName: trackName.trim(),
    artistNames,
    albumName: albumName?.trim() || null,
    spotifyTrackId,
    msPlayed,
    source,
    importBatchId,
  };
}

const FORMAT_LABEL: Record<DetectedFormat, string> = {
  extended: "Extended streaming history",
  "streaming-history": "Streaming history",
  "ends-with-time": "Streaming history (endTime)",
  unknown: "Unrecognized",
};

/**
 * Parse a single history JSON file into normalized records.
 * Pure aside from `crypto.randomUUID` for the batch id — callers can inject
 * their own id via options for deterministic tests.
 */
export function parseHistoryJson(
  text: string,
  options: { fileName: string; batchId?: string },
): ImportResult {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      preview: emptyPreview(options.fileName),
      records: [],
      errors: [`Not valid JSON: ${options.fileName}`],
    };
  }

  const { format, entries } = detectFormat(data);
  if (format === "unknown") {
    const { error } = detectArray(data);
    return {
      ok: false,
      preview: { ...emptyPreview(options.fileName), detectedFormat: FORMAT_LABEL.unknown },
      records: [],
      errors: [error ?? `Unrecognized history format: ${options.fileName}`],
    };
  }

  const batchId = options.batchId ?? crypto.randomUUID();
  const counts: NormalizeCounts = { skippedPodcasts: 0, malformed: 0, zeroDurationPlays: 0 };
  const records: ListeningRecord[] = [];
  for (const entry of entries) {
    const parsed = validateEntry(format, entry);
    if (!parsed.ok) {
      counts.malformed += 1;
      continue;
    }
    const record = entryToRecord(parsed.value, "imported", batchId, counts);
    if (record) records.push(record);
  }

  if (records.length === 0) {
    errors.push(`No music play records found in ${options.fileName}.`);
  }

  const uniqueKeys = new Set(records.map((r) => r.trackKey));
  const timestamps = records
    .map((r) => r.timestamp)
    .filter((t): t is number => t !== null);

  return {
    ok: records.length > 0,
    errors,
    records,
    preview: {
      fileName: options.fileName,
      detectedFormat: FORMAT_LABEL[format],
      recordCount: records.length,
      skippedPodcasts: counts.skippedPodcasts,
      malformedEntries: counts.malformed,
      zeroDurationPlays: counts.zeroDurationPlays,
      uniqueTracks: uniqueKeys.size,
      totalListeningMs: records.reduce((sum, r) => sum + r.msPlayed, 0),
      periodStartMs: timestamps.length ? Math.min(...timestamps) : null,
      periodEndMs: timestamps.length ? Math.max(...timestamps) : null,
      duplicateOfFile: null,
    },
  };
}

function detectArray(data: unknown): { error: string | null } {
  if (!Array.isArray(data)) {
    return { error: "History file must contain a JSON array of play records." };
  }
  return { error: null };
}

function emptyPreview(fileName: string): ImportPreview {
  return {
    fileName,
    detectedFormat: "Unrecognized",
    recordCount: 0,
    skippedPodcasts: 0,
    malformedEntries: 0,
    zeroDurationPlays: 0,
    uniqueTracks: 0,
    totalListeningMs: 0,
    periodStartMs: null,
    periodEndMs: null,
    duplicateOfFile: null,
  };
}
