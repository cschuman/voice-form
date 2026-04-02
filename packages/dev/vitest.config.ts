import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'dev',
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
  },
})
