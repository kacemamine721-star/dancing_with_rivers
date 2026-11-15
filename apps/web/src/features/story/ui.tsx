import type { ReactNode } from 'react';

import { Badge } from '@/components/Badge';
import { cn } from '@/lib/utils';

import type { Fact } from './facts';

/** Glass widget with a telemetry header (label · badge · right slot). */
export function Panel({
  label,
  badge,
  right,
  children,
  className,
  labelId,
}: {
  label: string;
  badge?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  labelId?: string;
}) {
  return (
    <section aria-labelledby={labelId} className={cn('panel pointer-events-auto p-4 text-ink', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 id={labelId} className="telemetry-label !text-teal">
            {label}
          </h3>
          {badge}
        </div>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </header>
      <div className="pt-3">{children}</div>
    </section>
  );
}

/** Compact fact tile: tracked label + badge, big mono numeral with a small unit. */
export function FactTile({ fact, className }: { fact: Fact | undefined; className?: string }) {
  if (!fact) {
    return (
      <div className={cn('min-w-0 border-l border-hairline pl-3', className)} aria-busy="true">
        <p className="telemetry-label">Loading…</p>
        <p className="mt-1.5 font-mono text-[22px] leading-none text-mute">…</p>
      </div>
    );
  }
  return (
    <div className={cn('min-w-0 border-l border-hairline pl-3', className)}>
      <div className="flex items-center justify-between gap-1.5">
        <p className="telemetry-label truncate" title={fact.label}>
          {fact.label}
        </p>
      </div>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 font-mono leading-none text-ink">
        <span className="text-[22px] tabular-nums tracking-[-0.02em]">{fact.value}</span>
        {fact.unit ? <span className="text-[11px] text-mute">{fact.unit}</span> : null}
      </p>
      <div className="mt-2">
        <Badge {...fact.badge} className="h-[18px] px-1.5 text-[9px]" />
      </div>
    </div>
  );
}

