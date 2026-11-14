# Dancing with the Rivers: project brief for Claude Code and its agents

NASA Space Apps 2026 (Tunis), challenge "Dancing with SARs". **Submission Sun 15 Nov 2026 16:30 (local)**, pitch 17:00, final click 23:59.

**What we build.** On the night of 17–18 June 2026 a 72-year-old gate failed at Tunisia's Mellègue dam and about 21 Mm³ escaped. NISAR watched the lake drain. The app replays that night in 3D from real radar data, explains each radar signal in plain language, then unlocks *Dam Watch*: reservoir area from NISAR, automatic anomaly alerts, level and volume estimates, and "what if" flood scenarios.

**Names (decided by the user, 14 Nov):** the project is **Dancing with the Rivers** (formerly "Dancing with Dams"). The on-screen product stays **HydroStress** with its tool **Dam Watch** until the user says otherwise; both come from `apps/web/src/brand.ts` and `config.yaml`, never hard-coded.

**New session? Read §11 (handoff) first**: it says exactly where the build stopped and what to do next.

**Read first:** `docs/00_README.md` → 02 PRD → 05 App flow → 06 System design → 03 TRD → 04 UI/UX → 07 Analysis & validation. `docs/01_CONTEXT_AND_RESEARCH.md` is the source of truth for facts and sources. `docs/09_GENERALIZATION_AND_RIVER_DETECTION.md` is the **v2 roadmap** (any dam, automatic amont/aval detection, API + workers): not on the v1 critical path; its §0.3 lists the few things v1 uses. `docs/08_CLAUDE_CODE_BRIEF.md` is **superseded** where it says vanilla JS, `web/` or "keep three.js r128": the stack is the React/TS one in 03/04/06.

---

## 1. Hard rules (every agent)

1. **Narrative first.** Start the mission → dive → land in the 3D Mellègue scene (Act 1). No dashboard before Act 9.
2. **Never invent data.** Missing output → schema-valid placeholder with `"badge": "ILLUSTRATIVE", "placeholder": true`. Placeholders are never presented as results.
3. **Every layer and number** shows a badge (MEASURED / REPORTED / MODELLED / ILLUSTRATIVE) and a source. Uncertainty is drawn, not hidden.
4. **Say / do-not-say** (docs/07 §9). NISAR did *not* see the gate fail (first image 19 Jun). The "before" is Sentinel-1, 17 Jun 17:20 UTC. No "water under vegetation", no "only NISAR can see this", no forecasts.
5. **Visual bar.** `reference/NISAR-HydroStress-Cinematic-Intro.html` is the reference. The production app must match or beat it; regressions are bugs.
6. **Static delivery.** No runtime API calls or keys in the demo path; the app reads only the versioned data bundle.
7. **Secrets.** `EARTHDATA_TOKEN` lives only in the environment or a gitignored `.env`. `docs/earthdata_token.md` must never be committed, printed or copied.
8. **PROJ guard** from `TESTS/mellegue_test.py` at the top of every Python script.
9. **No NASA logos or branding** in anything we generate; declare AI use; watermark AI media.
10. **Ship over polish.** P0 → P1 → P2 (docs/02 §6). When late, apply the cut line (§6 below) without asking.

## 2. Architecture (end to end)

```
External data (offline)            Python pipeline (.venv, py3.11)              Web (React+TS SPA, static CDN)
ASF NISAR GCOV/SME2 ─┐             pipeline/common/contracts.py (pydantic) ──► contracts/*.schema.json
Planetary Computer   ├─► 01 terrain → 02 reservoir → 03 anomaly                      │ codegen (json-schema-to-zod)
 S1 RTC · NASADEM ·  │   04 routing+HAND → 05 ANUGA (Colab) → 06 impacts               ▼
 WorldCover          │   07 level/volume (SWOT Hydrocron + DEM)            src/data/schemas.gen.ts
SWOT Hydrocron · OSM │   08 bundle (validate + manifest) ──► apps/web/public/data/<version>/ ──► DataSource
Press → events.json ─┘   09 renders (Forge3D stills, optional)                        (TanStack Query + Zod)
                                                                                         ▼
                                                    Zustand store ⇄ URL ─► UI (cards, scrubber, slider, charts)
                                                                       └─► R3F Stage (one persistent Canvas)
```

