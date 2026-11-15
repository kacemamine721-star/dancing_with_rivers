import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { HonestyNote } from '@/components/HonestyNote';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useAnugaIndex, useHandLut, useImpacts } from '@/data/hooks';
import { floodClock } from '@/scene/mellegue/flood';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import { fmt } from './facts';
import { computedScenarios, handAt, nearestScenario, posToVolumeMm3, roundVolumeMm3, volumeMm3ToPos } from './series';
import { Panel } from './ui';
import { useAnugaStatsAll } from './useStoryData';

/** HAND is not meaningful below this volume (depression-filled channel, science review #19). */
export const HAND_MIN_MM3 = 5;
const STEPS = 1000;
const minPos = volumeMm3ToPos(HAND_MIN_MM3);

const TICKS = [
  { v: 21, label: '21 · June 2026' },
  { v: 50, label: '50' },
  { v: 195, label: '195 · hypothetical' },
];

/** Reads the scene's ANUGA playback clock ~8×/s (no store write per frame). */
function useFloodClock() {
  const [c, setC] = useState({ hours: floodClock.hours, total: floodClock.totalHours, playing: floodClock.playing });
  useEffect(() => {
    const id = setInterval(
      () => setC({ hours: floodClock.hours, total: floodClock.totalHours, playing: floodClock.playing }),
      125,
    );
    return () => clearInterval(id);
  }, []);
  return c;
}

function Counter({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between border-l border-hairline pl-3">
      {/* labels wrap instead of being cut ("Buildings (OSM)", "People (WorldPop, modelled)") */}
      <p className="telemetry-label leading-snug break-words" title={label}>
        {label}
      </p>
      <p className="mt-1.5 font-mono leading-none text-ink">
        <span className="text-[22px] tabular-nums">{value}</span>
        {unit ? <span className="ml-1 text-[11px] text-mute">{unit}</span> : null}
      </p>
    </div>
  );
}

