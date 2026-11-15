import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { HonestyNote } from '@/components/HonestyNote';
import { StaticBundleSource } from '@/data/StaticBundleSource';
import { fmt } from '@/features/story/facts';
import { flagsOf, fmtDayYear, handAt, reliablePoints, rollingMedian } from '@/features/story/series';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

import type { Dam } from './data';

/** Per-dam bundle written by pipeline/v2/run_dam.py; Mellègue keeps its V1 bundle. */
function bundleBase(id: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return id === 'mellegue' ? `${base}/data/2026-11-15` : `${base}/data/v2/${id}`;
}

function useDamBundle(dam: Dam) {
  const src = useMemo(() => new StaticBundleSource({ baseUrl: bundleBase(dam.id) }), [dam.id]);
  const opt = { staleTime: Infinity, retry: false } as const;
  const manifest = useQuery({ queryKey: ['v2b', dam.id, 'manifest'], queryFn: () => src.manifest(), ...opt });
  const ok = manifest.isSuccess;
  const area = useQuery({ queryKey: ['v2b', dam.id, 'area'], queryFn: () => src.reservoirArea(dam.id), enabled: ok, ...opt });
  const alerts = useQuery({ queryKey: ['v2b', dam.id, 'alerts'], queryFn: () => src.alerts(dam.id), enabled: ok, ...opt });
  const level = useQuery({ queryKey: ['v2b', dam.id, 'level'], queryFn: () => src.levelVolume(dam.id), enabled: ok, ...opt });
  const hand = useQuery({ queryKey: ['v2b', dam.id, 'hand'], queryFn: () => src.handLut(dam.id), enabled: ok, ...opt });
  return { src, manifest, area, alerts, level, hand };
}

const W = 640;
const H = 170;

function AreaChart({ points }: { points: { date: string; area_km2: number; sensor: string; low_confidence?: boolean | null }[] }) {
  const med = useMemo(() => rollingMedian(points as never), [points]);
  if (points.length < 2) return null;
  const t = points.map((p) => Date.parse(p.date));
  const t0 = Math.min(...t);
  const t1 = Math.max(...t);
  const a = points.map((p) => p.area_km2);
  const lo = Math.min(...a, ...med.map((m) => m.median - m.sigma)) * 0.95;
  const hi = Math.max(...a, ...med.map((m) => m.median + m.sigma)) * 1.05;
  const X = (d: string) => 30 + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (W - 40);
  const Y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 30);
  const line = med.map((m, i) => `${i ? 'L' : 'M'}${X(m.date).toFixed(1)},${Y(m.median).toFixed(1)}`).join('');
  const band =
    med.map((m, i) => `${i ? 'L' : 'M'}${X(m.date).toFixed(1)},${Y(m.median + m.sigma).toFixed(1)}`).join('') +
    [...med].reverse().map((m) => `L${X(m.date).toFixed(1)},${Y(m.median - m.sigma).toFixed(1)}`).join('') +
    'Z';
  const months: string[] = [];
  for (let d = new Date(t0); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1, 1)) months.push(d.toISOString().slice(0, 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Lake area measured by NISAR and Sentinel-1">
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line x1={30} x2={W - 10} y1={Y(v)} y2={Y(v)} stroke="rgba(233,241,255,.07)" />
          <text x={26} y={Y(v) + 3} textAnchor="end" className="fill-mute font-mono" fontSize={9}>
            {fmt(v, 1)}
          </text>
        </g>
      ))}
      {months.map((m) => (
        <text key={m} x={X(m)} y={H - 6} className="fill-mute font-mono" fontSize={9}>
          {new Date(m).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}
        </text>
      ))}
      <path d={band} fill="rgba(95,243,255,.10)" />
      <path d={line} fill="none" stroke="#e9f1ff" strokeOpacity={0.8} strokeWidth={1.6} />
      {points.map((p, i) =>
        p.sensor === 'NISAR' ? (
          <circle key={i} cx={X(p.date)} cy={Y(p.area_km2)} r={3} fill={p.low_confidence ? 'none' : '#5ff3ff'} stroke="#5ff3ff" />
        ) : (
          <rect key={i} x={X(p.date) - 2.5} y={Y(p.area_km2) - 2.5} width={5} height={5} fill={p.low_confidence ? 'none' : '#ffb547'} stroke="#ffb547" />
        ),
      )}
    </svg>
  );
}

