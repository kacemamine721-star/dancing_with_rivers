# Dancing with the Rivers

NASA Space Apps Challenge 2026 · Tunis · Challenge: *Dancing with SARs*

On screen the web app is called **Dancing with the Rivers**. Its monitoring tool is **Dam Watch**.

Every number on this page comes from our pipeline's data bundle (`apps/web/public/data/2026-11-15/`) or from the press sources listed under References. `submission/numbers_check.md` gives the file behind each number.

---

## High-level summary (149 words)

On the night of 17 June 2026, a 72-year-old gate failed at the Mellègue dam in Nebeur, northwest Tunisia. The press reported about 21 million m³ of water released toward the Sidi Salem reservoir. Dancing with the Rivers replays that night, and the month after it, in 3D from real radar data. Our web app, Dancing with the Rivers, measures the lake on NASA–ISRO NISAR L-band and Sentinel-1 images and explains each radar signal in plain language. It checks the radar against SWOT lake heights: the water surface fell 3.75 m between 7 and 28 June. NISAR and Sentinel-1 together would have raised an alarm on 22 June, five days after the failure, with no ground sensor. The story then opens Dam Watch: lake area, automatic alerts, level change and labelled "what if" flood scenarios down to Sidi Salem. Tunisia's daily dam bulletins stopped in October 2025, so free, independent monitoring matters.

---

## Demo and project links

- **Demo (one link):** [30-second video with English subtitles, link to add] *(script: `submission/video_script.md`)*
- **Project (live app):** https://&lt;project&gt;.pages.dev *(Cloudflare Pages, see `docs/DEPLOY.md`; to fill after deploy)*
- **Code:** [public repository URL, to add]

---

## Project details

### What it does

Dancing with the Rivers tells the story of one real event in nine short acts, then hands the user a working tool.

1. **The dam.** The Mellègue dam, built in 1954, feeds the irrigated farms of Jendouba. Its lake is about 80% silted (press). A new dam upstream, Upper Mellègue (195 million m³), was due to replace it.
2. **The night of 17 June.** The last radar image before the failure is Sentinel-1 at 17:20 UTC (18:20 local). The gate failed at about 21:15 local, during a planned 100,000 m³ release for irrigation (press).
3. **What NISAR saw.** NISAR's first image came on 19 June. On NISAR's own track D80 the lake shrinks by about 18% from 1 to 13 July.
4. **Where the water went.** A flow path follows the terrain for 101 km: past Jendouba, into the Medjerda, past Bou Salem, to Sidi Salem. The press reported the water reaching Sidi Salem on 21 June.
5. **A month of draining.** 133 radar measurements (41 NISAR, 92 Sentinel-1) show the lake draining until the gate was repaired on 16 July, then a plateau in August and a rise with the late-September rain.
6. **Could we have known?** An automatic rule flags the lake when it falls well below its recent normal and a second pass confirms it. First alert: 22 June.
7. **What if?** A volume slider and three physics scenarios show which fields, roads and villages water could reach. Every view carries "Scenario exploration, not a forecast".
8. **Level and volume.** SWOT measured the lake surface falling 3.75 m between 7 and 28 June. From level and area we estimate a storage loss of about 12.7 million m³ over those three weeks.
9. **Dam Watch.** The same steps as a tool: area series, alerts, level and scenarios for Mellègue. Other dams are on the roadmap.

Each layer and number carries a badge: **MEASURED**, **REPORTED**, **MODELLED** or **ILLUSTRATIVE**, with its source. Uncertainty is drawn as bands and ranges.

### How it works

An offline Python pipeline turns satellite data into a small, versioned data bundle. The web app reads only that bundle: no server, no keys, no live API calls.