- **One contract source.** Pydantic models in `pipeline/common/contracts.py` → JSON Schema in `contracts/` → generated Zod in `apps/web/src/data/schemas.gen.ts`. `08_bundle.py` validates on write; the web validates on read; CI checks the generated file is current. Nobody hand-edits generated schemas.
- **Fixture bundle first.** `08_bundle.py --fixture` writes a complete placeholder bundle (all files, ILLUSTRATIVE) in hour 1, so frontend and pipeline work in parallel. Real outputs replace fixtures file by file.
- **Swappable data layer.** `DataSource` interface (docs/03 §6.3): `StaticBundleSource` now, `ApiSource` (FastAPI + PostGIS) is the v2 roadmap (docs/06 §1).
- **One grid.** Every raster is on the scene grid (UTM 32N, 30 m) or the lake-chip grid (10 m), as declared in `grid.json`. No client-side reprojection.
- **3D.** Single `<Canvas>` under the shell; intro and Mellègue scenes swap under the white flash. The intro is ported from the prototype as typed imperative modules driven by `useFrame` (same numbers, timings and shaders), not rewritten mesh by mesh.

**Stack:** React 18 · TypeScript strict · Vite · React Router · three.js (current) + @react-three/fiber + drei + postprocessing · GSAP 3 (+ScrollTrigger) · Framer Motion · Tailwind + CSS-variable tokens · shadcn/Radix · visx · Zustand · TanStack Query · Zod · Vitest + RTL · Playwright + axe. Python: asf_search, h5py, numpy, rasterio, pystac-client, planetary-computer, scipy, pysheds, geopandas, pydantic, earthaccess; ANUGA on Colab; forge3d==1.47.0 for offline stills only.

## 3. Repository layout (this folder is the repo root)

```
CLAUDE.md  README.md  LICENSE  config.yaml  .env.example  .gitignore  requirements.txt
docs/                      specs (read-only for agents except [TBD] fills and the 07 §8 table)
reference/                 NISAR-HydroStress-Cinematic-Intro.html (copied from TESTS/, never edited)
TESTS/                     original scripts and outputs: archive, do not modify
contracts/                 *.schema.json (generated from pydantic)
pipeline/common/           mellegue_test functions as a module + contracts.py
pipeline/00_inventory.py … 09_renders.py, run_all.py
cache/  work/              gitignored
apps/web/                  Vite app (layout per docs/06 §2), public/data/<version>/
.github/workflows/         web-ci.yml, pipeline-ci.yml
.claude/agents/  .claude/skills/  .mcp.json
```

`.gitignore` must include: `.env`, `docs/earthdata_token.md`, `cache/`, `work/`, `.venv/`, `node_modules/`, `dist/`, `TESTS/**/cache/`.

## 4. The team: agents, ownership, hand-offs

The **main session is the lead and integrator**. It plans each milestone, spawns agents with self-contained prompts, owns shared files, merges, and reports to the user. Agents never edit files outside their ownership; they ask the lead.

| Agent | Owns | Main inputs → outputs | Skills / MCP |
|---|---|---|---|
| **lead** (main session) | Root config, `package.json`, `vite.config.ts`, `tsconfig`, CI, `contracts/` codegen wiring, `config.yaml`, git | Milestone plan → integrated, verified build | all |
| `geo-pipeline` | `pipeline/` 00–03, 07–09, `pipeline/common/` | ASF, PC, Hydrocron → terrain, chips, `reservoir_area.json`, `alerts.json`, `level_volume.json`, bundle | — |
| `hydro-modeler` | `pipeline/04–06` | DEM → flow path, HAND + LUT, ANUGA scenarios, `impacts.json` | — |
| `scene-3d` | `apps/web/src/scene/`, `src/features/intro/`, shaders | Prototype + grid/textures → Stage, intro, terrain, shots | threejs-*, gsap-*, web-performance · context7, chrome-devtools |
| `frontend-ui` | `apps/web/src/**` except scene/intro | Contracts + docs/04–05 → shell, data layer, acts, controls, charts, Dam Watch | shadcn, gsap-react, accessibility, vitest, impeccable, frontend-design · shadcn, context7 |
| `qa-verifier` | `apps/web/e2e/`, test fixtures | Running app → pass/fail table with evidence | webapp-testing, accessibility, web-performance · playwright, chrome-devtools |
| `science-reviewer` | nothing (read-only) | Copy, charts, bundle → claim findings | — |
| `story-pitch` | `apps/web/src/locales/`, `submission/` | Bundle + docs/01 → act copy, project page, video script, deck | slides (global) |

