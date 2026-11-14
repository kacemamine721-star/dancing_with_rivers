# 07 · Analysis & Validation Guide

Step-by-step recipes for every analysis in the app, **how to test each one**, and the pass criteria. Written so Claude Code (or a teammate) can implement and run them directly. Thresholds and AOIs live in `config.yaml` (→ 03 §2).

---

## 0. Run order & what each step proves

| Step | Script | Produces | Proves |
|---|---|---|---|
| A | `02_reservoir.py` | Area per date | The lake drained after 17 Jun (MEASURED) |
| B | `03_anomaly.py` | Alerts | The drop was detectable automatically |
| C | `07_level_volume.py` | Level, ΔV | How much water left (ESTIMATED) |
| D | `04_routing_hand.py` | Flow path, HAND, LUT | Where water goes for any volume (MODELLED, quick) |
| E | `05_anuga_scenarios.ipynb` | Depth, arrival per scenario | Physics-based checkpoints (MODELLED) |
| F | `06_impacts.py` | ha, villages, roads | Who and what is exposed |
| V | Section 7 | Validation table | It is scientifically sound |

---

## 1. Reservoir water area (MEASURED)

**Recipe**
1. Run `python mellegue_reservoir.py --box 8.665 36.290 8.735 36.330 --water-db -18` (existing script).
2. Visually QA every chip in `chips/`: the mask must follow the lake, not the fields. Reject dates with wind (S1) or layover artefacts.
3. Build `lake_max.geojson` = union of all accepted masks, dilated 100 m; re-run with `--polygon lake_max.geojson` so area is only counted inside it.

**Tests**

| ID | Test | How | Pass |
|---|---|---|---|
| A1 | **Threshold sensitivity** | Recompute area with T = −16, −18, −20 dB | Area changes < 15% between −16 and −20 dB on calm dates; the drawdown *shape* is unchanged |
| A2 | **Track consistency** | Compare NISAR dates ≤ 2 days apart on different tracks (e.g. 19 Jun D80 vs 21 Jun A101; 1 Jul vs 3 Jul) | Difference ≤ 10% after offset normalisation, unless a real change happened (e.g. right after the failure) |
| A3 | **Cross-sensor** | NISAR vs Sentinel-1 within ±2 days (e.g. NISAR 21 Jun vs S1 22 Jun) | ≤ 15% |
| A4 | **Optical check** (optional) | Sentinel-2 L2A cloud-free date ±3 days: NDWI = (G − NIR)/(G + NIR) > 0 inside the polygon | ≤ 15% |
| A5 | **Noise floor** | Std of area on 3 consecutive stable dates in Sep–Oct | Report as ± uncertainty on the chart |

```python
# A4 — Sentinel-2 NDWI area (Planetary Computer)
import planetary_computer as pc, pystac_client, rasterio, numpy as np
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
items = cat.search(collections=["sentinel-2-l2a"], bbox=[8.665,36.29,8.735,36.33],
                   datetime="2026-06-20/2026-07-05", query={"eo:cloud_cover": {"lt": 10}}).item_collection()
# read B03 and B08 over the polygon (rasterio.mask), ndwi = (b3-b8)/(b3+b8); area = (ndwi>0).sum()*100 m²
```

## 2. Water level & volume change (ESTIMATED): how to test it

NISAR measures **area**. Level and volume need extra information. We use **three independent methods** and check them against each other and against reported figures.

### 2.1 Method A: SWOT lake height (direct measurement)
1. **Find the lake ID** in SWOT's Prior Lake Database (PLD):
   - In Earthdata Search, look for the SWOT L2 HR LakeSP **Prior** collection (latest version, e.g. `SWOT_L2_HR_LakeSP_D`) over `8.6,36.25,8.8,36.35`; or use `earthaccess.search_data(short_name=..., bounding_box=...)`.
   - Open one granule's shapefile and read `lake_id` for the polygon over Mellègue (and Sidi Salem).
2. **Query Hydrocron** (no auth):
```
https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries?feature=PriorLake&feature_id=<LAKE_ID>&start_time=2026-04-01T00:00:00Z&end_time=2026-11-14T00:00:00Z&output=csv&fields=lake_id,time_str,wse,wse_u,area_total,quality_f
```
3. Keep `quality_f ≤ 1` (good/suspect), drop fill values (−999999999999).

| ID | Test | Pass |
|---|---|---|
| L1 | SWOT `area_total` vs NISAR area on dates ≤ 3 days apart | ≤ 20% |
| L2 | Sign test: SWOT level falls when NISAR area falls (Jun–Jul) | Consistent sign on all pairs |
| L3 | Level drop across the event (last SWOT before 17 Jun → first after) | Report Δh ± `wse_u` |

If Mellègue is too small or missing in PLD, apply A to **Sidi Salem**: its **rise** after 21 Jun is an independent check of the arrival of the released water.

