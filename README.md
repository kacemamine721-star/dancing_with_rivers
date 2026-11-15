# Dancing with the Rivers

NASA Space Apps Challenge 2026 (Tunis), challenge *Dancing with SARs*.

On the night of 17 June 2026 a 72-year-old gate failed at Tunisia's Mellègue dam, and about 21 million m³ of water was released (reported). **HydroStress**, our web app, replays that night and the month after it in 3D from real radar data. It explains each radar signal in plain language, then opens **Dam Watch**: lake area from NISAR and Sentinel-1, automatic alerts, SWOT level change and labelled "what if" flood scenarios.

- **Live app:** https://&lt;project&gt;.pages.dev *(Cloudflare Pages; to fill after deploy, see `docs/DEPLOY.md`)*
- **Project page text:** `submission/project_page.md`
- **Facts and sources:** `docs/01_CONTEXT_AND_RESEARCH.md`; validation table: `docs/07_ANALYSIS_AND_VALIDATION.md` §8

Every layer and number in the app carries a badge (MEASURED, REPORTED, MODELLED or ILLUSTRATIVE) and a source. Flood results are scenarios, not forecasts.

## Run the app

The app is static. It reads only the versioned data bundle in `apps/web/public/data/2026-11-15/`. No keys, no live API calls.

**Docker (simplest):**

```bash
docker compose up --build web
# open http://localhost:5173
```

**Development server** (Node 22+ and pnpm 9):

```bash
cd apps/web
pnpm install --frozen-lockfile
pnpm dev          # Vite dev server
pnpm typecheck && pnpm test && pnpm build
```

If `registry.npmjs.org` is slow on your network, add `--registry=https://registry.yarnpkg.com` to `pnpm install`.

Dev tips: `/?intro=1` replays the intro after "Skip intro"; `/?t=9.2` freezes the intro at 9.2 s; `/?dive=2` freezes the dive.

## Rebuild the data (optional)

The pipeline is Python 3.11 in a virtual environment. Every script starts with the PROJ guard and writes to the bundle.

```bash
py -3.11 -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # Windows path; use .venv/bin/ on Linux/macOS
```

Run order:

| Step | Script | Output |
|---|---|---|
| 1 | `pipeline/00_context_data.py` | OSM, HydroSHEDS, JRC GSW, WorldCover, WorldPop, boundaries |
| 2 | `pipeline/00b_irrigation.py` | Irrigated cropland, summer 2026 |
| 3 | `pipeline/01_terrain.py` | NASADEM terrain, basemap, hillshade |
| 4 | `pipeline/01b_gem15.py` | GEM-15 15 m valley terrain |
| 5 | `pipeline/02a_reservoir_series.py` | NISAR + Sentinel-1 download (cached) |
| 6 | `pipeline/02_reservoir.py` | Lake polygon, water masks, area series, radar chips |
| 7 | `pipeline/03_anomaly.py` | Alert rule and its tests |
| 8 | `pipeline/04_routing_hand.py` | Flow path, HAND, volume lookup table |
| 9 | `pipeline/05_anuga_scenarios.py` | ANUGA flood scenarios (Docker image `dwd-anuga:1`) |
| 10 | `pipeline/06_impacts.py` | Exposure per scenario |
| 11 | `pipeline/07_level_volume.py` | SWOT level and storage change |
| 12 | `pipeline/08b_validation.py` | Validation file |
| 13 | `pipeline/08_bundle.py --validate` | Manifest; checks every file against the contracts |

ANUGA example:

```bash
docker run --rm -v "$PWD:/work" -w /work dwd-anuga:1 python pipeline/05_anuga_scenarios.py --help
```

NISAR downloads need a NASA Earthdata token in the environment variable `EARTHDATA_TOKEN` (or a gitignored `.env`). Never commit it.

## Repository layout

```
apps/web/        React + TypeScript app (Vite, three.js / React Three Fiber)
pipeline/        Python pipeline, 00 → 08
contracts/       JSON Schemas generated from pipeline/common/contracts.py
docs/            Specifications, research, validation
submission/      Project page, video script, deck, pitch
docker/          Web (nginx) and ANUGA images
```

## Data credits

- **NISAR** L2 GCOV: NASA/JPL–ISRO, via ASF DAAC.
- **SWOT** L2 HR LakeSP: NASA/CNES, via PO.DAAC Hydrocron.
- **NASADEM**: NASA JPL, via Microsoft Planetary Computer.
- **LGRIP30 v001**: NASA MEaSUREs / USGS, LP DAAC (used as a check).
- **Sentinel-1 RTC and Sentinel-2 L2A**: Contains modified Copernicus Sentinel data 2026, via Microsoft Planetary Computer.
- **ESA WorldCover** 2021 v200: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.
- **GEM-15**: This dataset is produced by Google (experimental, CC BY 4.0). Batchu et al. 2026, doi:10.31223/X55N75.
- **HydroRIVERS / HydroBASINS**: © HydroSHEDS (Lehner & Grill 2013).
- **JRC Global Surface Water**: Source: EC JRC/Google (Pekel et al. 2016).
- **OpenStreetMap**: © OpenStreetMap contributors (ODbL).
- **WorldPop** 2020 constrained, CC BY 4.0.
- **geoBoundaries** gbOpen (Runfola et al. 2020).
- **ANUGA** (Geoscience Australia / ANU, GPL).
- Press sources for the event: `apps/web/public/data/2026-11-15/story/sources.json` and the app's Sources page.

No NASA logos or branding are used. NASA data is credited in text.

## Use of AI

This project was built with AI coding and writing assistants. Which tools, where they were used, and how numbers were kept to our own data: see the AI-use declaration in `submission/project_page.md`.

## Licence

TBD (team decision).
