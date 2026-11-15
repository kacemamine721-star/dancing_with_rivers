import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import glsl from 'vite-plugin-glsl';

import { BRAND } from './src/brand';

/** Product name in index.html comes from src/brand.ts, like everywhere else. */
function brandHtml(): Plugin {
  return {
    name: 'dwd-brand-html',
    transformIndexHtml: (html) =>
      html.replaceAll('%BRAND_PRODUCT%', BRAND.product).replaceAll('%BRAND_PROJECT%', BRAND.tagline),
  };
}

/** three.js, R3F, drei, postprocessing and their 3D-only deps go to the `three` chunk. */
const THREE_PACKAGES =
  /\/node_modules\/(?:three|@react-three|postprocessing|three-stdlib|three-mesh-bvh|troika-[^/]+|camera-controls|maath|meshline|stats-gl|detect-gpu|@monogrid|@use-gesture|hls\.js|suspend-react|its-fine|n8ao)\//;
/**
 * Runtime shared by the UI and the 3D chunk gets its own chunk; otherwise Rollup pulls it into
 * `three` and the entry would statically import three.js.
 */
const REACT_PACKAGES =
  /\/node_modules\/(?:react|react-dom|scheduler|zustand|use-sync-external-store|react-router|react-router-dom|@remix-run\/router|@babel\/runtime|tslib)\//;
const norm = (id: string): string => id.replace(/\\/g, '/');

export default defineConfig({
  plugins: [react(), glsl({ minify: false, watch: true }), brandHtml()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200, // the lazy `three` chunk is ~1 MB raw (~265 kB gzip)
    rollupOptions: {
      output: {
        manualChunks(id) {
          const p = norm(id);
          if (THREE_PACKAGES.test(p)) return 'three';
          // Vite's dynamic-import preload helper is shared too; keep it out of `three`.
          if (REACT_PACKAGES.test(p) || p.includes('vite/preload-helper')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
});
