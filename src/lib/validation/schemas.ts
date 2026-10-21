import { z } from "zod";

/**
 * Schema for normalized listening records after import/normalization.
 * Used to validate persisted datasets and graph inputs before rendering.
 */
export const listeningRecordSchema = z.object({
  trackKey: z.string().min(1),
  timestamp: z.number().int().nonnegative().nullable(),
  trackName: z.string().min(1),
  artistNames: z.array(z.string().min(1)).min(1),
  albumName: z.string().min(1).nullable(),
  spotifyTrackId: z.string().min(1).nullable(),
  msPlayed: z.number().int().nonnegative(),
  source: z.enum(["imported", "spotify-api", "demo"]),
  importBatchId: z.string().min(1),
});

export const listeningRecordsSchema = z.array(listeningRecordSchema);

/** Raw record shapes as they arrive from Spotify exports before normalization. */
export const extendedHistoryEntrySchema = z
  .object({
    ts: z.string().min(1),
    // Spotify writes `ms_played` as a float in real Extended Streaming History
    // exports; the importer rounds to whole milliseconds.
    ms_played: z.number().nonnegative().optional(),
    master_metadata_track_name: z.string().nullable().optional(),
    master_metadata_album_artist_name: z.string().nullable().optional(),
    master_metadata_album_album_name: z.string().nullable().optional(),
    spotify_track_uri: z.string().nullable().optional(),
    episode_uri: z.string().nullable().optional(),
    track_name: z.string().nullable().optional(),
    artist_name: z.string().nullable().optional(),
    album_name: z.string().nullable().optional(),
    uri: z.string().nullable().optional(),
  })
  .passthrough();

export const streamingHistoryEntrySchema = z
  .object({
    endTime: z.string().min(1).optional(),
    startTime: z.string().min(1).optional(),
    ts: z.string().min(1).optional(),
    artistName: z.union([z.string().nullable(), z.array(z.string())]).optional(),
    trackName: z.string().nullable().optional(),
    albumName: z.string().nullable().optional(),
    msPlayed: z.number().optional(),
    ms_played: z.number().optional(),
    msPlayTime: z.number().optional(),
  })
  .passthrough();

/**
 * Fields intentionally dropped from imports: IP addresses, device ids,
 * user agents. Their presence is detected so tests can assert they never
 * reach storage.
 */
export const SENSITIVE_FIELDS = [
  "ip_address",
  "ip_address_truncated",
  "user_agent_decrypted",
  "platform",
  "conn_country",
  "device_id",
  "offline",
  "offline_timestamp",
  "secret_boarding_for_country",
] as const;

export function parseHistoryArray(
  data: unknown,
): { entries: unknown[]; error: string | null } {
  if (!Array.isArray(data)) {
    return { entries: [], error: "History file must contain a JSON array." };
  }
  return { entries: data, error: null };
}
