import { Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { DataState } from '@/components/DataState';
import { Button } from '@/components/ui/button';
import { reliablePoints, rollingMedian } from '@/features/story/series';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import { useDamBundle } from './bundle';
import { DamStage, type RadarFrame } from './DamStage';
import { useDamGeometry, useDamIndex, useTunisia } from './data';
import { buildSteps, ORDER, type StepId } from './steps';
import './yourdam.css';

const STEP_S = 4.4;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

type SparkPoint = { date: string; area_km2: number; area_norm_km2?: number | null; confidence?: string | null };

/** Real 21-day median of the harmonised lake area, as a tiny line (lake / alert steps). */
function Spark({ points }: { points: SparkPoint[] }) {
  const med = useMemo(
    () => rollingMedian(reliablePoints(points.map((p) => ({ ...p, area_km2: p.area_norm_km2 ?? p.area_km2 })) as never)),
    [points],
  );
  if (med.length < 2) return null;
  const W = 200;
  const H = 52;
  const t0 = Date.parse(med[0]!.date);
  const t1 = Date.parse(med[med.length - 1]!.date);
  const lo = Math.min(...med.map((m) => m.median));
  const hi = Math.max(...med.map((m) => m.median));
  const d = med
    .map(
      (m, k) =>
        `${k ? 'L' : 'M'}${(((Date.parse(m.date) - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(4 + (1 - (m.median - lo) / (hi - lo || 1)) * (H - 8)).toFixed(1)}`,
    )
    .join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-[200px]" role="img" aria-label="Lake area, 21-day median">
      <path d={d} fill="none" stroke="#1a22b4" strokeWidth={2} />
    </svg>
  );
}

