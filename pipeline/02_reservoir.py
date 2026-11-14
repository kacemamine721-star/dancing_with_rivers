#!/usr/bin/env python3
"""02 · Reservoir: lake polygon, adaptive water masks, area series, web chips (docs/03 §5.1–5.2, docs/07 §1).

Why adaptive: the go/no-go and 02a runs showed a fixed −18 dB threshold fails here — the 17 Jun 17:20 UTC
Sentinel-1 "before" image shows a wind-roughened lake at about −15…−17 dB (C-band), and after the release NISAR
sees shallow water / wet mud at −15…−18 dB. So each image gets its own Otsu threshold computed in the lake
neighbourhood (lake polygon + 300 m ring of land), clamped to a physical range, and area is counted only inside
the lake polygon.

Inputs : cache/gcov/*.npz, cache/s1/*.npz (from 02a_reservoir_series.py), work/reservoir/series.csv
Outputs: work/reservoir/series_adaptive.csv, qa_contact_sheet.png, qa_series.png
         <bundle>/vectors/lake_max.geojson, timeseries/reservoir_area.json, radar/*.png (+ _mask.png)

  python pipeline/02_reservoir.py
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
from common import contracts as C  # noqa: E402
from common import nisar_io as mt  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

RES = 10.0
CLAMP = {"NISAR": (-23.0, -13.5), "S1": (-23.0, -13.5)}
CHIP_DATES = [("S1", "2026-06-10", "o161"), ("S1", "2026-06-17", "o88"), ("S1", "2026-06-22", "o88"),
              ("NISAR", "2026-06-19", "D80/F70"), ("NISAR", "2026-06-21", "A101/F20"),
              ("NISAR", "2026-07-01", "D80/F70"), ("NISAR", "2026-07-03", "A101/F20"),
              ("NISAR", "2026-07-13", "D80/F70"), ("NISAR", "2026-07-15", "A101/F20"),
              ("NISAR", "2026-10-29", "D80/F70")]


def bundle_mod():
    spec = importlib.util.spec_from_file_location("bundle08", Path(__file__).with_name("08_bundle.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ------------------------------------------------------------------------------------------------ grids & io
def utm_box(lonlat, snap=RES):
    from pyproj import Transformer
    tr = Transformer.from_crs(4326, 32632, always_xy=True)
    xs, ys = tr.transform([lonlat[0], lonlat[2], lonlat[0], lonlat[2]], [lonlat[1], lonlat[1], lonlat[3], lonlat[3]])
    return (np.floor(min(xs) / snap) * snap, np.floor(min(ys) / snap) * snap,
            np.ceil(max(xs) / snap) * snap, np.ceil(max(ys) / snap) * snap)


class Grid:
    def __init__(self, bounds, res=RES):
        from rasterio.transform import from_origin
        self.bounds, self.res = bounds, res
        self.w = int(round((bounds[2] - bounds[0]) / res))
        self.h = int(round((bounds[3] - bounds[1]) / res))
        self.transform = from_origin(bounds[0], bounds[3], res, res)

    def window_of(self, other: "Grid"):
        c0 = int(round((other.bounds[0] - self.bounds[0]) / self.res))
        r0 = int(round((self.bounds[3] - other.bounds[3]) / self.res))
        return slice(r0, r0 + other.h), slice(c0, c0 + other.w)


def to_grid(arr, src_transform, grid: Grid, resampling="bilinear"):
    from rasterio.warp import Resampling, reproject
    dst = np.full((grid.h, grid.w), np.nan, np.float32)
    reproject(arr.astype(np.float32), dst, src_transform=src_transform, src_crs="EPSG:32632", src_nodata=np.nan,
              dst_transform=grid.transform, dst_crs="EPSG:32632", dst_nodata=np.nan,
              resampling=getattr(Resampling, resampling))
    return dst


def load_db(row, grid: Grid, k: int):
    """Speckle-filter in native geometry (linear power), convert to dB, resample to the analysis grid."""
    from rasterio.transform import from_origin
    if row["sensor"] == "NISAR":
        z = np.load(common.ROOT / "cache/gcov" / f"{row['scene']}.npz", allow_pickle=True)
        meta = z["meta"].item()
        hh = z["HH"].astype(np.float32)
        x, y = meta["x"], meta["y"]
        if y[0] < y[-1]:
            hh, y = hh[::-1], y[::-1]
        dx, dy = float(np.median(np.diff(x))), float(abs(np.median(np.diff(y))))
        tr = from_origin(x.min() - dx / 2, y.max() + dy / 2, dx, dy)
        p = hh
    else:
        z = np.load(common.ROOT / "cache/s1" / f"{row['scene']}.npz", allow_pickle=True)
        p = z["VV"].astype(np.float32)
        t = z["transform"]
        from affine import Affine
        tr = Affine(*t[:6])
    p = np.where(p > 0, p, np.nan)
    return to_grid(mt.db(mt.boxcar(p, k)), tr, grid)


# ------------------------------------------------------------------------------------------------ masks
def otsu_thr(v, lo, hi):
    v = v[np.isfinite(v)]
    if v.size < 500:
        return -18.0, 0.0
    v = np.clip(v, -30, 5)
    hist, edges = np.histogram(v, bins=200)
    mids = (edges[:-1] + edges[1:]) / 2
    w1 = np.cumsum(hist)
    w2 = w1[-1] - w1
    m1 = np.cumsum(hist * mids) / np.maximum(w1, 1)
    m2 = (np.sum(hist * mids) - np.cumsum(hist * mids)) / np.maximum(w2, 1)
    between = w1 * w2 * (m1 - m2) ** 2
    k = int(np.argmax(between))
    sep = float(between[k] / (w1[-1] ** 2 * np.var(v) + 1e-9))          # Otsu η: between-class / total variance (0..1)
    return float(np.clip(mids[k], lo, hi)), sep


def clean(mask, min_px=20, hole_px=50):
    from scipy import ndimage as ndi
    lab, n = ndi.label(mask)
    if n:
        sizes = ndi.sum(mask, lab, range(1, n + 1))
        mask = np.isin(lab, np.where(sizes >= min_px)[0] + 1)
    holes = ndi.binary_fill_holes(mask) & ~mask
    lab, n = ndi.label(holes)
    if n:
        sizes = ndi.sum(holes, lab, range(1, n + 1))
        mask = mask | np.isin(lab, np.where(sizes < hole_px)[0] + 1)
    return mask


def disk(r_px):
    y, x = np.ogrid[-r_px:r_px + 1, -r_px:r_px + 1]
    return x * x + y * y <= r_px * r_px


def lake_polygon(pre_dbs, grid: Grid, dam_xy, dilate_m):
    """Water frequency over calm pre-failure S1 images → component nearest the dam → fill → dilate."""
    from scipy import ndimage as ndi
    freq = np.zeros((grid.h, grid.w), np.float32)
    for db in pre_dbs:
        t, _ = otsu_thr(db, -23, -13.5)
        freq += (db < t)
    freq /= max(len(pre_dbs), 1)
    core = clean(freq >= 0.5, 200, 2000)
    lab, n = ndi.label(core)
    if n == 0:
        raise RuntimeError("no lake found in pre-failure images")
    col = (dam_xy[0] - grid.bounds[0]) / grid.res
    row = (grid.bounds[3] - dam_xy[1]) / grid.res
    rr, cc = np.indices(core.shape)
    best, bestd = None, 1e18
    for i in range(1, n + 1):
        m = lab == i
        d = np.min((rr[m] - row) ** 2 + (cc[m] - col) ** 2)
        if m.sum() > 500 and d < bestd:
            best, bestd = i, d
    lake = ndi.binary_fill_holes(lab == best)
    lake = ndi.binary_dilation(lake, structure=disk(int(dilate_m / grid.res)))
    return lake, freq, float(np.sqrt(bestd)) * grid.res


def polygonize(mask, grid: Grid):
    import rasterio.features
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union
    geoms = [shape(g) for g, v in rasterio.features.shapes(mask.astype(np.uint8), mask=mask, transform=grid.transform) if v]
    return unary_union(geoms).simplify(5.0)


def geojson_utm(geom, props):
    from shapely.geometry import mapping
    g = mapping(geom)

    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0]), round(c[1])]
    g["coordinates"] = rnd(g["coordinates"])
    return {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32632"}},
            "features": [{"type": "Feature", "properties": props, "geometry": g}]}


# ------------------------------------------------------------------------------------------------ main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=common.ROOT / "config.yaml")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    out = common.bundle_dir(cfg)
    work = common.ROOT / "work" / "reservoir"
    k = cfg["water"]["boxcar"]

    series = pd.read_csv(work / "series.csv")
    series = series[series["status"] == "ok"].reset_index(drop=True)
    lake = cfg["aoi"]["lake"]
    pad = 0.03
    grid = Grid(utm_box((lake[0] - pad, lake[1] - pad, lake[2] + pad, lake[3] + pad)))
    gj = json.loads((out / C.BUNDLE_PATHS["grid"]).read_text("utf-8"))
    chip = Grid(tuple(gj["lake_chip"]["bounds_m"]), gj["lake_chip"]["res_m"])
    cw = grid.window_of(chip)
    from pyproj import Transformer
    dam_xy = Transformer.from_crs(4326, 32632, always_xy=True).transform(*cfg["dam"]["lonlat"])
    print(f"analysis grid {grid.w}×{grid.h} @ {RES:g} m · chip window {chip.w}×{chip.h}")

    # 1) lake polygon from calm pre-failure Sentinel-1 (orbits 161/168: lower wind sensitivity in our tests)
    pre = series[(series.sensor == "S1") & (series.date < "2026-06-17")]
    pre_dbs = [load_db(r, grid, k) for _, r in pre.iterrows()]
    lake_mask, freq, dam_dist = lake_polygon(pre_dbs, grid, dam_xy, cfg["water"]["polygon_dilate_m"])
    ring = __import__("scipy.ndimage", fromlist=["x"]).binary_dilation(lake_mask, structure=disk(30)) & ~lake_mask
    zone = lake_mask | ring
    lake_km2 = lake_mask.sum() * RES * RES / 1e6
    print(f"lake polygon from {len(pre_dbs)} pre-failure S1 images: {lake_km2:.2f} km² (incl. 100 m dilation); "
          f"dam point {dam_dist:.0f} m from lake")
    del pre_dbs

    # 2) per-image adaptive masks
    rows, chips = [], {}
    for i, r in series.iterrows():
        db = load_db(r, grid, k)
        lo, hi = CLAMP[r["sensor"]]
        t, sep = otsu_thr(db[zone], lo, hi)
        valid = np.isfinite(db) & lake_mask
        if valid.sum() < 0.9 * lake_mask.sum():
            continue
        water = clean((db < t) & lake_mask)
        area = water.sum() * RES * RES / 1e6
        a_lo = clean((db < t - 2) & lake_mask).sum() * RES * RES / 1e6
        a_hi = clean((db < t + 2) & lake_mask).sum() * RES * RES / 1e6
        a_fix = clean((db < -18) & lake_mask).sum() * RES * RES / 1e6
        med_lake = float(np.nanmedian(db[lake_mask]))
        med_land = float(np.nanmedian(db[ring]))
        med_water = float(np.nanmedian(db[water])) if water.any() else np.nan
        c_lake = med_land - med_lake                                       # lake polygon vs surrounding land
        c_water = med_land - med_water if np.isfinite(med_water) else 0.0  # detected water vs land
        # lake no darker than land = wind-roughened surface (seen on 29–30 May S1) → area not trustworthy
        conf = "low" if c_lake < 0.5 else ("medium" if c_water < 5.0 else "high")
        wind = r["sensor"] == "S1" and np.isfinite(med_water) and med_water > cfg["water"]["s1_wind_flag_median_db"]
        tu = r.get("time_utc")
        rows.append(dict(date=r["date"], time_utc=tu if isinstance(tu, str) else "",
                         sensor=r["sensor"], track=r["track"], scene=r["scene"], thr_db=round(t, 2), sep=round(sep, 3),
                         area_km2=round(area, 3), area_lo=round(a_lo, 3), area_hi=round(a_hi, 3), area_fix18=round(a_fix, 3),
                         lake_median_db=round(med_lake, 2), land_median_db=round(med_land, 2),
                         water_median_db=round(med_water, 2) if np.isfinite(med_water) else None,
                         confidence=conf, wind_flag=bool(wind)))
        key = (r["sensor"], r["date"], r["track"])
        if key in CHIP_DATES:
            chips[key] = (db[cw], water[cw])
        if i % 20 == 0:
            print(f"  {i}/{len(series)} {r['date']} {r['sensor']} {r['track']}: T={t:.1f} dB area={area:.2f} km² ({conf})")
    df = pd.DataFrame(rows).sort_values(["date", "sensor", "track"]).reset_index(drop=True)

    # 3) per-track harmonisation (docs/03 §5.2): scale each track to the all-track median over the stable period
    stable = df[df.date >= "2026-08-14"]
    ref = stable.area_km2.median()
    fac = (ref / stable.groupby(["sensor", "track"]).area_km2.median()).replace([np.inf], np.nan).fillna(1.0)
    df["area_norm"] = [round(a * fac.get((s, t), 1.0), 3) for a, s, t in zip(df.area_km2, df.sensor, df.track)]
    df.to_csv(work / "series_adaptive.csv", index=False)

    # 4) outputs: lake polygon, chips, reservoir_area.json
    b = bundle_mod()
    product, dam, ver = cfg["brand"]["product"], cfg["dam"]["id"], cfg["bundle"]["version"]
    geom = polygonize(lake_mask, grid)
    (out / "vectors").mkdir(parents=True, exist_ok=True)
    (out / "vectors/lake_max.geojson").write_text(json.dumps(geojson_utm(geom, {
        "name": "Mellègue reservoir — max extent (May–Jun 2026)", "area_km2": round(geom.area / 1e6, 3),
        "method": f"water in ≥50% of {len(pre)} pre-failure Sentinel-1 images (adaptive Otsu), component nearest "
                  f"the dam, holes filled, dilated {cfg['water']['polygon_dilate_m']} m"})), "utf-8")
    b.register_layer(out, dict(id="lake_max", kind="vector", grid="none", file="vectors/lake_max.geojson",
                               label="Reservoir extent before the failure", badge="MEASURED",
                               source="ESA Copernicus Sentinel-1 RTC via Microsoft Planetary Computer",
                               method="pre-failure water frequency ≥ 50%, dilated 100 m", placeholder=False),
                     product, dam, ver)
    from PIL import Image
    (out / "radar").mkdir(parents=True, exist_ok=True)
    for f in (out / "radar").glob("fixture_*.png"):
        f.unlink()
    for (sensor, date, track), (db, water) in chips.items():
        t = track.replace("/", "")
        lid = f"{'nisar' if sensor == 'NISAR' else 's1'}_{date}_{t}_{'HH' if sensor == 'NISAR' else 'VV'}"
        enc = np.nan_to_num(np.clip((db + 25) / 25 * 255, 0, 255), nan=0).astype(np.uint8)
        Image.fromarray(enc, "L").save(out / f"radar/{lid}.png", optimize=True)
        Image.fromarray((water * 255).astype(np.uint8), "L").save(out / f"radar/{lid}_mask.png", optimize=True)
        r = df[(df.sensor == sensor) & (df.date == date) & (df.track == track)].iloc[0]
        b.register_layer(out, dict(
            id=lid, kind="radar", grid="lake_chip", file=f"radar/{lid}.png", mask=f"radar/{lid}_mask.png",
            label=f"{'NISAR L-band HH' if sensor == 'NISAR' else 'Sentinel-1 C-band VV'} · {date}", date=date,
            time_utc=r.time_utc or None, sensor=sensor, band="L" if sensor == "NISAR" else "C",
            pol="HH" if sensor == "NISAR" else "VV", track=track, product_id=r.scene,
            encoding=dict(type="db8", min=-25, max=0), badge="MEASURED",
            source="NASA/JPL–ISRO NISAR GCOV via ASF DAAC" if sensor == "NISAR"
            else "ESA Copernicus Sentinel-1 RTC via Microsoft Planetary Computer",
            method=f"γ0 boxcar {k}×{k}, resampled to 10 m; water = dB < {r.thr_db} dB (adaptive Otsu) inside lake polygon",
            uncertainty=f"area {r.area_lo}–{r.area_hi} km² for threshold ±2 dB", placeholder=False),
            product, dam, ver)
    # drop fixture radar layers from the manifest
    m = json.loads((out / "manifest.json").read_text("utf-8"))
    m["layers"] = [l for l in m["layers"] if not (l["kind"] == "radar" and l.get("placeholder"))]
    b.write_json(out / "manifest.json", C.Manifest.model_validate(m), force=True)

    events = json.loads((out / C.BUNDLE_PATHS["events"]).read_text("utf-8"))["events"]
    pts = [C.AreaPoint(date=r.date, time_utc=r.time_utc or None, sensor=r.sensor, track=r.track, area_km2=r.area_km2,
                       area_norm_km2=r.area_norm, sigma_km2=round((r.area_hi - r.area_lo) / 4, 3),
                       confidence=r.confidence,
                       layer=next((f"{'nisar' if r.sensor == 'NISAR' else 's1'}_{r.date}_{r.track.replace('/', '')}_"
                                   f"{'HH' if r.sensor == 'NISAR' else 'VV'}" for s, d, t in chips if
                                   (s, d, t) == (r.sensor, r.date, r.track)), None),
                       note=("wind-roughened (C-band)" if r.wind_flag else "") + (f"; T={r.thr_db} dB"))
           for r in df.itertuples()]
    b.write_json(out / C.BUNDLE_PATHS["reservoir_area"], C.ReservoirArea(
        badge="MEASURED", source="NASA/JPL–ISRO NISAR GCOV (ASF DAAC); ESA Sentinel-1 RTC (Planetary Computer)",
        method="per-image Otsu threshold in lake polygon + 300 m ring (clamped −23…−13.5 dB), boxcar 5×5, "
               "area counted inside the pre-failure lake polygon; per-track harmonisation on Aug–Oct medians",
        uncertainty="σ from threshold ±2 dB; tracks differ by incidence angle (use area_norm to compare)",
        dam_id=dam, reservoir=cfg["dam"]["name"], polygon="vectors/lake_max.geojson", threshold_db=-18.0,
        points=pts, events=[C.Event(**e) for e in events], gaps=[tuple(cfg["event"]["gap"])]), force=True)

    qa(df, freq, lake_mask, chips, work, cfg)
    print(df[df.date <= "2026-07-20"][["date", "sensor", "track", "thr_db", "area_km2", "area_lo", "area_hi",
                                       "lake_median_db", "confidence"]].to_string(index=False))
    return b.validate(out)


def qa(df, freq, lake_mask, chips, work: Path, cfg):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    n = len(chips) + 1
    cols = 4
    fig, axs = plt.subplots((n + cols - 1) // cols, cols, figsize=(16, 3.4 * ((n + cols - 1) // cols)), dpi=90)
    axs = axs.ravel()
    axs[0].imshow(freq, cmap="Blues", vmin=0, vmax=1)
    axs[0].contour(lake_mask, levels=[.5], colors="#ff4fd2", linewidths=1)
    axs[0].set_title("pre-failure water frequency + lake polygon", fontsize=9)
    for ax, ((s, d, t), (db, w)) in zip(axs[1:], sorted(chips.items(), key=lambda x: x[0][1])):
        ax.imshow(db, cmap="gray", vmin=-25, vmax=0)
        ax.contour(w, levels=[.5], colors="#5ff3ff", linewidths=.8)
        r = df[(df.sensor == s) & (df.date == d) & (df.track == t)].iloc[0]
        ax.set_title(f"{s} {t} {d} · {r.area_km2:.2f} km² · T={r.thr_db}", fontsize=9)
    for ax in axs:
        ax.set_xticks([]), ax.set_yticks([])
    fig.tight_layout()
    fig.savefig(work / "qa_contact_sheet.png")
    plt.close(fig)
    fig, ax = plt.subplots(2, 1, figsize=(12, 7), dpi=100, sharex=True)
    for (s, t), g in df.groupby(["sensor", "track"]):
        g = g.sort_values("date")
        x = pd.to_datetime(g.date)
        ax[0].plot(x, g.area_norm, "o--" if s == "S1" else "o-", ms=3, lw=1, label=f"{s} {t}")
        ax[1].plot(x, g.lake_median_db, "o--" if s == "S1" else "o-", ms=3, lw=1)
    for e in cfg["events"]:
        for a in ax:
            a.axvline(pd.to_datetime(e["date"]), color="#ff4fd2", ls="--", lw=.8)
    ax[0].set_ylabel("water area (km², harmonised)")
    ax[1].set_ylabel("median dB inside lake polygon")
    ax[0].legend(fontsize=7, ncol=4)
    fig.tight_layout()
    fig.savefig(work / "qa_series.png")
    plt.close(fig)


if __name__ == "__main__":
    sys.exit(main())
