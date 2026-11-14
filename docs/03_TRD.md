# 03 · Technical Requirements Document (TRD)

Defines **how** every feature in → 02 is implemented: data, pipelines, algorithms, frontend, non-functional requirements.

---

## 1. Technical principles

1. **Offline processing, static delivery.** All heavy work (radar reading, masks, DEM routing, ANUGA) runs in Python **before** the demo and produces a **static data bundle**. The web app is a React/TypeScript SPA built to static assets and deployed on Vercel (CDN): no runtime server and no API keys in v1, behind a data-access layer that can switch to an API later (§6.3).
2. **One common grid.** Every raster shown in 3D is reprojected to the **same terrain grid** (extent, CRS, resolution), so layers drape without client-side reprojection.
3. **Reproducible.** Each output comes from a script with a CLI, a fixed config (`config.yaml`) and a provenance record (product IDs, dates, thresholds) in `manifest.json`.
4. **Honest metadata.** Every layer and number carries `badge` (MEASURED / REPORTED / MODELLED / ILLUSTRATIVE), `source`, `method` and `uncertainty` fields.

## 2. Areas of interest (AOI)

| AOI | Bounds (lon/lat, WGS84) | Purpose | Notes |
|---|---|---|---|
| `A_SCENE` | **8.45, 36.10 → 9.50, 36.75** | 3D terrain, flow path to Sidi Salem | ~95 × 72 km |
| `A_VALLEY` | 8.55, 36.20 → 8.95, 36.56 | Radar change maps, ANUGA domain (dam → Jendouba/Medjerda) | used in `mellegue_test.py` |
| `A_LAKE` | **8.665, 36.290 → 8.735, 36.330** | Reservoir water area (tight) | from NISAR 19–21 Jun images; refine with a polygon |
| `A_SIDISALEM` | 9.25, 36.52 → 9.50, 36.68 | Receiving reservoir | arrival 21 Jun |
| Lake polygon | `data/vectors/mellegue_lake_max.geojson` | Max extent (union of water masks + S1 17 Jun) | built by script (§5.1) |

**Working CRS:** UTM 32N (**EPSG:32632**) for analysis; the web terrain grid is UTM 32N at **30 m** (scene) and **10 m** (lake chips).

## 3. Data sources

| Dataset | Provider | Use | Access | Format | Badge |
|---|---|---|---|---|---|
| **NISAR L2 GCOV** (HH, HV), all tracks | NASA/JPL via ASF DAAC | Water masks, area series, change maps, 3D drape | `asf_search` + HTTPS range reads (EDL token) | HDF5 → COG/PNG | MEASURED |
| NISAR L3 SME2 soil moisture | ASF | Context (catchment wetness) | same | HDF5 | MEASURED |
| NISAR L2 GUNW | ASF | Roadmap (deformation) | same | HDF5 | — |
| NISAR GCOV mosaics | NASA GIBS/Worldview | Quick visuals, fallback textures | WMS (no auth) | PNG | MEASURED (visual) |
| **Sentinel-1 RTC** (VV, VH) | ESA via Microsoft Planetary Computer | **Before image (17 Jun 17:20 UTC)**, cross-sensor validation | STAC + signed COG | COG | MEASURED |
| Sentinel-2 L2A (optional) | ESA via Planetary Computer | Optical basemap and NDWI validation on clear days | STAC | COG | MEASURED |
| **NASADEM** (or Copernicus DEM GLO-30) | NASA / ESA via Planetary Computer | 3D terrain, flow routing, HAND, ANUGA bed, hypsometry | STAC | COG | MEASURED |
| **SWOT L2 HR LakeSP** | NASA/CNES via PO.DAAC Hydrocron | Lake water-surface elevation and storage change | Hydrocron REST (`feature=PriorLake`) | JSON/CSV | MEASURED |
| ESA WorldCover 2021 | ESA via Planetary Computer | Cropland/built-up exposure, Manning's n | STAC | COG | MEASURED |
| OSM places, roads, buildings | OpenStreetMap (Overpass) | Villages, roads exposure | Overpass API | GeoJSON | REPORTED (map data) |
| GPM IMERG (optional) | NASA GES DISC | Rain context, anomaly guard | Earthdata | NetCDF | MEASURED |
| Press / official reports | lapresse.tn, businessnews.com.tn, TAP… | Event timeline, volumes, national fill % | manual | JSON (`events.json`) | REPORTED |

