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
  {
    // CDN / script-tag IIFE build — exposes window.VoiceForm
    // Includes both the headless core and the default UI in a single file.
    entry: { voiceform: 'src/index.ts' },
    format: ['iife'],
    globalName: 'VoiceForm',
    dts: false,
    sourcemap: true,
    minify: true,
    treeshake: true,
    outDir: 'dist',
  },
])
