# 04 · UI/UX Design Document

HydroStress is built as a **production frontend application** (React + TypeScript + Vite, with three.js through React Three Fiber). The visual language comes from the existing prototype `NISAR-HydroStress-Cinematic-Intro.html`. Its look, motion and content are **ported into a typed component system**; the single HTML file is a reference, not the codebase.

This document defines the experience, the design system (tokens → Tailwind theme → components), each component's implementation, the 3D scene's art direction and architecture, motion, accessibility, internationalisation and UI quality gates. The full engineering stack is in → 03 §6 and → 06 §4.

---

## 1. Experience principles

1. **Story first, tool last.** The user is *taken* through the event like a documentary; the Dam Watch tool unlocks only at the end (Act 9). No dashboard on arrival.
2. **One stage, many layers.** A single persistent 3D scene (the "stage", one `<Canvas>` that never unmounts) stays on screen. Narrative cards change *what the stage shows* (camera shot, date, layers). The user never loses spatial context.
3. **Show, then explain, then let them try.** Each act: cinematic shot → plain-language card → a "Try it" control (swipe, slider, scrubber).
4. **Every pixel is honest.** Badges on every layer and number; sources one click away; uncertainty drawn, not hidden.
5. **Two depths.** *Everyone* (default) and *Experts* (dB values, thresholds, product IDs, equations). One switch, everywhere.
6. **Calm under tension.** Dark cinematic palette, slow camera, no sirens; urgency comes from the data (counters, arrival times), not from effects.
7. **Deep-linkable.** Every act, date, scenario and dam has a URL, so a judge, journalist or manager can share an exact view.

## 2. UI technology stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **React 18 + TypeScript (strict)** | Component model, typing of data contracts, ecosystem |
| Build | **Vite 5** | Fast dev server, code-splitting, asset hashing |
| Routing | **React Router 6** (data routers) | Deep links per act, dam and scenario; lazy routes |
| 3D | **three.js (current release) + @react-three/fiber + @react-three/drei** | Declarative scene graph, hooks, helpers (CameraControls, Html labels, useTexture, PerformanceMonitor, AdaptiveDpr) |
| Post-processing | **@react-three/postprocessing** | Vignette, film grain, bloom on the NISAR beam, replacing the prototype's CSS overlays where possible |
| Camera & timeline motion | **GSAP 3** (core + ScrollTrigger) | Camera spline flights, scroll-scrubbed acts, the cinematic intro timeline |
| UI motion | **Framer Motion** | Card enter/exit, drawers, count-up, layout transitions |
| Styling | **Tailwind CSS** with design tokens as CSS variables (§3) | Consistent tokens, responsive utilities, small CSS |
| Accessible primitives | **Radix UI** (via **shadcn/ui** source components) | Slider, Dialog, Popover, Tooltip, Switch, Tabs, Toast, ScrollArea with correct ARIA and keyboard behaviour |
| Icons | **lucide-react** | Consistent line icons (alert, layers, info, play…) |
| Charts | **visx** (D3 scales + React SVG) | Fully custom, accessible SVG charts in the HydroStress style |
| State | **Zustand** (+ URL sync) | One small global store (§9), readable from inside and outside the Canvas |
| Data loading | **TanStack Query** + **Zod** | Cached, retried loading of the data bundle; runtime validation of every JSON against the contracts in → 06 §3 |
| i18n | **i18next + react-i18next** | Story text in Everyone/Experts × EN (FR/AR later, with RTL) |
| Speech | Web Speech API (`speechSynthesis`) in a `useReadAloud` hook | Read aloud, as in the prototype |
| Offline & demo safety | **vite-plugin-pwa** (Workbox) | Precaches the app shell + Acts 1–3 data, so the pitch survives bad Wi-Fi |
| Quality | Vitest + React Testing Library, Playwright, axe-core, Storybook, Lighthouse CI (§12) | Production-grade UI checks |

## 3. Design system

