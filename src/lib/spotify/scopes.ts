/**
 * OAuth scopes, each mapped to the feature that needs it.
 * Kept to the minimum read-only set this app actually calls.
 */
export const SPOTIFY_SCOPES: { scope: string; reason: string }[] = [
  {
    scope: "user-read-private",
    reason: "Reads your profile (display name) for the connection panel.",
  },
  {
    scope: "user-top-read",
    reason: "Reads top artists and tracks to enrich genre metadata and build a universe when no history is imported.",
  },
  {
    scope: "user-read-recently-played",
    reason: "Reads recently played tracks for timelines when no history is imported.",
  },
];

export const SCOPE_STRING = SPOTIFY_SCOPES.map((s) => s.scope).join(" ");
