import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // Serial execution: several tests share fixture directories and global
    // React/Vitest state; parallel file runs cause intermittent failures.
    // The full suite finishes in ~2.5s serially, so the cost is negligible.
    fileParallelism: false,
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/]
      }
    },
    // The HTML report is build output. node_modules/.cache is where this
    // repository's other generated material (compat-report, host-alignment
    // caches) already lives, and no packages/* walker ever sees it.
    coverage: {
      reportsDirectory: 'node_modules/.cache/coverage',
      include: ['packages/*/src/**']
    }
  }
})
