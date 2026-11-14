#!/usr/bin/env python3
"""
Mellègue go / no-go test
========================
Question: after the Mellègue dam gate failure (night of 17-18 June 2026), does NISAR show
  (1) the reservoir water area changing, and
  (2) a wet / flooded footprint along the valley downstream,
and what is the land cover there (is there vegetation where L-band could see water under it)?

It reads ONLY the area of interest from each NISAR file over HTTPS (no 1-5 GB downloads), then compares:
  * NISAR L-band GCOV (HH, HV) on the first post-event date vs 12 and 24 days later, same track
  * NISAR L3 soil moisture (SME2) on the same dates
  * Sentinel-1 C-band RTC (Microsoft Planetary Computer) before vs after the failure   [optional]
  * ESA WorldCover land cover in the pixels where NISAR saw change                      [optional]

Install:
  pip install "asf_search>=11" h5py numpy pandas pyproj matplotlib requests rasterio pystac-client planetary-computer

Earthdata token (free): https://urs.earthdata.nasa.gov -> log in -> "Generate Token".
  set EARTHDATA_TOKEN=xxxxx        (Windows PowerShell: $env:EARTHDATA_TOKEN="xxxxx")
  If you get 401: in Earthdata Login > Applications > Authorized Apps, approve "Alaska Satellite Facility Data Access".

Run:
  python mellegue_test.py
  python mellegue_test.py --inspect          # print the HDF5 structure of one GCOV and one SME2 (debug)
  python mellegue_test.py --bbox 8.55 36.20 8.95 36.56 --reservoir 8.62 36.22 8.78 36.33

Outputs (./mellegue_test_output/):  index.html (open it!), report.md, results.csv, PNG maps.
All coordinates of the dam/reservoir are approximate: check the first PNG and adjust --reservoir if needed.
"""

import argparse
import datetime as dt
import getpass
import io
import json
import os
import re
import sys
import time
from collections import OrderedDict
from pathlib import Path

# Ignore PROJ/GDAL data folders from other software (e.g. PostgreSQL/PostGIS on Windows): they break
# rasterio/pyproj with "proj.db ... comes from another PROJ installation". The pip wheels bundle their own.
for _k in ("PROJ_LIB", "PROJ_DATA", "GDAL_DATA"):
    if _k in os.environ and re.search(r"postg|qgis|osgeo|arcgis", os.environ[_k], re.I):
        os.environ.pop(_k)

import numpy as np
import pandas as pd
import requests

# ----------------------------------------------------------------------------------------------
# Defaults (approximate, adjust with CLI)
# ----------------------------------------------------------------------------------------------
DEFAULT_BBOX = (8.55, 36.20, 8.95, 36.56)       # dam + reservoir + valley down to Jendouba / Medjerda
DEFAULT_RESERVOIR = (8.62, 36.22, 8.78, 36.33)  # box around the old Mellègue reservoir (check the PNG!)
EVENT = dt.date(2026, 6, 18)                    # gate failure night 17-18 June 2026
STACKS = [("DESCENDING", 80, 70), ("ASCENDING", 101, 20)]  # from your inventory: 19 Jun and 21 Jun first passes
UA = {"User-Agent": "nisar-mellegue-spaceapps/1.0"}
WORLDCOVER = {10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland", 50: "Built-up",
              60: "Bare/sparse", 70: "Snow/ice", 80: "Open water", 90: "Herbaceous wetland",
              95: "Mangroves", 100: "Moss/lichen"}


def log(msg):
    print(msg, flush=True)


