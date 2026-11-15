import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { useAlerts } from '@/data/hooks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import { FAILURE_DATE, fmtSigned } from './facts';
import { dayMs, daysBetween, firstConfirmedAlert, type Flag, flagsOf, fmtDay, phaseFlags } from './series';
import { Panel } from './ui';

const LEVEL_COLOR = { ALERT: '#ff5a5a', WARNING: '#ffb547' } as const;

const sensorName = (f: Flag) => `${f.sensor === 'S1' ? 'Sentinel-1' : f.sensor} ${f.track.split('/')[0]}`;

/** Act 6: the detector's flags on a timeline, the first confirmed ALERT, and honest phases. */
export function AlertCard({ className }: { className?: string }) {
  const alerts = useAlerts();
  const level = useAppStore((s) => s.level);
  const setDate = useAppStore((s) => s.setDate);
  const [sel, setSel] = useState<Flag | null>(null);

  const model = useMemo(() => {
    if (!alerts.data) return null;
    const flags = flagsOf(alerts.data);
    const evals = alerts.data.evaluations;
    const phases = phaseFlags(flags, FAILURE_DATE);
    // flags dated on the failure day itself come from the 17:20 UTC pass, before the ~21:15 failure
    const before = flags.filter((f) => f.date <= FAILURE_DATE);
    const after = flags.filter((f) => f.date > FAILURE_DATE);
    const first = firstConfirmedAlert(after);
    const firstNisar = after.find((f) => f.sensor === 'NISAR') ?? null;
    const t0 = Math.min(...evals.map((e) => dayMs(e.date)));
    const t1 = Math.max(...evals.map((e) => dayMs(e.date)));
    return {
      flags,
      before,
      drawdown: phases.drawdown,
      later: phases.later,
      first,
      firstNisar,
      checksBefore: evals.filter((e) => e.date <= FAILURE_DATE).length,
      t0,
      t1,
    };
  }, [alerts.data]);

  if (alerts.isPending) return <DataState kind="loading" subject="Alerts" minHeight={220} className={className} />;
  if (alerts.isError || !model || !alerts.data)
    return (
      <DataState
        kind={alerts.isError ? dataStateForError(alerts.error).kind : 'missing'}
        subject="Alerts"
        message="This layer could not be loaded."
        className={cn('pointer-events-auto', className)}
      />
    );

  const { first, firstNisar, t0, t1 } = model;
  const pos = (d: string) => ((dayMs(d) - t0) / (t1 - t0 || 1)) * 100;
  const shown = sel ?? first?.flag ?? null;

  return (
    <Panel
      label="Automatic alert"
      badge={<Badge {...provenanceProps(alerts.data)} subject="Anomaly detector" />}
      right={
        first ? (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-pill border border-danger/50 bg-danger/10 px-2.5 font-mono text-[10px] font-semibold uppercase tracking-badge text-[#ff8a8a]">
            <span aria-hidden className="size-1.5 rounded-full bg-danger" /> Alert · {fmtDay(first.flag.date)}
          </span>
        ) : null
      }
      className={className}
    >
      {first ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="border-l border-hairline pl-3">
            <p className="telemetry-label">First alert</p>
            <p className="mt-1.5 font-mono text-[24px] leading-none text-ink">{fmtDay(first.flag.date)}</p>
            <p className="mt-1 font-mono text-[10.5px] text-mute">
              +{daysBetween(FAILURE_DATE, first.flag.date)} days after the failure
            </p>
          </div>
          <div className="border-l border-hairline pl-3">
            <p className="telemetry-label">Fired by</p>
            <p className="mt-1.5 font-mono text-[15px] leading-tight text-ink">{sensorName(first.flag)}</p>
            <p className="mt-1 font-mono text-[10.5px] text-mute">{fmtSigned(first.flag.departurePct, 1)}% vs 21-day normal</p>
          </div>
          <div className="border-l border-hairline pl-3">
            <p className="telemetry-label">Confirmed by</p>
            {first.confirmedBy ? (
              <>
                <p className="mt-1.5 font-mono text-[15px] leading-tight text-ink">{sensorName(first.confirmedBy)}</p>
                <p className="mt-1 font-mono text-[10.5px] text-mute">
                  {fmtSigned(first.confirmedBy.departurePct, 1)}% · {fmtDay(first.confirmedBy.date)}
                </p>
              </>
            ) : (
              <p className="mt-1.5 font-mono text-[13px] text-mute">no independent pass</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-mute">No confirmed alert in this series.</p>
      )}

      {/* timeline of flags */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className="telemetry-label">Every flag, {fmtDay(alerts.data.evaluations[0]!.date)} → {fmtDay(new Date(t1).toISOString())}</p>
          <p className="font-mono text-[10px] text-mute">{model.flags.length} flags · {alerts.data.evaluations.length} checks</p>
        </div>
        <div className="relative mt-3 h-12" role="group" aria-label="Detector flags by date">
          <div className="absolute inset-x-0 top-[22px] h-px bg-ink/15" aria-hidden />
          {/* phases */}
          <div
            aria-hidden
            className="absolute top-[14px] h-[17px] rounded-sm bg-ok/[.07]"
            style={{ left: 0, width: `${pos(FAILURE_DATE)}%` }}
          />
          <div
            aria-hidden
            className="absolute top-[14px] h-[17px] rounded-sm bg-ink/[.05]"
            style={{ left: `${pos('2026-08-01')}%`, right: 0 }}
          />
          {/* failure marker */}
          <div aria-hidden className="absolute top-1 h-9 w-px bg-ink/60" style={{ left: `${pos(FAILURE_DATE)}%` }} />
          <span
            aria-hidden
            className="absolute -top-1 -translate-x-1/2 font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink/70"
            style={{ left: `${pos(FAILURE_DATE)}%` }}
          >
            failure
          </span>
          {model.flags.map((f) => {
            const active = shown === f;
            return (
              <button
                key={`${f.date}-${f.track}`}
                type="button"
                onClick={() => {
                  setSel(f);
                  setDate(f.date);
                }}
                aria-label={`${fmtDay(f.date)}: ${f.level} from ${sensorName(f)}, ${fmtSigned(f.departurePct, 1)}%`}
                aria-pressed={active}
                className="absolute top-[15px] -translate-x-1/2 rounded-full p-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                style={{ left: `${pos(f.date)}%` }}
              >
                <span
                  className={cn('block size-[9px] border', f.sensor === 'NISAR' ? 'rounded-full' : 'rounded-[2px]', active && 'scale-150')}
                  style={{
                    background: f.level === 'ALERT' ? LEVEL_COLOR.ALERT : 'transparent',
                    borderColor: LEVEL_COLOR[f.level],
                  }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-[10px] leading-snug">
          <p className="text-ok">
            <CheckCircle2 className="mr-1 inline size-3 align-[-2px]" aria-hidden />
            Before: {model.before.length} flags in {model.checksBefore} checks
          </p>
          <p className="text-ink/80">17 Jun–31 Jul: {model.drawdown.length} flags</p>
          <p className="text-alert">
            <AlertTriangle className="mr-1 inline size-3 align-[-2px]" aria-hidden />
            Aug–Nov: {model.later.length} · needs operator check
          </p>
        </div>
        <p className="mt-2 font-mono text-[10px] text-mute">
          ● NISAR · ■ Sentinel-1 · filled = confirmed ALERT (&lt; −20%) · outline = WARNING (&lt; −12%, or &lt; −20% unconfirmed)
          {firstNisar ? ` · first NISAR flag ${fmtDay(firstNisar.date)} (${firstNisar.track.split('/')[0]}, ${firstNisar.level}, ${fmtSigned(firstNisar.departurePct, 0)}%)` : ''}
        </p>
      </div>

      {shown ? (
        <p className="mt-3 border-t border-hairline pt-2.5 text-[12.5px] leading-relaxed text-ink/85" aria-live="polite">
          {level === 'experts' ? shown.text.experts : shown.text.everyone}
        </p>
      ) : null}
    </Panel>
  );
}
