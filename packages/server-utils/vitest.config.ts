import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'server-utils',
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