**Interfaces between agents**
- geo-pipeline / hydro-modeler → frontend-ui and scene-3d: only through contracts + bundle files. A contract change = regenerate schemas + tell the lead.
- scene-3d ↔ frontend-ui: only through the Zustand store (`src/store/`, owned by frontend-ui; scene-3d may request fields) and `styles/tokens.ts`.
- Anything with a number → science-reviewer before it ships. Every milestone → qa-verifier before the lead reports done.

**Spawning rules:** at most 3 builder agents in parallel; give each a complete prompt (goal, files, contract, acceptance test); parallel web agents on separate directories, or `isolation: "worktree"` if they must touch shared files; never duplicate work an agent is already doing.

## 5. Milestones and lanes (stop and show the user after each)

Lanes run in parallel: **Data** (geo-pipeline) · **Model** (hydro-modeler) · **Scene** (scene-3d) · **UI** (frontend-ui). Gates: **QA** (qa-verifier), **Sci** (science-reviewer).

| M | Content | Lanes | Gate | Target | Status (Sat 14 Nov, 23:30) |
|---|---|---|---|---|---|
| M1 | Repo skeleton, git, `.gitignore`, `config.yaml` (AOIs docs/03 §2), py3.11 venv, `pipeline/common`, contracts + codegen, **fixture bundle**, Vite scaffold with tokens, CI (typecheck + build + 1 smoke) | lead + Data + UI | builds; fixture validates | Sat 21:30 | ✅ done |
| M2 | **Run the reservoir series** (critical path: the main chart does not exist yet) + `01_terrain.py` | Data | Sci on numbers | Sat 23:30 | ✅ done (adaptive masks; see §8) |
| M3 | Intro port (parity) → dive → `/story/1`; Stage + Terrain shader + shots on real terrain | Scene | QA parity + ≤ 4 s | Sun 03:00 | ✅ done, commit e7c2c12 (dive 3.9 s; bloom sweep not built) |
| M4 | `02_reservoir` lake polygon + chips; Acts 1–3, scrubber, swipe, badges | Data + UI + Scene | QA | Sun 06:00 | ◐ data ✅; **UI acts 1–3 to do** |
| M5 | `03_anomaly` + Acts 5–6 (chart, alert card) | Data + UI | QA + Sci (B1–B3) | Sun 08:00 | ◐ detector ✅; **chart + alert card UI to do** |
| M6 | `04_routing_hand` + Act 4 path + Act 7 slider and counters; ANUGA v21 in Docker in background | Model + UI + Scene | QA + Sci (D1–D5) | Sun 11:00 | ◐ 04_routing_hand ✅ (D1⚠️ D2✅ D3✅); **UI to do** |
| M7 | ANUGA ingest, `06_impacts`, `07_level_volume` + Act 8 | Model + Data + UI | Sci (E, F, L) | Sun 13:00 | ◐ ANUGA v21 + impacts ✅ interim; fine-mesh re-runs in progress (§11); `07_level_volume` **not started**; UI to do |
| M8 | Act 9, Dam Watch drawer, Methods/Validation (07 §8 filled), Sources, 2D fallback, a11y pass | UI + Pitch | QA full + Sci full | Sun 14:30 | ⬜ |
| M9 | Deploy, private-window test, 30 s video from Tour, project page, deck | lead + Pitch | QA on public URL | **Sun 16:00** | ⬜ |

## 6. Cut line (pre-approved)

Not in v1 unless ahead of schedule: Storybook, Lighthouse CI, PWA, Sentry/analytics, FR/AR, Comlink worker (decode on the main thread first), KTX2 textures. If late: Acts 8–9 become cards without interaction; HAND slider + one ANUGA scenario; Dam Watch = one panel for Mellègue. **Never cut:** the badges, the honest limits, the intro quality, Acts 1–6.

## 7. Environment notes (this machine)

