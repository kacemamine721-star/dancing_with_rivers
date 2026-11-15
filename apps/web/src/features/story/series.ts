/**
 * Pure transforms for the story widgets (reservoir chart, alert timeline, scenario panel).
 * Everything here reads bundle objects and returns plain data, so it is unit-tested without a DOM.
 */
import type { Alerts, AnugaIndex, HandLut, ReservoirArea } from '@/data/schemas.gen';

export type AreaPoint = ReservoirArea['points'][number];
export type Evaluation = Alerts['evaluations'][number];

const DAY_MS = 86_400_000;

/** UTC midnight of an ISO date (YYYY-MM-DD). */
export function dayMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
}

export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DATE_FMT_Y = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** "22 Jun" */
export function fmtDay(iso: string): string {
  return DATE_FMT.format(new Date(dayMs(iso)));
}
/** "22 Jun 2026" */
export function fmtDayYear(iso: string): string {
  return DATE_FMT_Y.format(new Date(dayMs(iso)));
}

// ------------------------------------------------------------------ reservoir area

/** Points used for statistics: every confidence except "low" (wind-roughened C-band etc.). */
export function reliablePoints(points: AreaPoint[]): AreaPoint[] {
  return points.filter((p) => p.confidence !== 'low');
}

export interface MedianSample {
  date: string;
  /** Multi-sensor median of the measured area within ±halfWindow days. */
  median: number;
  /** Median of the per-image σ (threshold ±2 dB) in the same window. */
  sigma: number;
  n: number;
}

/**
 * Centred rolling median of the measured area (both sensors, reliable points only), sampled every
 * `stepDays`. Windows with fewer than `minN` points are skipped, so the line breaks across gaps.
 */
export function rollingMedian(
  points: AreaPoint[],
  { halfWindowDays = 10, stepDays = 3, minN = 3 }: { halfWindowDays?: number; stepDays?: number; minN?: number } = {},
): MedianSample[] {
  const pts = reliablePoints(points)
    .map((p) => ({ t: dayMs(p.date), a: p.area_km2, s: p.sigma_km2 ?? Number.NaN }))
    .sort((x, y) => x.t - y.t);
  if (pts.length === 0) return [];
  const out: MedianSample[] = [];
  const start = pts[0]!.t;
  const end = pts[pts.length - 1]!.t;
  for (let t = start; t <= end; t += stepDays * DAY_MS) {
    const w = pts.filter((p) => Math.abs(p.t - t) <= halfWindowDays * DAY_MS);
    if (w.length < minN) continue;
    const sig = w.map((p) => p.s).filter(Number.isFinite);
    out.push({
      date: isoFromMs(t),
      median: median(w.map((p) => p.a)),
      sigma: sig.length ? median(sig) : 0,
      n: w.length,
    });
  }
  return out;
}

export interface AreaSummary {
  /** Median of the reliable measurements from 30 days before the failure up to it. */
  before: number | null;
  beforeN: number;
  /** Lowest rolling-median value between the failure and `lowUntil`. */
  low: number | null;
  lowDate: string | null;
  /** Highest rolling-median value after `riseFrom` (the autumn rise). */
  rise: number | null;
  riseDate: string | null;
  nisar: number;
  s1: number;
  lowConfidence: number;
  first: string | null;
  last: string | null;
}

export function summariseArea(
  series: Pick<ReservoirArea, 'points'>,
  { failure = '2026-06-17', lowUntil = '2026-08-31', riseFrom = '2026-09-01' } = {},
): AreaSummary {
  const pts = series.points;
  const rel = reliablePoints(pts);
  const before = rel.filter((p) => {
    const d = daysBetween(p.date, failure);
    return d >= 0 && d <= 30;
  });
  const rm = rollingMedian(pts);
  const after = rm.filter((s) => s.date > failure && s.date <= lowUntil);
  const lowS = after.reduce<MedianSample | null>((m, s) => (!m || s.median < m.median ? s : m), null);
  const autumn = rm.filter((s) => s.date >= riseFrom);
  const riseS = autumn.reduce<MedianSample | null>((m, s) => (!m || s.median > m.median ? s : m), null);
  const dates = pts.map((p) => p.date).sort();
  return {
    before: before.length ? median(before.map((p) => p.area_km2)) : null,
    beforeN: before.length,
    low: lowS?.median ?? null,
    lowDate: lowS?.date ?? null,
    rise: riseS?.median ?? null,
    riseDate: riseS?.date ?? null,
    nisar: pts.filter((p) => p.sensor === 'NISAR').length,
    s1: pts.filter((p) => p.sensor === 'S1').length,
    lowConfidence: pts.filter((p) => p.confidence === 'low').length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  };
}

// ------------------------------------------------------------------ alerts

export interface Flag {
  date: string;
  level: 'ALERT' | 'WARNING';
  sensor: 'NISAR' | 'S1' | 'unknown';
  track: string;
  departurePct: number;
  text: Evaluation['text'];
}

/** "S1 o161: harmonised area…" / "NISAR A173/F20: …" → sensor + track. */
export function parseTrack(experts: string): { sensor: Flag['sensor']; track: string } {
  const m = /^(NISAR|S1)\s+([^:]+):/.exec(experts.trim());
  if (!m) return { sensor: 'unknown', track: '' };
  return { sensor: m[1] as 'NISAR' | 'S1', track: m[2]!.trim() };
}

