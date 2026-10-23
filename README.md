# Music Universe

An interactive 3D galaxy of a Spotify listening history: every artist, album
and track is a star sized by listening time and placed in a stable genre
region. Built with Next.js (App Router), TypeScript, React Three Fiber and
Tailwind CSS — fully client-side, no backend, no telemetry.

## What it does

- **Demo universe first** — opens instantly with a deterministic synthetic
  dataset; connect or import later.
- **Import your history** — Spotify Extended Streaming History
  (`StreamingHistory*.json`, `endsong_*.json`) or a ZIP containing them.
  Parsed, validated and stored on-device (IndexedDB). Merge or replace,
  duplicate-file detection (re-importing the same export is idempotent — no
  records or batches are duplicated), podcast skipping, malformed-entry
  flagging, and zero-duration plays counted but flagged rather than silently
  dropped.
- **Optional Spotify API mode** — PKCE OAuth (tokens in `sessionStorage`
  only), top artists/tracks across **all three time ranges** and recent plays.
  API rankings size nodes (by popularity when Spotify returns it, otherwise by
  ranking position) but never inflate listening totals; with no imported
  history the stats bar reports listening as *unavailable* instead of
  fabricating it.
- **Explore** — orbit/zoom camera, click-to-focus, search, entity/genre/min-time
  filters, timeframe windows (4 weeks / 6 months / all history, anchored to the
  data end), detail panel with per-month timelines, top lists, keyboard
  support (Escape), reduced-motion support, WebGL fallback screen.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

### Import-first (no Spotify API needed)

The app works fully offline. To see your real listening history:

1. Request your data from Spotify: **Account → Privacy → Download your data**
   and select **Extended streaming history**. Spotify does **not** provide an
   instant or guaranteed download — requests can take several days and arrive
   by email.
2. Import the JSON files (or the ZIP that contains them) via the **Import**
   button. You may need **multiple** files across the archive
   (`StreamingHistory*.json`, `endsong_*.json`).
3. Re-importing is safe: identical files and overlapping plays are deduplicated,
   so importing extra files never inflates your totals.

The demo universe stays available for exploration even without an export.

Optional Spotify API mode — copy `.env.example` to `.env.local` and set
`NEXT_PUBLIC_SPOTIFY_CLIENT_ID` (plus `SPOTIFY_CLIENT_SECRET` if you want
server-side exchange). Add `http://127.0.0.1:3000/callback` as a redirect URI
in your Spotify app and open the app at **http://127.0.0.1:3000** so the
generated redirect URI matches. Spotify rejects `localhost` redirect URIs —
use the loopback IP literal:

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000   # http://127.0.0.1:3000
```

### Spotify API prerequisites & limitations

Spotify's Feb 2026 rules shape what API mode can show:

- **Development mode** (the default for new apps) requires the app owner to
  have Premium and allows at most 5 authorized users, plus per-user rate
  limits. Users not added to the app get a `403`, which the connection panel
  surfaces explicitly.
- `popularity`, `followers` and `genres` were **removed or deprecated** on
  Track/Artist objects, and the `/me` response no longer returns
  `country`/`email`/`product`. API mode therefore sizes nodes by the merged
  ranking position and falls back to *Unclassified* genres when Spotify
  returns none — it never invents values.
- `GET /me/player/recently-played` is a shallow window (the last ~50 plays,
  paginated via `cursors.before`), not a full ledger — import your Extended
  Streaming History for real listening totals. Example individual responses,
  batch endpoints and search beyond 10 results are not used.
- Requested scopes stay minimal: `user-read-private`, `user-top-read`,
  `user-read-recently-played`. Redirect URIs must be HTTPS in production;
  for local development use a loopback IP literal (`http://127.0.0.1:PORT`) —
  `localhost` is rejected by Spotify, and loopback ports may be registered
  dynamically.
- **The Web API may simply be unavailable to you.** Spotify can disable or
  omit Web API access for Free accounts, and dashboard options may be missing
  or disabled for other account/region reasons. That is outside this app's
  control and does not block import mode — the connection panel says so
  explicitly rather than treating it as a bug or fabricating data.

## Scripts

| Command              | What it runs                                  |
| -------------------- | --------------------------------------------- |
| `npm run dev`        | Next.js dev server (Turbopack)                |
| `npm run build`      | Production build                              |
| `npm run lint`       | ESLint                                        |
| `npm run typecheck`  | `tsc --noEmit` (run `npx next typegen` first) |
| `npm test`           | Vitest unit/component tests (jsdom)           |
| `npm run test:e2e`   | Playwright end-to-end suite (chromium)        |
| `npm run verify`     | lint + typecheck + unit + build               |

## Testing notes

- Unit tests live in `tests/*.test.ts(x)`; e2e in `tests/e2e/*.spec.ts` with
  fixtures in `tests/fixtures/`.
- Playwright starts its own dev server on port **3100** (see
  `playwright.config.ts`) and reuses an existing one outside CI. First run
  needs `npx playwright install chromium`.
- If the machine cannot install browser system libraries system-wide
  (`playwright install-deps` needs root), extract `libnspr4`, `libnss3` and
  `libasound2` debs into a directory and point `PLAYWRIGHT_EXTRA_LIB_PATH` at
  it — the config already defaults to the path this repo's environment uses.
- e2e tests never depend on WebGL pixels: interaction is asserted through the
  HTML overlay; the mocked-Spotify test intercepts `api.spotify.com` and
  `/api/spotify/token` with `page.route`.

## Privacy

- Imported history never leaves the device; sensitive export fields (IP
  address, decrypted user agent, platform, …) are dropped at parse time and a
  test asserts they never reach storage.
- Spotify tokens are kept in per-tab `sessionStorage` and cleared on
  disconnect; the authorization exchange goes through `/api/spotify/token`,
  never a third party. No client secret ships to the browser (PKCE).
- Demo, imported and API data are visually and structurally separated; demo
  records are never mixed into user statistics.

## Architecture

```
src/
  app/                 page, /callback (OAuth), /api/spotify/token
  components/
    universe/          scene layer (R3F): NodeField, GenreRegions,
                       ConnectionLines, CameraRig, Starfield, UniverseScene
    ui/                overlay: HeaderBar, SearchBar, FilterPanel,
                       DetailPanel, StatsBar, ImportDialog, ConnectionPanel…
  lib/
    import/            schema detection, parsing, ZIP, merge/replace
    music/             pure core: aggregate, graph, filters, search,
                       timeframe, sizing, demo dataset
    spotify/           PKCE, auth, rate-limited API client, normalization
    storage/           IndexedDB repository
    ui/                formatters
  state/universe-context.tsx   single provider: dataset → graph → filters
```

Deterministic core: node positions derive only from stable ids (seeded PRNG +
genre regions), so structure never shifts when listening numbers change;
listening totals only ever come from measured records.
