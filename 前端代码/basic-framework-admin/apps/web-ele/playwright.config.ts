import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [['list']],
  screenshot: 'only-on-failure',
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173/admin/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm run preview --host 127.0.0.1 --port 4173',
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:4173/admin/',
  },
});
