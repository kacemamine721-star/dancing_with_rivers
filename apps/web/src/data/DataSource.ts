import type {
  Alerts,
  AnugaIndex,
  AnugaStats,
  Events,
  Grid,
  HandLut,
  Impacts,
  LevelVolume,
  Manifest,
  ReservoirArea,
  Sources,
} from '@/data/schemas.gen';

/**
 * The only way the UI reads data (docs/03 §6.3). Every method resolves to a value that has
 * already been parsed with its generated Zod schema, or rejects with a typed error from
 * `./errors` (DataContractError, DataNotFoundError, DataFetchError).
 *
 * v1: StaticBundleSource (versioned static bundle). v2: ApiSource (FastAPI, roadmap).
 */
export interface DataSource {
  manifest(): Promise<Manifest>;
  grid(): Promise<Grid>;
  reservoirArea(damId: string): Promise<ReservoirArea>;
  alerts(damId: string): Promise<Alerts>;
  handLut(damId: string): Promise<HandLut>;
  anugaIndex(damId: string): Promise<AnugaIndex>;
  anugaStats(damId: string, scenarioId: string): Promise<AnugaStats>;
  impacts(damId: string): Promise<Impacts>;
  levelVolume(damId: string): Promise<LevelVolume>;
  sources(): Promise<Sources>;
  events(): Promise<Events>;
  /** URL of a raster layer listed in the manifest (call after `manifest()` resolved). */
  textureUrl(layerId: string): string;
  /** URL of any file referenced by a bundle-relative path (e.g. `radar/…_mask.png`). */
  fileUrl(path: string): string;
}

/** Contract names, matching `contracts/<name>.schema.json` and the manifest `files` keys. */
export type ContractName =
  | 'grid'
  | 'manifest'
  | 'reservoir_area'
  | 'alerts'
  | 'hand_lut'
  | 'anuga_index'
  | 'anuga_stats'
  | 'impacts'
  | 'level_volume'
  | 'sources'
  | 'events';
