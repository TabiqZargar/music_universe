import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTokens,
  createAuthRequest,
  exchangeCode,
  getAccessToken,
  loadTokens,
  saveTokens,
  spotifyClientId,
  takeVerifier,
  validateCallback,
} from "@/lib/spotify/auth";
import {
  challengeFromVerifier,
  createPkcePair,
  randomUrlSafeString,
} from "@/lib/spotify/pkce";

function stubTokenRoute(payload: unknown, status = 200) {
  const mock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_SPOTIFY_CLIENT_ID", "test-client-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PKCE primitives", () => {
  it("generates URL-safe random strings", () => {
    const a = randomUrlSafeString(48);
    const b = randomUrlSafeString(48);
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(a).not.toBe(b);
  });

  it("derives the RFC 7636 S256 challenge", async () => {
    // Verifier/challenge pair from RFC 7636 Appendix B.
    await expect(
      challengeFromVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("createPkcePair returns a matching verifier/challenge", async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(await challengeFromVerifier(verifier)).toBe(challenge);
  });
});

describe("createAuthRequest", () => {
  it("persists the verifier/state and builds an S256 authorize URL", async () => {
    const request = await createAuthRequest();
    expect("authorizeUrl" in request).toBe(true);
    if (!("authorizeUrl" in request)) return;

    const url = new URL(request.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      await challengeFromVerifier(request.verifier),
    );
    expect(url.searchParams.get("state")).toBe(request.state);
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/callback$/);

    expect(takeVerifier()).toBe(request.verifier);
    // takeVerifier is single-use: the PKCE material is gone afterwards.
    expect(takeVerifier()).toBeNull();
  });

  it("reports a helpful error when the client id is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_SPOTIFY_CLIENT_ID", "");
    expect(spotifyClientId()).toBeNull();
    const request = await createAuthRequest();
    expect("error" in request && request.error).toMatch(/client ID/i);
  });
});

describe("validateCallback", () => {
  it("rejects a denied authorization and clears PKCE state", async () => {
    await createAuthRequest();
    expect(validateCallback({ error: "access_denied" })).toEqual({ kind: "denied" });
    expect(takeVerifier()).toBeNull();
  });

  it("accepts a matching code and state", async () => {
    const request = await createAuthRequest();
    if (!("state" in request)) throw new Error("expected auth request");
    expect(validateCallback({ code: "abc", state: request.state })).toEqual({
      kind: "ok",
      code: { code: "abc", state: request.state },
    });
  });

  it("rejects a missing code", async () => {
    const request = await createAuthRequest();
    if (!("state" in request)) throw new Error("expected auth request");
    const result = validateCallback({ state: request.state });
    expect(result.kind).toBe("invalid");
  });

  it("rejects a state mismatch (CSRF) and clears PKCE state", async () => {
    await createAuthRequest();
    const result = validateCallback({ code: "abc", state: "forged-state" });
    expect(result.kind).toBe("invalid");
    expect(takeVerifier()).toBeNull();
  });

  it("rejects an expired state", async () => {
    await createAuthRequest();
    sessionStorage.setItem(
      "mu.pkce.state",
      JSON.stringify({ state: "s", createdAtMs: Date.now() - 11 * 60 * 1000 }),
    );
    expect(validateCallback({ code: "abc", state: "s" }).kind).toBe("invalid");
  });

  it("rejects corrupted stored state without throwing", async () => {
    sessionStorage.setItem("mu.pkce.state", "{not json");
    expect(validateCallback({ code: "abc", state: "s" }).kind).toBe("invalid");
  });
});

describe("token exchange and refresh", () => {
  it("exchanges a code, storing the access token", async () => {
    const fetchMock = stubTokenRoute({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: "user-top-read user-read-recently-played",
    });
    const tokens = await exchangeCode("code-1", "verifier-1");
    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.scopes).toEqual(["user-top-read", "user-read-recently-played"]);
    expect(loadTokens()?.accessToken).toBe("access-1");

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code_verifier).toBe("verifier-1");
  });

  it("throws when the exchange is rejected", async () => {
    stubTokenRoute({ error: "invalid_grant" }, 400);
    await expect(exchangeCode("code", "verifier")).rejects.toThrow(/rejected/i);
  });
});

describe("getAccessToken", () => {
  it("returns null without stored tokens", async () => {
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("returns a live token without refreshing", async () => {
    saveTokens({
      accessToken: "live",
      refreshToken: null,
      expiresAtMs: Date.now() + 60_000,
      scopes: [],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(getAccessToken()).resolves.toBe("live");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token when a refresh token exists", async () => {
    saveTokens({
      accessToken: "old",
      refreshToken: "refresh-1",
      expiresAtMs: Date.now() - 1000,
      scopes: [],
    });
    stubTokenRoute({ access_token: "new", expires_in: 3600 });
    await expect(getAccessToken()).resolves.toBe("new");
    expect(loadTokens()?.accessToken).toBe("new");
  });

  it("clears tokens when an expired token cannot be refreshed", async () => {
    saveTokens({
      accessToken: "old",
      refreshToken: null,
      expiresAtMs: Date.now() - 1000,
      scopes: [],
    });
    await expect(getAccessToken()).resolves.toBeNull();
    expect(loadTokens()).toBeNull();
    clearTokens();
  });
});
