import type { ActConfig } from '../types';

export const act5: ActConfig = {
  act: 5,
  kicker: 'ACT 5 · A MONTH OF DRAINING',
  title: 'Every few days, a new look.',
  body:
    "Combining NISAR's tracks gives a new image of the lake every 2–7 days, through clouds, day or night. The lake kept shrinking until the gate was repaired on 16 July, from about 2.9 to 1.7 km². It stayed there through August and rose again with the September rains.",
  expertBody:
    '131 multi-sensor observations (NISAR L-SAR + Sentinel-1 C-SAR). Area contracted from pre-failure ~2.9 km² down to minimum ~1.7 km² on gate repair (16 July). Plateau maintained through August (~1.7 km²) with seasonal autumn replenishment in late September.',
  expertStats: [
    { label: 'Observations', value: '131', badge: { kind: 'measured', source: 'NISAR + Sentinel-1' } },
    { label: 'Pre-failure Area', value: '2.86', unit: 'km²', badge: { kind: 'measured', source: 'S1 o88 17 Jun' } },
    { label: 'Minimum Area', value: '1.68', unit: 'km²', badge: { kind: 'measured', source: 'NISAR D80 15 Jul' } },
    { label: 'Gate Repaired', value: '16 Jul', badge: { kind: 'reported', source: 'Ministry Communiqué' } },
  ],
  badges: [
    { kind: 'measured', source: 'Harmonised NISAR + Sentinel-1 Otsu time series', subject: 'Lake surface area' },
    { kind: 'reported', source: 'Tunisian Ministry of Agriculture', subject: 'Gate repair date' },
  ],
  defaultShot: 'lake_top',
  defaultDate: '2026-07-15',
  compareDate: null,
  defaultLayers: {
    basemap: true,
    radar: true,
    mask: true,
    change: false,
    flowpath: false,
    flood: false,
    villages: false,
    cropland: false,
  },
};
