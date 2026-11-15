import type { BadgeKind } from '@/components/badge-model';
import { flagsOf, reliablePoints } from '@/features/story/series';

import { handHeightM, handVolumeM3, pickAnuga, type DamBundle } from './bundle';
import type { Dam } from './data';

export type StepId = 'find' | 'upstream' | 'radar' | 'lake' | 'alert' | 'level' | 'path' | 'hand' | 'anuga';
export const ORDER: StepId[] = ['find', 'upstream', 'radar', 'lake', 'alert', 'level', 'path', 'hand', 'anuga'];

export interface StepView {
  id: StepId;
  label: string;
  /** the one key number (real data) or a dash when the data does not exist */
  value: string;
  unit?: string | undefined;
  /** one short sentence (Simplified) */
  simple: string;
  /** one technical line (Advanced) */
  expert: string;
  badge: BadgeKind;
  /** the result does not exist for this dam (yet): shown dimmed, never invented */
  pending?: boolean;
}

const nf = (n: number, d = 0) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function pathKm(fc: DamBundle['flowpath']): number | null {
  const f = fc?.features.find((x) => x.geometry && /LineString/.test(x.geometry.type));
  const p = (f?.properties ?? {}) as Record<string, unknown>;
  const v = p['length_km'] ?? p['total_km'] ?? p['km'];
  return typeof v === 'number' ? v : null;
}

/** Every value comes from the dam's bundle or the catalogue; missing → "—" and `pending`. */
export function buildSteps(dam: Dam, b: DamBundle): StepView[] {
  const pts = b.area ? [...b.area.points].sort((x, y) => x.date.localeCompare(y.date)) : [];
  const rel = reliablePoints(pts);
  const nN = pts.filter((p) => p.sensor === 'NISAR').length;
  const nS = pts.length - nN;
  const last = rel[rel.length - 1];
  const areas = rel.map((p) => p.area_km2);
  const flags = b.alerts ? flagsOf(b.alerts) : [];
  const lastEval = b.alerts?.evaluations[b.alerts.evaluations.length - 1];
  const swot = b.level?.swot;
  const good = (swot?.points ?? []).filter((p) => p.quality === 0);
  const usable = (swot?.points ?? []).filter((p) => p.quality <= 1);
  const lv = good[good.length - 1] ?? usable[usable.length - 1];
  const km = pathKm(b.flowpath) ?? dam.downstream_km ?? null;
  const rows = b.hand?.rows ?? [];
  const V = rows.length ? handVolumeM3(rows) : 0;
  const hr = rows.length ? rows.reduce((a, r) => (Math.abs(r.V_m3 - V) < Math.abs(a.V_m3 - V) ? r : a)) : null;
  const an = pickAnuga(b.anuga, b.hand);
  const st = b.anugaStats;

  return [
    {
      id: 'find',
      label: 'Dam',
      value: `${nf(dam.lat, 2)}°N`,
      unit: `${nf(dam.lon, 2)}°E`,
      simple: `${dam.name}${dam.governorate ? `, ${dam.governorate}` : ''}.`,
      expert: `OSM crest ${dam.osm_id ?? ''}; river snap ${dam.snap_m ?? '—'} m (HydroRIVERS).`,
      badge: 'modelled',
    },
    {
      id: 'upstream',
      label: 'Catchment',
      value: dam.catchment_km2 ? nf(dam.catchment_km2) : '—',
      unit: 'km²',
      simple: 'All the land whose rain ends in this lake.',
      expert: 'HydroBASINS level-12 units upstream of the snapped reach, dissolved.',
      badge: 'modelled',
      pending: !dam.catchment_km2,
    },
    {
      id: 'radar',
      label: 'Radar passes',
      value: pts.length ? `${nN} + ${nS}` : '—',
      unit: 'NISAR + S1',
      simple: 'Radar images of the lake, day or night, through clouds.',
      expert: `NISAR L-band GCOV + Sentinel-1 C-band RTC, ${pts.length ? `${day(pts[0]!.date)} → ${day(pts[pts.length - 1]!.date)} 2026` : '—'}.`,
      badge: 'measured',
      pending: !pts.length,
    },
    {
      id: 'lake',
      label: 'Lake area',
      value: last ? nf(last.area_km2, last.area_km2 < 1 ? 2 : 1) : '—',
      unit: 'km²',
      simple: last ? `Water area on ${day(last.date)}, measured from space.` : 'No lake series yet.',
      expert: areas.length
        ? `Adaptive Otsu per image in the radar lake outline; range ${nf(Math.min(...areas), 2)}–${nf(Math.max(...areas), 2)} km², ±2 dB band.`
        : '—',
      badge: 'measured',
      pending: !last,
    },
    {
      id: 'alert',
      label: 'Alert',
      value: lastEval?.level ?? '—',
      unit: b.alerts ? `${flags.length} flags` : undefined,
      simple: lastEval ? 'Automatic check of every new pass against the last 3 weeks.' : 'Not computed.',
      expert: 'Harmonised area vs 21-day multi-sensor median; WARNING < −12 %, ALERT < −20 %, confirmed by a second pass.',
      badge: 'modelled',
      pending: !lastEval,
    },
    {
      id: 'level',
      label: 'Water level',
      value: lv ? nf(lv.wse_m, 1) : '—',
      unit: lv ? 'm (SWOT)' : 'no SWOT lake',
      simple: lv ? 'Height of the lake surface, measured by SWOT.' : 'This lake is too small for SWOT.',
      expert: lv
        ? `SWOT LakeSP ${good.length ? `quality 0, ${day(lv.time)}` : `partial passes only, ${day(lv.time)}`}.`
        : (swot?.reason ?? 'No SWOT lake.'),
      badge: 'measured',
      pending: !lv,
    },
    {
      id: 'path',
      label: 'Downstream',
      value: km !== null ? nf(km) : '—',
      unit: 'km',
      simple: 'Where released water would flow.',
      expert: 'D8 steepest descent on GEM-15 30 m (GLO-30 in gaps).',
      badge: 'modelled',
      pending: km === null,
    },
    {
      id: 'hand',
      label: 'Quick flood',
      value: hr ? nf(hr.area_km2) : '—',
      unit: hr ? `km² · ${nf(V / 1e6)} Mm³` : undefined,
      simple: hr ? `Land under water if ${nf(V / 1e6)} million m³ were released.` : 'Not computed.',
      expert: hr
        ? `HAND bathtub: h ${nf(handHeightM(rows, V), 2)} m, ${nf(hr.cropland_ha)} ha cropland. Scenario, not a forecast.`
        : '—',
      badge: 'modelled',
      pending: !hr,
    },
    {
      id: 'anuga',
      label: 'Physics flood',
      value: st ? nf(st.inundated_km2, 1) : '—',
      unit: st && an ? `km² · ${nf(an.volume_m3 / 1e6)} Mm³` : 'GPU runs in progress',
      simple: st ? 'Water flowing hour by hour, from a 2D flood model.' : 'Hour-by-hour flood model: running on GPU.',
      expert:
        st && an
          ? `ANUGA 2D, ${nf(an.volume_m3 / 1e6)} Mm³ over ${nf(an.duration_h)} h; arrival times are mesh-sensitive.`
          : 'ANUGA package ready; results not imported yet.',
      badge: 'modelled',
      pending: !st,
    },
  ];
}
