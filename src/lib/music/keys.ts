/**
 * Stable identity helpers shared by import, aggregation and layout.
 * Everything here is pure and deterministic — no Date.now(), no Math.random().
 */

/** Lowercase, trim, collapse whitespace, strip diacritics and punctuation. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Normalized composite key used when no stable identifier exists.
 * Requires track name + at least one artist name; album folds in when present
 * but an empty album must match "unknown album" records only if both are empty,
 * so missing albums never collide with real ones.
 */
export function compositeTrackKey(
  trackName: string,
  artistNames: string[],
  albumName: string | null | undefined,
): string {
  const track = normalizeName(trackName);
  const artists = artistNames
    .map(normalizeName)
    .filter(Boolean)
    .sort()
    .join("+");
  const album = albumName ? normalizeName(albumName) : "";
  return `c:${track}|${artists}|${album}`;
}

export function spotifyIdFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri.trim());
  return match ? match[1] : null;
}

export function spotifyIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /spotify\.com\/track\/([A-Za-z0-9]+)/.exec(url.trim());
  return match ? match[1] : null;
}

/** Deterministic 32-bit hash of a string (FNV-1a). */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic stream of pseudo-random values in [0, 1) derived from a
 * string seed. Used for layout jitter so the same dataset always reloads
 * with the identical universe.
 */
export function seededRandom(seed: string): () => number {
  let state = hashString(seed) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
