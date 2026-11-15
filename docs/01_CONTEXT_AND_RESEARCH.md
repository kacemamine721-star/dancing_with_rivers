# 01 · Challenge Context & Research Synthesis

Everything we learned during the hackathon, in one place. Facts carry a source link (§10). Items marked **[TBD]** are filled in when `mellegue_reservoir.py` finishes.

---

## 1. The challenge

**Statement (summary).** Earth's surface is in constant motion: wetlands expand and retract, forests burn, farmland changes, soils swell and shrink, glaciers move, land subsides. Build an **interactive application that uses NISAR radar data to track and visualize one or more types of surface change** at locations around the world.

**What the challenge explicitly encourages**
- Intuitive tools and innovative visualizations: change-detection maps, time-series animations, dashboards.
- An **open-source, user-friendly** solution that turns complex radar observations into **actionable insights** for scientists, resource managers, educators, decision-makers and the public.
- Pick a study area (your hometown is fine), use free NISAR data plus supplemental data (optical, GIS), and **hypothesize the physical drivers** behind what the radar shows.
- Optional: compare polarizations and frequencies, use time series, add context datasets, **show how human drivers affect natural resources**, tell a compelling story, make it interactive (sliders, web maps).

**Resources provided:** Earthdata Search, ASF Vertex, the NISAR Data User Guide, ARSET trainings, NISAR StoryMaps, NISAR Applications White Papers, UAVSAR postcards. Partner data: CSA RADARSAT/RCM, CONAE SAOCOM.

## 2. Rules, judging and deadlines (Tunis local event)

| Item | Detail |
|---|---|
| Judging criteria (1–5 each) | **Impact**, **Creativity**, **Validity** (scientifically sound, feasible, easy to use), **Relevance** (NASA data essential, not decorative), **Presentation** |
| Demo | ONE public link: **video ≤ 30 s** (English or English subtitles) **or deck ≤ 7 slides** (the title slide counts). No password. No minors' names, voices or likenesses |
| Project page | High-level summary (50–200 words), demo link, final project link, details (what/how/benefits/tools), **use of SI (AI) declared**, NASA data with links, partner data, all references |
| AI | Allowed; must be declared; AI images/videos watermarked; never use NASA logos or branding |
| Prior work | Not allowed: everything is built during the hackathon |
| Local timeline | Submission **Sun 15 Nov 16:30** → **local pitch 17:00 (7 min + 3 min Q&A)** → final click **23:59** |
| Local prizes | 1st 1000 DT · 2nd 750 DT · 3rd 500 DT. **The top 3 become Tunis's Global Nominees** |
| Global | Nominees sent 22 Nov → announced 3 Dec → Finalists 17 Dec → **10 Global Winners 27 Jan 2027** |
| On site | At least 3 team members present at all times; check the "Doors 20:00" rule with the organizers |

**The 10 Global Awards:** Best Use of Science · Best Use of Data · Best Use of Technology · Galactic Impact · Best Mission Concept · Most Inspirational · Best Storytelling · Global Connection · Art & Technology · **Local Impact**.

**Award strategy.**
- **Primary target: Local Impact** (a Tunisian dam failure, Tunisian farmers and villages).
- **Secondary: Best Use of Data** (real NISAR + multi-sensor + validation) and **Best Storytelling** (cinematic narrative).

**Lessons from past winners.**
- 2024: an interactive 3D AI-guided climate museum won Art & Technology; a Cairo team won Best Storytelling with climate stories plus an eco-choice game; Brazil's Team I.O. won Local Impact by making GIS data usable by non-experts.
- 2025: a satellite-image farming game won Art & Technology; Best Storytelling went to a science story for children.
- Water/drought decision tools won Best Use of Data and Galactic Impact in 2024.
- **The gap:** no educational winner we found was built on SAR, let alone NISAR. NISAR's calibrated data only went public in July 2026.

## 3. NISAR essentials

| Property | Value |
|---|---|
| Partners / launch | NASA (JPL) + ISRO · launched **30 July 2025**, GSLV-F16, Sriharikota |
| Orbit | 747 km, sun-synchronous, **12-day exact repeat**; about 6 days on average combining ascending and descending passes |
| Antenna | 12 m deployable reflector on a 9 m boom; **SweepSAR**, swath about 240 km |
| L-band (NASA) | **24 cm**, about 1.257 GHz; global land coverage; dual-pol **HH/HV** over Tunisia (20+5 or 40+5 MHz; 5 MHz single-pol over the Sahara) |
| S-band (ISRO) | **9.3–10 cm**, about 3.2 GHz; mostly India plus selected global sites; distributed by **Bhoonidhi** |
| Products used | **GCOV** (geocoded, terrain-corrected backscatter γ⁰ per polarization), **GUNW** (interferograms), **GSLC**, **SME2** (L3 soil moisture, 200 m) |
| Data release | Beta (Jan–Feb 2026) → **Provisional (calibrated) from 20 July 2026** for acquisitions after 17 June 2026 → **Validated from 22 Oct 2026**. The pre-June 2026 backlog will be reprocessed by the end of 2026 |

