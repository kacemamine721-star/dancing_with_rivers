/**
 * Vector layers for the 3D stage (GeoJSON in EPSG:32632 metres, files named by the manifest).
 * Fetched once per session through the DataSource (react-query cache shared with LakeOutline).
 */
import { useQuery } from '@tanstack/react-query';

import { useDataSource } from '@/data/hooks';
import type { Manifest } from '@/data/schemas.gen';

export type Position = number[];
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };
export type Feature<P = Record<string, unknown>> = { type: 'Feature'; properties: P; geometry: Geometry };
export type FeatureCollection<P = Record<string, unknown>> = { type: 'FeatureCollection'; features: Feature<P>[] };

/** Fetch a manifest vector layer by id (undefined while loading, or when the layer is absent). */
export function useVectorLayer<P = Record<string, unknown>>(
  manifest: Manifest,
  id: string,
  enabled = true,
): FeatureCollection<P> | undefined {
  const ds = useDataSource();
  const file = manifest.layers.find((l) => l.id === id)?.file;
  const { data } = useQuery({
    queryKey: ['data', 'vector', file],
    enabled: Boolean(file) && enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<FeatureCollection<P>> => {
      const res = await fetch(ds.fileUrl(file!));
      if (!res.ok) throw new Error(`${id} HTTP ${res.status}`);
      return (await res.json()) as FeatureCollection<P>;
    },
  });
  return data;
}

export type ReachBreak = { name: string; dist_km: number };
export type FlowpathProps = { name?: string; length_km?: number; reach_breaks?: ReachBreak[]; vertex_dist_km?: number[] };

/** The main-stem line of flowpath.geojson (UTM metres), or null. */
export function flowpathLine(fc: FeatureCollection<FlowpathProps> | undefined): {
  coords: [number, number][];
  props: FlowpathProps;
} | null {
  const f = fc?.features.find((x) => x.geometry.type === 'LineString' || x.geometry.type === 'MultiLineString');
  if (!f) return null;
  const g = f.geometry;
  const raw = g.type === 'LineString' ? g.coordinates : g.type === 'MultiLineString' ? g.coordinates.flat() : [];
  return { coords: raw.map((c) => [c[0]!, c[1]!] as [number, number]), props: f.properties ?? {} };
}

/** First LineString of a collection (dam crest), UTM metres. */
export function firstLine(fc: FeatureCollection | undefined): [number, number][] | null {
  const f = fc?.features.find((x) => x.geometry.type === 'LineString');
  if (!f || f.geometry.type !== 'LineString') return null;
  return f.geometry.coordinates.map((c) => [c[0]!, c[1]!] as [number, number]);
}
