import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';

import { handHeightM, handVolumeM3, pickAnuga, type DamBundle, type LonLatBox } from './bundle';
import type { Dam, DamIndex, GeoFC } from './data';
import { partsOf, pointsOf } from './data';
import { boxOf, makeProjection, pathD, type Box, type Position } from './projection';
import { loadHandSmall, paintHand, type SmallHand } from './raster';
import { ORDER, type StepId } from './steps';

/** A length in screen px at the current zoom (the stage sets --u = user units per screen px). */
const u = (px: number) => `calc(${px}px * var(--u))`;
const LABEL = { paintOrder: 'stroke', stroke: '#03050a', strokeWidth: u(3) } as const;
const at = (step: StepId, s: StepId) => ORDER.indexOf(step) >= ORDER.indexOf(s);
const LAKE_STEPS: StepId[] = ['radar', 'lake', 'alert', 'level'];

export interface RadarFrame {
  date: string;
  sensor: string;
  track: string;
}

interface Props {
  index: DamIndex;
  dams: Dam[];
  tunisia: GeoFC | undefined;
  dam: Dam | null;
  geo: GeoFC | undefined;
  bundle: DamBundle;
  step: StepId;
  reduced: boolean;
  onPick: (id: string) => void;
  /** radar image shown on the lake (for the caption outside the SVG) */
  onRadarFrame?: (f: RadarFrame | null) => void;
  /** current ANUGA hour (for the caption) */
  onFloodHour?: (h: number | null) => void;
}

/**
 * The map: Tunisia + the processed dams; for the picked dam, each step reveals its REAL result:
 * catchment and rivers, the radar images and water masks of the lake (flipbook), the D8 flow path,
 * the HAND flood rising to the scenario height, and the ANUGA hourly depth frames when computed.
 */
