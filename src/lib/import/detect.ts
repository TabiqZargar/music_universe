import { z } from "zod";
import {
  extendedHistoryEntrySchema,
  streamingHistoryEntrySchema,
} from "@/lib/validation/schemas";

export type DetectedFormat =
  | "extended"
  | "streaming-history"
  | "ends-with-time"
  | "unknown";

export interface DetectedFile {
  format: DetectedFormat;
  entries: unknown[];
}

/**
 * Detect which Spotify export shape a parsed JSON array uses.
 * Heuristics run on the first few entries so we never assume every export
 * uses exactly one format.
 */
export function detectFormat(data: unknown): DetectedFile {
  if (!Array.isArray(data)) {
    return { format: "unknown", entries: [] };
  }
  const sample = data.slice(0, 10);
  const hasKey = (key: string) =>
    sample.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        key in (entry as Record<string, unknown>),
    );

  if (hasKey("master_metadata_track_name") || hasKey("ts")) {
    return { format: "extended", entries: data };
  }
  if (hasKey("endTime")) {
    return { format: "ends-with-time", entries: data };
  }
  if (hasKey("startTime") || hasKey("ts")) {
    return { format: "streaming-history", entries: data };
  }
  return { format: "unknown", entries: data };
}

export function validateEntry(
  format: DetectedFormat,
  entry: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const schema =
    format === "extended"
      ? extendedHistoryEntrySchema
      : streamingHistoryEntrySchema;
  const result = safeParse(schema, entry);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? "invalid" };
  }
  return { ok: true, value: result.data as Record<string, unknown> };
}

function safeParse(schema: z.ZodType, entry: unknown) {
  return schema.safeParse(entry);
}

/** File names that are clearly streaming history in a Spotify export ZIP. */
const HISTORY_FILE_PATTERN =
  /streaming[-_ ]?history|endsong|listen(_|-)?history/i;

export function isHistoryFileName(name: string): boolean {
  return HISTORY_FILE_PATTERN.test(name) && name.toLowerCase().endsWith(".json");
}

/** Fields that must never be persisted (privacy rule 9). */
export const DROPPED_FIELDS = [
  "ip_address",
  "ip_address_truncated",
  "user_agent_decrypted",
  "platform",
  "conn_country",
  "device_id",
  "offline",
  "offline_timestamp",
  "started_at",
  "country",
  "region",
] as const;