**Credentials:** `EARTHDATA_TOKEN` (NASA Earthdata Login, with "Alaska Satellite Facility Data Access" authorized). Planetary Computer and Hydrocron need no key. Never commit tokens.

## 4. Existing scripts (baseline)

| Script | Function | Reuse |
|---|---|---|
| `nisar_tunisia_inventory.py` | ASF inventory, footprints, site coverage | Provenance |
| `nisar_tunisia_all_platforms.py` | Multi-platform availability | Provenance, GIBS snapshots |
| `mellegue_test.py` | `RangeFile` (HTTP range reads with retry), `read_gcov`, `read_sme2`, `boxcar`, `db`, `otsu`, Sentinel-1 / WorldCover readers, PROJ-conflict guard | **Library**: import its functions |
| `mellegue_reservoir.py` | Area series (all NISAR dates + S1) in `A_LAKE`, chips, chart, GIF | Basis of `pipeline/02_reservoir.py` |

## 5. Algorithms

### 5.1 Water mask & lake polygon (MEASURED)
1. Read GCOV `HHHH` (and `HVHV`) for the AOI window; convert to γ⁰ dB.
2. Speckle filter: boxcar 5×5 in linear power (`mt.boxcar`).
3. Water = `HH_dB < T_w`, with **T_w = −18 dB** by default (L-band open water is typically −20 to −25 dB). Optionally confirm with `HV_dB < −25 dB`. Clamp any Otsu result to ≤ −15 dB.
4. Morphology: remove components < 20 px; fill holes < 50 px (scipy.ndimage, or numpy fallback).
5. **Restrict to the lake polygon** = union of all water masks (+ S1 17 Jun mask) dilated by 100 m, minus pixels flagged as "dry dark fields" (dark on > 70% of dates **outside** the lake connectivity).
6. Area = Σ water pixels × pixel area (m² → km²).

