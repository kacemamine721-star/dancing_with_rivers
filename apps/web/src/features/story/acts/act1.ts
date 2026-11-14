import type { ActConfig } from '../types';

export const act1: ActConfig = {
  act: 1,
  kicker: 'ACT 1 · THE DAM',
  title: 'A 72-year-old guardian.',
  body:
    'Built in 1954 on the Mellègue river, near the Algerian border, this dam feeds the farms of Jendouba. Its lake is now about 80% full of mud. A new, much bigger dam just upstream, Upper Mellègue (195 million m³), was about to replace it.',
  expertBody:
    'Crest height 65 m, multiple-arch concrete structure. Catchment area 10,315 km² extending into eastern Algeria. Severe sedimentation has reduced active reservoir capacity from historical ~300 Mm³ to ~50 Mm³. Covered by NISAR repeat tracks D80, A101, A173, and D8.',
  expertStats: [
    { label: 'Built', value: '1954', badge: { kind: 'reported', source: 'Ministry of Agriculture' } },
    { label: 'Catchment', value: '10,315', unit: 'km²', badge: { kind: 'measured', source: 'HydroSHEDS / D8' } },
    { label: 'Siltation', value: '≈ 80', unit: '%', badge: { kind: 'reported', source: 'General Directorate of Dams' } },
    { label: 'Upstream Dam', value: '195', unit: 'Mm³', badge: { kind: 'reported', source: 'Upper Mellègue Project' } },
  ],
  badges: [
    { kind: 'reported', source: 'Tunisian Ministry of Agriculture (DGBGTH)', subject: 'Dam history' },
    { kind: 'measured', source: 'Google Research GEM-15 DTM / NASADEM', subject: 'Terrain 3D' },
  ],
  defaultShot: 'arrival',
  defaultDate: '2026-06-17',
  compareDate: null,
  defaultLayers: {
    basemap: true,
    radar: false,
    mask: false,
    change: false,
    flowpath: false,
    flood: false,
    villages: false,
    cropland: false,
  },
};
