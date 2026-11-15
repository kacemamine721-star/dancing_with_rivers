import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act4: ActConfig = {
  act: 4,
  short: 'Where it went',
  kicker: 'ACT 4 · WHERE THE WATER WENT',
  title: 'Downhill, all the way to Sidi Salem.',
  body:
    'Water always takes the steepest way down. Following the terrain, the release travelled down the Mellègue into the Medjerda and reached the Sidi Salem reservoir 3 to 4 days later (reported: {sidisalem.arrival}). Sidi Salem absorbed it.',
  expertBody:
    'Steepest-descent (D8) routing on GEM-15 averaged to 30 m gives a {path.length} km path. ANUGA scenario (21 Mm³ over an assumed 12 h): front at the Medjerda confluence after about {anuga.v21.confluence} h (19 h on a coarser mesh, so timing is mesh-sensitive). The model stops 2 km below the confluence: the arrival at Sidi Salem is reported, not modelled.',
  facts: ['path.length', 'anuga.v21.confluence', 'sidisalem.arrival'],
  badges: [
    { from: 'layer', layer: 'flowpath', subject: 'Flow path (D8)' },
    { from: 'file', file: 'anuga', subject: 'ANUGA arrival times' },
    {
      from: 'static',
      kind: 'reported',
      source: 'AllAfrica, 24 Jun 2026; Tunisie Numérique — see Sources',
      subject: 'Arrival at Sidi Salem',
    },
  ],
  stage: {
    shot: 'valley_follow',
    date: '2026-06-21',
    compareDate: null,
    layers: onlyLayers('basemap', 'flowpath', 'villages'),
  },
  tryIt: [
    { label: 'Follow the water', actions: [{ kind: 'shot', shot: 'valley_follow' }] },
    { label: 'Jendouba plain', actions: [{ kind: 'shot', shot: 'jendouba_wide' }] },
    { label: 'Sidi Salem', actions: [{ kind: 'shot', shot: 'sidi_salem' }] },
  ],
  widgets: ['corridor'],
};