**Sentinel-1 (C-band VV):** same steps with `T_w = −18 dB` on VV (and wind check: if the mask's median VV is above −16 dB, flag "wind-roughened, low confidence").

### 5.2 Area time series
- One value per (date, sensor, track). Keep tracks separate (different incidence angles) and also produce a **harmonized series**: per-track offset normalization against the median of shared periods.
- Output: `timeseries/reservoir_area.json` (§6 of → 06).

### 5.3 Anomaly detection (rule-based, explainable)
For each new observation *t* versus the previous valid observation *t−1* (any track):

```
Δa       = (A_t − A_{t−1}) / A_{t−1}                    # relative area change
days     = t − (t−1)
expected = seasonal_rate(doy) × days                    # from climatology or from the series' robust trend
z        = (Δa − expected) / σ_Δ                        # σ_Δ = robust std (MAD × 1.4826) of Δa over the series, per day^0.5
rain_ok  = IMERG_7day_mm < 10                           # optional: exclude rain-driven rises
ALERT    if z < −3 and Δa < −15 %                       # abnormal drop
WARNING  if z < −2 and Δa < −8 %
```

- **Seasonal rate (v1):** the median daily relative change over Jul–Oct of the same series (summer drawdown), or a −0.3%/day prior if fewer than 6 points.
- **Before-event reference:** S1 17 Jun (and earlier S1 dates) provides `A_{t−1}` for the first NISAR date (19 Jun). Because the sensors differ, the alert text says "cross-sensor".
- Output: `anomaly/alerts.json` with the rule, numbers, level and explanation strings (Everyone/Experts).
- **Test:** → 07 §4 (true positive on 19 Jun; false-alarm count on the remaining dates).

### 5.4 Water level & volume (ESTIMATED)
Three independent methods, displayed with uncertainty:

| Method | How | When valid | Uncertainty |
|---|---|---|---|
| **A · SWOT LakeSP** | Find the Prior Lake Database ID for Mellègue and Sidi Salem (download LakeSP_Prior granules over `A_SCENE` with `earthaccess`, read `lake_id`), then query Hydrocron `timeseries?feature=PriorLake&feature_id=<id>&fields=lake_id,time_str,wse,area_total,quality_f` | Lake ≥ 0.06 km², SWOT pass available, quality flag good | ~0.1–0.3 m (good quality) |
| **B · Shoreline × DEM** | Extract the NISAR water-mask boundary; sample DEM elevations on the **land side** of the boundary; level = robust median (trim 10%) | Only where the exposed bank was dry when the DEM was acquired | ± 1–3 m (30 m DEM vertical error) |
| **C · Area→volume via hypsometry** | Build the area–elevation curve A(h) from the DEM above the DEM-era water surface; ΔV = ∫ A(h) dh between levels, or ΔV ≈ Ā × Δh | Levels above the DEM-era surface | ± 30–50% |

**Cross-checks (REPORTED):** released volume 21 Mm³ (press; one outlet 29 Mm³), Sidi Salem capacity (~580–643 Mm³) and reported fill %, national 60% (Jun) → 46% (23 Oct).
**Display rule:** if A is available, show it as the "level"; B and C are labelled "estimate" with error bars. Never show a single number without its band.

### 5.5 Flow path (D8 routing) (MODELLED)
- DEM (NASADEM 30 m) → fill depressions → D8 flow direction → flow accumulation (`pysheds` or `richdem`/`whitebox`).
- Trace the steepest-descent path from the dam outlet (snap to the max-accumulation cell within 300 m) to Sidi Salem.
- Outputs: `vectors/flowpath.geojson` (LineString with `dist_km` per vertex) and the stream network (accumulation > 5 km²) for HAND.

### 5.6 HAND quick-estimate flood (MODELLED, continuous slider)
- HAND = elevation − elevation of the nearest drainage cell (along flow paths), restricted to a **corridor** (≤ 5 km from the flow path, downstream of the dam).
- **Volume→height lookup:** for thresholds h = 0.25 … 15 m (step 0.25), compute the stored volume V(h) = Σ_{HAND<h} (h − HAND) × cell area in the corridor between the dam and the Medjerda confluence (Reach 1) and to Sidi Salem (Reach 2). Save `flood/hand_lut.json` = [{h, V_m3, area_km2, cropland_ha, builtup_ha, villages, road_km}].
- **Browser:** HAND as a 16-bit texture; the slider sets V → interpolate h → fragment shader colours pixels with `HAND < h` (depth = h − HAND). Instant and continuous.
- **Caveat text:** static "bathtub" along the valley; ignores timing and attenuation, so it overestimates near the dam and underestimates downstream peaks. Use it for exposure screening only.

### 5.7 ANUGA hydraulic simulation (MODELLED, physics checkpoints)
**Why ANUGA:** open source (GPLv2+), solves the 2D shallow-water equations with finite volumes on triangular meshes, and is designed for dam breaks and riverine floods. It installs with `pip`/`conda-forge`, runs on Colab, and has a Windows exe (`run-anuga`).

| Item | Specification |
|---|---|
| Domain | Polygon along the valley from 1 km upstream of the dam to the Medjerda confluence (Reach 1, ~35–40 km). P2: extend to Sidi Salem |
| Mesh | `anuga.create_domain_from_regions`; max triangle area **2,500 m²** in the channel corridor (HAND < 5 m), **20,000 m²** elsewhere; ~100–250k triangles |
| Elevation | NASADEM 30 m (`domain.set_quantity('elevation', raster/points)`); burn the flow-path channel −1 m to keep connectivity (documented) |
| Friction | Manning's n from WorldCover: cropland 0.035, grassland 0.035, shrub 0.05, trees 0.10, built-up 0.08, bare 0.03, water 0.03 |
| Inflow | `anuga.Inlet_operator` at the dam outlet with hydrograph **Q(t)**: triangular, volume **V**, duration **D**, peak at 0.3 D → `Q_peak = 2V / D` |
| Initial | Dry valley (June); the reservoir is not modelled (the release is the input) |
| Boundaries | Transmissive at the downstream edge; reflective on the side walls |
| Run time | Simulated 48 h; yieldstep 300 s |
| Outputs | Max depth, max speed, arrival time (first depth > 0.1 m), frames every 30 min → GeoTIFF → reprojected to the terrain grid → PNG (depth colour ramp) + JSON stats |
| Scenarios | **P1:** V ∈ {21, 50, 195} Mm³ at D = 12 h. **P2:** V ∈ {10, 100} and D ∈ {6, 24} h for 21 Mm³ (sensitivity) |
| Compute | Colab or a laptop with OpenMP; target ≤ 45 min per scenario at the P1 mesh. If too slow, coarsen the mesh ×2 |
| Checks | Mass balance error < 1%; arrival at the confluence plausible versus reports; extent versus the HAND estimate (→ 07 §6) |

**Peak flow sanity (for the narrative):** 21 Mm³ over 12 h gives Q_peak ≈ 970 m³/s; over 6 h ≈ 1,940 m³/s. Present these as scenario values, not facts.

### 5.8 Impact analysis
- Rasterize OSM roads and buildings, plus WorldCover cropland (40) and built-up (50), on the terrain grid.
- Per scenario (HAND h or ANUGA max depth > 0.1 m): cropland ha, built-up ha, buildings count, road km, villages (OSM `place=village|town|hamlet` within 200 m of wet cells), and **earliest arrival time per village** (ANUGA only).
- Output: `flood/impacts.json` keyed by scenario.

### 5.9 Change maps (MEASURED)
- Log-ratio `10·log10(boxcar(HH_t1)/boxcar(HH_t2))`, same track only, noise σ reported. Colour: brighter = teal/green, darker = magenta (the intro's convention).

## 6. Frontend technical requirements

The frontend is a **production React application**, not an upgraded HTML file. The prototype `NISAR-HydroStress-Cinematic-Intro.html` is the visual and behavioural reference: its look, timings and content are ported into typed components (→ 04).

### 6.1 Stack

| Layer | Technology | Notes |
|---|---|---|
| Language | **TypeScript 5** (`strict: true`) | Data contracts typed from Zod schemas |
| Framework / build | **React 18 + Vite 5** | SPA with lazy routes; `pnpm` workspace |
| Routing | **React Router 6** | `/`, `/story/:act`, `/watch/:damId`, `/methods`, `/sources`, `/school` (→ 04 §4) |
| 3D | **three.js (current) + @react-three/fiber + @react-three/drei** | One persistent `<Canvas>`; drei CameraControls, Html, useTexture, PerformanceMonitor, AdaptiveDpr |
| Shaders | GLSL files via `vite-plugin-glsl` | Terrain drape, swipe, HAND, flood depth, water shimmer |
| Post-processing | `@react-three/postprocessing` | Vignette, Noise (grain), Bloom |
| Animation | **GSAP 3** (+ ScrollTrigger) for camera and intro timelines; **Framer Motion** for UI | `prefers-reduced-motion` aware |
| Styling | **Tailwind CSS** + CSS-variable tokens | Tokens shared with shaders through `tokens.ts` |
| UI primitives | **Radix UI** via **shadcn/ui** | Slider, Dialog/Sheet, Popover, Tooltip, Switch, ToggleGroup, Toast |
| Charts | **visx** | Custom accessible SVG charts |
| State | **Zustand** + URL sync | Selectors used inside the Canvas to avoid re-renders |
| Data | **TanStack Query** + **Zod** | Fetch, cache, retry, validate every JSON of the bundle (→ 06 §3) |
| Workers | Web Worker + **Comlink** | Heightmap decoding, normals, LUT interpolation |
| i18n | **i18next** | EN now; FR/AR (RTL) P2 |
| Offline | **vite-plugin-pwa** (Workbox) | Precache shell + Acts 1–3 data for a safe live demo |
| Monitoring (optional) | Sentry (errors), Plausible (privacy-friendly analytics) | Off by default; enabled by env var |
| Quality | ESLint, Prettier, Vitest + RTL, Storybook, Playwright + axe-core, Lighthouse CI | Gates in → 04 §14 |
| CI/CD | **GitHub Actions** → **Vercel** (preview deploy per PR, production on `main`) | GitHub Pages is a fallback (needs a SPA 404 redirect) |

### 6.2 3D implementation

| Requirement | Decision |
|---|---|
| Terrain | `PlaneGeometry` (512² high / 384² medium / 256² low tier) displaced in the vertex shader from a **16-bit heightmap** packed in PNG (R = high byte, G = low byte; metres = (R·256 + G)/10 − 100) |
| Draping | Custom `ShaderMaterial` blending basemap, radar date A, radar date B, mask, change and flood layers; uniforms `uSwipe`, `uOpacity`, `uHandH`, `uDepth`, `uLakeChipRect`, `uNight`, `uExag` |
| Vectors | Flow path as a tube or `Line2` sampled on the heightmap; villages as instanced pins with drei `<Html>` labels |
| Camera | Named shots in `shots.ts`; GSAP tweens; CatmullRom spline for `valley_follow` |
| Intro | The prototype's procedural satellite, chapters and dive rebuilt as R3F components with a GSAP master timeline. **Port note:** r128 → current three.js changes colour management (`outputColorSpace`) and lighting (physically based), so light intensities must be retuned to match the prototype |
| Quality tiers | PerformanceMonitor → high / medium / low / 2D fallback (→ 04 §7.3) |

### 6.3 Data access layer
All data access goes through one interface, so the static bundle can later be replaced by an API without touching the UI:
```ts
interface DataSource {
  manifest(): Promise<Manifest>;
  reservoirArea(damId: string): Promise<ReservoirArea>;
  alerts(damId: string): Promise<Alerts>;
  handLut(damId: string): Promise<HandLut>;
  anugaIndex(damId: string): Promise<AnugaIndex>;
  impacts(damId: string): Promise<Impacts>;
  levelVolume(damId: string): Promise<LevelVolume>;
  textureUrl(layerId: string): string;
}
// v1: StaticBundleSource(baseUrl = import.meta.env.VITE_DATA_BASE_URL)  → /data/<version>/...
// v2: ApiSource(baseUrl)                                                  → FastAPI (roadmap, → 06 §1)
```
Every response is parsed with its Zod schema; a failure hides that layer and reports the error (→ 04 §13).

### 6.4 Performance budgets
| Item | Budget |
|---|---|
| First paint (loader) | < 1 s |
| Initial JS | ≤ 350 kB gzip (three.js, R3F and postprocessing in a separate chunk, loaded in parallel with the loader) |
| Intro ready | < 3 s on 20 Mbps |
| Mellègue scene ready after the dive | < 4 s (data and textures prefetched during the intro) |
| Initial data bundle | ≤ 15 MB (heightmap 2048² ~4 MB, 8 radar chips ~6 MB, overlays ~3 MB); WebP/AVIF for basemaps |
| Lazy data | ANUGA frames and extra dates per act (≤ 3 MB each) |
| FPS | ≥ 50 fps desktop 1080p; ≥ 30 fps mid-range laptop |
| GPU memory | < 600 MB (textures disposed when changing acts) |
| Lighthouse | Performance ≥ 70, Accessibility ≥ 95, Best Practices ≥ 95 |

### 6.5 Non-functional
- **Accessibility:** WCAG 2.2 AA target (→ 04 §12).
- **Browsers:** Chrome, Edge and Firefox (latest two versions), Safari 17+; WebGL2 required for 3D, otherwise the 2D fallback.
- **Offline-safe demo:** no runtime third-party API calls in the story path (Hydrocron and Overpass results are pre-fetched into the bundle); the PWA precaches Acts 1–3.
- **Configuration:** `.env` → `VITE_DATA_BASE_URL`, `VITE_SENTRY_DSN` (optional), `VITE_ANALYTICS` (optional). No secrets in the frontend.
- **Security headers** (Vercel `vercel.json`): CSP (self + data CDN), `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` (no camera/mic/geolocation).
- **Caching:** hashed app assets `immutable, max-age=1y`; the data bundle is versioned by path (`/data/2026-11-15/`), so it can be cached long-term too; `manifest.json` short cache.
- **Licensing:** code MIT; data credited (NASA/ISRO NISAR, ESA Copernicus, NASADEM, OSM ODbL, ESA WorldCover CC-BY 4.0); ANUGA (GPL) is used offline only and is not shipped in the web app.
- **Secrets:** pipeline tokens only in `.env` (gitignored).

## 7. Python environment

```
python 3.11/3.12
asf_search>=11  h5py  numpy  pandas  pyproj  shapely>=2  rasterio  matplotlib
pystac-client  planetary-computer  requests  scipy  pysheds (or richdem)  geopandas
earthaccess  pyyaml  pillow  plotly
anuga  (Colab: pip install anuga; Windows: conda-forge or run-anuga.exe)
```
Windows note: a PostGIS `PROJ_LIB` breaks rasterio. The guard in `mellegue_test.py` removes it; keep that guard in every script.

## 8. Testing requirements (summary; full recipes → 07)

| Test | Pass criterion |
|---|---|
| Water mask vs Sentinel-1 (same week) | Area difference ≤ 15% (different wavelengths and geometry) |
| Track consistency | Same-week NISAR tracks within ≤ 10% after offset normalization |
| Optional Sentinel-2 NDWI (clear day) | ≤ 15% |
| Anomaly detector | Fires on 19 Jun (cross-sensor) and/or 21 Jun; ≤ 1 false alarm on Jul–Oct |
| Level (SWOT) | If available: SWOT area vs NISAR area ≤ 20%; level trend sign consistent with the area trend |
| ΔV plausibility | Estimated Mellègue ΔV (17 Jun → 1–3 Jul) within a factor of 2 of the reported 21 Mm³, or explained |
| ANUGA | Mass balance < 1%; no NaNs; extent contains the HAND 21 Mm³ core; arrival times monotonic downstream |
| Web | Acceptance criteria → 02 §8; UI quality gates → 04 §14 (unit, e2e, axe, Lighthouse) |