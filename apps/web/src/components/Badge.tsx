import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import { BADGE_COPY, type BadgeKind, badgeKind, type ContractBadge } from '@/components/badge-model';

/**
 * Evidence badge (docs/04 §6.2-A): every layer and number carries one, with its source one click away.
 * Styled as a status pill: filled dot + uppercase mono label on a translucent tint of the badge colour.
 */

const PILL: Record<BadgeKind, string> = {
  measured: 'border-teal/35 bg-teal/10 text-teal',
  reported: 'border-ink/35 bg-ink/[.08] text-ink',
  modelled: 'border-model/40 bg-model/10 text-model',
  illustrative: 'border-dashed border-mute/50 bg-mute/[.08] text-mute',
};

const TEXT: Record<BadgeKind, string> = {
  measured: 'text-teal',
  reported: 'text-ink',
  modelled: 'text-model',
  illustrative: 'text-mute',
};

export type { BadgeKind, ContractBadge } from '@/components/badge-model';

export interface BadgeProps {
  kind: BadgeKind | ContractBadge;
  /** Dataset or report the value comes from. */
  source?: string;
  method?: string;
  uncertainty?: string;
  date?: string | null;
  /** Shown in Experts mode only. */
  productId?: string | null;
  /** Schema-valid placeholder from the fixture bundle: never a result. */
  placeholder?: boolean;
  /** Short context for the accessible name, e.g. "Lake area". */
  subject?: string;
  className?: string;
}

export function Badge({
  kind: kindIn,
  source,
  method,
  uncertainty,
  date,
  productId,
  placeholder = false,
  subject,
  className,
}: BadgeProps) {
  const kind = badgeKind(kindIn);
  const copy = BADGE_COPY[kind];
  const experts = useAppStore((s) => s.level === 'experts');
  const id = React.useId();

  const rows: Array<[string, string]> = [];
  if (source) rows.push(['Source', source]);
  if (date) rows.push(['Date', date]);
  if (method) rows.push(['Method', method]);
  if (uncertainty) rows.push(['Uncertainty', uncertainty]);
  if (experts && productId) rows.push(['Product ID', productId]);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex h-[22px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border px-2',
          'font-mono text-[10.5px] font-semibold uppercase leading-none tracking-badge',
          'transition-[filter] duration-ui hover:brightness-125',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
          PILL[kind],
          className,
        )}
        aria-label={`${copy.label}${subject ? `: ${subject}` : ''}. Show source and method`}
        data-badge={kind}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        <span aria-hidden>{copy.label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-labelledby={`${id}-title`}>
        <p
          id={`${id}-title`}
          className={cn('font-mono text-[11px] font-semibold uppercase tracking-badge', TEXT[kind])}
        >
          {copy.label}
        </p>
        <p className="mt-1 text-sm text-ink">{copy.meaning}</p>
        {placeholder ? (
          <p className="mt-2 rounded-[6px] border border-alert/40 bg-alert/10 px-2 py-1 text-xs text-alert">
            Placeholder: not a result. The pipeline output replaces it.
          </p>
        ) : null}
        {rows.length > 0 ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            {rows.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="font-mono uppercase tracking-[0.12em] text-mute">{k}</dt>
                <dd className="break-words text-ink">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-xs text-mute">No source recorded.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
