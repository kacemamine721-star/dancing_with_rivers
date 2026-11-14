# Dancing with Dams: project brief for Claude Code and its agents

NASA Space Apps 2026 (Tunis), challenge "Dancing with SARs". **Submission Sun 15 Nov 2026 16:30 (local)**, pitch 17:00, final click 23:59.

**What we build.** On the night of 17–18 June 2026 a 72-year-old gate failed at Tunisia's Mellègue dam and about 21 Mm³ escaped. NISAR watched the lake drain. The app replays that night in 3D from real radar data, explains each radar signal in plain language, then unlocks *Dam Watch*: reservoir area from NISAR, automatic anomaly alerts, level and volume estimates, and "what if" flood scenarios.

**Read first:** `docs/00_README.md` → 02 PRD → 05 App flow → 06 System design → 03 TRD → 04 UI/UX → 07 Analysis & validation. `docs/01_CONTEXT_AND_RESEARCH.md` is the source of truth for facts and sources. `docs/08_CLAUDE_CODE_BRIEF.md` is **superseded** where it says vanilla JS, `web/` or "keep three.js r128": the stack is the React/TS one in 03/04/06.

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

| M | Content | Lanes | Gate | Target |
|---|---|---|---|---|
| M1 | Repo skeleton, git, `.gitignore`, `config.yaml` (AOIs docs/03 §2), py3.11 venv, `pipeline/common`, contracts + codegen, **fixture bundle**, Vite scaffold with tokens, CI (typecheck + build + 1 smoke) | lead + Data + UI | builds; fixture validates | Sat 21:30 |
| M2 | **Run the reservoir series** (critical path: the main chart does not exist yet) + `01_terrain.py` | Data | Sci on numbers | Sat 23:30 |
| M3 | Intro port (parity) → dive → `/story/1`; Stage + Terrain shader + shots on real terrain | Scene | QA parity + ≤ 4 s | Sun 03:00 |
| M4 | `02_reservoir` lake polygon + chips; Acts 1–3, scrubber, swipe, badges | Data + UI + Scene | QA | Sun 06:00 |
| M5 | `03_anomaly` + Acts 5–6 (chart, alert card) | Data + UI | QA + Sci (B1–B3) | Sun 08:00 |
| M6 | `04_routing_hand` + Act 4 path + Act 7 slider and counters; ANUGA v21 on Colab in background | Model + UI + Scene | QA + Sci (D1–D5) | Sun 11:00 |
| M7 | ANUGA ingest, `06_impacts`, `07_level_volume` + Act 8 | Model + Data + UI | Sci (E, F, L) | Sun 13:00 |
| M8 | Act 9, Dam Watch drawer, Methods/Validation (07 §8 filled), Sources, 2D fallback, a11y pass | UI + Pitch | QA full + Sci full | Sun 14:30 |
| M9 | Deploy, private-window test, 30 s video from Tour, project page, deck | lead + Pitch | QA on public URL | **Sun 16:00** |

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

## 9. Design direction (user's references in `UI_REFERENCES/`)

The prototype stays the base look; these two references raise the bar:
- **(238) "Onboard Inference" telemetry rail → story cards, Dam Watch, impact counters.** Uppercase tracked mono labels; big mono numerals with a small unit ("21 Mm³", "−38 %"); status pills with a dot (= our badges); hairline dividers; thin progress bars; image pairs captioned INPUT | WATER MASK (= our radar chip + mask); an outlined honesty pill ("RESEARCH-BASED RECONSTRUCTION", "SCENARIO · NOT A FORECAST") with 2–3 lines of small source text; a wide-tracked title over the 3D view.
- **(239) Floating imagery in 3D → hero / explore state.** Real NISAR and Sentinel-1 chips float as tiles around the satellite; clicking one flies to that date's before/after swipe. Left column: title, short body, one primary call to action.
Components: `<Badge>` (dot pill), `<Stat>`, `<HonestyNote>` in `src/components/`. Real data only in the tiles (fixtures marked ILLUSTRATIVE until then).

## 10. Open decisions (ask the user; do not assume)

- Product name on screen: "Dancing with Dams" vs "HydroStress" (docs use HydroStress; the project is named Dancing with Dams).
- Hosting: Vercel (docs/02 §8) or GitHub Pages (docs/08). Either way the app stays static.
- Project `.npmrc` pointing at `registry.yarnpkg.com`.
