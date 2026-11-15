import { ArrowRight, Bell, Cpu, MapPinned, Satellite, Server } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { HonestyNote } from '@/components/HonestyNote';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/brand';
import { YourDam } from '@/features/yourdam/YourDam';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

/** The hosted service, as one line: what the user does → what our servers do → what the user gets. */
const FLOW = [
  {
    icon: MapPinned,
    title: 'Choose your dam',
    simple: 'Click it on a map, anywhere in the world.',
    expert: 'Point or crest line → river snap, catchment and downstream route (HydroSHEDS, OSM, GEM-15 / GLO-30).',
  },
  {
    icon: Satellite,
    title: 'Satellites look at it',
    simple: 'NISAR and Sentinel-1 radar, day and night, through clouds.',
    expert: 'NISAR GCOV + Sentinel-1 RTC windows read over the lake; SWOT level when the lake is in its database.',
  },
  {
    icon: Cpu,
    title: 'Our servers do the work',
    simple: 'Lake size, alarms and flood maps, computed for you.',
    expert: 'Queued jobs: area series + detector, HAND table, ANUGA on GPU; results cached per dam and data version.',
  },
  {
    icon: Bell,
    title: 'You watch your dam',
    simple: 'A page for your dam, updated after every pass, with an alert if the lake drops.',
    expert: 'Per-dam bundle refreshed per acquisition; alert = −12 % / −20 % vs 21-day baseline, confirmed by a second pass.',
  },
] as const;

/** Measured on this prototype (bundles + run logs), not targets. */
const PROOF = [
  { value: '4', unit: 'dams', label: 'processed end to end', note: 'Mellègue + Sidi Salem, El Aroussia, Ouldjet Mellègue', badge: 'measured' as const },
  { value: '2', unit: 'countries', label: 'Tunisia and Algeria', note: 'same code, no per-dam tuning', badge: 'measured' as const },
  { value: '463', unit: 'radar looks', label: 'lake measurements', note: '106 NISAR + 357 Sentinel-1', badge: 'measured' as const },
  { value: '16–30', unit: 'min', label: 'radar data per dam', note: 'NISAR window reads, the slowest step', badge: 'measured' as const },
  { value: '1–6', unit: 'min', label: 'per flood run on a GPU', note: '10 ANUGA runs on a T4 (CPU estimate: 1–4 h)', badge: 'measured' as const },
] as const;

const PREVIEWS = [
  {
    file: 'sidi-salem-radar.webp',
    dam: 'sidi-salem',
    title: 'Sidi Salem · NISAR radar',
    simple: 'The lake seen by NISAR on 5 November 2026.',
    expert: 'NISAR L-band HH GCOV, track A173, 5 Nov 2026, on the 30 m lake grid; 22 NISAR + 111 Sentinel-1 area measurements.',
    badge: 'measured' as const,
  },
  {
    file: 'el-aroussia-anuga.webp',
    dam: 'el-aroussia',
    title: 'El Aroussia · flood model',
    simple: 'Where 20 million m³ released here would spread, hour by hour.',
    expert: 'ANUGA 2D on GPU, 20 Mm³ over 12 h, 83,199 triangles: 41.9 km² wet; mesh test failed, so timing is a range. Scenario, not a forecast.',
    badge: 'modelled' as const,
  },
  {
    file: 'ouldjet-mellegue-hand.webp',
    dam: 'ouldjet-mellegue',
    title: 'Ouldjet Mellègue · quick flood',
    simple: 'The valley below the Algerian dam, flooded for a 20 million m³ release.',
    expert: 'HAND bathtub on GEM-15 30 m along the D8 path (120 km): 16.5 km² at 20 Mm³. Scenario, not a forecast.',
    badge: 'modelled' as const,
  },
  {
    file: 'mellegue-anuga.webp',
    dam: 'mellegue',
    title: 'Mellègue · June 2026 reconstruction',
    simple: 'The 21 million m³ release of June 2026, modelled down to the Medjerda.',
    expert: 'ANUGA 2D, 69,616 triangles, 19.3 km² wet; arrival at the confluence 13–19 h (mesh-sensitive).',
    badge: 'modelled' as const,
  },
] as const;

const ROADMAP = [
  { tag: 'Done', title: 'One dam, the full story', body: 'Mellègue, June 2026: radar, alarm, SWOT level, floods, 43 tests.', done: true },
  { tag: 'Done', title: 'Any dam, same pipeline', body: 'Three new dams in two countries, NISAR + Sentinel-1, floods on GPU, from one command.', done: true },
  { tag: 'Next', title: 'Hosted for everyone', body: 'Pick a dam online; our servers queue the job and publish its page.', done: false },
  { tag: 'Then', title: 'Watch and alert', body: 'Each dam updated after every satellite pass, with alerts by e-mail.', done: false },
  { tag: 'Always', title: 'Prove the alarm', body: 'Test the alarm on many dams before anyone relies on it.', done: false },
] as const;

