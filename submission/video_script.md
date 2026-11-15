# 30-second demo video: script and shot list

**Source:** screen capture of the real app (deployed URL, or `docker compose up --build web` → http://localhost:5173), following the Tour in docs/05 §6. Record at 1920×1080, 30 or 60 fps. No voice-over needed: English subtitles carry the story (file: `submission/subtitles_en.srt`, burn in or upload as captions).

**Rules for the capture**
- No NASA logos or branding on screen. NISAR is credited in text only ("NASA/JPL–ISRO via ASF DAAC").
- No people, voices or names of anyone under 18.
- It is a screen capture of our app, not AI-generated media. If any AI-generated frame or image is added, watermark it "AI-generated".
- Badges must be readable in each shot (MEASURED, REPORTED, MODELLED).
- Act 3: keep the swipe label "CROSS-SENSOR: compare outlines, not shades" visible, or use the same-sensor Sentinel-1 17 → 22 Jun preset.
- Act 7: keep the banner "Scenario exploration, not a forecast" visible.

## Shot list

| t (s) | Route / action | On screen | Subtitle |
|---|---|---|---|
| 0–4 | `/?intro=1` → skip to hero → **Start the mission** (dive about 3.9 s) | Cinematic intro, dive into the valley | "17 June 2026. Mellègue dam, Nebeur, Tunisia." |
| 4–7 | `/story/1` arrival shot | 3D valley, dam marker, lake outline | "A 72-year-old gate fails at 21:15. About 21 million m³ are released (reported)." |
| 7–11 | `/story/2` night replay, accelerated | Sentinel-1 17 Jun 17:20 UTC image fades in; clock runs to 21:15 | "The last radar look before: Sentinel-1, about 3 hours earlier." |
| 11–15 | `/story/3` swipe, then scrub NISAR 1 Jul → 13 Jul | Before / after swipe; NISAR chips and water masks | "NISAR's first image: 19 June. On its own track, the lake shrinks about 18% in July." |
| 15–19 | `/story/4` follow the water | Flow path dam → Jendouba → Medjerda → Bou Salem → Sidi Salem (101 km) | "The water follows the valley 101 km to Sidi Salem." |
| 19–22 | `/story/6` scrubber stops on 22 Jun, alert card | AlertCard "ALERT · 22 Jun" | "NISAR and Sentinel-1 together would have raised an alarm on 22 June, with no ground sensor." |
| 22–27 | `/story/7` slider 21 → 195 Mm³ | HAND flood layer grows; counters rise; banner visible | "What if? A scenario, not a forecast." |
| 27–30 | `/story/9` → Open Dam Watch | Dam Watch panel; product name Dancing with the Rivers | "Dancing with the Rivers. One lake today; every dam tomorrow." |

If the ANUGA chips are working, the 22–27 s shot can show the 21 Mm³ "June 2026 reconstruction" first (front at the Medjerda confluence after about 13 h on our mesh) before the slider.

## Subtitles (English, SRT)

```srt
1
00:00:00,000 --> 00:00:04,000
17 June 2026. Mellègue dam,
Nebeur, Tunisia.

2
00:00:04,000 --> 00:00:07,000
A 72-year-old gate fails at 21:15.
About 21 million m³ are released (reported).

3
00:00:07,000 --> 00:00:11,000
The last radar look before:
Sentinel-1, about 3 hours earlier.

4
00:00:11,000 --> 00:00:15,000
NISAR's first image: 19 June.
On its own track, the lake shrinks about 18% in July.

5
00:00:15,000 --> 00:00:19,000
The water follows the valley
101 km to Sidi Salem.

6
00:00:19,000 --> 00:00:22,000
NISAR and Sentinel-1 together would have raised
an alarm on 22 June, with no ground sensor.

7
00:00:22,000 --> 00:00:27,000
What if more water had been released?
A scenario, not a forecast.

8
00:00:27,000 --> 00:00:30,000
Dancing with the Rivers.
One lake today. Every dam tomorrow.
```

## Upload checklist
- Upload to a public host (YouTube unlisted-public, or Google Drive "anyone with the link").
- Open the link in a private window, logged out, to confirm it plays without a sign-in.
- Paste that one link as the demo on the project page.