export function flagsOf(alerts: Pick<Alerts, 'evaluations'>): Flag[] {
  return alerts.evaluations
    .filter((e): e is Evaluation & { level: 'ALERT' | 'WARNING' } => e.level !== 'NORMAL')
    .map((e) => ({
      date: e.date,
      level: e.level,
      ...parseTrack(e.text.experts),
      departurePct: e.delta * 100,
      text: e.text,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface ConfirmedAlert {
  flag: Flag;
  /** The independent pass (other track) that confirms it within `withinDays`. */
  confirmedBy: Flag | null;
}

/** First ALERT that another track confirms (WARNING or ALERT) within ±`withinDays` days. */
export function firstConfirmedAlert(flags: Flag[], withinDays = 6): ConfirmedAlert | null {
  for (const f of flags) {
    if (f.level !== 'ALERT') continue;
    const c = flags.find(
      (g) => g !== f && `${g.sensor} ${g.track}` !== `${f.sensor} ${f.track}` && Math.abs(daysBetween(f.date, g.date)) <= withinDays,
    );
    if (c) return { flag: f, confirmedBy: c };
  }
  return null;
}

export interface FlagPhases {
  before: Flag[];
  /** From the failure to `drawdownEnd` (gate open, then repaired). */
  drawdown: Flag[];
  /** After the drawdown: cannot be classified without operator data. */
  later: Flag[];
}

export function phaseFlags(flags: Flag[], failure = '2026-06-17', drawdownEnd = '2026-07-31'): FlagPhases {
  return {
    before: flags.filter((f) => f.date < failure),
    drawdown: flags.filter((f) => f.date >= failure && f.date <= drawdownEnd),
    later: flags.filter((f) => f.date > drawdownEnd),
  };
}

// ------------------------------------------------------------------ flood scenarios

export type HandRow = HandLut['rows'][number];

/** Exposure at `volumeM3` by linear interpolation of the HAND lookup table (rows sorted by V). */
export function handAt(rows: HandRow[], volumeM3: number): HandRow | null {
  if (rows.length === 0) return null;
  const s = [...rows].sort((a, b) => a.V_m3 - b.V_m3);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const mix = (a: HandRow, b: HandRow, t: number): HandRow => ({
    h: lerp(a.h, b.h, t),
    V_m3: volumeM3,
    area_km2: lerp(a.area_km2, b.area_km2, t),
    cropland_ha: lerp(a.cropland_ha, b.cropland_ha, t),
    builtup_ha: lerp(a.builtup_ha, b.builtup_ha, t),
    villages: t < 0.5 ? a.villages : b.villages,
    road_km: lerp(a.road_km, b.road_km, t),
    population: lerp(a.population, b.population, t),
    buildings: Math.round(lerp(a.buildings, b.buildings, t)),
  });
  if (volumeM3 <= s[0]!.V_m3) return { ...s[0]!, V_m3: volumeM3 };
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!;
    const b = s[i]!;
    if (volumeM3 <= b.V_m3) return mix(a, b, (volumeM3 - a.V_m3) / (b.V_m3 - a.V_m3 || 1));
  }
  return { ...s[s.length - 1]!, V_m3: volumeM3 };
}

export type Scenario = AnugaIndex['scenarios'][number];

export function computedScenarios(index: AnugaIndex | undefined): Scenario[] {
  return (index?.scenarios ?? []).filter((s) => s.computed).sort((a, b) => a.volume_m3 - b.volume_m3);
}

/** The computed scenario whose volume is closest (in log space) to `volumeM3`. */
export function nearestScenario(index: AnugaIndex | undefined, volumeM3: number): Scenario | null {
  const list = computedScenarios(index);
  if (list.length === 0 || !(volumeM3 > 0)) return list[0] ?? null;
  return list.reduce((best, s) =>
    Math.abs(Math.log(s.volume_m3 / volumeM3)) < Math.abs(Math.log(best.volume_m3 / volumeM3)) ? s : best,
  );
}

// ------------------------------------------------------------------ volume slider (log scale)

export const VOLUME_MIN_MM3 = 1;
export const VOLUME_MAX_MM3 = 200;

/** Slider position 0..1 → volume in Mm³ on a log scale (1 → 200 Mm³). */
export function posToVolumeMm3(pos: number): number {
  const p = Math.min(1, Math.max(0, pos));
  return VOLUME_MIN_MM3 * (VOLUME_MAX_MM3 / VOLUME_MIN_MM3) ** p;
}

export function volumeMm3ToPos(v: number): number {
  const c = Math.min(VOLUME_MAX_MM3, Math.max(VOLUME_MIN_MM3, v));
  return Math.log(c / VOLUME_MIN_MM3) / Math.log(VOLUME_MAX_MM3 / VOLUME_MIN_MM3);
}

/** Round a slider volume to a readable step (1 Mm³ below 50, 5 above). */
export function roundVolumeMm3(v: number): number {
  return v < 50 ? Math.max(1, Math.round(v)) : Math.round(v / 5) * 5;
}
