import { Badge } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import { DataState } from '@/components/DataState';
import { HonestyNote } from '@/components/HonestyNote';
import { useAnugaIndex, useEvents, useLevelVolume } from '@/data/hooks';
import { useCatchments, useFlowpathMeta } from '@/data/vectors';

import { FAILURE_DATE, fmt, fmtSigned } from './facts';
import { daysBetween, fmtDay } from './series';
import { Panel } from './ui';
import { useAnugaStatsAll } from './useStoryData';

/** Act 4: corridor profile strip dam → Sidi Salem with ANUGA arrival hours and the reported arrival. */
export function CorridorStrip({ className }: { className?: string }) {
  const fp = useFlowpathMeta();
  const index = useAnugaIndex();
  const stats = useAnugaStatsAll();
  const events = useEvents();
  if (fp.isPending) return <DataState kind="loading" subject="Flow path" minHeight={160} className={className} />;
  if (!fp.data) return <DataState kind="error" subject="Flow path" message="This layer could not be loaded." className={className} />;
  const len = fp.data.length_km;
  const v21 = index.data?.scenarios.find((s) => s.id === 'v21_d12');
  const st = stats['v21_d12'];
  const arrival = events.data?.events.find((e) => e.kind === 'arrival');
  const stations = [{ name: 'Mellègue dam', dist_km: 0 }, ...fp.data.reach_breaks];
  const conf = fp.data.reach_breaks.find((b) => /confluence/i.test(b.name));
  const hoursAt = (name: string) => {
    if (!st) return undefined;
    const e = Object.entries(st.arrival_h).find(([k]) => k.toLowerCase() === name.toLowerCase());
    return e?.[1];
  };
  return (
    <Panel
      label="Where the water went"
      badge={<Badge kind={fp.data.badge} source={fp.data.dem} method={fp.data.method} subject="Flow path" />}
      right={<span className="font-mono text-[11px] text-ink">{fmt(len)} km</span>}
      className={className}
    >
      {/* the path as a bar with a dot per station (to scale), then the stations as a list */}
      <div className="relative mx-1 mt-4 h-4" aria-hidden>
        <div className="absolute inset-x-0 top-1.5 h-[3px] rounded-pill bg-gradient-to-r from-teal via-water to-flood-3" />
        {conf ? (
          <div
            className="absolute top-0 h-4 rounded-[3px] border border-dashed border-model/60 bg-model/10"
            style={{ left: 0, width: `${((conf.dist_km + 2) / len) * 100}%` }}
          />
        ) : null}
        {stations.map((s) => (
          <span
            key={s.name}
            className="absolute top-[3px] block size-2.5 -translate-x-1/2 rounded-full border-2 border-bg bg-ink"
            style={{ left: `${(s.dist_km / len) * 100}%` }}
          />
        ))}
      </div>
      <ol className="mt-3 divide-y divide-hairline">
        {stations.map((s, i) => {
          const h = i === 0 ? 0 : hoursAt(s.name);
          const isEnd = i === stations.length - 1;
          return (
            <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,120px)] items-baseline gap-2 py-1.5 font-mono text-[11px]">
              <span className="text-ink">{s.name}</span>
              <span className="text-right text-mute">km {fmt(s.dist_km, 1)}</span>
              <span className="text-right">
                {i === 0 ? (
                  <span className="text-mute">release</span>
                ) : h !== undefined ? (
                  <span className="text-model">{/confluence/i.test(s.name) ? '+13–19 h' : `+${fmt(h, 0)} h`}</span>
                ) : isEnd && arrival ? (
                  <span className="text-ink">
                    {fmtDay(arrival.date)} · +{daysBetween(FAILURE_DATE, arrival.date)} d
                  </span>
                ) : (
                  <span className="text-mute">outside ANUGA</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-mute">
        <span className="inline-block h-2 w-5 border border-dashed border-model/60 bg-model/10" aria-hidden />
        ANUGA domain (21 Mm³, 12 h assumed release; arrival is mesh-sensitive, 13–19 h at the confluence)
        {v21 ? <Badge {...provenanceProps(v21)} subject="ANUGA arrival times" /> : null}
        {arrival ? <Badge kind={arrival.badge} source="AllAfrica; Tunisie Numérique (see Sources)" subject="Arrival at Sidi Salem" /> : null}
      </div>
      {st
        ? Object.entries(st.arrival_h)
            .filter(([k]) => !stations.some((s) => s.name.toLowerCase() === k.toLowerCase()))
            .map(([k, h]) => (
              <p key={k} className="mt-1.5 font-mono text-[10.5px] text-ink/80">
                {k}: water within 200 m after ≈ {fmt(h, 0)} h (ANUGA, 21 Mm³)
              </p>
            ))
        : null}
    </Panel>
  );
}

/** Act 8: SWOT level chart + storage change vs reported volume, exactly as the bundle holds it. */
export function LevelVolumeCard({ className }: { className?: string }) {
  const lv = useLevelVolume();
  if (lv.isPending) return <DataState kind="loading" subject="Level and volume" minHeight={180} className={className} />;
  if (!lv.data) return <DataState kind="error" subject="Level and volume" message="This layer could not be loaded." className={className} />;
  const d = lv.data;
  const prov = provenanceProps(d);
  if (d.placeholder || !d.swot.available) {
    return (
      <Panel label="Level & volume" badge={<Badge kind="illustrative" placeholder source={d.source} subject="Level and volume" />} className={className}>
        <p className="text-sm text-ink/85">Not computed yet: method only, no result. {d.swot.reason}</p>
      </Panel>
    );
  }
  const pts = (d.swot.points ?? []).filter((p) => p.time >= '2026-01-01').sort((a, b) => a.time.localeCompare(b.time));
  const W = 520;
  const H = 150;
  const M = { l: 34, r: 8, t: 10, b: 18 };
  const t0 = Date.parse(pts[0]?.time ?? '2026-03-01');
  const t1 = Date.parse(pts[pts.length - 1]?.time ?? '2026-11-01');
  const lo = Math.floor(Math.min(...pts.map((p) => p.wse_m - p.wse_u)));
  const hi = Math.ceil(Math.max(...pts.map((p) => p.wse_m + p.wse_u)));
  const x = (t: string) => M.l + ((Date.parse(t) - t0) / (t1 - t0 || 1)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo || 1)) * (H - M.t - M.b);
  const fx = x(`${FAILURE_DATE}T21:15:00Z`);
  const dv = d.delta_volume[0];
  const rep = d.reported[0];
  return (
    <Panel label="Lake level · SWOT" badge={<Badge {...prov} subject="SWOT lake level" />} className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`SWOT water-surface elevation, ${pts.length} passes in 2026`}>
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="rgba(233,241,255,.07)" />
            <text x={M.l - 5} y={y(v)} dy="0.32em" textAnchor="end" className="fill-mute font-mono text-[9px]">
              {fmt(v, 0)}
            </text>
          </g>
        ))}
        <text x={M.l - 5} y={H - 4} textAnchor="end" className="fill-mute font-mono text-[9px]">m</text>
        <line x1={fx} x2={fx} y1={M.t} y2={H - M.b} stroke="rgba(233,241,255,.55)" strokeDasharray="3 3" />
        <text x={fx + 4} y={M.t + 8} className="fill-ink font-mono text-[9px]">Failure {fmtDay(FAILURE_DATE)}</text>
        <path
          d={`M${pts.map((p) => `${x(p.time)},${y(p.wse_m)}`).join('L')}`}
          fill="none"
          stroke="rgba(95,243,255,.5)"
          strokeWidth={1.5}
        />
        {pts.map((p) => (
          <circle
            key={p.time}
            cx={x(p.time)}
            cy={y(p.wse_m)}
            r={3.5}
            fill={p.quality === 0 ? '#5ff3ff' : 'none'}
            stroke="#5ff3ff"
            strokeWidth={1.2}
          >
            <title>{`${p.time.slice(0, 10)}: ${fmt(p.wse_m, 2)} ± ${fmt(p.wse_u, 2)} m${p.quality === 0 ? '' : ' (suspect quality)'}`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-1 font-mono text-[10px] text-mute">● good quality · ○ suspect quality (shown, not used for the numbers)</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {dv ? (
          <div className="border-l border-hairline pl-3">
            <p className="telemetry-label">Storage change {fmtDay(dv.from)} → {fmtDay(dv.to)}</p>
            <p className="mt-1.5 font-mono text-[22px] leading-none">
              {fmtSigned(dv.dV_m3 / 1e6, 1)} <span className="text-[11px] text-mute">Mm³</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-mute">
              range {fmtSigned(dv.low / 1e6, 1)} … {fmtSigned(dv.high / 1e6, 1)}
            </p>
            <div className="mt-1.5"><Badge kind="modelled" source={d.source} method={dv.method} uncertainty={d.uncertainty} subject="Storage change" /></div>
          </div>
        ) : null}
        {rep ? (
          <div className="border-l border-hairline pl-3">
            <p className="telemetry-label">Reported release</p>
            <p className="mt-1.5 font-mono text-[22px] leading-none">
              {fmt(rep.value_m3 / 1e6)}
              {rep.alt ? `–${fmt(rep.alt / 1e6)}` : ''} <span className="text-[11px] text-mute">Mm³</span>
            </p>
            <div className="mt-1.5"><Badge kind="reported" source={rep.source} subject="Reported release" /></div>
          </div>
        ) : null}
      </div>
      <HonestyNote kind="info" label="Storage change ≠ release" className="mt-3">
        About 0.6 × the reported 21 Mm³ (0.4 × the 29 Mm³ report). It is the net storage change 7–28 June, net of
        inflow, and the release went on until the 16 July repair, so it is not the released volume. SWOT’s lake
        polygon is larger than the radar water area; the level is unaffected.
      </HonestyNote>
    </Panel>
  );
}

/** Act 9: catchments (derived) + honest coverage. */
export function CatchmentCard({ className }: { className?: string }) {
  const c = useCatchments();
  if (c.isPending) return <DataState kind="loading" subject="Catchments" minHeight={100} className={className} />;
  if (!c.data) return <DataState kind="error" subject="Catchments" message="This layer could not be loaded." className={className} />;
  return (
    <Panel
      label="Catchments"
      badge={
        <Badge
          kind="modelled"
          source={c.layer?.source ?? 'HydroBASINS'}
          method={c.layer?.method ?? ''}
          uncertainty={c.layer?.uncertainty ?? ''}
          subject="Catchments (derived)"
        />
      }
      className={className}
    >
      <div className="grid grid-cols-2 gap-3">
        {c.data.map((k) => (
          <div key={k.id} className="border-l border-hairline pl-3">
            <p className="telemetry-label">{k.name}</p>
            <p className="mt-1.5 font-mono text-[22px] leading-none">
              {fmt(k.area_km2)} <span className="text-[11px] text-mute">km²</span>
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-mute">Other reservoirs: roadmap. No other dam is processed in this bundle.</p>
    </Panel>
  );
}
