# Dancing with the Rivers: project brief for Claude Code and its agents

NASA Space Apps 2026 (Tunis), challenge "Dancing with SARs". **Submission Sun 15 Nov 2026 16:30 (local)**, pitch 17:00, final click 23:59.

**What we build.** On the night of 17–18 June 2026 a 72-year-old gate failed at Tunisia's Mellègue dam and about 21 Mm³ escaped. NISAR watched the lake drain. The app replays that night in 3D from real radar data, explains each radar signal in plain language, then unlocks *Dam Watch*: reservoir area from NISAR, automatic anomaly alerts, level and volume estimates, and "what if" flood scenarios.

**Names (decided by the user, 14 Nov):** the project is **Dancing with the Rivers** (formerly "Dancing with Dams"). The on-screen product stays **HydroStress** with its tool **Dam Watch** until the user says otherwise; both come from `apps/web/src/brand.ts` and `config.yaml`, never hard-coded.

**Branches (decided 15 Nov):** `main` = **v1**, deployed to Cloudflare Pages on every push (docs/DEPLOY.md), so keep it green. `v2` = generalisation work (docs/09 §0.4–0.5), **never deployed**, worked in the separate worktree `../NASA_CHALLENGE_v2`; merge `main` into `v2` regularly, never `v2` into `main` before the submission.

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

| M | Content | Lanes | Gate | Target | Status (Sun 15 Nov, 05:00) |
|---|---|---|---|---|---|
| M1 | Repo skeleton, git, `.gitignore`, `config.yaml` (AOIs docs/03 §2), py3.11 venv, `pipeline/common`, contracts + codegen, **fixture bundle**, Vite scaffold with tokens, CI (typecheck + build + 1 smoke) | lead + Data + UI | builds; fixture validates | Sat 21:30 | ✅ done |
| M2 | **Run the reservoir series** (critical path: the main chart does not exist yet) + `01_terrain.py` | Data | Sci on numbers | Sat 23:30 | ✅ done (adaptive masks; see §8) |
| M3 | Intro port (parity) → dive → `/story/1`; Stage + Terrain shader + shots on real terrain | Scene | QA parity + ≤ 4 s | Sun 03:00 | ✅ done, commit e7c2c12 (dive 3.9 s; bloom sweep not built) |
| M4 | `02_reservoir` lake polygon + chips; Acts 1–3, scrubber, swipe, badges | Data + UI + Scene | QA | Sun 06:00 | ✅ data; ◐ acts 1–3 built (session 2), copy being fixed from the 15 Nov science review |
| M5 | `03_anomaly` + Acts 5–6 (chart, alert card) | Data + UI | QA + Sci (B1–B3) | Sun 08:00 | ◐ chart + alert card built; review fixes (low-confidence points, gaps, −20.5 %) in progress |
| M6 | `04_routing_hand` + Act 4 path + Act 7 slider and counters; ANUGA v21 in Docker in background | Model + UI + Scene | QA + Sci (D1–D5) | Sun 11:00 | ◐ flow path, HAND slider, ANUGA chips built; review fixes + 3D visibility upgrade in progress |
| M7 | ANUGA ingest, `06_impacts`, `07_level_volume` + Act 8 | Model + Data + UI | Sci (E, F, L) | Sun 13:00 | ✅ ANUGA v21/v50/v195 final (uniform mesh) + impacts; ✅ `07_level_volume` (SWOT); Act 8 UI in progress |
| M8 | Act 9, Dam Watch drawer, Methods/Validation (07 §8 filled), Sources, 2D fallback, a11y pass | UI + Pitch | QA full + Sci full | Sun 14:30 | ◐ `validation.json` ✅; Methods / Sources / Dam Watch pages in progress (see §11) |
| M9 | Deploy, private-window test, 30 s video from Tour, project page, deck | lead + Pitch | QA on public URL | **Sun 16:00** | ◐ Cloudflare config ✅ (docs/DEPLOY.md); submission/ texts in progress; deploy + video + rehearsal to do |

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
  Caveats: threshold ±2 dB moves area ≈ ±20% (A1 ⚠️, show the band); NISAR area lags right after the failure (wet mud ≈ water at L-band: D80 19 Jun → 1 Jul 2.49 → 2.50 km²) while **same-orbit Sentinel-1** shows the median dB inside the lake rising at once (o88 −14.9 → −12.5 dB, 17 → 22 Jun). S1-before vs NISAR-after is cross-sensor (C vs L band): label it, never use it as evidence. It is a drawdown over weeks, not an overnight vanishing: never say "the lake disappeared".
