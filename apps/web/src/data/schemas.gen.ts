/* eslint-disable */
// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT. Run `pnpm gen:schemas` after a contract change.
// Source: contracts/*.schema.json (pydantic models in pipeline/common/contracts.py)
// Contracts: grid, manifest, reservoir_area, alerts, hand_lut, anuga_index, anuga_stats, impacts, level_volume, sources, events
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';

/** contracts/grid.schema.json (schema v1) */
export const GridSchema = z
  .object({
    schema_version: z.number().int().default(1),
    crs: z.string(),
    bounds_m: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    bounds_lonlat: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    res_m: z.number(),
    size_px: z.tuple([z.number().int(), z.number().int()]),
    height_encoding: z
      .object({
        type: z.literal('rg16').default('rg16'),
        scale: z.number().default(0.1),
        offset: z.number().default(-100),
      })
      .strict(),
    z_min: z.number(),
    z_max: z.number(),
    lake_chip: z
      .object({
        bounds_m: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        bounds_lonlat: z.tuple([z.number(), z.number(), z.number(), z.number()]),
        res_m: z.number(),
        size_px: z.tuple([z.number().int(), z.number().int()]),
      })
      .strict(),
    placeholder: z.boolean().default(false),
  })
  .strict();
export type Grid = z.infer<typeof GridSchema>;

/** contracts/manifest.schema.json (schema v1) */
export const ManifestSchema = z
  .object({
    schema_version: z.number().int().default(1),
    version: z.string(),
    generated_utc: z.string(),
    product: z.string(),
    dam_id: z.string(),
    placeholder: z.boolean().default(false),
    layers: z.array(
      z
        .object({
          badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']),
          source: z.string(),
          method: z.string().default(''),
          uncertainty: z.string().default(''),
          placeholder: z.boolean().default(false),
          id: z.string(),
          kind: z.enum([
            'terrain',
            'basemap',
            'hillshade',
            'radar',
            'mask',
            'change',
            'hand',
            'flood',
            'vector',
            'other',
          ]),
          grid: z.enum(['scene', 'lake_chip', 'none']),
          file: z.string(),
          label: z.string(),
          date: z.union([z.string(), z.null()]).default(null),
          time_utc: z.union([z.string(), z.null()]).default(null),
          sensor: z
            .union([z.enum(['NISAR', 'S1', 'S2', 'SWOT', 'NASADEM', 'COPDEM', 'WorldCover', 'OSM', 'model']), z.null()])
            .default(null),
          band: z.union([z.enum(['L', 'S', 'C', 'optical']), z.null()]).default(null),
          pol: z.union([z.string(), z.null()]).default(null),
          track: z.union([z.string(), z.null()]).default(null),
          frame: z.union([z.number().int(), z.null()]).default(null),
          product_id: z.union([z.string(), z.null()]).default(null),
          encoding: z
            .union([
              z
                .object({
                  type: z.enum(['db8', 'rg16', 'r16', 'r8', 'rgb', 'mask8', 'logratio8']),
                  min: z.union([z.number(), z.null()]).default(null),
                  max: z.union([z.number(), z.null()]).default(null),
                  scale: z.union([z.number(), z.null()]).default(null),
                  offset: z.union([z.number(), z.null()]).default(null),
                })
                .strict(),
              z.null(),
            ])
            .default(null),
          mask: z.union([z.string(), z.null()]).default(null),
        })
        .strict(),
    ),
    files: z.record(z.string()).describe('logical name -> path of each JSON in the bundle').optional(),
  })
  .strict();
export type Manifest = z.infer<typeof ManifestSchema>;

/** contracts/reservoir_area.schema.json (schema v1) */
export const ReservoirAreaSchema = z
  .object({
    badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']),
    source: z.string(),
    method: z.string().default(''),
    uncertainty: z.string().default(''),
    placeholder: z.boolean().default(false),
    schema_version: z.number().int().default(1),
    dam_id: z.string(),
    reservoir: z.string(),
    polygon: z.string(),
    unit: z.literal('km2').default('km2'),
    threshold_db: z.number(),
    points: z.array(
      z
        .object({
          date: z.string(),
          time_utc: z.union([z.string(), z.null()]).default(null),
          sensor: z.enum(['NISAR', 'S1']),
          track: z.string(),
          area_km2: z.number(),
          area_norm_km2: z.union([z.number(), z.null()]).default(null),
          sigma_km2: z.union([z.number(), z.null()]).default(null),
          confidence: z.enum(['high', 'medium', 'low']).default('high'),
          layer: z.union([z.string(), z.null()]).default(null),
          note: z.string().default(''),
        })
        .strict(),
    ),
    events: z.array(
      z
        .object({
          date: z.string(),
          label: z.string(),
          kind: z.enum(['failure', 'arrival', 'repair', 'plan', 'other']).default('other'),
          badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']).default('REPORTED'),
          source: z.string().default(''),
        })
        .strict(),
    ),
    gaps: z.array(z.tuple([z.string(), z.string()])).optional(),
  })
  .strict();
