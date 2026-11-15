import type { Vec3 } from '@/scene/coords';

/** Live vector data the camera rig needs, written by the overlays, shared without React state. */
export const sceneVectors = {
  /** Ground points along the flow path every 2 km (scene units), dam first. */
  valley: null as Vec3[] | null,
  /** Dam crest midpoint (scene units). */
  damCrest: null as Vec3 | null,
};
