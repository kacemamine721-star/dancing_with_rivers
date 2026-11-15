/**
 * Facts: every number a story card prints, computed from the data bundle (or, for the few facts
 * that are not in the bundle, a REPORTED value with its press source from story/sources.json).
 * Copy refers to them as `{fact.id}` placeholders; `fillTemplate` substitutes the formatted value.
 */
import type { BadgeProps } from '@/components/Badge';
import { provenanceProps } from '@/components/badge-model';
import type {
  Alerts,
  AnugaIndex,
  AnugaStats,
  Events,
  HandLut,
  Impacts,
  LevelVolume,
  Manifest,
  ReservoirArea,
  Sources,
} from '@/data/schemas.gen';
import type { Catchment, FlowpathMeta } from '@/data/vectors';

import {
  daysBetween,
  handAt,
  reliablePoints,
  firstConfirmedAlert,
  flagsOf,
  fmtDay,
  phaseFlags,
  summariseArea,
} from './series';

export const FACT_IDS = [
  // reported (press; not in the bundle)
  'dam.built',
  'dam.age',
  'dam.silted',
  'upper.capacity',
  'gate.time',
  'release.planned',
  'release.reported',
  'release.ratio',
  'release.range',
  'release.alt',
  'repair.date',
  'sidisalem.arrival',
  'sidisalem.days',
  'onagri.stopped',
  // measured (reservoir_area.json, manifest)
  'lake.lastLook',
  'lake.lastLookTime',
  'lake.lastLookRange',
  'lake.lowWhen',
  'obs.lowConf',
  'nisar.d80.first',
  'nisar.d80.second',
  'nisar.julyDrop',
  'lake.before',
  'lake.low',
  'lake.rise',
  'obs.total',
  'obs.nisar',
  'obs.s1',
  'obs.nisarTracks',
  'obs.gap',
  'date.image',
  'date.area',
  'date.areaRange',
  // modelled (alerts.json)
  'alert.first',
  'alert.latency',
  'alert.firstTrack',
  'alert.firstDeparture',
  'alert.confirmTrack',
  'alert.confirmDeparture',
  'alert.beforeEvals',
  'alert.before',
  'alert.firstNisar',
  'alert.later',
  // modelled (flowpath, catchment, anuga, impacts, hand)
  'path.length',
  'path.confluence',
  'path.jendouba',
  'path.bousalem',
  'catchment.mellegue',
  'catchment.sidisalem',
  'anuga.count',
  'anuga.v21.confluence',
  'anuga.v21.area',
  'anuga.v21.cropland',
  'anuga.v50.area',
  'anuga.v195.area',
  'anuga.v195.cropland',
  'anuga.mesh',
  'hand.21.area',
  'hand.21.cropland',
  'hand.21.population',
  'hand.195.area',
  'hand.195.cropland',
  'hand.195.villages',
  'level.before',
  'level.after',
  'level.drop',
  'volume.change',
  'watch.dams',
  'watch.sensors',
] as const;
export type FactId = (typeof FACT_IDS)[number];

export interface Fact {
  label: string;
  value: string;
  unit?: string;
  badge: BadgeProps;
}

export type Facts = Partial<Record<FactId, Fact>>;

export interface StoryInputs {
  manifest?: Manifest | undefined;
  series?: ReservoirArea | undefined;
  alerts?: Alerts | undefined;
  lut?: HandLut | undefined;
  index?: AnugaIndex | undefined;
  /** stats.json by scenario id */
  stats?: Record<string, AnugaStats | undefined> | undefined;
  impacts?: Impacts | undefined;
  level?: LevelVolume | undefined;
  flowpath?: FlowpathMeta | undefined;
  catchments?: Catchment[] | undefined;
  events?: Events | undefined;
  sources?: Sources | undefined;
  /** store date (facts that follow the scrubber) */
  date?: string | undefined;
}

export const FAILURE_DATE = '2026-06-17';

