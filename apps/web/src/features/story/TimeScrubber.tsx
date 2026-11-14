import { Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useManifest } from '@/data/hooks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

interface Acquisition {
  id: string;
  date: string;
  sensor: 'NISAR' | 'S1' | string;
  track?: string | null;
  pol?: string | null;
}

export function TimeScrubber({ className }: { className?: string }) {
  const currentDate = useAppStore((s) => s.date);
  const setDate = useAppStore((s) => s.setDate);
  const manifest = useManifest();
  const [isPlaying, setIsPlaying] = useState(false);

  // Extract radar dates from manifest
  const acquisitions: Acquisition[] = useMemo(() => {
    if (!manifest.data?.layers) return [];
    const radars = manifest.data.layers
      .filter((l) => l.kind === 'radar' && l.date)
      .map((l) => ({
        id: l.id,
        date: l.date as string,
        sensor: l.sensor ?? 'SAR',
        track: l.track,
        pol: l.pol,
      }));

    // Deduplicate by date, prefer NISAR if both exist
    const map = new Map<string, Acquisition>();
    for (const r of radars) {
      if (!map.has(r.date) || r.sensor === 'NISAR') {
        map.set(r.date, r);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [manifest.data]);

  const currentIndex = useMemo(() => {
    const idx = acquisitions.findIndex((a) => a.date === currentDate);
    return idx >= 0 ? idx : 0;
  }, [acquisitions, currentDate]);

  const handleIndexChange = useCallback(
    (index: number) => {
      const target = acquisitions[index];
      if (target) {
        setDate(target.date);
      }
    },
    [acquisitions, setDate],
  );

  // Auto-play timeline
  useEffect(() => {
    if (!isPlaying || acquisitions.length === 0) return;

    const timer = setInterval(() => {
      const nextIdx = (currentIndex + 1) % acquisitions.length;
      handleIndexChange(nextIdx);
    }, 1400);

    return () => clearInterval(timer);
  }, [isPlaying, currentIndex, acquisitions.length, handleIndexChange]);

  const currentAcq = acquisitions[currentIndex];

  if (acquisitions.length === 0) return null;

  return (
    <div
      className={cn(
        'glass pointer-events-auto flex flex-col gap-2 rounded-xl border border-white/10 bg-[rgba(6,12,20,.85)] p-3 text-ink backdrop-blur-md',
        className,
      )}
    >
      {/* Top telemetry bar */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause timeline' : 'Play timeline'}
            className="size-7 p-0"
          >
            {isPlaying ? <Pause className="size-3.5 text-teal" /> : <Play className="size-3.5 text-teal" />}
          </Button>

          <Button
            size="xs"
            variant="ghost"
            onClick={() => handleIndexChange(0)}
            aria-label="Restart timeline"
            className="size-7 p-0"
          >
            <RotateCcw className="size-3" />
          </Button>

          <div className="font-mono text-sm font-semibold tracking-wide text-ink">
            {currentAcq?.date ?? currentDate}
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] text-mute">
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 font-semibold text-[10px] tracking-wider',
              currentAcq?.sensor === 'NISAR'
                ? 'bg-teal/20 text-teal border border-teal/40'
                : 'bg-white/10 text-ink border border-white/20',
            )}
          >
            {currentAcq?.sensor} {currentAcq?.pol ?? ''}
          </span>
          {currentAcq?.track && <span>{currentAcq.track}</span>}
        </div>
      </div>

      {/* Slider track with acquisition dots */}
      <div className="relative px-1 pt-1">
        <Slider
          min={0}
          max={acquisitions.length - 1}
          step={1}
          value={[currentIndex]}
          onValueChange={(val) => handleIndexChange(val[0] ?? 0)}
          thumbLabel="Acquisition date"
          valueText={`${currentAcq?.date} (${currentAcq?.sensor})`}
        />

        {/* Date dots */}
        <div className="mt-1 flex justify-between px-0.5">
          {acquisitions.map((acq, idx) => (
            <button
              key={acq.id}
              type="button"
              onClick={() => handleIndexChange(idx)}
              title={`${acq.date} · ${acq.sensor} ${acq.track ?? ''}`}
              className={cn(
                'group relative flex flex-col items-center focus:outline-none',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full transition-all duration-150',
                  idx === currentIndex
                    ? 'scale-150 bg-teal ring-2 ring-teal/50'
                    : acq.sensor === 'NISAR'
                    ? 'bg-teal/60 hover:bg-teal hover:scale-125'
                    : 'bg-white/40 hover:bg-white hover:scale-125',
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
