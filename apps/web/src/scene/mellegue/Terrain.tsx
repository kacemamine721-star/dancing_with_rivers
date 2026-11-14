import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type Mesh, PlaneGeometry, ShaderMaterial, type Texture, Vector2, Vector4 } from 'three';

import { useDataSource } from '@/data/hooks';
import type { Manifest } from '@/data/schemas.gen';
import { HAZE_DAY, HAZE_NIGHT, SUN_DIR } from '@/scene/mellegue/look';
import { blankTexture, loadRaster, type TerrainAssets } from '@/scene/mellegue/assets';
import { TIERS } from '@/scene/quality';
import fragmentShader from '@/scene/shaders/terrain.frag.glsl';
import vertexShader from '@/scene/shaders/terrain.vert.glsl';
import { useAppStore } from '@/store/app';
import { tokens } from '@/styles/tokens';

type RadarLayer = Manifest['layers'][number];


function radarLayerFor(manifest: Manifest, date: string | null): RadarLayer | null {
  if (!date) return null;
  return manifest.layers.find((l) => l.kind === 'radar' && l.grid === 'lake_chip' && l.date === date) ?? null;
}

/**
 * Heightmap terrain (docs/03 §6.2): one PlaneGeometry displaced in the vertex shader from the RG16
 * heightmap, one ShaderMaterial draping basemap × hillshade, the 10 m lake chip (radar + mask,
 * swipe), contours and haze. Uniforms are written through refs; nothing re-renders per frame.
 */
export function Terrain({ assets }: { assets: TerrainAssets }) {
  const ds = useDataSource();
  const gl = useThree((s) => s.gl);
  const quality = useAppStore((s) => s.quality);
  const date = useAppStore((s) => s.date);
  const compareDate = useAppStore((s) => s.compareDate);
  const meshRef = useRef<Mesh>(null);

  const geometry = useMemo(() => {
    const { frame } = assets;
    const long = TIERS[quality === '2d' ? 'low' : quality].segments;
    const g = new PlaneGeometry(frame.width, frame.depth, long, Math.round((long * frame.depth) / frame.width));
    g.rotateX(-Math.PI / 2); // uv.y = 1 on the north edge (−z)
    // the vertex shader lifts y: give culling a box that contains the relief
    g.computeBoundingSphere();
    g.boundingSphere!.radius += 12;
    return g;
  }, [assets, quality]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const blank = useMemo(() => blankTexture(), []);
  const material = useMemo(() => {
    const { frame, grid } = assets;
    const rect = frame.rectUv(grid.lake_chip.bounds_m);
    return new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uHeight: { value: assets.height },
        uHeightSize: { value: new Vector2(assets.height.image.width, assets.height.image.height) },
        uHeightEnc: { value: new Vector2(grid.height_encoding.scale, grid.height_encoding.offset) },
        uZMin: { value: grid.z_min },
        uExag: { value: frame.exag },
        uTexelKm: { value: frame.width / assets.height.image.width },
        uBase: { value: assets.base },
        uHill: { value: assets.hill },
        uWater: { value: assets.water },
        uRadarA: { value: blank as Texture },
        uRadarB: { value: blank as Texture },
        uMaskA: { value: blank as Texture },
        uMaskB: { value: blank as Texture },
        uHand: { value: blank as Texture },
        uHandH: { value: 0 },
        uHandScale: { value: 1 },
        uLakeChipRect: { value: new Vector4(...rect) },
        uOpacity: { value: new Vector4(1, 0, 0, 1) },
        uSwipe: { value: 0.5 },
        uSwipeOn: { value: 0 },
        uNight: { value: 0 },
        uTime: { value: 0 },
        uResolution: { value: new Vector2(1, 1) },
        uSunDir: { value: SUN_DIR.clone().normalize() },
        uHazeDay: { value: HAZE_DAY },
        uHazeNight: { value: HAZE_NIGHT },
        uWaterCol: { value: new Color(tokens.color.water) },
        uTeal: { value: new Color(tokens.color.teal) },
      },
    });
  }, [assets, blank]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => blank.dispose(), [blank]);

  // --- lake chip textures by date; anything not on screen is disposed
  const cache = useRef(new Map<string, Texture>());
  const chipState = useRef({ hasA: false, hasB: false });
  useEffect(() => {
    let cancelled = false;
    const store = cache.current;
    const b = radarLayerFor(assets.manifest, date);
    const a = compareDate && compareDate !== date ? radarLayerFor(assets.manifest, compareDate) : null;
    const wanted = [b?.file, b?.mask, a?.file, a?.mask].filter((x): x is string => Boolean(x));

    const get = async (file: string | null | undefined): Promise<Texture> => {
      if (!file) return blank;
      const hit = store.get(file);
      if (hit) return hit;
      const t = await loadRaster(ds.fileUrl(file), { mipmaps: false });
      if (cancelled) {
        t.dispose();
        return blank;
      }
      store.set(file, t);
      return t;
    };

    void Promise.all([get(a?.file), get(a?.mask), get(b?.file), get(b?.mask)])
      .then(([ra, ma, rb, mb]) => {
        if (cancelled) return;
        const u = material.uniforms;
        u.uRadarA!.value = ra;
        u.uMaskA!.value = ma;
        u.uRadarB!.value = rb;
        u.uMaskB!.value = mb;
        chipState.current = { hasA: Boolean(a), hasB: Boolean(b) };
        for (const [file, tex] of store) {
          if (!wanted.includes(file)) {
            tex.dispose();
            store.delete(file);
          }
        }
      })
      .catch((e: unknown) => console.warn('Radar chip failed to load', e));
    return () => {
      cancelled = true;
    };
  }, [assets, blank, compareDate, date, ds, material]);
  useEffect(() => {
    const store = cache.current;
    return () => {
      store.forEach((t) => t.dispose());
      store.clear();
    };
  }, []);

  useFrame((state, dt) => {
    const s = useAppStore.getState();
    const u = material.uniforms;
    const k = Math.min(1, dt * 4);
    const op = u.uOpacity!.value as Vector4;
    const { hasA, hasB } = chipState.current;
    op.x += ((s.layers.basemap ? 1 : 0) - op.x) * k;
    // Act 1 is the optical scene (docs/05 §3): the radar chip appears from Act 2 on unless an act config asks otherwise
    const chip = hasB && s.act !== 1;
    op.y += ((s.layers.radar && chip ? 1 : 0) - op.y) * k;
    op.z += ((s.layers.mask && chip ? 1 : 0) - op.z) * k;
    u.uSwipe!.value = s.swipe;
    u.uSwipeOn!.value = hasA && hasB ? 1 : 0;
    const night = u.uNight!;
    night.value += ((s.act === 2 ? 1 : 0) - (night.value as number)) * Math.min(1, dt * 1.5);
    if (assets.frame.exag !== s.exag) assets.frame.exag = s.exag;
    u.uExag!.value = s.exag;
    u.uTime!.value = state.clock.elapsedTime;
    gl.getDrawingBufferSize(u.uResolution!.value as Vector2);
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />;
}
