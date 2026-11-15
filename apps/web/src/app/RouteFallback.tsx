import { LogoMark } from '@/components/Logo';

/** Thin teal progress line under the TopBar while a route chunk loads (docs/04 §13). */
export function RouteFallback() {
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 top-[62px] z-40 h-0.5 overflow-hidden">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="h-full w-1/3 animate-pulse bg-teal shadow-[0_0_8px_var(--teal)]" />
    </div>
  );
}

/** First paint while the router resolves the first lazy route (prototype `#loader`). */
export function BootFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-bg font-mono text-xs uppercase tracking-[0.3em] text-teal"
    >
      <LogoMark className="size-[110px]" animated />
      <span>Acquiring signal</span>
    </div>
  );
}
