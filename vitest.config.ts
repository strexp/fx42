import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@fx42/shared': resolve('./packages/shared/src/index.ts'),
      '@fx42/contracts': resolve('./packages/contracts/src/index.ts'),
      '@fx42/domain': resolve('./packages/domain/src/index.ts'),
      '@fx42/config': resolve('./packages/config/src/index.ts'),
      '@fx42/db': resolve('./packages/db/src/index.ts'),
      '@fx42/clients': resolve('./packages/clients/src/index.ts'),
      '@fx42/application': resolve('./packages/application/src/index.ts'),
      '@fx42/runtime': resolve('./packages/runtime/src/index.ts'),
    },
  },
})
