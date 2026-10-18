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
  duplicate-file detection, podcast skipping, malformed-entry flagging.
- **Optional Spotify API mode** — PKCE OAuth (tokens in `sessionStorage`
  only), top artists/tracks and recent plays. API rankings size nodes but
  never inflate listening totals; with no imported history the stats bar
  reports listening as *unavailable* instead of fabricating it.
- **Explore** — orbit/zoom camera, click-to-focus, search, entity/genre/min-time
  filters, timeframe windows (4 weeks / 6 months / all history, anchored to the
  data end), detail panel with per-month timelines, top lists, keyboard
  support (Escape), reduced-motion support, WebGL fallback screen.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Optional Spotify API mode — copy `.env.example` to `.env.local` and set
`NEXT_PUBLIC_SPOTIFY_CLIENT_ID` (plus `SPOTIFY_CLIENT_SECRET` if you want
server-side exchange). Add `http://localhost:3000/callback` as a redirect URI
in your Spotify app.

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
