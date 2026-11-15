import type { BadgeProps } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import {
  useAlerts,
  useAnugaIndex,
  useHandLut,
  useImpacts,
  useLevelVolume,
  useManifest,
  useReservoirArea,
} from '@/data/hooks';

import type { BadgeSpec } from './types';

/** Resolve the act badges against the manifest and bundle files (provenance is never typed twice). */
export function useBadgeSpecs(specs: BadgeSpec[]): BadgeProps[] {
  const manifest = useManifest().data;
  const series = useReservoirArea().data;
  const alerts = useAlerts().data;
  const lut = useHandLut().data;
  const impacts = useImpacts().data;
  const level = useLevelVolume().data;
  const index = useAnugaIndex().data;
  return specs.flatMap((spec): BadgeProps[] => {
    if (spec.from === 'static') {
      const { from: _from, ...rest } = spec;
      return [rest];
    }
    if (spec.from === 'layer') {
      const layer = manifest?.layers.find((l) => l.id === spec.layer);
      if (!layer) return [];
      const props = provenanceProps(layer);
      // catchments are DEM-derived products: never shown as a direct measurement (science review #30)
      if (layer.id === 'catchment' && layer.badge === 'MEASURED') props.kind = 'modelled';
      return [{ ...props, subject: spec.subject }];
    }
    const file =
      spec.file === 'reservoir_area'
        ? series
        : spec.file === 'alerts'
          ? alerts
          : spec.file === 'hand_lut'
            ? lut
            : spec.file === 'impacts'
              ? impacts
              : spec.file === 'level_volume'
                ? level
                : index?.scenarios.find((s) => s.computed);
    if (!file) return [];
    return [{ ...provenanceProps(file), subject: spec.subject }];
  });
}
