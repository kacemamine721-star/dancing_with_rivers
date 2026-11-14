/**
 * Scene coordinates for the Mellègue stage.
 *
 * 1 scene unit = 1 km. Origin = centre of `grid.json` `bounds_m` (EPSG:32632, UTM 32N).
 * +x = east, −z = north, +y = up. Height y = (metres − z_min) / 1000 × exaggeration.
 * Rasters are sampled in "image UV": u from the west edge, v from the NORTH edge (row 0 = north).
 */
import type { Grid } from '@/data/schemas.gen';

/** Mellègue dam point, lon/lat WGS84 (config.yaml `dam.lonlat`, user-supplied; not in the manifest). */
export const DAM_LONLAT: readonly [number, number] = [8.702611, 36.314248];

export type Vec3 = [number, number, number];

// WGS84 / UTM zone 32N
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const LON0 = (9 * Math.PI) / 180;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);

/** Transverse Mercator forward (Snyder series), UTM zone 32N. Sub-metre inside the zone. */
export function lonLatToUtm32(lonDeg: number, latDeg: number): [number, number] {
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const a = c * (lam - LON0);
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const M =
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));
  const a2 = a * a;
  const x = K0 * N * (a + ((1 - T + C) * a2 * a) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 * a2 * a) / 120);
  const y =
    K0 *
    (M +
      N *
        t *
        (a2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * a2 * a2) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 * a2 * a2) / 720));
  return [x + 500000, y];
}

/** CPU copy of the decoded heightmap (RGBA bytes, row 0 = north). */
export type HeightData = { width: number; height: number; rgba: Uint8Array | Uint8ClampedArray };

export class SceneFrame {
  readonly cx: number;
  readonly cy: number;
  /** Terrain size in km (east–west, north–south). */
  readonly width: number;
  readonly depth: number;
  exag: number;
  /** Terrain mesh subdivisions (set by the scene for the current quality tier). */
  segX = 512;
  segZ = 392;
  private heights: HeightData | null = null;

  constructor(
    readonly grid: Grid,
    exag: number,
  ) {
    const [x0, y0, x1, y1] = grid.bounds_m;
    this.cx = (x0 + x1) / 2;
    this.cy = (y0 + y1) / 2;
    this.width = (x1 - x0) / 1000;
    this.depth = (y1 - y0) / 1000;
    this.exag = exag;
  }

  setHeights(h: HeightData): void {
    this.heights = h;
  }

  /** Metres → scene y. */
  metresToY(m: number): number {
    return ((m - this.grid.z_min) / 1000) * this.exag;
  }

  /** UTM 32N metres → scene. With `zMetres` omitted, y is sampled from the heightmap. */
  utmToScene(x: number, y: number, zMetres?: number): Vec3 {
    const sx = (x - this.cx) / 1000;
    const sz = -(y - this.cy) / 1000;
    return [sx, zMetres === undefined ? this.sampleHeight(sx, sz) : this.metresToY(zMetres), sz];
  }

  lonLatToScene(lon: number, lat: number, zMetres?: number): Vec3 {
    const [x, y] = lonLatToUtm32(lon, lat);
    return this.utmToScene(x, y, zMetres);
  }

  /** Scene x/z → image UV (u from west, v from north). */
  sceneToUv(sx: number, sz: number): [number, number] {
    return [sx / this.width + 0.5, sz / this.depth + 0.5];
  }

  /** `bounds_m` rectangle → image-UV rect [u0, v0, u1, v1] (v0 = north edge). */
  rectUv(b: readonly [number, number, number, number]): [number, number, number, number] {
    const [x0, y0, x1, y1] = this.grid.bounds_m;
    return [(b[0] - x0) / (x1 - x0), (y1 - b[3]) / (y1 - y0), (b[2] - x0) / (x1 - x0), (y1 - b[1]) / (y1 - y0)];
  }

  private texel(ix: number, iy: number): number {
    const h = this.heights!;
    const x = ix < 0 ? 0 : ix >= h.width ? h.width - 1 : ix;
    const y = iy < 0 ? 0 : iy >= h.height ? h.height - 1 : iy;
    const i = (y * h.width + x) * 4;
    const { scale, offset } = this.grid.height_encoding;
    return (h.rgba[i]! * 256 + h.rgba[i + 1]!) * scale + offset;
  }

  /** Bilinear terrain height in metres at a scene position (z_min when the heightmap is not loaded). */
  sampleMetres(sx: number, sz: number): number {
    const h = this.heights;
    if (!h) return this.grid.z_min;
    const [u, v] = this.sceneToUv(sx, sz);
    const px = u * h.width - 0.5;
    const py = v * h.height - 0.5;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const a = this.texel(ix, iy);
    const b = this.texel(ix + 1, iy);
    const c = this.texel(ix, iy + 1);
    const d = this.texel(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /** Terrain height in scene units (km × exaggeration) at a scene position, for placing markers. */
  sampleHeight(sx: number, sz: number): number {
    return this.metresToY(this.sampleMetres(sx, sz));
  }

  /** Mesh subdivisions for a long-side segment count (same rule as the terrain PlaneGeometry). */
  setMesh(long: number): void {
    this.segX = long;
    this.segZ = Math.round((long * this.depth) / this.width);
  }

  /**
   * Height of the rendered terrain SURFACE (scene units): the mesh is only sampled at its vertices
   * and linearly interpolated between them, so in narrow valleys it sits above the true DEM. Lines
   * draped on rivers must follow this surface or they are buried. Triangulation = PlaneGeometry's
   * (diagonal from (ix, iy+1) to (ix+1, iy), iy = 0 on the north edge).
   */
  surfaceHeight(sx: number, sz: number): number {
    const fxAll = (sx / this.width + 0.5) * this.segX;
    const fzAll = (sz / this.depth + 0.5) * this.segZ;
    const ix = Math.min(this.segX - 1, Math.max(0, Math.floor(fxAll)));
    const iz = Math.min(this.segZ - 1, Math.max(0, Math.floor(fzAll)));
    const fx = Math.min(1, Math.max(0, fxAll - ix));
    const fz = Math.min(1, Math.max(0, fzAll - iz));
    const vx = (i: number) => (i / this.segX - 0.5) * this.width;
    const vz = (j: number) => (j / this.segZ - 0.5) * this.depth;
    const h = (i: number, j: number) => this.sampleHeight(vx(i), vz(j));
    const a = h(ix, iz);
    const b = h(ix, iz + 1);
    const d = h(ix + 1, iz);
    if (fx + fz <= 1) return a + (d - a) * fx + (b - a) * fz;
    const c = h(ix + 1, iz + 1);
    return c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
  }
}
