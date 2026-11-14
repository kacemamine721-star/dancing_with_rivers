# Dancing with Dams — Project Documentation Index

> **NASA Space Apps Challenge 2026 · Tunis local event**
> Challenge: *"Dancing with SARs"*, an interactive application that uses **NASA–ISRO NISAR** radar data to track and visualize surface change.
> Team deadline: **Sunday 15 Nov 2026, 16:30 (local submission)** · pitch 17:00 · final "Submit for Judging" 23:59.

## One-sentence pitch

**On the night of 17–18 June 2026, a 72-year-old gate failed at Tunisia's Mellègue dam and about 21 million m³ of water escaped. NISAR watched the lake drain through the following weeks. HydroStress replays that night in 3D from real radar data, then turns it into *Dam Watch*: an open tool that monitors any reservoir from space every 6–12 days, raises an alert when a lake drops abnormally, and simulates where the water would go and who it would reach.**

## How to use these documents (for Claude Code and the team)

Read them in this order. Each one is self-contained, and they cross-reference each other with `→ DOC §section`.

| # | File | What it answers | Read it when |
|---|---|---|---|
| 01 | `01_CONTEXT_AND_RESEARCH.md` | The challenge, judging rules, NISAR science, all data findings, the Mellègue event timeline, decisions and why | First: the shared truth |
| 02 | `02_PRD.md` | What we build, for whom, the features and priorities (P0/P1/P2), acceptance criteria | Before writing any code |
| 03 | `03_TRD.md` | Data sources, processing pipelines, algorithms (water mask, anomaly, level/volume, HAND, ANUGA), web tech stack, budgets | When implementing |
| 04 | `04_UI_UX_DESIGN.md` | UI stack (React, R3F, Tailwind, Radix/shadcn, GSAP, visx), design tokens, component library, 3D scene, motion, state, i18n, accessibility, UI quality gates | When building screens |
| 05 | `05_APP_FLOW.md` | Screen-by-screen flow from loader → cinematic → **Start the mission → 3D Mellègue** → the 9 narrative acts → Dam Watch | When wiring the app |
| 06 | `06_SYSTEM_DESIGN.md` | Architecture (v1 static SPA + v2 production roadmap), monorepo layout, data contracts, frontend architecture, CI/CD, task plan, risks | When structuring the repo |
| 07 | `07_ANALYSIS_AND_VALIDATION.md` | Step-by-step analysis recipes and **how to test water area, level, volume change, the anomaly detector and the flood model** | When producing and checking results |
| 08 | `08_CLAUDE_CODE_BRIEF.md` | The kick-off prompt and build order for Claude Code: what to build first, constraints, definition of done | Paste it into Claude Code to start |

## Existing assets

| Asset | Status | Role |
|---|---|---|
| `NISAR-HydroStress-Cinematic-Intro.html` | ✅ Prototype (three.js r128, single file) | **Reference only.** Its look, timings and content are ported into the production React + TypeScript app (→ 04, → 06 §2), where **"Start the mission →" dives into 3D Mellègue** (→ 05 §2) |
| `scripts/nisar_tunisia_inventory.py` | ✅ Run | ASF inventory of NISAR over Tunisia |
| `scripts/nisar_tunisia_all_platforms.py` | ✅ Run | ASF + CMR + Worldview/GIBS + Bhoonidhi + Planetary Computer + Earth Engine check |
| `scripts/mellegue_test.py` | ✅ Run | Go/no-go test: NISAR GCOV + SME2 + Sentinel-1 + WorldCover over Mellègue |
| `scripts/mellegue_reservoir.py` | ⏳ To run | Reservoir water-area time series (all NISAR dates + Sentinel-1) → the main chart |
| `scripts/requirements.txt` | ✅ | Python dependencies |

## Non-negotiable principles

1. **Narrative first, dashboard last.** The user is told a story that explains the solution; the Dam Watch tool is "unlocked" at the end (→ 05).
2. **Real data, honestly labelled.** Every visual carries a badge: **MEASURED** (satellite), **REPORTED** (official/press), **MODELLED** (simulation), **ILLUSTRATIVE** (teaching sketch) (→ 04 §4.2-A).
3. **One site, done completely.** Mellègue → Medjerda → Sidi Salem. Other dams are shown only as proof that the method generalizes.
4. **NISAR at the core.** NISAR provides the observations; other sensors (Sentinel-1, SWOT, DEM, land cover) provide context and validation (→ 01 §4).
5. **Ship by 16:30 Sunday.** Priorities P0 → P1 → P2 in → 02 §7 and → 06 §6.