export type ReservoirArea = z.infer<typeof ReservoirAreaSchema>;

/** contracts/alerts.schema.json (schema v1) */
export const AlertsSchema = z
  .object({
    badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']),
    source: z.string(),
    method: z.string().default(''),
    uncertainty: z.string().default(''),
    placeholder: z.boolean().default(false),
    schema_version: z.number().int().default(1),
    dam_id: z.string(),
    rule: z
      .object({
        z_alert: z.number(),
        drop_alert: z.number(),
        z_warn: z.number(),
        drop_warn: z.number(),
        seasonal_rate_per_day: z.number(),
        sigma_per_sqrt_day: z.number(),
      })
      .strict(),
    evaluations: z.array(
      z
        .object({
          date: z.string(),
          prev: z.string(),
          days: z.number(),
          delta: z.number(),
          expected: z.number(),
          z: z.number(),
          level: z.enum(['ALERT', 'WARNING', 'NORMAL']),
          cross_sensor: z.boolean(),
          text: z.object({ everyone: z.string(), experts: z.string() }).strict(),
        })
        .strict(),
    ),
  })
  .strict();
export type Alerts = z.infer<typeof AlertsSchema>;

/** contracts/hand_lut.schema.json (schema v1) */
export const HandLutSchema = z
  .object({
    badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']),
    source: z.string(),
    method: z.string().default(''),
    uncertainty: z.string().default(''),
    placeholder: z.boolean().default(false),
    schema_version: z.number().int().default(1),
    dam_id: z.string(),
    corridor: z.string(),
    reach: z.string(),
    hand_file: z.string(),
    hand_encoding: z
      .object({
        type: z.enum(['db8', 'rg16', 'r16', 'r8', 'rgb', 'mask8', 'logratio8']),
        min: z.union([z.number(), z.null()]).default(null),
        max: z.union([z.number(), z.null()]).default(null),
        scale: z.union([z.number(), z.null()]).default(null),
        offset: z.union([z.number(), z.null()]).default(null),
      })
      .strict(),
    rows: z.array(
      z
        .object({
          h: z.number(),
          V_m3: z.number(),
          area_km2: z.number(),
          cropland_ha: z.number(),
          builtup_ha: z.number(),
          villages: z.number().int(),
          road_km: z.number(),
        })
        .strict(),
    ),
  })
  .strict();
export type HandLut = z.infer<typeof HandLutSchema>;

/** contracts/anuga_index.schema.json (schema v1) */
export const AnugaIndexSchema = z
  .object({
    schema_version: z.number().int().default(1),
    dam_id: z.string(),
    scenarios: z.array(
      z
        .object({
          badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']),
          source: z.string(),
          method: z.string().default(''),
          uncertainty: z.string().default(''),
          placeholder: z.boolean().default(false),
          id: z.string(),
          volume_m3: z.number(),
          duration_h: z.number(),
          label: z.string(),
          computed: z.boolean(),
          files: z
            .union([
              z
                .object({
                  maxdepth: z.string(),
                  arrival: z.string(),
                  frames: z.string(),
                  n_frames: z.number().int(),
                  dt_s: z.number(),
                })
                .strict(),
              z.null(),
            ])
            .default(null),
          depth_encoding: z
            .union([
              z
                .object({
                  type: z.enum(['db8', 'rg16', 'r16', 'r8', 'rgb', 'mask8', 'logratio8']),
                  min: z.union([z.number(), z.null()]).default(null),
                  max: z.union([z.number(), z.null()]).default(null),
                  scale: z.union([z.number(), z.null()]).default(null),
                  offset: z.union([z.number(), z.null()]).default(null),
                })
                .strict(),
              z.null(),
            ])
            .default(null),
          stats: z.union([z.string(), z.null()]).default(null),
        })
        .strict(),
    ),
  })
  .strict();