**Radar physics used in the story.**
- **Calm water** reflects the pulse away like a mirror (specular) → **very dark**.
- **Rough or built-up surfaces** → bright; **double bounce** from walls and from flooded vegetation → very bright in HH.
- **HV (cross-pol)** responds to vegetation volume.
- **Dielectric constant:** wet soil is brighter than dry soil, so radar is sensitive to moisture.
- **Roughness is relative to wavelength:** a field can look rough at C-band (5.6 cm) and smooth at L-band (24 cm).
- **L-band** penetrates thicker vegetation and keeps interferometric coherence over vegetation; **C-band** is roughened by small wind ripples on water.

**Honest positioning.** For open-water mapping of a reservoir, C-band Sentinel-1 also works. NISAR's value here is:
1. **Free, calibrated, systematic L-band** over every Tunisian dam every 12 days per track; before NISAR, L-band data was commercial or patchy.
2. **Soil moisture and dual-pol** to separate water, wet soil and vegetation.
3. **Revisit:** combined with Sentinel-1, a look every 2–3 days, which is fast enough to catch a failure.
4. **Future:** L-band interferometry for slopes and the new dam.

**Do not claim** "only NISAR can see this reservoir" or "water under vegetation" for Mellègue: our test showed the changed pixels are 92% cropland.

## 4. Data inventory (verified by our scripts, 14 Nov 2026)

| Platform | Result over Tunisia |
|---|---|
| **ASF DAAC** | **1,755 L-band products**, 17 Jun → 31 Oct 2026: GCOV 390 · GSLC 393 · RSLC 396 · GUNW 217 · SME2 359. **No BETA (pre-June) files over Tunisia** |
| **NASA CMR** | 10 of 44 NISAR collections hold Tunisian data; raw L0B data up to 12 Nov; Provisional ends 19 Oct, Validated from 22 Oct; Urgent Response = 0 |
| Harmony (GeoTIFF extraction) | Available for GCOV, GUNW, SME2 |
| **Worldview / GIBS** | Layer `NISAR_L2_Geocoded_Polarimetric_Covariance` (false colour, 15.6 m). **Over Mellègue: no imagery before 19 June** (May 1 → June 18 all empty), then 19, 21, 26 Jun, 1, 3, 8, 13, 15, 20, 25, 27 Jul… |
| **ISRO Bhoonidhi** (S-band) | **137 S-band products**, 13 Jul → 10 Nov 2026 (GCOV 37, GSLC 38, RSLC 37, GUNW 25), dual-pol, joint L+S mode, tracks D80 (F70–71) and A173 (F19–20). **Covers central Tunisia only (≈34.5–36.5°N)**: Kairouan, Siliana, Sousse; **not** the northern dams. API login works; search accepted only as GET with no date filter |
| Planetary Computer / Earth Engine | No NISAR collection. Planetary Computer **does** serve Sentinel-1 RTC, Copernicus DEM, ESA WorldCover |

**NISAR stacks over Mellègue (GCOV):**

| Track | Dates | Notes |
|---|---|---|
| D80/F70 (desc) | 19 Jun, 1 Jul, 13 Jul, 25 Jul … 29 Oct | 20+5 MHz, ~20 m pixels; **first image after the failure** |
| A101/F20 (asc) | 21 Jun, 3 Jul, 15 Jul … | 40+5 MHz, ~10 m pixels |
| A173/F20, D8/F70 | 26 Jun, 8 Jul … | Add cadence |
| **All tracks combined** | **31 dates**, 19 Jun → 29 Oct | Revisit about 2–7 days |
| Gap | **25 Jul → 13 Aug** | No acquisitions (mission-wide) |

**Sentinel-1 RTC (Planetary Computer) around the event:** 11 images before and 12 after the failure.

| Orbit | Image (UTC) | Relation to the failure | Covers the reservoir? |
|---|---|---|---|
| 88 | **17 Jun 17:20** | **~3 h before** (18:20 local vs ~21:15 failure) | ✅ (the "before") |
| 88 | 22 Jun 17:20 | After | ✅ |
| 95 | 18 Jun 05:21 | ~8 h after | ❌ east edge only |