# ----------------------------------------------------------------------------------------------
# Remote HDF5 access: HTTP range reads with a block cache (h5py reads only what it needs)
# ----------------------------------------------------------------------------------------------
class RangeFile(io.RawIOBase):
    """Read-only, seekable file over HTTPS using Range requests (follows Earthdata redirects)."""

    def __init__(self, url, session, block=4 * 2**20, max_blocks=256):
        self.url, self.s, self.block, self.max_blocks = url, session, block, max_blocks
        self.pos, self.cache, self.final_url = 0, OrderedDict(), None
        self.n_requests = 0
        r = self._get(0, 0)
        cr = r.headers.get("Content-Range", "")
        if "/" not in cr:
            raise IOError(f"server does not support range requests (status {r.status_code})")
        self.size = int(cr.split("/")[-1])

    def _get(self, a, b):
        r = None
        for attempt in range(8):
            target = self.final_url or self.url
            try:
                r = self.s.get(target, headers={"Range": f"bytes={a}-{b}"}, timeout=120, allow_redirects=True)
            except requests.exceptions.RequestException as exc:  # connection reset, timeout... -> retry
                wait = min(60, 3 * 2 ** attempt)
                log(f"      network hiccup ({type(exc).__name__}), retry {attempt + 1}/8 in {wait}s")
                time.sleep(wait)
                if attempt >= 2:
                    self.final_url = None  # re-resolve the download link
                continue
            self.n_requests += 1
            if r.status_code in (401, 403) and self.final_url:   # presigned URL expired -> resolve again
                self.final_url = None
                continue
            if r.status_code == 401:
                raise PermissionError("401 Unauthorized: check EARTHDATA_TOKEN and approve the ASF app in Earthdata Login")
            if r.status_code not in (200, 206):
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code == 200 and len(r.content) > (b - a + 1) * 4:
                raise IOError("server ignored the Range header")
            self.final_url = r.url
            return r
        raise IOError(f"giving up after retries ({'HTTP ' + str(r.status_code) if r is not None else 'network errors'}) for {self.url}")

    def _block(self, i):
        if i in self.cache:
            self.cache.move_to_end(i)
            return self.cache[i]
        a = i * self.block
        b = min(a + self.block, self.size) - 1
        data = self._get(a, b).content
        self.cache[i] = data
        if len(self.cache) > self.max_blocks:
            self.cache.popitem(last=False)
        return data

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        out, p, end = bytearray(), self.pos, self.pos + n
        while p < end:
            i = p // self.block
            blk = self._block(i)
            s = p - i * self.block
            take = min(len(blk) - s, end - p)
            out += blk[s:s + take]
            p += take
        b[:n] = out
        self.pos = end
        return n


def earthdata_session(token):
    s = requests.Session()
    s.headers.update({**UA, "Authorization": f"Bearer {token}"})
    return s


def open_h5(url_or_path, session):
    import h5py
    if os.path.exists(str(url_or_path)):
        return h5py.File(url_or_path, "r"), None
    rf = RangeFile(url_or_path, session)
    return h5py.File(io.BufferedReader(rf, buffer_size=2**20), "r"), rf


# ----------------------------------------------------------------------------------------------
# Generic readers for NISAR GCOV and SME2 (search the HDF5 tree instead of hard-coding paths)
# ----------------------------------------------------------------------------------------------
def list_datasets(h5):
    out = []
    h5.visititems(lambda n, o: out.append((n, o)) if hasattr(o, "shape") else None)
    return out


def print_tree(h5, max_items=400):
    for i, (n, o) in enumerate(list_datasets(h5)):
        if i >= max_items:
            log("   ...")
            break
        attrs = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in list(o.attrs.items())[:4]}
        log(f"   {n}  shape={o.shape} dtype={o.dtype} {attrs if attrs else ''}")


def _epsg_from(group_or_ds):
    for obj in (group_or_ds,):
        for k, v in obj.attrs.items():
            if "epsg" in k.lower():
                try:
                    return int(np.array(v).ravel()[0])
                except Exception:  # noqa: BLE001
                    pass
    return None


def find_epsg(h5, grid_path):
    """Look for a 'projection' dataset/attribute near the grid."""
    parts = grid_path.split("/")
    for i in range(len(parts), 0, -1):
        base = "/".join(parts[:i])
        for cand in (f"{base}/projection", base):
            if cand in h5:
                e = _epsg_from(h5[cand])
                if e:
                    return e
                try:
                    val = h5[cand][()]
                    if np.issubdtype(np.array(val).dtype, np.integer) and 1000 < int(val) < 100000:
                        return int(val)
                except Exception:  # noqa: BLE001
                    pass
    return None


def coords_for(h5, ds_path):
    """Find xCoordinates / yCoordinates for a dataset (same group or parents)."""
    parts = ds_path.split("/")[:-1]
    for i in range(len(parts), 0, -1):
        base = "/".join(parts[:i])
        xs = [f"{base}/{n}" for n in ("xCoordinates", "x", "easting")]
        ys = [f"{base}/{n}" for n in ("yCoordinates", "y", "northing")]
        x = next((p for p in xs if p in h5), None)
        y = next((p for p in ys if p in h5), None)
        if x and y:
            return h5[x][()], h5[y][()], base
    raise KeyError(f"no x/y coordinates found for {ds_path}")


