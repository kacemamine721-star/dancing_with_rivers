# 02 · Product Requirements Document (PRD)

**Product:** Dancing with the Rivers
**Version:** Hackathon v1.0 (submission Sun 15 Nov 2026 16:30)
**Owner:** Team Starlight Tunisia, NASA Space Apps Tunis 2026

---

## 1. Vision

> **See it. Detect it. Anticipate it.**
> Dancing with the Rivers makes NASA–ISRO NISAR radar understandable and useful for the people who live below Tunisia's dams. It replays a real dam failure from space, explains every pixel in plain language, and turns the method into an open tool that watches any reservoir every 6–12 days, through clouds, day and night.

## 2. Problem

| Problem | Evidence (→ 01) |
|---|---|
| Tunisia is in structural water stress, and dams are its main buffer | <400–420 m³/person/yr; dams 60% (June) → 45% (Nov 2026) |
| **No public, independent dam monitoring** | ONAGRI stopped daily dam bulletins in Oct 2025 |
| **Infrastructure is ageing** and failures happen at night with little warning | Mellègue (1954, ~80% silted) gate failed ~21:15 on 17 Jun 2026; ~21 Mm³ released in hours; farmland damaged |
| Bigger stakes are coming | Upper Mellègue holds ~195 Mm³, about 9× the June release, on the same flood path |
| Satellite radar is powerful but **unreadable for non-experts** | SAR images are grey speckle without explanation |

## 3. Target users & personas

| Persona | Need | What Dancing with the Rivers gives them |
|---|---|---|
| **Citizen / farmer downstream** (Jendouba, Bou Salem) — *primary for the story* | "Was my land at risk? Would I be warned?" | The 3D replay, the flood-exposure map, plain-language explanations |
| **Educator / student** | "How does radar see water?" | Narrative, Radar Lab, Everyone/Experts switch, glossary |
| **Dam & water manager** (DGBGTH, CRDA) — *primary for the tool* | Independent reservoir monitoring, early anomaly detection | Dam Watch: area time series, anomaly alerts, level/volume estimates, export |
| **Civil Protection / decision-maker** | "Who is exposed if a dam releases X m³?" | Volume slider → flood extent, arrival time, cropland ha, built-up ha, villages |
| **Scientist / judge** | "Is it real and sound?" | Every number traceable; MEASURED/MODELLED badges; methods & validation pages; open code |

## 4. Goals & success metrics

| Goal | Metric (hackathon) |
|---|---|
| Tell the Mellègue story with real data | ≥ 6 real NISAR dates + 1 Sentinel-1 "before" shown in 3D; every number sourced |
| Show measurable change | Reservoir-area chart over ≥ 20 dates with events marked |
| Prove detection | Anomaly rule fires on the post-failure drop and **does not fire** on normal summer dates (→ 07 §4) |
| Show forward impact | Volume slider covering 5–200 Mm³; impact counters (cropland ha, built-up ha, villages, roads); ≥ 3 ANUGA scenarios |
| Be understandable | A non-expert can explain "why the lake is black" after Act 3 (test with 2 people) |
| Be credible | Validation page: NISAR vs Sentinel-1 area, SWOT level check (if available), model limits stated |
| Ship | Public link working in a private window; 30 s video or ≤ 7-slide deck; project page complete by 16:30 |

## 5. Scope

**In scope (v1):** Mellègue reservoir → Mellègue valley → Medjerda → Sidi Salem; June–November 2026; a narrative web app plus Dam Watch for the same AOI; 2–4 other northern reservoirs as "it generalizes" proof (P2).

**Out of scope (roadmap):** real-time operational alerts, a certified hydraulic study, dam-body deformation (InSAR), national coverage, mobile app, Arabic/French UI (P2 if time allows).

## 6. Feature list

Priorities: **P0** must ship for the pitch · **P1** strongly wanted · **P2** if time allows.

