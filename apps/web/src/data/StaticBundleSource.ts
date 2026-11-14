import type { ZodType, ZodTypeDef } from 'zod';

import type { ContractName, DataSource } from '@/data/DataSource';
import { DataContractError, DataFetchError, DataNotFoundError } from '@/data/errors';
import {
  AlertsSchema,
  AnugaIndexSchema,
  AnugaStatsSchema,
  EventsSchema,
  GridSchema,
  HandLutSchema,
  ImpactsSchema,
  LevelVolumeSchema,
  type Manifest,
  ManifestSchema,
  ReservoirAreaSchema,
  SourcesSchema,
} from '@/data/schemas.gen';

export const DEFAULT_DATA_BASE_URL = '/data/2026-11-15';

/** Default bundle layout (docs/06 §3); the manifest `files` map overrides it. */
export const DEFAULT_FILES: Record<Exclude<ContractName, 'anuga_stats'>, string> = {
  manifest: 'manifest.json',
  grid: 'terrain/grid.json',
  reservoir_area: 'timeseries/reservoir_area.json',
  alerts: 'anomaly/alerts.json',
  hand_lut: 'flood/hand_lut.json',
  anuga_index: 'flood/anuga/index.json',
  impacts: 'impacts/impacts.json',
  level_volume: 'level/level_volume.json',
  sources: 'story/sources.json',
  events: 'story/events.json',
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StaticBundleSourceOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

function resolveBaseUrl(): string {
  const env = import.meta.env.VITE_DATA_BASE_URL as string | undefined;
  return env && env.trim() !== '' ? env.trim() : DEFAULT_DATA_BASE_URL;
}

/**
 * v1 DataSource: reads the versioned static bundle written by `pipeline/08_bundle.py`.
 * The bundle covers one dam (`manifest.dam_id`); other dam ids resolve to DataNotFoundError.
 * All paths inside contracts are relative to the bundle root.
 */
export class StaticBundleSource implements DataSource {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private manifestPromise: Promise<Manifest> | null = null;
  private manifestValue: Manifest | null = null;

  constructor(options: StaticBundleSourceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveBaseUrl()).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  fileUrl(path: string): string {
    if (/^(https?:)?\/\//.test(path)) return path;
    return `${this.baseUrl}/${path.replace(/^\/+/, '')}`;
  }

  textureUrl(layerId: string): string {
    const layer = this.manifestValue?.layers.find((l) => l.id === layerId);
    if (!layer) {
      throw new DataNotFoundError('manifest', this.fileUrl(DEFAULT_FILES.manifest), `Unknown layer "${layerId}"`);
    }
    return this.fileUrl(layer.file);
  }

  manifest(): Promise<Manifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.load('manifest', DEFAULT_FILES.manifest, ManifestSchema).then(
        (m) => {
          this.manifestValue = m;
          return m;
        },
        (e: unknown) => {
          this.manifestPromise = null; // allow a retry
          throw e;
        },
      );
    }
    return this.manifestPromise;
  }

  async grid() {
    return this.load('grid', await this.pathFor('grid'), GridSchema);
  }

  async reservoirArea(damId: string) {
    await this.assertDam(damId, 'reservoir_area');
    return this.load('reservoir_area', await this.pathFor('reservoir_area'), ReservoirAreaSchema);
  }

  async alerts(damId: string) {
    await this.assertDam(damId, 'alerts');
    return this.load('alerts', await this.pathFor('alerts'), AlertsSchema);
  }

  async handLut(damId: string) {
    await this.assertDam(damId, 'hand_lut');
    return this.load('hand_lut', await this.pathFor('hand_lut'), HandLutSchema);
  }

  async anugaIndex(damId: string) {
    await this.assertDam(damId, 'anuga_index');
    return this.load('anuga_index', await this.pathFor('anuga_index'), AnugaIndexSchema);
  }

  async anugaStats(damId: string, scenarioId: string) {
    const index = await this.anugaIndex(damId);
    const scenario = index.scenarios.find((s) => s.id === scenarioId);
    if (!scenario?.computed || !scenario.stats) {
      throw new DataNotFoundError(
        'anuga_stats',
        this.fileUrl(DEFAULT_FILES.anuga_index),
        `Scenario "${scenarioId}" is not computed`,
      );
    }
    return this.load('anuga_stats', scenario.stats, AnugaStatsSchema);
  }

  async impacts(damId: string) {
    await this.assertDam(damId, 'impacts');
    return this.load('impacts', await this.pathFor('impacts'), ImpactsSchema);
  }

  async levelVolume(damId: string) {
    await this.assertDam(damId, 'level_volume');
    return this.load('level_volume', await this.pathFor('level_volume'), LevelVolumeSchema);
  }

  async sources() {
    return this.load('sources', await this.pathFor('sources'), SourcesSchema);
  }

  async events() {
    return this.load('events', await this.pathFor('events'), EventsSchema);
  }

  private async pathFor(name: Exclude<ContractName, 'anuga_stats' | 'manifest'>): Promise<string> {
    const m = await this.manifest();
    return m.files?.[name] ?? DEFAULT_FILES[name];
  }

  private async assertDam(damId: string, contract: ContractName): Promise<void> {
    const m = await this.manifest();
    if (m.dam_id !== damId) {
      throw new DataNotFoundError(contract, this.baseUrl, `The data bundle covers "${m.dam_id}", not "${damId}"`);
    }
  }

  private async load<T>(contract: ContractName, path: string, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
    const url = this.fileUrl(path);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
    } catch (cause) {
      throw new DataFetchError(contract, url, null, { cause });
    }
    if (res.status === 404) throw new DataNotFoundError(contract, url);
    if (!res.ok) throw new DataFetchError(contract, url, res.status);

    let json: unknown;
    try {
      json = await res.json();
    } catch (cause) {
      // An SPA fallback serving index.html for a missing file lands here too.
      throw new DataContractError(contract, url, [
        { code: 'custom', path: [], message: `Response is not JSON (${String(cause)})` },
      ]);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new DataContractError(contract, url, parsed.error.issues);
    return parsed.data;
  }
}