def window_from_bbox(x, y, epsg, bbox):
    from pyproj import Transformer
    tr = Transformer.from_crs(4326, epsg, always_xy=True)
    lon0, lat0, lon1, lat1 = bbox
    xs, ys = tr.transform([lon0, lon1, lon0, lon1], [lat0, lat0, lat1, lat1])
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    jx = np.where((x >= xmin) & (x <= xmax))[0]
    iy = np.where((y >= ymin) & (y <= ymax))[0]
    if len(jx) == 0 or len(iy) == 0:
        raise ValueError("area of interest is outside this product")
    return slice(iy.min(), iy.max() + 1), slice(jx.min(), jx.max() + 1)


def read_gcov(h5, bbox, pols=("HHHH", "HVHV", "VVVV", "VHVH")):
    dsets = dict(list_datasets(h5))
    out, meta = {}, None
    for pol in pols:
        cands = [n for n in dsets if n.endswith("/" + pol) and "frequencyA" in n] or \
                [n for n in dsets if n.endswith("/" + pol)]
        if not cands:
            continue
        p = cands[0]
        if meta is None:
            x, y, base = coords_for(h5, p)
            epsg = find_epsg(h5, base)
            if not epsg:
                raise KeyError("EPSG code not found (run with --inspect and send the output)")
            rs, cs = window_from_bbox(x, y, epsg, bbox)
            meta = {"epsg": epsg, "x": x[cs], "y": y[rs], "rows": rs, "cols": cs}
        out[pol[:2]] = np.array(h5[p][meta["rows"], meta["cols"]], dtype="float32")
    if not out:
        raise KeyError("no HHHH/HVHV dataset found (run with --inspect)")
    return out, meta


def read_sme2(h5, bbox):
    dsets = dict(list_datasets(h5))
    cands = [n for n, o in dsets.items() if len(o.shape) == 2 and re.search(r"soil.?moisture", n, re.I)
             and not re.search(r"(uncert|std|error|flag|qual|mask|count)", n, re.I)]
    if not cands:
        cands = [n for n, o in dsets.items() if len(o.shape) == 2 and re.search(r"(sm|moist)", n.split("/")[-1], re.I)]
    if not cands:
        raise KeyError("no soil-moisture dataset found (run with --inspect)")
    p = sorted(cands, key=len)[0]
    x, y, base = coords_for(h5, p)
    epsg = find_epsg(h5, base) or 6933  # EASE-Grid 2.0 global
    rs, cs = window_from_bbox(x, y, epsg, bbox)
    arr = np.array(h5[p][rs, cs], dtype="float32")
    fill = h5[p].attrs.get("_FillValue")
    if fill is not None:
        arr[arr == np.array(fill).ravel()[0]] = np.nan
    arr[(arr < 0) | (arr > 1.0)] = np.nan  # volumetric m3/m3
    return arr, {"epsg": epsg, "x": x[cs], "y": y[rs], "dataset": p}


# ----------------------------------------------------------------------------------------------
# Analysis helpers
# ----------------------------------------------------------------------------------------------
def db(a):
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(np.where(a > 0, a, np.nan))


def boxcar(a, k=5):
    """k x k mean filter in linear power, NaN-aware (reduces speckle before change detection)."""
    a = np.asarray(a, dtype="float64")
    valid = np.isfinite(a)
    v = np.where(valid, a, 0.0)
    pad = k // 2
    def csum(z):
        z = np.pad(z, ((pad + 1, pad), (pad + 1, pad)))
        c = z.cumsum(0).cumsum(1)
        return c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    n = csum(valid.astype("float64"))
    with np.errstate(invalid="ignore", divide="ignore"):
        out = csum(v) / n
    out[n == 0] = np.nan
    return out.astype("float32")


def otsu(values, bins=256):
    v = values[np.isfinite(values)]
    if v.size < 100:
        return -18.0
    hist, edges = np.histogram(v, bins=bins)
    w = np.cumsum(hist)
    mu = np.cumsum(hist * (edges[:-1] + edges[1:]) / 2)
    w1, w2 = w, w[-1] - w
    m1 = mu / np.maximum(w1, 1)
    m2 = (mu[-1] - mu) / np.maximum(w2, 1)
    k = np.argmax(w1 * w2 * (m1 - m2) ** 2)
    return float(edges[k + 1])


