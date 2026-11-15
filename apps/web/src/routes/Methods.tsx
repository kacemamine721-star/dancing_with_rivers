import { ArrowUpRight } from 'lucide-react';

import { Badge } from '@/components/Badge';
import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { HonestyNote } from '@/components/HonestyNote';
import { useValidation } from '@/data/hooks';
import type { Validation } from '@/data/schemas.gen';
import { figureUrl, useMethodFigures, type MethodFigure } from '@/features/methods/figures';
import { CHAPTERS, STEPS, type MethodStep } from '@/features/methods/steps';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

type Test = Validation['tests'][number];

export const STATUS = {
  pass: { icon: '✅', label: 'Pass' },
  caveat: { icon: '⚠️', label: 'Pass with caveat' },
  fail: { icon: '❌', label: 'Fail (claim dropped or shown as a range)' },
  pending: { icon: '⏳', label: 'Not run yet' },
} as const;

/** Group tests in file order (docs/07 §8 groups). */
export function groupTests(tests: Test[]): [string, Test[]][] {
  const out = new Map<string, Test[]>();
  for (const t of tests) out.set(t.group, [...(out.get(t.group) ?? []), t]);
  return [...out.entries()];
}

function Figure({ fig, experts, priority }: { fig: MethodFigure | undefined; experts: boolean; priority: boolean }) {
  if (!fig) return <div className="aspect-[16/9] w-full rounded-[14px] border border-hairline bg-ink/[.04]" aria-hidden />;
  return (
    <figure className="m-0">
      <a
        href={figureUrl(fig)}
        target="_blank"
        rel="noreferrer"
        className="group relative block overflow-hidden rounded-[14px] border border-hairline bg-ink/[.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
      >
        <img
          src={figureUrl(fig)}
          alt={`${fig.title}. ${fig.caption_simple}`}
          width={fig.width ?? 1600}
          height={fig.height ?? 900}
          loading="eager"
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          className="block h-auto w-full transition-transform duration-500 group-hover:scale-[1.015]"
        />
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-pill bg-black/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Full size <ArrowUpRight className="size-3" aria-hidden />
        </span>
      </a>
      <figcaption className="mt-2.5 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink/75">
        <Badge kind={fig.badge} source={fig.source} subject={fig.title} className="mt-0.5 shrink-0" />
        <span>{experts ? fig.caption_expert : fig.caption_simple}</span>
      </figcaption>
    </figure>
  );
}

function Step({ step, n, fig, experts }: { step: MethodStep; n: number; fig: MethodFigure | undefined; experts: boolean }) {
  const flip = n % 2 === 0;
  return (
    <article
      id={`step-${step.id}`}
      aria-labelledby={`step-${step.id}-title`}
      className="scroll-mt-24 border-t border-hairline py-10 first:border-t-0 lg:py-14"
    >
      <div className={cn('grid items-start gap-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10', flip && 'lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]')}>
        <div className={cn(flip && 'lg:order-2')}>
          <p className="flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-kick text-teal">
            <span className="grid size-8 place-items-center rounded-full border border-teal/60 text-[13px] tracking-normal">
              {n}
            </span>
            Step {n} of {STEPS.length}
          </p>
          <h3 id={`step-${step.id}-title`} className="mt-3 text-[clamp(21px,2.2vw,28px)] font-bold leading-tight">
            {step.title}
          </h3>
          <p className="mt-3 text-[15px] leading-[1.7] text-ink/85">{experts ? step.expert : step.simple}</p>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
            {step.numbers.map((x) => (
              <div key={x.label} className="flex min-w-0 flex-col border-l border-hairline pl-3">
                <dt className="telemetry-label flex-1 leading-snug">{x.label}</dt>
                <dd className="m-0 mt-1.5 font-mono leading-none text-ink">
                  <span className="text-[22px] tabular-nums">{x.value}</span>
                  {x.unit ? <span className="ml-1 text-[11px] text-mute">{x.unit}</span> : null}
                  <div className="mt-2">
                    <Badge kind={x.badge} source={step.data} subject={x.label} className="h-[18px] px-1.5 text-[9px]" />
                  </div>
                </dd>
              </div>
            ))}
          </dl>

          <HonestyNote kind="caution" label="Limit" className="mt-5">
            {step.limit}
          </HonestyNote>

          {experts ? (
            <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-mute">
              Data: {step.data}
              <br />
              Code: {step.script}
            </p>
          ) : null}
        </div>
        <div className={cn(flip && 'lg:order-1')}>
          <Figure fig={fig} experts={experts} priority={n <= 2} />
        </div>
      </div>
    </article>
  );
}

