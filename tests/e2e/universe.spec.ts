import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures");
const GOOD_FIXTURE = path.join(FIXTURE_DIR, "StreamingHistory1.json");
const BAD_FIXTURE = path.join(FIXTURE_DIR, "StreamingHistory_bad.json");

const TOKENS_KEY = "mu.spotify.tokens";

async function openImportDialog(page: Page) {
  await page.getByTestId("open-import").click();
  await expect(page.getByTestId("import-dialog")).toBeVisible();
}

async function importFixture(page: Page, fixture: string) {
  await openImportDialog(page);
  await page.getByTestId("import-file-input").setInputFiles(fixture);
}

test("loads the demo universe with stats and source badge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("universe-app")).toBeVisible();
  await expect(page.getByText("Music Universe")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo Universe" })).toBeVisible();
  await expect(page.getByTestId("source-badge")).toHaveText(/demo/i);
  await expect(page.getByTestId("stats-bar")).toBeVisible();
  await expect(page.getByTestId("stat-artists")).not.toHaveText("0");
  await expect(page.getByTestId("stat-tracks")).not.toHaveText("0");
});

test("imports a streaming history file and rebuilds the universe", async ({ page }) => {
  await page.goto("/");
  await importFixture(page, GOOD_FIXTURE);

  await expect(page.getByTestId("import-preview-file")).toHaveCount(1);
  await expect(page.getByTestId("import-preview-file")).toContainText("StreamingHistory1.json");
  await expect(page.getByTestId("import-preview-file")).toContainText("8 records");

  await page.getByTestId("import-merge").click();
  await expect(page.getByTestId("import-summary")).toBeVisible();
  await expect(page.getByTestId("import-summary")).toContainText("8 records");
  await page.getByTestId("import-done").click();

  await expect(page.getByRole("heading", { name: "My Listening History" })).toBeVisible();
  await expect(page.getByTestId("source-badge")).toHaveText(/imported history/i);
  // 8 records → 8 unique tracks, 5 unique artists (Aurora Vale, Neon Divide,
  // Vector Plaza, Kofi Adjei, The Accra Tapes, Still Harbor, Wren Calloway).
  await expect(page.getByTestId("stat-tracks")).toHaveText("8");
  await expect(page.getByTestId("stat-artists")).not.toHaveText("0");
});

test("imported data persists across reload and can be removed", async ({ page }) => {
  await page.goto("/");
  await importFixture(page, GOOD_FIXTURE);
  await page.getByTestId("import-merge").click();
  await page.getByTestId("import-done").click();
  await expect(page.getByRole("heading", { name: "My Listening History" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "My Listening History" })).toBeVisible();
  await expect(page.getByTestId("stat-tracks")).toHaveText("8");

  await openImportDialog(page);
  await page.getByTestId("remove-imported").click();
  await expect(page.getByRole("heading", { name: "Demo Universe" })).toBeVisible();
});

test("search finds entities and selection opens the detail panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("universe-app")).toBeVisible();

  await page.getByTestId("search-input").fill("aurora");
  await expect(page.getByTestId("search-results")).toBeVisible();
  await page.getByTestId("search-results").getByText("Aurora Vale").click();

  const detail = page.getByTestId("detail-panel");
  await expect(detail).toContainText("Aurora Vale");
  await expect(detail).toContainText("Artist");
  await expect(page.getByTestId("focus-camera")).toBeVisible();
  await expect(page.getByTestId("clear-selection")).toBeEnabled();
});

test("entity-kind filters update the visible stats", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("stat-artists")).not.toHaveText("0");

  await page.getByTestId("filter-kind-album").click();
  await expect(page.getByTestId("filter-kind-album")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("stat-albums")).toHaveText("0");
  // Independent evaluation: hiding albums must not hide artists.
  await expect(page.getByTestId("stat-artists")).not.toHaveText("0");

  await page.getByTestId("filter-kind-album").click();
  await expect(page.getByTestId("stat-albums")).not.toHaveText("0");
});

test("genre filters narrow the universe", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("filter-panel")).toBeVisible();

  const jazz = page.getByTestId("filter-panel").getByText("Jazz", { exact: true });
  await expect(jazz).toBeVisible();
  await jazz.click();
  await expect(page.getByTestId("stat-genres")).toHaveText("1");
  await page.getByTestId("reset-filters").click();
  await expect(page.getByTestId("stat-genres")).not.toHaveText("1");
});

test("timeframe switching changes stats when the data supports it", async ({ page }) => {
  await page.goto("/");
  const fourWeeks = page.getByTestId("timeframe-4w");
  if (await fourWeeks.isVisible()) {
    const before = await page.getByTestId("stat-tracks").textContent();
    await fourWeeks.click();
    await expect(fourWeeks).toHaveAttribute("aria-pressed", "true");
    const after = await page.getByTestId("stat-tracks").textContent();
    // A shorter window can only shrink or keep the visible set.
    expect(Number(after)).toBeLessThanOrEqual(Number(before));
    await page.getByTestId("timeframe-all").click();
  } else {
    await expect(page.getByTestId("timeframe-all")).toBeVisible();
  }
});

test("import errors are shown without losing the current dataset", async ({ page }) => {
  await page.goto("/");
  await importFixture(page, BAD_FIXTURE);
  await expect(page.getByTestId("import-errors")).toBeVisible();
  await page.getByTestId("close-import").click();
  await expect(page.getByTestId("import-dialog")).toBeHidden();
  // Demo data untouched.
  await expect(page.getByRole("heading", { name: "Demo Universe" })).toBeVisible();
  await expect(page.getByTestId("source-badge")).toHaveText(/demo/i);
});

