import { Activity, ArrowRight, Radio, Waves } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { HonestyNote } from '@/components/HonestyNote';
import { Button } from '@/components/ui/button';
import { useReservoirArea } from '@/data/hooks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAppStore } from '@/store/app';

const DAMS_NETWORK = [
  { id: 'mellegue', name: 'Mellègue (Old)', capacityMm3: 50, river: 'Oued Mellègue', status: 'Decommissioned (June 2026)', active: true },
  { id: 'upper_mellegue', name: 'Upper Mellègue (New)', capacityMm3: 195, river: 'Oued Mellègue', status: 'Filling & Operational', active: false },
  { id: 'sidi_salem', name: 'Sidi Salem', capacityMm3: 550, river: 'Oued Medjerda', status: 'Active (Medjerda Main)', active: false },
  { id: 'barbara', name: 'Barbara', capacityMm3: 75, river: 'Oued Barbara', status: 'Active (North Basin)', active: false },
  { id: 'kasseb', name: 'Kasseb', capacityMm3: 80, river: 'Oued Kasseb', status: 'Active (Beja Highlands)', active: false },
] as const;

/** `/watch` and `/watch/:damId` — National Dam Watch monitoring dashboard. */
export function Component() {
  useDocumentTitle('Dam Watch · National Monitoring');
  const { damId } = useParams();
  const setMode = useAppStore((s) => s.setMode);
  const storeDam = useAppStore((s) => s.damId);
  useEffect(() => setMode('watch'), [setMode]);

  const dam = damId ?? storeDam;
  const series = useReservoirArea(dam);

  return (
    <div className="flex min-h-[calc(100svh-62px)] justify-end p-4 sm:p-6 lg:p-8">
      <section
        aria-labelledby="watch-title"
        className="glass w-full max-w-[500px] space-y-5 rounded-2xl border border-white/10 bg-[rgba(6,12,20,.94)] p-6 shadow-2xl backdrop-blur-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-teal animate-pulse" />
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-teal">
              National Dam Watch · NISAR
            </p>
          </div>
          <span className="font-mono text-[10.5px] uppercase text-mute">12-Day Revisit</span>
        </div>

        {/* Title */}
        <div>
          <h1 id="watch-title" className="text-2xl font-bold tracking-tight text-ink">
            {series.data?.reservoir ?? 'Mellègue Reservoir'}
          </h1>
          <p className="mt-1 text-xs text-mute">
            Autonomous multi-temporal radar surveillance without in-situ gauges
          </p>
        </div>

        {/* Main Telemetry Box */}
        <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-mute font-mono">
            <span className="flex items-center gap-1.5 text-teal">
              <Activity className="size-3.5" /> Satellite Status
            </span>
            <span>Online</span>
          </div>

          {series.isPending ? <DataState kind="loading" subject="Lake area series" /> : null}
          {series.isError ? (
            <DataState
              kind={dataStateForError(series.error).kind}
              subject="Lake area series"
              message={series.error instanceof Error ? series.error.message : undefined}
            />
          ) : null}

          {series.data ? (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-mute">Observations</span>
                <p className="font-mono text-xl font-bold text-ink">
                  {series.data.points.length} <span className="text-xs font-normal text-mute">passes</span>
                </p>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-mute">Data Gaps</span>
                <p className="font-mono text-xl font-bold text-teal">
                  {series.data.gaps?.length ?? 0} <span className="text-xs font-normal text-mute">clouds/drop</span>
                </p>
              </div>
            </div>
          ) : null}

          {series.data ? (
            <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px]">
              <span className="text-mute">Data source &amp; model:</span>
              <Badge {...provenanceProps(series.data)} subject="Lake area series" />
            </div>
          ) : null}
        </div>

        {/* National Portfolio */}
        <div className="space-y-2.5">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-mute">
            Medjerda Basin Reservoirs
          </p>
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-black/25">
            {DAMS_NETWORK.map((d) => (
              <div key={d.id} className="flex items-center justify-between p-3 text-xs">
                <div>
                  <p className="font-semibold text-ink flex items-center gap-1.5">
                    {d.name}
                    {d.active && <span className="size-1.5 rounded-full bg-teal" />}
                  </p>
                  <p className="font-mono text-[10.5px] text-mute">{d.river} · {d.capacityMm3} Mm³</p>
                </div>
                <span className="font-mono text-[10.5px] text-mute">{d.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation to Story */}
        <div className="flex items-center justify-between pt-2">
          <Button size="sm" variant="ghost" asChild>
            <Link to="/story/1">
              <Waves className="mr-1.5 size-3.5 text-teal" /> Replay Incident Story
            </Link>
          </Button>
          <Button size="sm" variant="primary" asChild>
            <Link to="/methods">
              Methods <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>

        <HonestyNote kind="info" label="SCALABLE ARCHITECTURE">
          Autonomous multi-temporal radar pipeline designed for ingestion across all 37 major Tunisian dams and Mediterranean watersheds.
        </HonestyNote>
      </section>
    </div>
  );
}
