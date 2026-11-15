import { Slider } from '@/components/ui/slider';
import { useManifest } from '@/data/hooks';
import type { Manifest } from '@/data/schemas.gen';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import { fmtDay } from './series';

type Layer = Manifest['layers'][number];

function radarAt(manifest: Manifest | undefined, date: string | null): Layer | null {
  if (!manifest || !date) return null;
  return (
    manifest.layers.find((l) => l.kind === 'radar' && l.date === date && l.sensor === 'NISAR') ??
    manifest.layers.find((l) => l.kind === 'radar' && l.date === date) ??
    null
  );
}

const describe = (l: Layer | null, date: string | null) =>
  l
    ? `${l.sensor === 'S1' ? 'Sentinel-1' : l.sensor} ${l.band ?? ''}-band ${l.pol ?? ''} · ${fmtDay(l.date!)}`
    : date
      ? `no image · ${fmtDay(date)}`
      : 'none';

/** Before/after swipe; labels come from the manifest, and a cross-sensor pair is said out loud. */
export function SwipeHandle({ className }: { className?: string }) {
  const swipe = useAppStore((s) => s.swipe);
  const setSwipe = useAppStore((s) => s.setSwipe);
  const compareDate = useAppStore((s) => s.compareDate);
  const date = useAppStore((s) => s.date);
  const manifest = useManifest().data;
  const left = radarAt(manifest, compareDate);
  const right = radarAt(manifest, date);
  const cross = Boolean(left && right && left.sensor !== right.sensor);

  return (
    <div className={cn('panel pointer-events-auto flex flex-col gap-2 p-3 text-ink', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="telemetry-label !text-teal">Radar swipe</p>
        {cross ? (
          <span className="inline-flex h-5 items-center rounded-pill border border-alert/60 px-2 font-mono text-[9.5px] font-semibold uppercase tracking-badge text-alert">
            Cross-sensor · compare outlines, not shades
          </span>
        ) : left && right ? (
          <span className="inline-flex h-5 items-center rounded-pill border border-teal/50 px-2 font-mono text-[9.5px] font-semibold uppercase tracking-badge text-teal">
            Same sensor
          </span>
        ) : null}
      </div>
      <div className="px-1">
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[swipe]}
          onValueChange={(v) => setSwipe(v[0] ?? 0.5)}
          thumbLabel="Before / after swipe"
          valueText={`${Math.round(swipe * 100)}% before`}
        />
      </div>
      <div className="flex justify-between gap-3 font-mono text-[10px] text-mute">
        <span>◀ {describe(left, compareDate)}</span>
        <span className="text-right text-teal">{describe(right, date)} ▶</span>
      </div>
    </div>
  );
}
