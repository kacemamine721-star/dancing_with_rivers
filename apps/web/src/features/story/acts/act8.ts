import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act8: ActConfig = {
  act: 8,
  short: 'Level & volume',
  kicker: 'ACT 8 · LEVEL & VOLUME',
  title: 'From area to water level and volume.',
  body:
    'Radar measures how big the lake is, not how deep. SWOT, a NASA–CNES satellite, measures the height of the lake surface. Before the failure it read {level.before} m; on its first pass after, {level.after} m. Combined with the lake area, that is a storage change we can compare with the reported {release.reported} million m³.',
  expertBody:
    'SWOT LakeSP (Hydrocron), good-quality passes only for the numbers. Storage change between two SWOT passes = ∫ area · dh, with a range from radar area (low) to SWOT area (high). It is net of inflow, so it is not the released volume; consistent with the reported {release.range} Mm³ within a factor of 2. SWOT’s lake area (larger polygon) differs from the radar area; the level is unaffected. The radar-shoreline × DEM level method was tested and rejected (fails test L5 against SWOT).',
  facts: ['level.drop', 'volume.change', 'release.range'],
  badges: [{ from: 'file', file: 'level_volume', subject: 'Level and volume' }],
  stage: {
    shot: 'lake_top',
    date: '2026-07-15',
    compareDate: null,
    layers: onlyLayers('basemap', 'radar', 'mask'),
  },
  tryIt: [{ label: 'How we test this', actions: [{ kind: 'navigate', to: '/methods' }] }],
  widgets: ['levelVolume'],
};