- **Anomaly detector (03_anomaly.py, 14 Nov):** the docs' single-pair z-score rule failed validation (Aug–Oct 3 ALERT + 3 WARNING; −20% synthetic drops detected 52%). Primary rule now: harmonised area vs 21-day multi-sensor baseline, WARNING < −12%, ALERT < −20%, each **confirmed by an independent pass** within 6 days. Result: **first ALERT 22 Jun 2026** (S1 o161 −20.5%, confirmed the same day by S1 o88 −28.8%; NISAR is in the baseline only), 5 days after the failure; **0 flags before the failure**; first NISAR flag 26 Jun (A173, WARNING, −13%); flags in mid-Oct–Nov coincide with a real multi-sensor decline after the late-September rise (report as "needs operator check", not as false alarms).
  **Act 6 wording:** "NISAR and Sentinel-1 together would have raised an alarm on 22 June, five days after the failure, with no ground sensor." Never "on 19 June", never "NISAR alone". Full test report: `work/anomaly/report.md`.

- **SWOT level (07_level_volume.py, 15 Nov, MEASURED):** PLD lake 1530007983 "BARRAGE MELLEGUE" via Hydrocron LakeSP. Good passes (quality 0): ≈ 260.5–260.8 m Mar–7 Jun → **256.79 ± 0.08 m on 28 Jun (Δh −3.75 m)**. ΔV 7 → 28 Jun = **−12.7 Mm³ (−17.1…−7.8)**, MODELLED: net storage change, not the release (≈ 0.6 × reported 21 Mm³). SWOT area_total (4–4.9 km²) ≠ radar area (2.2–2.6 km²); levels unaffected. DEM-shoreline levels rejected (L5 +6.9 m). All docs/07 §8 results are in the bundle file `validation/validation.json` (08b_validation.py).
- **GEM-15 (01b_gem15.py, 14 Nov):** Google Research 15 m DTM (experimental, CC-BY 4.0, public COGs, no account). Valley dam → Sidi Salem: 99.2% valid, GEM-15 − NASADEM median −0.96 m (5–95%: −5.8…+3.5 m). `work/gem15_dtm_15m.tif` (gaps filled from NASADEM) is the **preferred bed for routing, HAND and ANUGA if the D8 path passes test D2**; else NASADEM. Water is masked in GEM-15 (no bathymetry). Attribution: "This dataset is produced by Google"; cite doi:10.31223/X55N75. Details: docs/09 §3.6.
- **Context data (00_context_data.py):** Mellègue catchment 10,315 km², Sidi Salem 18,069 km²; dam point 5 m from the OSM crest line; 102 villages, 16,553 building centroids, WorldPop 601,577 people in the scene. OSM lacks the Upper Mellègue dam and the Jendouba irrigated perimeter (user to draw in `geojson_data/`).

- **Flow path & flood (04–06, 14 Nov, MODELLED):** DEM = GEM-15 block-averaged to 30 m (D2: 98.8% of path within 300 m of OSM rivers; NASADEM 98.6%). Path **101.0 km** dam → Sidi Salem; Jendouba km 37.6 (town 4.4 km off the path), Medjerda confluence km 44.9, Bou Salem km 66.8. HAND bathtub (main-stem HAND, whole corridor): **21 Mm³ → h 0.97 m, 26.5 km², 1,309 ha cropland, 1 village, ~980 people; 50 Mm³ → 1.90 m, 35.7 km², ~1,460 people; 195 Mm³ → 4.54 m, 79.1 km², 5,321 ha, 4 villages (Bou Salem, Muthul, Sidi Smail, Ben Bchir), ~6,600 people**. ANUGA final (uniform mesh, 69,616 triangles ≤ 2,500 m², dam → Medjerda confluence, 12 h triangular release): **21 / 50 / 195 Mm³ → wet 19.3 / 35.4 / 71.8 km², confluence arrival 12.9 / 9.3 / 6.2 h**, mass balance ≤ 1e-12. Mesh-sensitive (E4 ❌: interim two-zone mesh gave 19.1 h, 15.0 km²) → show arrival as **13–19 h**. 195 Mm³ is hypothetical (Upper Mellègue size) released at the old dam. Always read numbers from the bundle files; the science review of 15 Nov is in `work/review/science_review_2026-11-15.md`.