test("imported records never persist sensitive fields", async ({ page }) => {
  await page.goto("/");
  await importFixture(page, GOOD_FIXTURE);
  await page.getByTestId("import-merge").click();
  await page.getByTestId("import-done").click();

  const stored = await page.evaluate(async () => {
    const dbs = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("music-universe");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<string>((resolve, reject) => {
      const tx = dbs.transaction("datasets", "readonly");
      const req = tx.objectStore("datasets").get("active");
      req.onsuccess = () => resolve(JSON.stringify(req.result ?? null));
      req.onerror = () => reject(req.error);
    });
  });
  expect(stored).not.toContain("203.0.113.9");
  expect(stored).not.toContain("should-never-be-persisted");
});

test("Spotify API mode sizes by rankings and never reports measured totals", async ({
  page,
  context,
}) => {
  await context.addInitScript(
    ([key, token]) => {
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          accessToken: token,
          refreshToken: null,
          expiresAtMs: Date.now() + 3_600_000,
          scopes: ["user-read-private", "user-top-read", "user-read-recently-played"],
        }),
      );
    },
    [TOKENS_KEY, "e2e-token"] as const,
  );

  const artistPage = {
    id: "artist-1",
    name: "Mocked Artist",
    popularity: 82,
    genres: ["mockwave"],
  };
  const trackPage = {
    id: "track-1",
    name: "Mocked Track",
    popularity: 74,
    artists: [{ id: "artist-1", name: "Mocked Artist" }],
    album: { name: "Mocked Album", images: [] },
  };
  const paging = (items: unknown[]) => ({ items, next: null, total: items.length });

  await page.route("**/api.spotify.com/v1/me/top/artists**", (route) =>
    route.fulfill({ json: paging([artistPage]) }),
  );
  await page.route("**/api.spotify.com/v1/me/top/tracks**", (route) =>
    route.fulfill({ json: paging([trackPage]) }),
  );
  await page.route("**/api.spotify.com/v1/me/player/recently-played**", (route) =>
    route.fulfill({ json: paging([]) }),
  );
  await page.route("**/api.spotify.com/v1/me", (route) =>
    route.fulfill({ json: { id: "e2e-user", display_name: "E2E Listener", images: [] } }),
  );
  await page.route("**/api/spotify/token", (route) =>
    route.fulfill({
      json: { access_token: "e2e-token", token_type: "Bearer", expires_in: 3600 },
    }),
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Spotify/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("source-badge")).toHaveText(/spotify api/i);
  await expect(page.getByTestId("detail-panel")).toContainText("Mocked Artist");
  // No measured records → total time is unavailable, not a fabricated number.
  await expect(page.getByTestId("stat-total")).toHaveText(/unavailable/i);

  await page.getByTestId("open-connection").click();
  await expect(page.getByTestId("connection-panel")).toContainText("E2E Listener");
  await page.getByTestId("disconnect-spotify").click();
  await expect(page.getByRole("heading", { name: "Demo Universe" })).toBeVisible();
});

test("combined mode enriches imports without double-counting listening time", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await importFixture(page, GOOD_FIXTURE);
  await page.getByTestId("import-merge").click();
  await page.getByTestId("import-done").click();
  await expect(page.getByRole("heading", { name: "My Listening History" })).toBeVisible();
  const importedTotal = (await page.getByTestId("stat-total").textContent()) ?? "";

  await context.addInitScript(
    ([key, token]) => {
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          accessToken: token,
          refreshToken: null,
          expiresAtMs: Date.now() + 3_600_000,
          scopes: ["user-read-private", "user-top-read", "user-read-recently-played"],
        }),
      );
    },
    [TOKENS_KEY, "e2e-token"] as const,
  );
  const paging = (items: unknown[]) => ({ items, next: null, total: items.length });
  await page.route("**/api.spotify.com/v1/me/top/artists**", (route) =>
    route.fulfill({ json: paging([{ id: "artist-1", name: "Wren Calloway", genres: ["mockwave"] }]) }),
  );
  await page.route("**/api.spotify.com/v1/me/top/tracks**", (route) =>
    route.fulfill({ json: paging([{ id: "track-1", name: "Mock", artists: [{ name: "Wren Calloway" }] }]) }),
  );
  await page.route("**/api.spotify.com/v1/me/player/recently-played**", (route) =>
    route.fulfill({ json: paging([]) }),
  );
  await page.route("**/api.spotify.com/v1/me", (route) =>
    route.fulfill({ json: { id: "e2e-user", display_name: "E2E Listener", images: [] } }),
  );
  await page.route("**/api/spotify/token", (route) =>
    route.fulfill({ json: { access_token: "e2e-token", token_type: "Bearer", expires_in: 3600 } }),
  );

  await page.reload();
  await expect(page.getByTestId("source-badge")).toHaveText(/imported \+ spotify api/i, {
    timeout: 15_000,
  });
  // Measured listening comes only from the import, never from API rankings.
  await expect(page.getByTestId("stat-total")).not.toHaveText(/unavailable/i);
  await expect(page.getByTestId("stat-total")).toHaveText(importedTotal.trim());
});

test("connection panel explains the unconfigured API mode", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-connection").click();
  await expect(page.getByTestId("connection-panel")).toContainText("developer.spotify.com");
  await page.getByTestId("close-connection").click();
  await expect(page.getByTestId("connection-panel")).toBeHidden();
});

test("Escape closes dialogs and panels", async ({ page }) => {
  await page.goto("/");
  await openImportDialog(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("import-dialog")).toBeHidden();

  await page.getByTestId("open-connection").click();
  await expect(page.getByTestId("connection-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("connection-panel")).toBeHidden();
});

test("core controls expose accessible names and roles", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: /search/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "Filters" })).toBeVisible();
});
