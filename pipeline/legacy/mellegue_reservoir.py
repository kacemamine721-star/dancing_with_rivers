#!/usr/bin/env python3
"""
Mellègue reservoir time series: the "Dam Watch" chart
=====================================================
Measures the open-water area of the Mellègue reservoir on EVERY NISAR date (all tracks, June -> Nov 2026)
inside a TIGHT box around the lake (so dry harvested fields, which are also dark at L-band, are excluded),
and adds Sentinel-1 C-band dates (incl. 17 June 17:20 UTC, ~3 h BEFORE the gate failure).

Needs mellegue_test.py in the same folder (it reuses its NISAR reading functions) and EARTHDATA_TOKEN.

Run:
  python mellegue_reservoir.py
  python mellegue_reservoir.py --box 8.665 36.290 8.735 36.330 --water-db -18
  python mellegue_reservoir.py --skip-s1

Outputs (./mellegue_reservoir_output/):
  reservoir_timeseries.csv     date, sensor, track, water area km²
  reservoir_chart.html / .png  the Dam Watch chart with the events marked
  chips/*.png + reservoir_animation.gif   one image per date (for the before/after slider)
"""

import argparse
import datetime as dt
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mellegue_test as mt  # noqa: E402  (also neutralises a PostGIS PROJ_LIB)

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

DEFAULT_BOX = (8.665, 36.290, 8.735, 36.330)   # tight box around the lake (from the 19-21 June NISAR images)
EVENTS = [("2026-06-17", "Gate failure (night 17-18 Jun)"),
          ("2026-07-16", "Gate repaired"),
          ("2026-09-15", "Upper Mellègue dam: planned start")]


def water_area(power, pixel_m2, thr_db, smooth=5):
    """Area (km²) of open water: speckle-filtered backscatter below thr_db."""
    sm = mt.db(mt.boxcar(power, smooth))
    mask = sm < thr_db
    return float(np.nansum(mask)) * pixel_m2 / 1e6, sm, mask


def save_chip(sm, mask, path, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(6, 3.6), dpi=110)
    ax.imshow(sm, vmin=-25, vmax=0, cmap="gray", interpolation="nearest")
    if mask.any():
        ax.contour(mask.astype(float), levels=[0.5], colors="#38bdf8", linewidths=1.2)
    ax.set_title(title, fontsize=10)
    ax.set_xticks([])
    ax.set_yticks([])
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def nisar_series(args, session, out):
    prods = mt.search_products(args.box, args.start, args.end)
    g = prods[prods["product"] == "GCOV"].copy()
    if g.empty:
        mt.log("No NISAR GCOV found for this box/period")
        return []
    g["track"] = g["dir"].str[0] + g["track"].astype(str) + "/F" + g["frame"].astype(str)
    g = g.sort_values(["date", "size_GB"]).groupby(["date", "track"]).head(1)
    mt.log(f"NISAR: {len(g)} products, {g['date'].nunique()} dates on {', '.join(sorted(g['track'].unique()))}")
    rows = []
    key = "_".join(f"{v:.3f}" for v in args.box)
    for i, (_, r) in enumerate(g.iterrows(), 1):
        cache = out / "cache" / f"{r['scene']}_{key}.npz"
        try:
            if cache.exists():
                z = np.load(cache, allow_pickle=True)
                hh, meta = z["HH"], z["meta"].item()
            else:
                t0 = time.time()
                h5, _ = mt.open_h5(r["url"], session)
                bands, meta = mt.read_gcov(h5, args.box)
                h5.close()
                hh = bands["HH"]
                np.savez_compressed(cache, HH=hh, meta=np.array(meta, dtype=object))
                mt.log(f"  [{i}/{len(g)}] {r['date']} {r['track']}: {hh.shape} px in {time.time()-t0:.0f}s")
        except Exception as exc:  # noqa: BLE001
            mt.log(f"  [{i}/{len(g)}] {r['date']} {r['track']}: skipped ({exc})")
            continue
        if meta["y"][0] < meta["y"][-1]:
            hh = hh[::-1]
        area, sm, mask = water_area(hh, mt.pixel_area_m2(meta), args.water_db)
        f = f"chips/nisar_{r['date']}_{r['track'].replace('/', '')}.png"
        save_chip(sm, mask, out / f, f"NISAR L-band HH  {r['date']}  {r['track']}  ·  water {area:.2f} km²")
        rows.append({"date": r["date"], "sensor": "NISAR L-band (HH)", "track": r["track"], "water_km2": round(area, 3),
                     "chip": f, "scene": r["scene"]})
    return rows


def s1_series(args, out):
    mt.log("Sentinel-1 C-band RTC (Planetary Computer)...")
    try:
        items = mt.pc_items("sentinel-1-rtc", args.box, f"{args.s1_start}/{args.end}")
    except Exception as exc:  # noqa: BLE001
        mt.log(f"  ! not available: {exc}")
        return []
    rows, seen = [], set()
    for it in sorted(items, key=lambda x: x.datetime):
        props = getattr(it, "properties", {}) or {}
        orbit = props.get("sat:relative_orbit")
        stamp = it.datetime.strftime("%Y-%m-%d %H:%M")
        if (stamp, orbit) in seen:
            continue
        try:
            key = "vv" if "vv" in it.assets else next(iter(it.assets))
            arr, tr, _ = mt.read_cog_window(it.assets[key].href, args.box)
        except Exception as exc:  # noqa: BLE001
            mt.log(f"  {stamp}: skipped ({exc})")
            continue
        arr = arr.astype("float32")
        arr[arr <= 0] = np.nan
        if np.isfinite(arr).mean() < 0.8:  # tile only partly covers the lake
            continue
        seen.add((stamp, orbit))
        area, sm, mask = water_area(arr, abs(tr.a * tr.e), args.water_db)
        d = it.datetime.date().isoformat()
        f = f"chips/s1_{it.datetime.strftime('%Y-%m-%d_%H%M')}_o{orbit}.png"
        save_chip(sm, mask, out / f, f"Sentinel-1 C-band VV  {stamp} UTC  ·  water {area:.2f} km²")
        rows.append({"date": d, "sensor": "Sentinel-1 C-band (VV)", "track": f"orbit {orbit}", "water_km2": round(area, 3),
                     "chip": f, "scene": it.id, "time_utc": stamp})
        mt.log(f"  {stamp} orbit {orbit}: water {area:.2f} km²")
    return rows


