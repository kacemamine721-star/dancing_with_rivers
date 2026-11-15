/**
 * Camera shots for the Mellègue stage (docs/04 §7.2, docs/05 §3). Typed data: each shot is an
 * anchor (lon/lat, or UTM 32N metres) plus offsets in km (east, up, south) for the camera and the
 * look-at target, resolved against the scene frame so heights follow the terrain and the
 * exaggeration. The target is the shot's SUBJECT: CameraRig shifts the lens so the subject lands
 * in the free part of the screen (right of the story card), `bias` nudging it inside that area.
 */
import { DAM_LONLAT, type SceneFrame, type Vec3 } from '@/scene/coords';
import type { Act, ShotId } from '@/store/app';

export type ShotEase = 'power2.inOut' | 'power1.inOut' | 'sine.inOut' | 'power3.out';

export type ShotDef = {
  /** Anchor on the ground: lon/lat WGS84 … */
  anchor?: readonly [number, number];
  /** … or UTM 32N metres (scene-grid CRS). */
  anchorUtm?: readonly [number, number];
  /** Camera offset from the anchor: [east km, up km, south km]. */
  position: Vec3;
  /** Target offset from the anchor: [east km, up km, south km]. */
  target: Vec3;
  fov: number;
  durationMs: number;
  ease: ShotEase;
  /** Where the subject sits inside the free screen area, [-0.5, 0.5] each way (default centre). */
  bias?: { x: number; y: number };
};

export type Shot = {
  id: ShotId;
  position: Vec3;
  target: Vec3;
  fov: number;
  durationMs: number;
  ease: ShotEase;
  bias: { x: number; y: number };
};

/** Centre of the 10 m lake chip (grid.json lake_chip.bounds_m), i.e. the reservoir. */
const LAKE_UTM: readonly [number, number] = [473065, 4018375];
const JENDOUBA: readonly [number, number] = [8.78, 36.5];
const SIDI_SALEM: readonly [number, number] = [9.3, 36.6];
const CENTRE: readonly [number, number] = [8.975, 36.425];
/**
 * The modelled corridor dam → Medjerda confluence → Bou Salem (flowpath km 0–67) spans roughly
 * UTM x 472–498 km, y 4019–4051 km; this is its middle. Seen from the south-east, the valley runs
 * across the screen from the dam (left, nearer) to Bou Salem (right, farther).
 */
const CORRIDOR_UTM: readonly [number, number] = [485500, 4034500];

/** `power2.inOut` is easeInOutCubic = the `--ease-cine` token cubic-bezier(.65,0,.35,1). */
export const SHOTS: Record<ShotId, ShotDef> = {
  // High SW oblique: hills of Kef behind, reservoir in front, river thread to the NE.
  arrival: { anchor: DAM_LONLAT, position: [-12, 8.5, 13], target: [1.5, 0, -1.5], fov: 40, durationMs: 2400, ease: 'power2.inOut' },
  dam_close: { anchor: DAM_LONLAT, position: [2.6, 2.3, 4.6], target: [-0.4, 0.1, -0.2], fov: 38, durationMs: 7000, ease: 'sine.inOut' },
  // Night: low from the south-west, across the dark lake towards the lit crest.
  night_dam: { anchor: DAM_LONLAT, position: [-4.6, 1.6, 4.2], target: [0.2, 0.15, -0.1], fov: 36, durationMs: 2600, ease: 'power2.inOut' },
  // Reservoir from the south, ~30° off nadir: the whole lake, the dam and its hills fit in the free area.
  lake_top: { anchorUtm: LAKE_UTM, position: [0.3, 13.5, 7.5], target: [0.2, 0, 0.2], fov: 40, durationMs: 2600, ease: 'power2.inOut', bias: { x: -0.12, y: 0.1 } },
  // Static fallback of the valley flight (CameraRig flies the flow path when it is loaded).
  valley_follow: { anchorUtm: CORRIDOR_UTM, position: [22, 30, 21], target: [0, 0, 0], fov: 40, durationMs: 2600, ease: 'power2.inOut', bias: { x: 0, y: 0.2 } },
  jendouba_wide: { anchor: JENDOUBA, position: [-9, 8, 15], target: [1, 0, -2], fov: 42, durationMs: 3000, ease: 'power2.inOut' },
  sidi_salem: { anchor: SIDI_SALEM, position: [-14, 8, 12], target: [1, 0, -1], fov: 42, durationMs: 3000, ease: 'power2.inOut' },
  // Act 7: the corridor from the side, the valley across the screen.
  scenario_overview: { anchorUtm: CORRIDOR_UTM, position: [22, 30, 21], target: [0, 0, 0], fov: 40, durationMs: 3200, ease: 'power2.inOut', bias: { x: 0, y: 0.22 } },
  catchment_wide: { anchor: CENTRE, position: [-8, 92, 58], target: [0, 0, 2], fov: 42, durationMs: 3600, ease: 'power2.inOut' },
};

function anchorScene(d: ShotDef, frame: SceneFrame): Vec3 {
  if (d.anchorUtm) return frame.utmToScene(d.anchorUtm[0], d.anchorUtm[1]);
  const a = d.anchor ?? DAM_LONLAT;
  return frame.lonLatToScene(a[0], a[1]);
}

export function resolveShot(id: ShotId, frame: SceneFrame): Shot {
  const d = SHOTS[id];
  const [ax, ay, az] = anchorScene(d, frame);
  return {
    id,
    position: [ax + d.position[0], ay + d.position[1], az + d.position[2]],
    target: [ax + d.target[0], ay + d.target[1], az + d.target[2]],
    fov: d.fov,
    durationMs: d.durationMs,
    ease: d.ease,
    bias: d.bias ?? { x: 0, y: 0 },
  };
}

/**
 * Default shot sequence per act (deep links and act changes); the story's `defaultShot` then
 * requests its own. Kept equal to the act configs' defaultShot.
 */
export const ACT_SHOTS: Record<Act, readonly ShotId[]> = {
  1: ['arrival', 'dam_close'],
  2: ['night_dam'],
  3: ['lake_top'],
  4: ['valley_follow'],
  5: ['lake_top'],
  6: ['lake_top'],
  7: ['scenario_overview'],
  8: ['lake_top'],
  9: ['catchment_wide'],
};