### F0 · Cinematic intro (prototype → production port) — P0
- Rebuilt in React Three Fiber + GSAP from the prototype HTML (→ 04 §6.1). Keep: loader, NISAR deployment cinematic, chapters, captions, HUD, 3D satellite explore with hotspots, **Start the mission →**.
- Change: HUD target → **Mellègue 36.31°N 8.70°E**; dive caption → "Riding the pulse down to the Mellègue dam, Kef"; hero subtitle → the dam story (→ 05 §1).
- **Start the mission → dive → lands directly in the 3D Mellègue scene** (→ 05 §2).

### F1 · 3D Mellègue scene — P0
- Real terrain (NASADEM / Copernicus 30 m) of dam, reservoir, Mellègue valley, Jendouba, Medjerda, Sidi Salem.
- Draped layers: basemap (optical), NISAR HH per date, water masks, Sentinel-1 before, flood-depth overlays, flow path, villages and roads.
- Camera "shots" driven by the narrative (fly-to, orbit, follow the river).
- Time scrubber across the event (17 Jun → 29 Oct) with event markers.
- Before/after **swipe on the 3D surface**.

### F2 · Narrative journey (9 acts) — P0
Scroll-driven cards beside the sticky 3D scene (the existing `.jgrid` pattern). Acts 1–6 are P0, 7–9 P1 (→ 05 §3).
Each card has a kick line, title, body (Everyone/Experts), **Radar lens** box, "Try it" buttons, sources, a **badge** and Read aloud.

### F3 · Reservoir monitor (area time series) — P0
- Water area per date from NISAR (all tracks) and Sentinel-1, inside the lake polygon.
- Chart with events: failure (17 Jun), Sidi Salem arrival (21 Jun), gate repaired (16 Jul), Upper Mellègue planned (15 Sep).
- Click a point → the 3D scene jumps to that date's image.

### F4 · Anomaly detection — P0
- Rule-based detector on the area series (→ 03 §5.3): flags drops larger than the expected seasonal change between two passes.
- Shows an **alert card** ("19 Jun: lake area −X% in N days; seasonal expectation −Y%; ALERT").
- "Could we have known?" replay: what the alert would have looked like on 19 Jun.

### F5 · Water level & volume (estimates) — P1
- Level from **SWOT LakeSP** (Hydrocron) if Mellègue or Sidi Salem is in the Prior Lake Database.
- Level from the **NISAR shoreline × DEM** where the DEM covers the exposed bank.
- **ΔVolume ≈ mean area × Δlevel**; compared with reported volumes (21 Mm³ released; Sidi Salem fill rates).
- Uncertainty shown as a band; badge MODELLED/ESTIMATED.

### F6 · Flood path & exposure — P0 (path) / P1 (HAND slider)
- **Flow path** (D8 routing on the DEM) from the dam to the Medjerda and Sidi Salem, with distances.
- **HAND** (Height Above Nearest Drainage) raster.
- **Continuous volume slider (0–200 Mm³)** → HAND threshold via a precomputed volume→height lookup → instant flooded area in the browser.
- Impact counters update live: cropland ha, built-up ha, villages and roads reached.

### F7 · ANUGA physics scenarios — P1
- Precomputed 2D shallow-water simulations with **ANUGA** for release volumes **{10, 21, 50, 100, 195} Mm³** (P1 minimum: 21, 50, 195) and durations {6, 12, 24 h} (P2).
- Outputs: max depth, max velocity, arrival time, animation frames.
- The slider snaps to ANUGA checkpoints in "Physics" mode and is continuous in "Quick estimate" (HAND) mode; the difference is explained.
- Scenario **"June 2026 reconstruction"** (21 Mm³, ~12 h) vs **"Upper Mellègue worst case"** (195 Mm³), labelled hypothetical.

### F8 · Impact on communities & farmland — P1
- Overlay ESA WorldCover (cropland, built-up), settlements (OSM places/buildings) and roads (OSM).
- Per scenario: cropland ha, built-up ha, villages count, road km, earliest arrival time per village.
- "Who would be warned first?" list sorted by arrival time.

