import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'react',
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
})