const nf = (digits: number) =>
  new Intl.NumberFormat('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmt = (n: number, digits = 0): string => nf(digits).format(n);
/** Signed percent with a real minus sign: "−21". */
export const fmtSigned = (n: number, digits = 0): string => (n < 0 ? `−${fmt(-n, digits)}` : `+${fmt(n, digits)}`);

/** Press facts that are not in the bundle: value + the sources.json id that backs it (docs/01 §5–6). */
const REPORTED: Record<
  'dam.built' | 'dam.silted' | 'upper.capacity' | 'gate.time' | 'release.planned' | 'onagri.stopped',
  { label: string; value: string; unit?: string; sourceId: string }
> = {
  'dam.built': { label: 'Built', value: '1954', sourceId: 'docs-01' },
  'dam.silted': { label: 'Silted up', value: '≈ 80', unit: '%', sourceId: 'aa-sidisalem' },
  'upper.capacity': { label: 'Upper Mellègue dam', value: '195', unit: 'Mm³', sourceId: 'wd-upper' },
  'gate.time': { label: 'Gate fails', value: '≈ 21:15', unit: 'local', sourceId: 'bn-gate' },
  'release.planned': { label: 'Planned release', value: '0.1', unit: 'Mm³', sourceId: 'bn-gate' },
  'onagri.stopped': { label: 'Daily dam bulletins', value: 'Oct 2025', unit: 'stopped', sourceId: 'bn-onagri' },
};

function sourceTitle(sources: Sources | undefined, id: string): string {
  const s = sources?.sources.find((x) => x.id === id);
  return s ? `${s.title} — ${s.url}` : 'Press compilation in the project research notes (docs/01 §5–6)';
}

/** Compute every fact the inputs allow; missing inputs leave the fact undefined (rendered "…"). */
export function computeFacts(d: StoryInputs): Facts {
  const f: Facts = {};
  const reported = (id: keyof typeof REPORTED, subject?: string): Fact => {
    const r = REPORTED[id];
    return {
      label: r.label,
      value: r.value,
      ...(r.unit ? { unit: r.unit } : {}),
      badge: { kind: 'reported', source: sourceTitle(d.sources, r.sourceId), subject: subject ?? r.label },
    };
  };
  for (const id of Object.keys(REPORTED) as (keyof typeof REPORTED)[]) f[id] = reported(id);
  f['dam.age'] = {
    label: 'Age in 2026',
    value: String(2026 - 1954),
    unit: 'years',
    badge: { kind: 'reported', source: sourceTitle(d.sources, 'docs-01'), subject: 'Dam age' },
  };

  // ---- events (story/events.json)
  const ev = (kind: string) => d.events?.events.find((e) => e.kind === kind);
  const repair = ev('repair');
  if (repair)
    f['repair.date'] = {
      label: 'Gate repaired',
      value: fmtDay(repair.date),
      badge: { kind: repair.badge, source: sourceTitle(d.sources, 'mg-repair'), subject: 'Gate repair date' },
    };
  const arrival = ev('arrival');
  if (arrival) {
    f['sidisalem.arrival'] = {
      label: 'Reaches Sidi Salem',
      value: fmtDay(arrival.date),
      badge: { kind: arrival.badge, source: sourceTitle(d.sources, 'aa-sidisalem'), subject: 'Arrival at Sidi Salem' },
    };
    f['sidisalem.days'] = {
      label: 'Days to Sidi Salem',
      value: String(daysBetween(FAILURE_DATE, arrival.date)),
      unit: 'days',
      badge: { kind: arrival.badge, source: sourceTitle(d.sources, 'aa-sidisalem'), subject: 'Arrival at Sidi Salem' },
    };
  }

  // ---- reported volume (level_volume.json → reported)
  const rel = d.level?.reported.find((r) => /releas/i.test(r.what)) ?? d.level?.reported[0];
  if (rel) {
    const src = rel.source;
    f['release.reported'] = {
      label: 'Released',
      value: fmt(rel.value_m3 / 1e6),
      unit: 'Mm³',
      badge: { kind: 'reported', source: src, subject: 'Released volume' },
    };
    f['release.range'] = {
      label: 'Reported release',
      value: rel.alt ? `${fmt(rel.value_m3 / 1e6)}–${fmt(rel.alt / 1e6)}` : fmt(rel.value_m3 / 1e6),
      unit: 'Mm³',
      badge: {
        kind: 'reported',
        source: `${src}${rel.alt ? `; ${sourceTitle(d.sources, 'tn-29mm3')}` : ''}`,
        subject: 'Reported release range',
      },
    };
    if (rel.alt)
      f['release.alt'] = {
        label: 'Higher report',
        value: fmt(rel.alt / 1e6),
        unit: 'Mm³',
        badge: { kind: 'reported', source: sourceTitle(d.sources, 'tn-29mm3'), subject: 'Higher reported release' },
      };
    f['release.ratio'] = {
      label: 'Times the plan',
      value: fmt(rel.value_m3 / 1e5),
      unit: '×',
      badge: { kind: 'reported', source: `${src}; ${sourceTitle(d.sources, 'bn-gate')}`, subject: 'Release vs plan' },
    };
  }

  // ---- reservoir area
  if (d.series) {
    const s = d.series;
    const sum = summariseArea(s, { failure: FAILURE_DATE });
    const prov = provenanceProps(s);
    const last = s.points.find((p) => p.date === FAILURE_DATE);
    if (last) {
      f['lake.lastLook'] = {
        label: 'Last look before',
        value: fmt(last.area_km2, 2),
        unit: 'km²',
        badge: { ...prov, subject: `Lake area ${last.date} (${last.sensor} ${last.track})` },
      };
      const lastLayer = d.manifest?.layers.find(
        (l) => l.kind === 'radar' && l.date === last.date && l.sensor === last.sensor,
      );
      const rng = lastLayer ? /([\d.]+)\s*[–-]\s*([\d.]+)\s*km²/.exec(lastLayer.uncertainty) : null;
      if (lastLayer && rng)
        f['lake.lastLookRange'] = {
          label: 'Threshold ±2 dB',
          value: `${fmt(Number(rng[1]), 2)}–${fmt(Number(rng[2]), 2)}`,
          unit: 'km²',
          badge: { ...provenanceProps(lastLayer), subject: 'Area range for threshold ±2 dB' },
        };
      f['lake.lastLookTime'] = {
        label: 'Last radar look before',
        value: last.time_utc ?? fmtDay(last.date),
        unit: last.time_utc ? `UTC · ${last.sensor === 'S1' ? 'Sentinel-1' : last.sensor} ${last.track}` : last.sensor,
        badge: { ...prov, subject: 'Last image before the failure' },
      };
    }
    if (sum.before !== null)
      f['lake.before'] = {
        label: 'Before the failure',
        value: fmt(sum.before, 1),
        unit: 'km²',
        badge: { ...prov, subject: `Median lake area, 30 days before the failure (${sum.beforeN} images)` },
      };
    const lowEnd = s.gaps?.[0]?.[0] ?? '2026-07-31';
    const lowPt = reliablePoints(s.points)
      .filter((p) => p.sensor === 'NISAR' && p.date > FAILURE_DATE && p.date <= lowEnd)
      .reduce<(typeof s.points)[number] | null>((m, p) => (!m || p.area_km2 < m.area_km2 ? p : m), null);
    if (lowPt) {
      f['lake.low'] = {
        label: 'Late July',
        value: fmt(lowPt.area_km2, 2),
        unit: 'km²',
        badge: { ...prov, subject: `Lake area ${lowPt.date} (NISAR ${lowPt.track})` },
      };
      f['lake.lowWhen'] = {
        label: 'Lowest NISAR before the gap',
        value: fmtDay(lowPt.date),
        unit: `NISAR ${lowPt.track.split('/')[0]}`,
        badge: { ...prov, subject: `Lake area ${lowPt.date} (NISAR ${lowPt.track})` },
      };
    }
    f['obs.lowConf'] = {
      label: 'Low confidence',
      value: String(sum.lowConfidence),
      unit: 'wind',
      badge: { ...prov, subject: 'Low-confidence measurements' },
    };
    const d80 = reliablePoints(s.points)
      .filter((p) => p.sensor === 'NISAR' && p.track.startsWith('D80') && p.date > FAILURE_DATE)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (d80[0])
      f['nisar.d80.first'] = {
        label: `NISAR D80 · ${fmtDay(d80[0].date)}`,
        value: fmt(d80[0].area_km2, 2),
        unit: 'km²',
        badge: { ...prov, subject: `Lake area ${d80[0].date} (NISAR D80)` },
      };
    if (d80[1])
      f['nisar.d80.second'] = {
        label: `NISAR D80 · ${fmtDay(d80[1].date)}`,
        value: fmt(d80[1].area_km2, 2),
        unit: 'km²',
        badge: { ...prov, subject: `Lake area ${d80[1].date} (NISAR D80)` },
      };
    // same-track change, early July (1–4 Jul) → mid July (13–16 Jul), averaged over tracks that have both
    const drops: number[] = [];
    const nis = reliablePoints(s.points).filter((p) => p.sensor === 'NISAR');
    for (const tr of new Set(nis.map((p) => p.track))) {
      const a = nis.find((p) => p.track === tr && p.date >= '2026-07-01' && p.date <= '2026-07-04');
      const b = nis.find((p) => p.track === tr && p.date >= '2026-07-13' && p.date <= '2026-07-16');
      if (a && b) drops.push((b.area_km2 / a.area_km2 - 1) * 100);
    }
    if (drops.length)
      f['nisar.julyDrop'] = {
        label: 'NISAR, early → mid July',
        value: fmt(Math.abs(drops.reduce((x, y) => x + y, 0) / drops.length)),
        unit: '%',
        badge: { ...prov, subject: `Same-track change, ${drops.length} NISAR tracks` },
      };
    if (sum.rise !== null)
      f['lake.rise'] = {
        label: 'Autumn rise',
        value: fmt(sum.rise, 1),
        unit: 'km²',
        badge: { ...prov, subject: `Highest 21-day median after 1 Sep (${sum.riseDate})` },
      };
    f['obs.total'] = { label: 'Measurements', value: String(s.points.length), badge: { ...prov, subject: 'Measurements' } };
    f['obs.nisar'] = { label: 'NISAR', value: String(sum.nisar), badge: { ...prov, subject: 'NISAR measurements' } };
    f['obs.s1'] = { label: 'Sentinel-1', value: String(sum.s1), badge: { ...prov, subject: 'Sentinel-1 measurements' } };
    const tracks = [...new Set(s.points.filter((p) => p.sensor === 'NISAR').map((p) => p.track.split('/')[0]!))].sort();
    f['obs.nisarTracks'] = {
      label: 'NISAR tracks',
      value: tracks.join(' · '),
      badge: { ...prov, subject: 'NISAR tracks over the lake' },
    };
    const gap = s.gaps?.[0];
    if (gap)
      f['obs.gap'] = {
        label: 'No NISAR images',
        value: `${fmtDay(gap[0])} – ${fmtDay(gap[1])}`,
        badge: { ...prov, subject: 'NISAR acquisition gap' },
      };
    if (d.date) {
      const at = s.points.filter((p) => p.date === d.date);
      const pick = at.find((p) => p.sensor === 'NISAR') ?? at[0];
      if (pick)
        f['date.area'] = {
          label: `Water · ${fmtDay(pick.date)}`,
          value: fmt(pick.area_km2, 2),
          unit: 'km²',
          badge: { ...prov, subject: `Lake area ${pick.date} (${pick.sensor} ${pick.track})` },
        };
    }
  }

  // ---- the radar image on screen (manifest)
  if (d.manifest && d.date) {
    const layer =
      d.manifest.layers.find((l) => l.kind === 'radar' && l.date === d.date && l.sensor === 'NISAR') ??
      d.manifest.layers.find((l) => l.kind === 'radar' && l.date === d.date);
    if (layer) {
      const prov = provenanceProps(layer);
      const sensor = layer.sensor === 'S1' ? 'Sentinel-1' : (layer.sensor ?? '');
      f['date.image'] = {
        label: `Image · ${fmtDay(layer.date!)}`,
        value: `${sensor} ${layer.band ?? ''}`.trim(),
        unit: [layer.pol, layer.track].filter(Boolean).join(' · '),
        badge: { ...prov, subject: layer.label },
      };
      const m = /([\d.]+)\s*[–-]\s*([\d.]+)\s*km²/.exec(layer.uncertainty);
      if (m)
        f['date.areaRange'] = {
          label: 'Threshold ±2 dB',
          value: `${fmt(Number(m[1]), 2)}–${fmt(Number(m[2]), 2)}`,
          unit: 'km²',
          badge: { ...prov, subject: 'Area range for threshold ±2 dB' },
        };
    }
  }

  // ---- alerts
  if (d.alerts) {
    const prov = provenanceProps(d.alerts);
    const flags = flagsOf(d.alerts);
    const phases = phaseFlags(flags, FAILURE_DATE);
    const first = firstConfirmedAlert(flags);
    const evalsBefore = d.alerts.evaluations.filter((e) => e.date <= FAILURE_DATE);
    f['alert.before'] = {
      label: 'Flags before the failure',
      value: String(phases.before.length),
      unit: `of ${evalsBefore.length} checks`,
      badge: { ...prov, subject: 'Flags before 17 June' },
    };
    if (evalsBefore.length)
      f['alert.beforeEvals'] = {
        label: 'Checks before the failure',
        value: String(evalsBefore.length),
        unit: `${fmtDay(evalsBefore[0]!.date)} – ${fmtDay(FAILURE_DATE)}`,
        badge: { ...prov, subject: 'Evaluations before the failure' },
      };
    if (first) {
      f['alert.first'] = {
        label: 'First alert',
        value: fmtDay(first.flag.date),
        badge: { ...prov, subject: 'First confirmed alert' },
      };
      f['alert.latency'] = {
        label: 'After the failure',
        value: String(daysBetween(FAILURE_DATE, first.flag.date)),
        unit: 'days',
        badge: { ...prov, subject: 'Alert latency' },
      };
      f['alert.firstTrack'] = {
        label: 'Fired by',
        value: `${first.flag.sensor === 'S1' ? 'Sentinel-1' : first.flag.sensor} ${first.flag.track}`,
        badge: { ...prov, subject: 'Pass that fired the first alert' },
      };
      f['alert.firstDeparture'] = {
        label: 'Below normal',
        value: fmtSigned(first.flag.departurePct, 1),
        unit: '%',
        badge: { ...prov, subject: 'Departure from the 21-day baseline' },
      };
      if (first.confirmedBy)
        f['alert.confirmDeparture'] = {
          label: 'Confirming pass',
          value: fmtSigned(first.confirmedBy.departurePct, 1),
          unit: '%',
          badge: { ...prov, subject: 'Departure of the confirming pass' },
        };
      if (first.confirmedBy)
        f['alert.confirmTrack'] = {
          label: 'Confirmed by',
          value: `${first.confirmedBy.sensor === 'S1' ? 'Sentinel-1' : first.confirmedBy.sensor} ${first.confirmedBy.track}`,
          badge: { ...prov, subject: 'Independent confirming pass' },
        };
    }
    const nisar = flags.find((x) => x.sensor === 'NISAR' && x.date >= FAILURE_DATE);
    if (nisar)
      f['alert.firstNisar'] = {
        label: 'First NISAR flag',
        value: fmtDay(nisar.date),
        unit: `${nisar.track.split('/')[0]} · ${nisar.level}`,
        badge: { ...prov, subject: 'First NISAR flag' },
      };
    f['alert.later'] = {
      label: 'Later flags (Aug–Nov)',
      value: String(phases.later.length),
      unit: 'operator check',
      badge: { ...prov, subject: 'Flags after the drawdown' },
    };
  }

  // ---- flow path, catchments
  if (d.flowpath) {
    const fp = d.flowpath;
    const badge: BadgeProps = { kind: fp.badge, source: fp.dem || 'D8 routing', method: fp.method, subject: 'Flow path' };
    f['path.length'] = { label: 'Flow path', value: fmt(fp.length_km, 0), unit: 'km', badge };
    const at = (re: RegExp) => fp.reach_breaks.find((b) => re.test(b.name));
    const conf = at(/confluence/i);
    if (conf) f['path.confluence'] = { label: 'Medjerda confluence', value: `km ${fmt(conf.dist_km, 1)}`, badge };
    const jen = at(/jendouba/i);
    if (jen) f['path.jendouba'] = { label: 'Jendouba', value: `km ${fmt(jen.dist_km, 1)}`, badge };
    const bou = at(/bou salem/i);
    if (bou) f['path.bousalem'] = { label: 'Bou Salem', value: `km ${fmt(bou.dist_km, 1)}`, badge };
  }
  if (d.catchments) {
    const badge = (name: string): BadgeProps => ({
      kind: 'modelled',
      source: 'Derived from HydroBASINS v1c level 12 + HydroRIVERS v1.0 (Lehner & Grill 2013)',
      method: 'Dam point snapped to the main stem; all level-12 basins draining to it, dissolved',
      uncertainty: '15 arc-second basin boundaries (±0.5 km)',
      subject: name,
    });
    const mel = d.catchments.find((c) => c.id === 'mellegue');
    if (mel) f['catchment.mellegue'] = { label: 'Catchment', value: fmt(mel.area_km2), unit: 'km²', badge: badge(mel.name) };
    const ss = d.catchments.find((c) => c.id === 'sidi_salem');
    if (ss)
      f['catchment.sidisalem'] = { label: 'Sidi Salem catchment', value: fmt(ss.area_km2), unit: 'km²', badge: badge(ss.name) };
  }

  // ---- ANUGA + impacts
  if (d.index) {
    const computed = d.index.scenarios.filter((s) => s.computed);
    const v21 = d.index.scenarios.find((s) => s.id === 'v21_d12');
    const anugaBadge = (subject: string): BadgeProps =>
      v21 ? { ...provenanceProps(v21), subject } : { kind: 'modelled', subject };
    f['anuga.count'] = {
      label: 'ANUGA runs',
      value: String(computed.length),
      badge: anugaBadge('Computed ANUGA scenarios'),
    };
    const st = d.stats?.['v21_d12'];
    const confH = st ? Object.entries(st.arrival_h).find(([k]) => /confluence/i.test(k))?.[1] : undefined;
    if (confH !== undefined)
      f['anuga.v21.confluence'] = {
        label: 'Reaches the Medjerda',
        value: fmt(confH, 1),
        unit: 'h',
        badge: anugaBadge('ANUGA 21 Mm³ arrival at the Medjerda confluence'),
      };
    if (st)
      f['anuga.v21.area'] = {
        label: 'Wet area (21 Mm³)',
        value: fmt(st.inundated_km2, 1),
        unit: 'km²',
        badge: anugaBadge('ANUGA 21 Mm³ inundated area, Reach 1'),
      };
  }
  if (d.index) {
    const index = d.index;
    const area = (id: string, key: 'anuga.v50.area' | 'anuga.v195.area', label: string) => {
      const st = d.stats?.[id];
      const sc = index.scenarios.find((x) => x.id === id);
      if (st && sc)
        f[key] = {
          label,
          value: fmt(st.inundated_km2, 1),
          unit: 'km²',
          badge: { ...provenanceProps(sc), subject: `ANUGA ${label}` },
        };
    };
    area('v50_d12', 'anuga.v50.area', 'Wet area (50 Mm³)');
    area('v195_d12', 'anuga.v195.area', 'Wet area (195 Mm³)');
    const sc = index.scenarios.find((x) => x.computed);
    const tri = sc ? /(\d[\d,]*)\s*triangles/.exec(sc.method) : null;
    if (sc && tri)
      f['anuga.mesh'] = {
        label: 'Mesh',
        value: fmt(Number(tri[1]!.replace(/,/g, ''))),
        unit: 'triangles',
        badge: { ...provenanceProps(sc), subject: 'ANUGA mesh' },
      };
  }
  const imp195 = d.impacts?.scenarios['v195_d12'];
  if (imp195 && d.impacts)
    f['anuga.v195.cropland'] = {
      label: 'Cropland reached (195 Mm³)',
      value: fmt(imp195.cropland_ha),
      unit: 'ha',
      badge: { ...provenanceProps(d.impacts), subject: 'Cropland in the ANUGA 195 Mm³ footprint' },
    };
  if (d.lut) {
    const lut = d.lut;
    const lb = (subject: string): BadgeProps => ({ ...provenanceProps(lut), subject });
    const h21 = handAt(lut.rows, 21e6);
    const h195 = handAt(lut.rows, 195e6);
    if (h21) {
      f['hand.21.area'] = { label: 'HAND 21 Mm³', value: fmt(h21.area_km2, 1), unit: 'km²', badge: lb('HAND 21 Mm³ area') };
      f['hand.21.cropland'] = {
        label: 'HAND 21 Mm³ cropland',
        value: fmt(h21.cropland_ha),
        unit: 'ha',
        badge: lb('HAND 21 Mm³ cropland'),
      };
      f['hand.21.population'] = {
        label: 'HAND 21 Mm³ people',
        value: `≈ ${fmt(Math.round(h21.population / 10) * 10)}`,
        badge: lb('HAND 21 Mm³ population (WorldPop, modelled)'),
      };
    }
    if (h195) {
      f['hand.195.area'] = { label: 'HAND 195 Mm³', value: fmt(h195.area_km2), unit: 'km²', badge: lb('HAND 195 Mm³ area') };
      f['hand.195.cropland'] = {
        label: 'HAND 195 Mm³ cropland',
        value: fmt(h195.cropland_ha),
        unit: 'ha',
        badge: lb('HAND 195 Mm³ cropland'),
      };
      f['hand.195.villages'] = {
        label: 'HAND 195 Mm³ villages',
        value: String(h195.villages),
        badge: lb('HAND 195 Mm³ villages'),
      };
    }
  }
  if (d.level && !d.level.placeholder) {
    const lv = d.level;
    const pts = (lv.swot.points ?? []).filter((p) => p.quality === 0).sort((a, b) => a.time.localeCompare(b.time));
    const before = pts.filter((p) => p.time.slice(0, 10) <= FAILURE_DATE);
    const after = pts.filter((p) => p.time.slice(0, 10) > FAILURE_DATE);
    const lb: BadgeProps = { ...provenanceProps(lv), kind: 'measured', subject: 'SWOT lake level' };
    const b = before[before.length - 1];
    const a = after[0];
    if (b)
      f['level.before'] = {
        label: `Level · ${fmtDay(b.time)}`,
        value: fmt(b.wse_m, 1),
        unit: 'm',
        badge: { ...lb, subject: `SWOT water level ${b.time.slice(0, 10)}` },
      };
    if (a)
      f['level.after'] = {
        label: `Level · ${fmtDay(a.time)}`,
        value: fmt(a.wse_m, 1),
        unit: 'm',
        badge: { ...lb, subject: `SWOT water level ${a.time.slice(0, 10)}` },
      };
    if (a && b)
      f['level.drop'] = {
        label: 'Level change',
        value: `${fmtSigned(a.wse_m - b.wse_m, 2)} ± ${fmt(Math.hypot(a.wse_u, b.wse_u), 2)}`,
        unit: 'm',
        badge: { ...lb, subject: 'SWOT level change' },
      };
    const dv = lv.delta_volume[0];
    if (dv)
      f['volume.change'] = {
        label: `Storage change ${fmtDay(dv.from)} → ${fmtDay(dv.to)}`,
        value: fmtSigned(dv.dV_m3 / 1e6, 1),
        unit: `Mm³ (${fmtSigned(dv.low / 1e6, 1)} … ${fmtSigned(dv.high / 1e6, 1)})`,
        badge: { kind: 'modelled', source: lv.source, method: dv.method, uncertainty: lv.uncertainty, subject: 'Storage change' },
      };
  }
  f['watch.sensors'] = {
    label: 'Ground sensors used',
    value: '0',
    badge: { kind: 'reported', source: 'This project: satellite data only', subject: 'Ground sensors' },
  };
  const imp = d.impacts?.scenarios['v21_d12'];
  if (imp && d.impacts)
    f['anuga.v21.cropland'] = {
      label: 'Cropland reached (21 Mm³)',
      value: fmt(imp.cropland_ha),
      unit: 'ha',
      badge: { ...provenanceProps(d.impacts), subject: 'Cropland in the ANUGA 21 Mm³ footprint' },
    };

  f['watch.dams'] = {
    label: 'Coverage today',
    value: '1',
    unit: 'reservoir · roadmap: national',
    badge: {
      kind: 'illustrative',
      source: d.manifest ? `Data bundle ${d.manifest.version} covers dam_id "${d.manifest.dam_id}" only` : 'v1 data bundle',
      subject: 'Coverage (roadmap)',
    },
  };

  return f;
}

const PLACEHOLDER = /\{([a-z0-9]+(?:\.[a-zA-Z0-9]+)+)\}/g;

/** Placeholders used by a copy string. */
export function templateFacts(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

/** Replace `{fact.id}` by the fact value (unit not included); unknown or missing → "…". */
export function fillTemplate(text: string, facts: Facts): string {
  return text.replace(PLACEHOLDER, (_, id: string) => facts[id as FactId]?.value ?? '…');
}

export function isFactId(s: string): s is FactId {
  return (FACT_IDS as readonly string[]).includes(s);
}
