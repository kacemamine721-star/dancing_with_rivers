/**
 * Methods tutorial: one step per pipeline stage, in the order the data flows. Every number here
 * was checked against the bundle (science review, 15 Nov 2026); the file named in `data` holds it.
 * Figures come from pipeline/10_method_figures.py (public/methods/figures.json).
 */
import type { BadgeKind } from '@/components/badge-model';

export interface MethodNumber {
  label: string;
  value: string;
  unit?: string;
  badge: BadgeKind;
}

export interface MethodStep {
  id: string;
  /** figures.json id */
  figure: string;
  chapter: string;
  title: string;
  /** plain-language explanation (Simplified) */
  simple: string;
  /** technical explanation (Advanced) */
  expert: string;
  numbers: MethodNumber[];
  /** honest limit of this step */
  limit: string;
  /** bundle file that holds the numbers */
  data: string;
  script: string;
}

export const CHAPTERS = [
  { id: 'see', title: 'See the water', blurb: 'Turn radar echoes into a water outline.' },
  { id: 'track', title: 'Track the lake', blurb: 'Measure it again and again, and notice when it drops.' },
  { id: 'level', title: 'Weigh the lake', blurb: 'Add the height of the surface to get a volume.' },
  { id: 'flow', title: 'Follow the water', blurb: 'Where would released water go, and what is in its way?' },
] as const;

