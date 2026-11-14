import type { ActConfig } from '../types';

export const act6: ActConfig = {
  act: 6,
  kicker: 'ACT 6 · COULD WE HAVE KNOWN?',
  title: 'An automatic alarm, from space.',
  body:
    'We taught HydroStress what a normal summer looks like for this lake. When the lake falls well below its recent normal, and a second satellite pass confirms it, it raises an alert. NISAR and Sentinel-1 together would have raised it on 22 June, five days after the failure, with no ground sensor.',
  expertBody:
    'Harmonised baseline rule: departure from 21-day multi-sensor rolling median. WARNING < −12%, ALERT < −20%, confirmed by independent pass within 6 days. Zero false alarms before the 17 June failure. On 22 June, Sentinel-1 o161 detected −21.2% drop, confirmed by o88, firing the first operational ALERT.',
  expertStats: [
    { label: 'Alert Triggered', value: '22 Jun', unit: '2026', badge: { kind: 'modelled', source: 'Dual-sensor detector' } },
    { label: 'Area Departure', value: '−21.2', unit: '%', badge: { kind: 'measured', source: 'Sentinel-1 o161' } },
    { label: 'Pre-failure False Alarms', value: '0', badge: { kind: 'modelled', source: '14-month validation' } },
    { label: 'Detection Latency', value: '5', unit: 'days', badge: { kind: 'modelled', source: 'Without ground sensors' } },
  ],
  badges: [
    { kind: 'modelled', source: 'Dual-pass change detector on 21-day baseline', subject: 'Anomaly algorithm' },
    { kind: 'measured', source: 'NISAR L-SAR + Copernicus Sentinel-1 C-SAR', subject: 'Constellation feed' },
  ],
  defaultShot: 'lake_top',
  defaultDate: '2026-06-22',
  compareDate: null,
  defaultLayers: {
    basemap: true,
    radar: true,
    mask: true,
    change: true,
    flowpath: false,
    flood: false,
    villages: false,
    cropland: false,
  },
};
