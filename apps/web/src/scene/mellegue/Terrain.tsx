import { useFrame, useThree } from '@react-three/fiber';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Color,
  DataArrayTexture,
  type Mesh,
  PlaneGeometry,
  RedFormat,
  ShaderMaterial,
  type Texture,
  UnsignedByteType,
  Vector2,
  Vector4,
} from 'three';

import { dataQueries, useDataSource } from '@/data/hooks';
import type { Manifest } from '@/data/schemas.gen';
import {
  type AnugaRasters,
  computedScenario,
  floodClock,
  floodRuntime,
  type HandRaster,
  heightForVolume,
  loadAnuga,
  loadHand,
} from '@/scene/mellegue/flood';
import { HAZE_DAY, HAZE_NIGHT, SUN_DIR } from '@/scene/mellegue/look';
import { blankTexture, loadRaster, type TerrainAssets } from '@/scene/mellegue/assets';
import { rasterizePolygons } from '@/scene/mellegue/rasterize';
import { useVectorLayer } from '@/scene/mellegue/vectors';
import { TIERS } from '@/scene/quality';
import fragmentShader from '@/scene/shaders/terrain.frag.glsl';
import vertexShader from '@/scene/shaders/terrain.vert.glsl';
import { useAppStore } from '@/store/app';
import { tokens } from '@/styles/tokens';

type RadarLayer = Manifest['layers'][number];

/** ANUGA playback: simulated hours per real second, and the hold on the last frame (s). */
const ANUGA_HOURS_PER_S = 3;
const ANUGA_HOLD_S = 2.5;