### 2.2 Method B: shoreline × DEM (indirect level)
The waterline is a contour line: the terrain elevation along the shoreline ≈ water level.
```python
from scipy import ndimage as ndi
edge = mask & ~ndi.binary_erosion(mask, iterations=1)                  # water pixels touching land
land_ring = ndi.binary_dilation(mask, iterations=2) & ~mask            # 1–2 px land side
z = dem_on_chip_grid[land_ring]
level = np.median(z[(z > np.percentile(z,10)) & (z < np.percentile(z,90))])
sigma = 1.4826 * np.median(np.abs(z - level)) / np.sqrt(max(1, land_ring.sum()/9))
```
**Caveat:** NASADEM comes from SRTM (Feb 2000) and Copernicus DEM from 2011–2015. They saw the lake **water surface at that time**, so there is no terrain below it. Method B only works where the 2026 shoreline lies **above** the DEM-era water surface; otherwise flag it "below DEM water surface: not measurable".

| ID | Test | Pass |
|---|---|---|
| L4 | Stability on stable dates (Sep–Oct) | σ(level) ≤ 1.5 m |
| L5 | Agreement with SWOT (if both exist) | ≤ 2 m |

### 2.3 Method C: area–level curve → volume
Two ways to get the curve A(h):
- **C1 (DEM hypsometry):** for h from the DEM-era surface upward, A(h) = area of DEM cells < h connected to the lake.
- **C2 (satellite-derived curve, preferred if SWOT exists):** pair NISAR areas with SWOT levels on close dates; fit A(h) = a + b·h (or a power law). This works even below the DEM surface.

Then the **volume change** between two dates:
```
ΔV = ∫_{h2}^{h1} A(h) dh   ≈   (A1 + A2)/2 × (h1 − h2)        # trapezoid
```
Uncertainty: propagate σ_A (from A5) and σ_h (from L3 or L4) → `ΔV_low/high`.

| ID | Test | Pass |
|---|---|---|
| L6 | ΔV(17 Jun → 1–3 Jul) vs **reported 21 Mm³** (alt. 29) | Within a factor of 2, **or** the discrepancy is explained (siltation: 80% silted means a small live volume; inflows; evaporation; leakage) |
| L7 | Sidi Salem ΔV after 21 Jun (if SWOT) vs released volume minus losses | Same order of magnitude |
| L8 | National context: reported fill 60% (Jun) → 46% (23 Oct) is consistent with the observed summer decline of the measured lakes | Qualitative |

**How it is shown in the app (Act 8):** three panels, each `value ± band` with its method and badge; a short sentence on agreement: *"SWOT and the shoreline method agree within X m; the estimated loss is Y–Z million m³, consistent with the reported 21 million m³."* If a method fails, say why.

> **Important physical note for the story:** an ~80% silted reservoir holds little water for its surface area. A 21 Mm³ release would therefore mean a **large level drop**, and it could exceed the reservoir's remaining live volume. Check the official capacity figures and present any mismatch honestly (reports may count multi-day flows).

## 3. Change maps (MEASURED)
- Same-track pairs only: (19 Jun → 1 Jul D80), (21 Jun → 3 Jul A101), S1 (17 Jun → 22 Jun o88).
- Log-ratio of boxcar-filtered power; noise σ from a stable reference area (hills NW of the lake).
- **Test C1:** only report changes |Δ| > 3σ; the change inside the lake polygon must exceed the background 95th percentile.

## 4. Anomaly detection: tests

| ID | Test | How | Pass |
|---|---|---|---|
| B1 | **True positive** | Run on the series with the S1 17 Jun point as reference | ALERT on 19 Jun (cross-sensor) and/or WARNING/ALERT on the first same-sensor drop |
| B2 | **False alarms** | Run on 1 Aug → 29 Oct only | ≤ 1 WARNING, 0 ALERT |
| B3 | **Synthetic injection** | Take a stable Sep–Oct series; inject a −10/−20/−30% drop at a random date (100 trials) | Detection rate ≥ 90% at −20%, false-alarm rate ≤ 5% |
| B4 | **Threshold sensitivity** | z ∈ {−2.5, −3, −3.5} | 19 Jun is still flagged at −3.5 |
| B5 | **Rain guard** (optional) | Add IMERG 7-day rain; check that no alert is suppressed wrongly | Documented |

Report B1–B3 on the validation page as a small table ("Detected 1/1 real event; 0 false alarms in 3 months; 94% of synthetic −20% drops").

## 5. Flow path & HAND quick flood (MODELLED)

DEM: use `work/gem15_dtm_15m.tif` (GEM-15, 15 m, → 09 §3.6) if the path on it passes D2; otherwise `work/dem_32632_30m.tif`. Report which one was used.