function ValidationTable({ tests }: { tests: Test[] }) {
  return (
    <>
      {groupTests(tests).map(([group, list]) => (
        <section key={group} className="mb-6" aria-labelledby={`g-${group}`}>
          <h4 id={`g-${group}`} className="telemetry-label !text-teal mb-2">
            {group}
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-hairline font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">
                  <th scope="col" className="py-1.5 pr-2">Test</th>
                  <th scope="col" className="py-1.5 pr-2">Result</th>
                  <th scope="col" className="py-1.5 pr-2">Criterion</th>
                  <th scope="col" className="py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t, i) => (
                  <tr key={`${t.id}-${t.scenario ?? i}`} className="border-b border-hairline align-top">
                    <th scope="row" className="py-2 pr-2 font-normal">
                      <span className="font-mono text-teal">{t.id}</span>
                      {t.scenario ? <span className="ml-1 font-mono text-[10.5px] text-mute">{t.scenario}</span> : null}
                      <div className="text-[12px] text-ink/85">{t.name}</div>
                    </th>
                    <td className="py-2 pr-2 text-ink/90">
                      {t.summary}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-mute">
                        <Badge
                          kind={t.badge}
                          source={`validation/validation.json (from ${t.source_file})`}
                          subject={`${t.id} result`}
                          className="h-[18px] px-1.5 text-[9px]"
                        />
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-[12px] text-mute">{t.criterion}</td>
                    <td className="whitespace-nowrap py-2">
                      <span aria-hidden>{STATUS[t.status].icon}</span>
                      <span className="sr-only">{STATUS[t.status].label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

/** `/methods` — an illustrated, step-by-step tutorial of the pipeline, then the validation table. */
export function Component() {
  useDocumentTitle('Methods');
  const experts = useAppStore((s) => s.level === 'experts');
  const figs = useMethodFigures();
  const v = useValidation();

  const counts = v.data
    ? (['pass', 'caveat', 'fail', 'pending'] as const).map((s) => [s, v.data.tests.filter((t) => t.status === s).length] as const)
    : [];
  let n = 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6">
      <header className="glass bg-[rgba(251,248,241,.92)] p-6 sm:p-9">
        <p className="kicker">Methods · {experts ? 'advanced' : 'simplified'} tutorial</p>
        <h1 className="mt-2 max-w-3xl text-[clamp(28px,3.8vw,46px)] font-bold leading-[1.08]">
          How we read a dam from space, step by step
        </h1>
        <p className="mt-4 max-w-3xl text-[15.5px] leading-relaxed text-ink/85">
          {experts
            ? 'Eleven steps from radar backscatter to flood exposure, with the parameters, the data file that holds each number and the script that made it. Every figure below is drawn from the same files the app reads. Each step ends with its limit.'
            : 'Eleven short steps explain how a radar satellite turns into a dam monitor: how it sees water, how we measure the lake, how we notice a drop, and where released water would go. Each step has a real picture from our data and an honest limit.'}
        </p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          {experts ? 'Showing the advanced version. ' : 'Showing the simplified version. '}
          Switch with “Simplified / Advanced” at the top right.
        </p>

        <nav aria-label="Tutorial steps" className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CHAPTERS.map((c, ci) => (
            <div key={c.id} className="rounded-[14px] border border-hairline bg-ink/[.04] p-4">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-teal">
                Part {ci + 1} · {c.title}
              </p>
              <p className="mt-1 text-[12.5px] text-ink/70">{c.blurb}</p>
              <ol className="mt-2.5 space-y-1">
                {STEPS.filter((s) => s.chapter === c.id).map((s) => (
                  <li key={s.id}>
                    <a href={`#step-${s.id}`} className="text-[13px] text-ink/90 underline-offset-4 hover:text-teal hover:underline">
                      {STEPS.indexOf(s) + 1}. {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </nav>
      </header>

      {figs.isError ? (
        <DataState kind="missing" subject="Tutorial figures" className="mt-6" message="The tutorial figures could not be loaded." />
      ) : null}

      {CHAPTERS.map((c, ci) => (
        <section key={c.id} aria-labelledby={`part-${c.id}`} className="mt-10">
          <div className="flex items-baseline gap-4 border-b border-teal/30 pb-3">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-teal">Part {ci + 1}</span>
            <h2 id={`part-${c.id}`} className="text-[clamp(22px,2.6vw,32px)] font-bold">
              {c.title}
            </h2>
          </div>
          {STEPS.filter((s) => s.chapter === c.id).map((s) => {
            n += 1;
            return <Step key={s.id} step={s} n={n} fig={figs.data?.get(s.figure)} experts={experts} />;
          })}
        </section>
      ))}

      <section aria-labelledby="validation-title" className="glass mt-10 bg-[rgba(251,248,241,.92)] p-6 sm:p-9">
        <p className="kicker">Part 5 · Test everything</p>
        <h2 id="validation-title" className="mt-2 text-[clamp(22px,2.6vw,32px)] font-bold">
          How we checked each step
        </h2>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink/85">
          {experts
            ? 'Generated by pipeline/08b_validation.py from each script’s own test outputs (docs/07 §8); nothing is typed by hand. ⚠️ passes with an explained limit; ❌ means the claim was dropped or is shown as a range (E4 → arrival 13–19 h); ⏳ tests were not run for v1 and are listed so the gap stays visible.'
            : 'Each step has tests. Some pass, some pass with a limit we explain, some fail, and then we drop the claim or show a range instead. A few were not run yet; we list them anyway.'}
        </p>

        {counts.length ? (
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Test results summary">
            {counts.map(([s, k]) => (
              <li key={s} className="rounded-[12px] border border-hairline bg-ink/[.04] px-4 py-3">
                <p className="font-mono text-[28px] leading-none">
                  <span aria-hidden>{STATUS[s].icon}</span> {k}
                </p>
                <p className="mt-1.5 text-[12px] text-mute">{STATUS[s].label}</p>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-6">
          {v.isPending ? <DataState kind="loading" subject="Validation table" /> : null}
          {v.isError ? (
            <DataState
              kind={dataStateForError(v.error).kind}
              subject="Validation table"
              {...(dataStateForError(v.error).retryable ? { onRetry: () => void v.refetch() } : {})}
            />
          ) : null}
          {v.data && v.data.placeholder ? (
            <DataState kind="missing" subject="Validation table" message="The validation results are a placeholder in this bundle." />
          ) : null}
          {v.data && !v.data.placeholder ? (
            experts ? (
              <ValidationTable tests={v.data.tests} />
            ) : (
              <details className="group rounded-[12px] border border-hairline bg-ink/[.04] p-4">
                <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.16em] text-teal">
                  Show all {v.data.tests.length} tests
                </summary>
                <div className="mt-4">
                  <ValidationTable tests={v.data.tests} />
                </div>
              </details>
            )
          ) : null}
        </div>

        <HonestyNote label="Honest limits" className="mt-6">
          Water area: the threshold moves the area a lot (band drawn on the chart). Anomaly rule: thresholds were set on
          this event (retrospective), and later flags need an operator check. Floods: 30 m terrain without channel
          bathymetry, assumed release shape and duration, arrival times sensitive to the mesh; screening level, not a
          forecast. Level: SWOT measures height; the storage change is net of inflow, not the released volume.
        </HonestyNote>
      </section>
    </div>
  );
}