def sub_window(meta, bbox):
    rs, cs = window_from_bbox(meta["x"], meta["y"], meta["epsg"], bbox)
    return rs, cs


def pixel_area_m2(meta):
    return abs(float(np.median(np.diff(meta["x"])))) * abs(float(np.median(np.diff(meta["y"]))))


def align(a, b):
    r, c = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    return a[:r, :c], b[:r, :c]


def save_png(arr, path, title, vmin, vmax, cmap="gray", extent=None, cbar="dB"):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(7, 7), dpi=110)
    im = ax.imshow(arr, vmin=vmin, vmax=vmax, cmap=cmap, extent=extent, interpolation="nearest")
    ax.set_title(title, fontsize=10)
    ax.set_xlabel("km (east)")
    ax.set_ylabel("km (north)")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label=cbar)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def save_rgb(hh, hv, path, title, extent=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    def scale(a, lo, hi):
        return np.clip((a - lo) / (hi - lo), 0, 1)
    r, g = scale(db(hh), -25, 0), scale(db(hv), -32, -8)
    b = scale(db(hh) - db(hv), 2, 16)
    rgb = np.dstack([np.nan_to_num(r), np.nan_to_num(g), np.nan_to_num(b)])
    fig, ax = plt.subplots(figsize=(7, 7), dpi=110)
    ax.imshow(rgb, extent=extent, interpolation="nearest")
    ax.set_title(title + "\nR=HH  G=HV (vegetation)  B=HH/HV  · water = dark", fontsize=9)
    ax.set_xlabel("km (east)")
    ax.set_ylabel("km (north)")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def extent_km(meta):
    x, y = meta["x"], meta["y"]
    return [(x.min() - x.min()) / 1e3, (x.max() - x.min()) / 1e3, (y.min() - y.min()) / 1e3, (y.max() - y.min()) / 1e3]


# ----------------------------------------------------------------------------------------------
# Search NISAR products
# ----------------------------------------------------------------------------------------------
def search_products(bbox, start, end):
    import asf_search as asf
    from shapely.geometry import box
    res = asf.search(dataset=asf.DATASET.NISAR, processingLevel=["GCOV", "SME2"],
                     intersectsWith=box(*bbox).wkt, start=start, end=end)
    rows = []
    for r in res:
        p = r.properties
        size = sum(int(v.get("bytes") or 0) for v in (p.get("bytes") or {}).values() if isinstance(v, dict))
        h5 = [u for u in [p.get("url")] + (p.get("additionalUrls") or []) if u and u.endswith(".h5")]
        rows.append({"scene": p.get("sceneName") or p.get("fileID"), "product": p.get("processingLevel"),
                     "dir": p.get("flightDirection"), "track": p.get("pathNumber"), "frame": p.get("frameNumber"),
                     "date": str(p.get("startTime"))[:10], "bw": "+".join(map(str, p.get("rangeBandwidth") or [])),
                     "size_GB": round(size / 1e9, 2), "url": h5[0] if h5 else p.get("url")})
    return pd.DataFrame(rows)


def pick_dates(df, product, stack, n):
    d, t, f = stack
    s = df[(df["product"] == product) & (df["dir"] == d) & (df["track"] == t) & (df["frame"] == f)].copy()
    s = s[s["date"] >= EVENT.isoformat()]
    if s.empty:
        return s
    if product == "GCOV" and s["bw"].nunique() > 1:  # same mode on all dates if possible, else smallest
        common = s.groupby("bw")["date"].nunique().sort_values(ascending=False)
        best = [bw for bw, k in common.items() if k == common.max()]
        s = s[s["bw"].isin(best)]
    s = s.sort_values(["date", "size_GB"]).groupby("date").head(1)
    return s.head(n)


# ----------------------------------------------------------------------------------------------
# Optional: Sentinel-1 RTC and ESA WorldCover from Microsoft Planetary Computer
# ----------------------------------------------------------------------------------------------
def pc_items(collection, bbox, datetime_range):
    import planetary_computer
    import pystac_client
    cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1",
                                    modifier=planetary_computer.sign_inplace)
    return list(cat.search(collections=[collection], bbox=bbox, datetime=datetime_range).items())


