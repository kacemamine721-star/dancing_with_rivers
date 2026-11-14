import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ActCard } from '@/features/story/ActCard';
import { ACT_CONFIGS } from '@/features/story/acts';
import { AlertCard } from '@/features/story/AlertCard';
import { ImpactCounters } from '@/features/story/ImpactCounters';
import { ReservoirChart } from '@/features/story/ReservoirChart';
import { SwipeHandle } from '@/features/story/SwipeHandle';
import { TimeScrubber } from '@/features/story/TimeScrubber';
import type { ActConfig } from '@/features/story/types';
import { VolumeSlider } from '@/features/story/VolumeSlider';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { NotFoundContent } from '@/routes/NotFound';
import { isAct, useAppStore } from '@/store/app';

export function Component() {
  const { act: actParam } = useParams();
  const n = Number(actParam);
  const valid = isAct(n);
  const navigate = useNavigate();

  const setMode = useAppStore((s) => s.setMode);
  const setAct = useAppStore((s) => s.setAct);
  const setShot = useAppStore((s) => s.setShot);
  const setDate = useAppStore((s) => s.setDate);
  const setCompareDate = useAppStore((s) => s.setCompareDate);
  const setLayers = useAppStore((s) => s.setLayers);
  const setSwipe = useAppStore((s) => s.setSwipe);
  const setFlood = useAppStore((s) => s.setFlood);
  const toggleLayer = useAppStore((s) => s.toggleLayer);

  const config = valid ? ACT_CONFIGS[n] : null;

  useDocumentTitle(config ? `${config.kicker} · ${config.title}` : 'Not found');

  // Sync store state when act changes
  useEffect(() => {
    if (!valid || !config) return;

    setMode('story');
    setAct(config.act);

    // Apply default camera shot
    setShot(config.defaultShot);

    // Apply default layers
    if (config.defaultLayers) {
      setLayers(config.defaultLayers);
    }

    // Apply default acquisition date
    if (config.defaultDate) {
      setDate(config.defaultDate);
    }

    // Apply compareDate for swipe (Act 3)
    setCompareDate(config.compareDate ?? null);

    // Reset swipe to 0.5 for comparison acts
    if (config.compareDate) {
      setSwipe(0.5);
    }
  }, [valid, config, setMode, setAct, setShot, setLayers, setDate, setCompareDate, setSwipe]);

  // Keyboard navigation: Left / Right arrows
  useEffect(() => {
    if (!valid) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input or slider
      if (['INPUT', 'TEXTAREA', 'BUTTON'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'ArrowRight' && n < 9) {
        navigate(`/story/${n + 1}`);
      } else if (e.key === 'ArrowLeft' && n > 1) {
        navigate(`/story/${n - 1}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [valid, n, navigate]);

  // Augment config with interactive Try-It actions
  const enhancedConfig: ActConfig | null = useMemo(() => {
    if (!config) return null;

    let tryIt = config.tryIt ?? [];

    if (config.act === 1) {
      tryIt = [
        { label: 'Dam Close-up', action: () => setShot('dam_close') },
        { label: 'Downstream Valley', action: () => setShot('arrival') },
      ];
    } else if (config.act === 2) {
      tryIt = [
        { label: 'Replay 17 Jun', action: () => setDate('2026-06-17') },
        { label: 'Night Light', action: () => setShot('night_dam') },
      ];
    } else if (config.act === 3) {
      tryIt = [
        { label: 'Swipe 50%', action: () => setSwipe(0.5) },
        { label: 'Show 19 Jun', action: () => setDate('2026-06-19') },
        { label: 'Toggle Mask', action: () => toggleLayer('mask') },
      ];
    } else if (config.act === 4) {
      tryIt = [
        { label: 'Valley View', action: () => setShot('arrival') },
        { label: 'Toggle Villages', action: () => toggleLayer('villages') },
        { label: 'Toggle Cropland', action: () => toggleLayer('cropland') },
      ];
    } else if (config.act === 5) {
      tryIt = [
        { label: 'Pre-failure 17 Jun', action: () => setDate('2026-06-17') },
        { label: 'Repair 15 Jul', action: () => setDate('2026-07-15') },
        { label: 'Autumn Rain 29 Oct', action: () => setDate('2026-10-29') },
      ];
    } else if (config.act === 6) {
      tryIt = [
        { label: '22 June Alert Date', action: () => setDate('2026-06-22') },
        { label: 'Toggle Change Layer', action: () => toggleLayer('change') },
      ];
    } else if (config.act === 7) {
      tryIt = [
        { label: '21 Mm³ · June 2026', action: () => setFlood({ volumeM3: 21e6, scenarioId: 'v21_d12' }) },
        { label: '50 Mm³ Flood', action: () => setFlood({ volumeM3: 50e6, scenarioId: 'v50_d12' }) },
        { label: '195 Mm³ Full Dam', action: () => setFlood({ volumeM3: 195e6, scenarioId: 'v195_d12' }) },
      ];
    }

    return {
      ...config,
      tryIt,
    };
  }, [config, setShot, setDate, setSwipe, toggleLayer, setFlood]);

  if (!valid || !enhancedConfig) return <NotFoundContent />;

  return (
    <div className="pointer-events-none relative min-h-[calc(100svh-62px)] w-full p-4 sm:p-6 lg:p-8">
      {/* Responsive layout: Grid holding narrative ActCard on left, widgets on right/bottom */}
      <div className="mx-auto flex h-full max-w-[1600px] flex-col justify-between gap-6 lg:flex-row lg:items-end">
        {/* Left Column: Story Card */}
        <div className="pointer-events-auto w-full lg:max-w-[480px]">
          <ActCard config={enhancedConfig} />
        </div>

        {/* Right / Center Column: Dynamic Act-specific Interactive Widgets */}
        <div className="flex w-full flex-col gap-4 lg:max-w-[560px]">
          {/* Act 3: Swipe Handle + Time Scrubber */}
          {n === 3 && (
            <div className="space-y-3">
              <SwipeHandle />
              <TimeScrubber />
            </div>
          )}

          {/* Act 4: Flow path & exposure telemetry */}
          {n === 4 && (
            <div className="space-y-3">
              <ImpactCounters />
            </div>
          )}

          {/* Act 5: Visx Reservoir Chart + Time Scrubber */}
          {n === 5 && (
            <div className="space-y-3">
              <ReservoirChart />
              <TimeScrubber />
            </div>
          )}

          {/* Act 6: 22 June Alert Card + Time Scrubber */}
          {n === 6 && (
            <div className="space-y-3">
              <AlertCard />
              <TimeScrubber />
            </div>
          )}

          {/* Act 7: Volume Slider + Impact Counters */}
          {n === 7 && (
            <div className="space-y-3">
              <VolumeSlider />
              <ImpactCounters />
            </div>
          )}

          {/* Act 8 & 9: TimeScrubber */}
          {(n === 8 || n === 9) && (
            <div className="space-y-3">
              <TimeScrubber />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
