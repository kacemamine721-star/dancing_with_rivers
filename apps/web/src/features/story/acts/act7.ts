import type { ActConfig } from '../types';

export const act7: ActConfig = {
  act: 7,
  kicker: 'ACT 7 · WHAT IF?',
  title: 'And if it had been more water?',
  body:
    'Move the slider to release any volume from the dam. 21 million m³ is what happened in June. 195 million m³ is the full new Upper Mellègue dam upstream. See which farms, roads and villages the water could reach.',
  expertBody:
    'HAND bathtub spreads volume along the 101 km corridor according to relative elevation above drainage. ANUGA 2D solves depth-averaged shallow water equations over a 31k-triangle triangular mesh. 21 Mm³ inundates ~26.5 km² (1,309 ha cropland). A full 195 Mm³ Upper Mellègue release covers ~79.1 km² (5,321 ha cropland, 4 villages).',
  expertStats: [
    { label: 'Screening Method', value: 'HAND', unit: '30 m', badge: { kind: 'modelled', source: 'GEM-15 / pysheds' } },
    { label: 'Physics Solver', value: 'ANUGA 2D', unit: 'DE0', badge: { kind: 'modelled', source: 'Hydrodynamic solver' } },
    { label: '21 Mm³ Impact', value: '1,309', unit: 'ha', badge: { kind: 'modelled', source: 'Cropland exposure' } },
    { label: '195 Mm³ Impact', value: '4', unit: 'villages', badge: { kind: 'modelled', source: 'OSM exposure' } },
  ],
  badges: [
    { kind: 'modelled', source: 'ANUGA 2D Shallow Water & GEM-15 HAND Bathymetry', subject: 'Inundation model' },
    { kind: 'measured', source: 'ESA WorldCover 2021 & WorldPop 2020', subject: 'Vulnerability exposure' },
  ],
  defaultShot: 'scenario_overview',
  defaultDate: '2026-06-21',
  compareDate: null,
  defaultLayers: {
    basemap: true,
    radar: false,
    mask: false,
    change: false,
    flowpath: true,
    flood: true,
    villages: true,
    cropland: true,
  },
};
