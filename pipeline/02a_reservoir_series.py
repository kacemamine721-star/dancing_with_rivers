#!/usr/bin/env python3
"""02a · Reservoir water-area series (NISAR all tracks + Sentinel-1) — the critical-path measurement.

Extends TESTS/mellegue_reservoir.py:
  * reads a PADDED box around the lake once per product and caches HH+HV (cache/gcov/), so 02_reservoir.py
    (lake polygon, 10 m chips, HV checks) never re-downloads;
  * reuses the go/no-go cache in TESTS/mellegue_test_output/cache/ when it covers the box;
  * measures open water inside the TIGHT lake box (config aoi.lake) at several thresholds (test A1);
  * writes work/reservoir/series.csv, chips (lake box, proper axes) and a QA chart.

This is a box measurement. The lake-polygon-restricted series (the one the app shows) is produced by
02_reservoir.py from the same cache.

  python pipeline/02a_reservoir_series.py              # NISAR + S1
  python pipeline/02a_reservoir_series.py --skip-s1
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
from common import nisar_io as mt  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

PAD = 0.03  # degrees around the tight lake box (~3 km): room for the polygon dilation and context


def padded(box, pad=PAD):
    return (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)


def covers(meta, box) -> bool:
    try:
        rs, cs = mt.sub_window(meta, box)
        return rs.stop - rs.start > 10 and cs.stop - cs.start > 10
    except Exception:  # noqa: BLE001
        return False


def crop(bands: dict, meta: dict, box) -> tuple[dict, dict]:
    rs, cs = mt.sub_window(meta, box)
    m = dict(meta, x=meta["x"][cs], y=meta["y"][rs])
    return {k: v[rs, cs] for k, v in bands.items()}, m


def load_legacy(scene: str, legacy_dir: Path, box):
    """Reuse go/no-go cache files (named <scene>_<bbox>.npz) when they cover the box."""
    for f in legacy_dir.glob(f"{scene}_*.npz"):
        try:
            z = np.load(f, allow_pickle=True)
            meta = z["meta"].item()
            bands = {k: z[k] for k in ("HH", "HV") if k in z.files}
            if "HH" in bands and covers(meta, box):
                return crop(bands, meta, box)
        except Exception:  # noqa: BLE001
            continue
    return None


def get_gcov(r, session, read_box, cache_dir: Path, legacy_dir: Path):
    cache = cache_dir / f"{r['scene']}.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        return {k: z[k] for k in ("HH", "HV") if k in z.files}, z["meta"].item(), "cache"
    got = load_legacy(r["scene"], legacy_dir, read_box)
    src = "legacy-cache"
    if got is None:
        h5, _ = mt.open_h5(r["url"], session)
        try:
            bands, meta = mt.read_gcov(h5, read_box, pols=("HHHH", "HVHV"))
        finally:
            h5.close()
        got, src = (bands, meta), "download"
    bands, meta = got
    meta = {k: meta[k] for k in ("epsg", "x", "y")}
    np.savez_compressed(cache, **bands, meta=np.array(meta, dtype=object))
    return bands, meta, src


def oriented(a, meta):
    """North-up arrays (y descending)."""
    return (a[::-1], meta["y"][::-1]) if meta["y"][0] < meta["y"][-1] else (a, meta["y"])


def areas(power, pixel_m2, thresholds, k):
    sm = mt.db(mt.boxcar(power, k))
    return sm, {t: float(np.nansum(sm < t)) * pixel_m2 / 1e6 for t in thresholds}


def save_chip(sm, thr, path: Path, title: str, extent_km):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(6.4, 4.2), dpi=110)
    ax.imshow(sm, vmin=-25, vmax=0, cmap="gray", interpolation="nearest", extent=extent_km)
    m = (sm < thr).astype(float)
    if m.any():
        ax.contour(m, levels=[0.5], colors="#5ff3ff", linewidths=0.9, extent=extent_km, origin="upper")
    ax.set_title(title, fontsize=9)
    ax.set_xlabel("km east")
    ax.set_ylabel("km north")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def nisar(args, cfg, out: Path, thresholds):
    lake = tuple(cfg["aoi"]["lake"])
    read_box = padded(lake)
    common.load_env()
    import os
    token = os.environ.get("EARTHDATA_TOKEN")
    if not token:
        sys.exit("EARTHDATA_TOKEN missing (put it in .env)")
    session = mt.earthdata_session(token)
    prods = mt.search_products(lake, *cfg["period"]["nisar"])
    g = prods[prods["product"] == "GCOV"].copy()
    if g.empty:
        sys.exit("No NISAR GCOV found")
    g["trk"] = g["dir"].str[0] + g["track"].astype(str) + "/F" + g["frame"].astype(str)
    g = g.sort_values(["date", "size_GB"]).groupby(["date", "trk"]).head(1)
    g.to_csv(out / "nisar_products.csv", index=False)
    mt.log(f"NISAR: {len(g)} products, {g['date'].nunique()} dates, tracks {', '.join(sorted(g['trk'].unique()))}")
    cache_dir = common.ROOT / "cache" / "gcov"
    cache_dir.mkdir(parents=True, exist_ok=True)
    legacy = common.ROOT / "TESTS" / "mellegue_test_output" / "cache"
    rows = []
    for i, (_, r) in enumerate(g.iterrows(), 1):
        t0 = time.time()
        for attempt in range(3):
            try:
                bands, meta, src = get_gcov(r, session, read_box, cache_dir, legacy)
                break
            except Exception as exc:  # noqa: BLE001
                mt.log(f"  [{i}/{len(g)}] {r['date']} {r['trk']}: attempt {attempt + 1} failed ({exc})")
                bands = None
                time.sleep(5 * (attempt + 1))
        if bands is None:
            rows.append(dict(date=r["date"], sensor="NISAR", track=r["trk"], scene=r["scene"], status="failed"))
            continue
        if not covers(meta, lake):
            mt.log(f"  [{i}/{len(g)}] {r['date']} {r['trk']}: lake not covered, skipped")
            continue
        cb, m = crop({"HH": bands["HH"]}, meta, lake)
        hh_l, y = oriented(cb["HH"], m)
        valid = np.isfinite(hh_l) & (hh_l > 0)
        px = mt.pixel_area_m2(m)
        sm, a = areas(hh_l, px, thresholds, cfg["water"]["boxcar"])
        ext = [0, (m["x"].max() - m["x"].min()) / 1e3, 0, (y.max() - y.min()) / 1e3]
        chip = f"chips/nisar_{r['date']}_{r['trk'].replace('/', '')}.png"
        save_chip(sm, cfg["water"]["hh_db"], out / chip,
                  f"NISAR L-band HH · {r['date']} · {r['trk']} · water {a[cfg['water']['hh_db']]:.2f} km²", ext)
        row = dict(date=r["date"], sensor="NISAR", track=r["trk"], scene=r["scene"], status="ok", source=src,
                   pixel_m=round(px ** 0.5, 1), valid_frac=round(float(valid.mean()), 3),
                   hh_median_db=round(float(np.nanmedian(mt.db(hh_l))), 2), chip=chip)
        row.update({f"area_{int(abs(t))}": round(v, 3) for t, v in a.items()})
        rows.append(row)
        mt.log(f"  [{i}/{len(g)}] {r['date']} {r['trk']:9s} {src:12s} water(-18)={a[-18.0]:.2f} km²  "
               f"valid={row['valid_frac']:.2f}  {time.time() - t0:.0f}s")
    return rows


def sentinel1(args, cfg, out: Path, thresholds):
    lake = tuple(cfg["aoi"]["lake"])
    mt.log("Sentinel-1 RTC (Planetary Computer)…")
    try:
        items = mt.pc_items("sentinel-1-rtc", lake, "/".join(cfg["period"]["s1"]))
    except Exception as exc:  # noqa: BLE001
        mt.log(f"  ! S1 not available: {exc}")
        return []
    cache_dir = common.ROOT / "cache" / "s1"
    cache_dir.mkdir(parents=True, exist_ok=True)
    rows, seen = [], set()
    for it in sorted(items, key=lambda x: x.datetime):
        orbit = (getattr(it, "properties", {}) or {}).get("sat:relative_orbit")
        stamp = it.datetime.strftime("%Y-%m-%d %H:%M")
        if (stamp, orbit) in seen:
            continue
        cache = cache_dir / f"{it.id}.npz"
        try:
            if cache.exists():
                z = np.load(cache, allow_pickle=True)
                vv, pix = z["VV"], float(z["pix"])
            else:
                key = "vv" if "vv" in it.assets else next(iter(it.assets))
                arr, tr, _ = mt.read_cog_window(it.assets[key].href, padded(lake))
                vv, pix = arr.astype("float32"), abs(tr.a * tr.e)
                np.savez_compressed(cache, VV=vv, pix=pix, transform=np.array(tuple(tr)[:6]))
        except Exception as exc:  # noqa: BLE001
            mt.log(f"  {stamp}: skipped ({exc})")
            continue
        vv = vv.copy()
        vv[vv <= 0] = np.nan
        # inner (tight) window: the cached array is the padded box; take the central part proportionally
        h, w = vv.shape
        fy = PAD / (lake[3] - lake[1] + 2 * PAD)
        fx = PAD / (lake[2] - lake[0] + 2 * PAD)
        inner = vv[int(h * fy):h - int(h * fy), int(w * fx):w - int(w * fx)]
        if np.isfinite(inner).mean() < 0.8:
            continue
        seen.add((stamp, orbit))
        sm, a = areas(inner, pix, thresholds, cfg["water"]["boxcar"])
        wind = float(np.nanmedian(sm[sm < cfg["water"]["s1_vv_db"]])) if np.any(sm < cfg["water"]["s1_vv_db"]) else np.nan
        chip = f"chips/s1_{it.datetime.strftime('%Y-%m-%d_%H%M')}_o{orbit}.png"
        ext = [0, inner.shape[1] * pix ** 0.5 / 1e3, 0, inner.shape[0] * pix ** 0.5 / 1e3]
        save_chip(sm, cfg["water"]["s1_vv_db"], out / chip,
                  f"Sentinel-1 C-band VV · {stamp} UTC · orbit {orbit} · water {a[-18.0]:.2f} km²", ext)
        row = dict(date=it.datetime.date().isoformat(), time_utc=it.datetime.strftime("%H:%M"), sensor="S1",
                   track=f"o{orbit}", scene=it.id, status="ok", source="pc", pixel_m=round(pix ** 0.5, 1),
                   valid_frac=round(float(np.isfinite(inner).mean()), 3), chip=chip,
                   wind_flag=bool(np.isfinite(wind) and wind > cfg["water"]["s1_wind_flag_median_db"]))
        row.update({f"area_{int(abs(t))}": round(v, 3) for t, v in a.items()})
        rows.append(row)
        mt.log(f"  {stamp} o{orbit}: water(-18)={a[-18.0]:.2f} km²")
    return rows


def chart(df: pd.DataFrame, cfg, out: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(11, 4.6), dpi=120)
    ok = df[df["status"] == "ok"]
    for (sensor, track), s in ok.groupby(["sensor", "track"]):
        s = s.sort_values("date")
        ax.plot(pd.to_datetime(s["date"]), s["area_18"], "o--" if sensor == "S1" else "o-", ms=4, label=f"{sensor} {track}")
    for e in cfg["events"]:
        ax.axvline(pd.to_datetime(e["date"]), color="#ff4fd2", ls="--", lw=1)
        ax.text(pd.to_datetime(e["date"]), ax.get_ylim()[1], " " + e["label"], color="#ff4fd2", fontsize=7, rotation=90, va="top")
    g0, g1 = cfg["event"]["gap"]
    ax.axvspan(pd.to_datetime(g0), pd.to_datetime(g1), color="0.85", zorder=0)
    ax.set_ylabel("Open water in lake box (km², HH/VV < −18 dB)")
    ax.set_title("Mellègue — open water inside the tight lake box (QA chart, not the app chart)")
    ax.legend(fontsize=7, ncol=3)
    fig.tight_layout()
    fig.savefig(out / "series_qa.png")
    plt.close(fig)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=common.ROOT / "config.yaml")
    ap.add_argument("--skip-s1", action="store_true")
    ap.add_argument("--skip-nisar", action="store_true")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    out = common.ROOT / "work" / "reservoir"
    (out / "chips").mkdir(parents=True, exist_ok=True)
    thresholds = [float(t) for t in cfg["water"]["sensitivity_db"]]
    rows = [] if args.skip_nisar else nisar(args, cfg, out, thresholds)
    if not args.skip_s1:
        rows += sentinel1(args, cfg, out, thresholds)
    if not rows:
        sys.exit("No measurements.")
    df = pd.DataFrame(rows).sort_values(["date", "sensor", "track"])
    df.to_csv(out / "series.csv", index=False)
    chart(df, cfg, out)
    ok = df[df["status"] == "ok"]
    mt.log("\n" + ok[["date", "sensor", "track", "area_16", "area_18", "area_20", "valid_frac"]].to_string(index=False))
    mt.log(f"\n{len(ok)} measurements ({(ok.sensor == 'NISAR').sum()} NISAR, {(ok.sensor == 'S1').sum()} S1); "
           f"{(df.status != 'ok').sum()} failed · {out / 'series.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
