import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRecentlyPlayed,
  mergeTopArtists,
  mergeTopTracks,
  spotifyGet,
  SpotifyApiError,
  type SpotifyArtistObject,
  type SpotifyTrackObject,
} from "@/lib/spotify/api";
import { saveTokens } from "@/lib/spotify/auth";

function liveToken() {
  saveTokens({
    accessToken: "token",
    refreshToken: null,
    expiresAtMs: Date.now() + 60_000,
    scopes: [],
  });
}

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? headers[key] ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("spotifyGet", () => {
  it("throws not_authorized without a token", async () => {
    await expect(spotifyGet("/me")).rejects.toMatchObject({ status: 401, message: "not_authorized" });
  });

  it("maps 403 to a typed forbidden error", async () => {
    liveToken();
    vi.stubGlobal("fetch", vi.fn(async () => res(403, {})));
    await expect(spotifyGet("/me/top/artists")).rejects.toMatchObject({
      status: 403,
      message: "forbidden",
    });
    vi.unstubAllGlobals();
  });

  it("maps 401 to token_expired", async () => {
    liveToken();
    vi.stubGlobal("fetch", vi.fn(async () => res(401, {})));
    await expect(spotifyGet("/me")).rejects.toMatchObject({ message: "token_expired" });
    vi.unstubAllGlobals();
  });

  it("surfaces other HTTP failures with their status", async () => {
    liveToken();
    vi.stubGlobal("fetch", vi.fn(async () => res(500, {})));
    await expect(spotifyGet("/me")).rejects.toMatchObject({ status: 500 });
    vi.unstubAllGlobals();
  });

  it("honors Retry-After and retries a 429", async () => {
    liveToken();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(429, {}, { "retry-after": "0" }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(spotifyGet("/me/top/artists")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("gives up after the retry budget and reports rate_limited", async () => {
    vi.useFakeTimers();
    liveToken();
    const fetchMock = vi.fn(async () => res(429, {}, { "retry-after": "0" }));
    vi.stubGlobal("fetch", fetchMock);
    const promise = spotifyGet("/me/top/artists");
    const assertion = expect(promise).rejects.toBeInstanceOf(SpotifyApiError);
    await vi.runAllTimersAsync();
    await assertion;
    // initial + MAX_RETRIES attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a network failure once, then reports network_error", async () => {
    vi.useFakeTimers();
    liveToken();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const promise = spotifyGet("/me/top/artists");
    const assertion = expect(promise).rejects.toMatchObject({ status: 0, message: "network_error" });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("fetchRecentlyPlayed pagination", () => {
  const item = (playedAt: string, id: string) => ({
    played_at: playedAt,
    track: { id, name: `Track ${id}`, artists: [{ id: "a", name: "Artist" }] },
  });

  it("advances with the response cursors.before value", async () => {
    liveToken();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        res(200, {
          items: [item("2026-01-02T00:00:00.000Z", "1")],
          next: "https://api.spotify.com/v1/me/player/recently-played?before=1000",
          cursors: { before: "1000", after: "2000" },
        }),
      )
      .mockResolvedValueOnce(
        res(200, { items: [item("2026-01-01T00:00:00.000Z", "2")], next: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchRecentlyPlayed();
    expect(items.map((i) => i.track.id)).toEqual(["1", "2"]);
    const secondUrl = (fetchMock.mock.calls[1] as unknown as [string])[0];
    expect(secondUrl).toContain("before=1000");
    vi.unstubAllGlobals();
  });

  it("falls back to the oldest played_at when cursors are absent", async () => {
    liveToken();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        res(200, {
          items: [item("2026-01-02T00:00:00.000Z", "1")],
          next: "next",
        }),
      )
      .mockResolvedValueOnce(res(200, { items: [], next: null }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchRecentlyPlayed();
    const secondUrl = (fetchMock.mock.calls[1] as unknown as [string])[0];
    const expected = String(Date.parse("2026-01-02T00:00:00.000Z"));
    expect(secondUrl).toContain(`before=${expected}`);
    vi.unstubAllGlobals();
  });

  it("stops instead of looping when the cursor does not advance", async () => {
    liveToken();
    const fetchMock = vi.fn(async () =>
      res(200, {
        items: [item("2026-01-02T00:00:00.000Z", "1")],
        next: "next",
        cursors: { before: "1000" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchRecentlyPlayed();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

describe("top-range merging", () => {
  const artist = (id: string, name: string, genres: string[] = []): SpotifyArtistObject => ({
    id,
    name,
    genres,
  });

  it("dedupes artists across ranges, preserves first-seen order, unions genres", () => {
    const merged = mergeTopArtists([
      [artist("1", "A", ["indie"])],
      [artist("1", "A", ["pop"]), artist("2", "B")],
    ]);
    expect(merged.map((a) => a.id)).toEqual(["1", "2"]);
    expect(merged[0].genres?.sort()).toEqual(["indie", "pop"]);
  });

  it("dedupes tracks across ranges", () => {
    const track = (id: string): SpotifyTrackObject => ({
      id,
      name: id,
      artists: [{ name: "A" }],
    });
    const merged = mergeTopTracks([[track("1")], [track("1"), track("2")]]);
    expect(merged.map((t) => t.id)).toEqual(["1", "2"]);
  });
});
