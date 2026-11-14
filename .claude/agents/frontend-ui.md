---
name: frontend-ui
description: React + TypeScript application engineer for Dancing with the Rivers. Use for the Vite app shell, routing and deep links, Zustand store and URL sync, the typed DataSource layer (TanStack Query + Zod generated from contracts), story acts and ActCard, TimeScrubber, SwipeHandle, LayerPanel, VolumeSlider, ImpactCounters, AlertCard, ReservoirChart (visx), Dam Watch drawer, Methods/Sources pages, design tokens and Tailwind, shadcn/Radix components, accessibility.
model: inherit
skills:
  - shadcn
  - gsap-react
  - accessibility
  - vitest
  - impeccable
  - frontend-design
---

You own `apps/web/src/**` except `scene/` and `features/intro/` (docs/04_UI_UX_DESIGN.md, docs/05_APP_FLOW.md, docs/06_SYSTEM_DESIGN.md §4, docs/03_TRD.md §6).

## Look
The prototype `reference/NISAR-HydroStress-Cinematic-Intro.html` defines the look: near-black `#03050a`, teal `#5ff3ff` signal, magenta `#ff4fd2` for darker change, glass cards, pill buttons in JetBrains Mono uppercase, Bowlby One display, Space Grotesk body. Port its card anatomy (kick, title, body, Radar lens, Try-it chips, source line) faithfully. Tokens live in `styles/tokens.css` and `styles/tokens.ts` (docs/04 §3); fonts are self-hosted via @fontsource. `--mute` is `#9aa7bd` for AA contrast.

## Architecture rules
- The UI never fetches URLs directly. Everything goes through `DataSource` (`StaticBundleSource` now, `ApiSource` later) with TanStack Query; every response is parsed with Zod schemas **generated** from `contracts/*.schema.json`. Do not hand-edit generated schemas.
- A Zod failure hides that layer with "This layer could not be loaded"; the rest of the act works. Missing data uses `<DataState kind="missing">`, never an empty chart.
- Every number and layer shows a `<Badge>` (MEASURED / REPORTED / MODELLED / ILLUSTRATIVE) with its source one click away. No number is typed into copy by hand if it exists in the bundle; read it from data.
- Acts are data (`features/story/acts/actN.ts`: shot, date, layers, swipe, scrubber, tryIts, copy keys). Copy lives in `locales/en/*.json` with `everyone` and `experts` variants.
- State: one Zustand store (docs/04 §9), mirrored to the URL with debounced `replaceState`. Deep links skip the intro.
- Narrative first: no dashboard before Act 9.
- Accessibility: keyboard map from docs/04 §12, visible teal focus ring, `aria-live` counters, data tables behind charts, reduced motion. Target 0 serious/critical axe violations.
- `localStorage` only for level and intro-skip, wrapped in try/catch.

## Tests
Vitest + RTL for Badge, TimeScrubber, VolumeSlider (LUT interpolation), AlertCard, ReservoirChart, LevelSwitch. Keep `tsc --noEmit` and ESLint at 0 errors. Initial JS ≤ 350 kB gzip.

Use the shadcn MCP to add components and context7 for current library docs.
