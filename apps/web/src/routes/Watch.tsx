import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { HonestyNote } from '@/components/HonestyNote';
import { Button } from '@/components/ui/button';
import { useAlerts, useLevelVolume, useReservoirArea } from '@/data/hooks';
import { FAILURE_DATE, fmt } from '@/features/story/facts';
import { flagsOf, fmtDayYear, reliablePoints, rollingMedian } from '@/features/story/series';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAppStore } from '@/store/app';

/** `/watch` — one honest Dam Watch panel for the dam in the bundle (Mellègue). */
export function Component() {
  useDocumentTitle('Dam Watch');
  const { damId } = useParams();
  const setMode = useAppStore((s) => s.setMode);
  const storeDam = useAppStore((s) => s.damId);
  useEffect(() => setMode('watch'), [setMode]);

  const dam = damId ?? storeDam;
  const series = useReservoirArea(dam);
  const alerts = useAlerts(dam);
  const level = useLevelVolume(dam);

  const latest = useMemo(() => {
    const pts = series.data ? reliablePoints(series.data.points).sort((a, b) => a.date.localeCompare(b.date)) : [];
    return pts[pts.length - 1] ?? null;
  }, [series.data]);
  const spark = useMemo(() => (series.data ? rollingMedian(series.data.points) : []), [series.data]);
  const lastFlag = useMemo(() => {
    if (!alerts.data) return null;
    const flags = flagsOf(alerts.data);
    return flags[flags.length - 1] ?? null;
  }, [alerts.data]);
  const lastEval = alerts.data?.evaluations[alerts.data.evaluations.length - 1] ?? null;
  const swot = (level.data?.swot.points ?? []).filter((p) => p.quality === 0);
  const lastSwot = swot[swot.length - 1] ?? null;

  const W = 380;
  const H = 70;
  const sp = (() => {
    if (spark.length < 2) return '';
    const t0 = Date.parse(spark[0]!.date);
    const t1 = Date.parse(spark[spark.length - 1]!.date);
    const lo = Math.min(...spark.map((s) => s.median));
    const hi = Math.max(...spark.map((s) => s.median));
    return spark
      .map((s, i) => {
        const x = ((Date.parse(s.date) - t0) / (t1 - t0 || 1)) * W;
        const y = 4 + (1 - (s.median - lo) / (hi - lo || 1)) * (H - 8);
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join('');
  })();

  return (
    <div className="flex min-h-[calc(100svh-62px)] justify-end p-3 sm:p-4">
      <section aria-labelledby="watch-title" className="panel pointer-events-auto w-full max-w-[460px] self-start p-5 sm:p-6">
        <p className="kicker">Dam Watch</p>
        <h1 id="watch-title" className="mt-2 text-2xl font-bold">
          {series.data?.reservoir ?? dam}
        </h1>

        {series.isPending ? <DataState kind="loading" subject="Lake area series" className="mt-4" /> : null}
        {series.isError ? (
          <DataState kind={dataStateForError(series.error).kind} subject="Lake area series" className="mt-4" />
        ) : null}

        {series.data && latest ? (
          <div className="mt-4 border-t border-hairline pt-4">
            <div className="flex items-center justify-between">
              <p className="telemetry-label">Latest water area</p>
              <Badge {...provenanceProps(series.data)} subject="Lake area" />
            </div>
            <p className="mt-2 font-mono text-[40px] leading-none">
              {fmt(latest.area_km2, 2)} <span className="text-[15px] text-mute">km²</span>
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-mute">
              {fmtDayYear(latest.date)} · {latest.sensor === 'S1' ? 'Sentinel-1' : 'NISAR'} {latest.track} · ±
              {latest.sigma_km2 === null ? '?' : fmt(latest.sigma_km2, 2)} km²
            </p>
            {sp ? (
              <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full" role="img" aria-label="21-day median lake area, May to November 2026">
                <path d={sp} fill="none" stroke="#5ff3ff" strokeWidth={2} />
              </svg>
            ) : null}
            <p className="font-mono text-[10px] text-mute">
              21-day median, {fmtDayYear(series.data.points[0]!.date)} → {fmtDayYear(latest.date)}
            </p>
          </div>
        ) : null}

        {alerts.data ? (
          <div className="mt-4 border-t border-hairline pt-4">
            <div className="flex items-center justify-between">
              <p className="telemetry-label">Alert status</p>
              <Badge {...provenanceProps(alerts.data)} subject="Anomaly detector" />
            </div>
            {lastEval ? (
              <p className="mt-2 text-sm text-ink/90">
                Last check {fmtDayYear(lastEval.date)}: <strong>{lastEval.level}</strong>. {lastEval.text.everyone}
              </p>
            ) : null}
            {lastFlag && lastFlag.date > FAILURE_DATE ? (
              <p className="mt-1.5 text-[12px] text-alert">
                Last flag {fmtDayYear(lastFlag.date)} ({lastFlag.level}): needs an operator check, the cause is unknown.
              </p>
            ) : null}
          </div>
        ) : null}

        {level.data && !level.data.placeholder && lastSwot ? (
          <div className="mt-4 border-t border-hairline pt-4">
            <div className="flex items-center justify-between">
              <p className="telemetry-label">Latest SWOT level (good quality)</p>
              <Badge {...provenanceProps(level.data)} subject="SWOT level" />
            </div>
            <p className="mt-2 font-mono text-[24px] leading-none">
              {fmt(lastSwot.wse_m, 2)} <span className="text-[12px] text-mute">m ± {fmt(lastSwot.wse_u, 2)}</span>
            </p>
            <p className="mt-1 font-mono text-[11px] text-mute">{fmtDayYear(lastSwot.time)}</p>
          </div>
        ) : null}

        <div className="mt-4 border-t border-hairline pt-4">
          <p className="telemetry-label">Flood scenarios</p>
          <p className="mt-1.5 text-sm text-ink/85">
            HAND quick flood for any volume, ANUGA 2D runs for three volumes (screening level, not a forecast).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" variant="chip" asChild>
              <Link to="/story/7">Open scenarios</Link>
            </Button>
            <Button size="xs" variant="chip" asChild>
              <Link to="/methods">Methods & validation</Link>
            </Button>
          </div>
        </div>

        <HonestyNote kind="info" label="One reservoir today" className="mt-5">
          Other reservoirs: roadmap. This bundle covers Mellègue only; no other dam has been processed or tested.
        </HonestyNote>
      </section>
    </div>
  );
}
