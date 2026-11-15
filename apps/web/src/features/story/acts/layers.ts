import { LAYER_IDS, type LayerId } from '@/store/app';

/** A complete layer record with only `on` switched on (every other layer explicitly off). */
export function onlyLayers(...on: LayerId[]): Record<LayerId, boolean> {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, on.includes(id)])) as Record<LayerId, boolean>;
}
