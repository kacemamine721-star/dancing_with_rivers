# Pitch: 7 minutes + 3 minutes Q&A

Targets: **Local Impact** first, then Best Use of Data and Best Storytelling. Live demo from the deployed app; slides from `submission/deck.md` as backup.

| Time | Section | What to say / show |
|---|---|---|
| 0:00–0:40 | Hook (slide 1) | "17 June, 21:15, Nebeur. A 72-year-old gate gives way. About 21 million m³ leave the lake (reported). Nobody outside the operator could watch it drain." |
| 0:40–1:30 | Problem (slide 2) | Public dam bulletins stopped in October 2025. Water under ~400 m³ per person per year. Upper Mellègue (195 Mm³) on the same river. Farmers in Jendouba and Bou Salem. |
| 1:30–3:30 | Live demo: story | Intro → dive → Act 1 dam → Act 2 the night (Sentinel-1 17 Jun 17:20 UTC) → Act 3 NISAR 19 Jun, scrub to July (−18% on D80) → Act 4 flow path 101 km → Act 5 chart with band (133 measurements). Point at a badge each time. |
| 3:30–4:30 | Detection (slide 4 / Act 6) | Alert card on 22 June. Say the key line exactly: "NISAR and Sentinel-1 together would have raised an alarm on 22 June, five days after the failure, with no ground sensor." Then: "NISAR's first flag is 26 June." |
| 4:30–5:30 | What if (Act 7) | Slider 21 → 195 Mm³; ANUGA chips. "Scenario, not a forecast." Front at the Medjerda confluence ≈ 13 h (13–19 h, mesh). 195 is hypothetical, at the old dam. |
| 5:30–6:20 | Honesty (slide 6) | SWOT −3.75 m, 12.7 Mm³ net storage loss (not the release). What failed and what we removed. |
| 6:20–7:00 | Next (slide 7) | Offline batch on 5–10 reservoirs, out-of-sample alert tests, then a live service. Close: "One lake today. Every dam tomorrow." |

## Q&A preparation (answers from our data)

- **"Did NISAR see the failure?"** No. First image 19 June. The "before" is Sentinel-1, 17 June 17:20 UTC.
- **"Why not Sentinel-1 alone?"** The 22 June alert came from Sentinel-1. NISAR adds four tracks (31 dates over Mellègue, a look every 2–7 days on its own), L-band, and independent confirmation (first NISAR flag 26 June).
- **"Is 21 Mm³ measured?"** No, reported (La Presse; one outlet 29). SWOT gives a 12.7 Mm³ storage loss from 7 to 28 June (7.8–17.1), net of inflow and only three weeks of a month-long release.
- **"False alarms?"** None in the 14 evaluations before the failure. From August to mid-November: 3 ALERT and 12 WARNING during real declines that we cannot classify without operator data. Thresholds were set on this event.
- **"How accurate is the flood map?"** Screening level: 30 m terrain, no channel depths, assumed 12 h release, no calibration data. Mesh test failed, so timing is a range.
- **"Why 195 Mm³?"** Size of the new Upper Mellègue reservoir; a hypothetical worst case released at the old dam.
- **"Can it run elsewhere?"** The methods are generic; v1 bundles one dam. Next step is an offline batch on other reservoirs with out-of-sample tests.
- **"AI use?"** Declared on the project page: AI assistants for code and text; all numbers from our pipeline; no AI-generated media; no NASA branding.
