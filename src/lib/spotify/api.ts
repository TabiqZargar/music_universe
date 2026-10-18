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
}

export interface TopItemsOptions {
  timeRange?: "short_term" | "medium_term" | "long_term";
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

export interface RecentlyPlayedItem {
  played_at: string;
  track: SpotifyTrackObject;
}

/** Uses the `before` cursor; limited to 10 pages (500 plays). */
export async function fetchRecentlyPlayed(maxPages = 10): Promise<RecentlyPlayedItem[]> {
  const collected: RecentlyPlayedItem[] = [];
  let before: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = before
      ? `limit=50&before=${before}`
      : "limit=50";
    const batch: Paging<RecentlyPlayedItem> = await spotifyGet<Paging<RecentlyPlayedItem>>(
      `/me/player/recently-played?${qs}`,
    );
    collected.push(...batch.items);
    const oldest = batch.items[batch.items.length - 1];
    if (!batch.next || !batch.items.length || !oldest) break;
    before = new Date(oldest.played_at).getTime().toString();
  }
  return collected;
}