def read_cog_window(href, bbox, dst_meta=None):
    import rasterio
    from rasterio.warp import Resampling, reproject, transform_bounds
    from rasterio.windows import from_bounds
    with rasterio.open(href) as src:
        b = transform_bounds("EPSG:4326", src.crs, *bbox)
        win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        arr = src.read(1, window=win, boundless=True, fill_value=0).astype("float32")
        tr = src.window_transform(win)
        if dst_meta is None:
            return arr, tr, src.crs
        from rasterio.transform import from_origin
        x, y = dst_meta["x"], dst_meta["y"]
        dx, dy = float(np.median(np.diff(x))), float(np.median(np.diff(y)))
        dst_tr = from_origin(x.min() - abs(dx) / 2, y.max() + abs(dy) / 2, abs(dx), abs(dy))
        dst = np.zeros((len(y), len(x)), dtype="float32")
        reproject(arr, dst, src_transform=tr, src_crs=src.crs, dst_transform=dst_tr,
                  dst_crs=f"EPSG:{dst_meta['epsg']}", resampling=Resampling.nearest)
        if y[0] < y[-1]:  # NISAR rows south->north: flip to match
            dst = dst[::-1]
        return dst, dst_tr, f"EPSG:{dst_meta['epsg']}"


def sentinel1_check(bbox, out, rows):
    log("\n[S1] Sentinel-1 C-band RTC (Planetary Computer): before vs after the failure")
    try:
        items = pc_items("sentinel-1-rtc", bbox, f"{(EVENT - dt.timedelta(days=14)).isoformat()}/"
                                                 f"{(EVENT + dt.timedelta(days=14)).isoformat()}")
    except Exception as exc:  # noqa: BLE001
        log(f"  ! not available: {exc}")
        return
    if not items:
        log("  no Sentinel-1 RTC items found for these dates (try Copernicus Browser by hand)")
        return
    items.sort(key=lambda it: it.datetime)
    pre = [it for it in items if it.datetime.date() < EVENT]
    post = [it for it in items if it.datetime.date() >= EVENT]
    log(f"  {len(pre)} images before, {len(post)} after: " + ", ".join(it.datetime.date().isoformat() for it in items))

    def orbit(it):
        p = getattr(it, "properties", {}) or {}
        return p.get("sat:relative_orbit"), p.get("sat:orbit_state")

    done = 0
    for o in dict.fromkeys(orbit(it) for it in post):  # same orbit before/after = same viewing geometry
        p_after = [it for it in post if orbit(it) == o]
        p_before = [it for it in pre if orbit(it) == o]
        if not p_after or not p_before or done >= 2:
            continue
        b, a = p_before[-1], p_after[0]
        tag = f"orbit{o[0]}" if o[0] is not None else "s1"
        arrs = {}
        for it, label in ((b, "before"), (a, "after")):
            try:
                key = "vv" if "vv" in it.assets else next(iter(it.assets))
                arr, _, _ = read_cog_window(it.assets[key].href, bbox)
                arr[arr <= 0] = np.nan
            except Exception as exc:  # noqa: BLE001
                log(f"  ! could not read {it.datetime.date()}: {exc}")
                continue
            d = it.datetime.strftime("%Y-%m-%d_%H%M")
            arrs[label] = (d, db(arr))
            save_png(arrs[label][1], out / f"s1_{tag}_{d}.png", f"Sentinel-1 C-band VV {d} UTC ({label} the failure)", -25, 0)
            rows.append({"what": f"Sentinel-1 VV image ({label}, {tag})", "date": d, "value": "", "file": f"s1_{tag}_{d}.png"})
        if len(arrs) == 2:
            (d0, a0), (d1, a1) = arrs["before"], arrs["after"]
            a0, a1 = align(a0, a1)
            f = f"s1_{tag}_change.png"
            save_png(a1 - a0, out / f, f"Sentinel-1 change {d1} minus {d0} (dB)\nblue = darker after (water), red = brighter",
                     -6, 6, "RdBu_r", cbar="ΔdB")
            rows.append({"what": f"Sentinel-1 change map ({tag})", "date": f"{d0} -> {d1}", "value": "", "file": f})
            done += 1
    if not done:
        log("  no before/after pair on the same orbit")