/** Real results for a processed dam: radar chips, NISAR + Sentinel-1 lake area, alerts, SWOT, quick flood. */
export function DamResults({ dam }: { dam: Dam }) {
  const experts = useAppStore((s) => s.level === 'experts');
  const b = useDamBundle(dam);
  const [vol, setVol] = useState(20);

  if (b.manifest.isPending) return <p className="p-5 font-mono text-[12px] text-mute">Loading this dam’s results…</p>;
  if (b.manifest.isError)
    return (
      <p className="p-5 text-[13.5px] text-ink/75">
        No processed results for this dam yet: only its geometry is ready. Processing a new dam (radar series, alerts,
        flood table) is a queued job in V2.
      </p>
    );

  const pts = b.area.data ? [...b.area.data.points].sort((x, y) => x.date.localeCompare(y.date)) : [];
  const rel = reliablePoints(pts as never) as typeof pts;
  const nN = pts.filter((p) => p.sensor === 'NISAR').length;
  const nS = pts.length - nN;
  const latest = rel[rel.length - 1];
  const flags = b.alerts.data ? flagsOf(b.alerts.data) : [];
  const lastEval = b.alerts.data?.evaluations[b.alerts.data.evaluations.length - 1];
  const swot = b.level.data?.swot;
  const good = (swot?.points ?? []).filter((p) => p.quality === 0);
  const lastGood = good[good.length - 1];
  const radar = (b.manifest.data?.layers ?? []).filter((l) => l.kind === 'radar' && l.mask).sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
  const chips = radar.length > 2 ? [radar[0]!, radar[radar.length - 1]!] : radar;
  const rows = b.hand.data?.rows ?? [];
  const hr = rows.length ? handAt(rows, vol * 1e6) : null;

  return (
    <div className="border-t border-hairline p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="kicker">Results for {dam.name}</p>
        <span className="rounded-pill border border-ok/50 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ok">
          Processed · NISAR + Sentinel-1
        </span>
      </div>

      {chips.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {chips.map((l) => (
            <figure key={l.id} className="m-0">
              <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-[10px] border border-hairline">
                <img src={b.src.fileUrl(l.file)} alt={`${l.label}, radar backscatter`} className="block aspect-square w-full object-cover" loading="lazy" />
                <img src={b.src.fileUrl(l.mask!)} alt={`${l.label} water mask`} className="block aspect-square w-full object-cover" loading="lazy" />
              </div>
              <figcaption className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[10.5px] text-mute">
                <span>
                  INPUT | WATER MASK · {l.sensor === 'S1' ? 'Sentinel-1' : l.sensor} {l.track ?? ''} · {l.date ? fmtDayYear(l.date) : ''}
                </span>
                <Badge {...provenanceProps(l)} subject={l.label} className="h-[18px] px-1.5 text-[9px]" />
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {b.area.data ? (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <p className="telemetry-label">Lake area · {nN} NISAR + {nS} Sentinel-1</p>
            <Badge {...provenanceProps(b.area.data)} subject="Lake area series" />
          </div>
          <AreaChart points={pts} />
          <p className="font-mono text-[10px] text-mute">
            <span className="text-teal">●</span> NISAR L-band · <span className="text-alert">■</span> Sentinel-1 C-band · hollow = low
            confidence · line = 21-day median · band = threshold ±2 dB
          </p>
          {latest ? (
            <p className="mt-2 text-[13.5px] text-ink/85">
              Latest: <strong className="font-mono">{fmt(latest.area_km2, 2)} km²</strong> on {fmtDayYear(latest.date)} (
              {latest.sensor === 'S1' ? 'Sentinel-1' : 'NISAR'} {latest.track}).
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-mute">Lake area series not in this bundle.</p>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-[12px] border border-hairline p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="telemetry-label">Automatic alert</p>
            {b.alerts.data ? <Badge {...provenanceProps(b.alerts.data)} subject="Anomaly detector" /> : null}
          </div>
          {b.alerts.data && lastEval ? (
            <>
              <p className="mt-2 text-[13.5px]">
                Last check {fmtDayYear(lastEval.date)}: <strong>{lastEval.level}</strong>
              </p>
              <p className="mt-1 text-[12.5px] text-ink/75">
                {flags.length} flag{flags.length === 1 ? '' : 's'} in {b.alerts.data.evaluations.length} checks.{' '}
                {experts ? lastEval.text.experts : 'Monitoring only: no known event to test the alarm against at this dam.'}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-mute">Not computed.</p>
          )}
        </div>
        <div className="rounded-[12px] border border-hairline p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="telemetry-label">Water level · SWOT</p>
            {b.level.data ? <Badge {...provenanceProps(b.level.data)} subject="SWOT level" /> : null}
          </div>
          {swot?.available && lastGood ? (
            <>
              <p className="mt-2 font-mono text-[22px] leading-none">
                {fmt(lastGood.wse_m, 2)} <span className="text-[11px] text-mute">m ± {fmt(lastGood.wse_u, 2)}</span>
              </p>
              <p className="mt-1 font-mono text-[11px] text-mute">
                last good pass {fmtDayYear(lastGood.time)} · {good.length} good of {swot.points?.length ?? 0} passes
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-mute">{swot?.reason ?? 'No SWOT lake for this reservoir.'}</p>
          )}
        </div>
      </div>

      {rows.length && hr ? (
        <div className="mt-5 rounded-[12px] border border-hairline p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="telemetry-label">Quick flood (HAND) · scenario, not a forecast</p>
            <Badge {...provenanceProps(b.hand.data!)} subject="HAND flood table" />
          </div>
          <label className="mt-3 flex items-center gap-3">
            <span className="w-28 shrink-0 font-mono text-[13px]">{fmt(vol)} Mm³</span>
            <input
              type="range"
              min={Math.log10(Math.max(1, rows[0]!.V_m3 / 1e6))}
              max={Math.log10(rows[rows.length - 1]!.V_m3 / 1e6)}
              step={0.01}
              value={Math.log10(vol)}
              onChange={(e) => setVol(Math.round(10 ** Number(e.target.value)))}
              className="w-full accent-[#ffb547]"
              aria-label="Released volume (million m³)"
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Water height', fmt(hr.h, 2), 'm'],
              ['Wet area', fmt(hr.area_km2, 1), 'km²'],
              ['Cropland', fmt(hr.cropland_ha), 'ha'],
              ['Villages', String(hr.villages), ''],
            ].map(([l, v, u]) => (
              <div key={l} className="border-l border-hairline pl-3">
                <p className="telemetry-label">{l}</p>
                <p className="mt-1 font-mono text-[20px] leading-none">
                  {v} <span className="text-[10px] text-mute">{u}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <HonestyNote kind="info" label="First automatic run" className={cn('mt-5')}>
        Produced by the V2 pipeline with no manual tuning for this dam. Areas follow the V1 method (adaptive threshold
        inside a radar-derived lake outline); there is no known event here, so the alarm is shown as monitoring, not as a
        validated detection.
      </HonestyNote>
    </div>
  );
}
