import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act7: ActConfig = {
  act: 7,
  short: 'What if?',
  kicker: 'ACT 7 · WHAT IF?',
  title: 'And if it had been more water?',
  body:
    'Move the slider to release any volume from the dam. About {release.reported} million m³ is what happened in June. 195 million m³ is the size of the new Upper Mellègue reservoir upstream: a hypothetical worst case, released here at the old dam, not a forecast. See which farms, roads and villages the water could reach.',
  expertBody:
    'Two models. HAND “bathtub” (static, whole {path.length} km corridor): 21 Mm³ → ≈ {hand.21.area} km², ≈ {hand.21.cropland} ha cropland; 195 Mm³ → ≈ {hand.195.area} km², ≈ {hand.195.cropland} ha, {hand.195.villages} villages. ANUGA 2D (dam → Medjerda confluence, {anuga.mesh} triangles ≤ 2,500 m², 12 h release): 21 Mm³ → {anuga.v21.area} km² wet, {anuga.v21.cropland} ha cropland; 50 → {anuga.v50.area} km²; 195 → {anuga.v195.area} km², {anuga.v195.cropland} ha. The 195 Mm³ case is hypothetical and released at the old dam site.',
  facts: [],
  badges: [
    { from: 'file', file: 'hand_lut', subject: 'Quick flood (HAND on GEM-15, no channel bathymetry)' },
    { from: 'file', file: 'anuga', subject: '2D flood (ANUGA)' },
    { from: 'file', file: 'impacts', subject: 'Exposure (WorldCover, OSM, WorldPop)' },
  ],
  stage: {
    shot: 'scenario_overview',
    date: '2026-06-21',
    compareDate: null,
    layers: onlyLayers('basemap', 'flowpath', 'flood', 'villages', 'cropland'),
    flood: { mode: 'hand', volumeM3: 21e6, scenarioId: 'v21_d12' },
  },
  tryIt: [],
  widgets: ['scenario'],
};
