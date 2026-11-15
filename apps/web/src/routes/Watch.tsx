import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { HonestyNote } from '@/components/HonestyNote';
import { Button } from '@/components/ui/button';
import { useAlerts, useLevelVolume, useReservoirArea } from '@/data/hooks';
import { FAILURE_DATE, fmt, fmtSigned } from '@/features/story/facts';
import { firstConfirmedAlert, flagsOf, fmtDayYear, phaseFlags, reliablePoints, rollingMedian } from '@/features/story/series';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

const STATUS_COPY = {
  NORMAL: { tone: 'text-ok border-ok/50', everyone: 'Normal: no unusual drop in the last check.' },
  WARNING: { tone: 'text-alert border-alert/60', everyone: 'Warning: the lake is more than 12 % below its recent normal.' },
  ALERT: { tone: 'text-danger border-danger/60', everyone: 'Alert: the lake is more than 20 % below its recent normal.' },
} as const;

function Section({ label, badge, children }: { label: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="telemetry-label">{label}</p>
        {badge}
      </div>
      {children}
    </div>
  );
}

/** `/watch` — one honest Dam Watch panel for the dam in the bundle (Mellègue), Simplified / Advanced. */
export function Component() {
  useDocumentTitle('Dam Watch');
  const { damId } = useParams();
  const setMode = useAppStore((s) => s.setMode);
  const storeDam = useAppStore((s) => s.damId);
  const experts = useAppStore((s) => s.level === 'experts');
  useEffect(() => setMode('watch'), [setMode]);

  const dam = damId ?? storeDam;
  const series = useReservoirArea(dam);
  const alerts = useAlerts(dam);
  const level = useLevelVolume(dam);

  const rel = useMemo(
    () => (series.data ? reliablePoints(series.data.points).sort((a, b) => a.date.localeCompare(b.date)) : []),
    [series.data],
  );
  const latest = rel[rel.length - 1] ?? null;
  const spark = useMemo(() => (series.data ? rollingMedian(series.data.points) : []), [series.data]);
  const flags = useMemo(() => (alerts.data ? flagsOf(alerts.data) : []), [alerts.data]);
  const phases = phaseFlags(flags);
  const first = firstConfirmedAlert(flags);
  const lastFlag = flags[flags.length - 1] ?? null;
  const lastEval = alerts.data?.evaluations[alerts.data.evaluations.length - 1] ?? null;
  const swotAll = level.data?.swot.points ?? [];
  const swotGood = swotAll.filter((p) => p.quality === 0);
  const lastGood = swotGood[swotGood.length - 1] ?? null;
  const lastAny = swotAll[swotAll.length - 1] ?? null;
  const dv = level.data?.delta_volume[0];
  const nisarN = rel.filter((p) => p.sensor === 'NISAR').length;

  const W = 380;
  const H = 76;
  const sp = useMemo(() => {
    if (spark.length < 2) return null;
    const t0 = Date.parse(spark[0]!.date);
    const t1 = Date.parse(spark[spark.length - 1]!.date);
    const lo = Math.min(...spark.map((s) => s.median - s.sigma));
    const hi = Math.max(...spark.map((s) => s.median + s.sigma));
    const X = (d: string) => ((Date.parse(d) - t0) / (t1 - t0 || 1)) * W;
    const Y = (v: number) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - 8);
    const line = spark.map((s, i) => `${i ? 'L' : 'M'}${X(s.date).toFixed(1)},${Y(s.median).toFixed(1)}`).join('');
    const band =
      spark.map((s, i) => `${i ? 'L' : 'M'}${X(s.date).toFixed(1)},${Y(s.median + s.sigma).toFixed(1)}`).join('') +
      [...spark].reverse().map((s) => `L${X(s.date).toFixed(1)},${Y(s.median - s.sigma).toFixed(1)}`).join('') +
      'Z';
    return { line, band, fail: X(FAILURE_DATE) };
  }, [spark]);

  const status = lastEval ? STATUS_COPY[lastEval.level] : null;

  return (
    <div className="flex min-h-[calc(100svh-62px)] justify-end p-3 sm:p-4">
      <section
        aria-labelledby="watch-title"
        data-stage-occluder
        className="panel pointer-events-auto w-full max-w-[480px] self-start p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="kicker">Dam Watch · {experts ? 'advanced' : 'simplified'}</p>
            <h1 id="watch-title" className="mt-2 text-2xl font-bold">
              {series.data?.reservoir ?? dam}
            </h1>
            <p className="mt-1 text-[12.5px] text-mute">Tunisia · built 1954 · watched from space, no ground sensor</p>
          </div>
          {status && lastEval ? (
            <span className={cn('shrink-0 rounded-pill border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em]', status.tone)}>
              ● {lastEval.level}
            </span>
          ) : null}
        </div>

        {series.isPending ? <DataState kind="loading" subject="Lake area series" className="mt-4" /> : null}
        {series.isError ? (
          <DataState kind={dataStateForError(series.error).kind} subject="Lake area series" className="mt-4" />
        ) : null}

        {series.data && latest ? (
          <Section label="Water area · latest" badge={<Badge {...provenanceProps(series.data)} subject="Lake area" />}>
            <p className="mt-2 font-mono text-[40px] leading-none">
              {fmt(latest.area_km2, 2)} <span className="text-[15px] text-mute">km²</span>
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-mute">
              {fmtDayYear(latest.date)} · {latest.sensor === 'S1' ? 'Sentinel-1' : 'NISAR'} {latest.track}
              {latest.sigma_km2 !== null ? ` · ± ${fmt(2 * latest.sigma_km2, 2)} km² (threshold ±2 dB)` : ''}
            </p>
            {sp ? (
              <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full" role="img" aria-label="21-day median lake area with the ±2 dB threshold band, May to November 2026">
                <path d={sp.band} fill="rgba(95,243,255,.12)" />
                <line x1={sp.fail} x2={sp.fail} y1={0} y2={H} stroke="#ff5c7a" strokeDasharray="3 3" strokeWidth={1} />
                <path d={sp.line} fill="none" stroke="#5ff3ff" strokeWidth={2} />
              </svg>
            ) : null}
            <p className="font-mono text-[10px] text-mute">
              21-day median {experts ? '± threshold band ' : ''}· {fmtDayYear(series.data.points[0]!.date)} →{' '}
              {fmtDayYear(latest.date)} · red line = gate failure 17 Jun
            </p>
            {experts ? (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink/80">
                {rel.length} reliable measurements ({nisarN} NISAR, {rel.length - nisarN} Sentinel-1), per-image Otsu
                threshold inside the pre-failure lake polygon. ±2 dB on the threshold moves the area by a median ±23 %.
              </p>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-ink/85">
                How big the lake is, measured by radar every few days, day or night, through clouds.
              </p>
            )}
          </Section>
        ) : null}

        {alerts.data ? (
          <Section label="Automatic alert" badge={<Badge {...provenanceProps(alerts.data)} subject="Anomaly detector" />}>
            {lastEval ? (
              <p className="mt-2 text-sm text-ink/90">
                Last check {fmtDayYear(lastEval.date)}:{' '}
                {experts ? (
                  <>
                    <strong>{lastEval.level}</strong>. {lastEval.text.experts}
                  </>
                ) : (
                  (status?.everyone ?? lastEval.text.everyone)
                )}
              </p>
            ) : null}
            {first ? (
              <p className="mt-2 text-[12.5px] text-ink/80">
                {experts
                  ? `June 2026 replay: first ALERT ${fmtDayYear(first.flag.date)} (${first.flag.sensor} ${first.flag.track} ${fmtSigned(first.flag.departurePct, 1)} %, confirmed by ${first.confirmedBy?.sensor ?? ''} ${first.confirmedBy?.track ?? ''}), ${phases.before.length} flags before the failure.`
                  : `In June 2026 this alarm would have fired on ${fmtDayYear(first.flag.date)}, five days after the gate failed, with no false alarm before.`}
              </p>
            ) : null}
            {lastFlag && lastFlag.date > FAILURE_DATE ? (
              <p className="mt-1.5 text-[12px] text-alert">
                Last flag {fmtDayYear(lastFlag.date)} ({lastFlag.level}
                {experts ? `, ${fmtSigned(lastFlag.departurePct, 0)} %` : ''}): needs an operator check, the cause is
                unknown.
              </p>
            ) : null}
            {experts ? (
              <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-mute">
                Rule: area vs 21-day multi-sensor median; WARNING &lt; −12 %, ALERT &lt; −20 %, each confirmed by an
                independent pass within 6 days. Thresholds set on this event (retrospective).
              </p>
            ) : null}
          </Section>
        ) : null}

        {level.data && !level.data.placeholder && lastGood ? (
          <Section label="Water level · SWOT" badge={<Badge {...provenanceProps(level.data)} subject="SWOT level" />}>
            <p className="mt-2 font-mono text-[24px] leading-none">
              {fmt(lastGood.wse_m, 2)} <span className="text-[12px] text-mute">m ± {fmt(lastGood.wse_u, 2)}</span>
            </p>
            <p className="mt-1 font-mono text-[11px] text-mute">Last good-quality pass · {fmtDayYear(lastGood.time)}</p>
            {lastAny && lastAny !== lastGood ? (
              <p className="mt-1 font-mono text-[11px] text-mute">
                Latest pass {fmtDayYear(lastAny.time)}: {fmt(lastAny.wse_m, 2)} ± {fmt(lastAny.wse_u, 2)} m (suspect
                quality, not used for numbers)
              </p>
            ) : null}
            {experts && dv ? (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink/80">
                Storage change {fmtDayYear(dv.from)} → {fmtDayYear(dv.to)}:{' '}
                <strong className="font-mono">{fmt(dv.dV_m3 / 1e6, 1)} Mm³</strong> ({fmt(dv.low / 1e6, 1)}…
                {fmt(dv.high / 1e6, 1)}), <Badge kind="modelled" source="This project (07_level_volume.py)" subject="Storage change" className="h-[18px] px-1.5 text-[9px]" />{' '}
                net of inflow, not the released volume.
              </p>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-ink/85">
                The SWOT satellite measures the height of the lake surface; it fell by about 3.75 m after the failure.
              </p>
            )}
          </Section>
        ) : null}

        <Section label="Flood scenarios">
          <p className="mt-1.5 text-sm text-ink/85">
            {experts
              ? 'HAND bathtub for any volume ≥ 5 Mm³ (whole corridor) and ANUGA 2D runs for 21 / 50 / 195 Mm³ (dam → Medjerda confluence). Screening level; arrival 13–19 h is mesh-sensitive.'
              : 'What if more water were released? Try a quick flood for any volume, or a physics flood for three volumes. A scenario, not a forecast.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" variant="chip" asChild>
              <Link to="/story/7">Open scenarios</Link>
            </Button>
            <Button size="xs" variant="chip" asChild>
              <Link to="/methods">How it works</Link>
            </Button>
            <Button size="xs" variant="chip" asChild>
              <Link to="/your-dam">Dancing with your Dam</Link>
            </Button>
          </div>
        </Section>

        <HonestyNote kind="info" label="One reservoir today" className="mt-5">
          This version covers Mellègue only; no other dam has been processed or tested. Other reservoirs are the V2
          roadmap.
        </HonestyNote>
      </section>
    </div>
  );
}
