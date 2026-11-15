# Numbers check: every number in submission/ and README.md, with its source

B = `apps/web/public/data/2026-11-15/`. Status: ✅ matches the file · ⚠️ note.

| Number (as written) | Source file / field | Status |
|---|---|---|
| Gate failure ~21:15 local, 17 Jun 2026 | B/story/events.json (REPORTED, Business News) | ✅ |
| 72-year-old gate / built 1954 | docs/01 §5 (Mellègue 1954) | ✅ (2026 − 1954) |
| 100,000 m³ planned release | docs/01 §6, Business News URL | ✅ |
| ~21 Mm³ released; alt. 29 Mm³ | B/level/level_volume.json `reported[0]` (La Presse; Tunisie Numérique) | ✅ |
| Water reaches Sidi Salem 21 Jun | B/story/events.json (AllAfrica) | ✅ |
| Gate repaired 16 Jul | B/story/events.json (Managers) | ✅ |
| ~80% silted | docs/01 §5; AllAfrica in sources.json | ✅ |
| Upper Mellègue 195 Mm³ | B/story/sources.json `wd-upper`; docs/01 §5 | ✅ |
| Bulletins stopped October 2025 | docs/01 §5 (ONAGRI); Business News URL | ✅ |
| Under ~400 m³ per person per year | docs/01 §5 ("400–420"); Webdo | ✅ |
| Sentinel-1 17 Jun 17:20 UTC (18:20 local), ~3 h before | B/timeseries/reservoir_area.json point 2026-06-17 o88 `time_utc` | ✅ |
| 2.92 km² (1.91–3.27) on 17 Jun | reservoir_area.json `area_km2` 2.924; band from work/reservoir/series_adaptive.csv `area_lo/area_hi` 1.914/3.266 | ✅ |
| NISAR first image 19 Jun (D80) | reservoir_area.json first NISAR point; manifest product ID | ✅ |
| −18% on D80, 1 → 13 Jul | reservoir_area.json D80: 2.495 → 2.048 km² = −17.9% | ✅ |
| 133 measurements, 41 NISAR + 92 S1 | reservoir_area.json `points` (sensor counts) | ✅ |
| 4.69 km² lake polygon, 19 pre-failure S1 images | B/vectors/lake_max.geojson `area_km2` 4.685, `method` | ✅ |
| 31 NISAR dates, 4 tracks; revisit 2–7 days | docs/01 §4 | ✅ |
| First ALERT 22 Jun, S1 o161 −20.5%, confirmed o88 −28.8% | B/anomaly/alerts.json evaluations 2026-06-22; validation.json B1 | ✅ |
| 0 flags in 14 pre-failure evaluations | alerts.json: 14 evaluations dated 18 May–17 Jun, all NORMAL | ✅ ⚠️ docs/07 §8 writes "16 May–17 Jun" (baseline start); first evaluation is 18 May — we avoided giving the date range |
| First NISAR flag 26 Jun, A173, WARNING, −13% | alerts.json 2026-06-26 (−13.1%) | ✅ |
| Rule: 21 days, −12% / −20%, confirmation within 6 days | alerts.json `method` | ✅ |
| Aug–mid-Nov: 3 ALERT + 12 WARNING | alerts.json (counted, last eval 14 Nov); validation.json B2 | ✅ ⚠️ docs/07 §8 says Aug–Oct 11 W + 2 A (same data, shorter window) |
| SWOT 260.54 → 256.79 m, −3.75 ± 0.08 m, 7 → 28 Jun | level_volume.json `swot.points`; validation.json L3 (dh −3.749, dh_u 0.076) | ✅ |
| SWOT lake 1530007983, 19 passes kept | level_volume.json `swot.lake_id`, `reason` | ✅ |
| ΔV −12.7 Mm³ (7.8–17.1), 0.6 × 21 | level_volume.json `delta_volume[0]`; validation.json L6 | ✅ |
| DEM-shoreline +6.5 to +10.1 m vs SWOT, not shipped | validation.json L5 (6.45…10.1) | ✅ |
| Flow path 101 km; Jendouba km 37.6; Medjerda km 44.9; Bou Salem km 66.8 | B/vectors/flowpath.geojson `length_km` 100.97, `reach_breaks` | ✅ |
| 98.8% within 300 m of OSM rivers | validation.json D2 (98.826) | ✅ |
| Catchment 10,315 km² | B/vectors/catchment.geojson 10314.9 | ✅ |
| ANUGA 112 km², 69,616 triangles, 12 h release | B/flood/anuga/index.json `method` | ✅ |
| Wet 19.3 / 35.4 / 71.8 km² | flood/anuga/*/stats.json `inundated_km2` 19.349 / 35.431 / 71.813 | ✅ |
| Cropland 1,112 / 2,448 / 5,573 ha | B/impacts/impacts.json `cropland_ha` 1111.9 / 2447.7 / 5573.0 | ✅ |
| Front at confluence 12.9 / 9.3 / 6.2 h; 13–19 h range | stats.json `arrival_h["Medjerda confluence"]`; 19 h = interim two-zone run (docs/07 §8 E4) | ✅ |
| Mass balance ≤ 9×10⁻¹³ of V | stats.json `mass_balance_err` 8.96e-13 max | ✅ |
| IoU 0.40–0.66 | validation.json D5 (0.401…0.661) | ✅ |
| HAND 195 Mm³ → 4 villages (Muthul, Ben Bchir, Bou Salem, Sidi Smail) | B/flood/hand_lut.json (villages = 4 at h 4.54 m); names: work/routing/gem15/F3_villages.json (min HAND ≤ 4.54 m) | ✅ (names from work/, not the bundle) |
| Threshold ±2 dB → median ±23% | validation.json A1 `median_half_range` 0.229 | ⚠️ docs/01 §7, docs/07 §8 and the science review say "≈ ±20%"; validation.json is the newer file. Pick one before the pitch |
| ANUGA 33–48 min per scenario on 4 threads | `git show v2:docs/09…` §0.4 | ✅ (doc, not bundle) |
| 90% of summer-green cropland in LGRIP30 irrigated class | CLAUDE.md §8 (irrigation finding) | ⚠️ not in the bundle; from the 00b_irrigation run notes |
| Reservoir list for v2 | v2 docs/09 §0.5 | ✅ |
| Dive ~3.9 s (video script) | CLAUDE.md §5 M3 | ✅ |

**Not used on purpose:** population counts (HAND LUT interpolation gives ≈ 970 for 21 Mm³ while CLAUDE.md says ~980, and ≈ 6,680 vs ~6,600 for 195 Mm³); "Sidi Salem is the country's largest reservoir" (not in docs/01). CLAUDE.md §8 gives S1 o168 16 Jun as 2.88 km²; the bundle says 2.864, so we left that number out.
