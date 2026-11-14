#!/usr/bin/env python3
"""00b · Irrigated cropland in the Mellègue–Medjerda valley (replaces a hand-drawn "Jendouba irrigated perimeter").

No public GIS layer of the official irrigated perimeters exists (OSM has none). Two independent measurements:
  1. NASA LGRIP30 v001 (Landsat-derived Global Rainfed and Irrigated-Cropland Product, 30 m, nominal 2015, LP DAAC).
  2. Sentinel-2 summer greenness 2026: in this semi-arid valley rainfed cereals are harvested by June, so cropland
     that is still green in July–August (median NDVI > threshold) is irrigated (or orchards). Classic dry-season test.
Finding (14 Nov): LGRIP30's irrigated class covers ~77% of all cropland here (over-inclusive), but contains ~90% of
the fields still green in summer 2026. So the web layer = summer-2026 green cropland (S2), with LGRIP30 as the check;
LGRIP30-only areas are reported but not drawn.

Outputs: work/irrigation/{lgrip30_2015_30m.tif, s2_summer_ndvi_30m.tif, irrigated_class_30m.tif, report.json}
         <bundle>/vectors/irrigated.geojson (EPSG:32632 metres)
  python pipeline/00b_irrigation.py [--ndvi 0.35]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)

import numpy as np  # noqa: E402

LGRIP_URL = ("https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/LGRIP30.001/"
             "LGRIP30_2015_N30E00_001_2023014175240/LGRIP30_2015_N30E00_001_2023014175240.tif")
BBOX = [8.55, 36.20, 9.50, 36.70]           # dam → Jendouba → Bou Salem → Sidi Salem (same as WorldCover 10 m)
PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"


def bundle_mod():
    spec = importlib.util.spec_from_file_location("bundle08", Path(__file__).with_name("08_bundle.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def analysis_grid():
    """Sub-window of the 30 m analysis DEM grid covering BBOX."""
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.warp import transform_bounds
    with rasterio.open(common.ROOT / "work/dem_32632_30m.tif") as src:
        b = transform_bounds("EPSG:4326", src.crs, *BBOX)
        win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        win = win.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        return src.window_transform(win), (int(win.height), int(win.width)), src.crs, win


def download(url: Path | str, dst: Path):
    import requests
    if dst.exists() and dst.stat().st_size > 1_000_000:
        return dst
    common.load_env()
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {os.environ['EARTHDATA_TOKEN']}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".part")
    with s.get(str(url), stream=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    if total and tmp.stat().st_size != total:
        raise IOError(f"incomplete download {tmp.stat().st_size}/{total}")
    tmp.replace(dst)
    return dst


def to_grid(src_path_or_ds, band, tr, shape, crs, resampling, src_nodata=None):
    import rasterio
    from rasterio.warp import Resampling, reproject
    dst = np.full(shape, np.nan, np.float32)
    with rasterio.open(src_path_or_ds) as src:
        reproject(rasterio.band(src, band), dst, src_nodata=src_nodata if src_nodata is not None else src.nodata,
                  dst_nodata=np.nan, dst_transform=tr, dst_crs=crs, resampling=getattr(Resampling, resampling))
    return dst


def s2_summer_ndvi(tr, shape, crs, months=("2026-07-01", "2026-08-31"), per_tile=4):
    import planetary_computer as pc
    import pystac_client
    import rasterio
    from rasterio.warp import Resampling, reproject
    cat = pystac_client.Client.open(PC_STAC, modifier=pc.sign_inplace)
    items = cat.search(collections=["sentinel-2-l2a"], bbox=BBOX, datetime="/".join(months),
                       query={"eo:cloud_cover": {"lt": 10}}).item_collection()
    by_tile: dict[str, list] = {}
    for it in sorted(items, key=lambda i: i.properties["eo:cloud_cover"]):
        by_tile.setdefault(it.properties.get("s2:mgrs_tile", it.id), []).append(it)
    items = [it for lst in by_tile.values() for it in lst[:per_tile]]
    ndvis = []
    for it in items:
        bands = {}
        for b in ("B04", "B08", "SCL"):
            a = np.full(shape, np.nan, np.float32)
            with rasterio.open(it.assets[b].href) as src:
                reproject(rasterio.band(src, 1), a, src_nodata=0, dst_nodata=np.nan, dst_transform=tr, dst_crs=crs,
                          resampling=Resampling.nearest if b == "SCL" else Resampling.average)
            bands[b] = a
        clear = np.isin(bands["SCL"], [4, 5, 6])          # vegetation, bare soil, water
        nd = (bands["B08"] - bands["B04"]) / (bands["B08"] + bands["B04"] + 1e-6)
        nd[~clear] = np.nan
        ndvis.append(nd)
    med = np.nanmedian(np.stack(ndvis), axis=0)
    return med, [i.id for i in items], sorted(by_tile)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=common.ROOT / "config.yaml")
    ap.add_argument("--ndvi", type=float, default=0.30, help="summer median NDVI above which cropland is irrigated")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    out = common.bundle_dir(cfg)
    work = common.ROOT / "work/irrigation"
    work.mkdir(parents=True, exist_ok=True)
    import rasterio

    tr, shape, crs, win = analysis_grid()
    print(f"valley grid {shape[1]}×{shape[0]} @ 30 m")

    # 1) LGRIP30 2015 (classes: 0 water, 1 non-cropland, 2 irrigated, 3 rainfed — checked below)
    raw = download(LGRIP_URL, common.ROOT / "cache/context/lgrip30/LGRIP30_2015_N30E00_001.tif")
    lg = to_grid(raw, 1, tr, shape, crs, "nearest")
    vals, cnt = np.unique(lg[np.isfinite(lg)], return_counts=True)
    print("LGRIP30 class counts:", dict(zip(vals.astype(int).tolist(), cnt.tolist())))
    lg_irr = lg == 2
    lg_rain = lg == 3

    # 2) WorldCover cropland (class 40) on the same grid
    with rasterio.open(common.ROOT / "work/worldcover_30m.tif") as src:
        wc = src.read(1, window=win)
    crop = wc == 40

    # 3) Sentinel-2 summer 2026 greenness
    ndvi_tif = work / "s2_summer_ndvi_30m.tif"
    if ndvi_tif.exists():
        with rasterio.open(ndvi_tif) as src:
            ndvi = src.read(1)
        s2_ids, tiles = json.loads((work / "s2_items.json").read_text())
    else:
        ndvi, s2_ids, tiles = s2_summer_ndvi(tr, shape, crs)
        with rasterio.open(ndvi_tif, "w", driver="GTiff", height=shape[0], width=shape[1], count=1, dtype="float32",
                           crs=crs, transform=tr, compress="deflate", predictor=3) as o:
            o.write(ndvi.astype(np.float32), 1)
        (work / "s2_items.json").write_text(json.dumps([s2_ids, tiles]))
    s2_irr = crop & (ndvi > args.ndvi)

    # 4) classes: 1 both, 2 S2-2026 only, 3 LGRIP-2015 only
    cls = np.zeros(shape, np.uint8)
    cls[s2_irr & lg_irr] = 1
    cls[s2_irr & ~lg_irr] = 2
    cls[~s2_irr & lg_irr] = 3
    from scipy import ndimage as ndi
    cls = np.where(ndi.median_filter(cls, size=3) > 0, ndi.median_filter(cls, size=3), 0).astype(np.uint8)
    with rasterio.open(work / "irrigated_class_30m.tif", "w", driver="GTiff", height=shape[0], width=shape[1], count=1,
                       dtype="uint8", crs=crs, transform=tr, compress="deflate") as o:
        o.write(cls, 1)

    ha = 0.09  # 30 m cell
    agree = cropland = int(crop.sum())
    both, s2o, lgo = int((cls == 1).sum()), int((cls == 2).sum()), int((cls == 3).sum())
    a = s2_irr[crop]
    b = lg_irr[crop]
    po = float((a == b).mean()) if crop.any() else np.nan
    pe = float(a.mean() * b.mean() + (1 - a.mean()) * (1 - b.mean())) if crop.any() else np.nan
    kappa = (po - pe) / (1 - pe) if pe < 1 else np.nan
    rep = dict(grid=[shape[1], shape[0]], ndvi_threshold=args.ndvi, s2_scenes=len(s2_ids), s2_tiles=tiles,
               cropland_worldcover_ha=round(cropland * ha), lgrip30_irrigated_ha=round(int(lg_irr.sum()) * ha),
               lgrip30_rainfed_ha=round(int(lg_rain.sum()) * ha), s2_summer_green_cropland_ha=round(int(s2_irr.sum()) * ha),
               both_ha=round(both * ha), s2_only_ha=round(s2o * ha), lgrip_only_ha=round(lgo * ha),
               agreement_within_cropland=round(po, 3), cohen_kappa=round(kappa, 3),
               s2_green_inside_lgrip_irrigated=round(float(lg_irr[s2_irr].mean()), 3) if s2_irr.any() else None,
               lgrip_irrigated_share_of_cropland=round(float(lg_irr[crop].mean()), 3) if crop.any() else None,
               ndvi_summer_cropland_p50=round(float(np.nanmedian(ndvi[crop])), 3))
    (work / "report.json").write_text(json.dumps(rep, indent=1))
    print(json.dumps(rep, indent=1))

    # 5) web vector: polygons ≥ 2 ha, simplified
    import rasterio.features
    from shapely.geometry import mapping, shape as shp
    feats = []
    labels = {1: "both (S2 2026 + LGRIP30 2015)", 2: "Sentinel-2 summer 2026 only", 3: "LGRIP30 2015 only"}
    for geom, v in rasterio.features.shapes(cls, mask=cls > 0, transform=tr):
        g = shp(geom)
        if int(v) == 3 or g.area < 20000:      # LGRIP30-only: over-inclusive here, not drawn
            continue
        g = g.simplify(20)
        m = mapping(g)

        def rnd(c):
            return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0]), round(c[1])]
        m["coordinates"] = rnd(m["coordinates"])
        feats.append({"type": "Feature", "properties": {"class": int(v), "evidence": labels[int(v)],
                                                        "area_ha": round(g.area / 1e4, 1)}, "geometry": m})
    fc = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32632"}},
          "features": feats}
    (out / "vectors").mkdir(parents=True, exist_ok=True)
    p = out / "vectors/irrigated.geojson"
    p.write_text(json.dumps(fc, separators=(",", ":")), "utf-8")
    print(f"irrigated.geojson: {len(feats)} polygons, {p.stat().st_size / 1e3:.0f} kB")
    b = bundle_mod()
    b.register_layer(out, dict(
        id="irrigated", kind="vector", grid="none", file="vectors/irrigated.geojson",
        label="Irrigated cropland, summer 2026 (Mellègue–Medjerda valley)", badge="MEASURED",
        source="NASA LGRIP30 v001 (LP DAAC, 2015) + ESA Copernicus Sentinel-2 L2A (Jul–Aug 2026) + ESA WorldCover 2021",
        method=f"irrigated = WorldCover cropland with Jul–Aug 2026 median NDVI > {args.ndvi} (rainfed cereals are harvested "
               f"by June); compared with LGRIP30 irrigated class; polygons ≥ 2 ha",
        uncertainty=f"{rep['s2_green_inside_lgrip_irrigated']:.0%} of these fields lie inside LGRIP30's irrigated class; LGRIP30 itself "
                    f"marks {rep['lgrip_irrigated_share_of_cropland']:.0%} of cropland irrigated (over-inclusive here). Orchards also stay green; "
                    f"fields left dry in summer 2026 are missed; not the official CRDA perimeter boundaries",
        placeholder=False), cfg["brand"]["product"], cfg["dam"]["id"], cfg["bundle"]["version"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
