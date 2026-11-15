import { ArrowRight, Boxes, Droplets, GitBranch, MapPinned, Radar, Server } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { HonestyNote } from '@/components/HonestyNote';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/brand';
import { figureUrl, useMethodFigures } from '@/features/methods/figures';
import { YourDam } from '@/features/yourdam/YourDam';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAppStore } from '@/store/app';

const FEATURES = [
  {
    icon: MapPinned,
    title: 'Pick any dam',
    simple: 'Choose a reservoir; the system finds the dam wall and the river it sits on.',
    expert: 'Dam snapping from GeoDAR + OpenStreetMap (crest line when available), cached by dam_id + data version.',
  },
  {
    icon: GitBranch,
    title: 'Upstream and downstream, automatically',
    simple: 'It finds all the land that drains into the lake, and the path water would take below the dam.',
    expert: 'HydroBASINS / HydroRIVERS catchment; D8 path on GEM-15 (else GLO-30) with tests D1/D2; HAND corridor and lookup table.',
  },
  {
    icon: Radar,
    title: 'A lake measured every few days',
    simple: 'NISAR and Sentinel-1 measure the water area through clouds, day and night, for each reservoir.',
    expert: 'Lake mask = pre-period Sentinel-1 water frequency ∩ JRC GSW maximum; per-image threshold with confidence flags.',
  },
  {
    icon: Droplets,
    title: 'Alerts tested on many lakes',
    simple: 'The alarm that worked for Mellègue is tested on other reservoirs before anyone relies on it.',
    expert: 'The 03_anomaly rule runs unchanged per dam; detection and false-alarm rates reported out of sample before any alert is shown as operational.',
  },
  {
    icon: Boxes,
    title: 'Flood scenarios on demand',
    simple: 'Physics flood runs for the reservoirs that matter most, with timing shown as a range.',
    expert: 'ANUGA for the top 2–3 dams, a mesh-sensitivity pair per run (E4); ~33–48 min per scenario on 4 threads, 2–5 h per dam for 3 scenarios, run as a queued job.',
  },
  {
    icon: Server,
    title: 'Open data service',
    simple: 'Later, an online service so water managers can ask for any dam.',
    expert: 'Milestone 2: API + queue, ANUGA workers (~4 vCPU), outputs on object storage, Earthdata token server-side only. Not before the method is shown to transfer.',
  },
] as const;

const ROADMAP = [
  {
    tag: 'Done · V1',
    title: 'One dam, end to end',
    body: 'Mellègue: radar area series, alert replay, SWOT level, flow path, HAND and ANUGA scenarios, 43 validation tests.',
    done: true,
  },
  {
    tag: 'Milestone 1',
    title: '5–10 Tunisian reservoirs, offline',
    body: 'One command per dam writes a V1-compatible data bundle: e.g. Sidi Salem, Bou Heurtma, Beni Mtir, Barbara, Kasseb, Siliana, Sidi el Barrak, Joumine.',
    done: false,
  },
  {
    tag: 'Milestone 1',
    title: 'Prove the method transfers',
    body: 'Detector scored out of sample on every dam; ANUGA with mesh tests for the top 2–3 dams.',
    done: false,
  },
  {
    tag: 'Milestone 2',
    title: 'Live service',
    body: 'Static front end + API, job queue and flood workers; data latency shown in the app.',
    done: false,
  },
] as const;

/** `/your-dam` — "Dancing with your Dam": pick a dam and watch the pipeline run on its real geometry. */
export function Component() {
  useDocumentTitle('Dancing with your Dam');
  const experts = useAppStore((s) => s.level === 'experts');
  const figs = useMethodFigures();
  const previews = figs.data ? [...figs.data.values()].filter((f) => f.id.startsWith('v')) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6">
      <header className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-pill border border-alert/60 px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-alert">
            ● V2 preview · deployment soon
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
            ? 'Pick any catalogued Tunisian dam and watch the V2 pipeline run on its real geometry: snap to HydroRIVERS, upstream HydroBASINS catchment, mapped reservoir, NISAR passes from the ASF inventory, and the downstream path with the places it passes. Lake series, alerts and floods are computed for Mellègue (V1); for other dams they are the milestone-1 work, shown as planned.'
            : 'Pick a dam and watch real satellite results appear, step by step.'}
        </p>
      </header>

      <div className="mt-7">
        <YourDam />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" asChild>
          <Link to="/story/1">
            See the full Mellègue story (V1) <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link to="/methods">How each step works</Link>
        </Button>
      </div>

      <section aria-labelledby="v2-features" className="mt-10">
        <h2 id="v2-features" className="kicker">
          What V2 adds
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="glass bg-[rgba(6,12,20,.85)] p-5">
              <f.icon className="size-5 text-teal" aria-hidden />
              <h3 className="mt-3 text-[17px] font-bold">{f.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink/80">{experts ? f.expert : f.simple}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="v2-previews" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="v2-previews" className="kicker">
              Previews · what we are working on
            </h2>
            <p className="mt-2 max-w-2xl text-[14px] text-ink/75">
              Real outputs from our data, made for Mellègue. They show the building blocks V2 will run for every dam.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {previews.map((f) => (
            <figure key={f.id} className="glass m-0 overflow-hidden bg-[rgba(6,12,20,.85)]">
              <div>
                <img
                  src={figureUrl(f)}
                  alt={`${f.title}. ${f.caption_simple}`}
                  width={f.width ?? 1600}
                  height={f.height ?? 900}
                  loading="eager"
                  decoding="async"
                  className="block h-auto w-full"
                />
              </div>
              <figcaption className="p-4">
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-teal">V2 preview</p>
                <p className="text-[15px] font-bold">{f.title.replace(/^V2 preview · /, '')}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink/75">
                  {experts ? f.caption_expert : f.caption_simple}
                </p>
                <div className="mt-2.5">
                  <Badge kind={f.badge} source={f.source} subject={f.title} />
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section aria-labelledby="v2-roadmap" className="mt-12">
        <h2 id="v2-roadmap" className="kicker">
          Roadmap
        </h2>
        <ol className="mt-5 grid gap-3 md:grid-cols-4">
          {ROADMAP.map((r) => (
            <li
              key={r.title}
              className={
                'relative rounded-[14px] border p-5 ' +
                (r.done ? 'border-teal/50 bg-teal/[.06]' : 'border-hairline bg-[rgba(6,12,20,.8)]')
              }
            >
              <p className={'font-mono text-[10.5px] uppercase tracking-[0.16em] ' + (r.done ? 'text-teal' : 'text-mute')}>
                {r.done ? '✓ ' : ''}
                {r.tag}
              </p>
              <h3 className="mt-2 text-[16px] font-bold">{r.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink/75">{r.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <HonestyNote label="Not deployed yet" className="mt-10">
        V2 is in development on a separate branch and is not part of this demo. Today only Mellègue is processed and
        tested; the alert rule was tuned on that one event and must be tested on other reservoirs before it can be
        trusted elsewhere.
      </HonestyNote>
    </div>
  );
}
