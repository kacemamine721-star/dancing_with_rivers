import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import { applyActions } from './actions';
import { ACT_LIST } from './acts';
import { fillTemplate, type Facts } from './facts';
import type { ActConfig, TryIt } from './types';
import { useBadgeSpecs } from './badges';
import { FactTile } from './ui';

interface ActCardProps {
  config: ActConfig;
  facts: Facts;
  className?: string;
}

/** Act progress rail: one dot per act, title on hover/focus, the current act highlighted. */
export function ActRail({ current }: { current: number }) {
  return (
    <ol aria-label="Story progress" className="flex items-center gap-1.5">
      {ACT_LIST.map((a) => {
        const active = a.act === current;
        const done = a.act < current;
        return (
          <li key={a.act}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to={`/story/${a.act}`}
                  aria-label={`Act ${a.act}: ${a.short}`}
                  aria-current={active ? 'step' : undefined}
                  className="group flex h-6 items-center px-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'block h-1.5 rounded-pill transition-all duration-ui group-hover:brightness-150',
                      active ? 'w-5 shadow-[0_0_8px_rgba(26,34,180,.7)]' : 'w-1.5',
                    )}
                    style={{
                      background: active ? '#1a22b4' : done ? 'rgba(26,34,180,.6)' : 'rgba(16,19,107,.3)',
                    }}
                  />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top" className="font-mono text-[11px] uppercase tracking-[0.12em]">
                {a.act} · {a.short}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
}

export function ActCard({ config, facts, className }: ActCardProps) {
  const level = useAppStore((s) => s.level);
  const reduced = useReducedMotion() || useAppStore.getState().reducedMotion;
  const experts = level === 'experts';
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const badges = useBadgeSpecs(config.badges);

  const run = (t: TryIt) => applyActions(t.actions, useAppStore.getState(), navigate);
  const factIds = experts ? [...config.facts, ...(config.expertFacts ?? [])] : config.facts;

  return (
    <motion.section
      aria-labelledby="act-title"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
      transition={{ duration: reduced ? 0.15 : 0.45, ease: [0.65, 0, 0.35, 1] }}
      className={cn('panel pointer-events-auto w-full p-5 text-ink sm:p-6', className)}
      data-testid="act-card"
    >
      <div className="flex items-start justify-between gap-3 border-b border-hairline pb-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-kick text-teal">{config.kicker}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {badges.map((b, i) => (
              <Badge key={i} {...b} />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="act-card-body"
          className="shrink-0 rounded-pill border border-ink/15 p-1.5 text-mute hover:border-teal hover:text-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal md:hidden"
        >
          <ChevronDown className={cn('size-4 transition-transform', !open && 'rotate-180')} aria-hidden />
          <span className="sr-only">{open ? 'Collapse the story card' : 'Expand the story card'}</span>
        </button>
      </div>

      <h2 id="act-title" className="mt-3 text-[clamp(21px,2.1vw,27px)] font-bold leading-tight tracking-tight">
        <span className="sr-only">Act {config.act} · </span>
        {config.title}
      </h2>

      <div id="act-card-body" className={cn(!open && 'hidden md:block')}>
        <p className="mt-3 text-[14.5px] leading-[1.65] text-ink/85">{fillTemplate(config.body, facts)}</p>

        {factIds.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
            {factIds.map((id) => (
              <FactTile key={id} fact={facts[id]} />
            ))}
          </div>
        ) : null}

        {experts ? (
          <div className="mt-4 border-l-2 border-model/50 pl-3">
            <p className="telemetry-label !text-model">Experts</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink/85">{fillTemplate(config.expertBody, facts)}</p>
          </div>
        ) : null}

        {config.tryIt.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="telemetry-label">Try it</span>
            {config.tryIt.map((t) => (
              <Button key={t.label} size="xs" variant="chip" onClick={() => run(t)} title={t.hint}>
                {t.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <nav
        aria-label="Story acts"
        className="mt-5 flex items-center justify-between gap-2 border-t border-hairline pt-4"
      >
        {config.act > 1 ? (
          <Button size="sm" variant="ghost" asChild>
            <Link to={`/story/${config.act - 1}`}>
              <ArrowLeft aria-hidden /> Act {config.act - 1}
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" asChild>
            <Link to="/?intro=1">Intro</Link>
          </Button>
        )}

        <ActRail current={config.act} />

        {config.act < 9 ? (
          <Button size="sm" variant="primary" asChild>
            <Link to={`/story/${config.act + 1}`}>
              Act {config.act + 1} <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="primary" asChild>
            <Link to="/watch">Dam Watch</Link>
          </Button>
        )}
      </nav>
    </motion.section>
  );
}
