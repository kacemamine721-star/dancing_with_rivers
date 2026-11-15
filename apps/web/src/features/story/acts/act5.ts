import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act5: ActConfig = {
  act: 5,
  short: 'A month of draining',
  kicker: 'ACT 5 · A MONTH OF DRAINING',
  title: 'Every few days, a new look.',
  body:
    'Combining NISAR’s tracks gives a new image of the lake every 2–7 days (except a mission-wide gap {obs.gap}), through clouds, day or night. The lake kept shrinking until the gate was repaired on 16 July, from {lake.lastLook} km² on 17 June to about {lake.low} km² in late July. It stayed low through August and rose again with the autumn rain.',
  expertBody:
    '{obs.total} measurements ({obs.nisar} NISAR + {obs.s1} Sentinel-1; {obs.lowConf} flagged low-confidence for wind), each with its own adaptive threshold, counted inside the pre-failure lake polygon. The line is a 21-day multi-sensor median of the reliable points, broken across the NISAR gap; the band is the threshold ±2 dB sensitivity. Hollow points are low confidence and stay out of the line.',
  facts: ['lake.lastLook', 'lake.low', 'repair.date'],
  expertFacts: ['obs.total', 'lake.lowWhen', 'lake.rise'],
  badges: [
    { from: 'file', file: 'reservoir_area', subject: 'Lake area series' },
    { from: 'static', kind: 'reported', source: 'Managers, 16 Jul 2026 — see Sources', subject: 'Gate repair date' },
  ],
  stage: {
    shot: 'lake_top',
    date: '2026-07-15',
    compareDate: null,
    layers: onlyLayers('basemap', 'radar', 'mask'),
  },
  tryIt: [
    { label: '17 Jun · Sentinel-1 before', actions: [{ kind: 'date', date: '2026-06-17' }] },
    { label: '15 Jul · NISAR A101', actions: [{ kind: 'date', date: '2026-07-15' }] },
    { label: '29 Oct · NISAR D80', actions: [{ kind: 'date', date: '2026-10-29' }] },
  ],
  widgets: ['reservoirChart', 'scrubber'],
};
