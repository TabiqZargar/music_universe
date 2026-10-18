import type { NextRequest } from "next/server";

/**
 * Server-side token exchange for the PKCE Authorization Code flow.
 * The browser never talks to accounts.spotify.com with the code directly, so
 * CORS never matters; no client secret is required for public PKCE clients
 * (if SPOTIFY_CLIENT_SECRET is configured it is used, enabling confidential
 * clients too). Tokens pass through this handler transiently and are never
 * logged or stored server-side.
 */

const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";

interface TokenRequestBody {
  grant_type?: string;
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
  refresh_token?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: TokenRequestBody;
  try {
    body = (await request.json()) as TokenRequestBody;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  if (body.grant_type !== "authorization_code" && body.grant_type !== "refresh_token") {
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }
  if (body.grant_type === "authorization_code" && (!body.code || !body.code_verifier || !body.redirect_uri)) {
    return Response.json({ error: "missing_parameters" }, { status: 400 });
  }
  if (body.grant_type === "refresh_token" && !body.refresh_token) {
    return Response.json({ error: "missing_parameters" }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: "client_not_configured" }, { status: 503 });
  }

  const params = new URLSearchParams({ grant_type: body.grant_type });
  if (body.grant_type === "authorization_code") {
    params.set("code", body.code!);
    params.set("code_verifier", body.code_verifier!);
    params.set("redirect_uri", body.redirect_uri!);
  } else {
    params.set("refresh_token", body.refresh_token!);
  }

  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (secret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`;
    params.delete("client_id");
  } else {
    params.set("client_id", clientId);
  }

  try {
    const upstream = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers,
      body: params,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await upstream.json()) as Record<string, unknown>;
    if (!upstream.ok) {
      // Spotify error responses contain no tokens; only the error code is relayed.
      return Response.json({ error: payload.error ?? "exchange_failed" }, { status: upstream.status });
    }
    return Response.json(payload);
  } catch {
    return Response.json({ error: "upstream_unreachable" }, { status: 502 });
  }
}