- **Water area (MEASURED).** NISAR GCOV backscatter (HH, L-band) and Sentinel-1 RTC (VV, C-band) are thresholded per image (Otsu inside the lake and a 300 m ring), then the area is counted inside the pre-failure lake polygon (4.69 km², from 19 pre-failure Sentinel-1 images). A fixed −18 dB threshold failed: wind roughens the lake at C-band, and wet mud looks like water at L-band.
- **Alerts (MODELLED).** Each new area is compared with the median of the previous 21 days. WARNING below −12%, ALERT below −20%, each confirmed by an independent pass within 6 days. Result: first ALERT 22 June (Sentinel-1 orbit 161, −20.5%, confirmed by orbit 88, −28.8%); no flag in the 14 evaluations before the failure; first NISAR flag 26 June (track A173, WARNING, −13%).
- **Level and volume (MEASURED / MODELLED).** SWOT LakeSP heights via Hydrocron (lake 1530007983, 19 passes kept). Level 260.54 m on 7 June, 256.79 m on 28 June: −3.75 ± 0.08 m. Storage change = area × level change between the passes: −12.7 million m³ (range 7.8 to 17.1).
- **Flow path and quick flood (MODELLED).** D8 routing on Google's GEM-15 terrain (15 m, averaged to 30 m) gives the 101 km path; 98.8% of it lies within 300 m of mapped rivers. A HAND "bathtub" lookup turns any volume into a water height and an exposed area in the browser.
- **Physics scenarios (MODELLED).** ANUGA 2D shallow-water model from the dam to the Medjerda confluence (112 km², 69,616 triangles), with a 12-hour triangular release of 21, 50 or 195 million m³. Front at the confluence after about 13 h for 21 million m³ (19 h on a coarser mesh: timing is mesh-sensitive).
- **Exposure (MODELLED).** Wet cells are crossed with ESA WorldCover (cropland, built-up), OpenStreetMap (roads, buildings, villages) and WorldPop.
- **Web.** React and TypeScript, three.js 3D scene of the real valley, a cinematic intro, story cards in two levels (Everyone and Experts). Data contracts are written once (pydantic) and checked on both sides (JSON Schema and Zod).

### Benefits

- **For people in the valley** (Nebeur, Jendouba, Bou Salem): a clear, sourced account of what happened and what larger releases could reach.
- **For water managers and civil protection:** a free, independent watch of a reservoir from space, every 2–7 days, day or night, with alerts that need no ground sensor.
- **For students and the public:** radar explained in plain language, with honest badges that show what was measured and what was modelled.
- **For Tunisia:** public daily dam bulletins stopped in October 2025, and water is scarce (under about 400 m³ per person per year). Open satellite data can fill part of that gap.

### What we hope to achieve

Run the same steps on 5 to 10 more reservoirs in northern Tunisia as an offline batch (Sidi Salem, Bou Heurtma, Beni Mtir, Kasseb and others), and measure the alert rule's detection and false-alarm rates on dams it was not tuned on. Only then build a live service.

### Tools, languages and software

- **Languages:** Python 3.11, TypeScript, GLSL.
- **Python:** asf_search, earthaccess, h5py, numpy, scipy, rasterio, pystac-client, planetary-computer, pysheds, geopandas, pydantic; ANUGA 4.2.0 (Geoscience Australia / ANU) in Docker.
- **Web:** React 18, Vite, three.js, React Three Fiber, drei, postprocessing, GSAP, Framer Motion, Tailwind CSS, Radix / shadcn, visx, Zustand, TanStack Query, Zod; Vitest, Playwright, axe.
- **Delivery:** static site on Cloudflare Pages; Docker for local serving and the flood model.
- **Hardware:** team laptops (Windows 11); the flood scenarios ran in 33 to 48 minutes each on 4 CPU threads.

---

## Use of AI (SI) — declaration

We used AI tools throughout, and we say where.

- **Anthropic Claude (Claude Code, Claude Opus models):** writing and reviewing code for the Python pipeline and the web app; drafting documentation, story copy, this page, the video script and the deck; a separate review agent that checks every number in the copy against our data files.
- **Google Antigravity (agentic IDE):** a design discussion on generalising to any dam, and repository housekeeping. *[team: confirm the tools and models to select in the form]*
- **AI-derived data:** GEM-15 terrain is a model-predicted elevation product made by Google with machine learning. We badge it MODELLED.
- **Media:** the app's imagery is real satellite data or drawn by code from data. We used no AI image or video generation. If any AI-generated image is added to the deck or video, it carries a visible "AI-generated" watermark.
- **Numbers:** every number shown comes from our pipeline outputs or a cited press source, never from an AI model. The team chose the methods and is responsible for the results.
- **No NASA branding:** nothing we generated uses NASA logos, insignia or mission identifiers as design elements. NASA data is credited in text only.

---

## NASA data

| Dataset | What we used it for | Link |
|---|---|---|
| **NISAR L2 GCOV** (L-band, HH/HV), NASA/JPL–ISRO, via ASF DAAC | Lake water area on 41 dates across tracks D80, A101, A173 and D8 (19 Jun → 29 Oct 2026); the radar images in the 3D scene | https://nisar-docs.asf.alaska.edu/ · https://search.asf.alaska.edu/ |
| **SWOT L2 HR LakeSP** (NASA/CNES), via PO.DAAC Hydrocron | Lake water-surface elevation; level drop and storage change | https://podaac.github.io/hydrocron/timeseries · https://earthdata.nasa.gov/data/catalog/pocloud-swot-l2-hr-lakesp-d-d |
| **NASADEM** (NASA JPL), via Microsoft Planetary Computer | 3D terrain and hillshade; fills gaps in GEM-15 | https://planetarycomputer.microsoft.com/dataset/nasadem |
| **LGRIP30 v001** irrigated cropland (NASA MEaSUREs / USGS, LP DAAC) | Check on our irrigated-cropland layer (90% of our summer-green cropland falls in its irrigated class) | https://doi.org/10.5067/Community/LGRIP/LGRIP30.001 |

