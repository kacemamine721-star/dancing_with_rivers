import { CheckCircle, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/Badge';
import { useAlerts } from '@/data/hooks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

export function AlertCard({ className }: { className?: string }) {
  const alertsQuery = useAlerts();
  const level = useAppStore((s) => s.level);
  const isExpert = level === 'experts';

  // Find the historic 22 June evaluation
  const alertEvaluation = alertsQuery.data?.evaluations.find(
    (ev) => ev.date === '2026-06-22' && ev.level === 'ALERT',
  ) ?? alertsQuery.data?.evaluations.find((ev) => ev.level === 'ALERT') ?? null;

  return (
    <div
      className={cn(
        'glass pointer-events-auto rounded-xl border border-alert/30 bg-[rgba(18,12,6,.92)] p-4 shadow-2xl backdrop-blur-md',
        className,
      )}
    >
      {/* Alert Header */}
      <div className="flex items-center justify-between border-b border-alert/20 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-full bg-alert/20 text-alert animate-pulse">
            <ShieldAlert className="size-4" />
          </div>
          <div>
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-alert">
              AUTOMATIC ALARM
            </span>
            <span className="ml-2 font-mono text-[11px] text-mute">22 JUNE 2026</span>
          </div>
        </div>

        <Badge
          kind="modelled"
          source="Harmonised 21-day baseline detector"
          subject="Anomaly Rule"
        />
      </div>

      {/* Main Alert Body */}
      <div className="mt-3">
        <p className="text-[13.5px] leading-relaxed text-[#f3e3ce]">
          {isExpert && alertEvaluation
            ? alertEvaluation.text.experts
            : alertEvaluation?.text.everyone ??
              'NISAR and Sentinel-1 together would have raised an alarm on 22 June, five days after the failure, with no ground sensor.'}
        </p>
      </div>

      {/* Telemetry Grid */}
      <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-alert/15 pt-3">
        <div className="rounded border border-alert/15 bg-black/40 p-2 text-center">
          <p className="font-mono text-[9.5px] uppercase tracking-wider text-mute">Drop</p>
          <p className="font-mono text-base font-bold text-danger">−21.2%</p>
        </div>
        <div className="rounded border border-alert/15 bg-black/40 p-2 text-center">
          <p className="font-mono text-[9.5px] uppercase tracking-wider text-mute">Pass</p>
          <p className="font-mono text-xs font-semibold text-ink">S1 o161</p>
        </div>
        <div className="rounded border border-alert/15 bg-black/40 p-2 text-center">
          <p className="font-mono text-[9.5px] uppercase tracking-wider text-mute">Confirmed By</p>
          <p className="font-mono text-xs font-semibold text-teal">S1 o88</p>
        </div>
      </div>

      {/* Validation Note */}
      <div className="mt-3 flex items-center justify-between rounded bg-white/[0.04] px-2.5 py-1.5 text-[10.5px] font-mono text-mute">
        <span className="flex items-center gap-1.5 text-ok">
          <CheckCircle className="size-3 text-ok" /> 0 false alarms before failure
        </span>
        <span className="text-mute/80">6-day confirmation window</span>
      </div>
    </div>
  );
}
