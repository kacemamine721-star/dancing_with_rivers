/**
 * Flood layers for the 3D stage (Act 4 / Act 7): HAND quick flood (volume → height from
 * hand_lut.json) and ANUGA scenario depth rasters (max depth + time frames). All rasters are on the
 * scene grid (grid.json), so they drape with the terrain's image UV directly.
 */
import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
  DataUtils,
  DefaultLoadingManager,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RedFormat,
  UnsignedByteType,
} from 'three';

import type { AnugaIndex, HandLut } from '@/data/schemas.gen';

export type AnugaScenario = AnugaIndex['scenarios'][number];

// ---------------------------------------------------------------- HAND lookup

/**
 * Water height above the drainage (m) for a released volume, by linear interpolation of the
 * lookup table V(h). Below the first row the height scales linearly to 0; above the last it clamps.
 */
export function heightForVolume(rows: HandLut['rows'], volumeM3: number): number {
  if (rows.length === 0 || !(volumeM3 > 0)) return 0;
  const sorted = rows[0]!.V_m3 <= rows[rows.length - 1]!.V_m3 ? rows : [...rows].sort((a, b) => a.V_m3 - b.V_m3);
  const first = sorted[0]!;
  if (volumeM3 <= first.V_m3) return first.V_m3 > 0 ? (first.h * volumeM3) / first.V_m3 : first.h;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (volumeM3 <= b.V_m3) {
      const t = b.V_m3 > a.V_m3 ? (volumeM3 - a.V_m3) / (b.V_m3 - a.V_m3) : 1;
      return a.h + (b.h - a.h) * t;
    }
  }
  return sorted[sorted.length - 1]!.h;
}

// ---------------------------------------------------------------- ANUGA scenarios

/** The scenario to drape, only when it exists AND has been computed (else the caller falls back to HAND). */
export function computedScenario(index: AnugaIndex | undefined, id: string | undefined): AnugaScenario | null {
  if (!index || !id) return null;
  const s = index.scenarios.find((x) => x.id === id);
  return s && s.computed && s.files ? s : null;
}

/** Metres per byte of an r8 depth raster (index.json: depth = value / 255 × max). */
export function depthScale(s: AnugaScenario): number {
  return (s.depth_encoding?.max ?? 8) / 255;
}

/** Playback of the ANUGA frames, readable by the UI (e.g. an "+12 h" readout) without a store write per frame. */
export const floodClock = {
  /** Simulated hours since the release started; −1 = showing the max-depth envelope only. */
  hours: -1,
  totalHours: 0,
  playing: false,
};

// ---------------------------------------------------------------- PNG decoding

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Minimal PNG decoder for 16-bit greyscale rasters (HAND, uint16 cm): the browser's image decoders
 * reduce to 8 bits. Non-interlaced, colour type 0, bit depth 16 only.
 */
export async function decodeGray16Png(buf: ArrayBuffer): Promise<{ width: number; height: number; data: Uint16Array }> {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((x, i) => b[i] === x)) throw new Error('Not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (off < b.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);
    const body = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(off + 8);
      height = dv.getUint32(off + 12);
      const depth = body[8];
      const color = body[9];
      const interlace = body[12];
      if (depth !== 16 || color !== 0 || interlace !== 0) throw new Error(`Unsupported PNG (depth ${depth}, colour ${color}, interlace ${interlace})`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const total = idat.reduce((n, x) => n + x.length, 0);
  const z = new Uint8Array(total);
  let p = 0;
  for (const x of idat) {
    z.set(x, p);
    p += x.length;
  }
  const raw = await inflate(z);
  const bpp = 2;
  const stride = width * bpp;
  const out = new Uint16Array(width * height);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    const f = raw[rowOff]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowOff + 1 + x]!;
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const up = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let r: number;
      switch (f) {
        case 0:
          r = v;
          break;
        case 1:
          r = v + a;
          break;
        case 2:
          r = v + up;
          break;
        case 3:
          r = v + ((a + up) >> 1);
          break;
        case 4: {
          const pp = a + up - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - up);
          const pc = Math.abs(pp - c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
          break;
        }
        default:
          throw new Error(`PNG filter ${f}`);
      }
      cur[x] = r & 255;
    }
    for (let x = 0; x < width; x++) out[y * width + x] = (cur[x * 2]! << 8) | cur[x * 2 + 1]!;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return { width, height, data: out };
}

/** CPU + GPU copies of the HAND raster (metres; NaN-free: outside the corridor = 9999 m). */
export type HandRaster = { width: number; height: number; metres: Float32Array; texture: DataTexture };

export const HAND_OUTSIDE_M = 9999;