NISAR products shown in the app (examples): `NISAR_L2_PR_GCOV_023_080_D_070_2005_DHDH_M_20260619T181219_20260619T181253_P05023_N_F_J_001` (19 Jun, D80) and `NISAR_L2_PR_GCOV_023_101_A_020_4005_DHDH_A_20260621T044115_20260621T044148_P05023_N_F_J_001` (21 Jun, A101). The full list is in the app's bundle manifest.

Credit line used in the app: "NISAR: NASA/JPL–ISRO, via ASF DAAC".

---

## Space agency partner data

| Dataset | Use | Link |
|---|---|---|
| **Copernicus Sentinel-1 RTC** (ESA), via Microsoft Planetary Computer | 92 lake-area measurements; the last image before the failure (17 Jun 17:20 UTC, orbit 88); pre-failure lake polygon | https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc |
| **Copernicus Sentinel-2 L2A** (ESA), via Microsoft Planetary Computer | Optical basemap; summer-green (irrigated) cropland, Jul–Aug 2026 | https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a |
| **ESA WorldCover 10 m 2021 v200** | Cropland and built-up exposure; friction (Manning n) in the flood model | https://esa-worldcover.org/ |

"Contains modified Copernicus Sentinel data 2026." WorldCover: "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium."

## Other data

| Dataset | Use | Link / credit |
|---|---|---|
| **GEM-15** 15 m terrain (Google Research, experimental, CC BY 4.0) | Bed for flow routing, HAND and ANUGA | https://developers.google.com/earth-engine/datasets/catalog/projects_climate-and-sustainability_assets_gem-15_v1 · "This dataset is produced by Google" · Batchu et al. 2026, doi:10.31223/X55N75 |
| **HydroRIVERS v1.0 / HydroBASINS v1c** (HydroSHEDS, Lehner & Grill 2013) | River network; catchment (10,315 km² for the Mellègue dam) | https://www.hydrosheds.org/products/hydrorivers · https://www.hydrosheds.org/products/hydrobasins |
| **JRC Global Surface Water v1.3** (EC JRC / Google, Pekel et al. 2016) | Water-mask sanity checks | https://global-surface-water.appspot.com/ · "Source: EC JRC/Google" |
| **OpenStreetMap** (ODbL) | Villages, roads, buildings, rivers, dams | https://www.openstreetmap.org/copyright · "© OpenStreetMap contributors" |
| **WorldPop 2020** constrained, Tunisia 100 m (CC BY 4.0) | Exposed population (a model) | https://hub.worldpop.org/geodata/summary?id=49920 |
| **geoBoundaries gbOpen** (Runfola et al. 2020) | Administrative boundaries (indicative) | https://www.geoboundaries.org/ |
| **ANUGA** hydrodynamic model (GPL) | 2D flood scenarios | https://github.com/GeoscienceAustralia/anuga_core |
| Dam crest line | Digitised by the team on satellite imagery | — |

---

## Honest limits

We say these in the app, on the Methods page and in the pitch.

- **NISAR did not see the gate fail.** Its first image is 19 June. The "before" is Sentinel-1 on 17 June at 17:20 UTC.
- **The 22 June alert comes from two Sentinel-1 passes.** NISAR's first flag is 26 June. NISAR adds revisit; it is not the only sensor.
- **The alert rule was tuned on this event** (in-sample). It still needs testing on other reservoirs. From August to mid-November it raised 3 ALERT and 12 WARNING flags during real lake declines; we report them as "needs operator check", not as successes or false alarms.
- **Area is uncertain.** Moving the radar threshold by ±2 dB changes the area by a median ±23%; the chart shows this band. NISAR reads high in the first weeks after the failure because wet mud looks like water at L-band.
- **SWOT gives net storage change, not the release.** −12.7 million m³ (7 → 28 June) is net of river inflow and covers only three weeks of a release that lasted until the 16 July repair. It is not a measurement of the 21 million m³.
- **Flood results are screening level.** 30 m terrain with no river-channel depths; the release shape and duration are assumptions; no gauge or flood marks to calibrate against. Arrival at the Medjerda confluence for 21 million m³ is about 13 to 19 hours depending on the mesh. HAND and ANUGA footprints overlap only partly (IoU 0.40 to 0.66).
- **195 million m³ is hypothetical.** It is the size of the new Upper Mellègue reservoir, released here at the old dam site. It is not a forecast.
- **Exposure is not damage.** OSM buildings and roads are incomplete in rural Tunisia (counts are lower bounds); WorldPop is a model.
- **Released volume is reported, not measured:** about 21 million m³ (La Presse); one outlet reports 29 million m³.

