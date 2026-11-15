import { queryOptions, useQuery } from '@tanstack/react-query';
import { createContext, createElement, type ReactNode, useContext } from 'react';

import type { DataSource } from '@/data/DataSource';
import { isPermanentDataError } from '@/data/errors';
import { StaticBundleSource } from '@/data/StaticBundleSource';
import { useAppStore } from '@/store/app';

let defaultSource: DataSource | null = null;
/** Lazily created v1 source (static bundle at VITE_DATA_BASE_URL). */
export function getDefaultDataSource(): DataSource {
  defaultSource ??= new StaticBundleSource();
  return defaultSource;
}

const DataSourceContext = createContext<DataSource | null>(null);

/** Swap the data source (tests, ApiSource later). Without a provider the static bundle is used. */
export function DataSourceProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  return createElement(DataSourceContext.Provider, { value: source }, children);
}

export function useDataSource(): DataSource {
  return useContext(DataSourceContext) ?? getDefaultDataSource();
}

/** The bundle is versioned by path, so responses never go stale within a session. */
const STATIC = { staleTime: Infinity, gcTime: 30 * 60_000 } as const;

/** Retry network failures twice; never retry a contract or not-found error. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return !isPermanentDataError(error) && failureCount < 2;
}

export const dataQueries = {
  manifest: (ds: DataSource) =>
    queryOptions({ queryKey: ['data', 'manifest'], queryFn: () => ds.manifest(), ...STATIC }),
  grid: (ds: DataSource) => queryOptions({ queryKey: ['data', 'grid'], queryFn: () => ds.grid(), ...STATIC }),
  reservoirArea: (ds: DataSource, damId: string) =>
    queryOptions({ queryKey: ['data', 'reservoir_area', damId], queryFn: () => ds.reservoirArea(damId), ...STATIC }),
  alerts: (ds: DataSource, damId: string) =>
    queryOptions({ queryKey: ['data', 'alerts', damId], queryFn: () => ds.alerts(damId), ...STATIC }),
  handLut: (ds: DataSource, damId: string) =>
    queryOptions({ queryKey: ['data', 'hand_lut', damId], queryFn: () => ds.handLut(damId), ...STATIC }),
  anugaIndex: (ds: DataSource, damId: string) =>
    queryOptions({ queryKey: ['data', 'anuga_index', damId], queryFn: () => ds.anugaIndex(damId), ...STATIC }),
  anugaStats: (ds: DataSource, damId: string, scenarioId: string) =>
    queryOptions({
      queryKey: ['data', 'anuga_stats', damId, scenarioId],
      queryFn: () => ds.anugaStats(damId, scenarioId),
      ...STATIC,
    }),
  impacts: (ds: DataSource, damId: string) =>
    queryOptions({ queryKey: ['data', 'impacts', damId], queryFn: () => ds.impacts(damId), ...STATIC }),
  levelVolume: (ds: DataSource, damId: string) =>
    queryOptions({ queryKey: ['data', 'level_volume', damId], queryFn: () => ds.levelVolume(damId), ...STATIC }),
  sources: (ds: DataSource) => queryOptions({ queryKey: ['data', 'sources'], queryFn: () => ds.sources(), ...STATIC }),
  events: (ds: DataSource) => queryOptions({ queryKey: ['data', 'events'], queryFn: () => ds.events(), ...STATIC }),
  validation: (ds: DataSource) =>
    queryOptions({ queryKey: ['data', 'validation'], queryFn: () => ds.validation(), ...STATIC }),
};

/** Dam id from the argument, else the store. */
function useDam(damId?: string): string {
  const storeDam = useAppStore((s) => s.damId);
  return damId ?? storeDam;
}

export function useManifest() {
  return useQuery(dataQueries.manifest(useDataSource()));
}

export function useGrid() {
  return useQuery(dataQueries.grid(useDataSource()));
}

export function useReservoirArea(damId?: string) {
  return useQuery(dataQueries.reservoirArea(useDataSource(), useDam(damId)));
}

export function useAlerts(damId?: string) {
  return useQuery(dataQueries.alerts(useDataSource(), useDam(damId)));
}

export function useHandLut(damId?: string) {
  return useQuery(dataQueries.handLut(useDataSource(), useDam(damId)));
}

export function useAnugaIndex(damId?: string) {
  return useQuery(dataQueries.anugaIndex(useDataSource(), useDam(damId)));
}

export function useAnugaStats(scenarioId: string | undefined, damId?: string) {
  const ds = useDataSource();
  const dam = useDam(damId);
  return useQuery({ ...dataQueries.anugaStats(ds, dam, scenarioId ?? ''), enabled: Boolean(scenarioId) });
}

export function useImpacts(damId?: string) {
  return useQuery(dataQueries.impacts(useDataSource(), useDam(damId)));
}

export function useLevelVolume(damId?: string) {
  return useQuery(dataQueries.levelVolume(useDataSource(), useDam(damId)));
}

export function useSources() {
  return useQuery(dataQueries.sources(useDataSource()));
}

export function useEvents() {
  return useQuery(dataQueries.events(useDataSource()));
}

export function useValidation() {
  return useQuery(dataQueries.validation(useDataSource()));
}
