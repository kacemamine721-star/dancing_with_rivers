import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

/**
 * "Dancing with your Dam" catalogue (pipeline/v2/dam_catalog.py → public/v2/). Static files on the
 * same origin; geometry is derived (HydroBASINS / HydroRIVERS / OSM), so it is MODELLED.
 */
const Town = z.object({ name: z.string(), km: z.number() });

export const DamSchema = z
  .object({
  id: z.string(),
  name: z.string().nullish(),
  name_en: z.string().nullish(),
  name_ar: z.string().nullish(),
  osm_id: z.string().nullish(),
  lon: z.number(),
  lat: z.number(),
  river: z.string().nullish(),
  governorate: z.string().nullish(),
  reservoir_km2: z.number().nullish(),
  height_m: z.number().nullish(),
  start_date: z.string().nullish(),
  catchment_km2: z.number().nullish(),
  snap_m: z.number().nullish(),
  snap_warning: z.string().nullish(),
  catchment_shared_with: z.array(z.string()).nullish(),
  downstream_km: z.number().nullish(),
  downstream_to: z.string().nullish(),
  towns: z.array(Town).default([]),
  nisar_dates: z.number().nullish(),
  nisar_tracks: z.array(z.string()).nullish(),
  status: z.enum(['processed', 'catalogued']),
  badge: z.string().default('MODELLED'),
  source: z.string().nullish(),
  })
  // never invent a name: OSM entries without one are shown by their OSM id
  .transform((d) => ({ ...d, name: d.name ?? d.name_ar ?? `Unnamed reservoir (OSM ${d.osm_id ?? d.id})` }));
export type Dam = z.output<typeof DamSchema>;

const IndexSchema = z.object({
  generated_utc: z.string().nullish(),
  uncertainty: z.string().nullish(),
  sources: z.array(z.string()).default([]),
  method: z.string().nullish(),
  tunisia_bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  dams: z.array(DamSchema),
});
export type DamIndex = z.infer<typeof IndexSchema>;

type Position = [number, number];
const Geometry = z.object({ type: z.string(), coordinates: z.any() });
const Feature = z.object({
  type: z.literal('Feature'),
  properties: z.record(z.any()).nullable(),
  geometry: Geometry.nullable(),
});
const FC = z.object({ type: z.literal('FeatureCollection'), features: z.array(Feature) });
export type GeoFeature = z.infer<typeof Feature>;
export type GeoFC = z.infer<typeof FC>;

const BASE = `${import.meta.env.BASE_URL}v2/`;

async function getJson<T>(url: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return schema.parse(await r.json());
}

export function useDamIndex() {
  return useQuery({ queryKey: ['v2', 'dams'], queryFn: () => getJson(`${BASE}dams/index.json`, IndexSchema), staleTime: Infinity });
}

export function useTunisia() {
  return useQuery({ queryKey: ['v2', 'tunisia'], queryFn: () => getJson(`${BASE}tunisia.geojson`, FC), staleTime: Infinity });
}

export function useDamGeometry(id: string | null) {
  return useQuery({
    queryKey: ['v2', 'dam', id],
    queryFn: () => getJson(`${BASE}dams/${id}.geojson`, FC),
    enabled: !!id,
    staleTime: Infinity,
  });
}

/** Features of one role, as a list of rings / lines (lon, lat). */
export function partsOf(fc: GeoFC | undefined, role: string): Position[][] {
  const out: Position[][] = [];
  for (const f of fc?.features ?? []) {
    if (f.properties?.['role'] !== role || !f.geometry) continue;
    const g = f.geometry;
    const c = g.coordinates as unknown;
    if (g.type === 'LineString') out.push(c as Position[]);
    else if (g.type === 'MultiLineString' || g.type === 'Polygon') out.push(...(c as Position[][]));
    else if (g.type === 'MultiPolygon') for (const p of c as Position[][][]) out.push(...p);
  }
  return out;
}

export function pointsOf(fc: GeoFC | undefined, role: string): { pos: Position; props: Record<string, unknown> }[] {
  return (fc?.features ?? [])
    .filter((f) => f.properties?.['role'] === role && f.geometry?.type === 'Point')
    .map((f) => ({ pos: f.geometry!.coordinates as Position, props: f.properties ?? {} }));
}