---

## References

**Event and context (press)**
- Gate failure details, 100,000 m³ planned release (Business News, 18 Jun 2026): https://businessnews.com.tn/2026/06/18/la-fuite-spectaculaire-du-barrage-de-mellegue-na-cause-aucun-degat/1406440/
- 21 Mm³ released in a few hours (La Presse, 19 Jun 2026): https://www.lapresse.tn/2026/06/19/panne-au-barrage-de-mellegue-21-millions-de-m%C2%B3-deau-relaches-en-quelques-heures/
- Farmland damaged (La Presse, 18 Jun 2026): https://www.lapresse.tn/2026/06/18/tunisie-des-terres-agricoles-endommagees-apres-la-montee-des-eaux-a-mellegue/
- Arrival at Sidi Salem, 80% silted (AllAfrica): https://fr.allafrica.com/stories/202606240126.html
- What we know, 29 Mm³ (Tunisie Numérique): https://www.tunisienumerique.com/incident-du-barrage-de-mellegue-ce-que-lon-sait-apres-lecoulement-de-29-millions-de-m%C2%B3/
- Gate back in service, 16 Jul 2026 (Managers): https://managers.tn/2026/07/16/barrage-de-mellegue-la-vanne-est-de-nouveau-operationnelle-un-mois-apres-lincident-qui-a-libere-21-millions-de-m%C2%B3-deau/
- Divers inspect leaks (Webdo, Sep 2026): https://www.webdo.tn/fr/actualite/regions/barrage-de-mellegue-des-plongeurs-mobilises-pour-inspecter-les-infiltrations/404376/
- Upper Mellègue dam, 195 Mm³ (Webdo): https://www.webdo.tn/fr/?p=396788
- Dam reserves 46% on 23 Oct 2026 (La Presse): https://www.lapresse.tn/2026/10/24/barrages-tunisiens-les-reserves-atteignent-1075-milliard-de-m³/
- ONAGRI stopped daily bulletins (Business News): https://businessnews.com.tn/2026/06/23/barrages-le-taux-de-remplissage-atteint-60-selon-le-ministere-de-lagriculture/1407255/
- Water stress below 400 m³ per person (Webdo): https://webdo.tn/en/?p=396510

**NISAR and methods**
- NISAR Data User Guide (ASF DAAC): https://nisar-docs.asf.alaska.edu/
- NISAR in Worldview / GIBS: https://nisar-docs.asf.alaska.edu/worldview/
- NISAR polarimetry (NASA): https://science.nasa.gov/mission/nisar/polarimetry/
- SWOT Hydrocron API (PO.DAAC): https://podaac.github.io/hydrocron/timeseries
- Microsoft Planetary Computer: https://planetarycomputer.microsoft.com/
- ANUGA: https://github.com/GeoscienceAustralia/anuga_core · https://anuga.readthedocs.io
- L-band vs C-band for irrigation and soil moisture: https://doi.org/10.3390/rs14102312
- Space Apps judging and awards: https://www.spaceappschallenge.org/resources/judging-awards-guide

**Data papers**
- Lehner, B., Grill, G. (2013) Hydrological Processes 27(15), doi:10.1002/hyp.9740 (HydroSHEDS)
- Pekel, J.-F. et al. (2016) Nature 540, 418–422, doi:10.1038/nature20584 (JRC GSW)
- Zanaga, D. et al. (2022) ESA WorldCover 10 m 2021 v200, doi:10.5281/zenodo.7254221
- Bondarenko, M. et al. (2020) WorldPop constrained estimates, doi:10.5258/SOTON/WP00684
- Runfola, D. et al. (2020) PLoS ONE 15(4) e0231866 (geoBoundaries)
- Batchu et al. (2026) GEM-15, doi:10.31223/X55N75

**Open-source code we build on:** React, three.js, React Three Fiber, GSAP, Tailwind CSS, Radix UI / shadcn, visx, Zustand, TanStack Query, Zod, Vite (MIT or similar licences); ANUGA (GPL); pysheds, rasterio, geopandas, asf_search, earthaccess (open licences). The cinematic intro is our own prototype, ported to the app.
