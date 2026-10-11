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
    }
  }
})
