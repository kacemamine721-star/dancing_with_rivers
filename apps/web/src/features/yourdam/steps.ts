import type { Dam } from './data';

export type StepId = 'find' | 'snap' | 'catchment' | 'lake' | 'radar' | 'downstream' | 'watch' | 'flood';

const nf = (n: number, d = 0) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
const or = (v: number | null | undefined, f: (n: number) => string, dash = 'not available') => (v === null || v === undefined ? dash : f(v));

export interface StepDef {
  id: StepId;
  label: string;
  title: (d: Dam) => string;
  simple: (d: Dam) => string;
  expert: (d: Dam) => string;
  /** big number shown with the step */
  stat?: (d: Dam) => { value: string; unit?: string } | null;
  /** true when the step's analysis exists only for processed dams (Mellègue) */
  processedOnly?: boolean;
}

const downName = (d: Dam, names: Map<string, string>) =>
  d.downstream_to === 'sea'
    ? 'the sea'
    : d.downstream_to === 'border'
      ? 'the border'
      : d.downstream_to === 'sink'
        ? 'an inland basin'
        : d.downstream_to ? (names.get(d.downstream_to) ?? d.downstream_to) : 'its end';

export function makeSteps(names: Map<string, string>): StepDef[] {
  return [
    {
      id: 'find',
      label: 'Find',
      title: (d) => `${d.name}`,
      simple: (d) =>
        `${d.name}${d.governorate ? `, in ${d.governorate}` : ''}${d.river ? `, on the ${d.river}` : ''}. Everything that follows is computed for this dam from open maps and satellite data.`,
      expert: (d) =>
        `Dam location from OpenStreetMap (${nf(d.lat, 4)}° N, ${nf(d.lon, 4)}° E)${d.height_m ? `, height ${nf(d.height_m)} m` : ''}${d.start_date ? `, built ${d.start_date}` : ''}. Status: ${d.status === 'processed' ? 'full V1 pipeline run' : 'catalogued (geometry only)'}.`,
    },
    {
      id: 'snap',
      label: 'Snap',
      title: () => 'Snap the dam to its river',
      simple: (d) =>
        d.snap_warning
          ? 'A dam blocks a river. Here the computer could not find a main river close enough to this dam on the global river map, so the next steps stop at the dam point.'
          : 'A dam blocks a river. First, we find which river: the computer moves the dam point onto the nearest main river line.',
      expert: (d) =>
        `Nearest HydroRIVERS main-stem reach: ${or(d.snap_m, (m) => `${nf(m)} m`)} from the OSM point.${d.snap_warning ? ` ⚠ ${d.snap_warning}: needs a manual check (docs/09 §4.1).` : ''}`,
      stat: (d) => (d.snap_m === null || d.snap_m === undefined ? null : { value: nf(d.snap_m), unit: 'm snap' }),
    },
    {
      id: 'catchment',
      label: 'Upstream',
      title: () => 'Upstream: all the land that feeds the lake',
      simple: (d) =>
        d.catchment_km2
          ? `Every drop of rain that falls inside this outline ends up in the lake: ${nf(d.catchment_km2)} km². The thin lines are the rivers that carry it.${d.catchment_shared_with?.length ? ' This dam is small for the global basin map, so the outline is an upper bound.' : ''}`
          : 'No catchment could be drawn for this dam with the global basin map.',
      expert: (d) =>
        `Union of the HydroBASINS level-12 sub-basins upstream of the snapped basin (topological, via NEXT_DOWN): ${or(d.catchment_km2, (a) => `${nf(a, 1)} km²`)}. Rivers: HydroRIVERS v1.0 reaches inside it.${d.catchment_shared_with?.length ? ` Shared catchment with ${d.catchment_shared_with.map((x) => names.get(x) ?? x).join(', ')} (resolution-limited: the whole level-12 unit is counted).` : ''}`,
      stat: (d) => (d.catchment_km2 ? { value: nf(d.catchment_km2), unit: 'km² catchment' } : null),
    },
    {
      id: 'lake',
      label: 'Lake',
      title: () => 'The lake',
      simple: (d) =>
        d.reservoir_km2
          ? `On the map the reservoir covers about ${nf(d.reservoir_km2, 1)} km² when it is full. In reality it is often smaller: that is what radar measures.`
          : 'The map has no outline for this reservoir yet. In V2 the outline comes from radar images of past months.',
      expert: (d) =>
        `OSM reservoir polygon ${or(d.reservoir_km2, (a) => `${nf(a, 2)} km²`, 'missing')} (static, often at full supply). V2 mask = pre-period Sentinel-1 water frequency ∩ JRC GSW maximum (docs/09 §0.5).`,
      stat: (d) => (d.reservoir_km2 ? { value: nf(d.reservoir_km2, 1), unit: 'km² mapped' } : null),
    },
    {
      id: 'radar',
      label: 'Radar',
      title: () => 'Radar passes over the lake',
      simple: (d) =>
        d.nisar_dates
          ? `NISAR flew over this dam on ${nf(d.nisar_dates)} different days between June and October 2026, day and night, through clouds. Each pass is one new look at the lake.`
          : 'NISAR coverage for this dam is not in our inventory yet.',
      expert: (d) =>
        `NISAR GCOV acquisitions whose footprint contains the dam (ASF search footprints, 17 Jun → 31 Oct 2026): ${or(d.nisar_dates, (n) => `${nf(n)} dates`)}${d.nisar_tracks?.length ? ` on tracks ${d.nisar_tracks.join(', ')}` : ''}. Sentinel-1 adds a pass every few days.`,
      stat: (d) => (d.nisar_dates ? { value: nf(d.nisar_dates), unit: 'NISAR dates' } : null),
    },
    {
      id: 'downstream',
      label: 'Downstream',
      title: () => 'Downstream: where released water would go',
      simple: (d) =>
        !d.downstream_km
          ? 'No downstream route could be drawn for this dam with the global river map.'
          : `Water leaving the dam follows the river for about ${nf(d.downstream_km)} km to ${downName(d, names)}${d.towns.length ? `, passing ${d.towns.slice(0, 3).map((t) => t.name).join(', ')}${d.towns.length > 3 ? ' and more' : ''}` : ''}.`,
      expert: (d) =>
        `Modelled drainage route: HydroRIVERS NEXT_DOWN chain (500 m-scale network) from the snapped reach to ${downName(d, names)}: ${or(d.downstream_km, (k) => `${nf(k, 1)} km`)}. OSM places within 2 km: ${d.towns.length}. Not a flood extent; V1's 30 m D8 path on GEM-15 gives 101.0 km for Mellègue (HydroRIVERS 104.9 km).`,
      stat: (d) => (d.downstream_km ? { value: nf(d.downstream_km), unit: 'km downstream' } : null),
    },
    {
      id: 'watch',
      label: 'Watch',
      processedOnly: true,
      title: () => 'Watch the lake, raise alerts',
      simple: (d) =>
        d.status === 'processed'
          ? 'For Mellègue the full watch is running: 133 radar measurements, and an automatic alarm that would have fired on 22 June 2026, five days after the gate failed.'
          : 'Next for this dam: measure the lake on every radar pass and test the alarm here before trusting it (V2 milestone 1).',
      expert: (d) =>
        d.status === 'processed'
          ? '41 NISAR + 92 Sentinel-1 areas (per-image Otsu), 21-day multi-sensor baseline, WARNING < −12 %, ALERT < −20 % with independent confirmation; first ALERT 22 Jun (S1 o161 −20.5 %).'
          : 'Planned: generalised 02_reservoir (confidence flags) and 03_anomaly run unchanged, with detection / false-alarm rates reported out of sample before any alert is shown.',
    },
    {
      id: 'flood',
      label: 'Flood',
      processedOnly: true,
      title: () => '“What if” flood scenarios',
      simple: (d) =>
        d.status === 'processed'
          ? 'For Mellègue you can already release any volume and see the fields, roads and villages the water could reach (scenario, not a forecast).'
          : 'Next: the same quick flood for any volume along this river, and physics runs for the dams that matter most.',
      expert: (d) =>
        d.status === 'processed'
          ? 'HAND bathtub (any volume ≥ 5 Mm³) and ANUGA 2D for 21 / 50 / 195 Mm³; arrival at the confluence 13–19 h (mesh-sensitive).'
          : 'Planned: HAND LUT on GEM-15 (else GLO-30) for every dam; ANUGA for the top 2–3 dams with a mesh-sensitivity pair per run (2–5 h per dam).',
    },
  ];
}
