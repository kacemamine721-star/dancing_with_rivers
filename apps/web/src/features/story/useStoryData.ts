import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  dataQueries,
  useAlerts,
  useAnugaIndex,
  useDataSource,
  useEvents,
  useHandLut,
  useImpacts,
  useLevelVolume,
  useManifest,
  useReservoirArea,
  useSources,
} from '@/data/hooks';
import type { AnugaStats } from '@/data/schemas.gen';
import { useCatchments, useFlowpathMeta } from '@/data/vectors';
import { useAppStore } from '@/store/app';

import { computeFacts, type Facts, type StoryInputs } from './facts';

/** stats.json of every computed ANUGA scenario, keyed by id. */
export function useAnugaStatsAll(): Record<string, AnugaStats | undefined> {
  const ds = useDataSource();
  const dam = useAppStore((s) => s.damId);
  const index = useAnugaIndex();
  const ids = (index.data?.scenarios ?? []).filter((s) => s.computed && s.stats).map((s) => s.id);
  const results = useQueries({ queries: ids.map((id) => dataQueries.anugaStats(ds, dam, id)) });
  const key = results.map((r) => r.dataUpdatedAt).join(',');
  return useMemo(
    () => Object.fromEntries(ids.map((id, i) => [id, results[i]?.data])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(','), key],
  );
}

/** Every bundle file the story cards read (each one cached by TanStack Query). */
export function useStoryInputs(): StoryInputs {
  const date = useAppStore((s) => s.date);
  const manifest = useManifest().data;
  const series = useReservoirArea().data;
  const alerts = useAlerts().data;
  const lut = useHandLut().data;
  const index = useAnugaIndex().data;
  const stats = useAnugaStatsAll();
  const impacts = useImpacts().data;
  const level = useLevelVolume().data;
  const events = useEvents().data;
  const sources = useSources().data;
  const flowpath = useFlowpathMeta().data;
  const catchments = useCatchments().data;
  return useMemo(
    () => ({ manifest, series, alerts, lut, index, stats, impacts, level, events, sources, flowpath, catchments, date }),
    [manifest, series, alerts, lut, index, stats, impacts, level, events, sources, flowpath, catchments, date],
  );
}

export function useFacts(): Facts {
  const inputs = useStoryInputs();
  return useMemo(() => computeFacts(inputs), [inputs]);
}