- Windows 11, PowerShell + Git Bash. Node 24, pnpm 9.15, Python 3.14 default (**use `py -3.11` for the venv**), no `gh`, no conda.
- **`registry.npmjs.org` times out on this network; `registry.yarnpkg.com` works.** `.mcp.json` launches servers with `--registry=https://registry.yarnpkg.com`. No `.npmrc` (pending the user's approval). `pnpm add` hangs because the mirror's metadata still points tarballs at npmjs.org. To change dependencies in `apps/web`: edit `package.json` (exact versions), then
  `pnpm install --lockfile-only --registry=https://registry.yarnpkg.com` →
  `sed -i -E 's#, tarball: https://registry\.npmjs\.org/[^}]*\}#}#' pnpm-lock.yaml` →
  `pnpm install --frozen-lockfile --registry=https://registry.yarnpkg.com`. Only the lead changes dependencies.
- Web versions: React 18.3.1, three 0.187.0, R3F 8.18.0, drei 9.122.0, postprocessing 2.19.1, GSAP 3.15.1, Vite 5.4, TS 5.9, Tailwind 3.4. CSP is `script-src 'self'`: self-host any decoder (Draco/Basis), no CDNs.
- Contract paths inside JSON (manifest `file`, anuga `files`/`stats`) are relative to the bundle root.
- **Docker:** `docker compose up --build web` serves the built SPA at http://localhost:5173 (pnpm + committed lockfile, nginx; verified 14 Nov). `dwd-anuga:1` (ANUGA 4.2.0) runs the flood scenarios: `docker run --rm -v "<repo>:/work" -w /work dwd-anuga:1 python pipeline/05_anuga_scenarios.py …`.
- GitHub and PyPI are reachable. ASF downloads need `EARTHDATA_TOKEN` and are slow or reset: rely on the cache in `TESTS/mellegue_test_output/cache/`.
- MCP servers (project `.mcp.json`): playwright, chrome-devtools, context7, shadcn.
- Project skills (`.claude/skills/`): threejs-* (r186), gsap-* (official), shadcn (official), webapp-testing (Anthropic), accessibility, web-performance, vitest, plus the design skills (impeccable, frontend-design, design-taste-frontend, ui-ux-pro-max, ui-styling, design-system, brand, design, banner-design).

## 8. Key findings already established (do not re-derive)

- 1,755 NISAR L-band products over Tunisia, 17 Jun → 31 Oct 2026; over Mellègue, 31 dates across D80/A101/A173/D8, gap 25 Jul → 13 Aug.
- Go/no-go (`TESTS/mellegue_test_output/`): the lake is clearly visible on 19 Jun and gone by 13 Jul (visual check), but the **wide-box** water area *rose* (D80 5.5 → 9.4 km²; A101 16.9 → 22.7 km²) because harvested fields darken. Use the tight `A_LAKE` box (8.665–8.735 E, 36.29–36.33 N) and then `lake_max.geojson`. The lake sits at about 8.69–8.71 E, 36.31–36.32 N.
- Change-map noise 0.6–0.9 dB; changed pixels are 92% cropland; SME2 decline is a regional heatwave signal (do not use).
- **Reservoir series (02_reservoir.py, 14 Nov):** fixed −18 dB fails (17 Jun S1 orbit 88 lake is wind-roughened at −15…−17 dB; post-failure NISAR wet mud at −15…−18 dB). Adaptive per-image Otsu inside the pre-failure lake polygon (4.68 km² incl. 100 m dilation; user's dam point 6 m from it) gives 131 good + 2 low-confidence (wind, 29–30 May) measurements.
  Story the data supports: pre-failure ≈ 2.6–3.2 km² → **gradual decline 17 Jun → ~20 Jul to ≈ 1.7 km²** (gate open until repaired 16 Jul) → plateau in August → rise late September (autumn rain). Same-orbit S1 o168: 2.88 (16 Jun) → 2.21 (23 Jun) → 1.51 km² (11 Jul).
  Caveats: threshold ±2 dB moves area ≈ ±20% (A1 ⚠️, show the band); NISAR area lags right after the failure (wet mud ≈ water at L-band: D80 19 Jun → 1 Jul 2.49 → 2.50 km²) while the **median dB inside the lake polygon rises at once** (≈ −16…−17.5 → ≈ −14 dB). It is a drawdown over weeks, not an overnight vanishing: never say "the lake disappeared".
- **Anomaly detector (03_anomaly.py, 14 Nov):** the docs' single-pair z-score rule failed validation (Aug–Oct 3 ALERT + 3 WARNING; −20% synthetic drops detected 52%). Primary rule now: harmonised area vs 21-day multi-sensor baseline, WARNING < −12%, ALERT < −20%, each **confirmed by an independent pass** within 6 days. Result: **first ALERT 22 Jun 2026** (S1 o161 −21%, confirmed by S1 o88), 5 days after the failure; **0 flags before the failure**; first NISAR flag 26 Jun (A173, WARNING, −13%); flags in mid-Oct–Nov coincide with a real multi-sensor decline after the late-September rise (report as "needs operator check", not as false alarms).
  **Act 6 wording:** "NISAR and Sentinel-1 together would have raised an alarm on 22 June, five days after the failure, with no ground sensor." Never "on 19 June", never "NISAR alone". Full test report: `work/anomaly/report.md`.

- **GEM-15 (01b_gem15.py, 14 Nov):** Google Research 15 m DTM (experimental, CC-BY 4.0, public COGs, no account). Valley dam → Sidi Salem: 99.2% valid, GEM-15 − NASADEM median −0.96 m (5–95%: −5.8…+3.5 m). `work/gem15_dtm_15m.tif` (gaps filled from NASADEM) is the **preferred bed for routing, HAND and ANUGA if the D8 path passes test D2**; else NASADEM. Water is masked in GEM-15 (no bathymetry). Attribution: "This dataset is produced by Google"; cite doi:10.31223/X55N75. Details: docs/09 §3.6.
- **Context data (00_context_data.py):** Mellègue catchment 10,315 km², Sidi Salem 18,069 km²; dam point 5 m from the OSM crest line; 102 villages, 16,553 building centroids, WorldPop 601,577 people in the scene. OSM lacks the Upper Mellègue dam and the Jendouba irrigated perimeter (user to draw in `geojson_data/`).

- **Flow path & flood (04–06, 14 Nov, MODELLED):** DEM = GEM-15 block-averaged to 30 m (D2: 98.8% of path within 300 m of OSM rivers; NASADEM 98.6%). Path **101.0 km** dam → Sidi Salem; Jendouba km 37.6 (town 4.4 km off the path), Medjerda confluence km 44.9, Bou Salem km 66.8. HAND bathtub (main-stem HAND, whole corridor): **21 Mm³ → h 0.97 m, 26.5 km², 1,309 ha cropland, 1 village, ~980 people; 50 Mm³ → 1.90 m, 35.7 km², ~1,460 people; 195 Mm³ → 4.54 m, 79.1 km², 5,321 ha, 4 villages (Bou Salem, Muthul, Sidi Smail, Ben Bchir), ~6,600 people**. ANUGA v21_d12 interim (two-zone mesh): mass balance ~1e-12, **arrival at the Medjerda confluence 19.1 h**, 15.0 km² wet, D5 IoU 0.48–0.53. Being re-run on a uniform 2,500 m² mesh (the canyon below the dam was too coarse): numbers will shift; use the files in the bundle, not these.

## 9. Design direction (user's references in `UI_REFERENCES/`)

The prototype stays the base look; these two references raise the bar:
- **(238) "Onboard Inference" telemetry rail → story cards, Dam Watch, impact counters.** Uppercase tracked mono labels; big mono numerals with a small unit ("21 Mm³", "−38 %"); status pills with a dot (= our badges); hairline dividers; thin progress bars; image pairs captioned INPUT | WATER MASK (= our radar chip + mask); an outlined honesty pill ("RESEARCH-BASED RECONSTRUCTION", "SCENARIO · NOT A FORECAST") with 2–3 lines of small source text; a wide-tracked title over the 3D view.
- **(239) Floating imagery in 3D → hero / explore state.** Real NISAR and Sentinel-1 chips float as tiles around the satellite; clicking one flies to that date's before/after swipe. Left column: title, short body, one primary call to action.
Components: `<Badge>` (dot pill), `<Stat>`, `<HonestyNote>` in `src/components/`. Real data only in the tiles (fixtures marked ILLUSTRATIVE until then).

## 10. Open decisions (ask the user; do not assume)

- On-screen product name: keep "HydroStress" (current) or show "Dancing with the Rivers" as the title too? The project name itself is settled.
- Hosting: Vercel (docs/02 §8) or GitHub Pages (docs/08). Either way the app stays static.
- Project `.npmrc` pointing at `registry.yarnpkg.com`.

## 11. Session handoff (end of session 1 — Sat 14 Nov 2026, ~23:50; all agents and Docker runs stopped)

**Commits (all on `main`):** `ff6b68b` foundation · `56263aa` web skeleton · `5e326e0` anomaly detector · `9273527` data bundle + context layers · `dcc4498` rename, doc 09, GEM-15, Docker · `e7c2c12` M3 intro + 3D stage + irrigation · `d2aef07` handoff · `bb6619e` flow path, HAND, ANUGA v21 interim, impacts · `e9b1ff4` handoff · `9c6bf4b` ANUGA post options. Working tree is clean except the untracked `TESTS/` archive (intentionally not committed). Run `git log --oneline` and `git status` first; anything uncommitted is described below.

### What exists and works
- **Pipeline** (`.venv`, py 3.11), run in this order; all write to `apps/web/public/data/2026-11-15/` and validate with `python pipeline/08_bundle.py --validate`:
  `00_context_data.py` (OSM, HydroSHEDS, JRC, WorldCover, WorldPop, boundaries) · `00b_irrigation.py` (irrigated cropland summer 2026) · `01_terrain.py` (NASADEM, basemap, hillshade) · `01b_gem15.py` (GEM-15 15 m valley DTM) · `02a_reservoir_series.py` (NISAR + S1 download, cached) · `02_reservoir.py` (lake polygon, adaptive masks, series, chips) · `03_anomaly.py` (detector + tests) · `04_routing_hand.py` (flow path, streams, corridor, HAND, LUT) · `05_anuga_scenarios.py` (Docker) · `06_impacts.py`.
- **Web** (`apps/web`): shell, routes, store + URL sync, data layer with generated Zod schemas, tokens, Badge/Stat/HonestyNote, **full cinematic intro** (parity with the prototype), **3D Mellègue stage** (terrain, lake chip + mask + swipe, lake outline, dam label, camera shots), dive → `/story/1`. 48 tests; typecheck, lint, build green. `docker compose up --build web` → http://localhost:5173.
- **Dev tips:** `/?t=9.2` freezes the intro; `/?dive=2` freezes the dive; once "Skip intro" is pressed, `/` redirects to `/story/1` — use `/?intro=1` to see the intro again.

### State of the flood modelling (nothing is running)
- **In the app bundle (committed):** `flood/anuga/index.json` has **v21_d12 computed** (interim run on a two-zone mesh: ≤ 2,500 m² where HAND < 5 m, ≤ 20,000 m² elsewhere; 31k triangles; 18 min) with `maxdepth.png`, `arrival.png`, 97 frames, `stats.json`, and `impacts/impacts.json`. **v195_d12 and v50_d12 are `computed: false`** → the UI must disable those chips ("Not computed yet") and the HAND slider covers all volumes.
- **Known weakness of the interim v21:** the gorge just below the dam was meshed coarsely (depths up to 16.8 m there). A uniform 2,500 m² mesh re-run was started and **stopped at 34/48 h by the user's request**; its partial output in `work/anuga/v21_d12/` is NOT valid (the valid interim copy is in `work/anuga/twozone/`). `work/anuga/STOP` exists and blocks the queue.
- **To finish (≈ 30–45 min per scenario in Docker, 4 OMP threads):** `rm work/anuga/STOP`, then `bash work/anuga/run_all.sh` (runs v21, v195, v50 in `dwd-anuga:1`) and `bash work/anuga/post_all.sh` (waits for each run, then `05_anuga_scenarios.py --post <id>`, `06_impacts.py`, `08_bundle.py --validate`). Or one scenario at a time: see `.venv/Scripts/python pipeline/05_anuga_scenarios.py --help`. If time is short, **skip the re-run**: v21 interim + HAND for all volumes is enough for the pitch (cut line §6), say "screening level".
- Tests still to report in docs/07 §8 for the final runs: E1 (mass balance — interim ~1e-12 ✅), E3, E7 (arrival at the confluence — interim 19.1 h), D5 (IoU HAND vs ANUGA — interim 0.48–0.53 ✅), F1–F3.

### Next steps, in order (deadline Sun 15 Nov 16:30)
1. **Start:** `git log --oneline | head` and `git status`; `cd apps/web && pnpm -s typecheck && pnpm -s test` and `.venv/Scripts/python pipeline/08_bundle.py --validate` should all pass. Never commit `work/`, `cache/`, `.env`, `docs/earthdata_token.md`.
   Decide (ask the user if unclear) whether to run the ANUGA re-runs above in the background while the UI is built.
2. **M4–M6 UI (frontend-ui + scene-3d, the critical path):** story cards for Acts 1–7 from docs/05 §3 (copy from `story-pitch`), TimeScrubber + chart (`ReservoirChart`, visx) on `reservoir_area.json`, AlertCard on `alerts.json` (first ALERT 22 Jun), SwipeHandle (set `compareDate` = 2026-06-17 in Act 3), flow path line + `valley_follow` spline from `vectors/flowpath.geojson`, HAND flood layer (`uHand`/`uHandH` already wired) + VolumeSlider + ImpactCounters from `hand_lut.json`, ANUGA scenario chips from `flood/anuga/index.json`. Story layout must use `pointer-events: none` except on cards (else the 3D view cannot be dragged).
3. **M7:** `07_level_volume.py` (SWOT Hydrocron + DEM shoreline, docs/03 §5.4) — cut to "reported volumes + DEM method" if short of time; Act 8 card.
4. **M8:** Act 9 (catchment 10,315 km², other reservoirs from `vectors/dams.geojson`), Dam Watch drawer (one panel for Mellègue), Methods page with the docs/07 §8 table, Sources page from `story/sources.json` + docs/DATA_SOURCES.md, 2D fallback, axe pass. Run `science-reviewer` on all copy.
5. **M9:** deploy (Vercel or GitHub Pages — user decision pending), private-window test, 30 s video from the Tour (English subtitles), project page text (docs/02 §9, AI declaration), rehearsal.
6. Apply the cut line (§6) without asking if behind schedule.

### Decisions and facts from this session that the docs now reflect
- Project name **Dancing with the Rivers**; on-screen product **HydroStress** / **Dam Watch** (§10 open question about the title).
- The story is "the lake drained for a month until the gate was repaired" and "NISAR + Sentinel-1 would have alarmed on **22 June**" (§8). Not "vanished", not "19 June", not "NISAR alone".
- Irrigated cropland comes from data, not drawing: ~2,000 ha of cropland still green in Jul–Aug 2026 (Sentinel-2), 90% inside NASA LGRIP30's irrigated class; LGRIP30 alone marks 84% of cropland irrigated (over-inclusive), so it is a check, not the layer. `vectors/irrigated.geojson`, MEASURED.
- The user drew the dam crest line: `geojson_data/BARRAGE_MELLEGUE_LINE.geojson` (994 m, 9 m from the dam point; OSM's line is 587 m). Not yet used by any script: candidate for the ANUGA inlet line and the 3D dam marker.
- **Generalisation:** v1 is a Mellègue-specific bundle; the methods are generic (see docs/09 §0). Hard-coded per site: `config.yaml` AOIs/CRS/dates, `02_reservoir.CHIP_DATES`, the pre-failure window and the Aug–Oct calibration period in `03_anomaly.py`, the story copy. A second Tunisian reservoir as proof is P2.
- Still needed from the user: Upper Mellègue dam (line + reservoir polygon) for the 195 Mm³ "new dam" scenario origin; hosting choice.
- Agents can be stopped by the account's usage limit mid-task; their files stay on disk. In a new session the custom agents in `.claude/agents/` load normally (`subagent_type: frontend-ui`, `scene-3d`, …); brief them with the relevant part of this section.
- Notes left by scene-3d for the UI work: the Story placeholder's full-screen div blocks 3D dragging (`pointer-events: none` except cards); Act 3 must set `compareDate` (e.g. 2026-06-17) for the swipe; `Terrain.tsx` hides the radar chip when `act === 1` (move that to act configs); bloom has no emitter yet (radar swath sweep not built); `valley_follow` shot reuses `arrival` until a spline is built from `vectors/flowpath.geojson`.