export function DamStage({ index, dams, tunisia, dam, geo, bundle: b, step, reduced, onPick, onRadarFrame, onFloodHour }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const vb = useRef<Box | null>(null);
  const [size, setSize] = useState({ w: 1000, h: 625 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      if (e && e.contentRect.width > 0 && e.contentRect.height > 0) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);
  const ASPECT = size.w / size.h;
  const proj = useMemo(() => makeProjection(index.tunisia_bbox, 1000), [index.tunisia_bbox]);
  const P = proj.project;

  const base = useMemo(
    () => ({
      country: pathD(partsOf(tunisia, 'country'), P, true),
      adm1: pathD(partsOf(tunisia, 'adm1'), P, true),
      rivers: pathD(partsOf(tunisia, 'river'), P),
    }),
    [tunisia, P],
  );
  const full: Box = useMemo(() => {
    const [w, s, e, n] = index.tunisia_bbox;
    return boxOf([[[w, s], [e, n]]], P, ASPECT, 0.04) ?? { x: 0, y: 0, w: proj.width, h: proj.width / ASPECT };
  }, [index.tunisia_bbox, P, ASPECT, proj.width]);

  const g = useMemo(() => {
    if (!dam || !geo) return null;
    const boxLL = (bb: LonLatBox, pad: number, min = 14) => boxOf([[[bb[0], bb[1]], [bb[2], bb[3]]]], P, ASPECT, pad, min);
    const catchment = partsOf(geo, 'catchment');
    const up = partsOf(geo, 'rivers_up');
    // the D8 flow path of the bundle (real routing); the catalogue's HydroRIVERS route as a fallback
    const d8 = (b.flowpath?.features ?? []).flatMap((f) => (f.geometry?.type === 'LineString' ? [f.geometry.coordinates as Position[]] : []));
    const down = d8.length ? d8 : partsOf(geo, 'river_down');
    const fp = (b.flowpath?.features[0]?.properties ?? {}) as Record<string, unknown>;
    const breaks = Array.isArray(fp['reach_breaks']) ? (fp['reach_breaks'] as { name?: string; dist_km?: number }[]) : [];
    const vd = Array.isArray(fp['vertex_dist_km']) ? (fp['vertex_dist_km'] as number[]) : null;
    const line = down[0] ?? [];
    const total = (typeof fp['length_km'] === 'number' ? (fp['length_km'] as number) : null) ?? dam.downstream_km ?? 1;
    const along = (km: number): Position | null => {
      if (!line.length) return null;
      if (vd && vd.length === line.length) {
        const i = vd.findIndex((d) => d >= km);
        return line[i < 0 ? line.length - 1 : i]!;
      }
      return line[Math.min(line.length - 1, Math.round((km / total) * (line.length - 1)))]!;
    };
    const named = breaks.length
      ? breaks.map((r) => ({ name: r.name ?? '', km: r.dist_km ?? 0 }))
      : pointsOf(geo, 'town').map((t) => ({ name: String(t.props['name'] ?? ''), km: Number(t.props['km'] ?? 0) }));
    const labels = named
      .filter((l) => l.name && !/cap$/i.test(l.name) && l.km > 0.5 && l.km <= total + 0.5)
      .flatMap((l) => {
        const p = along(l.km);
        return p ? [{ ...l, xy: P(p) }] : [];
      });
    const damPt = P([dam.lon, dam.lat]);
    const chip = b.scene?.lake_chip?.bounds_lonlat;
    return {
      catchment: pathD(catchment, P, true),
      up: up.map((l) => pathD([l], P)),
      down: pathD(down, P),
      labels,
      total,
      damPt,
      snapPt: down[0]?.[0] ? P(down[0][0]) : damPt,
      chip,
      boxDam: boxLL([dam.lon - 0.12, dam.lat - 0.08, dam.lon + 0.12, dam.lat + 0.08], 0),
      boxCatch: boxOf([...catchment, [[dam.lon, dam.lat]]], P, ASPECT, 0.08),
      boxLake: chip ? boxLL(chip, 0.06) : boxLL([dam.lon - 0.06, dam.lat - 0.04, dam.lon + 0.06, dam.lat + 0.04], 0),
      boxDown: boxOf([...down, [[dam.lon, dam.lat]]], P, ASPECT, 0.1),
    };
  }, [dam, geo, b.flowpath, b.scene, P, ASPECT]);

  const rect = (bb: LonLatBox) => {
    const [x0, y0] = P([bb[0], bb[3]]);
    const [x1, y1] = P([bb[2], bb[1]]);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };

  const target: Box = useMemo(() => {
    if (!g) return full;
    const pick = (x: Box | null) => x ?? full;
    if (step === 'find') return pick(g.boxDam);
    if (step === 'upstream') return pick(g.boxCatch);
    if (LAKE_STEPS.includes(step)) return pick(g.boxLake);
    return pick(g.boxDown);
  }, [g, step, full]);

  // ---- radar flipbook: the real chips + masks listed in the manifest
  const radar = useMemo(
    () =>
      (b.manifest?.layers ?? [])
        .filter((l) => l.kind === 'radar' && l.mask && l.grid === 'lake_chip')
        .sort((x, y) => (x.date ?? '').localeCompare(y.date ?? '')),
    [b.manifest],
  );
  const latestNisar = [...radar].reverse().find((l) => l.sensor === 'NISAR') ?? radar[radar.length - 1];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (step !== 'radar' || radar.length === 0) return;
    if (reduced) {
      setFrame(radar.length - 1);
      return;
    }
    let i = 0;
    setFrame(0);
    const t = window.setInterval(() => {
      i = Math.min(radar.length - 1, i + 1);
      setFrame(i);
      if (i === radar.length - 1) window.clearInterval(t);
    }, 520);
    return () => window.clearInterval(t);
  }, [step, radar, reduced]);
  const shownRadar = step === 'radar' ? radar[frame] : latestNisar;
  useEffect(() => {
    onRadarFrame?.(
      LAKE_STEPS.includes(step) && shownRadar
        ? { date: shownRadar.date ?? '', sensor: shownRadar.sensor ?? '', track: shownRadar.track ?? '' }
        : null,
    );
  }, [step, shownRadar, onRadarFrame]);

  // ---- HAND: decode once per dam, then let the water rise to the scenario height
  const [hand, setHand] = useState<SmallHand | null>(null);
  const [handUrl, setHandUrl] = useState<string | null>(null);
  useEffect(() => {
    setHand(null);
    if (!b.hand) return;
    let live = true;
    loadHandSmall(b.src.fileUrl(b.hand.hand_file), b.hand.hand_encoding.scale ?? 0.01)
      .then((r) => live && setHand(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [b.hand, b.src]);
  useEffect(() => {
    if (!hand || !b.hand || step !== 'hand') {
      setHandUrl(null);
      return;
    }
    const level = handHeightM(b.hand.rows, handVolumeM3(b.hand.rows));
    if (reduced) {
      setHandUrl(paintHand(hand, level));
      return;
    }
    const o = { h: 0 };
    const tw = gsap.to(o, { h: level, duration: 2.4, ease: 'power1.out', delay: 1.2, onUpdate: () => setHandUrl(paintHand(hand, o.h)) });
    return () => {
      tw.kill();
    };
  }, [hand, b.hand, step, reduced]);

  // ---- ANUGA: real hourly depth frames when a run is computed
  const an = pickAnuga(b.anuga, b.hand);
  const files = an?.files as { frames?: string; n_frames?: number; maxdepth?: string; dt_s?: number } | undefined;
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    if (step !== 'anuga' || !files) {
      setHour(null);
      return;
    }
    const n = files.n_frames ?? 0;
    if (reduced || !files.frames || n < 2) {
      setHour(-1);
      return;
    }
    let h = 0;
    setHour(0);
    const t = window.setInterval(() => {
      h = (h + 1) % n;
      setHour(h);
    }, 140);
    return () => window.clearInterval(t);
  }, [step, files, reduced]);
  useEffect(
    () => onFloodHour?.(hour !== null && hour >= 0 ? Math.round((hour * (files?.dt_s ?? 3600)) / 3600) : null),
    [hour, onFloodHour, files],
  );
  const anugaHref =
    hour === null || !files
      ? null
      : hour < 0 || !files.frames
        ? files.maxdepth
          ? b.src.fileUrl(files.maxdepth)
          : null
        : b.src.fileUrl(files.frames.replace('{i}', String(hour)));

  // ---- viewBox flight
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const s = { ...(vb.current ?? full) };
    const apply = () => {
      svg.setAttribute('viewBox', `${s.x.toFixed(2)} ${s.y.toFixed(2)} ${s.w.toFixed(2)} ${s.h.toFixed(2)}`);
      svg.style.setProperty('--u', String(s.w / (svg.clientWidth || 1000)));
      vb.current = { ...s };
    };
    if (reduced) {
      Object.assign(s, target);
      apply();
      return;
    }
    const tw = gsap.to(s, { ...target, duration: 1.5, ease: 'power2.inOut', onUpdate: apply });
    return () => {
      tw.kill();
    };
  }, [target, full, reduced]);

  // ---- vector reveals
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !g) return;
    const q = (sel: string) => Array.from(svg.querySelectorAll<SVGGeometryElement>(sel));
    const tl = gsap.timeline({ delay: reduced ? 0 : 0.8 });
    const draw = (els: SVGGeometryElement[], on: boolean, dur: number, animate: boolean) => {
      for (const el of els) {
        const len = el.getTotalLength?.() || 1;
        el.style.strokeDasharray = `${len} ${len}`;
        el.style.strokeDashoffset = on && (!animate || reduced) ? '0' : `${len}`;
      }
      if (on && animate && !reduced) tl.to(els, { strokeDashoffset: 0, duration: dur, ease: 'power1.inOut', stagger: 0.004 }, 0);
    };
    const show = (sel: string, on: boolean, animate: boolean, dur = 0.8) => {
      const els = q(sel);
      if (reduced || !on || !animate) gsap.set(els, { opacity: on ? 1 : 0 });
      else {
        gsap.set(els, { opacity: 0 });
        tl.to(els, { opacity: 1, duration: dur }, 0);
      }
    };
    draw(q('[data-l="snap"]'), at(step, 'upstream'), 0.6, step === 'upstream');
    show('[data-l="catchment"]', at(step, 'upstream') && !LAKE_STEPS.includes(step), step === 'upstream', 1.2);
    draw(q('[data-l="up"]'), at(step, 'upstream') && !LAKE_STEPS.includes(step), 1.6, step === 'upstream');
    draw(q('[data-l="down"]'), at(step, 'path'), 2.4, step === 'path');

    const labels = q('[data-l="lbl"]');
    const drop = svg.querySelector<SVGCircleElement>('[data-l="drop"]');
    const path = svg.querySelector<SVGGeometryElement>('[data-l="down"]');
    gsap.set(labels, { opacity: at(step, 'path') && (step !== 'path' || reduced) ? 1 : 0 });
    if (drop) gsap.set(drop, { opacity: 0 });
    if (step === 'path' && path && !reduced) {
      const len = path.getTotalLength();
      const o = { t: 0 };
      tl.set(drop, { opacity: 1 }, 0);
      tl.to(
        o,
        {
          t: 1,
          duration: 2.4,
          ease: 'power1.inOut',
          onUpdate: () => {
            const p = path.getPointAtLength(o.t * len);
            drop?.setAttribute('cx', String(p.x));
            drop?.setAttribute('cy', String(p.y));
            labels.forEach((el) => {
              if (Number((el as unknown as SVGElement).dataset['km']) / g.total <= o.t + 0.01) (el as unknown as SVGElement).style.opacity = '1';
            });
          },
        },
        0,
      );
      tl.to(drop, { opacity: 0, duration: 0.4 });
    }
    return () => {
      tl.kill();
    };
  }, [g, step, reduced]);

  // keep path labels apart at the zoom they are shown (greedy, in km order)
  const shownLabels = useMemo(() => {
    const out = new Set<string>();
    if (!g) return out;
    const k = size.w / target.w;
    const boxes: number[][] = [];
    for (const t of [...g.labels].sort((a, c) => a.km - c.km)) {
      const x = (t.xy[0] - target.x) * k + 6;
      const y = (t.xy[1] - target.y) * k - 5;
      const bx = [x - 4, y - 12, x + (t.name.length + 9) * 6.7 + 4, y + 4];
      if (!boxes.some((o) => bx[0]! < o[2]! && bx[2]! > o[0]! && bx[1]! < o[3]! && bx[3]! > o[1]!)) {
        boxes.push(bx);
        out.add(`${t.name}-${t.km}`);
      }
    }
    return out;
  }, [g, target, size.w]);

  const lakeOn = !!g?.chip && LAKE_STEPS.includes(step) && !!shownRadar;
  const flood = b.floodGrid?.bounds_lonlat;

  return (
    <svg
      ref={svgRef}
      viewBox={`${full.x} ${full.y} ${full.w} ${full.h}`}
      className="block h-full w-full select-none"
      style={{ ['--u' as string]: String(full.w / 1000) }}
      role="img"
      aria-label={dam ? `Map of ${dam.name}: ${step}` : 'Map of the processed dams'}
    >
      <defs>
        <radialGradient id="ywd-glow">
          <stop offset="0" stopColor="#5ff3ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5ff3ff" stopOpacity="0" />
        </radialGradient>
        {/* white water mask → cyan, black → transparent */}
        <filter id="ywd-water" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0.37  0 0 0 0 0.95  0 0 0 0 1  0.6 0 0 0 0" />
        </filter>
        {/* ANUGA depth (grey, 0 = dry) → blue, alpha grows with depth */}
        <filter id="ywd-depth" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0.25  -1.6 0 0 0 0.85  0 0 0 0 1  40 0 0 0 0" />
        </filter>
      </defs>

      <path d={base.country} fill="rgba(233,241,255,.035)" stroke="rgba(233,241,255,.35)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      <path d={base.adm1} fill="none" stroke="rgba(233,241,255,.08)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      <path d={base.rivers} fill="none" stroke="rgba(47,143,255,.45)" strokeWidth={0.9} vectorEffect="non-scaling-stroke" />

      {g ? (
        <g>
          <g aria-hidden opacity={0.28}>
            <path d={g.catchment} fill="none" stroke="rgba(233,241,255,.5)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
            {g.up.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="#2f8fff" strokeWidth={0.9} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={g.down} fill="none" stroke="#2f8fff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          </g>
          <path data-l="catchment" d={g.catchment} fill="rgba(95,243,255,.08)" stroke="#5ff3ff" strokeOpacity={0.7} strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={0} />
          {g.up.map((d, i) => (
            <path key={i} data-l="up" d={d} fill="none" stroke="#5fb8ff" strokeLinecap="round" style={{ strokeWidth: u(1.1) }} />
          ))}

          {lakeOn && g.chip && shownRadar ? (
            <g>
              <image href={b.src.fileUrl(shownRadar.file)} {...rect(g.chip)} preserveAspectRatio="none" opacity={0.92} />
              {step !== 'radar' && shownRadar.mask ? (
                <image href={b.src.fileUrl(shownRadar.mask)} {...rect(g.chip)} preserveAspectRatio="none" filter="url(#ywd-water)" className={reduced ? undefined : 'ywd-fadein'} />
              ) : null}
              <rect {...rect(g.chip)} fill="none" stroke="#5ff3ff" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            </g>
          ) : null}

          {handUrl && flood ? <image href={handUrl} {...rect(flood)} preserveAspectRatio="none" /> : null}
          {anugaHref && flood ? <image href={anugaHref} {...rect(flood)} preserveAspectRatio="none" filter="url(#ywd-depth)" /> : null}

          <path data-l="down" d={g.down} fill="none" stroke="#2f8fff" strokeLinecap="round" strokeLinejoin="round" style={{ strokeWidth: u(2.6), filter: 'drop-shadow(0 0 3px rgba(47,143,255,.9))' }} />
          <line data-l="snap" x1={g.damPt[0]} y1={g.damPt[1]} x2={g.snapPt[0]} y2={g.snapPt[1]} stroke="#ffb547" strokeLinecap="round" style={{ strokeWidth: u(2.4) }} />

          {g.labels.map((t) => (
            <g key={`${t.name}-${t.km}`} data-l="lbl" data-km={t.km} opacity={0}>
              <circle cx={t.xy[0]} cy={t.xy[1]} fill="#e9f1ff" style={{ r: u(3) }} />
              {shownLabels.has(`${t.name}-${t.km}`) ? (
                <text x={t.xy[0]} y={t.xy[1]} className="fill-ink font-mono" style={{ ...LABEL, fontSize: u(11), transform: `translate(${u(6)}, ${u(-5)})` }}>
                  {t.name} · km {Math.round(t.km)}
                </text>
              ) : (
                <title>{`${t.name} · km ${Math.round(t.km)}`}</title>
              )}
            </g>
          ))}
          <circle data-l="drop" fill="#9be7ff" opacity={0} style={{ r: u(5), filter: 'drop-shadow(0 0 6px #5ff3ff)' }} />
          <circle cx={g.damPt[0]} cy={g.damPt[1]} fill="url(#ywd-glow)" className={reduced ? undefined : 'ywd-pulse'} style={{ r: u(26) }} />
        </g>
      ) : null}

      {dams.map((d) => {
        const xy = P([d.lon, d.lat]);
        const sel = d.id === dam?.id;
        return (
          <g key={d.id} role="button" tabIndex={-1} aria-label={`Pick ${d.name}`} onClick={() => onPick(d.id)} className="cursor-pointer">
            <circle cx={xy[0]} cy={xy[1]} fill={sel ? '#5ff3ff' : '#6dffa8'} stroke="#03050a" opacity={sel || !dam ? 1 : 0.6} style={{ r: u(sel ? 6 : 5), strokeWidth: u(1.5) }} />
            {sel || !dam ? (
              <text x={xy[0]} y={xy[1]} className={sel ? 'fill-teal font-mono' : 'fill-ink font-mono'} style={{ ...LABEL, fontSize: u(sel ? 13 : 11), transform: `translate(${u(9)}, ${u(4)})` }}>
                {d.name}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