function blankArray(): DataArrayTexture {
  const t = new DataArrayTexture(new Uint8Array([0]), 1, 1, 1);
  t.format = RedFormat;
  t.type = UnsignedByteType;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

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
  const damId = useAppStore((s) => s.damId);
  const floodLayer = useAppStore((s) => s.layers.flood);
  const floodMode = useAppStore((s) => s.flood.mode);
  const scenarioId = useAppStore((s) => s.flood.scenarioId);
  const cropLayer = useAppStore((s) => s.layers.cropland);
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
  const blankArr = useMemo(() => blankArray(), []);
  useEffect(() => () => blankArr.dispose(), [blankArr]);
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
        uFloodOn: { value: 0 },
        uFloodMode: { value: 0 },
        uFloodMax: { value: blank as Texture },
        uFloodFrames: { value: blankArr as Texture },
        uFloodRect: { value: new Vector4(0, 0, 1, 1) },
        uFloodScale: { value: 8 / 255 },
        uFloodT: { value: 0 },
        uFloodN: { value: 1 },
        uFloodAnim: { value: 0 },
        uRamp: { value: tokens.color.flood.map((c) => new Color(c)) },
        uCrop: { value: blank as Texture },
        uCropOn: { value: 0 },
        uCropCol: { value: new Color(tokens.color.ok) },
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
  }, [assets, blank, blankArr]);
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

  // --- flood data (lazy: the first time the flood layer is asked for)
  const [floodWanted, setFloodWanted] = useState(false);
  useEffect(() => {
    if (floodLayer) setFloodWanted(true);
  }, [floodLayer]);
  const { data: lut } = useQuery({ ...dataQueries.handLut(ds, damId), enabled: floodWanted });
  const { data: anugaIndex } = useQuery({ ...dataQueries.anugaIndex(ds, damId), enabled: floodWanted });
  const lutRef = useRef(lut);
  lutRef.current = lut;
  const indexRef = useRef(anugaIndex);
  indexRef.current = anugaIndex;

  const handRef = useRef<HandRaster | null>(null);
  useEffect(() => {
    if (!floodWanted || !lut || handRef.current) return;
    let cancelled = false;
    void loadHand(ds.fileUrl(lut.hand_file), lut.hand_encoding.scale ?? 0.01)
      .then((h) => {
        if (cancelled) {
          h.texture.dispose();
          return;
        }
        gl.initTexture(h.texture);
        handRef.current = h;
        floodRuntime.hand = h;
        material.uniforms.uHand!.value = h.texture;
      })
      .catch((e: unknown) => console.warn('HAND raster failed to load', e));
    return () => {
      cancelled = true;
    };
  }, [ds, floodWanted, gl, lut, material]);
  useEffect(
    () => () => {
      handRef.current?.texture.dispose();
      handRef.current = null;
      floodRuntime.hand = null;
    },
    [],
  );

  // ANUGA rasters of the selected, computed scenario; the previous scenario's are disposed
  const anugaRef = useRef<AnugaRasters | null>(null);
  const playhead = useRef(0);
  const scenarioKey = floodLayer && floodMode === 'anuga' ? (computedScenario(anugaIndex, scenarioId)?.id ?? null) : null;
  useEffect(() => {
    if (!scenarioKey || anugaRef.current?.id === scenarioKey) return;
    const sc = computedScenario(indexRef.current, scenarioKey);
    if (!sc) return;
    let cancelled = false;
    const take = (r: AnugaRasters) => {
      if (cancelled) return;
      if (anugaRef.current && anugaRef.current !== r) anugaRef.current.dispose();
      anugaRef.current = r;
      floodRuntime.anuga = r;
      const u = material.uniforms;
      u.uFloodMax!.value = r.maxdepth;
      u.uFloodRect!.value = new Vector4(...r.rectUv);
      u.uFloodScale!.value = r.scaleM;
      u.uFloodN!.value = r.nFrames;
      u.uFloodFrames!.value = blankArr;
      playhead.current = 0;
    };
    void loadAnuga(sc, (p) => ds.fileUrl(p), [assets.grid.size_px[0], assets.grid.size_px[1]], take, () => cancelled)
      .then((r) => {
        if (!r || !r.frames) return;
        if (cancelled) {
          if (anugaRef.current !== r) r.dispose();
          return;
        }
        gl.initTexture(r.frames);
        material.uniforms.uFloodFrames!.value = r.frames;
        playhead.current = 0;
      })
      .catch((e: unknown) => console.warn('ANUGA rasters failed to load', e));
    return () => {
      cancelled = true;
    };
  }, [assets, blankArr, ds, gl, material, scenarioKey]);
  useEffect(
    () => () => {
      anugaRef.current?.dispose();
      anugaRef.current = null;
      floodRuntime.anuga = null;
    },
    [],
  );

  // irrigated cropland mask (rasterised once, the first time the layer is asked for)
  const [cropWanted, setCropWanted] = useState(false);
  useEffect(() => {
    if (cropLayer) setCropWanted(true);
  }, [cropLayer]);
  const irrigated = useVectorLayer(assets.manifest, 'irrigated', cropWanted);
  useEffect(() => {
    if (!irrigated) return;
    const t = rasterizePolygons(irrigated, assets.grid);
    if (!t) return;
    material.uniforms.uCrop!.value = t;
    return () => {
      material.uniforms.uCrop!.value = blank;
      t.dispose();
    };
  }, [assets, blank, irrigated, material]);

  useFrame((state, dt) => {
    const s = useAppStore.getState();
    const u = material.uniforms;
    const k = Math.min(1, dt * 4);
    const op = u.uOpacity!.value as Vector4;
    const { hasA, hasB } = chipState.current;
    op.x += ((s.layers.basemap ? 1 : 0) - op.x) * k;
    // the act configs decide what is shown (Act 1 = optical: layers.radar off)
    op.y += ((s.layers.radar && hasB ? 1 : 0) - op.y) * k;
    op.z += ((s.layers.mask && hasB ? 1 : 0) - op.z) * k;
    u.uSwipe!.value = s.swipe;
    u.uSwipeOn!.value = hasA && hasB ? 1 : 0;
    const night = u.uNight!;
    night.value += ((s.act === 2 ? 1 : 0) - (night.value as number)) * Math.min(1, dt * 1.5);
    if (assets.frame.exag !== s.exag) assets.frame.exag = s.exag;
    u.uExag!.value = s.exag;
    u.uTime!.value = state.clock.elapsedTime;
    gl.getDrawingBufferSize(u.uResolution!.value as Vector2);

    // --- flood: ANUGA when its scenario is computed and loaded, else the HAND bathtub
    const ra = anugaRef.current;
    const wantAnuga =
      s.layers.flood &&
      s.flood.mode === 'anuga' &&
      ra !== null &&
      computedScenario(indexRef.current, s.flood.scenarioId)?.id === ra.id;
    const hand = handRef.current;
    const show = !s.layers.flood ? 'none' : wantAnuga ? 'anuga' : hand && lutRef.current ? 'hand' : 'none';
    const fOn = u.uFloodOn!;
    if (show !== 'none') u.uFloodMode!.value = show === 'anuga' ? 1 : 0;
    fOn.value += ((show === 'none' ? 0 : 1) - (fOn.value as number)) * Math.min(1, dt * 3);
    const rows = lutRef.current?.rows;
    const target = rows ? heightForVolume(rows, s.flood.volumeM3) : 0;
    const hh = u.uHandH!;
    const hNow = hh.value as number;
    hh.value = s.reducedMotion ? target : hNow + (target - hNow) * Math.min(1, dt * 3.5);
    const anim = u.uFloodAnim!;
    if (show === 'anuga' && ra?.frames && !s.reducedMotion) {
      const total = (ra.nFrames - 1) * ra.dtH;
      playhead.current += dt;
      if (playhead.current > total / ANUGA_HOURS_PER_S + ANUGA_HOLD_S) playhead.current = 0;
      const hours = Math.min(total, playhead.current * ANUGA_HOURS_PER_S);
      u.uFloodT!.value = hours / ra.dtH;
      anim.value += (1 - (anim.value as number)) * Math.min(1, dt * 3);
      floodClock.hours = hours;
      floodClock.totalHours = total;
      floodClock.playing = true;
    } else {
      anim.value = 0;
      floodClock.hours = -1;
      floodClock.totalHours = ra ? (ra.nFrames - 1) * ra.dtH : 0;
      floodClock.playing = false;
    }
    floodRuntime.show = show;
    floodRuntime.handH = hh.value as number;
    floodRuntime.frame = (anim.value as number) > 0.5 ? (u.uFloodT!.value as number) : -1;
    const crop = u.uCropOn!;
    const cropTarget = s.layers.cropland && u.uCrop!.value !== blank ? 1 : 0;
    crop.value += (cropTarget - (crop.value as number)) * k;
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />;
}
