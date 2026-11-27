import { defineConfig, devices } from "@playwright/test"

// Requires the API (http://localhost:8080, Development) to be running.
// The dev server is started automatically unless one is already running.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:5173", locale: "en-US", trace: "retain-on-failure" },
  webServer: process.env.BASE_URL ? undefined : { command: "npx vite --port 5173", url: "http://localhost:5173", reuseExistingServer: true },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
})
