import { scaleLinear, scaleTime } from '@visx/scale';
import { useId, useMemo, useState } from 'react';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { dataStateForError } from '@/components/data-state-model';
import { useAlerts, useManifest, useReservoirArea } from '@/data/hooks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import { FAILURE_DATE, fmt } from './facts';
import {
  type AreaPoint,
  dayMs,
  firstConfirmedAlert,
  flagsOf,
  fmtDay,
  type MedianSample,
  rollingMedian,
  summariseArea,
} from './series';
import { type ChartAnnotation, chartAnnotations, medianSegments, SENSOR_COLOR } from './chart-model';
import { Panel } from './ui';

const W = 560;
const H = 250;
const M = { l: 36, r: 12, t: 44, b: 24 };

const TONE: Record<ChartAnnotation['tone'], string> = {
  event: 'rgba(233,241,255,.55)',
  alert: '#ff5a5a',
  season: 'rgba(95,243,255,.55)',
};

export function ReservoirChart({ className }: { className?: string }) {
  const series = useReservoirArea();
  const alerts = useAlerts();
  const manifest = useManifest();
  const date = useAppStore((s) => s.date);
  const setDate = useAppStore((s) => s.setDate);
  const [hover, setHover] = useState<AreaPoint | null>(null);
  const [table, setTable] = useState(false);
  const hatchId = useId().replace(/:/g, '');
  const titleId = useId();

  const chipDates = useMemo(
    () =>
      [...new Set((manifest.data?.layers ?? []).filter((l) => l.kind === 'radar' && l.date).map((l) => l.date!))].sort(),
    [manifest.data],
  );

  const model = useMemo(() => {
    if (!series.data) return null;
    const s = series.data;
    const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
    const med = rollingMedian(pts);
    const sum = summariseArea(s, { failure: FAILURE_DATE });
    const first = alerts.data ? firstConfirmedAlert(flagsOf(alerts.data)) : null;
    const anns = chartAnnotations(s, first?.flag.date ?? null, sum.riseDate);
    const t0 = dayMs(pts[0]!.date) - 4 * 86_400_000;
    const t1 = dayMs(pts[pts.length - 1]!.date) + 4 * 86_400_000;
    const rel = pts.filter((p) => p.confidence !== 'low');
    const hi = Math.max(...rel.map((p) => p.area_km2), ...med.map((m) => m.median + m.sigma));
    const lo = Math.min(...rel.map((p) => p.area_km2), ...med.map((m) => m.median - m.sigma));
    const x = scaleTime({ domain: [new Date(t0), new Date(t1)], range: [M.l, W - M.r] });
    const y = scaleLinear({ domain: [Math.floor(lo * 2) / 2, Math.ceil(hi * 2) / 2], range: [H - M.b, M.t], nice: false });
    return { pts, med, segs: medianSegments(med, s.gaps ?? []), anns, x, y, sum, gaps: s.gaps ?? [] };
  }, [series.data, alerts.data]);

  const prov = series.data ? provenanceProps(series.data) : null;

  if (series.isPending) return <DataState kind="loading" subject="Lake area series" minHeight={260} className={className} />;
  if (series.isError || !model || !prov)
    return (
      <DataState
        kind={series.isError ? dataStateForError(series.error).kind : 'missing'}
        subject="Lake area series"
        message="This layer could not be loaded."
        className={cn('pointer-events-auto', className)}
      />
    );

  const { pts, segs, anns, x, y, gaps, med } = model;
  const [y0, y1] = y.domain() as [number, number];
  const px = (d: string) => x(new Date(dayMs(d))) ?? 0;
  const py = (v: number) => y(Math.max(y0, Math.min(y1, v))) ?? 0;

  const nearestChip = (d: string): string | null => {
    if (chipDates.length === 0) return null;
    return chipDates.reduce((b, c) => (Math.abs(dayMs(c) - dayMs(d)) < Math.abs(dayMs(b) - dayMs(d)) ? c : b));
  };
  const pick = (p: AreaPoint) => {
    const c = nearestChip(p.date);
    if (c) setDate(c);
  };

  const shown = hover ?? pts.find((p) => p.date === date && p.sensor === 'NISAR') ?? pts.find((p) => p.date === date) ?? null;
  const cursorX = px(date);
  const yTicks = y.ticks(5);
  const xTicks = x.ticks(6);

  const bandPath = (seg: MedianSample[]) =>
    `M${seg.map((s) => `${px(s.date)},${py(s.median + s.sigma)}`).join('L')}L${[...seg]
      .reverse()
      .map((s) => `${px(s.date)},${py(s.median - s.sigma)}`)
      .join('L')}Z`;
  const linePath = (seg: MedianSample[]) => `M${seg.map((s) => `${px(s.date)},${py(s.median)}`).join('L')}`;

  return (
    <Panel
      label="Lake area"
      labelId={titleId}
      badge={<Badge {...prov} subject="Lake area series" />}
      right={
        <p className="font-mono text-[11px] text-mute" aria-live="polite">
          {shown ? (
            <>
              <span className="text-ink">{fmtDay(shown.date)}</span> · {shown.sensor === 'S1' ? 'S1' : 'NISAR'}{' '}
              {shown.track.split('/')[0]} ·{' '}
              <span className="text-ink">{fmt(shown.area_km2, 2)} km²</span>
              {shown.confidence === 'low' ? ' · low confidence' : ''}
            </>
          ) : (
            fmtDay(date)
          )}
        </p>
      }
      className={className}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full select-none"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-desc`}
        onMouseLeave={() => setHover(null)}
      >
        <desc id={`${titleId}-desc`}>
          Lake water area in square kilometres, {pts.length} radar measurements from {fmtDay(pts[0]!.date)} to{' '}
          {fmtDay(pts[pts.length - 1]!.date)}, with a 21-day median line and a ±2 dB threshold band. A data table
          follows.
        </desc>
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(233,241,255,.13)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* grid + y axis */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={py(t)} y2={py(t)} stroke="rgba(233,241,255,.07)" />
            <text x={M.l - 6} y={py(t)} dy="0.32em" textAnchor="end" className="fill-mute font-mono text-[9px]">
              {fmt(t, 1)}
            </text>
          </g>
        ))}
        <text x={M.l - 6} y={M.t - 12} textAnchor="end" className="fill-mute font-mono text-[9px]">
          km²
        </text>
        {xTicks.map((t) => (
          <text
            key={t.getTime()}
            x={x(t)}
            y={H - 6}
            textAnchor="middle"
            className="fill-mute font-mono text-[9px]"
          >
            {t.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}
          </text>
        ))}

        {/* NISAR gap */}
        {gaps.map(([a, b]) => (
          <g key={a}>
            <rect x={px(a)} y={M.t} width={Math.max(2, px(b) - px(a))} height={H - M.t - M.b} fill={`url(#${hatchId})`} />
            <text
              x={(px(a) + px(b)) / 2}
              y={H - M.b - 6}
              textAnchor="middle"
              className="fill-mute font-mono text-[8px] uppercase tracking-[0.12em]"
            >
              no NISAR
            </text>
          </g>
        ))}

        {/* uncertainty band + median line */}
        {segs.map((seg, i) => (
          <path key={`b${i}`} d={bandPath(seg)} fill="rgba(95,243,255,.10)" />
        ))}
        {segs.map((seg, i) => (
          <path
            key={`l${i}`}
            d={linePath(seg)}
            fill="none"
            stroke="rgba(233,241,255,.85)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}

        {/* annotations */}
        {anns.map((a, i) => {
          const ax = px(a.date);
          const row = i % 3;
          const flip = ax > W - 120;
          return (
            <g key={a.label}>
              <line
                x1={ax}
                x2={ax}
                y1={M.t - 4 - row * 11}
                y2={H - M.b}
                stroke={TONE[a.tone]}
                strokeDasharray={a.tone === 'season' ? '2 3' : '3 3'}
              />
              <text
                x={ax + (flip ? -4 : 4)}
                y={M.t - 6 - row * 11}
                textAnchor={flip ? 'end' : 'start'}
                fill={a.tone === 'alert' ? '#ff8a8a' : 'rgba(233,241,255,.85)'}
                className="font-mono text-[9px]"
              >
                {a.label}
              </text>
            </g>
          );
        })}

        {/* cursor = store date */}
        <line x1={cursorX} x2={cursorX} y1={M.t} y2={H - M.b} stroke="#5ff3ff" strokeWidth={1.5} opacity={0.9} />

        {/* points */}
        {pts.map((p) => {
          const cx = px(p.date);
          const clamped = p.area_km2 < y0;
          const cy = py(p.area_km2);
          const color = SENSOR_COLOR[p.sensor];
          const low = p.confidence === 'low';
          const active = shown === p;
          const r = active ? 4.5 : 3;
          const common = {
            onMouseEnter: () => setHover(p),
            onClick: () => pick(p),
            className: 'cursor-pointer',
          };
          return (
            <g key={`${p.date}-${p.track}-${p.time_utc ?? ''}`} {...common}>
              <circle cx={cx} cy={cy} r={8} fill="transparent" />
              {clamped ? (
                <path d={`M${cx - 4},${cy - 5}L${cx + 4},${cy - 5}L${cx},${cy + 1}Z`} fill="none" stroke={color} />
              ) : p.sensor === 'S1' ? (
                <rect
                  x={cx - r}
                  y={cy - r}
                  width={r * 2}
                  height={r * 2}
                  rx={0.8}
                  fill={low ? 'none' : color}
                  fillOpacity={low ? 0 : 0.75}
                  stroke={low || active ? color : '#060c14'}
                  strokeWidth={low ? 1.2 : 1}
                />
              ) : (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r + 0.5}
                  fill={low ? 'none' : color}
                  stroke={low ? color : active ? '#fff' : '#060c14'}
                  strokeWidth={1.2}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-mute">
        <li className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <circle cx="5" cy="5" r="4" fill={SENSOR_COLOR.NISAR} />
          </svg>
          NISAR L-band
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <rect x="1" y="1" width="8" height="8" rx="1" fill={SENSOR_COLOR.S1} />
          </svg>
          Sentinel-1 C-band
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <rect x="1" y="1" width="8" height="8" rx="1" fill="none" stroke={SENSOR_COLOR.S1} />
          </svg>
          Low confidence (wind) · off the line{pts.some((p) => p.area_km2 < y0) ? ', ▼ = below axis' : ''}
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="16" height="10" aria-hidden>
            <rect x="0" y="1" width="16" height="8" fill="rgba(95,243,255,.18)" />
            <line x1="0" x2="16" y1="5" y2="5" stroke="rgba(233,241,255,.85)" strokeWidth="2" />
          </svg>
          21-day median · ±2 dB band
        </li>
      </ul>
      <p className="mt-1.5 text-[11px] text-mute">Click a point to show the nearest radar image on the lake.</p>

      <button
        type="button"
        className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-teal underline-offset-2 hover:underline"
        aria-expanded={table}
        onClick={() => setTable((v) => !v)}
      >
        {table ? 'Hide' : 'Show'} data table
      </button>
      {table ? (
        <div className="mt-2 max-h-48 overflow-auto rounded border border-hairline">
          <table className="w-full text-left font-mono text-[10.5px]">
            <caption className="sr-only">Lake area measurements and 21-day median</caption>
            <thead className="sticky top-0 bg-[#08101c] text-mute">
              <tr>
                <th className="px-2 py-1">Date</th>
                <th className="px-2 py-1">Sensor</th>
                <th className="px-2 py-1">Track</th>
                <th className="px-2 py-1 text-right">Area km²</th>
                <th className="px-2 py-1 text-right">± km²</th>
                <th className="px-2 py-1">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr key={`${p.date}-${p.track}-${p.time_utc ?? ''}`} className="border-t border-hairline">
                  <td className="px-2 py-0.5">{p.date}</td>
                  <td className="px-2 py-0.5">{p.sensor}</td>
                  <td className="px-2 py-0.5">{p.track}</td>
                  <td className="px-2 py-0.5 text-right">{fmt(p.area_km2, 2)}</td>
                  <td className="px-2 py-0.5 text-right">{p.sigma_km2 === null ? '–' : fmt(p.sigma_km2, 2)}</td>
                  <td className="px-2 py-0.5">{p.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2 py-1 text-[10px] text-mute">
            Median samples: {med.length}, window ±10 days, reliable points only.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
