import type { ActConfig } from '../types';
import { onlyLayers } from './layers';

export const act6: ActConfig = {
  act: 6,
  short: 'Could we have known?',
  kicker: 'ACT 6 · COULD WE HAVE KNOWN?',
  title: 'An automatic alarm, from space.',
  body:
    'HydroStress compares each new measurement with the median of the previous 21 days. When the lake is more than 20% below it, and another pass confirms it, it raises an alert. NISAR and Sentinel-1 together would have raised it on {alert.first}, {alert.latency} days after the failure, with no ground sensor.',
  expertBody:
    'WARNING below −12%, ALERT below −20%, each confirmed by an independent pass within 6 days. The first ALERT came from {alert.firstTrack} ({alert.firstDeparture}%), confirmed by {alert.confirmTrack} ({alert.confirmDeparture}%). Flags before the failure: {alert.before} in {alert.beforeEvals} checks. The 22 June alert comes from two Sentinel-1 passes; NISAR’s first flag is {alert.firstNisar}. The {alert.later} flags from August to November follow real multi-sensor changes and need an operator check. This is a retrospective test: thresholds were set on this event and still need testing on other reservoirs.',
  facts: ['alert.first', 'alert.latency', 'alert.before'],
  expertFacts: ['alert.firstDeparture', 'alert.firstNisar', 'alert.later'],
  badges: [
    { from: 'file', file: 'alerts', subject: 'Anomaly detector' },
    { from: 'file', file: 'reservoir_area', subject: 'Input water areas' },
  ],
  stage: {
    shot: 'lake_top',
    date: '2026-06-22',
    compareDate: null,
    layers: onlyLayers('basemap', 'radar', 'mask'),
  },
  tryIt: [
    { label: '22 Jun · Sentinel-1 o88', actions: [{ kind: 'date', date: '2026-06-22' }] },
    { label: '17 Jun · before', actions: [{ kind: 'date', date: '2026-06-17' }] },
  ],
  widgets: ['alerts', 'scrubber'],
};
