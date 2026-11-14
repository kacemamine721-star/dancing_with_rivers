import type { ActConfig } from '../types';

export const act3: ActConfig = {
  act: 3,
  kicker: 'ACT 3 · WHAT NISAR SAW',
  title: 'Two days later, the lake was already changing.',
  body:
    'On 19 June, 46 hours after the failure, NISAR passed over. Calm water reflects radar away like a mirror, so the lake looks black. Drag the slider: the black is turning grey where water has given way to wet mud, and week after week the lake shrinks.',
  expertBody:
    'Calm open water produces specular forward reflection away from antenna (γ⁰ < −18 dB). Post-drawdown wet mud backscatters more energy at L-band (24 cm, HH) as surface dries and roughens (−17 dB → −14 dB). Otsu adaptive segmentation inside 4.68 km² lake mask.',
  expertStats: [
    { label: 'Satellite', value: 'NISAR', badge: { kind: 'measured', source: 'NASA/JPL–ISRO' } },
    { label: 'Frequency', value: 'L-band', unit: '24 cm', badge: { kind: 'measured', source: 'NISAR GCOV' } },
    { label: 'Polarisation', value: 'HH', badge: { kind: 'measured', source: 'Calibrated dB' } },
    { label: 'Threshold', value: '−18', unit: 'dB', badge: { kind: 'measured', source: 'Adaptive Otsu' } },
  ],
  badges: [
    { kind: 'measured', source: 'NASA/JPL–ISRO NISAR L-SAR GCOV (ASF DAAC)', subject: 'L-band radar chip' },
    { kind: 'measured', source: 'Copernicus Sentinel-1 RTC', subject: 'Reference image 17 Jun' },
  ],
  defaultShot: 'lake_top',
  defaultDate: '2026-06-19',
  compareDate: '2026-06-17',
  defaultLayers: {
    basemap: true,
    radar: true,
    mask: false,
    change: false,
    flowpath: false,
    flood: false,
    villages: false,
    cropland: false,
  },
};
