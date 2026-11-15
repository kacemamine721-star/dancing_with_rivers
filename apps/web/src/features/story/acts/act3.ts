import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act3: ActConfig = {
  act: 3,
  short: 'What NISAR saw',
  kicker: 'ACT 3 · WHAT NISAR SAW',
  title: 'Two days later, the lake was already changing.',
  body:
    'On 19 June, 46 hours after the failure, NISAR passed over. Calm water reflects radar away like a mirror, so the lake looks black. The slider compares it with Sentinel-1 on 17 June, a different radar, so compare the outline, not the shades. Scrub the dates: on NISAR’s own tracks the lake shrinks by about {nisar.julyDrop}% from early to mid-July.',
  expertBody:
    'Same-orbit Sentinel-1 brightens at once (median −14.9 → −12.5 dB, orbit 88, 17 → 22 Jun); NISAR’s area lags for two weeks (D80 {nisar.d80.first} → {nisar.d80.second} km², 19 Jun → 1 Jul) because wet mud is as dark as water at L-band. Water is mapped with an adaptive (Otsu) threshold chosen per image inside the pre-failure lake polygon, after a 5×5 boxcar filter.',
  facts: ['date.image', 'date.area', 'date.areaRange'],
  expertFacts: ['nisar.d80.first', 'nisar.d80.second', 'nisar.julyDrop'],
  badges: [
    { from: 'file', file: 'reservoir_area', subject: 'Water area' },
    { from: 'layer', layer: 'nisar_2026-06-19_D80F70_HH', subject: 'NISAR L-band image' },
    {
      from: 'static',
      kind: 'modelled',
      source: 'This project (02_reservoir.py)',
      method: 'Adaptive threshold (Otsu), chosen per image inside the lake polygon + 300 m ring',
      subject: 'Water threshold',
    },
  ],
  stage: {
    shot: 'lake_top',
    date: '2026-06-19',
    compareDate: '2026-06-17',
    swipe: 0.5,
    layers: onlyLayers('basemap', 'radar'),
  },
  tryIt: [
    {
      label: 'Same sensor · S1 17 → 22 Jun',
      actions: [
        { kind: 'compare', date: '2026-06-17', swipe: 0.5 },
        { kind: 'date', date: '2026-06-22' },
      ],
      hint: 'Sentinel-1 orbit 88 on both sides of the slider',
    },
    {
      label: 'Cross-sensor · S1 → NISAR 19 Jun',
      actions: [
        { kind: 'compare', date: '2026-06-17', swipe: 0.5 },
        { kind: 'date', date: '2026-06-19' },
      ],
    },
    { label: 'Water mask', actions: [{ kind: 'layer', layer: 'mask' }], hint: 'Show or hide the water mask' },
  ],
  widgets: ['swipe', 'scrubber'],
};