/** Dancing with your Dam: pick a processed dam, watch its real results appear step by step. */
export function YourDam() {
  const experts = useAppStore((s) => s.level === 'experts');
  const reducedPref = useAppStore((s) => s.reducedMotion);
  const [params, setParams] = useSearchParams();
  const idx = useDamIndex();
  const tun = useTunisia();
  const reduced =
    reducedPref || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  // only the dams the pipeline has processed end to end
  const dams = useMemo(
    () =>
      (idx.data?.dams ?? [])
        .filter((d) => d.status === 'processed')
        .sort((a, b) => (a.id === 'mellegue' ? -1 : b.id === 'mellegue' ? 1 : a.name.localeCompare(b.name))),
    [idx.data],
  );
  const damId = params.get('dam') ?? dams[0]?.id ?? null;
  const dam = dams.find((d) => d.id === damId) ?? dams[0] ?? null;
  const geo = useDamGeometry(dam?.id ?? null);
  const bundle = useDamBundle(dam?.id ?? null);
  const [step, setStep] = useState<StepId>('find');
  const [playing, setPlaying] = useState(true);
  const [radarFrame, setRadarFrame] = useState<RadarFrame | null>(null);
  const [floodHour, setFloodHour] = useState<number | null>(null);
  const onRadar = useCallback((f: RadarFrame | null) => setRadarFrame(f), []);
  const onHour = useCallback((h: number | null) => setFloodHour(h), []);

  const steps = useMemo(() => (dam ? buildSteps(dam, bundle) : []), [dam, bundle]);
  const i = ORDER.indexOf(step);
  const cur = steps[i];
  const ready = !!dam && !!geo.data && bundle.ready;

  const pick = (id: string) => {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('dam', id);
        return n;
      },
      { replace: true },
    );
    setStep('find');
    setPlaying(true);
  };

  useEffect(() => {
    if (!ready || !playing) return;
    if (i >= ORDER.length - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setStep(ORDER[i + 1]!), STEP_S * 1000);
    return () => window.clearTimeout(t);
  }, [ready, playing, i]);

  if (idx.isPending) return <DataState kind="loading" subject="Dams" minHeight={420} />;
  if (idx.isError || !idx.data)
    return <DataState kind="missing" subject="Dams" message="The dam catalogue is not in this build." minHeight={240} />;

  return (
    <section aria-label="Pipeline demonstration" className="glass overflow-hidden bg-[rgba(251,248,241,.92)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-3 sm:p-4">
        <span className="telemetry-label mr-1">Pick a dam</span>
        {dams.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => pick(d.id)}
            aria-pressed={d.id === dam?.id}
            className={cn(
              'rounded-pill border px-3 py-1.5 text-[13px] transition-colors',
              d.id === dam?.id ? 'border-teal bg-teal/15 text-teal' : 'border-hairline text-ink/85 hover:border-ink/40',
            )}
          >
            {d.name.replace(/^Barrage (de |d’|d')?/i, '')}
            {d.governorate ? <span className="ml-1.5 text-[11px] text-mute">{d.governorate}</span> : null}
          </button>
        ))}
      </div>

      <div className="relative aspect-[4/5] w-full bg-[radial-gradient(ellipse_at_center,rgba(47,143,255,.08),transparent_70%)] sm:aspect-[16/9]">
        <DamStage
          index={idx.data}
          dams={dams}
          tunisia={tun.data}
          dam={dam}
          geo={geo.data}
          bundle={bundle}
          step={step}
          reduced={reduced}
          onPick={pick}
          onRadarFrame={onRadar}
          onFloodHour={onHour}
        />
        {radarFrame ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-[10px] border border-hairline bg-paper/90 px-3 py-1.5 font-mono text-[11px] backdrop-blur">
            <span className={radarFrame.sensor === 'NISAR' ? 'text-teal' : 'text-alert'}>
              {radarFrame.sensor === 'S1' ? 'Sentinel-1 C-band' : `${radarFrame.sensor} L-band`}
            </span>
            <span className="text-ink/80"> · {radarFrame.date ? day(radarFrame.date) : ''}</span>
            {step !== 'radar' ? <span className="text-mute"> · water mask</span> : null}
          </div>
        ) : null}
        {step === 'anuga' && floodHour !== null ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-[10px] border border-hairline bg-paper/90 px-3 py-1.5 font-mono text-[11px] text-ink/85 backdrop-blur">
            ANUGA · +{floodHour} h after the release starts
          </div>
        ) : null}
        {(step === 'lake' || step === 'alert') && bundle.area ? (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-[10px] border border-hairline bg-paper/90 p-2 backdrop-blur">
            <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-mute">lake area · 21-day median</p>
            <Spark points={bundle.area.points} />
          </div>
        ) : null}
        {dam && !ready ? <p className="absolute right-3 top-3 font-mono text-[11px] text-mute">loading results…</p> : null}
      </div>

      {dam && cur ? (
        <div className="border-t border-hairline p-3 sm:p-4">
          <div className="flex items-stretch gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="mt-2 size-8 shrink-0"
              onClick={() => {
                if (i >= ORDER.length - 1) {
                  setStep('find');
                  setPlaying(true);
                } else setPlaying(!playing);
              }}
              aria-label={playing ? 'Pause' : i >= ORDER.length - 1 ? 'Replay' : 'Play'}
            >
              {playing ? <Pause /> : i >= ORDER.length - 1 ? <RotateCcw /> : <Play />}
            </Button>
            <ol aria-label="Process" className="flex flex-1 gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {steps.map((s, k) => (
                <li key={s.id} className="min-w-[104px] flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep(s.id);
                      setPlaying(false);
                    }}
                    aria-current={s.id === step ? 'step' : undefined}
                    className={cn(
                      'relative flex h-full w-full flex-col items-start overflow-hidden rounded-[10px] border px-2.5 pb-2 pt-2.5 text-left transition-colors',
                      s.id === step ? 'border-teal bg-teal/[.08]' : k < i ? 'border-hairline bg-ink/[.03]' : 'border-hairline',
                      s.pending && 'border-dashed opacity-60',
                    )}
                  >
                    <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-ink/10">
                      <span
                        key={`${dam.id}-${s.id}-${String(s.id === step && playing)}`}
                        className={cn('block h-full bg-teal', k < i ? 'w-full' : 'w-0')}
                        style={s.id === step && playing && !reduced ? { animation: `ywd-fill ${STEP_S}s linear forwards` } : undefined}
                      />
                    </span>
                    <span className={cn('font-mono text-[9.5px] uppercase tracking-[0.14em]', s.id === step ? 'text-teal' : 'text-mute')}>
                      {k + 1}. {s.label}
                    </span>
                    <span className={cn('mt-1 whitespace-nowrap font-mono leading-none tabular-nums text-ink', s.value.length > 6 ? 'text-[16px]' : 'text-[19px]')}>
                      {s.value}
                    </span>
                    {s.unit ? <span className="mt-1 font-mono text-[9.5px] leading-tight text-mute">{s.unit}</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[14.5px] leading-snug text-ink/85">{experts ? cur.expert : cur.simple}</p>
            {cur.pending ? (
              <span className="rounded-pill border border-dashed border-alert/60 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-alert">
                {cur.id === 'anuga' ? 'Running on GPU' : 'Not available'}
              </span>
            ) : (
              <Badge kind={cur.badge} source="Dancing with the Rivers V2 pipeline (see Methods)" subject={cur.label} />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
