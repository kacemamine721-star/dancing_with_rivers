import { describe, expect, it } from 'vitest';

import type { DamBundle } from '@/features/yourdam/bundle';
import { DamSchema } from '@/features/yourdam/data';
import { boxOf, makeProjection } from '@/features/yourdam/projection';
import { buildSteps, ORDER } from '@/features/yourdam/steps';

const sparse = DamSchema.parse({ id: 'x', name: null, osm_id: 'w1', lon: 9, lat: 36.5, status: 'catalogued' });
const empty = { ready: true, missing: true } as unknown as DamBundle;

describe('your dam', () => {
  it('never invents a name, shows OSM id instead', () => {
    expect(sparse.name).toBe('Unnamed reservoir (OSM w1)');
  });
  it('one step per stage, no undefined/NaN, missing data → dash + pending', () => {
    const steps = buildSteps(sparse, empty);
    expect(steps.map((s) => s.id)).toEqual(ORDER);
    for (const s of steps) {
      for (const t of [s.value, s.unit ?? '', s.simple, s.expert]) expect(t).not.toMatch(/undefined|null|NaN/);
      if (s.id !== 'find') expect(s.value === '—' && s.pending).toBe(true);
    }
  });
  it('projects north up and keeps the requested aspect', () => {
    const p = makeProjection([7.5, 30, 11.6, 37.6], 1000);
    expect(p.project([7.5, 37.6])).toEqual([0, 0]);
    const b = boxOf([[[8.6, 36.2], [8.8, 36.4]]], p.project, 1.6);
    expect(b!.w / b!.h).toBeCloseTo(1.6, 5);
  });
});

import { toLonLat, utmToLonLat, utmZoneOf } from '@/features/yourdam/utm';

describe('utm', () => {
  it('Mellègue flow-path start (UTM 32N) lands at the dam', () => {
    const [lon, lat] = utmToLonLat(473175, 4019085, 32);
    expect(lon).toBeCloseTo(8.7, 1);
    expect(lat).toBeCloseTo(36.31, 1);
  });
  it('reads the zone from the GeoJSON crs and reprojects', () => {
    expect(utmZoneOf('urn:ogc:def:crs:EPSG::32632')).toEqual({ zone: 32, south: false });
    const fc = toLonLat({ crs: { properties: { name: 'urn:ogc:def:crs:EPSG::32632' } }, features: [{ geometry: { type: 'LineString', coordinates: [[500000, 4000000]] } }] });
    const c = (fc.features[0]!.geometry!.coordinates as number[][])[0]!;
    expect(c[0]).toBeCloseTo(9, 6);
    expect(c[1]).toBeCloseTo(36.14, 1);
  });
});
