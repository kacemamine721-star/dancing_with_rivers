import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface StatProps {
  /** Uppercase tracked label, e.g. "Released volume". */
  label: string;
  /** The number, already formatted (Intl) and read from the bundle — never typed into copy by hand. */
  value: ReactNode;
  /** Unit after the value, e.g. "Mm³", "%". */
  unit?: string;
  /** One plain line under the value. */
  sub?: ReactNode;
  /** A `<Badge>` aligned with the label on the right. */
  badge?: ReactNode;
  /** Optional thin progress bar, 0..1. */
  progress?: number;
  /** Accessible description of the progress bar (defaults to the label). */
  progressLabel?: string;
  /** Hide the hairline divider (e.g. last item of a list). */
  divider?: boolean;
  className?: string;
}

/** Big-number readout: label + badge, large mono value with a muted unit, one sub line, hairline divider. */
export function Stat({
  label,
  value,
  unit,
  sub,
  badge,
  progress,
  progressLabel,
  divider = true,
  className,
}: StatProps) {
  const pct = progress === undefined ? undefined : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className={cn('py-5', divider && 'border-b border-hairline', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-badge text-mute">{label}</p>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      <p className="mt-2 flex items-baseline gap-2 font-mono leading-none text-ink">
        <span className="text-[clamp(40px,4.6vw,64px)] font-normal tabular-nums tracking-[-0.02em]">{value}</span>
        {unit ? <span className="text-[clamp(15px,1.4vw,19px)] text-mute">{unit}</span> : null}
      </p>
      {pct !== undefined ? (
        <div
          role="progressbar"
          aria-label={progressLabel ?? label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-3 h-[3px] w-full overflow-hidden rounded-pill bg-ink/10"
        >
          <div
            className="h-full rounded-pill bg-teal shadow-[0_0_8px_rgba(26,34,180,.6)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {sub ? <p className="mt-2.5 text-sm text-ink/80">{sub}</p> : null}
    </div>
  );
}