/** Act 7: one control panel (volume, Quick ↔ 2D physics, presets, ANUGA playback, exposure). */
export function ScenarioPanel({ className }: { className?: string }) {
  const flood = useAppStore((s) => s.flood);
  const setFlood = useAppStore((s) => s.setFlood);
  const paused = useAppStore((s) => s.floodPaused);
  const setPaused = useAppStore((s) => s.setFloodPaused);
  const seek = useAppStore((s) => s.seekFlood);
  const lut = useHandLut();
  const index = useAnugaIndex();
  const impacts = useImpacts();
  const stats = useAnugaStatsAll();
  const clock = useFloodClock();

  const vMm3 = flood.volumeM3 / 1e6;
  const scenarios = computedScenarios(index.data);
  const scenario = flood.mode === 'anuga' ? (scenarios.find((s) => s.id === flood.scenarioId) ?? null) : null;
  const anuga = flood.mode === 'anuga' && scenario !== null;

  const choose = (id: string) => {
    const s = scenarios.find((x) => x.id === id);
    if (s) setFlood({ mode: 'anuga', scenarioId: s.id, volumeM3: s.volume_m3 });
  };
  const setMode = (mode: 'hand' | 'anuga') => {
    if (mode === 'hand') setFlood({ mode: 'hand' });
    else {
      const s = nearestScenario(index.data, flood.volumeM3);
      if (s) setFlood({ mode: 'anuga', scenarioId: s.id, volumeM3: s.volume_m3 });
    }
  };

  const hand = lut.data ? handAt(lut.data.rows, flood.volumeM3) : null;
  const imp = scenario ? impacts.data?.scenarios[scenario.id] : undefined;
  const st = scenario ? stats[scenario.id] : undefined;

  return (
    <Panel
      label="Release scenario"
      badge={
        anuga && scenario ? (
          <Badge {...provenanceProps(scenario)} subject="ANUGA scenario" />
        ) : lut.data ? (
          <Badge {...provenanceProps(lut.data)} subject="HAND quick flood" />
        ) : null
      }
      right={
        <div role="group" aria-label="Flood model" className="flex rounded-pill border border-ink/15 p-0.5">
          {(['hand', 'anuga'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={flood.mode === m}
              onClick={() => setMode(m)}
              disabled={m === 'anuga' && scenarios.length === 0}
              className={cn(
                'rounded-pill px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors',
                flood.mode === m ? 'bg-teal text-on-teal' : 'text-mute hover:text-ink',
              )}
            >
              {m === 'hand' ? 'Quick (HAND)' : '2D physics (ANUGA)'}
            </button>
          ))}
        </div>
      }
      className={className}
    >
      <p className="flex items-baseline gap-2 font-mono leading-none" aria-live="polite">
        <span className="text-[34px] tabular-nums tracking-[-0.02em]">{fmt(vMm3)}</span>
        <span className="text-[13px] text-mute">million m³ released</span>
        {anuga && scenario ? <span className="ml-auto text-[10.5px] text-teal">{scenario.label}</span> : null}
      </p>

      <div className="mt-3 px-1">
        <Slider
          min={0}
          max={STEPS}
          step={1}
          value={[Math.round(((volumeMm3ToPos(vMm3) - minPos) / (1 - minPos)) * STEPS)]}
          onValueChange={(v) => {
            const pos = minPos + ((v[0] ?? 0) / STEPS) * (1 - minPos);
            // dragging is always the HAND quick model (ANUGA exists only at the computed volumes)
            setFlood({ volumeM3: roundVolumeMm3(posToVolumeMm3(pos)) * 1e6, mode: 'hand', scenarioId: undefined });
          }}
          thumbLabel="Released volume"
          valueText={`${fmt(vMm3)} million cubic metres`}
        />
        <div className="relative mt-1 h-4 font-mono text-[9.5px] text-mute">
          {TICKS.map((t) => (
            <span
              key={t.v}
              className={cn('absolute whitespace-nowrap', t.v >= 150 ? '-translate-x-full' : '-translate-x-1/2')}
              style={{ left: `${((volumeMm3ToPos(t.v) - minPos) / (1 - minPos)) * 100}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        <p className="mt-1 font-mono text-[9.5px] text-mute">Log scale · ≥ {HAND_MIN_MM3} Mm³ (HAND not meaningful below)</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {scenarios.map((s) => (
          <Button
            key={s.id}
            size="xs"
            variant="chip"
            aria-pressed={flood.mode === 'anuga' && flood.scenarioId === s.id}
            onClick={() => choose(s.id)}
          >
            {fmt(s.volume_m3 / 1e6)} Mm³ · {s.volume_m3 >= 150e6 ? 'hypothetical (Upper Mellègue size)' : s.label}
          </Button>
        ))}
      </div>

      {anuga ? (
        <div className="mt-3 flex items-center gap-3 rounded-[10px] border border-hairline bg-ink/[.04] px-3 py-2">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => setPaused(!paused)}
            aria-label={paused ? 'Play the flood' : 'Pause the flood'}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          <div className="min-w-0 flex-1">
            <div
              role="slider"
              tabIndex={0}
              aria-label="Simulated time"
              aria-valuemin={0}
              aria-valuemax={clock.total}
              aria-valuenow={Math.max(0, Math.round(clock.hours))}
              aria-valuetext={clock.hours < 0 ? 'maximum depth envelope' : `${Math.round(clock.hours)} hours after release`}
              className="relative h-2 cursor-pointer rounded-pill bg-ink/10"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - r.left) / r.width) * clock.total);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') seek(Math.min(clock.total, Math.max(0, clock.hours) + 1));
                if (e.key === 'ArrowLeft') seek(Math.max(0, clock.hours - 1));
              }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-pill bg-teal"
                style={{ width: `${clock.total > 0 && clock.hours >= 0 ? (clock.hours / clock.total) * 100 : 0}%` }}
              />
            </div>
          </div>
          <span className="w-24 text-right font-mono text-[11px] text-ink">
            {clock.hours < 0 ? 'max depth' : `+${Math.round(clock.hours)} h`}
            <span className="text-mute"> / {Math.round(clock.total)} h</span>
          </span>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="telemetry-label">
          {anuga ? 'ANUGA · dam → Medjerda confluence' : 'HAND screening · whole corridor to Sidi Salem'}
        </p>
        {anuga ? (
          imp && st ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Counter label="Wet area" value={fmt(st.inundated_km2, 1)} unit="km²" />
                <Counter label="Cropland" value={fmt(imp.cropland_ha)} unit="ha" />
                <Counter label="Roads" value={fmt(imp.road_km)} unit="km" />
                <Counter label="Buildings (OSM)" value={fmt(imp.buildings)} />
              </div>
              {imp.villages.length ? (
                <p className="mt-2 font-mono text-[10.5px] text-ink/80">
                  {imp.villages
                    .map((v) => `${v.name}: water within 200 m after ≈ ${v.arrival_h === null ? '?' : fmt(v.arrival_h, 0)} h`)
                    .join(' · ')}
                </p>
              ) : null}
            </>
          ) : (
            <DataState kind="loading" subject="ANUGA exposure" minHeight={60} className="mt-2" />
          )
        ) : hand ? (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Counter label="Wet area" value={fmt(hand.area_km2, 1)} unit="km²" />
            <Counter label="Cropland" value={fmt(hand.cropland_ha)} unit="ha" />
            <Counter label="Villages" value={String(hand.villages)} />
            <Counter label="People (WorldPop, modelled)" value={`≈ ${fmt(Math.round(hand.population / 10) * 10)}`} />
          </div>
        ) : (
          <DataState kind="loading" subject="HAND exposure" minHeight={60} className="mt-2" />
        )}
      </div>

      {anuga ? (
        <div className="mt-3 flex items-center gap-2 font-mono text-[9.5px] text-mute">
          <span>Depth</span>
          <span
            aria-hidden
            className="h-2 w-28 rounded-pill"
            style={{ background: 'linear-gradient(90deg, #2b4ce0, #2f8fff, #1b3a9e, #120b4a)' }}
          />
          <span>0.1 m → ≥ 8 m</span>
        </div>
      ) : null}

      <HonestyNote label="Scenario · not a forecast" className="mt-4 border-t border-hairline pt-3">
        Screening level. Terrain: GEM-15 (experimental, 15 m) averaged to 30 m; no channel bathymetry; release shape and
        duration are assumptions; ANUGA covers dam → Medjerda confluence only. Exposure is not damage.
      </HonestyNote>
    </Panel>
  );
}
