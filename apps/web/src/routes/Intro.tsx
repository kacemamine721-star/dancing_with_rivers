import { ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { BRAND } from '@/brand';
import { Lockup } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAppStore } from '@/store/app';

/**
 * `/` — placeholder hero until scene-3d lands the cinematic intro (src/features/intro, M3).
 * Deep links (/story/:act…) skip the intro entirely.
 */
export function Component() {
  useDocumentTitle();
  const setMode = useAppStore((s) => s.setMode);
  useEffect(() => setMode('intro'), [setMode]);

  return (
    <section
      aria-labelledby="intro-title"
      className="relative flex min-h-[100svh] flex-col items-start justify-end gap-6 bg-[radial-gradient(ellipse_at_50%_0%,#0a1624_0%,#03050a_60%)] px-4 pb-[12vh] sm:px-[8vw]"
    >
      <p className="kicker">Space Apps 2026 · {BRAND.project}</p>
      <h1 id="intro-title">
        <Lockup size="lg" />
      </h1>
      <p className="max-w-xl text-lg leading-relaxed text-ink/85">
        On the night of 17 to 18 June 2026 a gate failed at Tunisia&rsquo;s Mellègue dam. Follow the radar that watched
        the lake drain.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" asChild>
          <Link to="/story/1">
            Start the mission <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button asChild>
          <Link to="/watch">Dam Watch</Link>
        </Button>
      </div>
    </section>
  );
}
