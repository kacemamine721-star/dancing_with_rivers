import type { ActConfig } from '../types';

export const act4: ActConfig = {
  act: 4,
  kicker: 'ACT 4 · WHERE THE WATER WENT',
  title: 'Downhill, all the way to Sidi Salem.',
  body:
    "Water always takes the steepest way down. Following the terrain, the release travelled down the Mellègue into the Medjerda and reached Sidi Salem, the country's largest reservoir, about 4 days later. Sidi Salem absorbed it.",
  expertBody:
    'D8 routing on GEM-15 15 m DTM traces 101.0 km channel corridor (98.8% agreement within 300 m of OSM river lines). Medjerda confluence at km 44.9; Bou Salem at km 66.8. ANUGA 2D shallow water hydrodynamic wave simulates 19.1 h arrival time at the Medjerda confluence.',
  expertStats: [
    { label: 'Flow Path Length', value: '101.0', unit: 'km', badge: { kind: 'modelled', source: 'D8 Flow Routing' } },
    { label: 'Confluence', value: 'km 44.9', badge: { kind: 'measured', source: 'HydroRIVERS' } },
    { label: 'Confluence Arrival', value: '19.1', unit: 'h', badge: { kind: 'modelled', source: 'ANUGA 2D v21' } },
    { label: 'Sidi Salem Arrival', value: '21 Jun', badge: { kind: 'reported', source: 'Official Communiqué' } },
  ],
  badges: [
    { kind: 'modelled', source: 'ANUGA 2D Hydrodynamic Model & D8 routing', subject: 'Wave routing' },
    { kind: 'reported', source: 'General Directorate of Dams (DGBGTH)', subject: 'Sidi Salem arrival' },
  ],
  defaultShot: 'valley_follow',
  defaultDate: '2026-06-21',
  compareDate: null,
  defaultLayers: {
    basemap: true,
    radar: false,
    mask: false,
    change: false,
    flowpath: true,
    flood: false,
    villages: true,
    cropland: true,
  },
};
