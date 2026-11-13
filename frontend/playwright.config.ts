import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against a running stack (default: Docker on http://localhost:8080).
 *   npx playwright test                         run all E2E tests
 *   E2E_BASE_URL=http://localhost:5173 npx playwright test   against the Vite dev server
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
});
