/**
 * Camera shots for the Mellègue stage (docs/04 §7.2, docs/05 §3). Typed data: each shot is an
 * anchor (lon/lat) plus offsets in km (east, up, south) for the camera and the look-at target,
 * resolved against the scene frame so heights follow the terrain and the exaggeration.
 */
import { DAM_LONLAT, type SceneFrame, type Vec3 } from '@/scene/coords';
import type { Act, ShotId } from '@/store/app';

export type ShotEase = 'power2.inOut' | 'power1.inOut' | 'sine.inOut' | 'power3.out';

export type ShotDef = {
  /** Anchor on the ground, lon/lat WGS84. */
  anchor: readonly [number, number];
  /** Camera offset from the anchor: [east km, up km, south km]. */
  position: Vec3;
  /** Target offset from the anchor: [east km, up km, south km]. */
  target: Vec3;
  fov: number;
  durationMs: number;
  ease: ShotEase;
};

export type Shot = { id: ShotId; position: Vec3; target: Vec3; fov: number; durationMs: number; ease: ShotEase };

const LAKE: readonly [number, number] = [8.7, 36.31];
const JENDOUBA: readonly [number, number] = [8.78, 36.5];
const SIDI_SALEM: readonly [number, number] = [9.3, 36.6];
const CENTRE: readonly [number, number] = [8.975, 36.425];

/** `power2.inOut` is easeInOutCubic = the `--ease-cine` token cubic-bezier(.65,0,.35,1). */
export const SHOTS: Record<ShotId, ShotDef> = {
  // High SW oblique: hills of Kef behind, reservoir in front, river thread to the NE.
  arrival: { anchor: DAM_LONLAT, position: [-12, 8.5, 13], target: [2.5, 0, -2.5], fov: 40, durationMs: 2400, ease: 'power2.inOut' },
  dam_close: { anchor: DAM_LONLAT, position: [2.6, 2.3, 4.6], target: [-0.4, 0.1, -0.2], fov: 38, durationMs: 7000, ease: 'sine.inOut' },
  night_dam: { anchor: DAM_LONLAT, position: [-3.8, 2.0, 2.8], target: [0, 0.1, 0], fov: 38, durationMs: 2600, ease: 'power2.inOut' },
  // Nadir over the lake chip, north up.
  lake_top: { anchor: LAKE, position: [0, 9.2, 0.02], target: [0, 0, 0], fov: 40, durationMs: 2600, ease: 'power2.inOut' },
  // Placeholder until the flow-path spline lands (M6).
  valley_follow: { anchor: DAM_LONLAT, position: [-12, 8.5, 13], target: [2.5, 0, -2.5], fov: 40, durationMs: 2600, ease: 'power2.inOut' },
  jendouba_wide: { anchor: JENDOUBA, position: [-9, 8, 15], target: [1, 0, -2], fov: 42, durationMs: 3000, ease: 'power2.inOut' },
  sidi_salem: { anchor: SIDI_SALEM, position: [-14, 8, 12], target: [1, 0, -1], fov: 42, durationMs: 3000, ease: 'power2.inOut' },
  scenario_overview: { anchor: CENTRE, position: [-30, 30, 46], target: [-4, 0, -2], fov: 42, durationMs: 3200, ease: 'power2.inOut' },
  catchment_wide: { anchor: CENTRE, position: [-8, 92, 58], target: [0, 0, 2], fov: 42, durationMs: 3600, ease: 'power2.inOut' },
};

export function resolveShot(id: ShotId, frame: SceneFrame): Shot {
  const d = SHOTS[id];
  const [ax, ay, az] = frame.lonLatToScene(d.anchor[0], d.anchor[1]);
  return {
    id,
    position: [ax + d.position[0], ay + d.position[1], az + d.position[2]],
    target: [ax + d.target[0], ay + d.target[1], az + d.target[2]],
    fov: d.fov,
    durationMs: d.durationMs,
    ease: d.ease,
  };
}

/** Default shot sequence per act: the camera cuts/flies to the first, then eases through the rest. */
export const ACT_SHOTS: Record<Act, readonly ShotId[]> = {
  1: ['arrival', 'dam_close'],
  2: ['night_dam'],
  3: ['lake_top'],
  4: ['arrival'], // valley_follow comes in M6
  5: ['lake_top'],
  6: ['lake_top'],
  7: ['scenario_overview'],
  8: ['lake_top'],
  9: ['catchment_wide'],
};
