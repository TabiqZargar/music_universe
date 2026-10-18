import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * When system NSS/ALSA libraries are unavailable (no root to run
 * `playwright install-deps`), they can be extracted from distro packages into
 * a user-local directory. Point PLAYWRIGHT_EXTRA_LIB_PATH at that directory;
 * the default below is where this repo's environment keeps them.
 */
const extraLibPath =
  process.env.PLAYWRIGHT_EXTRA_LIB_PATH ??
  "/tmp/opencode/pw-deps/root/usr/lib/x86_64-linux-gnu";

const env =
  existsSync(extraLibPath)
    ? {
        ...process.env,
        LD_LIBRARY_PATH: [extraLibPath, process.env.LD_LIBRARY_PATH]
          .filter(Boolean)
          .join(":"),
      }
    : process.env;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    launchOptions: { env },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