## 9. Design direction (user's references in `UI_REFERENCES/`)

The prototype stays the base look; these two references raise the bar:
- **(238) "Onboard Inference" telemetry rail → story cards, Dam Watch, impact counters.** Uppercase tracked mono labels; big mono numerals with a small unit ("21 Mm³", "−38 %"); status pills with a dot (= our badges); hairline dividers; thin progress bars; image pairs captioned INPUT | WATER MASK (= our radar chip + mask); an outlined honesty pill ("RESEARCH-BASED RECONSTRUCTION", "SCENARIO · NOT A FORECAST") with 2–3 lines of small source text; a wide-tracked title over the 3D view.
- **(239) Floating imagery in 3D → hero / explore state.** Real NISAR and Sentinel-1 chips float as tiles around the satellite; clicking one flies to that date's before/after swipe. Left column: title, short body, one primary call to action.
Components: `<Badge>` (dot pill), `<Stat>`, `<HonestyNote>` in `src/components/`. Real data only in the tiles (fixtures marked ILLUSTRATIVE until then).

## 10. Open decisions (ask the user; do not assume)

- On-screen product name: keep "HydroStress" (current) or show "Dancing with the Rivers" as the title too? The project name itself is settled.
- ~~Hosting~~ **Decided 14 Nov: Cloudflare (Pages / static assets)** for the static app (`_redirects` SPA fallback + `_headers` CSP). On-demand ANUGA for any user is **v2 only**: a Render background worker running the `dwd-anuga` image behind a job queue (30–45 min per run, paid instance). v1 offers the HAND slider (any volume) + precomputed ANUGA scenarios.
- Project `.npmrc` pointing at `registry.yarnpkg.com`.

## 11. Session handoff (session 2 — Sun 15 Nov 2026, ~05:00; usage budget nearly spent)

**Start a new session with:** `git log --oneline | head -15`, `git status`, then `cd apps/web && pnpm -s typecheck && pnpm -s lint && pnpm -s test && pnpm -s build` and `.venv/Scripts/python pipeline/08_bundle.py --validate`. Read `work/review/science_review_2026-11-15.md` (binding corrections, exact replacement copy) before touching any copy.

### What happened overnight
- Between sessions another assistant (log: `antigravity_discussion.md`, untracked) built the story system (`src/features/story/`: ActCard, acts/act1–9, TimeScrubber, SwipeHandle, ReservoirChart, AlertCard, VolumeSlider, ImpactCounters), distinct HAND (amber) / ANUGA (teal) flood looks, "Simplified / Advanced" level labels, and ran the final ANUGA scenarios. Its last commit (national Dam Watch with invented dams and statuses) was reverted (028bd5d).
- Session 2 commits: 028bd5d revert + `reference/` tracked again · 89b0a2d Cloudflare deploy (strict CSP `_headers`, no GitHub-Pages 404 hack, `wrangler.toml`, nginx same CSP) + confluence arrival in stats · f5192ab docs/07 §8 filled, same-sensor wording · 3c90cc0 branch policy · 5c9351a SWOT level/volume, `validation/validation.json`, MODELLED badges for DEM-derived layers, press sources in events.

### Data state (final for v1)
- ANUGA uniform mesh v21 / v50 / v195 computed (`flood/anuga/`), impacts for all three, E4 mesh test fails → arrival shown as 13–19 h. SWOT level real (`level/level_volume.json`, quality 0 + 1). 37 validation tests in `validation/validation.json`. Bundle 11.5 MB, validates. Nothing is running in Docker.
- Upper Mellègue: not detected; candidate construction site near 8.62–8.63 E, 36.24–36.25 N (S2 7 Apr 2026, `work/upper_mellegue/`), unconfirmed → the 195 Mm³ case stays "hypothetical, released at the old dam".

