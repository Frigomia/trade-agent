import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "**/*.pw.ts", workers: 1, timeout: 60000,
  outputDir: ".next/playwright-results",
  use: { baseURL: "http://localhost:3100", browserName: "chromium", channel: "chrome", timezoneId: "Europe/Berlin", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --webpack --port 3100", url: "http://localhost:3100/login", reuseExistingServer: false, timeout: 180000,
    env: { NEXT_PUBLIC_API_URL: "http://localhost:8000", NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder" },
  },
});