def make_chart(df, out):
    import plotly.graph_objects as go
    fig = go.Figure()
    for (sensor, track), s in df.groupby(["sensor", "track"]):
        s = s.sort_values("date")
        fig.add_trace(go.Scatter(x=s["date"], y=s["water_km2"], mode="lines+markers",
                                 name=f"{sensor} · {track}",
                                 line=dict(dash="dot" if "Sentinel" in sensor else "solid")))
    for d, label in EVENTS:
        fig.add_vline(x=d, line_dash="dash", line_color="#ef4444")
        fig.add_annotation(x=d, y=1, yref="paper", text=label, showarrow=False, textangle=-90,
                           xanchor="right", font=dict(size=11, color="#ef4444"))
    fig.update_layout(title="Mellègue reservoir: open-water area seen from space (NISAR L-band + Sentinel-1)",
                      xaxis_title="Date (2026)", yaxis_title="Open water (km²)", height=520, template="plotly_white",
                      legend=dict(orientation="h", y=-0.2))
    fig.write_html(str(out / "reservoir_chart.html"), include_plotlyjs="cdn")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig2, ax = plt.subplots(figsize=(10, 4.5), dpi=120)
        for (sensor, track), s in df.groupby(["sensor", "track"]):
            s = s.sort_values("date")
            ax.plot(pd.to_datetime(s["date"]), s["water_km2"], "o--" if "Sentinel" in sensor else "o-",
                    ms=4, label=f"{sensor} · {track}")
        for d, label in EVENTS:
            ax.axvline(pd.to_datetime(d), color="#ef4444", ls="--", lw=1)
            ax.text(pd.to_datetime(d), ax.get_ylim()[1], " " + label, color="#ef4444", fontsize=8, rotation=90, va="top")
        ax.set_ylabel("Open water (km²)")
        ax.set_title("Mellègue reservoir: open-water area (NISAR L-band + Sentinel-1)")
        ax.legend(fontsize=7, ncol=2)
        fig2.tight_layout()
        fig2.savefig(out / "reservoir_chart.png")
    except Exception:  # noqa: BLE001
        pass


def make_gif(df, out):
    from PIL import Image
    frames = []
    for _, r in df.sort_values(["date", "sensor"]).iterrows():
        p = out / r["chip"]
        if p.exists():
            frames.append(Image.open(p).convert("P", palette=Image.ADAPTIVE))
    if frames:
        frames[0].save(out / "reservoir_animation.gif", save_all=True, append_images=frames[1:], duration=600, loop=0)


def main():
    ap = argparse.ArgumentParser(description="Mellègue reservoir water-area time series (NISAR + Sentinel-1)")
    ap.add_argument("--box", nargs=4, type=float, default=DEFAULT_BOX, metavar=("LON0", "LAT0", "LON1", "LAT1"))
    ap.add_argument("--start", default="2026-06-15")
    ap.add_argument("--end", default="2026-11-15")
    ap.add_argument("--s1-start", default="2026-05-15")
    ap.add_argument("--water-db", type=float, default=-18.0)
    ap.add_argument("--skip-s1", action="store_true")
    ap.add_argument("--out", default="mellegue_reservoir_output")
    args = ap.parse_args()
    out = Path(args.out)
    (out / "cache").mkdir(parents=True, exist_ok=True)
    (out / "chips").mkdir(exist_ok=True)

    token = os.environ.get("EARTHDATA_TOKEN") or __import__("getpass").getpass("Earthdata token: ").strip()
    rows = nisar_series(args, mt.earthdata_session(token), out)
    if not args.skip_s1:
        rows += s1_series(args, out)
    if not rows:
        sys.exit("No measurements.")
    df = pd.DataFrame(rows).sort_values(["date", "sensor"])
    df.to_csv(out / "reservoir_timeseries.csv", index=False)
    make_chart(df, out)
    make_gif(df, out)

    mt.log("\n" + df[["date", "sensor", "track", "water_km2"]].to_string(index=False))
    n = df[df["sensor"].str.startswith("NISAR")]
    if len(n):
        first, mn = n.iloc[0], n.loc[n["water_km2"].idxmin()]
        mt.log(f"\nNISAR: {first['water_km2']:.2f} km² on {first['date']} -> minimum {mn['water_km2']:.2f} km² on {mn['date']}"
               f" -> {n.iloc[-1]['water_km2']:.2f} km² on {n.iloc[-1]['date']}")
    pre = df[(df["sensor"].str.startswith("Sentinel")) & (df["date"] < "2026-06-18")]
    if len(pre):
        mt.log(f"Sentinel-1 last image before the failure: {pre.iloc[-1]['water_km2']:.2f} km² on {pre.iloc[-1]['date']}")
    mt.log(f"\nOpen {out/'reservoir_chart.html'}  ·  chips in {out/'chips'}  ·  {out/'reservoir_animation.gif'}")


if __name__ == "__main__":
    main()
