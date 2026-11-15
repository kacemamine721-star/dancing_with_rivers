import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AlertsSchema,
  AnugaIndexSchema,
  AnugaStatsSchema,
  EventsSchema,
  HandLutSchema,
  ImpactsSchema,
  LevelVolumeSchema,
  ManifestSchema,
  ReservoirAreaSchema,
  SourcesSchema,
  ValidationSchema,
} from '@/data/schemas.gen';
import { CatchmentSchema, FlowpathMetaSchema, parseAllFeatures, parseFirstFeature } from '@/data/vectors';
import { actEntryPatch, applyAction } from '@/features/story/actions';
import { ACT_LIST } from '@/features/story/acts';
import { chartAnnotations, medianSegments } from '@/features/story/chart-model';
import { computeFacts, fillTemplate, isFactId, templateFacts } from '@/features/story/facts';
import {
  firstConfirmedAlert,
  flagsOf,
  handAt,
  posToVolumeMm3,
  rollingMedian,
  volumeMm3ToPos,
} from '@/features/story/series';
import { groupTests } from '@/routes/Methods';
import { LAYER_IDS, SHOT_IDS } from '@/store/app';

const BUNDLE = resolve(__dirname, '../public/data/2026-11-15');
const read = (p: string): unknown => JSON.parse(readFileSync(resolve(BUNDLE, p), 'utf-8'));

const manifest = ManifestSchema.parse(read('manifest.json'));
const series = ReservoirAreaSchema.parse(read('timeseries/reservoir_area.json'));
const alerts = AlertsSchema.parse(read('anomaly/alerts.json'));
const lut = HandLutSchema.parse(read('flood/hand_lut.json'));
const index = AnugaIndexSchema.parse(read('flood/anuga/index.json'));
const impacts = ImpactsSchema.parse(read('impacts/impacts.json'));
const level = LevelVolumeSchema.parse(read('level/level_volume.json'));
const events = EventsSchema.parse(read('story/events.json'));
const sources = SourcesSchema.parse(read('story/sources.json'));
const flowpath = parseFirstFeature(read('vectors/flowpath.geojson'), FlowpathMetaSchema);
const catchments = parseAllFeatures(read('vectors/catchment.geojson'), CatchmentSchema);
const stats = Object.fromEntries(
  index.scenarios.filter((s) => s.stats).map((s) => [s.id, AnugaStatsSchema.parse(read(s.stats!))]),
);

const ALL = { manifest, series, alerts, lut, index, stats, impacts, level, events, sources, flowpath, catchments };

