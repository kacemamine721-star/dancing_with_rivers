import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';

import { useDataSource, useManifest } from '@/data/hooks';

/**
 * Properties of the two vector layers the story cards read numbers from (flow path, catchments).
 * GeoJSON files are not contracts, so only the properties the UI uses are validated here; the
 * geometry is left to the 3D scene. A parse failure hides the numbers ("could not be loaded").
 */

export const ReachBreakSchema = z.object({ name: z.string(), dist_km: z.number() });

export const FlowpathMetaSchema = z.object({
  name: z.string().optional(),
  length_km: z.number(),
  reach_breaks: z.array(ReachBreakSchema),
  badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']).default('MODELLED'),
  dem: z.string().default(''),
  method: z.string().default(''),
});
export type FlowpathMeta = z.infer<typeof FlowpathMetaSchema>;

export const CatchmentSchema = z.object({ id: z.string(), name: z.string(), area_km2: z.number() });
export type Catchment = z.infer<typeof CatchmentSchema>;

const FeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({ properties: z.record(z.unknown()).nullable() })),
});

/** First feature whose properties parse with `schema`, else throws (→ error state). */
export function parseFirstFeature<T>(json: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const fc = FeatureCollectionSchema.parse(json);
  for (const f of fc.features) {
    const r = schema.safeParse(f.properties ?? {});
    if (r.success) return r.data;
  }
  throw new Error('No feature with the expected properties');
}

export function parseAllFeatures<T>(json: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T[] {
  const fc = FeatureCollectionSchema.parse(json);
  return fc.features.flatMap((f) => {
    const r = schema.safeParse(f.properties ?? {});
    return r.success ? [r.data] : [];
  });
}

function useVectorJson(layerId: string) {
  const ds = useDataSource();
  const manifest = useManifest();
  const file = manifest.data?.layers.find((l) => l.id === layerId)?.file;
  const layer = manifest.data?.layers.find((l) => l.id === layerId);
  const query = useQuery({
    // same cache key as the scene's useVectorLayer: the file is fetched once per session
    queryKey: ['data', 'vector', file],
    enabled: Boolean(file),
    staleTime: Infinity,
    queryFn: async (): Promise<unknown> => {
      const res = await fetch(ds.fileUrl(file!));
      if (!res.ok) throw new Error(`${layerId} HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    },
  });
  return { query, layer };
}

/** Flow path dam → Sidi Salem: length and named reach breaks (km along the path). */
export function useFlowpathMeta() {
  const { query, layer } = useVectorJson('flowpath');
  const parsed = useMemo(() => safeParse(query.data, (j) => parseFirstFeature(j, FlowpathMetaSchema)), [query.data]);
  return { data: parsed.data, layer, isPending: query.isPending, isError: query.isError || parsed.error };
}

/** Upstream catchments (Mellègue dam, Sidi Salem dam) with their areas. */
export function useCatchments() {
  const { query, layer } = useVectorJson('catchment');
  const parsed = useMemo(() => safeParse(query.data, (j) => parseAllFeatures(j, CatchmentSchema)), [query.data]);
  return { data: parsed.data, layer, isPending: query.isPending, isError: query.isError || parsed.error };
}

function safeParse<T>(json: unknown, parse: (j: unknown) => T): { data: T | undefined; error: boolean } {
  if (json === undefined) return { data: undefined, error: false };
  try {
    return { data: parse(json), error: false };
  } catch {
    return { data: undefined, error: true };
  }
}