## 5. Tunisia water context (human × environment)

- Tunisia has under **400–420 m³ of fresh water per person per year**, far below the FAO water-stress threshold of 1,700 m³.
- **Dam reserves:** about 29% (Sep 2025) → about **60–67% (spring–June 2026)** after the heaviest rain in decades (January 2026 floods, 5 dead) → **46% on 23 Oct 2026** (1.075 billion m³) → **45% early Nov 2026**. Summer evaporation exceeds 1 million m³ per day.
- **ONAGRI (the national agriculture observatory) stopped publishing its daily dam bulletins in October 2025**, so there is no public, independent dam monitoring. This is the gap Dancing with the Rivers fills.
- **Groundwater pressure:** 21,000 to 30,000+ illegal wells; about 827 million m³ pumped illegally in 2024; the Kairouan aquifer is exploited at about 230%.
- **Ageing infrastructure:** Mellègue (1954) is about 80% silted; it is being replaced by the **Upper Mellègue dam** (195–200 million m³ capacity, 276 MDT cost, 12,000–13,000 ha irrigated, over 98% complete in June 2026, operation scheduled for 15 Sept 2026).

## 6. The Mellègue event: verified timeline

| When (2026, local) | What | Source type |
|---|---|---|
| 17 Jun · 18:20 (17:20 UTC) | **Sentinel-1 image of the full reservoir** (last image before the failure) | MEASURED |
| 17 Jun · ~21:15 | **Upper sector gate fails** during a planned **100,000 m³** release for the Jendouba irrigated perimeter; water flows uncontrolled | REPORTED |
| 17 Jun · evening | Ministry warns residents along the Mellègue and downstream to be vigilant | REPORTED |
| 18 Jun | Farmland damaged downstream; Ministry says no danger to residents; Medjerda bed "can absorb" the volume | REPORTED |
| 17–19 Jun | About **21 million m³** released "in a few hours" (some outlets report 29 million m³); flows continue for several days in the Mellègue and Medjerda | REPORTED |
| **19 Jun** | **NISAR first look** (D80, about 46 h after): lake brighter than before (water giving way to wet sediment); area not yet clearly lower | MEASURED |
| **21 Jun** | **NISAR** (A101); **first water arrives at Sidi Salem**, which absorbs it | MEASURED + REPORTED |
| 1–3 Jul | **NISAR:** western arm drying; area still close to 19–21 Jun values (wet mud) | MEASURED |
| 13–15 Jul | **NISAR:** clear shrinkage on all tracks (about −17 to −19% in 12 days) | MEASURED |
| **16 Jul** | **Gate repaired and back in service** (about a month after) | REPORTED |
| Jul–Oct | **NISAR** every few days (gap 25 Jul–13 Aug): plateau near 1.7 km² in August, rise in late September (autumn rain), decline again in October | MEASURED |
| 15 Sep | Upper Mellègue: planned start of operation | REPORTED (plan) |
| 22 Sep | Divers inspect leaks at the old dam before the rainy season | REPORTED |
| Sep–Dec | Old dam to be decommissioned | REPORTED (plan) |

**Approximate reservoir location (from NISAR):** about **8.68–8.72°E, 36.30–36.32°N**, an elongated lake about 2.5 km long. The dam is at the downstream end, in Nebeur delegation, Kef. *Verify on a basemap.*

## 7. What our tests showed (real NISAR, `mellegue_test.py`)

| Finding | Evidence | Use it? |
|---|---|---|
| Data quality is high | Change-map noise **0.6–0.9 dB** after speckle filtering | ✅ |
| **Reservoir shrinks after the failure** | Dark lake on 19/21 Jun → **fragmented by 1/3 Jul** → partial on 13/15 Jul, seen by both tracks | ✅ **Core result** |
| Exposed wet sediment that later dries | Red (brighter → darker) patches at the reservoir tail | ✅ (supporting) |
| River channel wetter after the release | A faint brighter line along the Mellègue, NE toward Jendouba | ⚠️ weak, show as a hint |
| Water under vegetation | Changed pixels: **92% cropland, 1% trees** | ❌ drop |
| Valley flood footprint in soil moisture | SME2 mean 0.19 → 0.13 m³/m³ is a regional heatwave signal | ❌ not specific |
| Whole-box water area | Contaminated by dry harvested fields (also below −18 dB) | ❌ use a **tight lake box** |
| Sentinel-1 confirms the drawdown | Orbit 88 change (17 → 22 Jun): the only coherent feature is at the reservoir | ✅ |
| Farm fields (irrigated perimeter) | Rectangular change patches near Jendouba | Context only |

