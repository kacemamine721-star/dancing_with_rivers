# 08 · Claude Code Kick-off Brief

Paste the block below into Claude Code at the root of the repo, with `docs/` (files 00–07), `scripts/` and `NISAR-HydroStress-Cinematic-Intro.html` present.

---

```text
You are building Dancing with Dams for NASA Space Apps 2026 (Tunis). Deadline: Sunday 15 Nov 16:30.

Read docs/00_README.md, then 02_PRD.md, 05_APP_FLOW.md, 06_SYSTEM_DESIGN.md, 03_TRD.md, 04_UI_UX_DESIGN.md
and 07_ANALYSIS_AND_VALIDATION.md. 01_CONTEXT_AND_RESEARCH.md is the source of truth for facts and sources.

Hard rules
- Narrative first: Start the mission → dive → land directly in the 3D Mellègue scene (Act 1). No dashboard until Act 9.
- Keep the existing intro look and behaviour (three.js r128, fonts, colours, captions, HUD, hero, Lab, Tour,
  Read aloud, Everyone/Experts). Refactor it into web/ modules without visual regressions.
- Static site only (GitHub Pages). No API keys or runtime API calls in the demo path; read web/data/ only.
- Every layer and number shows a badge (MEASURED / REPORTED / MODELLED / ILLUSTRATIVE) and a source.
- Never invent data. Where a pipeline output is missing, use clearly marked placeholder JSON
  (badge ILLUSTRATIVE, "placeholder": true) with the exact schema from 06 §3, so real data can be dropped in.
- Keep the PROJ_LIB guard from scripts/mellegue_test.py at the top of every Python script.

Build order (stop and show me after each milestone)
M1 Repo skeleton per 06 §2; move scripts into pipeline/; config.yaml with AOIs from 03 §2.
M2 Extract the intro into web/index.html + js/intro.js + css/; at D_END call enterMellegue() (05 §1–2).
M3 pipeline/01_terrain.py (NASADEM via Planetary Computer → UTM 32N 30 m → rg16 heightmap, hillshade,
   grid.json) and js/scene.js (terrain mesh, drape shader with uSwipe/uHandH, named camera shots).
M4 pipeline/02_reservoir.py (extend scripts/mellegue_reservoir.py: lake polygon, chips on the lake grid,
   reservoir_area.json, manifest entries) + Acts 1–3 with scrubber and swipe.
M5 03_anomaly.py + Acts 5–6 (chart, alert card).
M6 04_routing_hand.py (pysheds: flow path, HAND, hand_lut.json) + Act 4 path + Act 7 slider and counters.
M7 05_anuga_scenarios.ipynb (07 §6.1) runnable on Colab; ingest outputs into flood/anuga/.
M8 06_impacts.py, 07_level_volume.py (SWOT Hydrocron + DEM shoreline) + Act 8.
M9 Act 9 + Dam Watch drawer, Methods/Validation page (07 §8), Sources page, accessibility, 2D fallback.
M10 Deploy to GitHub Pages; check the acceptance criteria in 02 §8; record the 30 s tour (05 §6).

Definition of done: all P0 acceptance criteria in 02 §8 pass; validation table in 07 §8 filled
(✅/⚠️/❌, never blank); no console errors; works in a private window on the public URL.
```

---

## Notes for the team

- **What needs a human with credentials:** ASF/NISAR downloads need `EARTHDATA_TOKEN` and run on your laptop (the sandbox may block ASF). Run `02_reservoir.py` locally, then commit `web/data/` outputs (not `cache/`).
- **What runs on Colab:** ANUGA (07 §6). Upload `dem_32632_30m.tif`, `anuga_domain.geojson`, `corridor_hand5m.geojson`; download `tifs/` and `stats.json`.
- **Fill the [TBD]s** in 01 §7, 05 Acts 5–6 and 07 §8 as soon as the numbers exist; the story text depends on them.
- **Cut line** if late: 06 §6.
