import { Pause, Play, RotateCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { DataState } from '@/components/DataState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import { DamResults } from './DamResults';
import { DamStage } from './DamStage';
import { useDamGeometry, useDamIndex, useTunisia } from './data';
import { makeSteps, type StepId } from './steps';
import './yourdam.css';

const STEP_S = 4.6;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The interactive core of the V2 page: pick a dam, watch the pipeline run on its real geometry. */
export function YourDam() {
  const experts = useAppStore((s) => s.level === 'experts');
  const reducedPref = useAppStore((s) => s.reducedMotion);
  const [params, setParams] = useSearchParams();
  const idx = useDamIndex();
  const tun = useTunisia();
  const [q, setQ] = useState('');
  const damId = params.get('dam');
  const geo = useDamGeometry(damId);
  const [step, setStep] = useState<StepId>('find');
  const [playing, setPlaying] = useState(true);
  const reduced =
    reducedPref || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  // named dams first (alphabetical), then the OSM entries without a name
  const dams = useMemo(
    () =>
      [...(idx.data?.dams ?? [])].sort(
        (a, b) => Number(a.name.startsWith('Unnamed')) - Number(b.name.startsWith('Unnamed')) || a.name.localeCompare(b.name),
      ),
    [idx.data],
  );
  const names = useMemo(() => new Map(dams.map((d) => [d.id, d.name])), [dams]);
  const steps = useMemo(() => makeSteps(names), [names]);
  const dam = dams.find((d) => d.id === damId) ?? null;
  const shown = q ? dams.filter((d) => fold(`${d.name} ${d.governorate ?? ''} ${d.river ?? ''}`).includes(fold(q))) : dams;
  const i = steps.findIndex((s) => s.id === step);
  const def = steps[i]!;

  const pick = (id: string) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('dam', id);
      return n;
    }, { replace: true });
    setStep('find');
    setPlaying(true);
  };

  // autoplay through the steps once the geometry is loaded
  useEffect(() => {
    if (!dam || !geo.data || !playing) return;
    if (i >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setStep(steps[i + 1]!.id), STEP_S * 1000);
    return () => window.clearTimeout(t);
  }, [dam, geo.data, playing, i, steps]);

  if (idx.isPending) return <DataState kind="loading" subject="Dam catalogue" minHeight={420} />;
  if (idx.isError || !idx.data)
    return <DataState kind="missing" subject="Dam catalogue" message="The V2 dam catalogue is not in this build." minHeight={240} />;

  const stat = dam ? def.stat?.(dam) : null;
  const planned = !!dam && def.processedOnly && dam.status !== 'processed';

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* picker */}
      <aside aria-label="Choose a dam" className="glass flex max-h-[300px] flex-col lg:max-h-[680px] bg-[rgba(6,12,20,.9)] p-4">
        <label className="flex items-center gap-2 rounded-pill border border-hairline bg-black/30 px-3 py-2 focus-within:border-teal">
          <Search className="size-4 text-mute" aria-hidden />
          <span className="sr-only">Search a dam</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${dams.length} dams…`}
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-mute"
          />
        </label>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-mute">
          <span className="text-ok">●</span> full V1 pipeline · <span className="text-ink">●</span> geometry ready
        </p>
        <ul className="mt-2 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {shown.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => pick(d.id)}
                aria-current={d.id === damId ? 'true' : undefined}
                className={cn(
                  'flex w-full items-baseline justify-between gap-2 rounded-[10px] px-2.5 py-2 text-left transition-colors',
                  d.id === damId ? 'bg-teal/15 text-teal' : 'text-ink/90 hover:bg-white/[.04]',
                )}
              >
                <span className="min-w-0">
                  <span className={cn('mr-1.5 text-[10px]', d.status === 'processed' ? 'text-ok' : 'text-ink/60')}>●</span>
                  <span className="text-[14px]">{d.name}</span>
                  {d.governorate ? <span className="block pl-4 text-[11.5px] text-mute">{d.governorate}</span> : null}
                </span>
                {d.catchment_km2 ? (
                  <span className="shrink-0 font-mono text-[10.5px] text-mute">{Math.round(d.catchment_km2).toLocaleString('en-GB')} km²</span>
                ) : null}
              </button>
            </li>
          ))}
          {shown.length === 0 ? <li className="px-2 py-3 text-[13px] text-mute">No dam matches “{q}”.</li> : null}
        </ul>
      </aside>

      {/* stage */}
      <section aria-label="Pipeline demonstration" className="glass overflow-hidden bg-[rgba(4,8,14,.92)]">
        <div className="relative aspect-[4/5] w-full sm:aspect-[16/10] bg-[radial-gradient(ellipse_at_center,rgba(47,143,255,.08),transparent_70%)]">
          <DamStage index={idx.data} tunisia={tun.data} dam={dam} geo={geo.data} step={step} reduced={reduced} onPick={pick} />
          {!dam ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <div className="pointer-events-auto rounded-[14px] border border-hairline bg-black/70 px-4 py-3 text-center backdrop-blur">
                <p className="text-[14px] text-ink">Pick a dam on the map or in the list.</p>
                <Button size="xs" variant="chip" className="mt-2" onClick={() => pick('mellegue')}>
                  Start with Mellègue (V1)
                </Button>
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute left-3 top-3 hidden max-w-[70%] rounded-[12px] sm:block border border-hairline bg-black/65 px-3 py-2 backdrop-blur">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-teal">
                Step {i + 1} / {steps.length} · {def.label}
              </p>
              <p className="text-[15px] font-bold leading-tight">{def.title(dam)}</p>
            </div>
          )}
          {dam && stat ? (
            <div className="pointer-events-none absolute bottom-3 right-3 hidden rounded-[12px] sm:block border border-hairline bg-black/65 px-3 py-2 text-right backdrop-blur">
              <p className="font-mono text-[26px] leading-none tabular-nums">{stat.value}</p>
              {stat.unit ? <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-mute">{stat.unit}</p> : null}
            </div>
          ) : null}
          {dam && geo.isPending ? (
            <p className="absolute right-3 top-3 font-mono text-[11px] text-mute">loading geometry…</p>
          ) : null}
        </div>

        {dam ? (
          <div className="border-t border-hairline p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => (i >= steps.length - 1 ? (setStep('find'), setPlaying(true)) : setPlaying(!playing))}
                aria-label={playing ? 'Pause the demonstration' : 'Play the demonstration'}
              >
                {playing ? <Pause /> : i >= steps.length - 1 ? <RotateCcw /> : <Play />}
              </Button>
              <ol className="flex flex-1 flex-wrap gap-1.5" aria-label="Steps">
                {steps.map((s, k) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setStep(s.id);
                        setPlaying(false);
                      }}
                      aria-current={s.id === step ? 'step' : undefined}
                      className={cn(
                        'relative overflow-hidden rounded-pill border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors',
                        s.id === step
                          ? 'border-teal text-teal'
                          : k < i
                            ? 'border-teal/30 text-ink/80'
                            : 'border-hairline text-mute hover:text-ink',
                        s.processedOnly && dam.status !== 'processed' && 'border-dashed',
                      )}
                    >
                      {s.id === step && playing && !reduced ? (
                        <span
                          aria-hidden
                          key={`${dam.id}-${s.id}`}
                          className="absolute inset-y-0 left-0 bg-teal/15"
                          style={{ animation: `ywd-fill ${STEP_S}s linear forwards` }}
                        />
                      ) : null}
                      <span className="relative">
                        {k + 1}. {s.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            {/* on phones the step title and number sit here instead of over the map */}
            <div className="mt-3 flex items-baseline justify-between gap-3 sm:hidden">
              <p className="text-[15px] font-bold leading-tight">
                <span className="mr-1.5 font-mono text-[11px] text-teal">{i + 1}/{steps.length}</span>
                {def.title(dam)}
              </p>
              {stat ? (
                <p className="shrink-0 text-right font-mono text-[18px] leading-none tabular-nums">
                  {stat.value}
                  {stat.unit ? <span className="block text-[9px] uppercase tracking-[0.12em] text-mute">{stat.unit}</span> : null}
                </p>
              ) : null}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <p className="max-w-3xl text-[15px] leading-relaxed text-[#d6e0ee]">{experts ? def.expert(dam) : def.simple(dam)}</p>
              <div className="flex flex-wrap items-start gap-1.5 md:flex-col md:items-end">
                {planned ? (
                  <span className="rounded-pill border border-dashed border-alert/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-alert">
                    Planned · V2 milestone 1
                  </span>
                ) : (
                  <Badge
                    kind={def.id === 'radar' ? 'measured' : 'modelled'}
                    source={idx.data.sources.join('; ') || 'HydroBASINS, HydroRIVERS, OpenStreetMap, ASF NISAR inventory'}
                    subject={def.label}
                  />
                )}
                {dam.snap_warning && def.id === 'snap' ? (
                  <span className="rounded-pill border border-alert/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-alert">
                    Snap needs a check
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        {/* real per-dam outputs (radar chips, NISAR + Sentinel-1 series, alerts, SWOT, quick flood) */}
        {dam && dam.status === 'processed' ? <DamResults key={dam.id} dam={dam} /> : null}
      </section>
    </div>
  );
}
