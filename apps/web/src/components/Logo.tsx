import { BRAND, splitWordmark } from '@/brand';
import { cn } from '@/lib/utils';

/**
 * Brand mark, copied from the prototype's `#hsLogo` symbol
 * (reference/NISAR-HydroStress-Cinematic-Intro.html). Satellite + radar arcs + ripples + pink
 * dancer. `currentColor` drives the satellite body; arcs pulse via `.logo-arcs` (globals.css).
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const decorative = !title;
  return (
    <svg
      viewBox="0 0 200 200"
      className={cn('shrink-0 text-ink', className)}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={title}
      focusable="false"
    >
      <g fill="none" stroke="#5ff3ff" strokeLinecap="round" className="logo-arcs">
        <path d="M141 36 A30 30 0 0 0 128 62" strokeWidth="5" />
        <path d="M137 22 A46 46 0 0 0 114 70" strokeWidth="5" opacity=".7" />
        <path d="M133 8 A62 62 0 0 0 100 78" strokeWidth="5" opacity=".45" />
      </g>
      <g transform="translate(170 24) rotate(-35)">
        <ellipse rx="22" ry="7" fill="none" stroke="currentColor" strokeWidth="4" />
        <path d="M0 7 L0 17" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <rect x="-8" y="16" width="16" height="11" rx="2" fill="#e7b13c" />
      </g>
      <g fill="none" stroke="#5ff3ff" strokeLinecap="round" strokeWidth="4">
        <ellipse cx="118" cy="182" rx="18" ry="4.5" />
        <ellipse cx="118" cy="182" rx="36" ry="8.5" opacity=".6" />
        <ellipse cx="118" cy="182" rx="56" ry="12.5" opacity=".3" />
      </g>
      <g stroke="#ff5c93" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M116 140 L116 181" strokeWidth="5" />
        <path d="M124 140 L136 158 L117 162" strokeWidth="5" />
        <path d="M98 116 C80 108 70 92 77 78 C84 64 98 60 92 47 C87 37 72 36 66 46" strokeWidth="11" />
      </g>
      <path
        d="M92 118 C96 96 134 88 156 100 C170 108 176 118 170 124 C160 133 140 142 120 142 C104 142 92 132 92 118 Z"
        fill="#ff5c93"
      />
      <path d="M112 112 C126 102 148 104 158 114" fill="none" stroke="#c23a6b" strokeWidth="5" strokeLinecap="round" />
      <circle cx="68" cy="46" r="9" fill="#ff5c93" />
      <path d="M61 42 L51 49 C47 56 51 63 57 64 L58 55 Z" fill="currentColor" />
      <circle cx="69" cy="43" r="2.2" fill="#03050a" />
    </svg>
  );
}

/** Prototype `.lockup`: mark + stacked wordmark read from BRAND.product (small lead line, Bowlby One accent). */
export function Lockup({ size = 'sm', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const [lead, accent] = splitWordmark(BRAND.product);
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark
        className={cn(
          size === 'sm' && 'size-[42px]',
          size === 'md' && 'size-[72px]',
          size === 'lg' && 'size-[clamp(90px,10vw,140px)]',
        )}
      />
      <span
        className={cn(
          'flex flex-col font-display leading-[0.92] tracking-[0.01em] text-ink',
          size === 'lg' && '[text-shadow:0_4px_30px_rgba(0,0,0,.6)]',
        )}
      >
        {/* two lines: a small tracked lead ("Dancing with the") over the accent word ("Rivers") */}
        {accent ? (
          <span
            className={cn(
              'font-mono font-semibold uppercase tracking-[0.2em] text-ink/85',
              size === 'sm' && 'text-[9.5px]',
              size === 'md' && 'text-[14px]',
              size === 'lg' && 'text-[clamp(13px,1.5vw,20px)]',
            )}
          >
            {lead.trim()}
          </span>
        ) : null}
        <span
          className={cn(
            accent ? 'text-teal' : 'text-ink',
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
