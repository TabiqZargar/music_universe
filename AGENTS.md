<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Music Universe — repo conventions

Interactive 3D Spotify-history galaxy (Next.js App Router + TypeScript +
React Three Fiber + Tailwind v4 + Zod + Vitest + Playwright). Client-only
app: no backend besides the one Spotify token-exchange route.

### Verify before claiming done

```bash
npm run verify     # lint && typecheck && unit tests && build
npm run test:e2e   # Playwright (chromium); starts dev server on port 3100
```

- `npm run typecheck` runs `next typegen && tsc --noEmit` — the `LayoutProps`
  typegen is required or `tsc` fails on `src/app/layout.tsx`.
- Playwright: browsers installed via `npx playwright install chromium`. If
  system libs are missing and you lack root, see the "Testing notes" section
  in README.md (`PLAYWRIGHT_EXTRA_LIB_PATH`). e2e asserts the HTML overlay,
  never WebGL pixels; restart stale dev servers with
  `pkill -f 'next[ ]dev'` (the bracket avoids matching your own command).

### Data invariants (do not regress)

- Positions are structural only: seeded from stable ids (`seededRandom` in
  `src/lib/music/keys.ts`) + Fibonacci-lattice genre regions. Never derive
  positions from listening values or record order — sizes (`normRadius`) are
  the only data-driven visual.
- Listening totals come only from measured records (import/demo). API mode
  sizes by Spotify popularity and must report total time as *unavailable*
  (`hasMeasuredListening === false`), never a fabricated number. API data must
  not be added to imported listening totals (enrichment-only in combined mode).
- Artist listening = full track time per credited artist (overlaps are
  documented, intentional). Never sum genres/artists to a global total.
- Malformed import entries (negative msPlayed, junk timestamps) are flagged,
  not clamped. Sensitive export fields (`ip_address`,
  `user_agent_decrypted`, `platform`, …) are dropped at parse time — a test
  asserts they never reach IndexedDB.
- Demo enrichment must be keyed by `normalizeName(artistName)`
  (`src/lib/music/demo.ts`) — lookups always normalize; raw keys silently
  produce an "Unclassified"-only universe.
- Timeframe windows anchor to the data end, not "now"
  (`src/lib/music/timeframe.ts`).

### State & rendering

- One provider: `src/state/universe-context.tsx` (`useUniverse`). Heavy
  derivations are `useMemo`'d; scene components are `memo`'d with stable
  props — don't add per-frame React state.
- Continuous motion (drift, pulse, camera easing) runs in the R3F frame loop
  via refs inside `src/components/universe/`; React state changes only on
  discrete events (select, hover, filter, zoom-band flip). `usePrefersReducedMotion`
  and `SceneStage` use lazy `useState` initializers — the lint config
  (`react-hooks/set-state-in-effect`) forbids sync setState in effects.
- `src/app/callback/page.tsx` wraps `use(searchParams)` in `<Suspense>` —
  required for prerender under `cacheComponents`.

### Spotify integration

- PKCE only; verifier/state/tokens in `sessionStorage` (keys `mu.pkce.*`,
  `mu.spotify.tokens`). Token exchange goes through `POST /api/spotify/token`
  (optional `SPOTIFY_CLIENT_SECRET`; `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` needed
  for API mode). Scopes in `src/lib/spotify/scopes.ts` — keep to the minimum
  read-only set.
- API client (`src/lib/spotify/api.ts`) handles 429 + `Retry-After` and
  pagination; OAuth failures surface through `sessionStorage` key
  `mu:spotify-error` read at boot.
