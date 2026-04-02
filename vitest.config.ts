import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/core/vitest.config.ts',
      'packages/svelte/vitest.config.ts',
      'packages/server-utils/vitest.config.ts',
      'packages/react/vitest.config.ts',
      'packages/dev/vitest.config.ts',
    ],
  },
})
