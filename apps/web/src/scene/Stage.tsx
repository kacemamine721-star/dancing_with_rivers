/**
 * Persistent 3D stage (docs/04 §7.1, docs/06 §4). Mounted ONCE by AppShell, outside the route
 * outlet, so the Canvas survives navigation. Loaded lazily, so three.js / R3F / postprocessing land
 * in the separate `three` chunk (vite.config.ts manualChunks) and load in parallel with the UI.
 *
 * TODO(scene-3d, M3): render the single R3F <Canvas> (intro + Mellègue scenes, CameraRig, Effects).
 * Read UI state only through `useAppStore` selectors (src/store/app.ts) and colours from
 * `src/styles/tokens.ts`. Ask frontend-ui for new store fields.
 */
export default function Stage(): null {
  return null;
}
