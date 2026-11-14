/** Rasterise polygon layers (UTM metres) onto the scene grid, as a mask texture sampled in image UV. */
import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, NoColorSpace } from 'three';

import type { Grid } from '@/data/schemas.gen';
import type { FeatureCollection, Position } from '@/scene/mellegue/vectors';

export function rasterizePolygons(fc: FeatureCollection, grid: Grid): CanvasTexture | null {
  const [w, h] = grid.size_px;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const [x0, y0, x1, y1] = grid.bounds_m;
  const sx = w / (x1 - x0);
  const sy = h / (y1 - y0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  const ring = (r: Position[]) => {
    r.forEach((p, i) => {
      const px = (p[0]! - x0) * sx;
      const py = (y1 - p[1]!) * sy;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  };
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      ctx.beginPath();
      poly.forEach(ring);
      ctx.fill('evenodd');
    }
  }
  const t = new CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = NoColorSpace;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
