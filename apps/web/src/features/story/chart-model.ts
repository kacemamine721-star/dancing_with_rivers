import type { ReservoirArea } from '@/data/schemas.gen';

import { dayMs, fmtDay, type MedianSample } from './series';

/** Sensor colours (validated pair on the dark surface; S1 also differs by marker shape). */
export const SENSOR_COLOR = { NISAR: '#1a22b4', S1: '#ffb547' } as const;

export interface ChartAnnotation {
  date: string;
  label: string;
  tone: 'event' | 'alert' | 'season';
}

/** Split the rolling median into segments: never across a data gap or a hole in the samples. */
export function medianSegments(
  samples: MedianSample[],
  gaps: [string, string][] = [],
  maxStepDays = 6,
): MedianSample[][] {
  const inGap = (d: string) => gaps.some(([a, b]) => d >= a && d <= b);
  const segs: MedianSample[][] = [];
  let cur: MedianSample[] = [];
  let prev: MedianSample | null = null;
  for (const s of samples) {
    if (inGap(s.date)) {
      if (cur.length) segs.push(cur);
      cur = [];
      prev = null;
      continue;
    }
    if (prev && (dayMs(s.date) - dayMs(prev.date)) / 86_400_000 > maxStepDays) {
      if (cur.length) segs.push(cur);
      cur = [];
    }
    cur.push(s);
    prev = s;
  }
  if (cur.length) segs.push(cur);
  return segs.filter((s) => s.length > 1);
}

/** Event annotations: reported failure + repair, first confirmed ALERT, autumn rise (data-derived). */
export function chartAnnotations(series: ReservoirArea, alertDate: string | null, riseDate: string | null): ChartAnnotation[] {
  const out: ChartAnnotation[] = [];
  const failure = series.events.find((e) => e.kind === 'failure');
  if (failure) out.push({ date: failure.date, label: `Failure ${fmtDay(failure.date)}`, tone: 'event' });
  if (alertDate) out.push({ date: alertDate, label: `1st ALERT ${fmtDay(alertDate)}`, tone: 'alert' });
  const repair = series.events.find((e) => e.kind === 'repair');
  if (repair) out.push({ date: repair.date, label: `Gate repaired ${fmtDay(repair.date)}`, tone: 'event' });
  if (riseDate) out.push({ date: riseDate, label: 'Autumn rise', tone: 'season' });
  return out;
}