def main():
    ap = argparse.ArgumentParser(description="Mellègue go/no-go test with NISAR")
    ap.add_argument("--bbox", nargs=4, type=float, default=DEFAULT_BBOX, metavar=("LON0", "LAT0", "LON1", "LAT1"))
    ap.add_argument("--reservoir", nargs=4, type=float, default=DEFAULT_RESERVOIR, metavar=("LON0", "LAT0", "LON1", "LAT1"))
    ap.add_argument("--dates", type=int, default=3, help="number of post-event dates per stack (default 3)")
    ap.add_argument("--end", default="2026-07-20")
    ap.add_argument("--inspect", action="store_true", help="print HDF5 structure and stop")
    ap.add_argument("--filter", type=int, default=7, help="speckle filter window (pixels) for change maps")
    ap.add_argument("--water-db", type=float, default=-18.0, help="max HH dB counted as open water (default -18)")
    ap.add_argument("--skip-s1", action="store_true")
    ap.add_argument("--skip-worldcover", action="store_true")
    ap.add_argument("--out", default="mellegue_test_output")
    args = ap.parse_args()
    out = Path(args.out)
    (out / "cache").mkdir(parents=True, exist_ok=True)

    token = os.environ.get("EARTHDATA_TOKEN") or getpass.getpass("Earthdata token (input hidden): ").strip()
    session = earthdata_session(token)

    log("[1] Searching NISAR GCOV + SME2 over the Mellègue area...")
    prods = search_products(args.bbox, (EVENT - dt.timedelta(days=3)).isoformat(), args.end)
    if prods.empty:
        sys.exit("No NISAR products found.")
    prods.to_csv(out / "products_found.csv", index=False)
    log(prods.groupby(["product", "dir", "track", "frame"])["date"].apply(lambda s: ", ".join(sorted(set(s)))).to_string())

    if args.inspect:
        for prod in ("GCOV", "SME2"):
            row = prods[prods["product"] == prod].iloc[0]
            log(f"\n--- {prod}: {row['scene']}")
            h5, rf = open_h5(row["url"], session)
            print_tree(h5)
            h5.close()
        return

    rows, html = [], []
    change_masks = []
    for stack in STACKS:
        tag = f"{stack[0][0]}{stack[1]}_F{stack[2]}"
        g = pick_dates(prods, "GCOV", stack, args.dates)
        if g.empty:
            log(f"\n[2] {tag}: no GCOV after the event, skipped")
            continue
        log(f"\n[2] GCOV stack {tag}: {', '.join(g['date'])} (mode {g['bw'].iloc[0]} MHz)")
        imgs = []
        for _, r in g.iterrows():
            bbox_key = "_".join(f"{v:.2f}" for v in args.bbox)
            cache = out / "cache" / f"{r['scene']}_{bbox_key}.npz"
            if cache.exists():
                z = np.load(cache, allow_pickle=True)
                bands, meta = {k: z[k] for k in z.files if k in ("HH", "HV", "VV", "VH")}, z["meta"].item()
            else:
                t0 = time.time()
                try:
                    h5, rf = open_h5(r["url"], session)
                    bands, meta = read_gcov(h5, args.bbox)
                    h5.close()
                except Exception as exc:  # noqa: BLE001
                    log(f"    ! {r['date']}: {exc}  -> skipped (rerun later: finished dates are cached)")
                    continue
                np.savez_compressed(cache, meta=np.array(meta, dtype=object), **bands)
                log(f"    {r['date']}: read {bands['HH'].shape} px in {time.time()-t0:.0f}s"
                    f"{f' ({rf.n_requests} HTTP requests)' if rf else ''}")
            imgs.append((r["date"], bands, meta))

        if not imgs:
            continue
        ext = extent_km(imgs[0][2])
        flip = bool(imgs[0][2]["y"][0] < imgs[0][2]["y"][-1])
        fix = (lambda a: a[::-1]) if flip else (lambda a: a)
        for d, bands, meta in imgs:
            hh, hv = fix(bands["HH"]), fix(bands.get("HV", bands["HH"]))
            save_rgb(hh, hv, out / f"nisar_{tag}_{d}_rgb.png", f"NISAR L-band GCOV {tag}  {d}", ext)
            save_png(db(hh), out / f"nisar_{tag}_{d}_HH.png", f"NISAR HH {tag} {d}", -25, 0, extent=ext)
            # reservoir water area
            rs, cs = sub_window(meta, args.reservoir)
            sub = db(boxcar(bands["HH"][rs, cs], 3))
            thr = min(otsu(sub), args.water_db)   # Otsu on a land-dominated box can pick a land/land split
            wmask = sub < thr
            save_png(np.where(wmask, 1.0, np.nan)[::-1] if flip else np.where(wmask, 1.0, np.nan),
                     out / f"water_{tag}_{d}.png", f"Water mask (HH < {thr:.1f} dB) {tag} {d}", 0, 1, "Blues")
            zoom = sub[::-1] if flip else sub
            save_png(zoom, out / f"reservoir_{tag}_{d}_HH.png", f"Reservoir box, NISAR HH {tag} {d}", -25, 0)
            html.append((f"Reservoir zoom {tag} {d}", f"reservoir_{tag}_{d}_HH.png"))
            water = np.nansum(wmask) * pixel_area_m2(meta) / 1e6
            rows.append({"what": f"Reservoir water area ({tag}, HH<{thr:.1f} dB)", "date": d,
                         "value": round(water, 3), "file": f"nisar_{tag}_{d}_rgb.png"})
            html.append((f"NISAR {tag} {d}", f"nisar_{tag}_{d}_rgb.png"))
        # change maps between first post-event date and later dates
        d0, b0, m0 = imgs[0]
        for d1, b1, _ in imgs[1:]:
            for pol in ("HH", "HV"):
                if pol in b0 and pol in b1:
                    a0, a1 = align(db(boxcar(b0[pol], args.filter)), db(boxcar(b1[pol], args.filter)))
                    dd = fix(a0 - a1)  # positive = brighter on first post-event date (wetter / flooded vegetation)
                    f = f"nisar_{tag}_change_{pol}_{d0}_vs_{d1}.png"
                    save_png(dd, out / f, f"NISAR {pol}: {d0} minus {d1}\nred = brighter just after the failure "
                             f"(wet soil / flooded vegetation), blue = darker (open water)", -6, 6, "RdBu_r", ext, "ΔdB")
                    html.append((f"Change {pol} {d0} vs {d1}", f))
                    if pol == "HH":
                        noise = float(np.nanstd(dd))
                        thr = max(3.0, 3 * 1.4826 * float(np.nanmedian(np.abs(dd - np.nanmedian(dd)))))
                        wet = np.nansum(dd > thr) * pixel_area_m2(m0) / 1e6
                        dark = np.nansum(dd < -thr) * pixel_area_m2(m0) / 1e6
                        rows.append({"what": f"Change noise level std ({tag}, {d0} vs {d1}); threshold used", "date": d0,
                                     "value": f"{noise:.2f} dB; ±{thr:.1f} dB", "file": f})
                        rows.append({"what": f"Area brighter on {d0} than {d1} ({tag})", "date": d0,
                                     "value": round(wet, 2), "file": f})
                        rows.append({"what": f"Area darker on {d0} than {d1} ({tag})", "date": d0,
                                     "value": round(dark, 2), "file": f})
                        if d1 == imgs[1][0]:
                            change_masks.append((tag, a0 - a1, m0, thr))

        # SME2 soil moisture on the same track
        s = pick_dates(prods, "SME2", stack, args.dates)
        sm = []
        for _, r in s.iterrows():
            try:
                h5, _ = open_h5(r["url"], session)
                arr, smeta = read_sme2(h5, args.bbox)
                h5.close()
                sm.append((r["date"], arr, smeta))
                rows.append({"what": f"Mean soil moisture m³/m³ ({tag})", "date": r["date"],
                             "value": round(float(np.nanmean(arr)), 4), "file": ""})
            except Exception as exc:  # noqa: BLE001
                log(f"    ! SME2 {r['date']}: {exc}  (run --inspect and send the output)")
        if sm:
            smext = extent_km(sm[0][2])
            fl = sm[0][2]["y"][0] < sm[0][2]["y"][-1]
            for d, arr, _ in sm:
                save_png(arr[::-1] if fl else arr, out / f"sme2_{tag}_{d}.png", f"NISAR soil moisture (SME2) {tag} {d}",
                         0, 0.4, "YlGnBu", smext, "m³/m³")
                html.append((f"Soil moisture {tag} {d}", f"sme2_{tag}_{d}.png"))
            if len(sm) > 1:
                a0, a1 = align(sm[0][1], sm[1][1])
                dd = a0 - a1
                f = f"sme2_{tag}_change_{sm[0][0]}_vs_{sm[1][0]}.png"
                save_png(dd[::-1] if fl else dd, out / f, f"Soil moisture {sm[0][0]} minus {sm[1][0]}\nblue = wetter just after the failure",
                         -0.15, 0.15, "BrBG", smext, "Δ m³/m³")
                html.append((f"Soil moisture change {tag}", f))

    # Land cover where NISAR saw change
    if change_masks and not args.skip_worldcover:
        log("\n[3] ESA WorldCover land cover in the changed pixels (Planetary Computer)")
        try:
            items = pc_items("esa-worldcover", args.bbox, "2021-01-01/2021-12-31")
            tag, dd, m0, thr = change_masks[0]
            lc = None
            for it in items:
                a, _, _ = read_cog_window(it.assets["map"].href, args.bbox, m0)
                lc = a if lc is None else np.where(lc > 0, lc, a)
            lc, dd = align(lc, dd)
            for label, mask in (("whole area", np.isfinite(dd)), ("brighter after failure (wet?)", dd > thr),
                                ("darker after failure (water?)", dd < -thr)):
                vals, counts = np.unique(lc[mask & (lc > 0)], return_counts=True)
                tot = counts.sum() or 1
                desc = ", ".join(f"{WORLDCOVER.get(int(v), v)} {100*c/tot:.0f}%" for v, c in
                                 sorted(zip(vals, counts), key=lambda t: -t[1])[:5])
                log(f"   {label}: {desc}")
                rows.append({"what": f"Land cover, {label} ({tag})", "date": "", "value": desc, "file": ""})
        except Exception as exc:  # noqa: BLE001
            log(f"  ! WorldCover not available: {exc}")

    if not args.skip_s1:
        try:
            sentinel1_check(args.bbox, out, rows)
        except Exception as exc:  # noqa: BLE001
            log(f"  ! Sentinel-1 step failed: {exc}")
        for f in sorted(out.glob("s1_*.png")):
            html.append((f.stem, f.name))

    # Report
    res = pd.DataFrame(rows)
    res.to_csv(out / "results.csv", index=False)
    log("\n" + "=" * 80 + "\nRESULTS\n" + "=" * 80)
    with pd.option_context("display.max_colwidth", 90, "display.width", 200):
        log(res[["what", "date", "value"]].to_string(index=False))

    verdict = []
    ra = res[res["what"].str.startswith("Reservoir water area")]
    if len(ra) > 1:
        v = ra["value"].astype(float).values
        verdict.append(f"Reservoir: water area {v[0]:.2f} -> {v[-1]:.2f} km² over the stack "
                       f"({'changes' if abs(v[-1]-v[0]) > 0.1*max(v[0],1e-6) else 'stable within 10%'}).")
    wet = res[res["what"].str.startswith("Area brighter on")]
    if len(wet):
        w = wet["value"].astype(float).max()
        verdict.append(f"Valley: up to {w:.2f} km² significantly brighter right after the failure "
                       f"({'a footprint worth showing' if w > 0.5 else 'little or no footprint'}).")
    (out / "report.md").write_text("# Mellègue go/no-go test\n\n" + "\n".join(f"- {v}" for v in verdict) +
                                   "\n\nSee results.csv and index.html.\n", encoding="utf-8")
    page = ["<html><head><meta charset='utf-8'><title>Mellègue test</title><style>body{font-family:sans-serif;"
            "background:#111;color:#eee}div{display:inline-block;margin:6px;vertical-align:top}img{width:460px}"
            "</style></head><body><h2>Mellègue go/no-go test</h2><ul>"] + [f"<li>{v}</li>" for v in verdict] + ["</ul>"]
    page += [f"<div><b>{t}</b><br><img src='{f}'></div>" for t, f in html]
    page.append("</body></html>")
    (out / "index.html").write_text("\n".join(page), encoding="utf-8")
    log("\n" + "\n".join(verdict))
    log(f"\nOpen {out/'index.html'} to look at all maps side by side.")


if __name__ == "__main__":
    main()