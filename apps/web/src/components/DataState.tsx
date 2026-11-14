import { AlertTriangle, CircleSlash, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Loading / missing / error states for every data-driven component (docs/04 §6.2-L, §13).
 * Never render an empty chart: render this instead.
 */
export type DataStateKind = 'loading' | 'missing' | 'error';

export interface DataStateProps {
  kind: DataStateKind;
  /** What is being loaded or is missing, e.g. "Lake area series". */
  subject?: string;
  /** Why it is missing, e.g. "SWOT has not observed this lake on these dates." */
  message?: ReactNode;
  onRetry?: () => void;
  className?: string;
  /** Height of the loading skeleton, to keep layout stable. */
  minHeight?: number;
}

export function DataState({ kind, subject, message, onRetry, className, minHeight = 96 }: DataStateProps) {
  if (kind === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('relative overflow-hidden rounded-card border border-hairline bg-ink/[.03]', className)}
        style={{ minHeight }}
      >
        <span className="sr-only">Loading{subject ? ` ${subject}` : ''}…</span>
        <div
          aria-hidden
          className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-teal/[.06] to-transparent"
        />
        <div aria-hidden className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-pulse bg-teal shadow-[0_0_8px_var(--teal)]" />
        </div>
      </div>
    );
  }

  if (kind === 'missing') {
    return (
      <div
        role="note"
        className={cn('flex items-start gap-3 rounded-card border border-dashed border-mute/40 p-4 text-sm', className)}
      >
        <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-mute" />
        <div>
          <p className="font-mono text-[11px] uppercase tracking-kick text-mute">
            {subject ? `${subject} · ` : ''}Not available
          </p>
          <p className="mt-1 text-ink/90">{message ?? 'This data is not in the current bundle.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-card border border-alert/40 bg-alert/[.06] p-4 text-sm', className)}
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-alert" />
      <div className="flex-1">
        <p className="font-mono text-[11px] uppercase tracking-kick text-alert">
          {subject ? `${subject} · ` : ''}Error
        </p>
        <p className="mt-1 text-ink/90">{message ?? 'This layer could not be loaded.'}</p>
        {onRetry ? (
          <Button size="sm" className="mt-3" onClick={onRetry}>
            <RotateCw aria-hidden /> Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
