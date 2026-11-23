import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.DSH_E2E_PORT ?? 43125)

/**
 * The suite drives the plugin's Web UI inside a real host.
 *
 * One host, one worker: every spec opens the same settings surface and the
 * market's state (sources, installed suites, settings) is shared, so parallel
 * workers would read each other's edits. The host itself is provisioned by
 * `e2e/host.mjs` and cached under `node_modules/.cache/e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: 'node_modules/.cache/e2e/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === undefined ? 0 : 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'node_modules/.cache/e2e/report', open: 'never' }]],
  use: {
    // Drive the Chrome already on the machine instead of a downloaded
    // Playwright build: the suite needs a browser, not a specific bundle, and
    // CI images ship Chrome.
    channel: 'chrome',
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node e2e/host.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    // The host answers an unauthenticated request with 401 by design; Playwright
    // treats that status as a live server, so the port alone gates readiness.
    reuseExistingServer: process.env.DSH_E2E_REUSE === '1',
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