export type AnugaIndex = z.infer<typeof AnugaIndexSchema>;

/** contracts/anuga_stats.schema.json (schema v1) */
export const AnugaStatsSchema = z
  .object({
    mass_balance_err: z.number(),
    peak_Q_m3s: z.number(),
    inundated_km2: z.number(),
    arrival_h: z.record(z.number()),
    max_depth_m: z.record(z.number()),
  })
  .strict();
export type AnugaStats = z.infer<typeof AnugaStatsSchema>;

/** contracts/impacts.schema.json (schema v1) */
export const ImpactsSchema = z
  .object({
    badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']),
    source: z.string(),
    method: z.string().default(''),
    uncertainty: z.string().default(''),
    placeholder: z.boolean().default(false),
    schema_version: z.number().int().default(1),
    dam_id: z.string(),
    scenarios: z.record(
      z
        .object({
          cropland_ha: z.number(),
          builtup_ha: z.number(),
          buildings: z.number().int(),
          road_km: z.number(),
          villages: z.array(
            z
              .object({
                name: z.string(),
                arrival_h: z.union([z.number(), z.null()]).default(null),
                max_depth_m: z.union([z.number(), z.null()]).default(null),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type Impacts = z.infer<typeof ImpactsSchema>;

/** contracts/level_volume.schema.json (schema v1) */
export const LevelVolumeSchema = z
  .object({
    badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']),
    source: z.string(),
    method: z.string().default(''),
    uncertainty: z.string().default(''),
    placeholder: z.boolean().default(false),
    schema_version: z.number().int().default(1),
    dam_id: z.string(),
    swot: z
      .object({
        available: z.boolean(),
        lake_id: z.union([z.string(), z.null()]).default(null),
        reason: z.string().default(''),
        points: z
          .array(
            z
              .object({
                time: z.string(),
                wse_m: z.number(),
                wse_u: z.number(),
                area_km2: z.union([z.number(), z.null()]).default(null),
                quality: z.number().int(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
    dem_shoreline: z.array(
      z
        .object({
          date: z.string(),
          level_m: z.union([z.number(), z.null()]).default(null),
          sigma_m: z.union([z.number(), z.null()]).default(null),
          measurable: z.boolean().default(true),
          note: z.string().default(''),
        })
        .strict(),
    ),
    delta_volume: z.array(
      z
        .object({
          from: z.string(),
          to: z.string(),
          dV_m3: z.number(),
          low: z.number(),
          high: z.number(),
          method: z.string(),
        })
        .strict(),
    ),
    reported: z.array(
      z
        .object({
          what: z.string(),
          value_m3: z.number(),
          alt: z.union([z.number(), z.null()]).default(null),
          source: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type LevelVolume = z.infer<typeof LevelVolumeSchema>;

/** contracts/sources.schema.json (schema v1) */
export const SourcesSchema = z
  .object({
    schema_version: z.number().int().default(1),
    sources: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          url: z.string(),
          kind: z.enum(['data', 'press', 'method', 'challenge', 'official']),
        })
        .strict(),
    ),
  })
  .strict();
export type Sources = z.infer<typeof SourcesSchema>;

/** contracts/events.schema.json (schema v1) */
export const EventsSchema = z
  .object({
    schema_version: z.number().int().default(1),
    events: z.array(
      z
        .object({
          date: z.string(),
          label: z.string(),
          kind: z.enum(['failure', 'arrival', 'repair', 'plan', 'other']).default('other'),
          badge: z.enum(['MEASURED', 'REPORTED', 'MODELLED', 'ILLUSTRATIVE']).default('REPORTED'),
          source: z.string().default(''),
        })
        .strict(),
    ),
  })
  .strict();
export type Events = z.infer<typeof EventsSchema>;

/** All contract schemas by file stem (manifest `files` keys). */
export const contractSchemas = {
  grid: GridSchema,
  manifest: ManifestSchema,
  reservoir_area: ReservoirAreaSchema,
  alerts: AlertsSchema,
  hand_lut: HandLutSchema,
  anuga_index: AnugaIndexSchema,
  anuga_stats: AnugaStatsSchema,
  impacts: ImpactsSchema,
  level_volume: LevelVolumeSchema,
  sources: SourcesSchema,
  events: EventsSchema,
} as const;
export type ContractStem = keyof typeof contractSchemas;