export async function loadHand(url: string, scale: number): Promise<HandRaster> {
  DefaultLoadingManager.itemStart(url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HAND HTTP ${res.status}`);
    const png = await decodeGray16Png(await res.arrayBuffer());
    const n = png.width * png.height;
    const metres = new Float32Array(n);
    const half = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const raw = png.data[i]!;
      const m = raw === 65535 ? HAND_OUTSIDE_M : raw * scale;
      metres[i] = m;
      half[i] = DataUtils.toHalfFloat(m);
    }
    const t = new DataTexture(half, png.width, png.height, RedFormat, HalfFloatType);
    t.colorSpace = NoColorSpace;
    t.minFilter = t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.needsUpdate = true;
    return { width: png.width, height: png.height, metres, texture: t };
  } finally {
    DefaultLoadingManager.itemEnd(url);
  }
}

/** Nearest HAND value (m) at image UV, or HAND_OUTSIDE_M. */
export function handAt(h: HandRaster, u: number, v: number): number {
  const x = Math.min(h.width - 1, Math.max(0, Math.floor(u * h.width)));
  const y = Math.min(h.height - 1, Math.max(0, Math.floor(v * h.height)));
  return h.metres[y * h.width + x]!;
}

// ---------------------------------------------------------------- ANUGA rasters

async function decodeGray8(url: string, crop?: Rect): Promise<{ width: number; height: number; data: Uint8Array }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const blob = await res.blob();
  const opts: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
  const bmp = crop ? await createImageBitmap(blob, crop.x, crop.y, crop.w, crop.h, opts) : await createImageBitmap(blob, opts);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  c.width = c.height = 0;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4]!;
  return { width: img.width, height: img.height, data: out };
}

/** Pixel rectangle on the scene grid. */
export type Rect = { x: number; y: number; w: number; h: number };

function r8Texture(data: Uint8Array, w: number, h: number): DataTexture {
  const t = new DataTexture(data, w, h, RedFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.minFilter = t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export type AnugaRasters = {
  id: string;
  /** Crop of the scene grid that holds every wet pixel, in image UV (u0, v0, u1, v1). */
  rectUv: [number, number, number, number];
  maxdepth: DataTexture;
  /** Every frame of the crop, one layer each (null until all are decoded). */
  frames: DataArrayTexture | null;
  nFrames: number;
  dtH: number;
  scaleM: number;
  /** CPU copy of the max-depth crop (villages reached). */
  maxCpu: { rect: Rect; data: Uint8Array };
  dispose: () => void;
};

/**
 * Max depth now (crop = bounding box of wet pixels), then all frames into one texture array,
 * decoded a few at a time (createImageBitmap crops before the canvas read, so each frame is cheap).
 */
export async function loadAnuga(
  s: AnugaScenario,
  fileUrl: (path: string) => string,
  gridSize: [number, number],
  onMax: (r: AnugaRasters) => void,
  isCancelled: () => boolean,
): Promise<AnugaRasters | null> {
  const files = s.files!;
  const full = await decodeGray8(fileUrl(files.maxdepth));
  if (isCancelled()) return null;
  let x0 = full.width;
  let y0 = full.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < full.height; y++) {
    const row = y * full.width;
    for (let x = 0; x < full.width; x++) {
      if (full.data[row + x]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    x0 = y0 = 0;
    x1 = y1 = 1;
  }
  const pad = 3;
  const rect: Rect = {
    x: Math.max(0, x0 - pad),
    y: Math.max(0, y0 - pad),
    w: 0,
    h: 0,
  };
  rect.w = Math.min(full.width, x1 + pad + 1) - rect.x;
  rect.h = Math.min(full.height, y1 + pad + 1) - rect.y;
  const crop = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) crop.set(full.data.subarray((rect.y + y) * full.width + rect.x, (rect.y + y) * full.width + rect.x + rect.w), y * rect.w);
  const [gw, gh] = gridSize;
  const out: AnugaRasters = {
    id: s.id,
    rectUv: [rect.x / gw, rect.y / gh, (rect.x + rect.w) / gw, (rect.y + rect.h) / gh],
    maxdepth: r8Texture(crop, rect.w, rect.h),
    frames: null,
    nFrames: files.n_frames,
    dtH: files.dt_s / 3600,
    scaleM: depthScale(s),
    maxCpu: { rect, data: crop },
    dispose: () => {
      out.maxdepth.dispose();
      out.frames?.dispose();
    },
  };
  onMax(out);

  const n = files.n_frames;
  const layer = rect.w * rect.h;
  const all = new Uint8Array(layer * n);
  let next = 0;
  const worker = async () => {
    while (next < n && !isCancelled()) {
      const i = next++;
      const f = await decodeGray8(fileUrl(files.frames.replace('{i}', String(i))), rect);
      all.set(f.data.subarray(0, layer), i * layer);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (isCancelled()) return out;
  const t = new DataArrayTexture(all, rect.w, rect.h, n);
  t.format = RedFormat;
  t.type = UnsignedByteType;
  t.colorSpace = NoColorSpace;
  t.minFilter = t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.unpackAlignment = 1;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  out.frames = t;
  return out;
}

/**
 * What the terrain is currently showing, shared with other scene parts (villages "reached") without
 * React state. Written by <Terrain> every frame.
 */
export const floodRuntime = {
  hand: null as HandRaster | null,
  anuga: null as AnugaRasters | null,
  /** 'hand' | 'anuga' while the flood layer is visible, else 'none'. */
  show: 'none' as 'none' | 'hand' | 'anuga',
  /** Current (smoothed) HAND water height, m. */
  handH: 0,
  /** Current ANUGA frame (fractional) or −1 when only the envelope is shown. */
  frame: -1,
};