**Main chart (done 14 Nov, `pipeline/02_reservoir.py`):** 41 NISAR + 92 Sentinel-1 measurements inside the pre-failure lake polygon, with a per-image threshold (the fixed −18 dB failed: wind at C-band, wet mud at L-band).

| Period | Open-water area | Note |
|---|---|---|
| Before the failure (16 May → 17 Jun) | about **2.6–3.2 km²** | Sentinel-1, three orbits |
| 17 Jun → about 20 Jul | **steady decline to about 1.7 km²** | the gate stayed open until repaired on 16 Jul |
| August → mid-September | plateau, about 1.5–1.8 km² | |
| Late September | rise to about 2.3–2.6 km² | autumn rain |
| October → mid-November | decline to about 1.5–1.8 km² | cause unknown: needs operator data |

Same-orbit Sentinel-1 (o168): 2.88 km² (16 Jun) → 2.21 (23 Jun) → 1.51 (11 Jul), about −48% in a month. Threshold ±2 dB moves the area by about ±20% (shown as a band). **NISAR's area lags** in the first weeks (D80: 2.49 km² on 19 Jun, 2.50 on 1 Jul) because exposed wet sediment is as dark as water at L-band; same-orbit Sentinel-1 shows the median backscatter inside the lake rising at once (orbit 88: −14.9 → −12.5 dB, 17 → 22 Jun; orbit 168: −15.1 → −13.3 dB). (Comparing Sentinel-1 before with NISAR after mixes C- and L-band and is not used as evidence.)

**Anomaly detector (`pipeline/03_anomaly.py`):** area more than 20% below the 21-day multi-sensor baseline, confirmed by an independent pass within 6 days → **first ALERT 22 Jun 2026**, 5 days after the failure; no flag before it; first NISAR flag 26 Jun. The story therefore says: *the lake drained for a month; NISAR and Sentinel-1 together would have raised an alarm on 22 June.* It does **not** say "the lake vanished", "alarm on 19 June" or "NISAR alone".

## 8. Decisions log (and why)

| Decision | Rationale |
|---|---|
| Tunisia, not an international site | 1,755 verified L-band products, a local story, Local Impact award, "working everywhere is working nowhere" |
| **One event (Mellègue)** instead of three themes | The team's rule: one subject polished beats three half-done; the event has both a past (failure) and a future (the new 195 million m³ dam) |
| Narrative before dashboard | Education, Storytelling and Impact all rewarded; the challenge asks for accessibility for the public and educators |
| Drop landslides / InSAR subsidence as deliverables | Only 4 months of 12-day interferograms; Tunis subsidence is ≤ 19 mm/yr (≈ 6 mm in 4 months), close to atmospheric noise → roadmap |
| Drop "water under vegetation" claim | Land-cover test: cropland, not forest |
| Flood: **HAND quick estimate + ANUGA physics** | HAND gives a continuous slider in the browser; ANUGA (open source, dam-break capable) gives physics checkpoints |
| ANUGA over LISFLOOD-FP / HEC-RAS | ANUGA: GPLv2+, Python, dam breaks, pip/conda, Colab-friendly, Windows exe. LISFLOOD-FP needs compiling and its full solvers for dam breaks; HEC-RAS is not open source (roadmap mention) |
| Level & volume via **SWOT + DEM**, labelled as estimates | NISAR measures area, not level; SWOT measures lake water-surface elevation (21-day repeat, lakes ≥ 0.06 km²) |
| Wildfire, Kairouan irrigation, S-band | Roadmap slide (proves extensibility; S-band does not cover Mellègue) |

## 9. Risks & honest limits (say them in the pitch)

- **No NISAR image before the failure** (first: 19 Jun). The "before" comes from Sentinel-1 (17 Jun 17:20 UTC).
- **Released volume and duration** come from press reports (21 Mm³, "a few hours"; one outlet says 29). The flood model runs **scenarios**.
- **30 m DEMs** smooth river channels, so flood depths are indicative: "first-order exposure screening, not a certified flood map".
- **Area ≠ level:** level and volume are estimated (SWOT, DEM) with stated uncertainty.
- **Dry bare fields** look like water at L-band, so masks are restricted to the lake polygon.

## 10. Sources (cite in the app and on the project page)

