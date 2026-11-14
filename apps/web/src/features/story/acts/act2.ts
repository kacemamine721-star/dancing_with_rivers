import type { ActConfig } from '../types';

export const act2: ActConfig = {
  act: 2,
  kicker: 'ACT 2 · THE NIGHT OF 17 JUNE',
  title: '21:15 — a gate gives way.',
  body:
    'A planned release of 100,000 m³ for irrigation turned into an uncontrolled flow when a gate failed. In a few hours about 21 million m³ left the lake, about 210 times what was planned. Farms downstream were flooded.',
  expertBody:
    'Official reports range 21–29 Mm³ released through bottom outlet. Sentinel-1 pass (orbit 88, VV/VH) acquired at 17:20 UTC — just 3.9 hours before failure — captures baseline pre-failure water extent of ~2.86 km².',
  expertStats: [
    { label: 'Incident Time', value: '21:15', unit: 'UTC+1', badge: { kind: 'reported', source: 'Civil Protection' } },
    { label: 'Planned Release', value: '0.1', unit: 'Mm³', badge: { kind: 'reported', source: 'CRDA Jendouba' } },
    { label: 'Actual Volume', value: '21–29', unit: 'Mm³', badge: { kind: 'reported', source: 'Official Communiqué' } },
    { label: 'Pre-failure Pass', value: '17:20', unit: 'UTC', badge: { kind: 'measured', source: 'Sentinel-1 o88' } },
  ],
  badges: [
    { kind: 'reported', source: 'Regional Civil Protection & CRDA Jendouba', subject: 'Incident timeline' },
    { kind: 'measured', source: 'Copernicus Sentinel-1 RTC (ESA / Planetary Computer)', subject: 'Pre-failure radar' },
  ],
  defaultShot: 'night_dam',
  defaultDate: '2026-06-17',
  compareDate: null,
  defaultLayers: {
    basemap: true,
    radar: true,
    mask: false,
    change: false,
    flowpath: false,
    flood: false,
    villages: false,
    cropland: false,
  },
};
