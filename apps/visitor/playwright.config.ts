import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/** End-to-end tests of the BUILT visitor app (service worker only runs in production builds). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: 'allow',
  },
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
