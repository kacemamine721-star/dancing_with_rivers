import gsap from 'gsap';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { Dam, DamIndex, GeoFC } from './data';
import { partsOf, pointsOf } from './data';
import { boxOf, makeProjection, pathD, type Box, type Position } from './projection';
import type { StepId } from './steps';

/** A length in screen px at the current zoom (the stage sets --u = viewBox width / 1000). */
const u = (px: number) => `calc(${px}px * var(--u))`;
const LABEL = { paintOrder: 'stroke', stroke: '#03050a', strokeWidth: u(3) } as const;
const ORDER: StepId[] = ['find', 'snap', 'catchment', 'lake', 'radar', 'downstream', 'watch', 'flood'];
const at = (step: StepId, s: StepId) => ORDER.indexOf(step) >= ORDER.indexOf(s);

interface Props {
  index: DamIndex;
  tunisia: GeoFC | undefined;
  dam: Dam | null;
  geo: GeoFC | undefined;
  step: StepId;
  reduced: boolean;
  onPick: (id: string) => void;
}

/**
 * The animated map: Tunisia, every catalogued dam, and for the picked dam its real geometry revealed
 * step by step (snap → catchment + rivers → lake → radar swaths → downstream path with a moving drop
 * and the towns it passes). The viewBox is tweened with GSAP; paths draw with stroke-dashoffset.
 */
