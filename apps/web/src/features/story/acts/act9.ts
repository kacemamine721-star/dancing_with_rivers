import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act9: ActConfig = {
  act: 9,
  short: 'Every dam',
  kicker: 'ACT 9 · DAM WATCH FOR EVERY DAM',
  title: 'One lake today. Every dam tomorrow.',
  body:
    'Tunisia’s daily dam bulletins stopped in October 2025. NISAR passes over every reservoir in the country every 12 days per track, for free. HydroStress could turn that into an independent watch: area, alerts, level and flood scenarios. Today it covers one reservoir, Mellègue; the same steps are designed to run on any dam (roadmap).',
  expertBody:
    'Roadmap: the Mellègue catchment covers {catchment.mellegue} km² and Sidi Salem’s {catchment.sidisalem} km² (derived from HydroBASINS). Adding a dam means a lake polygon and the same radar series, detector, terrain and flood steps, with the detector tested out of sample. None of that is done for other dams yet.',
  facts: ['watch.dams', 'watch.sensors', 'onagri.stopped'],
  expertFacts: ['catchment.mellegue', 'catchment.sidisalem'],
  badges: [
    { from: 'file', file: 'reservoir_area', subject: 'Watched lake' },
    {
      from: 'static',
      kind: 'reported',
      source: 'Business News, 23 Jun 2026 — see Sources',
      subject: 'Dam bulletins stopped',
    },
  ],
  stage: {
    shot: 'catchment_wide',
    date: '2026-10-29',
    compareDate: null,
    layers: onlyLayers('basemap', 'radar', 'flowpath', 'villages'),
  },
  tryIt: [
    { label: 'Open Dam Watch', actions: [{ kind: 'navigate', to: '/watch' }] },
    { label: 'Methods & validation', actions: [{ kind: 'navigate', to: '/methods' }] },
    { label: 'Sources', actions: [{ kind: 'navigate', to: '/sources' }] },
    { label: 'Replay the story', actions: [{ kind: 'navigate', to: '/story/1' }] },
  ],
  widgets: ['catchment'],
};
