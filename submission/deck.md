# Deck: 7 slides (title included)

Visual style: dark, like the app (mono labels, big numerals with a small unit, badge pills). Use screenshots of the real app and real radar chips only. No NASA logos or branding. Any AI-generated image must carry a visible "AI-generated" watermark (none planned).

---

## Slide 1 · Title

**Dancing with the Rivers**
Dancing with the Rivers · Dam Watch from space
NASA Space Apps 2026 · Tunis · *Dancing with SARs*
Background: the 3D Mellègue valley from the app.

**Notes:** "On the night of 17 June, a gate failed at a dam in Nebeur, northwest Tunisia. We rebuilt that night, and the month after it, from real satellite radar."

---

## Slide 2 · The problem

- 17 Jun 2026, ~21:15: a gate fails at the Mellègue dam (built 1954) during a planned 100,000 m³ irrigation release. `REPORTED`
- About **21 Mm³** released (one outlet says 29). `REPORTED`
- Water reaches Sidi Salem on 21 June. Gate repaired 16 July. `REPORTED`
- Daily public dam bulletins stopped in **October 2025**. Water: **under ~400 m³ per person per year**. `REPORTED`
- A new dam upstream, Upper Mellègue, holds **195 Mm³**. `REPORTED`

**Notes:** "No one outside the operator could see the lake drain. Farmers in Jendouba and Bou Salem learned from the news. With a new, much larger dam on the same river, independent monitoring matters."

---

## Slide 3 · What the radar saw

- Before: Sentinel-1, 17 Jun 17:20 UTC, about 3 h before. Open water **2.92 km²** (1.91–3.27 for ±2 dB). `MEASURED`
- NISAR's first image: **19 June**. On track D80 the lake shrinks about **18%** from 1 to 13 July. `MEASURED`
- **133 measurements** (41 NISAR, 92 Sentinel-1): drawdown until the 16 July repair, plateau in August, rise with September rain. `MEASURED`
- SWOT: lake surface **−3.75 ± 0.08 m**, 7 → 28 June. `MEASURED`
Visual: app chart with the uncertainty band; NISAR chip + water mask (INPUT | WATER MASK).

**Notes:** "NISAR did not see the gate fail; its first pass was two days later. Right after the failure NISAR's area lags: wet mud looks like water at L-band. Its own tracks then show the shrinking clearly. SWOT, a NASA–CNES satellite, measures height, and confirms the level fell almost four metres."

---

## Slide 4 · Could we have known? 22 June

Big numeral: **22 Jun** · 5 days after the failure
- Rule: area more than 20% below the median of the previous 21 days, confirmed by an independent pass within 6 days. `MODELLED`
- First ALERT: Sentinel-1 orbit 161 (**−20.5%**), confirmed by orbit 88 (**−28.8%**).
- **0 flags** in 14 evaluations before the failure.
- First NISAR flag: **26 June** (track A173, WARNING, −13%).

**Key line:** "NISAR and Sentinel-1 together would have raised an alarm on 22 June, five days after the failure, with no ground sensor."

**Notes:** "Two sensors give a look every few days. Together they would have caught it. This is a retrospective test on one event: the thresholds were set here and must be tested on other dams."

---

## Slide 5 · What if? Flood scenarios

Banner: **SCENARIO · NOT A FORECAST**
- Flow path: **101 km**, dam → Jendouba (km 37.6) → Medjerda (km 44.9) → Bou Salem (km 66.8) → Sidi Salem. `MODELLED`
- ANUGA 2D, dam → Medjerda confluence, 12 h release: `MODELLED`

| Volume | Wet area | Cropland | Front at confluence |
|---|---|---|---|
| 21 Mm³ (June) | 19.3 km² | 1,112 ha | ≈ 13 h (13–19) |
| 50 Mm³ | 35.4 km² | 2,448 ha | ≈ 9 h |
| 195 Mm³ (hypothetical) | 71.8 km² | 5,573 ha | ≈ 6 h |

- Quick HAND slider (whole 101 km): 195 Mm³ reaches 4 villages (Muthul, Ben Bchir, Bou Salem, Sidi Smail).
Visual: app Act 7 with the slider at 195 Mm³.

**Notes:** "195 million m³ is the size of the new reservoir, released at the old dam: a worst case to explore, not a prediction. Timing depends on the mesh: 13 h on our fine mesh, 19 h on a coarser one, so we show a range."

---

## Slide 6 · What we checked, and what we cannot claim

✅ Mass balance ≤ 9×10⁻¹³ of the volume · flow path 98.8% within 300 m of mapped rivers · SWOT and radar agree in sign · storage loss **12.7 Mm³** (7.8–17.1), within a factor of 2 of the reported 21.
⚠️ Area moves a median ±23% with the threshold (band drawn) · NISAR reads high just after the failure (wet mud) · alert thresholds in-sample · 3 ALERT + 12 WARNING Aug–mid-Nov during real declines: "needs operator check".
❌ Mesh test failed (arrival shown as 13–19 h) · DEM-shoreline level method rejected (+6.5 to +10.1 m vs SWOT), not shipped.
**Limits:** screening level, 30 m terrain, no channel depths, release shape assumed · SWOT ΔV is net storage change, not the release · 195 Mm³ is hypothetical · NISAR did not see the failure.

**Notes:** "Every number in the app has a badge and a source. Where a test failed, we removed the claim or show a range. This page is on the app's Methods page too."

---

## Slide 7 · Next: any dam

- **Today:** one reservoir, Mellègue, end to end. Methods are generic.
- **Next (offline batch first):** 5–10 northern Tunisian reservoirs (Sidi Salem, Bou Heurtma, Beni Mtir, Barbara, Kasseb, Siliana, Sidi el Barrak, Joumine) as static bundles.
- Per dam: catchment, flow path, lake mask from the Sentinel-1 archive, NISAR + Sentinel-1 series, HAND table.
- **Test the alert rule out of sample** on every dam before showing alerts as operational.
- ANUGA only for the top 2–3 dams, with a mesh test each. Then a live service.
Closing line: **"One lake today. Every dam tomorrow."**

**Notes:** "We will not build a live service before the method proves itself on dams it was not tuned on. NISAR passes over every Tunisian reservoir; the open question is not the data, it is the validation."
