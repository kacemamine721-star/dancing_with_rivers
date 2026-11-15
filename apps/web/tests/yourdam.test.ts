import { describe, expect, it } from 'vitest';

import { DamSchema } from '@/features/yourdam/data';
import { boxOf, makeProjection } from '@/features/yourdam/projection';
import { makeSteps } from '@/features/yourdam/steps';

const sparse = DamSchema.parse({ id: 'x', name: 'Barrage X', lon: 9, lat: 36.5, status: 'catalogued' });

describe('your dam', () => {
  it('step texts never print undefined / null / NaN when data is missing', () => {
    for (const s of makeSteps(new Map())) {
      for (const t of [s.title(sparse), s.simple(sparse), s.expert(sparse)]) {
        expect(t).not.toMatch(/undefined|null|NaN/);
      }
      expect(s.stat?.(sparse) ?? null).toBeNull();
    }
  });

  it('marks watch and flood as planned for catalogued dams', () => {
    const ids = makeSteps(new Map()).filter((s) => s.processedOnly).map((s) => s.id);
    expect(ids).toEqual(['watch', 'flood']);
  });

  it('projects north up and keeps the requested aspect', () => {
    const p = makeProjection([7.5, 30, 11.6, 37.6], 1000);
    expect(p.project([7.5, 37.6])).toEqual([0, 0]);
    expect(p.project([7.5, 30])[1]).toBeGreaterThan(0);
    const b = boxOf([[[8.6, 36.2], [8.8, 36.4]]], p.project, 1.6);
    expect(b).not.toBeNull();
    expect(b!.w / b!.h).toBeCloseTo(1.6, 5);
  });
});
