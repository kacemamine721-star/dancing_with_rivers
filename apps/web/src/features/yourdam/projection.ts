/**
 * Equirectangular projection scaled by cos(latitude) at the map centre (Tunisia spans ~7° of
 * latitude, so distortion is small). SVG y points down. Units: map px at scale 1.
 */
export type Position = [number, number];
export type Box = { x: number; y: number; w: number; h: number };

export function makeProjection(bbox: readonly [number, number, number, number], width = 1000) {
  const [w, s, e, n] = bbox;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const sx = width / ((e - w) * k);
  const height = (n - s) * sx;
  const project = ([lon, lat]: Position): Position => [(lon - w) * k * sx, (n - lat) * sx];
  /** px per km at the map centre */
  const pxPerKm = sx / 111.32 / 1; // 1° latitude ≈ 111.32 km and x is scaled by k already
  return { width, height, project, pxPerKm };
}

export function pathD(parts: Position[][], project: (p: Position) => Position, close = false): string {
  return parts
    .map((ring) =>
      ring.length
        ? ring.map((p, i) => {
            const [x, y] = project(p);
            return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join('') + (close ? 'Z' : '')
        : '',
    )
    .join('');
}

/** Bounding box (map px) of all parts, padded, with a minimum size and the given aspect ratio. */
export function boxOf(parts: Position[][], project: (p: Position) => Position, aspect: number, pad = 0.18, minW = 60): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of parts)
    for (const p of r) {
      const [x, y] = project(p);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (!Number.isFinite(x0)) return null;
  let w = Math.max(minW, (x1 - x0) * (1 + 2 * pad));
  let h = Math.max(minW / aspect, (y1 - y0) * (1 + 2 * pad));
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
