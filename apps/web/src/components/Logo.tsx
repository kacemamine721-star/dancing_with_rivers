import { useId } from 'react';

import { BRAND, splitWordmark } from '@/brand';
import { cn } from '@/lib/utils';

/**
 * Brand mark (15 Nov redesign, public/brand/dwr-mark.svg): two rounded hills — the valley a dam
 * closes — with the river cut out of them as an S, flowing into two "dancing" waves.
 * `currentColor` drives the colour, so it works in ultramarine on cream and cream on dark.
 * The waves drift when `animated` (off under reduced motion via .dwr-waves in globals.css).
 */
export function LogoMark({ className, title, animated = false }: { className?: string; title?: string; animated?: boolean }) {
  const decorative = !title;
  const id = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 120 120"
      className={cn('shrink-0 text-teal', className)}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <mask id={`r${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          <rect width="120" height="120" fill="#fff" />
          <path d="M68.5 62 C58 69 74 75 64 81 C58.5 84.5 62 88 57 92" fill="none" stroke="#000" strokeWidth="6.5" strokeLinecap="round" />
        </mask>
        <linearGradient id={`f${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".12" stopColor="#fff" />
          <stop offset=".88" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`w${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          {animated ? (
            <>
              <rect x="10" y="88" width="100" height="16" fill={`url(#f${id})`} />
              <rect x="28" y="102" width="64" height="16" fill={`url(#f${id})`} />
            </>
          ) : (
            <rect width="120" height="120" fill="#fff" />
          )}
        </mask>
      </defs>
      <g mask={`url(#r${id})`} fill="currentColor" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
        <path d="M16 86 L48 30 L80 86 Z" />
        <path d="M56 86 L80 46 L104 86 Z" />
      </g>
      <g mask={`url(#w${id})`}>
        <g className={animated ? 'dwr-waves' : undefined} fill="none" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round">
          <path d={animated ? 'M-21 100 q9 -6 18 0 t18 0 t18 0 t18 0 t18 0 t18 0 t18 0 t18 0' : 'M15 100 q9 -6 18 0 t18 0 t18 0 t18 0 t18 0'} />
          <path d={animated ? 'M-3 111 q9 -6 18 0 t18 0 t18 0 t18 0 t18 0' : 'M33 111 q9 -6 18 0 t18 0 t18 0'} opacity=".55" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Mark + stacked wordmark read from BRAND.product ("Dancing with the" small tracked mono over
 * "Rivers" in Bowlby One). `tone`: ultramarine on light pages, cream on the dark intro.
 */
export function Lockup({
  size = 'sm',
  tone = 'blue',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'blue' | 'cream';
  className?: string;
}) {
  const [lead, accent] = splitWordmark(BRAND.product);
  const color = tone === 'cream' ? 'text-[#f4f0e6]' : 'text-teal';
  return (
    <span className={cn('inline-flex items-center gap-2.5', color, className)}>
      <LogoMark
        animated={size !== 'sm'}
        className={cn(
          color,
          size === 'sm' && 'size-[44px]',
          size === 'md' && 'size-[76px]',
          size === 'lg' && 'size-[clamp(92px,10vw,144px)]',
        )}
      />
      <span
        className={cn(
          'flex flex-col font-display leading-[0.92] tracking-[0.01em]',
          size === 'lg' && tone === 'cream' && '[text-shadow:0_4px_30px_rgba(0,0,0,.6)]',
        )}
      >
        {accent ? (
          <span
            className={cn(
              'font-mono font-semibold uppercase tracking-[0.2em] opacity-85',
              size === 'sm' && 'text-[9.5px]',
              size === 'md' && 'text-[14px]',
              size === 'lg' && 'text-[clamp(13px,1.5vw,20px)]',
            )}
          >
            {lead.trim()}
          </span>
        ) : null}
        {/* keeps the accessible text "Dancing with the Rivers" (not "theRivers") for the home link name */}
        {accent ? ' ' : null}
        <span
          className={cn(
            size === 'sm' && 'text-[22px]',
            size === 'md' && 'text-[38px]',
            size === 'lg' && 'text-[clamp(40px,5.6vw,76px)]',
          )}
        >
          {accent || lead}
        </span>
      </span>
    </span>
  );
}
