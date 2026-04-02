import { defineConfig } from 'tsup'

export default defineConfig([
  {
    // Headless core entry point
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    outDir: 'dist',
  },
  {
    // Default UI — separate entry point, not included in headless bundle
    entry: { 'ui/index': 'src/ui/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    outDir: 'dist',
  },
])