### In progress when the budget ran out (check `git status`; uncommitted files are agents' work)
- **UI (general-purpose agent acting as frontend-ui):** applying the science review to all act copy (no invented sources/figures; numbers read from the bundle), try-it actions as data in act configs (`features/story/actions.ts`, `acts/layers.ts`, `facts.ts`, `series.ts`, `useStoryData.ts`), chart fixes, Act 4 corridor strip, Act 7 single panel + ANUGA playback (store fields `floodPaused`, `floodSeekH`), Act 8 real SWOT chart, then Methods (render `validation.json`), Sources (AI declaration, Copernicus / NISAR / GEM-15 credits), Dam Watch (ONE honest Mellègue panel). `VolumeSlider.tsx` / `ImpactCounters.tsx` were deleted/replaced in its working tree.
- **scene-3d: done, uncommitted (waits for the UI agent; commit both together after green checks).** Reported green typecheck/lint/52 tests/build. Act 7 fps 26.5 → 43–49 (Iris Xe, 1920 px). New: `scene/LoadingVeil.tsx`, `status.ts`, `framing.ts` (lens shift away from the card; add `data-stage-occluder` on the right widget column in Story.tsx so framing avoids it), `mellegue/overlays.tsx`, `sceneVectors.ts`, `floodRamp.ts` (ANUGA_RAMP top "≥ 8 m", HAND_RAMP). TODO: never seen in a browser — Act 4 valley_follow + flow-path labels, Act 2 night, ANUGA wave front, village labels; tune `shots.ts` (lake_top, scenario_overview, night_dam) at 1440×900 and 390×844; check the Act 3 swipe line follows the lens shift. Old description: loading veil (`scene/LoadingVeil.tsx`, `scene/status.ts`), framing beside the card (`scene/framing.ts`), lake shots pulled back and sharpened, flood ramp (`mellegue/floodRamp.ts`, top class "≥ 8 m"), glowing flow path + reach labels, dam crest pin, villages layer, ANUGA playback wiring.
- **story-pitch: done (drafts committed).** `submission/` (project_page.md with AI declaration, video_script.md + subtitles_en.srt, deck.md, pitch_outline.md, numbers_check.md) + root `README.md`. TODO: science-reviewer pass on them; team confirms AI tools listed (Claude Code / Claude Opus, Google Antigravity); fill live URL, video link, repo URL; build the deck as slides with real screenshots. Rule when files disagree: **the bundle wins over docs** (A1 threshold ±23 % median per validation.json, not ±20 %; Aug–mid-Nov flags 3 ALERT + 12 WARNING; pre-failure evaluations 18 May–17 Jun) — align docs/07 §8 and app copy to it.
- If any of this is half-done: commit only what passes typecheck/lint/test/build; otherwise finish from the agent's TODO in its report (the lead pastes it below when it arrives).

### Next steps (deadline 16:30)
1. Verify + commit the agents' work (green checks, screenshots of /story/1–9, /methods, /sources, /watch at 1440×900 and 390×844 with Playwright MCP; save in `.playwright-mcp/`).
2. `science-reviewer` pass on the new copy (quick: only the changed act files and pages).
3. Push `main` (and `v2`) to GitHub; connect Cloudflare Pages (docs/DEPLOY.md, the user does the dashboard step); private-window test on the public URL.
4. 30 s video from the app (script in `submission/`), rehearsal, submit.
5. Cut line if late (§6): Acts 8–9 as cards, Dam Watch = one panel.

### Decisions
- Hosting **Cloudflare Pages** (§10). On-demand ANUGA for any user = V2 only.
- **Licence:** still open — ask the user (README says TBD).
- V2 lives on branch `v2` (worktree `../NASA_CHALLENGE_v2`); docs/09 §0.4–0.5 hold the reviewed plan; milestone 1 = offline batch bundles for 5–10 Tunisian reservoirs. Not started in code.
- Agent quirk: `.claude/agents/frontend-ui.md` no longer preloads the shadcn skill (its `npx shadcn` call hits the blocked npmjs.org and kills the agent at launch); definitions load at session start, so in a session where it still fails, run a general-purpose agent told to read that file as its role.