export const STEPS: MethodStep[] = [
  {
    id: 'radar',
    figure: 'm01',
    chapter: 'see',
    title: 'How radar sees a lake',
    simple:
      'A radar satellite sends microwaves to the ground and listens for the echo. Rough ground (fields, hills, towns) sends part of the signal back, so it looks bright. Calm water acts like a mirror and bounces the signal away, so it looks dark. That works at night and through clouds. We use two radars: Sentinel-1 (Europe, C-band) and NISAR (NASA–ISRO, L-band, longer waves).',
    expert:
      'Inputs: NISAR L2 GCOV (L-band, HH, 4 tracks A101 / A173 / D8 / D80) and Sentinel-1 RTC (C-band, VV, orbits 88 / 161 / 168, Planetary Computer), both terrain-corrected backscatter in dB, resampled to the 10 m lake-chip grid (UTM 32N). C- and L-band respond differently to wind and wet mud, so cross-sensor pairs are compared by outline only, never by brightness.',
    numbers: [
      { label: 'NISAR tracks', value: '4', badge: 'measured' },
      { label: 'Sentinel-1 orbits', value: '3', badge: 'measured' },
      { label: 'Chip grid', value: '10', unit: 'm', badge: 'measured' },
    ],
    limit:
      'The last image before the failure is Sentinel-1 on 17 June at 17:20 UTC; NISAR’s first image after it is 19 June. No satellite imaged the failure itself.',
    data: 'radar/*.png, timeseries/reservoir_area.json',
    script: 'pipeline/02_reservoir.py',
  },
  {
    id: 'polygon',
    figure: 'm02',
    chapter: 'see',
    title: 'Draw where the lake can be',
    simple:
      'Fields after the harvest can look as dark as water. To avoid counting them, we first draw the area where the lake was in the weeks before the failure, plus a thin margin, and only count water inside it.',
    expert:
      'Pre-failure water frequency from the Sentinel-1 stack, thresholded and cleaned into one lake polygon (4.68 km² including a 100 m dilation), plus a 300 m ring for the histogram. A wide box failed the go/no-go test: water area rose after the failure because harvested fields darkened.',
    numbers: [{ label: 'Lake polygon', value: '4.68', unit: 'km²', badge: 'measured' }],
    limit: 'Water outside the polygon (for example a flooded field downstream) is not counted by design.',
    data: 'vectors/lake_max.geojson',
    script: 'pipeline/02_reservoir.py',
  },
  {
    id: 'threshold',
    figure: 'm03',
    chapter: 'see',
    title: 'Choose “dark enough” for each image',
    simple:
      'Wind ripples make water brighter, and wet mud can look like water. One fixed cut-off fails, so for every image the computer looks at the brightness of all pixels inside the lake area and picks the value that best splits them into two groups: water and not water.',
    expert:
      'Per-image Otsu threshold on the dB histogram inside polygon + 300 m ring, after a 5 × 5 boxcar, clamped to −23…−13.5 dB. A fixed −18 dB failed: the 17 Jun S1 o88 lake is wind-roughened (−15…−17 dB) and post-failure NISAR wet mud sits at −15…−18 dB. Images where the split is unreliable (wind) are flagged low-confidence.',
    numbers: [
      { label: 'Threshold clamp', value: '−23…−13.5', unit: 'dB', badge: 'measured' },
      { label: 'Low-confidence', value: '2', unit: 'of 133', badge: 'measured' },
    ],
    limit:
      'Moving the threshold by ±2 dB changes the area by a median ±23 % (test A1 ⚠️). The chart draws this band instead of hiding it.',
    data: 'timeseries/reservoir_area.json, validation/validation.json (A1)',
    script: 'pipeline/02_reservoir.py',
  },
  {
    id: 'masks',
    figure: 'm04',
    chapter: 'see',
    title: 'From image to water mask',
    simple:
      'Each image becomes a black-and-white mask: water or not. Counting the water pixels gives the lake area in km². Seen one after another, the masks show the lake shrinking after the gate failed.',
    expert:
      'Area = water pixels × 100 m² inside the polygon. Masks are not compared across sensors as evidence: NISAR right after the failure still counts wet mud as water (D80 2.49 km² on 19 Jun, 2.50 km² on 1 Jul) while same-orbit Sentinel-1 shows the change at once.',
    numbers: [
      { label: 'S1 o88 · 17 Jun', value: '2.92', unit: 'km²', badge: 'measured' },
      { label: 'NISAR D80 · 19 Jun', value: '2.49', unit: 'km²', badge: 'measured' },
      { label: 'NISAR D80 · 25 Jul', value: '1.61', unit: 'km²', badge: 'measured' },
    ],
    limit: 'Sentinel-1 “before” and NISAR “after” are different radars: compare outlines, not shades.',
    data: 'timeseries/reservoir_area.json',
    script: 'pipeline/02_reservoir.py',
  },
  {
    id: 'series',
    figure: 'm05',
    chapter: 'track',
    title: 'A lake measured every few days',
    simple:
      'Putting all the measurements on one timeline shows the story: the lake was steady in spring, dropped for weeks after 17 June until the gate was repaired on 16 July, stayed low in August and rose again with the autumn rain. It was a drawdown over weeks, not an overnight disappearance.',
    expert:
      '133 measurements (41 NISAR + 92 Sentinel-1), 16 May → 14 Nov 2026, harmonised per track. Line = 21-day multi-sensor median of reliable points, broken across the NISAR gap (27 Jul → 13 Aug); band = threshold ±2 dB. Same-track checks: NISAR tracks agree within ±4 % (A2 ✅); NISAR vs Sentinel-1 differ by ±16 % median (A3 ❌, wet mud at L-band), so sensors are harmonised, not mixed raw.',
    numbers: [
      { label: 'Measurements', value: '133', badge: 'measured' },
      { label: 'NISAR / S1', value: '41 / 92', badge: 'measured' },
      { label: 'Revisit', value: '2–5', unit: 'days', badge: 'measured' },
    ],
    limit: 'Area is not volume: a shallow edge drying out changes the area more than the same volume lost in deep water.',
    data: 'timeseries/reservoir_area.json',
    script: 'pipeline/02_reservoir.py',
  },
  {
    id: 'anomaly',
    figure: 'm06',
    chapter: 'track',
    title: 'Raise an alarm automatically',
    simple:
      'Every new measurement is compared with the typical value of the previous three weeks. A drop of more than 12 % is a warning, more than 20 % an alert, and another satellite pass must confirm it. With NISAR and Sentinel-1 together, this would have raised an alarm on 22 June, five days after the failure, with no ground sensor.',
    expert:
      'Departure = harmonised area / 21-day multi-sensor median − 1. WARNING < −12 %, ALERT < −20 %, each confirmed by an independent pass within 6 days. First ALERT 22 Jun 2026: S1 o161 −20.5 %, confirmed by S1 o88 −28.8 % (NISAR in the baseline only). 0 flags in 14 checks 18 May → 17 Jun. First NISAR flag 26 Jun (A173, WARNING, −13.1 %). Aug → mid-Nov: 3 ALERT + 12 WARNING during a real multi-sensor decline, reported as “needs operator check”.',
    numbers: [
      { label: 'First alert', value: '22 Jun', badge: 'modelled' },
      { label: 'After failure', value: '5', unit: 'days', badge: 'modelled' },
      { label: 'Flags before', value: '0', unit: 'of 14', badge: 'modelled' },
    ],
    limit:
      'The thresholds were tuned on this event (retrospective test). An earlier single-pair z-score rule failed validation and was replaced.',
    data: 'anomaly/alerts.json, validation/validation.json (B1–B3)',
    script: 'pipeline/03_anomaly.py',
  },
  {
    id: 'swot',
    figure: 'm07',
    chapter: 'level',
    title: 'Measure the height of the lake',
    simple:
      'Radar images show how big the lake is, not how deep. The SWOT satellite (NASA–CNES) measures the height of the water surface. On 7 June it read 260.54 m; on 28 June, 256.79 m: the surface fell by 3.75 m. Multiplying that drop by the lake area gives the volume lost from storage.',
    expert:
      'SWOT LakeSP via Hydrocron, PLD lake 1530007983, quality 0 passes only for numbers. Δh = −3.75 ± 0.08 m (7 → 28 Jun, L3 ✅). ΔV = trapezoid ∫A·dh with A from radar (low) to SWOT area_total (high): −12.7 Mm³ (−17.1…−7.8), MODELLED. This is net storage change (inflow continues, the release went on to 16 Jul): ≈ 0.6 × the reported 21 Mm³. Radar-shoreline × DEM levels were rejected (L5: +6.5…+6.9 m bias).',
    numbers: [
      { label: 'Level drop', value: '−3.75', unit: 'm', badge: 'measured' },
      { label: 'Storage change', value: '−12.7', unit: 'Mm³', badge: 'modelled' },
      { label: 'Reported release', value: '21–29', unit: 'Mm³', badge: 'reported' },
    ],
    limit:
      'Storage change is not the released volume. SWOT’s lake polygon (4–4.9 km²) is larger than the radar water area (2.2–2.6 km²); the level is not affected.',
    data: 'level/level_volume.json',
    script: 'pipeline/07_level_volume.py',
  },
  {
    id: 'flowpath',
    figure: 'm08',
    chapter: 'flow',
    title: 'Find the way downhill',
    simple:
      'Water always takes the steepest way down. On a 3D map of the ground, the computer follows that steepest path from the dam, cell by cell, all the way to the Sidi Salem reservoir, 101 km away, through Jendouba and Bou Salem.',
    expert:
      'D8 flow routing (pysheds) on GEM-15 (Google Research experimental 15 m bare-earth DTM) block-averaged to 30 m, gaps filled from NASADEM. Path 101.0 km: Jendouba km 37.6, Medjerda confluence km 44.9, Bou Salem km 66.8. D2 ✅: 98.8 % of the path within 300 m of OSM rivers (NASADEM 98.6 %).',
    numbers: [
      { label: 'Flow path', value: '101.0', unit: 'km', badge: 'modelled' },
      { label: 'On OSM river', value: '98.8', unit: '%', badge: 'modelled' },
    ],
    limit: 'A 30 m terrain model has no river-bed depth (no bathymetry); small channels and bridges are not resolved.',
    data: 'vectors/flowpath.geojson',
    script: 'pipeline/04_routing_hand.py',
  },
  {
    id: 'hand',
    figure: 'm09',
    chapter: 'flow',
    title: 'Quick flood: fill the valley like a bathtub',
    simple:
      'For each point we know how high it sits above the nearest river (HAND). Pour a volume into the valley and raise the water level until it holds that volume: every place lower than that level gets wet. It is instant, so you can try any volume with the slider.',
    expert:
      'Height Above Nearest Drainage on the main stem, whole corridor to Sidi Salem; a volume → stage lookup table (bathtub, static). 21 Mm³ → h 0.97 m, 26.5 km², ≈ 1,310 ha cropland, ≈ 970 people (WorldPop); 195 Mm³ (hypothetical) → 4.54 m, 79 km², ≈ 5,330 ha, 4 villages. Not meaningful below 5 Mm³.',
    numbers: [
      { label: '21 Mm³ · wet area', value: '26.5', unit: 'km²', badge: 'modelled' },
      { label: '21 Mm³ · water height', value: '0.97', unit: 'm', badge: 'modelled' },
    ],
    limit: 'A bathtub has no timing and no flow: it spreads the volume everywhere at once. It is a screening tool.',
    data: 'flood/hand_lut.json',
    script: 'pipeline/04_routing_hand.py',
  },
  {
    id: 'anuga',
    figure: 'm10',
    chapter: 'flow',
    title: 'Physics flood: let the water run',
    simple:
      'A 2D flood model (ANUGA) splits the valley into about 70,000 small triangles and computes, every few seconds, how deep and how fast the water is in each one. It shows when the water arrives, not only where. We ran it for 21, 50 and 195 million m³.',
    expert:
      'ANUGA 4.2.0, uniform mesh 69,616 triangles ≤ 2,500 m² (112 km² domain, dam → Medjerda confluence + 2 km), 12 h triangular release hydrograph, 48 h simulated, mass balance ≤ 1e-12 of V. Wet area 19.3 / 35.4 / 71.8 km², peak flow 972 / 2,315 / 9,028 m³/s for 21 / 50 / 195 Mm³. Confluence arrival 12.9 / 9.3 / 6.2 h, but E4 ❌ (a two-zone mesh gave 19.1 h, 15.0 km²), so arrival is shown as 13–19 h.',
    numbers: [
      { label: 'Triangles', value: '69,616', badge: 'modelled' },
      { label: '21 Mm³ · wet area', value: '19.3', unit: 'km²', badge: 'modelled' },
      { label: 'Arrival at confluence', value: '13–19', unit: 'h', badge: 'modelled' },
    ],
    limit:
      'Release shape and duration are assumptions; arrival times depend on the mesh. 195 Mm³ is hypothetical (Upper Mellègue size) released at the old dam. Scenario, not a forecast.',
    data: 'flood/anuga/*/stats.json',
    script: 'pipeline/05_anuga_scenarios.py',
  },
  {
    id: 'exposure',
    figure: 'm11',
    chapter: 'flow',
    title: 'What is in the way?',
    simple:
      'Overlaying the wet area with maps of fields (ESA WorldCover), roads and buildings (OpenStreetMap) and population (WorldPop) tells what the water could reach. Being reached is not the same as being damaged.',
    expert:
      'Per scenario: cropland ha (WorldCover 10 m), road km and building centroids (OSM), people (WorldPop 100 m, modelled), villages with water within 200 m and the first arrival hour. ANUGA cropland 1,112 / 2,448 / 5,573 ha (21 / 50 / 195 Mm³). F1 ✅ exposure ≤ wet area; F2 ✅ counts grow with volume; F3 (manual village check) not done.',
    numbers: [
      { label: 'ANUGA 21 Mm³ · cropland', value: '1,112', unit: 'ha', badge: 'modelled' },
      { label: 'ANUGA 195 Mm³ · cropland', value: '5,573', unit: 'ha', badge: 'modelled' },
    ],
    limit: 'Exposure is not damage: no depth-damage curves, no field survey. OSM misses some buildings and the Jendouba irrigated perimeter.',
    data: 'impacts/impacts.json',
    script: 'pipeline/06_impacts.py',
  },
];
