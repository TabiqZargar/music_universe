export type RadiusKind = "genre" | "artist" | "album" | "track";

/** Type-specific world-space radius ranges. */
export const RADIUS_RANGES: Record<RadiusKind, { min: number; max: number }> = {
  genre: { min: 6, max: 16 },
  artist: { min: 1.1, max: 3.4 },
  album: { min: 0.55, max: 1.5 },
  track: { min: 0.28, max: 0.85 },
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Bounded square-root scale (spec §10):
 *   radius = min + (max - min) * sqrt(clamp(value / maxValue, 0, 1))
 * Zero totals, negative values and empty datasets all resolve to `min`.
 */
export function radiusFor(
  kind: RadiusKind,
  value: number,
  maxValue: number,
): number {
  const { min, max } = RADIUS_RANGES[kind];
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) {
    return min;
  }
  const t = clamp(value / maxValue, 0, 1);
  return min + (max - min) * Math.sqrt(t);
}

export function normalizedRadius(
  value: number,
  maxValue: number,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) {
    return 0;
  }
  return Math.sqrt(clamp(value / maxValue, 0, 1));
}
