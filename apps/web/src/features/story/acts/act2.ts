import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act2: ActConfig = {
  act: 2,
  short: 'The night',
  kicker: 'ACT 2 · THE NIGHT OF 17 JUNE',
  title: 'About 21:15, a gate gives way.',
  body:
    'A planned release of 100,000 m³ for irrigation turned into an uncontrolled flow when a gate failed. In a few hours about {release.reported} million m³ left the lake, about {release.ratio} times what was planned. Farmland downstream was damaged.',
  expertBody:
    'Press reports give {release.reported} Mm³ (La Presse; one outlet {release.alt} Mm³) released after the upper sector gate failed. The last image before it is Sentinel-1 orbit 88 at {lake.lastLookTime} UTC (18:20 local), about 3 hours earlier: open water {lake.lastLook} km² ({lake.lastLookRange} km² for a ±2 dB threshold; the lake was wind-roughened). No satellite imaged the failure itself.',
  facts: ['gate.time', 'release.planned', 'release.range'],
  expertFacts: ['lake.lastLookTime', 'lake.lastLook', 'lake.lastLookRange'],
  badges: [
    {
      from: 'static',
      kind: 'reported',
      source: 'Business News, 18 Jun 2026 (gate, 100,000 m³); La Presse, 19 Jun 2026 (21 Mm³); La Presse, 18 Jun 2026 (farmland) — see Sources',
      subject: 'Incident timeline',
    },
    { from: 'layer', layer: 's1_2026-06-17_o88_VV', subject: 'Last radar image before the failure' },
  ],
  stage: {
    shot: 'night_dam',
    date: '2026-06-17',
    compareDate: null,
    layers: onlyLayers('basemap', 'radar'),
  },
  tryIt: [
    {
      label: 'Last image before · 17 Jun S1',
      actions: [
        { kind: 'date', date: '2026-06-17' },
        { kind: 'layer', layer: 'radar', on: true },
        { kind: 'shot', shot: 'lake_top' },
      ],
    },
    { label: 'Back to the night', actions: [{ kind: 'shot', shot: 'night_dam' }] },
  ],
  widgets: [],
};
