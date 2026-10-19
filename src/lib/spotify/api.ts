import { getAccessToken } from "./auth";

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

const MAX_RETRIES = 2;

/**
 * GET with rate-limit awareness: honors `Retry-After` on 429 with capped
 * backoff, never retries other failures more than once, and always surfaces a
 * typed error instead of a raw exception. Tokens are attached from the session
 * and never logged.
 */
export async function spotifyGet<T>(path: string): Promise<T> {
  const url = path.startsWith("http") ? path : `https://api.spotify.com/v1${path}`;
  let attempt = 0;
  for (;;) {
    const token = await getAccessToken();
    if (!token) throw new SpotifyApiError("not_authorized", 401);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      if (attempt < 1) {
        attempt += 1;
        await delay(500 * attempt);
        continue;
      }
      throw new SpotifyApiError("network_error", 0);
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      attempt += 1;
      const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
      await delay(Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000, 5_000));
      continue;
    }
    if (response.status === 429) {
      throw new SpotifyApiError("rate_limited", 429, true);
    }
    if (response.status === 401) {
      throw new SpotifyApiError("token_expired", 401);
    }
    if (response.status === 403) {
      // Dev-mode apps and scopes not granted by the user surface as 403.
      throw new SpotifyApiError("forbidden", 403);
    }
    if (!response.ok) {
      throw new SpotifyApiError(`spotify_http_${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Wire types (subset we rely on; extra fields ignored) ---

export interface SpotifyProfile {
  id: string;
  display_name: string;
  images?: { url: string }[];
}

export interface SpotifyArtistObject {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;
  followers?: { total: number };
}

export interface SpotifyTrackObject {
  id: string;
  name: string;
  duration_ms?: number;
  popularity?: number;
  artists: { id?: string; name: string }[];
  album?: {
    name: string;
    images?: { url: string }[];
  };
}

interface Paging<T> {
  items: T[];
  next: string | null;
  total?: number;
  cursors?: { after?: string | null; before?: string | null };
}

export const TOP_TIME_RANGES = ["short_term", "medium_term", "long_term"] as const;
export type TopTimeRange = (typeof TOP_TIME_RANGES)[number];

export interface TopItemsOptions {
  timeRange?: TopTimeRange;
  maxPages?: number;
}

async function paginate<T>(
  initialPath: string,
  { maxPages = 4 }: { maxPages?: number } = {},
): Promise<T[]> {
  const collected: T[] = [];
  let path: string | null = initialPath;
  let pages = 0;
  while (path && pages < maxPages) {
    const page: Paging<T> = await spotifyGet<Paging<T>>(path);
    collected.push(...page.items);
    if (!page.next) break;
    path = page.next.replace("https://api.spotify.com/v1", "");
    pages += 1;
  }
  return collected;
}

export function fetchProfile(): Promise<SpotifyProfile> {
  return spotifyGet<SpotifyProfile>("/me");
}

export function fetchTopArtists(options: TopItemsOptions = {}): Promise<SpotifyArtistObject[]> {
  const range = options.timeRange ?? "medium_term";
  return paginate<SpotifyArtistObject>(
    `/me/top/artists?limit=50&time_range=${range}`,
    { maxPages: options.maxPages ?? 4 },
  );
}

export function fetchTopTracks(options: TopItemsOptions = {}): Promise<SpotifyTrackObject[]> {
  const range = options.timeRange ?? "medium_term";
  return paginate<SpotifyTrackObject>(
    `/me/top/tracks?limit=50&time_range=${range}`,
    { maxPages: options.maxPages ?? 4 },
  );
}

/**
 * Merge the same entity across the short/medium/long term rankings. The first
 * appearance wins (short term first), so list order encodes a combined affinity
 * rank. Genres (when Spotify still returns them) are unioned.
 */
export function mergeTopArtists(lists: SpotifyArtistObject[][]): SpotifyArtistObject[] {
  const byId = new Map<string, SpotifyArtistObject>();
  const order: string[] = [];
  for (const list of lists) {
    for (const artist of list) {
      const existing = byId.get(artist.id);
      if (!existing) {
        byId.set(artist.id, { ...artist, genres: [...(artist.genres ?? [])] });
        order.push(artist.id);
      } else {
        existing.genres = [...new Set([...(existing.genres ?? []), ...(artist.genres ?? [])])];
        existing.popularity ??= artist.popularity;
      }
    }
  }
  return order.map((id) => byId.get(id)!);
}

export function mergeTopTracks(lists: SpotifyTrackObject[][]): SpotifyTrackObject[] {
  const byId = new Map<string, SpotifyTrackObject>();
  const order: string[] = [];
  for (const list of lists) {
    for (const track of list) {
      if (byId.has(track.id)) continue;
      byId.set(track.id, track);
      order.push(track.id);
    }
  }
  return order.map((id) => byId.get(id)!);
}

export interface RecentlyPlayedItem {
  played_at: string;
  track: SpotifyTrackObject;
}

/**
 * Walk the recently-played pages using the response `cursors.before` value
 * (more precise than recomputing from the oldest timestamp), falling back to
 * the oldest `played_at` only when Spotify omits it. Limited to 10 pages.
 */
export async function fetchRecentlyPlayed(maxPages = 10): Promise<RecentlyPlayedItem[]> {
  const collected: RecentlyPlayedItem[] = [];
  let before: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = before ? `limit=50&before=${before}` : "limit=50";
    const batch: Paging<RecentlyPlayedItem> = await spotifyGet<Paging<RecentlyPlayedItem>>(
      `/me/player/recently-played?${qs}`,
    );
    collected.push(...batch.items);
    if (!batch.next || batch.items.length === 0) break;

    const cursor = batch.cursors?.before;
    let nextBefore: string | null =
      typeof cursor === "string" && /^\d+$/.test(cursor) ? cursor : null;
    if (!nextBefore) {
      const oldest = batch.items[batch.items.length - 1];
      const ts = oldest ? Date.parse(oldest.played_at) : Number.NaN;
      nextBefore = Number.isNaN(ts) ? null : String(ts);
    }
    // Stop rather than loop forever if the cursor does not advance.
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;
  }
  return collected;
}