/** `/your-dam` — "Dancing with your Dam": real results for the processed dams, and the hosted service we are building. */
export function Component() {
  useDocumentTitle('Dancing with your Dam');
  const experts = useAppStore((s) => s.level === 'experts');
  const base = `${import.meta.env.BASE_URL}v2/previews/`;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6">
      <header className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-pill border border-alert/60 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-alert">
            ● Prototype · hosting soon
          </span>
          <span className="rounded-pill border border-hairline px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mute">
            {BRAND.product}
          </span>
        </div>
        <h1 className="mt-4 text-[clamp(34px,5.4vw,64px)] font-bold leading-[1.02] tracking-tight">
          Dancing with <span className="text-teal">your Dam</span>
        </h1>
        <p className="mt-4 max-w-3xl text-[16px] leading-relaxed text-ink/85">
          {experts
            ? 'The V2 pipeline run on four dams: river snap and catchment, NISAR + Sentinel-1 lake series, the alarm rule, SWOT level, D8 flow path, HAND table and ANUGA on GPU. Every number and layer below is read from the dam’s bundle.'
            : 'Pick a dam and watch real satellite results appear, step by step.'}
        </p>
      </header>

      <div className="mt-7">
        <YourDam />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" asChild>
          <Link to="/story/1">
            See the full Mellègue story <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/methods">How each step works</Link>
        </Button>
      </div>

      {/* the goal */}
      <section aria-labelledby="goal" className="glass relative mt-14 overflow-hidden bg-[rgba(6,12,20,.9)] p-6 sm:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-28 -top-28 size-[460px] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(95,243,255,.35), transparent 65%)' }}
        />
        <div className="relative">
          <p className="kicker">Our goal</p>
          <h2 id="goal" className="mt-2 max-w-3xl text-[clamp(28px,4vw,46px)] font-bold leading-[1.05]">
            Anyone can watch <span className="text-teal">their own dam</span> from space.
          </h2>
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-ink/80">
            {experts
              ? 'We will host the pipeline as a service: a static front end, an API with a job queue, radar and GPU flood workers, and per-dam results cached by data version. No ground sensor and no local install needed.'
              : 'We are putting this system online. Choose a dam, and it does the rest.'}
          </p>

          {/* the service as one line */}
          <ol className="mt-8 grid gap-3 md:grid-cols-4" aria-label="How the hosted service works">
            {FLOW.map((f, i) => (
              <li key={f.title} className="relative rounded-[14px] border border-hairline bg-black/30 p-4">
                {i < FLOW.length - 1 ? (
                  <span aria-hidden className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-teal md:block">
                    <ArrowRight className="size-5" />
                  </span>
                ) : null}
                <div className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-full border border-teal/60 font-mono text-[12px] text-teal">{i + 1}</span>
                  <f.icon className="size-5 text-teal" aria-hidden />
                </div>
                <h3 className="mt-3 text-[16px] font-bold">{f.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-ink/75">{experts ? f.expert : f.simple}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* what is already proven */}
      <section aria-labelledby="proof" className="mt-12">
        <h2 id="proof" className="kicker">
          Already working
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {PROOF.map((p) => (
            <li key={p.label} className="flex flex-col rounded-[14px] border border-hairline bg-[rgba(6,12,20,.85)] p-4">
              <p className="font-mono leading-none">
                <span className="text-[30px] tabular-nums text-ink">{p.value}</span>{' '}
                <span className="text-[12px] text-mute">{p.unit}</span>
              </p>
              <p className="mt-2 flex-1 text-[13px] font-semibold text-ink/90">{p.label}</p>
              {experts ? <p className="mt-1 text-[11.5px] text-mute">{p.note}</p> : null}
              <div className="mt-2">
                <Badge kind={p.badge} source="V2 pipeline bundles and run logs" subject={p.label} className="h-[18px] px-1.5 text-[9px]" />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* real previews */}
      <section aria-labelledby="previews" className="mt-12">
        <h2 id="previews" className="kicker">
          Real results, four dams
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {PREVIEWS.map((p) => (
            <figure key={p.file} className="glass m-0 overflow-hidden bg-[rgba(6,12,20,.85)]">
              <Link to={`/your-dam?dam=${p.dam}`} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">
                <img src={base + p.file} alt={`${p.title}. ${p.simple}`} width={1102} height={621} loading="eager" decoding="async" className="block h-auto w-full" />
              </Link>
              <figcaption className="flex items-start justify-between gap-3 p-4">
                <div>
                  <p className="text-[15px] font-bold">{p.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink/75">{experts ? p.expert : p.simple}</p>
                </div>
                <Badge kind={p.badge} source="V2 pipeline bundle" subject={p.title} className="shrink-0" />
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* roadmap: one line */}
      <section aria-labelledby="roadmap" className="mt-12">
        <h2 id="roadmap" className="kicker">
          Roadmap
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-5">
          {ROADMAP.map((r) => (
            <li
              key={r.title}
              className={cn('rounded-[14px] border p-4', r.done ? 'border-teal/50 bg-teal/[.06]' : 'border-hairline bg-[rgba(6,12,20,.8)]')}
            >
              <p className={cn('font-mono text-[10.5px] uppercase tracking-[0.16em]', r.done ? 'text-teal' : 'text-mute')}>
                {r.done ? '✓ ' : ''}
                {r.tag}
              </p>
              <h3 className="mt-2 text-[15px] font-bold">{r.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink/75">{r.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <HonestyNote label="Prototype, not hosted yet" className="mt-10">
        Results above are computed offline for four dams. Flood maps are scenarios, not forecasts; their timing depends on
        the model mesh (shown as a range). The alarm was tuned on one event and must be tested on many dams before it can
        be trusted. <Server className="ml-1 inline size-3.5 align-[-2px]" aria-hidden /> Hosting is the next step.
      </HonestyNote>
    </div>
  );
}
