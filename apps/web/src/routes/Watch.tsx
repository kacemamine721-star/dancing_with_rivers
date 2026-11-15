import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { HonestyNote } from '@/components/HonestyNote';
import { useReservoirArea } from '@/data/hooks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAppStore } from '@/store/app';

/** `/watch` and `/watch/:damId` — Dam Watch placeholder (drawer, list and views land in M8). */
export function Component() {
  useDocumentTitle('Dam Watch');
  const { damId } = useParams();
  const setMode = useAppStore((s) => s.setMode);
  const storeDam = useAppStore((s) => s.damId);
  useEffect(() => setMode('watch'), [setMode]);

  const dam = damId ?? storeDam;
  const series = useReservoirArea(dam);

  return (
    <div className="flex min-h-[calc(100svh-62px)] justify-end p-4">
      <section aria-labelledby="watch-title" className="glass w-full max-w-[440px] bg-[rgba(6,12,20,.92)] p-6">
        <p className="kicker">Dam Watch</p>
        <h1 id="watch-title" className="mt-2 text-2xl font-bold">
          {series.data?.reservoir ?? dam}
        </h1>
        <div className="mt-4">
          {series.isPending ? <DataState kind="loading" subject="Lake area series" /> : null}
          {series.isError ? (
            <DataState
              kind={dataStateForError(series.error).kind}
              subject="Lake area series"
              message={series.error instanceof Error ? series.error.message : undefined}
            />
          ) : null}
          {series.data ? (
            <div className="flex items-center justify-between gap-3 text-sm text-ink/85">
              <span>
                {series.data.points.length} observations, {series.data.gaps?.length ?? 0} gap
                {series.data.gaps?.length === 1 ? '' : 's'}
              </span>
              <Badge {...provenanceProps(series.data)} subject="Lake area series" />
            </div>
          ) : null}
        </div>
        <HonestyNote kind="info" label="Monitoring view · in progress" className="mt-6">
          The reservoir list, alerts, sparkline and downloads arrive with milestone M8.
        </HonestyNote>
      </section>
    </div>
  );
}
