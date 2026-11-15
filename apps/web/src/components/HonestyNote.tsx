import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Disclosure footer (rule: "uncertainty is drawn, not hidden"): an outlined pill naming what the
 * view is ("SCENARIO · NOT A FORECAST", "RESEARCH-BASED RECONSTRUCTION"), then 2–3 short lines
 * with limits and sources.
 *  - `caution` (amber): scenarios, reconstructions, illustrative views.
 *  - `info` (teal): measured views with a method caveat.
 */
export type HonestyKind = 'caution' | 'info';

export interface HonestyNoteProps {
  kind?: HonestyKind;
  label: string;
  children?: ReactNode;
  className?: string;
}

const PILL: Record<HonestyKind, string> = {
  caution: 'border-alert/60 text-alert',
  info: 'border-teal/50 text-teal',
};

export function HonestyNote({ kind = 'caution', label, children, className }: HonestyNoteProps) {
  return (
    <aside aria-label={label} className={cn('max-w-prose', className)}>
      <p
        className={cn(
          'inline-flex h-6 items-center rounded-pill border px-3 font-mono text-[10.5px] font-semibold uppercase leading-none tracking-badge',
          PILL[kind],
        )}
      >
        {label}
      </p>
      {children ? (
        <div className="mt-2.5 text-[11px] leading-[1.6] text-mute [&_a]:text-teal">{children}</div>
      ) : null}
    </aside>
  );
}
