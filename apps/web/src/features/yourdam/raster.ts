import { decodeGray16Png } from '@/scene/mellegue/flood';

/** HAND raster (m) downsampled for a 2D map; NaN = outside the corridor. */
export interface SmallHand {
  w: number;
  h: number;
  m: Float32Array;
}

export async function loadHandSmall(url: string, scale: number, maxW = 900): Promise<SmallHand> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HAND ${r.status}`);
  const png = await decodeGray16Png(await r.arrayBuffer());
  const k = Math.max(1, Math.ceil(png.width / maxW));
  const w = Math.floor(png.width / k);
  const h = Math.floor(png.height / k);
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // minimum of the k×k block keeps thin channels visible after downsampling
      let best = Infinity;
      for (let j = 0; j < k; j++)
        for (let i = 0; i < k; i++) {
          const raw = png.data[(y * k + j) * png.width + x * k + i]!;
          if (raw !== 65535) best = Math.min(best, raw * scale);
        }
      m[y * w + x] = Number.isFinite(best) ? best : Number.NaN;
    }
  return { w, h, m };
}

let canvas: HTMLCanvasElement | null = null;

/** Paint cells with HAND < level as water (amber, deeper = stronger); returns a PNG data URL. */
export function paintHand(r: SmallHand, level: number): string {
  canvas ??= document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(r.w, r.h);
  const d = img.data;
  for (let i = 0; i < r.m.length; i++) {
    const v = r.m[i]!;
    if (!(v < level)) continue;
    const depth = Math.min(1, (level - v) / Math.max(level, 0.5));
    d[i * 4] = 255;
    d[i * 4 + 1] = Math.round(181 - 60 * depth);
    d[i * 4 + 2] = 71;
    d[i * 4 + 3] = Math.round(120 + 120 * depth);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
