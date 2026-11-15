import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';
import type { ActConfig } from './types';

interface ActCardProps {
  config: ActConfig;
  className?: string;
}

export function ActCard({ config, className }: ActCardProps) {
  const level = useAppStore((s) => s.level);
  const isExpert = level === 'experts';  const [expertOpen, setExpertOpen] = useState(false);

  return (
    <section
      aria-labelledby="act-title"
      className={cn(
        'glass w-full max-w-[480px] rounded-[16px] border border-white/10 bg-[rgba(6,12,20,.88)] p-6 shadow-2xl backdrop-blur-xl',
        className,
      )}
    >
      {/* Header: Kicker + Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-teal">
          {config.kicker}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {config.badges.map((b, i) => (
            <Badge key={i} {...b} />
          ))}
        </div>
      </div>

      {/* Title */}
      <h2
        id="act-title"
        className="mt-3 text-[clamp(22px,2.2vw,28px)] font-bold leading-tight tracking-tight text-ink"
      >
        <span className="sr-only">Act {config.act} · </span>
        {config.title}
      </h2>

      {/* Narrative Body */}
      <p className="mt-3 text-[14.5px] leading-[1.65] text-[#d6e0ee]">{config.body}</p>

      {/* Expert Mode Section */}
      {isExpert && (
        <div className="mt-4 rounded-lg border border-teal/20 bg-teal/[0.04] p-3 text-xs">
          <button
            type="button"
            onClick={() => setExpertOpen(!expertOpen)}
            className="flex w-full items-center justify-between font-mono font-semibold uppercase tracking-wider text-teal hover:text-white"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3 text-teal" /> Advanced · Technical Details
            </span>
            {expertOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>

          {expertOpen && (
            <div className="mt-3 space-y-3 pt-2 text-mute border-t border-teal/15">
              <p className="leading-relaxed text-[#c2d3eb]">{config.expertBody}</p>

              {config.expertStats && config.expertStats.length > 0 && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {config.expertStats.map((st, i) => (
                    <div key={i} className="rounded border border-white/5 bg-black/40 p-2">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-mute">{st.label}</p>
                      <p className="font-mono text-base font-semibold text-ink">
                        {st.value}{' '}
                        {st.unit ? <span className="text-xs text-mute font-normal">{st.unit}</span> : null}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Try It Actions */}
      {config.tryIt && config.tryIt.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-mute">Try it:</span>
          {config.tryIt.map((act, i) => (
            <Button key={i} size="xs" variant="chip" onClick={act.action}>
              {act.label}
            </Button>
          ))}
        </div>
      )}

      {/* Footer Navigation */}
      <nav aria-label="Story Acts Navigation" className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
        {config.act > 1 ? (
          <Button size="sm" variant="ghost" asChild>
            <Link to={`/story/${config.act - 1}`}>
              <ArrowLeft className="mr-1 size-3.5" aria-hidden /> Act {config.act - 1}
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" asChild>
            <Link to="/?intro=1">Intro</Link>
          </Button>
        )}

        <span className="font-mono text-[11px] text-mute">
          {config.act} of 9
        </span>

        {config.act < 9 ? (
          <Button size="sm" variant="primary" asChild>
            <Link to={`/story/${config.act + 1}`}>
              Act {config.act + 1} <ArrowRight className="ml-1 size-3.5" aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="primary" asChild>
            <Link to="/watch">Open Dam Watch</Link>
          </Button>
        )}
      </nav>
    </section>
  );
}