describe('act configs', () => {
  it('are nine, in order, each with a complete layer record and a known shot', () => {
    expect(ACT_LIST.map((a) => a.act)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const a of ACT_LIST) {
      expect(Object.keys(a.stage.layers).sort()).toEqual([...LAYER_IDS].sort());
      expect(SHOT_IDS).toContain(a.stage.shot);
    }
  });

  it('only use known fact placeholders', () => {
    for (const a of ACT_LIST) {
      for (const id of [...templateFacts(a.body), ...templateFacts(a.expertBody), ...a.facts, ...(a.expertFacts ?? [])])
        expect(isFactId(id), `${a.act}: ${id}`).toBe(true);
    }
  });

  it('every placeholder resolves from the real bundle (no "…" left)', () => {
    const facts = computeFacts({ ...ALL, date: '2026-06-19' });
    for (const a of ACT_LIST) {
      expect(fillTemplate(a.body, facts), `act ${a.act} body`).not.toMatch(/\{|…/);
      expect(fillTemplate(a.expertBody, facts).replace(/ … /g, ' '), `act ${a.act} experts`).not.toMatch(/\{|…/);
    }
  });

  it('date try-its point at dates that have a radar image', () => {
    const chips = new Set(manifest.layers.filter((l) => l.kind === 'radar').map((l) => l.date));
    for (const a of ACT_LIST)
      for (const t of a.tryIt)
        for (const x of t.actions) if (x.kind === 'date') expect(chips.has(x.date), `${a.act} ${t.label}`).toBe(true);
    for (const a of ACT_LIST) expect(chips.has(a.stage.date) || a.act === 4 || a.act === 7, `act ${a.act}`).toBe(true);
  });

  it('never use forbidden phrasing', () => {
    const text = ACT_LIST.map((a) => `${a.body} ${a.expertBody}`).join(' ').toLowerCase();
    expect(text).not.toMatch(/disappeared|vanished|nisar alone|only nisar|on 19 june.*alarm|will flood|forecasts? /);
  });
});

describe('try-it actions', () => {
  it('apply to the store and return navigation to the caller', () => {
    const store = {
      setShot: vi.fn(),
      setDate: vi.fn(),
      setCompareDate: vi.fn(),
      setSwipe: vi.fn(),
      setLayer: vi.fn(),
      toggleLayer: vi.fn(),
      setFlood: vi.fn(),
      layers: Object.fromEntries(LAYER_IDS.map((l) => [l, false])) as never,
    };
    const nav = vi.fn();
    applyAction({ kind: 'shot', shot: 'dam_close' }, store, nav);
    applyAction({ kind: 'layer', layer: 'mask' }, store, nav);
    applyAction({ kind: 'layer', layer: 'radar', on: true }, store, nav);
    applyAction({ kind: 'compare', date: '2026-06-17', swipe: 0.5 }, store, nav);
    applyAction({ kind: 'navigate', to: '/watch' }, store, nav);
    expect(store.setShot).toHaveBeenCalledWith('dam_close');
    expect(store.toggleLayer).toHaveBeenCalledWith('mask');
    expect(store.setLayer).toHaveBeenCalledWith('radar', true);
    expect(store.setCompareDate).toHaveBeenCalledWith('2026-06-17');
    expect(store.setSwipe).toHaveBeenCalledWith(0.5);
    expect(nav).toHaveBeenCalledWith('/watch');
  });

  it('act entry patch resets every layer and the swipe', () => {
    const p = actEntryPatch(ACT_LIST[2]!);
    expect(p.compareDate).toBe('2026-06-17');
    expect(p.swipe).toBe(0.5);
    expect(Object.values(p.layers!).filter(Boolean).length).toBe(2);
    expect(actEntryPatch(ACT_LIST[0]!).compareDate).toBeNull();
  });
});

describe('series transforms', () => {
  it('rolling median skips low-confidence points and breaks at the NISAR gap', () => {
    const med = rollingMedian(series.points);
    expect(Math.min(...med.map((m) => m.median))).toBeGreaterThan(1);
    const segs = medianSegments(med, series.gaps ?? []);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    const [g0, g1] = series.gaps![0]!;
    for (const seg of segs) for (const s of seg) expect(s.date >= g0 && s.date <= g1).toBe(false);
  });

  it('first confirmed alert is 22 June, from another track', () => {
    const first = firstConfirmedAlert(flagsOf(alerts).filter((f) => f.date > '2026-06-17'));
    expect(first?.flag.date).toBe('2026-06-22');
    expect(first?.flag.track).toBe('o161');
    expect(first?.flag.departurePct).toBeCloseTo(-20.5, 1);
    expect(first?.confirmedBy?.track).toBe('o88');
    const ann = chartAnnotations(series, first!.flag.date, '2026-09-28');
    expect(ann.map((a) => a.tone)).toEqual(['event', 'alert', 'event', 'season']);
  });

  it('HAND lookup interpolates (21 Mm³ ≈ 26.5 km²)', () => {
    const r = handAt(lut.rows, 21e6)!;
    expect(r.area_km2).toBeGreaterThan(26);
    expect(r.area_km2).toBeLessThan(27);
  });

  it('log volume slider round-trips', () => {
    for (const v of [5, 21, 50, 195]) expect(posToVolumeMm3(volumeMm3ToPos(v))).toBeCloseTo(v, 6);
  });
});

describe('facts from the bundle', () => {
  const f = computeFacts({ ...ALL, date: '2026-06-19' });
  it('reads the numbers the science review checked', () => {
    expect(f['lake.lastLook']?.value).toBe('2.92');
    expect(f['obs.total']?.value).toBe(String(series.points.length));
    expect(f['alert.first']?.value).toBe('22 Jun');
    expect(f['alert.before']?.value).toBe('0');
    expect(f['anuga.v21.confluence']?.value).toBe('12.9');
    expect(f['anuga.mesh']?.value).toBe('69,616');
    expect(f['catchment.mellegue']?.value).toBe('10,315');
    expect(f['path.length']?.value).toBe('101');
  });
});

describe('Methods table', () => {
  it('groups validation.json tests by group, in file order', () => {
    const v = ValidationSchema.parse(read('validation/validation.json'));
    const groups = groupTests(v.tests);
    expect(groups.length).toBeGreaterThan(3);
    expect(groups.flatMap(([, t]) => t).length).toBe(v.tests.length);
    expect(groups[0]![0]).toBe(v.tests[0]!.group);
  });
});
