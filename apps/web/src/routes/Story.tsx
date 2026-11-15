import { AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { actEntryPatch } from '@/features/story/actions';
import { ActCard } from '@/features/story/ActCard';
import { ACT_CONFIGS } from '@/features/story/acts';
import { AlertCard } from '@/features/story/AlertCard';
import { ReservoirChart } from '@/features/story/ReservoirChart';
import { ScenarioPanel } from '@/features/story/ScenarioPanel';
import { SwipeHandle } from '@/features/story/SwipeHandle';
import { TimeScrubber } from '@/features/story/TimeScrubber';
import type { WidgetId } from '@/features/story/types';
import { useFacts } from '@/features/story/useStoryData';
import { CatchmentCard, CorridorStrip, LevelVolumeCard } from '@/features/story/Widgets';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { NotFoundContent } from '@/routes/NotFound';
import { parseUrl } from '@/store/useUrlSync';
import { isAct, useAppStore } from '@/store/app';

const WIDGETS: Record<WidgetId, () => JSX.Element> = {
  swipe: () => <SwipeHandle />,
  scrubber: () => <TimeScrubber />,
  reservoirChart: () => <ReservoirChart />,
  corridor: () => <CorridorStrip />,
  alerts: () => <AlertCard />,
  scenario: () => <ScenarioPanel />,
  levelVolume: () => <LevelVolumeCard />,
  catchment: () => <CatchmentCard />,
};

export function Component() {
  const { act: actParam } = useParams();
  const n = Number(actParam);
  const valid = isAct(n);
  const navigate = useNavigate();
  const location = useLocation();
  const config = valid ? ACT_CONFIGS[n] : null;
  const facts = useFacts();
  const firstEntry = useRef(true);

  useDocumentTitle(config ? `${config.kicker} · ${config.title}` : 'Not found');

  // Apply the act's stage on entry. On the first (deep-link) load the URL query wins over the defaults.
  useEffect(() => {
    if (!config) return;
    const s = useAppStore.getState();
    const patch = actEntryPatch(config);
    if (firstEntry.current && location.search) {
      const url = parseUrl(location.pathname, location.search);
      s.hydrate({ ...patch, ...url, layers: { ...patch.layers, ...url.layers } });
    } else {
      s.hydrate(patch);
    }
    firstEntry.current = false;
    s.setShot(config.stage.shot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    if (!valid) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName) || t.getAttribute('role') === 'slider'))
        return;
      if (e.key === 'ArrowRight' && n < 9) navigate(`/story/${n + 1}`);
      else if (e.key === 'ArrowLeft' && n > 1) navigate(`/story/${n - 1}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [valid, n, navigate]);

  if (!config) return <NotFoundContent />;

  return (
    // the page is click-through (the 3D view stays draggable); only cards and widgets take pointer events
    <div className="pointer-events-none relative min-h-[calc(100svh-62px)] w-full">
      <div
        className={
          'fixed inset-x-0 bottom-0 max-h-[50svh] overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin] ' +
          'md:static md:mx-auto md:flex md:max-h-none md:max-w-[1600px] md:items-end md:justify-between md:gap-6 md:overflow-visible md:p-6 lg:p-8'
        }
      >
        <div className="pointer-events-auto w-full md:max-w-[460px]">
          <AnimatePresence mode="wait">
            <ActCard key={config.act} config={config} facts={facts} />
          </AnimatePresence>
        </div>
        {config.widgets.length > 0 ? (
          <div className="pointer-events-auto mt-3 flex w-full flex-col gap-3 md:mt-0 md:max-w-[580px]">
            {config.widgets.map((w) => {
              const W = WIDGETS[w];
              return <W key={w} />;
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