export function DamStage({ index, tunisia, dam, geo, step, reduced, onPick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  // rendered size (px): the zoom boxes take its aspect, labels declutter at its scale
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
  const wpx = size.w;
  const vb = useRef<Box | null>(null);
  const proj = useMemo(() => makeProjection(index.tunisia_bbox, 1000), [index.tunisia_bbox]);
  const P = proj.project;

  // ---- static base layers
  const base = useMemo(() => {
    const country = pathD(partsOf(tunisia, 'country'), P, true);
    const adm1 = pathD(partsOf(tunisia, 'adm1'), P, true);
    const rivers = pathD(partsOf(tunisia, 'river'), P);
    return { country, adm1, rivers };
  }, [tunisia, P]);
  const full: Box = useMemo(() => {
    const b = boxOf([[[index.tunisia_bbox[0], index.tunisia_bbox[1]], [index.tunisia_bbox[2], index.tunisia_bbox[3]]]], P, ASPECT, 0.04);
    return b ?? { x: 0, y: 0, w: proj.width, h: proj.width / ASPECT };
  }, [index.tunisia_bbox, P, proj.width, ASPECT]);

  // ---- picked dam geometry
  const g = useMemo(() => {
    if (!dam || !geo) return null;
    const catchment = partsOf(geo, 'catchment');
    const reservoir = partsOf(geo, 'reservoir');
    const down = partsOf(geo, 'river_down');
    const up = partsOf(geo, 'rivers_up');
    const towns = pointsOf(geo, 'town');
    const damPt = P([dam.lon, dam.lat]);
    const downFirst = down[0]?.[0];
    return {
      catchment: pathD(catchment, P, true),
      reservoir: pathD(reservoir, P, true),
      down: pathD(down, P),
      up: up.map((l) => pathD([l], P)),
      towns: towns.map((t) => ({ xy: P(t.pos), name: String(t.props['name'] ?? ''), km: Number(t.props['km'] ?? 0) })),
      damPt,
      snapPt: downFirst ? P(downFirst) : damPt,
      boxDam: boxOf([[[dam.lon - 0.12, dam.lat - 0.08], [dam.lon + 0.12, dam.lat + 0.08]]], P, ASPECT, 0),
      boxLake: boxOf(reservoir.length ? reservoir : [[[dam.lon - 0.05, dam.lat - 0.03], [dam.lon + 0.05, dam.lat + 0.03]]], P, ASPECT, 0.6, 14),
      boxCatch: boxOf([...catchment, ...down.slice(0, 1)], P, ASPECT, 0.08),
      boxDown: boxOf([...down, [[dam.lon, dam.lat]]], P, ASPECT, 0.2),
      boxAll: boxOf([...catchment, ...down], P, ASPECT, 0.14),
    };
  }, [dam, geo, P, ASPECT]);

  // radius of a dam marker etc. scale with the view so they keep their screen size
  const target: Box = useMemo(() => {
    if (!g) return full;
    const pick = (b: Box | null) => b ?? full;
    switch (step) {
      case 'find':
      case 'snap':
        return pick(g.boxDam);
      case 'catchment':
        return pick(g.boxCatch);
      case 'lake':
        return pick(g.boxLake);
      case 'radar':
        return pick(g.boxDam && { ...g.boxDam, x: g.boxDam.x - g.boxDam.w, y: g.boxDam.y - g.boxDam.h, w: g.boxDam.w * 3, h: g.boxDam.h * 3 });
      case 'downstream':
        return pick(g.boxDown);
      default:
        return pick(g.boxAll);
    }
  }, [g, step, full]);

  // swath ≈ the radar view width (the real NISAR swath is ~240 km, wider than this zoomed view)
  const radarW = target.w * 0.35;

  const labelled = useMemo(() => {
    const out = new Set<string>();
    if (!g || !dam) return out;
    const k = wpx / target.w;
    const boxes: [number, number, number, number][] = [];
    const add = (x: number, y: number, w: number) => boxes.push([x - 4, y - 16, x + w + 4, y + 4]);
    const hit = (b: [number, number, number, number]) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    add((g.damPt[0] - target.x) * k + 9, (g.damPt[1] - target.y) * k + 4, dam.name.length * 7.8);
    for (const t of [...g.towns].sort((a, b) => a.km - b.km)) {
      const x = (t.xy[0] - target.x) * k + 6;
      const y = (t.xy[1] - target.y) * k - 5;
      const w = (t.name.length + 9) * 6.7;
      const b: [number, number, number, number] = [x - 4, y - 12, x + w + 4, y + 4];
      if (!hit(b)) {
        boxes.push(b);
        out.add(`${t.name}-${t.km}`);
      }
    }
    return out;
  }, [g, dam, target, wpx]);

  // ---- viewBox tween
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const cur = vb.current ?? full;
    const s = { ...cur };
    const apply = () => {
      svg.setAttribute('viewBox', `${s.x.toFixed(2)} ${s.y.toFixed(2)} ${s.w.toFixed(2)} ${s.h.toFixed(2)}`);
      // 1 screen px in user units, so markers and labels keep their size while the map zooms
      svg.style.setProperty('--u', String(s.w / (svg.clientWidth || 1000)));
      vb.current = { ...s };
    };
    if (reduced) {
      Object.assign(s, target);
      apply();
      return;
    }
    const tw = gsap.to(s, { ...target, duration: 1.6, ease: 'power2.inOut', onUpdate: apply });
    return () => {
      tw.kill();
    };
  }, [target, full, reduced]);

  // ---- per-step reveals
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !g) return;
    const q = (sel: string) => Array.from(svg.querySelectorAll<SVGGraphicsElement>(sel));
    const draw = (els: SVGGeometryElement[], on: boolean, dur: number, stagger = 0) => {
      for (const el of els) {
        const len = el.getTotalLength?.() || 1;
        el.style.strokeDasharray = `${len} ${len}`;
        if (!on) el.style.strokeDashoffset = `${len}`;
      }
      if (!on) return null;
      if (reduced) {
        els.forEach((el) => (el.style.strokeDashoffset = '0'));
        return null;
      }
      return gsap.to(els, { strokeDashoffset: 0, duration: dur, ease: 'power1.inOut', stagger });
    };
    const tl = gsap.timeline({ delay: reduced ? 0 : 0.9 });
    const show = (sel: string, on: boolean, opacity = 1, dur = 0.8) => {
      const els = q(sel);
      if (reduced || !on) gsap.set(els, { opacity: on ? opacity : 0 });
      else tl.to(els, { opacity, duration: dur }, 0);
    };

    show('[data-l="pulse"]', true);
    const snapTw = draw(q('[data-l="snap"]') as SVGGeometryElement[], at(step, 'snap'), 0.8);
    if (snapTw) tl.add(snapTw, 0);
    show('[data-l="catchment"]', at(step, 'catchment'), 1, 1.4);
    const upTw = draw(q('[data-l="up"]') as SVGGeometryElement[], at(step, 'catchment'), 1.6, 0.004);
    if (upTw) tl.add(upTw, 0.2);
    show('[data-l="reservoir"]', at(step, 'lake'));
    show('[data-l="radar"]', step === 'radar', 1, 0.4);
    const downTw = draw(q('[data-l="down"]') as SVGGeometryElement[], at(step, 'downstream'), 2.6);
    if (downTw) tl.add(downTw, 0.1);
    show('[data-l="flood"]', step === 'flood', 1, 1);

    const swath = svg.querySelector<SVGRectElement>('[data-l="swath"]');
    const ping = svg.querySelector<SVGCircleElement>('[data-l="ping"]');
    if (swath && step === 'radar' && !reduced) {
      const x0 = g.damPt[0] - radarW * 2;
      const passes = Math.min(4, Math.max(2, Math.round((dam?.nisar_dates ?? 8) / 8)));
      const sweep = gsap.timeline({ repeat: passes - 1 });
      sweep.fromTo(swath, { attr: { x: x0 } }, { attr: { x: x0 + radarW * 3 }, duration: 1.1, ease: 'none' });
      sweep.fromTo(ping, { opacity: 0.9, scale: 0.4, transformOrigin: 'center', transformBox: 'fill-box' }, { opacity: 0, scale: 2.2, duration: 0.7 }, 0.45);
      tl.add(sweep, 0.2);
    }

    // towns appear as the drop passes them; the drop rides the downstream path
    const towns = q('[data-l="town"]');
    const drop = svg.querySelector<SVGCircleElement>('[data-l="drop"]');
    const path = svg.querySelector<SVGGeometryElement>('[data-l="down"]');
    if (!at(step, 'downstream') || !path) {
      gsap.set(towns, { opacity: 0 });
      if (drop) gsap.set(drop, { opacity: 0 });
    } else if (reduced) {
      gsap.set(towns, { opacity: 1 });
      if (drop) gsap.set(drop, { opacity: 0 });
    } else if (step === 'downstream') {
      const len = path.getTotalLength();
      const total = dam?.downstream_km || 1;
      const o = { t: 0 };
      tl.set(drop, { opacity: 1 }, 0.1);
      tl.to(
        o,
        {
          t: 1,
          duration: 2.6,
          ease: 'power1.inOut',
          onUpdate: () => {
            const p = path.getPointAtLength(o.t * len);
            drop?.setAttribute('cx', String(p.x));
            drop?.setAttribute('cy', String(p.y));
            towns.forEach((el) => {
              if (Number(el.dataset['km']) / total <= o.t + 0.01) el.style.opacity = '1';
            });
          },
        },
        0.1,
      );
      tl.to(drop, { opacity: 0, duration: 0.4 });
    } else gsap.set(towns, { opacity: 1 });

    return () => {
      tl.kill();
    };
  }, [g, step, reduced, dam, radarW]);


  const damDots = index.dams.map((d) => ({ d, xy: P([d.lon, d.lat]) as Position }));

  return (
    <svg
      ref={svgRef}
      viewBox={`${full.x} ${full.y} ${full.w} ${full.h}`}
      className="block h-full w-full select-none"
      style={{ ['--u' as string]: String(full.w / 1000) }}
      role="img"
      aria-label={dam ? `Map: ${dam.name}, step ${step}` : 'Map of Tunisia with the catalogued dams'}
    >
      <defs>
        <radialGradient id="ywd-glow">
          <stop offset="0" stopColor="#5ff3ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5ff3ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ywd-swath" x1="0" x2="1">
          <stop offset="0" stopColor="#b38cff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#b38cff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#b38cff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* base map */}
      <path d={base.country} fill="rgba(233,241,255,.035)" stroke="rgba(233,241,255,.35)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      <path d={base.adm1} fill="none" stroke="rgba(233,241,255,.08)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      <path d={base.rivers} fill="none" stroke="rgba(47,143,255,.45)" strokeWidth={0.9} vectorEffect="non-scaling-stroke" />

      {g ? (
        <g>
          <path data-l="catchment" d={g.catchment} fill="rgba(95,243,255,.10)" stroke="#5ff3ff" strokeOpacity={0.7} strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={0} />
          {g.up.map((d, i) => (
            <path key={i} data-l="up" d={d} fill="none" stroke="#5fb8ff" strokeLinecap="round" style={{ strokeWidth: u(1.1) }} />
          ))}
          <path data-l="flood" d={g.down} fill="none" stroke="#ffb547" strokeOpacity={0.35} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0} />
          <path data-l="down" d={g.down} fill="none" stroke="#2f8fff" strokeLinecap="round" strokeLinejoin="round" style={{ strokeWidth: u(2.8), filter: 'drop-shadow(0 0 3px rgba(47,143,255,.9))' }} />
          <path data-l="reservoir" d={g.reservoir} fill="rgba(47,143,255,.55)" stroke="#9be7ff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={0} />
          <line data-l="snap" x1={g.damPt[0]} y1={g.damPt[1]} x2={g.snapPt[0]} y2={g.snapPt[1]} stroke="#ffb547" strokeLinecap="round" style={{ strokeWidth: u(2.4) }} />

          <g data-l="radar" opacity={0}>
            {/* a NISAR pass: a band (swath) moving across the dam along a near-polar ground track */}
            <g transform={`rotate(-12 ${g.damPt[0]} ${g.damPt[1]})`}>
              <rect data-l="swath" x={g.damPt[0] - radarW * 2} y={g.damPt[1] - radarW * 2} width={radarW} height={radarW * 4} fill="url(#ywd-swath)" />
            </g>
            <circle data-l="ping" cx={g.damPt[0]} cy={g.damPt[1]} fill="none" stroke="#b38cff" style={{ r: u(10), strokeWidth: u(1.5) }} opacity={0} />
          </g>

          {g.towns.map((t) => (
            <g key={`${t.name}-${t.km}`} data-l="town" data-km={t.km} opacity={0}>
              <circle cx={t.xy[0]} cy={t.xy[1]} fill="#e9f1ff" style={{ r: u(3) }} />
              {labelled.has(`${t.name}-${t.km}`) ? (
                <text x={t.xy[0]} y={t.xy[1]} className="fill-ink font-mono" style={{ ...LABEL, fontSize: u(11), transform: `translate(${u(6)}, ${u(-5)})` }}>
                  {t.name} · km {Math.round(t.km)}
                </text>
              ) : (
                <title>{`${t.name} · km ${Math.round(t.km)}`}</title>
              )}
            </g>
          ))}
          <circle data-l="drop" fill="#9be7ff" opacity={0} style={{ r: u(5), filter: 'drop-shadow(0 0 6px #5ff3ff)' }} />
          <circle data-l="pulse" cx={g.damPt[0]} cy={g.damPt[1]} fill="url(#ywd-glow)" className={reduced ? undefined : 'ywd-pulse'} style={{ r: u(26) }} />
        </g>
      ) : null}

      {/* every catalogued dam */}
      {damDots.map(({ d, xy }) => {
        const sel = d.id === dam?.id;
        return (
          <g
            key={d.id}
            role="button"
            tabIndex={-1}
            aria-label={`Pick ${d.name}`}
            onClick={() => onPick(d.id)}
            className="cursor-pointer"
          >
            <circle cx={xy[0]} cy={xy[1]} fill={sel ? '#5ff3ff' : d.status === 'processed' ? '#6dffa8' : '#e9f1ff'} stroke="#03050a" opacity={sel || !dam ? 1 : 0.55} style={{ r: u(sel ? 6 : 4), strokeWidth: u(1.5) }} />
            {sel || !dam ? (
              <text x={xy[0]} y={xy[1]} className={sel ? 'fill-teal font-mono' : 'fill-mute font-mono'} style={{ ...LABEL, fontSize: u(sel ? 13 : 9.5), transform: `translate(${u(sel ? 9 : 6)}, ${u(3.5)})` }}>
                {d.name}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