### 3.1 Tokens (single source: `src/styles/tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#03050a` | Page and space background |
| `--ink` | `#e9f1ff` | Primary text |
| `--mute` | `#9aa7bd` (raised from the prototype's `#8b98ad` for AA contrast) | Secondary text, axis labels |
| `--teal` | `#5ff3ff` | NISAR signal, primary accent, focus ring, "became brighter" |
| `--teal-dim` | `rgba(95,243,255,.18)` | Borders, inactive controls |
| `--mag` | `#ff4fd2` | "Became darker", anomaly highlights |
| `--water` | `#2f8fff` | Water masks, reservoir |
| `--flood-1…4` | `#9be7ff`, `#2f8fff`, `#1b3a9e`, `#120b4a` | Flood depth 0.1 → 5+ m (monotonic lightness) |
| `--alert` | `#ffb547` | WARNING |
| `--danger` | `#ff5a5a` | ALERT (sparingly) |
| `--ok` | `#6dffa8` | Validation passed |
| `--model` | `#b38cff` | MODELLED badge |
| `--glass-bg` | `rgba(8,14,24,.72)` | Cards, panels |
| `--glass-blur` | `14px` | Backdrop blur |
| `--radius-card` / `--radius-pill` | `14px` / `999px` | — |
| `--ease-cine` | `cubic-bezier(.65,0,.35,1)` | Camera and act transitions |
| `--dur-ui` / `--dur-cam` | `200ms` / `900ms` (600–1200 by shot) | — |

**Fonts** (self-hosted via `@fontsource`, no Google Fonts runtime request): **Bowlby One** (display: act titles, big numbers), **Space Grotesk** (text: body, buttons), **JetBrains Mono** (data: HUD, coordinates, dB, dates, counters). Spacing uses the Tailwind 4-pt scale.

### 3.2 Tailwind theme mapping
`tailwind.config.ts` maps tokens to utilities (`bg-bg`, `text-ink`, `text-mute`, `border-teal-dim`, `text-teal`, `bg-water`, `font-display`, `font-mono`, `rounded-card`, `ease-cine`) and adds a `glass` component class:
```css
.glass { background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--teal-dim); border-radius: var(--radius-card); }
```
The same tokens are exported as a typed TS object (`src/styles/tokens.ts`) for shaders, charts and the canvas, so 3D colours match the UI exactly.

### 3.3 Colour rules
- **Change maps:** teal = became brighter (wetter or rougher), magenta = became darker (water appeared, or the surface dried and smoothed). Always show the legend chip.
- **Flood ramp:** monotonic in lightness, so it reads in greyscale and for colour-blind users.
- **Alerts:** colour is always paired with an icon and a word.

## 4. Application shell & routes

| Route | Screen | Lazy chunk |
|---|---|---|
| `/` | Loader → cinematic intro → hero | `intro` |
| `/story/:act` (`1`–`9`) with query `?date=2026-06-19&layers=radar,mask&swipe=0.5&v=21&mode=hand&lvl=experts` | Narrative journey on the persistent stage | `story` + per-act data |
| `/watch` and `/watch/:damId` | Dam Watch tool (drawer over the stage) | `watch` |
| `/methods` | Methods & validation (→ 07 §8) | `docs` |
| `/sources` | Sources & data credits | `docs` |
| `/school` | Radar School (Radar Lab, three surfaces, quiz) | `school` |
| `*` | 404 → back to the story | — |

**Shell components:** `<AppShell>` (providers: Query, i18n, Store, Toaster), `<Stage>` (persistent R3F Canvas, mounted once under the shell so it survives route changes), `<TopBar>`, `<ActRail>`, `<Overlays>` (letterbox, captions, HUD).

## 5. Layout

### 5.1 Desktop (≥ 1100 px): sticky stage + scrolling cards
```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar  [logo HydroStress] Act 3/9 ───progress───  Everyone|Experts  │
│         🔊  Read aloud  Lab  Tour  Glossary  ⓘ Sources  ☰            │
├───────────────┬──────────────────────────────────────────────────────┤
│ StoryColumn   │ Stage (62%, sticky)                                   │
│ (38%)         │  3D terrain + layers                 ┌──────────────┐ │
│ ┌───────────┐ │                                      │ LayerPanel   │ │
│ │ kick      │ │                                      │ ☑ Radar      │ │
│ │ TITLE     │ │                                      │ ☐ Flood      │ │
│ │ body      │ │        ╭─ SwipeHandle ─╮             └──────────────┘ │
│ │ RadarLens │ │                                                      │
│ │ TryIt     │ │  Hud: 36.31°N 8.70°E · NISAR L-band HH · 19 JUN 2026 │
│ │ Badge·Src │ │  ──────────────── TimeScrubber ───────────────────── │
│ └───────────┘ │  ▲17 Jun fail  ▲21 Jun Sidi Salem  ▲16 Jul repaired  │
└───────────────┴──────────────────────────────────────────────────────┘
 ActRail (left edge): ● ● ◉ ○ ○ ○ ○ ○ ○
```
Implemented with CSS grid (`grid-cols-[38%_62%]`); the stage is `position: sticky; top: var(--topbar-h)`.

### 5.2 Tablet (700–1099 px)
Stage on top (60 vh, sticky); cards scroll below and overlap the stage bottom by 40 px.

### 5.3 Mobile (< 700 px)
- Stage full-screen behind; cards in a **bottom sheet** (`vaul` drawer, or Radix Dialog with drag) at 35% height, draggable to 80%.
- The swipe becomes a segmented toggle "Before | After"; terrain uses 256² segments; post-processing grain is off.
- The TopBar collapses to the logo, act counter and a ☰ menu (Levels, Lab, Tour, Glossary, Sources, Sound).

Breakpoints come from Tailwind (`md: 700px`, `lg: 1100px`, custom in the config). A `useBreakpoint()` hook gives the same values to the 3D quality settings.

## 6. Component library

Folder: `src/components/` (UI) and `src/scene/` (3D). Every UI component has a Storybook story and a unit test. Props are typed against the Zod-inferred data types.

### 6.1 Ported from the prototype

| Prototype element | React component | Built with | Notes |
|---|---|---|---|
| `#loader` "ACQUIRING SIGNAL" | `<Loader progress>` | Framer Motion | Driven by drei `useProgress` + TanStack Query prefetch |
| `.bars`, `.vignette`, `.grain` | `<Letterbox>`, plus postprocessing `Vignette` and `Noise` | CSS + postprocessing | The grain moves into the WebGL pass and is disabled under reduced motion |
| Cinematic chapters (Approach, Deploy, Orbit, Scan) | `<IntroSequence>` | GSAP timeline + R3F | Same timings (0 / 3.4 / 6.8 / 9.2 s; hero at 11.2 s) |
| Satellite model & hotspots | `<NisarSatellite>`, `<Hotspot>` | R3F + drei `Html` | Port of the procedural geometry; facts in a Radix Popover |
| `.cap` captions | `<Caption>` | Framer Motion | Queue with timings; `aria-live="polite"` |
| `.hud` | `<Hud>` | Tailwind, mono font | Typed-out text effect (Framer) |
| `.btn`, `.btn.primary` | `<Button variant>` | shadcn Button | Variants: primary, ghost, chip |
| `.card`, `.kick`, `.lens`, `.tries`, `.src` | `<ActCard>` composed of `<Kick>`, `<RadarLens>`, `<TryIt>`, `<SourceLine>` | Tailwind `glass` | Content from i18n keys (§11) |
| `.gloss` | `<GlossaryTerm term>` | Radix Tooltip/Popover | Definitions from `glossary.json` |
| Everyone/Experts switch | `<LevelSwitch>` | Radix ToggleGroup | Store + URL `lvl=`; persisted with a try/catch `localStorage` |
| `.rail` | `<ActRail>` | Radix NavigationMenu semantics | Completed acts filled |
| Tour | `<TourController>` | GSAP timeline over store actions | Script in → 05 §6 |
| Radar Lab | `<RadarLab preset>` | Radix Dialog + own R3F mini-canvas | Presets: water, soil, crops, city, reeds |
| `.toast` | `<Toaster>` | shadcn/Radix Toast | — |
| Read aloud | `useReadAloud()` + `<ReadAloudButton>` | Web Speech API | Reads the current card at the current level |

### 6.2 New components

**A. `<Badge kind>`** — `measured | reported | modelled | illustrative`

| Variant | Style | Meaning |
|---|---|---|
| `measured` | teal outline | Directly from a satellite product |
| `reported` | white outline | Official or press report (source linked) |
| `modelled` | `--model` violet outline | Output of our models (HAND, ANUGA, estimates) |
| `illustrative` | grey dashed | Simulated or artistic, not data |

Focus/hover → Radix Popover with dataset, date, product ID (Experts), method and uncertainty, read from the manifest entry.

**B. `<TimeScrubber>`** — horizontal track 17 Jun → 31 Oct under the stage.
- Built on Radix Slider (custom thumb, snapping to acquisition dates); dots: filled teal = NISAR, white ring = Sentinel-1, violet = SWOT; event flags ▲; the gap 25 Jul–13 Aug is hatched.
- Keys: ←/→ previous/next acquisition, Home/End, Space plays at 1 date/s.
- `aria-valuetext="19 June 2026, NISAR track D80, HH"`.

**C. `<SwipeHandle>`** — a draggable vertical handle on the stage that sets the `uSwipe` shader uniform. Labels at the top of each side ("17 JUN · Sentinel-1 · before", "1 JUL · NISAR · after"). Focusable; ←/→ move by 5%.

**D. `<LayerPanel>`** — floating top-right; Radix Switches for: Optical basemap · Radar (HH/HV/RGB via ToggleGroup) · Water mask · Change · Flow path · Flood (HAND/ANUGA) · Villages & roads · Cropland. Each row has a mini legend and a badge.

**E. `<ReservoirChart>`** (visx) — area (km²) vs date; NISAR points with one shape per track, Sentinel-1 rings, event rules, the post-failure segment in magenta, an uncertainty band (A5 noise floor). Tooltip: date, area, sensor, track, confidence. Click → `setDate`. A hidden accessible `<table>` mirrors the data. Experts mode: threshold and pixel counts.

**F. `<AlertCard alert>`** (Act 6 and Dam Watch)
```
┌──────────────────────────────────────────┐
│ ⚠ ALERT · MELLÈGUE · 19 JUN 2026         │
│ Lake area −38% in 2 days                  │
│ Normal summer change: −0.6%               │
│ Score z = −7.4  (threshold −3)            │
│ [View images]  [Why?]   MEASURED          │
└──────────────────────────────────────────┘
```
(Numbers illustrative until the pipeline runs.) It enters with one pulse ring (Framer) and is announced once with `role="alert"`.

**G. `<VolumeSlider>`** (Act 7) — Radix Slider on a custom piecewise-log scale, 0–200 Mm³; ticks 5, 10, **21 (June 2026)**, 50, 100, **195 (Upper Mellègue full)**.
- `<ModeToggle>`: **Quick estimate (HAND, continuous)** | **Physics (ANUGA, snaps to scenarios)**; scenarios that aren't computed are disabled with the tooltip "Not computed yet".
- Duration chips 6 h / 12 h / 24 h (Physics mode, when available).
- Readout with a relatable comparison (e.g. Olympic pools at 2,500 m³ each, or days of national use); check the figure before shipping.
- Updates are throttled with `requestAnimationFrame` (store → shader uniform) so dragging stays at 60 fps.

**H. `<ImpactCounters>`** — four tiles: 🌾 Cropland ha · 🏠 Built-up ha · 📍 Villages · 🛣 Roads km; Framer count-up (instant under reduced motion); MODELLED badge with the scenario name; `aria-live="polite"`.

**I. `<ArrivalTimeline>`** (Physics mode) — villages sorted by arrival time ("Nebeur · +0 h 40 · max 1.8 m"); click → `camera.flyTo(village)`.

**J. `<LevelVolumeCard>`** (Act 8) — three panels (SWOT level, DEM-shoreline level, ΔVolume), each `value ± band` with a method line and a badge; "How we test this" → `/methods#level`.

**K. `<DamWatchDrawer>`** (Act 9, `/watch`) — a right-side Radix Dialog (non-modal sheet) over the stage: reservoir list with status pills (Normal / Warning / Alert) → reservoir view: sparkline (visx), last observation, next expected NISAR pass, buttons [Flood scenarios] [Download CSV / GeoJSON] [Add a dam].

**L. `<ErrorBoundary>` / `<DataState>`** — wraps every data-driven component: skeleton (loading), retry (error), explanation (missing, e.g. "SWOT has not observed this lake on these dates").

## 7. 3D scene

### 7.1 Scene architecture (`src/scene/`)
```
<Canvas dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
  <PerformanceMonitor onDecline={lowerQuality} />  <AdaptiveDpr pixelated />
  <CameraRig />                 // drei CameraControls + GSAP shot tweens + spline follow
  <Lighting night={act===2} />  // sun + hemisphere, retuned for physically based lights
  <Suspense fallback={null}>
    <Terrain />                 // heightmap PlaneGeometry + custom ShaderMaterial (drape, swipe, HAND, flood)
    <WaterSurface />            // mask-driven shimmer
    <FlowPath />                // animated dashed tube along flowpath.geojson
    <Villages />  <DamMarker /> // instanced pins + drei <Html> labels
    <NisarBeam />               // swath sweep in transitions
  </Suspense>
  <Effects />                   // postprocessing: Vignette, Noise, Bloom (beam only)
</Canvas>
```
- **Terrain shader** uniforms: `uHeight` (RG16), `uBase`, `uRadarA`, `uRadarB`, `uMaskA`, `uChange`, `uHand`, `uHandH`, `uDepth`, `uSwipe`, `uOpacity` (vec4), `uLakeChipRect` (10 m lake chips inside the 30 m scene UV), `uNight`, `uExag`. GLSL lives in `src/scene/shaders/*.glsl`, imported with `vite-plugin-glsl`.
- **Textures** are loaded with drei `useTexture` (P2: KTX2/Basis via `useKTX2` for smaller GPU memory). Unused date textures are disposed when an act changes.
- **Heavy decoding** (heightmap → Float32 normals, HAND LUT interpolation) runs in a Web Worker (Comlink) off the main thread.
- **Porting note (r128 → current three.js):** the prototype used `outputEncoding`, legacy lights and global `THREE`. In current versions colour management uses `outputColorSpace = SRGBColorSpace` and lights are physically based, so **light intensities and material colours must be retuned** to match the prototype's look. Compare screenshots side by side.

### 7.2 Art direction

| Element | Look |
|---|---|
| Terrain | Real relief, vertical exaggeration **×2.5** (Everyone) or ×1 (Experts); soft hillshade from a low NW sun; a faint teal contour every 100 m |
| Basemap | Desaturated optical (Sentinel-2 summer composite) so radar and water stand out |
| Radar drape | Greyscale HH (−25 → 0 dB) with a gentle teal tint during the "scan" reveal |
| Water | `--water` with a slight fresnel shimmer; anti-aliased mask edges |
| Flow path | Animated dashed teal line flowing downstream (speed ∝ scenario); distance labels every 10 km |
| Flood | Depth ramp; ANUGA frames animated in time; soft glow at the wet front |
| Dam | Extruded marker at the crest, label "Mellègue dam · 1954"; gate icon turns red during Act 2 |
| Villages | Instanced pins with JetBrains Mono labels; highlighted when reached |
| Sky | Dark gradient with haze for depth; night scene in Act 2 (moonlight, darker terrain) |
| NISAR pass | A thin swath beam sweeping the terrain in transitions (bloom) |

**Camera shots** (`src/scene/shots.ts`, typed, each with position, target, fov, duration and ease; → 05 §3): `arrival`, `dam_close`, `night_dam`, `lake_top`, `valley_follow` (CatmullRom spline on the flow path), `jendouba_wide`, `sidi_salem`, `scenario_overview`, `catchment_wide`.

### 7.3 Quality tiers
| Tier | Trigger | Terrain segments | DPR | Post-processing |
|---|---|---|---|---|
| High | Desktop, GPU OK | 512² | up to 2 | Vignette + Noise + Bloom |
| Medium | PerformanceMonitor decline or tablet | 384² | 1.5 | Vignette only |
| Low | Mobile or < 30 fps for 3 s | 256² | 1 | Off |
| 2D fallback | No WebGL2/WebGL | — | — | Static PNG chips + chart |

## 8. Motion system

- **Camera:** GSAP tweens between shots with `--ease-cine`; `valley_follow` scrubbed by ScrollTrigger so scrolling moves the camera down the river.
- **Acts:** an IntersectionObserver-based `useActInView()` (or ScrollTrigger) sets `act` in the store → `<CameraRig>` and `<Terrain>` react.
- **UI:** Framer Motion variants (`fadeUp`, `slideIn`, `pulse`) shared from `src/motion/variants.ts`.
- **Reduced motion:** a `useReducedMotion()` hook (Framer) → camera cuts with a 300 ms crossfade, no grain, no count-up, no pulse, no auto-play.
- **Intro:** a GSAP master timeline reproduces the prototype's chapter timings; "Skip intro" seeks to the end.

## 9. State model (Zustand, URL-synced)

```ts
type AppState = {
  mode: 'intro' | 'story' | 'watch';
  act: 1|2|3|4|5|6|7|8|9;
  level: 'everyone' | 'experts';
  date: string;                       // ISO acquisition date
  layers: Record<LayerId, boolean>;
  pol: 'HH' | 'HV' | 'RGB';
  swipe: number;                      // 0..1
  flood: { mode: 'hand' | 'anuga'; volumeM3: number; durationH: 6|12|24; scenarioId?: string };
  damId: string;
  quality: 'high' | 'medium' | 'low' | '2d';
  reducedMotion: boolean;
};
```
A `useUrlSync()` hook mirrors `act`, `date`, `layers`, `swipe`, `flood`, `level` and `damId` to the URL (debounced `replaceState`), so every view is shareable. Inside the Canvas, components read the store with selectors (`useStore(s => s.swipe)`) to avoid re-rendering the whole scene.

## 10. Content & tone

- Plain, short sentences; one idea per card; ≤ 70 words in Everyone, ≤ 140 in Experts.
- Use **people and places** (Nebeur, Jendouba, Bou Salem, Sidi Salem) rather than abstractions.
- Never sensational; never blame; facts with sources and uncertainty.
- Units: km², ha, million m³ (Mm³), m, hours; dates "19 Jun 2026"; local time (UTC+1), with UTC in Experts. Formatting goes through `Intl.NumberFormat` / `Intl.DateTimeFormat` per locale.

## 11. Internationalisation

- All copy lives in `src/locales/<lang>/{common,acts,glossary}.json`, with keys like `acts.3.title`, `acts.3.body.everyone`, `acts.3.body.experts`. Nothing is hard-coded in components.
- Languages: **English** (submission); P2: French and Arabic. Arabic switches `dir="rtl"` on `<html>`, and Tailwind logical properties (`ps-`, `pe-`, `start-`, `end-`) keep layouts correct.
- Read aloud uses the voice matching the current locale.

## 12. Accessibility (WCAG 2.2 AA target)

- Every interactive control is reachable by Tab, with a visible teal focus ring (2 px + 2 px offset, `focus-visible`). Radix primitives provide the ARIA roles.
- Keyboard map (one `useHotkeys` registry, listed in a `?` help dialog): ←/→ previous/next act, `[`/`]` scrubber, `S` focus swipe, `L` Lab, `G` glossary, `Esc` closes overlays or skips the intro.
- Screen readers: each act is a `<section aria-labelledby>`; the stage has `role="img"` with a live `aria-label` from `describeView(state)` (e.g. "3D view of the Mellègue reservoir on 1 July 2026: the lake is split into fragments"); charts have data-table equivalents.
- `prefers-reduced-motion` honoured (§8). Colour is never the only carrier.
- Contrast ≥ 4.5:1 for text on glass, checked automatically (axe) and on screenshots.

## 13. States

| State | Design |
|---|---|
| Loading data for an act | Thin teal progress line under the TopBar + toast "Downloading 19 Jun radar…"; the stage keeps the previous view (Suspense with a persistent fallback) |
| Data missing | `<DataState kind="missing">` explains why (e.g. "Not observed by SWOT on these dates"); never an empty chart |
| Data invalid (Zod fails) | Logged (Sentry, optional) and the layer hidden with "This layer could not be loaded"; the rest of the act works |
| Network error | Retry button; the PWA cache serves precached acts offline |
| WebGL unavailable | 2D fallback route content (chips + chart + flood PNGs) with the banner "3D not supported, showing 2D" |
| Slow device | Quality tier drops automatically (§7.3) |
| 404 / unknown dam | Friendly page → "Back to the story" |

## 14. UI quality gates (CI)

| Gate | Tool | Threshold |
|---|---|---|
| Types & lint | `tsc --noEmit`, ESLint (react, hooks, jsx-a11y), Prettier | 0 errors |
| Unit / component | Vitest + React Testing Library | Key components covered: Badge, TimeScrubber, VolumeSlider (LUT interpolation), AlertCard, ReservoirChart, LevelSwitch |
| Visual catalogue | Storybook (+ optional Chromatic) | Every component has a story in each state (loading, missing, error, Everyone, Experts) |
| End-to-end | Playwright | Intro → Start the mission → Act 1 in ≤ 4 s; deep link `/story/3?date=2026-07-01` renders the right image; slider updates counters; keyboard-only walkthrough |
| Accessibility | axe-core in Playwright | 0 serious/critical violations |
| Performance | Lighthouse CI | Performance ≥ 70 (WebGL page), Accessibility ≥ 95, Best Practices ≥ 95 |
| Bundle size | `rollup-plugin-visualizer` + budget check | Initial JS ≤ 350 kB gzip (three.js in its own chunk); initial data ≤ 15 MB |