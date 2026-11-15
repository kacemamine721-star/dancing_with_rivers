import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Alerts, AnugaIndex, AnugaStats, HandLut, LevelVolume, Manifest, ReservoirArea } from '@/data/schemas.gen';
import { StaticBundleSource } from '@/data/StaticBundleSource';
import { heightForVolume } from '@/scene/mellegue/flood';

import type { GeoFC } from './data';
import { toLonLat } from './utm';

/** Per-dam bundle (pipeline/v2/run_dam.py); Mellègue keeps its V1 bundle. */
export function bundleBase(id: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return id === 'mellegue' ? `${base}/data/2026-11-15` : `${base}/data/v2/${id}`;
}

export type LonLatBox = [number, number, number, number];
interface GridLike {
  bounds_lonlat: LonLatBox;
  size_px: [number, number];
  lake_chip?: { bounds_lonlat: LonLatBox } | null;
}

export interface DamBundle {
  src: StaticBundleSource;
  manifest?: Manifest | undefined;
  area?: ReservoirArea | undefined;
  alerts?: Alerts | undefined;
  level?: LevelVolume | undefined;
  hand?: HandLut | undefined;
  anuga?: AnugaIndex | undefined;
  anugaStats?: AnugaStats | undefined;
  scene?: GridLike | undefined;
  /** grid of flood/hand.png and the ANUGA rasters: corridor grid (V2) or the scene grid (V1) */
  floodGrid?: GridLike | undefined;
  flowpath?: GeoFC | undefined;
  ready: boolean;
  missing: boolean;
}

async function json<T>(url: string): Promise<T | undefined> {
  const r = await fetch(url);
  if (!r.ok) return undefined;
  return (await r.json()) as T;
}

export function useDamBundle(id: string | null): DamBundle {
  const src = useMemo(() => new StaticBundleSource({ baseUrl: bundleBase(id ?? 'none') }), [id]);
  const opt = { staleTime: Infinity, retry: false, enabled: !!id } as const;
  const q = <T,>(k: string, fn: () => Promise<T | undefined>) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({ queryKey: ['ywd', id, k], queryFn: async () => (await fn().catch(() => undefined)) ?? null, ...opt });
  const manifest = q('manifest', () => src.manifest());
  const area = q('area', () => src.reservoirArea(id!));
  const alerts = q('alerts', () => src.alerts(id!));
  const level = q('level', () => src.levelVolume(id!));
  const hand = q('hand', () => src.handLut(id!));
  const anuga = q('anuga', () => src.anugaIndex(id!));
  const scene = q('scene', () => json<GridLike>(src.fileUrl('terrain/grid.json')));
  const handGrid = q('handGrid', () => json<GridLike>(src.fileUrl('flood/hand_grid.json')));
  // bundle vectors are in the scene CRS (UTM): reproject to lon/lat for the map
  const flowpath = q('flowpath', async () => {
    const fc = await json<GeoFC & { crs?: { properties?: { name?: string } } }>(src.fileUrl('vectors/flowpath.geojson'));
    return fc ? (toLonLat(fc as never) as GeoFC) : undefined;
  });
  const first = anuga.data?.scenarios.find((s) => s.computed);
  const anugaStats = useQuery({
    queryKey: ['ywd', id, 'anugaStats', first?.id],
    queryFn: async () => (first ? ((await src.anugaStats(id!, first.id).catch(() => undefined)) ?? null) : null),
    staleTime: Infinity,
    retry: false,
    enabled: !!id && !!first,
  });
  const all = [manifest, area, alerts, level, hand, anuga, scene, handGrid, flowpath];
  return {
    src,
    manifest: manifest.data ?? undefined,
    area: area.data ?? undefined,
    alerts: alerts.data ?? undefined,
    level: level.data ?? undefined,
    hand: hand.data ?? undefined,
    anuga: anuga.data ?? undefined,
    anugaStats: anugaStats.data ?? undefined,
    scene: scene.data ?? undefined,
    floodGrid: (handGrid.data ?? scene.data) ?? undefined,
    flowpath: flowpath.data ?? undefined,
    ready: all.every((x) => !x.isPending),
    missing: manifest.isSuccess && !manifest.data,
  };
}

/** HAND quick-flood volume shown on the map: 20 Mm³, or the LUT's minimum meaningful volume (h ≥ 0.5 m). */
export function handVolumeM3(rows: HandLut['rows']): number {
  const min = rows.find((r) => r.h >= 0.5)?.V_m3 ?? rows[0]?.V_m3 ?? 20e6;
  return Math.max(20e6, Math.ceil(min / 1e6) * 1e6);
}

export function handHeightM(rows: HandLut['rows'], v: number): number {
  return heightForVolume(rows, v);
}
