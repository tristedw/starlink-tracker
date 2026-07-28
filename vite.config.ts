// defineConfig comes from vitest/config rather than vite so the `test` block
// below typechecks. It's the same function with the test options bolted on.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project site from /<repo>/, so the CI workflow passes
// the repo name in. Defaults to '/' for local dev and for a user site.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5173 },
  worker: {
    // The propagation shards are ES modules that import from src/lib.
    format: 'es',
  },
  build: {
    target: 'es2020',
    // Three.js and MapLibre are both large and mutually exclusive at runtime,
    // so splitting them keeps first paint fast for whichever view loads first.
    // satellite.js isn't listed: only the propagation worker imports it and
    // that gets bundled separately, so a group here would emit an empty chunk.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/three/') || id.includes('three-globe') || id.includes('react-globe.gl')) {
            return 'three';
          }
          if (id.includes('maplibre-gl')) return 'maplibre';
          return null;
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
  },
});