```python
from pysheds.grid import Grid
grid = Grid.from_raster("work/dem_32632_30m.tif"); dem = grid.read_raster("work/dem_32632_30m.tif")
dem = grid.resolve_flats(grid.fill_depressions(grid.fill_pits(dem)))
fdir = grid.flowdir(dem); acc = grid.accumulation(fdir)
streams = acc > (5e6 / 900)                                   # > 5 km² upstream
hand = grid.compute_hand(fdir, dem, streams)                  # Height Above Nearest Drainage
# flow path: from the dam outlet cell follow fdir to the Sidi Salem polygon (simple D8 walk)
```

**Volume → height lookup (for the continuous slider)**
```python
cell = 30*30
for h in np.arange(0.25, 15.01, 0.25):
    wet = corridor & (hand < h)
    V = ((h - hand[wet]) * cell).sum()
    rows.append(dict(h=h, V_m3=V, area_km2=wet.sum()*cell/1e6, cropland_ha=(wet&crop).sum()*cell/1e4, ...))
```

| ID | Test | Pass |
|---|---|---|
| D1 | Flow path reaches the Medjerda and Sidi Salem, never runs uphill (monotonic elevation) | ✓ |
| D2 | Path follows the visible river on the basemap (≥ 90% of vertices within 300 m) | ✓ |
| D3 | LUT monotonic (V and area increase with h) | ✓ |
| D4 | 21 Mm³ → h and extent are plausible (h within a few metres; extent confined to the valley floor) | Visual QA |
| D5 | HAND 21 Mm³ extent vs ANUGA 21 Mm³ max extent | IoU ≥ 0.4 (different physics; HAND is static), otherwise explain |

## 6. ANUGA scenarios (MODELLED)

### 6.1 Notebook skeleton (`05_anuga_scenarios.ipynb`, Colab)
```python
!pip -q install anuga rasterio
import anuga, numpy as np, rasterio
from scipy.interpolate import RegularGridInterpolator

# --- inputs prepared by 01/04 (UTM 32N) ---
DEM = "dem_32632_30m.tif"; DOMAIN = "anuga_domain.geojson"; CORRIDOR = "corridor_hand5m.geojson"
DAM_LINE = [[x1, y1], [x2, y2]]           # short line across the channel just below the dam (UTM)
V, D_h = 21e6, 12                          # scenario: volume (m³), duration (h)

bounding = load_polygon(DOMAIN)            # list of [x, y]; tag the last segment 'outflow'
tags = {'walls': list(range(len(bounding)-1)), 'outflow': [len(bounding)-1]}
domain = anuga.create_domain_from_regions(
    bounding, boundary_tags=tags, maximum_triangle_area=20000,
    interior_regions=[[load_polygon(CORRIDOR), 2500]], mesh_filename="mellegue.msh")
domain.set_name(f"v{int(V/1e6)}_d{D_h}"); domain.set_minimum_storable_height(0.01)
domain.set_flow_algorithm("DE0")

with rasterio.open(DEM) as src:
    z = src.read(1).astype(float); T = src.transform
xs = T.c + T.a*(np.arange(z.shape[1]) + .5); ys = T.f + T.e*(np.arange(z.shape[0]) + .5)
interp = RegularGridInterpolator((ys[::-1], xs), z[::-1], bounds_error=False, fill_value=np.nanmax(z))
xo, yo = domain.geo_reference.get_xllcorner(), domain.geo_reference.get_yllcorner()
def elev(x, y):
    x = np.asarray(x); y = np.asarray(y)
    if x.max() < 1e5: x, y = x + xo, y + yo        # ANUGA may pass coordinates relative to its origin
    return interp(np.c_[y, x])
domain.set_quantity("elevation", function=elev, location="centroids")
domain.set_quantity("friction", function=manning_from_worldcover, location="centroids")  # n per class (→ 03 §5.7)
domain.set_quantity("stage", expression="elevation")                                     # dry start

D = D_h*3600; Qp = 2*V/D; tp = 0.3*D
Q = lambda t: Qp*t/tp if t < tp else (Qp*(D-t)/(D-tp) if t < D else 0.0)               # triangular hydrograph
anuga.Inlet_operator(domain, DAM_LINE, Q=Q)
domain.set_boundary({'walls': anuga.Reflective_boundary(domain),
                     'outflow': anuga.Dirichlet_boundary([z_outlet_min - 2.0, 0.0, 0.0])})   # stage below the bed → free outflow
for t in domain.evolve(yieldstep=300, finaltime=48*3600):
    if int(t) % 3600 == 0: print(domain.timestepping_statistics(), "V =", domain.get_water_volume())

from anuga.utilities import plot_utils as pu
pu.Make_Geotif(f"{domain.get_name()}.sww", output_quantities=["depth"], myTimeStep="max",
               CellSize=30, EPSG_CODE=32632, output_dir="tifs")
```
Notes:
- `z_outlet_min` = lowest DEM elevation along the outflow segment. A Dirichlet stage below the bed lets water leave freely (a common ANUGA pattern); `anuga.Transmissive_boundary` is the alternative. A reflective outlet would pond water and fail test E1.
- Arrival time: read the `.sww` with `pu.get_centroids(pu.get_output(sww))` and take, per centroid, the first time with `height > 0.1 m`; rasterise to 30 m.
- Save `stats.json`: total inflow ∫Q dt, final volume in the domain, volume out through the boundary, max depth at villages, arrival hours.

