import { describe, expect, it } from 'vitest';

import type { Grid } from '@/data/schemas.gen';
import { lonLatToUtm32, SceneFrame } from '@/scene/coords';

const grid: Grid = {
  schema_version: 1,
  crs: 'EPSG:32632',
  bounds_m: [450480, 3995040, 545010, 4067310],
  bounds_lonlat: [8.45, 36.1, 9.5, 36.75],
  res_m: 46.157,
  size_px: [2048, 1566],
  height_encoding: { type: 'rg16', scale: 0.1, offset: -100 },
  z_min: 56,
  z_max: 1070,
  lake_chip: {
    bounds_m: [469910, 4016140, 476220, 4020610],
    bounds_lonlat: [8.665, 36.29, 8.735, 36.33],
    res_m: 10,
    size_px: [631, 447],
  },
  placeholder: false,
};

describe('lonLatToUtm32', () => {
  it('matches pyproj EPSG:32632 to < 1 m', () => {
    // pyproj 3.7.2: Transformer.from_crs(4326, 32632, always_xy=True)
    const cases: [number, number, number, number][] = [
      [9, 0, 500000, 0],
      [8.702611, 36.314248, 473303.741, 4018845.096],
      [9.5, 36.75, 544633.421, 4067256.168],
      [8.45, 36.1, 450492.23, 3995180.015],
    ];
    for (const [lon, lat, x, y] of cases) {
      const [ux, uy] = lonLatToUtm32(lon, lat);
      expect(Math.abs(ux - x)).toBeLessThan(1);
      expect(Math.abs(uy - y)).toBeLessThan(1);
    }
  });
});

describe('SceneFrame', () => {
  const f = new SceneFrame(grid, 2.5);
  it('puts the grid centre at the origin, +x east, −z north, 1 unit = 1 km', () => {
    const o = f.utmToScene(497745, 4031175, 56);
    expect(o[0]).toBeCloseTo(0);
    expect(o[1]).toBeCloseTo(0);
    expect(o[2]).toBeCloseTo(0);
    const [x, y, z] = f.utmToScene(498745, 4033175, 1056);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(-2);
    expect(y).toBeCloseTo(2.5);
  });
  it('maps the lake chip to image UV with v from the north edge', () => {
    const [u0, v0, u1, v1] = f.rectUv(grid.lake_chip.bounds_m);
    expect(u0).toBeCloseTo(19430 / 94530);
    expect(u1).toBeCloseTo(25740 / 94530);
    expect(v0).toBeCloseTo(46700 / 72270);
    expect(v1).toBeCloseTo(51170 / 72270);
  });
  it('samples the RG16 heightmap bilinearly', () => {
    const w = 4;
    const h = 2;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const dm = 1560 + (i % w) * 1000; // 56 m, 156 m, 256 m, 356 m
      rgba[i * 4] = dm >> 8;
      rgba[i * 4 + 1] = dm & 255;
    }
    const g = new SceneFrame(grid, 1);
    g.setHeights({ width: w, height: h, rgba });
    expect(g.sampleMetres(-g.width / 2 + g.width / 8, 0)).toBeCloseTo(56, 3);
    expect(g.sampleMetres(0, 0)).toBeCloseTo(206, 3);
    expect(g.sampleHeight(0, 0)).toBeCloseTo(0.15, 4);
  });
});
