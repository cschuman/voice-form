import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'svelte',
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
