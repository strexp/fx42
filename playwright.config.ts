import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.FX42_E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.FX42_E2E_NO_SERVER
    ? undefined
    : {
        command:
          'rm -f ./data/e2e.db ./data/e2e.db-shm ./data/e2e.db-wal ./data/e2e.sock && DATABASE_PATH=./data/e2e.db FX42_CONTROL_SOCKET=./data/e2e.sock pnpm dev:mock',
        url: 'http://localhost:3000/healthz',
        reuseExistingServer: true,
        timeout: 180_000,
      },
})
