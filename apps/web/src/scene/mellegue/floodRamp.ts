/**
 * Flood colour ramps used by the terrain shader, exported so the UI legend matches the 3D exactly.
 * Each stop is a depth in metres and a colour; the shader blends smoothly between stops.
 *
 * ANUGA depth rasters are encoded r8 up to `depth_encoding.max` (8 m) and CLIP above it (true
 * maxima are deeper), so the top ANUGA class must be labelled "≥ 8 m", never "8 m".
 */
import { tokens } from '@/styles/tokens';

export type RampStop = { depthM: number; color: string; label: string };

/** ANUGA 2D physics (blue family, flood tokens). Top stop = "≥ 8 m" (rasters clip at 8 m). */
export const ANUGA_RAMP: readonly RampStop[] = [
  { depthM: 0.1, color: tokens.color.flood[0], label: '0.1 m' },
  { depthM: 1.2, color: tokens.color.flood[1], label: '1.2 m' },
  { depthM: 4, color: tokens.color.flood[2], label: '4 m' },
  // tokens.color.flood[3] is near-black on the dark terrain: the deepest class stops at a blend
  { depthM: 8, color: '#18266f', label: '≥ 8 m' },
];

/** HAND bathtub (amber family): water height above the nearest drainage. */
export const HAND_RAMP: readonly RampStop[] = [
  { depthM: 0, color: '#ffdb6b', label: '0 m' },
  { depthM: 1.2, color: '#f29a29', label: '1.2 m' },
  { depthM: 4.5, color: '#bd5212', label: '≥ 4.5 m' },
];
