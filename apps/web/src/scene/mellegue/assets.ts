/**
 * Terrain rasters for the Mellègue stage. Every URL comes from the DataSource (manifest file
 * paths → `textureUrl`), never hard-coded. All textures use flipY = false and are sampled in
 * image UV (row 0 = north), so GPU and CPU (`SceneFrame.sampleHeight`) agree.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DefaultLoadingManager,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  UnsignedByteType,
} from 'three';

import type { DataSource } from '@/data/DataSource';
import type { Grid, Manifest } from '@/data/schemas.gen';
import { type HeightData, SceneFrame } from '@/scene/coords';

export type TerrainAssets = {
  frame: SceneFrame;
  grid: Grid;
  manifest: Manifest;
  height: DataTexture;
  base: Texture;
  hill: Texture;
  water: Texture;
};

const loader = new TextureLoader();

/** A colour or data raster on the scene / lake-chip grid. */
export async function loadRaster(url: string, opts: { srgb?: boolean; mipmaps?: boolean } = {}): Promise<Texture> {
  const t = await loader.loadAsync(url);
  t.flipY = false;
  t.colorSpace = opts.srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = opts.mipmaps ?? true;
  t.minFilter = t.generateMipmaps ? LinearMipmapLinearFilter : LinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** 1×1 placeholder (black) for unbound sampler uniforms. */
export function blankTexture(): DataTexture {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

/**
 * Decode the RG16 PNG to raw bytes without colour management or alpha premultiplication.
 * The same bytes feed the GPU texture and the CPU sampler.
 */
export async function decodeHeightPng(url: string): Promise<HeightData> {
  DefaultLoadingManager.itemStart(url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Heightmap HTTP ${res.status}`);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 0;
    DefaultLoadingManager.itemEnd(url);
    return { width: img.width, height: img.height, rgba: img.data };
  } catch (e) {
    DefaultLoadingManager.itemError(url);
    DefaultLoadingManager.itemEnd(url);
    throw e;
  }
}

export function heightTexture(h: HeightData): DataTexture {
  const t = new DataTexture(
    new Uint8Array(h.rgba.buffer, h.rgba.byteOffset, h.rgba.byteLength),
    h.width,
    h.height,
    RGBAFormat,
    UnsignedByteType,
  );
  t.colorSpace = NoColorSpace;
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export async function loadTerrainAssets(
  ds: DataSource,
  manifest: Manifest,
  grid: Grid,
  exag: number,
): Promise<TerrainAssets> {
  const [h, base, hill, water] = await Promise.all([
    decodeHeightPng(ds.textureUrl('terrain_height')),
    loadRaster(ds.textureUrl('basemap_s2'), { srgb: true }),
    loadRaster(ds.textureUrl('terrain_hillshade')),
    loadRaster(ds.textureUrl('gsw_occurrence')).catch(() => blankTexture() as Texture),
  ]);
  const frame = new SceneFrame(grid, exag);
  frame.setHeights(h);
  return { frame, grid, manifest, height: heightTexture(h), base, hill, water };
}
