import { createPkcePair, randomUrlSafeString } from "./pkce";
import { SCOPE_STRING } from "./scopes";

/**
 * Session-scoped OAuth material.
 *
 * Security properties (documented in the README):
 * - The PKCE verifier, OAuth state and tokens live in sessionStorage, which is
 *   scoped to this tab and cleared when the browser session ends. Nothing is
 *   written to localStorage, cookies or URLs.
 * - Authorization codes and tokens are never logged or placed in shareable
 *   URLs; only `code` and `state` travel in the callback URL, and `state` is
 *   single-use with a 10-minute expiry.
 * - No client secret exists in browser code; the exchange uses PKCE only.
 */

const VERIFIER_KEY = "mu.pkce.verifier";
const STATE_KEY = "mu.pkce.state";
const TOKENS_KEY = "mu.spotify.tokens";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms after which the access token is unusable. */
  expiresAtMs: number;
  scopes: string[];
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof sessionStorage !== "undefined";
}

export function spotifyClientId(): string | null {
  const id = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
  return id && id.trim() !== "" ? id.trim() : null;
}

export function redirectUri(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.origin}/callback`;
}

export interface AuthRequest {
  verifier: string;
  state: string;
  authorizeUrl: string;
}

/**
 * Build the authorization URL after generating verifier/challenge/state.
 * The verifier and state are persisted for the callback exchange.
 */
export async function createAuthRequest(): Promise<AuthRequest | { error: string }> {
  const clientId = spotifyClientId();
  const uri = redirectUri();
  if (!clientId) {
    return {
      error:
        "Spotify client ID is not configured. Set NEXT_PUBLIC_SPOTIFY_CLIENT_ID in .env.local.",
    };
  }
  if (!uri) return { error: "Not running in a browser context." };

  const { verifier, challenge } = await createPkcePair();
  const state = randomUrlSafeString(24);
  if (isBrowser()) {
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ state, createdAtMs: Date.now() }));
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: uri,
    scope: SCOPE_STRING,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  return {
    verifier,
    state,
    authorizeUrl: `https://accounts.spotify.com/authorize?${params.toString()}`,
  };
}

export interface CallbackCode {
  code: string;
  state: string;
}

/** Validate callback parameters against the stored state. Single use. */
export function validateCallback(search: {
  code?: string | string[];
  state?: string;
  error?: string | string[];
}): { kind: "denied" } | { kind: "invalid"; reason: string } | { kind: "ok"; code: CallbackCode } {
  const error = firstOf(search.error);
  if (error) {
    clearPkce();
    return { kind: "denied" };
  }
  const code = firstOf(search.code);
  const state = firstOf(search.state);
  if (!code || !state) {
    return { kind: "invalid", reason: "Callback is missing the authorization code." };
  }
  if (!isBrowser()) return { kind: "invalid", reason: "No browser session." };
  const raw = sessionStorage.getItem(STATE_KEY);
  if (!raw) {
    return { kind: "invalid", reason: "Login session expired or already used. Please connect again." };
  }
  let stored: { state: string; createdAtMs: number };
  try {
    stored = JSON.parse(raw);
  } catch {
    clearPkce();
    return { kind: "invalid", reason: "Login session was corrupted. Please connect again." };
  }
  if (stored.state !== state) {
    clearPkce();
    return { kind: "invalid", reason: "OAuth state mismatch — possible CSRF. Connection aborted." };
  }
  if (Date.now() - stored.createdAtMs > STATE_MAX_AGE_MS) {
    clearPkce();
    return { kind: "invalid", reason: "Login session expired. Please connect again." };
  }
  return { kind: "ok", code: { code, state } };
}

export function takeVerifier(): string | null {
  if (!isBrowser()) return null;
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  clearPkce();
  return verifier;
}

export function clearPkce(): void {
  if (!isBrowser()) return;
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

function firstOf(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function exchangeCode(code: string, verifier: string): Promise<SpotifyTokens> {
  const uri = redirectUri();
  if (!uri) throw new Error("Missing redirect URI.");
  const response = await fetch("/api/spotify/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: uri }),
  });
  if (!response.ok) {
    throw new Error("Spotify rejected the authorization exchange. Please connect again.");
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!payload.access_token) {
    throw new Error("Spotify returned no access token.");
  }
  const tokens: SpotifyTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAtMs: Date.now() + (payload.expires_in ?? 3600) * 1000 - 30_000,
    scopes: (payload.scope ?? SCOPE_STRING).split(" ").filter(Boolean),
  };
  saveTokens(tokens);
  return tokens;
}

export async function refreshTokens(refreshToken: string): Promise<SpotifyTokens> {
  const response = await fetch("/api/spotify/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!response.ok) throw new Error("refresh-failed");
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!payload.access_token) throw new Error("refresh-failed");
  const tokens: SpotifyTokens = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? refreshToken,
    expiresAtMs: Date.now() + (payload.expires_in ?? 3600) * 1000 - 30_000,
    scopes: (payload.scope ?? SCOPE_STRING).split(" ").filter(Boolean),
  };
  saveTokens(tokens);
  return tokens;
}

export function saveTokens(tokens: SpotifyTokens): void {
  if (!isBrowser()) return;
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function loadTokens(): SpotifyTokens | null {
  if (!isBrowser()) return null;
  const raw = sessionStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SpotifyTokens;
    if (typeof parsed.accessToken !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  if (!isBrowser()) return;
  sessionStorage.removeItem(TOKENS_KEY);
}

/** Returns a valid access token, refreshing once if expired. */
export async function getAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAtMs) return tokens.accessToken;
  if (!tokens.refreshToken) {
    clearTokens();
    return null;
  }
  try {
    const refreshed = await refreshTokens(tokens.refreshToken);
    return refreshed.accessToken;
  } catch {
    clearTokens();
    return null;
  }
}
