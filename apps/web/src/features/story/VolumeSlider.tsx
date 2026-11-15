import { AlertTriangle, Waves } from 'lucide-react';

import { HonestyNote } from '@/components/HonestyNote';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

interface VolumeSliderProps {
  className?: string;
}

/** Scenarios that have a fully computed ANUGA run available. */
const COMPUTED_SCENARIOS = new Set(['v21_d12', 'v195_d12']);

const PRESETS = [
  { label: '21 Mm³ · June 2026', volumeMm3: 21, scenarioId: 'v21_d12', computed: true },
  { label: '50 Mm³', volumeMm3: 50, scenarioId: 'v50_d12', computed: false },
  { label: '195 Mm³ · Upper Mellègue', volumeMm3: 195, scenarioId: 'v195_d12', computed: true },
] as const;

export function VolumeSlider({ className }: VolumeSliderProps) {
  const flood = useAppStore((s) => s.flood);
  const setFlood = useAppStore((s) => s.setFlood);

  const volumeMm3 = Math.round(flood.volumeM3 / 1e6);

  // Is ANUGA data actually available for the currently selected scenario?
  const anugaAvailable = COMPUTED_SCENARIOS.has(flood.scenarioId ?? '');
  // Are we trying to show ANUGA but it's not available?
  const anugaFallback = flood.mode === 'anuga' && !anugaAvailable;

  const handlePreset = (p: (typeof PRESETS)[number]) => {
    setFlood({
      volumeM3: p.volumeMm3 * 1e6,
      scenarioId: p.scenarioId,
      // Auto-switch to ANUGA when a computed scenario is selected, or back to HAND when not
      mode: p.computed ? 'anuga' : 'hand',
    });
  };

  const handleModeChange = (mode: 'hand' | 'anuga') => {
    setFlood({
      mode,
      scenarioId: flood.scenarioId ?? 'v21_d12',
    });
  };

  return (
    <div
      className={cn(
        'glass pointer-events-auto flex flex-col gap-3 rounded-xl border border-white/10 bg-[rgba(6,12,20,.88)] p-4 text-ink shadow-2xl backdrop-blur-md',
        className,
      )}
    >
      {/* Header: Label, Mode Toggle & Readout */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-2">
          <Waves className="size-4 text-teal" />
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-teal">
            Released Volume
          </span>
        </div>

        {/* Mode Switch: Quick HAND vs Physics ANUGA */}
        <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5">
          <button
            type="button"
            onClick={() => handleModeChange('hand')}
            className={cn(
              'px-2 py-0.5 font-mono text-[10px] font-semibold uppercase rounded transition-colors',
              flood.mode === 'hand'
                ? 'bg-amber-500/80 text-black'
                : 'text-mute hover:text-white',
            )}
          >
            Bathtub
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('anuga')}
            className={cn(
              'px-2 py-0.5 font-mono text-[10px] font-semibold uppercase rounded transition-colors',
              flood.mode === 'anuga'
                ? 'bg-teal text-on-teal'
                : 'text-mute hover:text-white',
            )}
          >
            2D Physics
          </button>
        </div>
      </div>

      {/* Big readout */}
      <div className="flex items-baseline justify-between">
        <p className="font-mono leading-none">
          <span className="text-3xl font-bold tracking-tight text-ink">{volumeMm3}</span>
          <span className="ml-1.5 text-sm font-normal text-mute">million m³</span>
        </p>
        <span
          className={cn(
            'font-mono text-[11px]',
            flood.mode === 'hand' ? 'text-amber-400/80' : 'text-teal/80',
          )}
        >
          {flood.mode === 'hand' ? '↔ HAND bathtub' : '〜 ANUGA wave'}
        </span>
      </div>

      {/* ANUGA unavailable notice */}
      {anugaFallback && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" aria-hidden />
          <p className="font-mono text-[10px] leading-relaxed text-amber-300/90">
            <span className="font-semibold">ANUGA not yet computed</span> for 50 Mm³.
            Showing HAND bathtub estimate instead.
          </p>
        </div>
      )}

      {/* Slider */}
      <div className="px-1 py-1">
        <Slider
          min={1}
          max={200}
          step={1}
          value={[volumeMm3]}
          onValueChange={(val) => setFlood({ volumeM3: (val[0] ?? 21) * 1e6 })}
          thumbLabel="Released volume"
          valueText={`${volumeMm3} million m³`}
        />
        <div className="flex justify-between font-mono text-[10px] text-mute">
          <span>0 Mm³</span>
          <span>100 Mm³</span>
          <span>200 Mm³</span>
        </div>
      </div>

      {/* Preset Chips */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {PRESETS.map((p) => {
          const isSelected = volumeMm3 === p.volumeMm3;
          return (
            <Button
              key={p.volumeMm3}
              size="xs"
              variant={isSelected ? 'primary' : 'chip'}
              onClick={() => handlePreset(p)}
              className={cn(
                'text-[10.5px]',
                !p.computed && 'opacity-60',
              )}
              title={!p.computed ? 'ANUGA run pending — HAND estimate shown' : undefined}
            >
              {p.label}
              {!p.computed && (
                <span className="ml-1 font-mono text-[9px] uppercase tracking-wide opacity-70">
                  est.
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {/* Honesty Disclosure */}
      <div className="border-t border-white/10 pt-2.5">
        <HonestyNote
          kind="caution"
          label="SCENARIO EXPLORATION · NOT A FORECAST"
        >
          Modelled on GEM-15 (15 m) / NASADEM (30 m). Ignores channel bathymetry and seasonal vegetation friction variations.
        </HonestyNote>
      </div>
    </div>
  );
}