### F9 · Radar School (education layer) — P0 (reuse)
- Reuse the existing **Radar Lab** (surfaces, band C/L, roughness, moisture), **theme views** (Water/Land/City), **glossary terms**, **Everyone/Experts**, **guided tour**, **Read aloud**.
- Invoked contextually from the narrative ("🧪 Why is the lake black?").
- The stylized Greater-Tunis map moves out of the main path (optional "Radar School" appendix), because it is simulated data.

### F10 · Dam Watch (the tool, unlocked at the end) — P1
- Panel/dashboard for the AOI: reservoir list (Mellègue + 2–4 others, P2), current area, trend, alerts, level/volume, flood scenario explorer, downloads (CSV/GeoJSON/PNG).
- "How to add a new dam" (polygon + script) → shows that it generalizes.

### F11 · Validation & methods page — P1
- NISAR vs Sentinel-1 area agreement; track-to-track consistency; SWOT check; anomaly false-alarm test; ANUGA mass balance and arrival-time sanity; limits.

### F12 · Submission assets — P0
- 30 s video (screen capture of the 3D replay plus alert plus slider) or ≤ 7-slide deck; project page text; AI declaration; data and references list.

## 7. Release plan (hackathon)

| Milestone | Content | Target |
|---|---|---|
| M1 | Data bundle P0: terrain, NISAR chips (6+ dates), S1 before, lake polygon, area series, alerts | Sat 23:00 |
| M2 | App P0: intro upgrade → 3D Mellègue → Acts 1–6, chart, anomaly card, Radar School hooks | Sun 08:00 |
| M3 | Flood P0/P1: flow path + HAND slider + impacts; ANUGA ≥ 1 scenario (21 Mm³) | Sun 11:00 |
| M4 | Polish: Acts 7–9, Dam Watch panel, validation page, sources, accessibility, mobile check | Sun 14:00 |
| M5 | Demo video/deck, project page, public link test, rehearsal | **Sun 16:00** |

## 8. Acceptance criteria (P0)

1. Clicking **Start the mission →** plays the dive and lands in the 3D Mellègue scene in ≤ 4 s, with no blank frames.
2. The scene shows real terrain and at least the S1 17 Jun image and NISAR 19 Jun, 21 Jun, 1/3 Jul images, switchable by the time scrubber.
3. Every image, number and chart carries a badge and a source link.
4. The area chart renders ≥ 20 NISAR dates; clicking a point syncs the 3D date.
5. The anomaly card fires for the post-failure drop and shows its rule and numbers.
6. The flow path from the dam to Sidi Salem is drawn on the 3D terrain; its length is shown.
7. The production build (React + TypeScript, CI green) is deployed on Vercel with no API keys, loads in < 6 s on a normal connection (initial data ≤ 15 MB, initial JS ≤ 350 kB gzip), supports deep links per act/date/scenario, and works in Chrome, Edge, Firefox and Safari 17+.
8. Keyboard navigation works; `prefers-reduced-motion` is respected; text contrast is AA.

## 9. Project page drafts (paste and adapt)

**Project name:** Dancing with the Rivers: Dam Watch from Space

**High-level summary (≈170 words):**
> On the night of 17 June 2026, a 72-year-old gate failed at Tunisia's Mellègue dam and about 21 million m³ of water rushed down the valley toward Sidi Salem, the country's largest reservoir. Dancing with the Rivers replays that night from space. Using NASA–ISRO NISAR L-band radar (every 6–12 days, through clouds), we measured the reservoir draining, explained each radar signal in plain language, and turned the method into *Dam Watch*, an open, browser-based tool that (1) tracks any reservoir's water area from NISAR, (2) flags abnormal drops automatically, (3) estimates level and volume change with SWOT and terrain data, and (4) simulates where released water would flow and which farms, roads and villages it would reach, using the open-source ANUGA hydraulic model. Tunisia's daily dam bulletins stopped in 2025, and a 195 million m³ dam is opening on the same river: independent, free monitoring matters. The narrative is built for citizens and students; the tool is built for water managers and civil protection.

**SI (AI) use:** declare the AI used for code generation, documentation drafting and text editing, and mark any AI-generated media (→ 01 §2).