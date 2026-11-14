import type { ActConfig } from '../types';

export const act9: ActConfig = {
  act: 9,
  kicker: 'ACT 9 · DAM WATCH FOR EVERY DAM',
  title: 'One lake today. Every dam tomorrow.',
  body:
    "Tunisia's daily dam bulletins stopped in 2025. NISAR passes over every reservoir in the country every 12 days or less, for free. HydroStress turns that into an independent watch: area, alerts, level, and flood scenarios.",
  expertBody:
    'Scalable architecture: automated watershed and downstream river corridor delineation (delineator / pyflwdir), multi-temporal SAR Otsu segmentation, baseline anomaly screening, and ANUGA 2D hydrodynamic hazard mapping across the Mediterranean basin.',
  expertStats: [
    { label: 'Coverage', value: 'National', badge: { kind: 'measured', source: 'NISAR Repeat Orbit' } },
    { label: 'Revisit', value: '≤ 12', unit: 'days', badge: { kind: 'measured', source: 'L-SAR Constellation' } },
    { label: 'Ground Sensors', value: '0', unit: 'needed', badge: { kind: 'modelled', source: 'Satellite-native' } },
    { label: 'Open Source', value: '100', unit: '%', badge: { kind: 'reported', source: 'MIT / GPL' } },
  ],
  badges: [
    { kind: 'reported', source: 'HydroStress Platform Architecture', subject: 'National pipeline' },
    { kind: 'modelled', source: 'ANUGA + NISAR automated ingestion', subject: 'Future roadmap' },
  ],
  defaultShot: 'catchment_wide',
  defaultDate: '2026-10-29',
  compareDate: null,
  defaultLayers: {
    basemap: true,
    radar: true,
    mask: false,
    change: false,
    flowpath: true,
    flood: false,
    villages: true,
    cropland: true,
  },
};
