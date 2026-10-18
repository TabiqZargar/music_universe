import type { ListeningRecord, TimeframeOption } from "@/types/domain";

export interface TimeframeSelection {
  id: TimeframeOption["id"];
  range: { startMs: number; endMs: number } | null;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Offer timeframes only when the dataset actually spans them. Windows are
 * anchored to the most recent record (not "now"), so an old import never
 * yields an empty selection and never implies a lifetime history exists.
 */
export function timeframeOptions(
  records: ListeningRecord[],
): { options: TimeframeOption[]; dataEndMs: number | null } {
  const stamps = records
    .map((r) => r.timestamp)
    .filter((t): t is number => t !== null);
  if (stamps.length === 0) return { options: [{ id: "all", label: "All history" }], dataEndMs: null };
  const start = Math.min(...stamps);
  const end = Math.max(...stamps);
  const span = end - start;
  const options: TimeframeOption[] = [];
  if (span >= 28 * DAY) {
    options.push({ id: "4w", label: "Last 4 weeks of data" });
  }
  if (span >= 182 * DAY) {
    options.push({ id: "6m", label: "Last 6 months of data" });
  }
  options.push({ id: "all", label: "All history" });
  return { options, dataEndMs: end };
}

export function timeframeRange(
  id: TimeframeOption["id"],
  dataEndMs: number | null,
): { startMs: number; endMs: number } | null {
  if (id === "all" || dataEndMs === null) return null;
  const windowMs = id === "4w" ? 28 * DAY : 182 * DAY;
  return { startMs: dataEndMs - windowMs, endMs: dataEndMs };
}

export function recordsInRange(
  records: ListeningRecord[],
  range: { startMs: number; endMs: number } | null,
): ListeningRecord[] {
  if (!range) return records;
  return records.filter((r) => {
    if (r.timestamp === null) return false;
    return r.timestamp >= range.startMs && r.timestamp <= range.endMs;
  });
}