**Challenge & NISAR**
- NASA Space Apps Judging & Awards: https://www.spaceappschallenge.org/resources/judging-awards-guide
- 2024 winners: https://www.nasa.gov/learning-resources/stem-engagement-at-nasa/nasa-international-space-apps-challenge-announces-2024-global-winners/
- 2025 winners: https://www.nasa.gov/?p=939125
- NISAR Data User Guide (ASF): https://nisar-docs.asf.alaska.edu/ · availability: https://nisar-docs.asf.alaska.edu/availability-overview/
- NISAR intro / frequencies: https://nisar-docs.asf.alaska.edu/nisar-intro
- NISAR in Worldview: https://nisar-docs.asf.alaska.edu/worldview/ · Harmony: https://nisar-docs.asf.alaska.edu/harmony/
- NISAR polarimetry (NASA): https://science.nasa.gov/mission/nisar/polarimetry/
- eoPortal NISAR: https://www.eoportal.org/satellite-missions/nisar
- ISRO S-band release: https://www.isro.gov.in/ISRO_EN/NISARS_Band_SAR_Data_Products_Release.html · Bhoonidhi API: https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/
- openSEPPO tools: https://openseppo.readthedocs.io/en/latest/

**Mellègue event & water context**
- Gate failure details (time, 100,000 m³ planned release): https://businessnews.com.tn/2026/06/18/la-fuite-spectaculaire-du-barrage-de-mellegue-na-cause-aucun-degat/1406440/
- 21 Mm³ in a few hours: https://www.lapresse.tn/2026/06/19/panne-au-barrage-de-mellegue-21-millions-de-m%C2%B3-deau-relaches-en-quelques-heures/
- Arrival at Sidi Salem 21 June, 80% silted: https://fr.allafrica.com/stories/202606240126.html · https://www.tunisienumerique.com/incident-du-barrage-de-mellegue-ce-que-lon-sait-apres-lecoulement-de-29-millions-de-m%C2%B3/
- Farmland damaged: https://www.lapresse.tn/2026/06/18/tunisie-des-terres-agricoles-endommagees-apres-la-montee-des-eaux-a-mellegue/
- Gate repaired 16 July: https://fr.allafrica.com/stories/202607160380.html · https://managers.tn/2026/07/16/barrage-de-mellegue-la-vanne-est-de-nouveau-operationnelle-un-mois-apres-lincident-qui-a-libere-21-millions-de-m%C2%B3-deau/
- Divers inspecting leaks (Sept): https://www.webdo.tn/fr/actualite/regions/barrage-de-mellegue-des-plongeurs-mobilises-pour-inspecter-les-infiltrations/404376/
- Upper Mellègue (195 Mm³, 15 Sept): https://www.webdo.tn/fr/?p=396788
- National fill 60% (June): https://fr.allafrica.com/stories/202606230669.html · 46% (23 Oct): https://www.lapresse.tn/2026/10/24/barrages-tunisiens-les-reserves-atteignent-1075-milliard-de-m³/ · 45% (Nov): https://www.lapresse.tn/2026/11/11/etabli-a-47-a-la-fin-du-mis-dernier-le-taux-de-remplissage-des-barrages-recule-a-45/
- ONAGRI stopped daily reports: https://businessnews.com.tn/2026/06/23/barrages-le-taux-de-remplissage-atteint-60-selon-le-ministere-de-lagriculture/1407255/
- Water stress (<400 m³/person): https://webdo.tn/en/?p=396510
- Illegal wells: https://www.webdo.tn/fr/actualite/national/forages-illegaux-en-tunisie-827-millions-de-metres-cubes-preleves-en-2024/405551/ · https://www.webmanagercenter.com/2026/09/02/571934/dossier-stress-hydrique-en-tunisie-les-nappes-souterraines-dernier-recours-agricole-devenu-zone-de-danger/

**Terrain (added 14 Nov)**
- GEM-15, Google Research (experimental, CC-BY 4.0): https://developers.google.com/earth-engine/datasets/catalog/projects_climate-and-sustainability_assets_gem-15_v1 · Batchu et al. 2026, doi:10.31223/X55N75 · use and test → 09 §3.6

**Methods**
- ANUGA: https://github.com/GeoscienceAustralia/anuga_core · docs https://anuga.readthedocs.io · Windows exe https://github.com/Hydrata/run_anuga
- LISFLOOD-FP 8 (alternative): https://www.seamlesswave.com/LISFLOOD8.0
- SWOT Hydrocron API: https://podaac.github.io/hydrocron/timeseries · LakeSP: https://earthdata.nasa.gov/data/catalog/pocloud-swot-l2-hr-lakesp-d-d
- L-band vs C-band for irrigation/soil moisture: https://doi.org/10.3390/rs14102312
