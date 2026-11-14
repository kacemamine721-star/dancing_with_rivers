import type { ActConfig } from '../types';

export const act8: ActConfig = {
  act: 8,
  kicker: 'ACT 8 · LEVEL & VOLUME',
  title: 'From area to water level and volume.',
  body:
    'Radar shows how big the lake is. To know how much water it holds, we add SWOT, a NASA–CNES satellite that measures lake height, and the shape of the valley. Together they estimate how many million m³ left.',
  expertBody:
    'Surface Water and Ocean Topography (SWOT) Ka-band radar interferometer measures absolute water surface elevation (WSE) ± 10 cm. Combined with DEM hypsometry (area-elevation curves), radar surface area translates directly into volume depletion estimates.',
  expertStats: [
    { label: 'Satellite', value: 'SWOT', unit: 'KaRIn', badge: { kind: 'measured', source: 'NASA / CNES' } },
    { label: 'Elevation Precision', value: '± 10', unit: 'cm', badge: { kind: 'measured', source: 'Ka-band KaRIn' } },
    { label: 'Volume Method', value: 'Hypsometry', badge: { kind: 'modelled', source: 'DEM integration' } },
    { label: 'Reported Loss', value: '≈ 21', unit: 'Mm³', badge: { kind: 'reported', source: 'Official report' } },
  ],
  badges: [
    { kind: 'measured', source: 'NASA–CNES SWOT Satellite Radar Altimetry', subject: 'Water elevation' },
    { kind: 'modelled', source: 'GEM-15 Shoreline Contour Inversion', subject: 'Volume curve' },
  ],
  defaultShot: 'lake_top',
  defaultDate: '2026-07-15',
  compareDate: null,
  defaultLayers: {
    basemap: true,
    radar: true,
    mask: true,
    change: false,
    flowpath: false,
    flood: false,
    villages: false,
    cropland: false,
  },
};