### 6.2 Tests

| ID | Test | Pass |
|---|---|---|
| E1 | **Mass balance:** ∫Q dt − (V_domain(t_end) + V_out) | < 1% of V |
| E2 | **Inflow check:** ∫Q dt = V (hydrograph integrates to the scenario volume) | < 0.1% |
| E3 | **Stability:** no NaN; max speed < 15 m/s; no wet cells on ridges | ✓ |
| E4 | **Mesh sensitivity:** corridor triangles 2,500 vs 5,000 m² | Inundated area within 15%; arrival at the confluence within 20% |
| E5 | **Friction sensitivity:** n × 0.7 and × 1.3 | Report the range of arrival times (shown as a band in the app) |
| E6 | **Duration sensitivity:** 21 Mm³ at 6 / 12 / 24 h | Report peak Q and extent range |
| E7 | **Arrival plausibility:** reported arrival at Sidi Salem on 21 Jun (≈ 3–4 days, including attenuation in the Medjerda and upstream reservoir management) | The model's arrival at the end of Reach 1 must be earlier (hours to ~1 day); if Reach 2 is modelled, the order of magnitude must match |
| E8 | **Qualitative damage match:** the reported damaged farmland lies near the Mellègue valley downstream of the dam | Wet cells overlap cropland along the lower Mellègue/Jendouba |
| E9 | **Radar hint match:** faint brighter river line in S1/NISAR (17 → 22 Jun) | Lies inside the ANUGA wet footprint |

## 7. Impact metrics (MODELLED)
- Wet = depth > 0.1 m (ANUGA max) or HAND < h. Cropland = WorldCover 40; built-up = 50.
- Villages: OSM `place in (village, town, hamlet)` within 200 m of wet cells; arrival = min arrival time within 200 m.
- **Test F1:** areas sum to ≤ the wet area; **F2:** counts monotonic with volume across the HAND LUT; **F3:** spot-check 5 villages manually on the basemap.

## 8. Validation summary table (fill and show on the Methods page)

| Analysis | Check | Result | Status |
|---|---|---|---|
| Water area | A1 threshold ±2 dB | Area moves about ±20% (target < 15%); the drawdown shape is unchanged. Shown as a band | ⚠️ |
| | A2 track consistency | After per-track harmonisation the four NISAR tracks follow one curve; raw tracks differ by incidence angle | ⚠️ (number to add) |
| | A3 NISAR vs S1 | Agree from mid-July; NISAR reads higher in the first weeks (wet sediment at L-band), explained on the page | ⚠️ (number to add) |
| Anomaly | B1 true positive / B2 false alarms / B3 synthetic | Confirmed-departure rule: ALERT 22 Jun (5 days after), 0 flags before the failure; Oct–Nov flags coincide with a real decline (unclassified). The first pair z-score rule failed B2/B3 and was replaced | ⚠️ |
| Level | L1–L3 SWOT | [TBD / not available] | ⏳ |
| | L4–L5 DEM shoreline | [TBD] | ⏳ |
| Volume | L6 ΔV vs 21 Mm³ | [TBD] | ⏳ |
| Flood (HAND) | D1–D5 | [TBD] | ⏳ |
| Flood (ANUGA) | E1 mass balance / E4–E6 sensitivity / E7 arrival | [TBD] | ⏳ |
| Impacts | F1–F3 | [TBD] | ⏳ |

Replace ⏳ with ✅ (pass), ⚠️ (pass with caveat, explained) or ❌ (fail: removed from the claims).

## 9. What we will say, and what we will not

| ✅ Say | ❌ Do not say |
|---|---|
| "NISAR measured the lake shrinking 2 days after the failure" | "NISAR saw the gate fail" (first image 19 Jun) |
| "An automatic rule on NISAR images would have raised an alert on 19 June" | "We predicted the failure" |
| "Estimated volume loss X–Y Mm³, consistent with the reported 21 Mm³" | A single volume number without uncertainty |
| "Scenario: if 195 Mm³ were released, these areas could be exposed" | "Jendouba will flood" / a forecast |
| "Screening-level flood exposure using 30 m terrain" | "Flood map" without qualifiers |
