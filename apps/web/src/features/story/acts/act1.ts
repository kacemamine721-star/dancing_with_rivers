import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act1: ActConfig = {
  act: 1,
  short: 'The dam',
  kicker: 'ACT 1 · THE DAM',
  title: 'A 72-year-old guardian.',
  body:
    'Built in 1954 on the Mellègue river, near the Algerian border, this dam feeds the farms of Jendouba. Its lake is now about 80% full of mud. A new, much bigger dam just upstream, Upper Mellègue (195 million m³), was about to replace it.',
  expertBody:
    'Catchment {catchment.mellegue} km² (derived from HydroBASINS level 12), much of it in Algeria. About 80% silted (press, AllAfrica). Seen by four NISAR tracks: {obs.nisarTracks}. 3D terrain: NASADEM 30 m. Flow path and flood models: GEM-15 (experimental 15 m bare-earth model, Google Research) averaged to 30 m.',
  facts: ['dam.built', 'dam.silted', 'upper.capacity'],
  expertFacts: ['catchment.mellegue', 'obs.nisarTracks'],
  badges: [
    {
      from: 'static',
      kind: 'reported',
      source: 'AllAfrica, 24 Jun 2026 (80% silted); Webdo (Upper Mellègue, 195 Mm³) — see Sources',
      subject: 'Dam history',
    },
    { from: 'layer', layer: 'terrain_height', subject: 'Terrain 3D' },
  ],
  stage: {
    shot: 'arrival',
    date: '2026-06-17',
    compareDate: null,
    layers: onlyLayers('basemap'),
  },
  tryIt: [
    { label: 'Fly to the dam', actions: [{ kind: 'shot', shot: 'dam_close' }] },
    { label: 'Downstream valley', actions: [{ kind: 'shot', shot: 'jendouba_wide' }] },
  ],
  widgets: [],
};
