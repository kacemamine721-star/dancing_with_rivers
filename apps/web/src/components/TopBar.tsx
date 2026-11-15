import { Link, NavLink } from 'react-router-dom';

import { LevelSwitch } from '@/components/LevelSwitch';
import { Lockup } from '@/components/Logo';
import { BRAND } from '@/brand';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/story/1', label: 'Story' },
  { to: '/watch', label: 'Dam Watch' },
  { to: '/methods', label: 'Methods' },
  { to: '/sources', label: 'Sources' },
  { to: '/your-dam', label: 'Your dam' },
] as const;

/**
 * Prototype `#topbar`: 62 px, dark glass, hairline bottom. Placeholder for M1; ActRail,
 * section name and the loading progress line arrive with the story (M4).
 */
export function TopBar({ section, className }: { section?: string; className?: string }) {
  return (
    <header
      data-testid="topbar"
      className={cn(
        'sticky top-0 z-30 flex h-[62px] items-center gap-4 border-b border-white/[.06] bg-[rgba(3,5,10,.82)] px-4 backdrop-blur-[10px] sm:px-5',
        className,
      )}
    >
      <Link to="/" aria-label={`${BRAND.product}: home`} className="rounded-pill">
        <Lockup size="sm" />
      </Link>
      <p className="hidden flex-1 truncate text-center font-mono text-[11px] uppercase tracking-kick text-mute md:block">
        {section ?? BRAND.tagline}
      </p>
      <nav aria-label="Main" className="ml-auto flex items-center gap-1 md:ml-0">
        <ul className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-pill px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-btn no-underline transition-colors duration-ui',
                    isActive ? 'text-teal' : 'text-mute hover:text-ink',
                  )
                }
              >
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <LevelSwitch />
    </header>
  );
}
