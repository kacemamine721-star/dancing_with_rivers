/**
 * Inverse UTM (WGS84) for vector files in a UTM CRS (EPSG:326zz north / 327zz south), so any dam's
 * bundle can be drawn on the lon/lat map. Snyder (1987) series; error well under a metre in-zone.
 */
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;

export function utmZoneOf(crsName: string | undefined): { zone: number; south: boolean } | null {
  const m = /EPSG:{1,2}(32[67])(\d\d)\b/.exec(crsName ?? '');
  if (!m) return null;
  return { zone: Number(m[2]), south: m[1] === '327' };
}

export function utmToLonLat(x: number, y: number, zone: number, south = false): [number, number] {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const M = (south ? y - 10_000_000 : y) / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const p1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1);
  const c = Math.cos(p1);
  const t = Math.tan(p1);
  const N1 = A / Math.sqrt(1 - E2 * s * s);
  const T1 = t * t;
  const C1 = EP2 * c * c;
  const R1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5;
  const D = (x - 500_000) / (N1 * K0);
  const lat =
    p1 -
    ((N1 * t) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon =
    (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  const lon0 = (zone - 1) * 6 - 180 + 3;
  return [lon0 + (lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** Reproject a GeoJSON FeatureCollection in a UTM CRS to lon/lat (other CRSs returned unchanged). */
export function toLonLat<T extends { crs?: { properties?: { name?: string } }; features: { geometry: { type: string; coordinates: unknown } | null }[] }>(fc: T): T {
  const z = utmZoneOf(fc.crs?.properties?.name);
  if (!z) return fc;
  const conv = (c: unknown): unknown =>
    Array.isArray(c) && typeof c[0] === 'number' ? utmToLonLat(c[0] as number, c[1] as number, z.zone, z.south) : Array.isArray(c) ? c.map(conv) : c;
  return {
    ...fc,
    crs: undefined,
    features: fc.features.map((f) => (f.geometry ? { ...f, geometry: { ...f.geometry, coordinates: conv(f.geometry.coordinates) } } : f)),
  };
}
