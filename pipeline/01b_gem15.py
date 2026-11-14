#!/usr/bin/env python3
"""01b · GEM-15 (Google Research, experimental, CC-BY 4.0): 15 m bare-earth DTM for the flood valley.

Reads the public COGs (no Earth Engine account needed), mosaics the valley window, converts nothing
(GEM-15 is EGM96, same as NASADEM), fills water / no-data cells from NASADEM and reports how the two differ.

Outputs: work/gem15_dtm_15m.tif (EPSG:32632, 15 m, valley bbox), work/gem15_report.json
  python pipeline/01b_gem15.py
"""
from __future__ import annotations
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
import numpy as np  # noqa: E402

BASE = "https://storage.googleapis.com/climate-and-sustainability/gem-15/p30_p0/{t}/dtm/zall/mosaic.tif"
TILES = ["w8s36", "w9s36"]           # 1° tiles (lon 8–10 E, lat 36–37 N), native EPSG:32632
BBOX = [8.55, 36.20, 9.50, 36.70]    # dam → Medjerda → Sidi Salem (same box as the 10 m WorldCover)


def main() -> int:
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject, transform_bounds
    b = transform_bounds("EPSG:4326", "EPSG:32632", *BBOX)
    res = 15.0
    x0, y0 = np.floor(b[0] / 30) * 30, np.floor(b[1] / 30) * 30
    x1, y1 = np.ceil(b[2] / 30) * 30, np.ceil(b[3] / 30) * 30
    w, h = int((x1 - x0) / res), int((y1 - y0) / res)
    tr = from_origin(x0, y1, res, res)
    dst = np.full((h, w), np.nan, np.float32)
    for t in TILES:
        with rasterio.open(BASE.format(t=t)) as src:
            tmp = np.full((h, w), np.nan, np.float32)
            reproject(rasterio.band(src, 1), tmp, dst_transform=tr, dst_crs="EPSG:32632", dst_nodata=np.nan,
                      src_nodata=src.nodata, resampling=Resampling.bilinear)
            print(f"  {t}: crs {src.crs} res {src.res} → {np.isfinite(tmp).mean()*100:.1f}% of window")
        dst = np.where(np.isnan(dst), tmp, dst)
    nas = np.full((h, w), np.nan, np.float32)
    with rasterio.open(common.ROOT / "work/dem_32632_30m.tif") as src:
        reproject(rasterio.band(src, 1), nas, dst_transform=tr, dst_crs="EPSG:32632", dst_nodata=np.nan,
                  resampling=Resampling.bilinear)
    valid = np.isfinite(dst)
    diff = (dst - nas)[valid]
    rep = dict(shape=[h, w], res_m=res, valid_frac=round(float(valid.mean()), 4),
               gem15_minus_nasadem_m=dict(median=round(float(np.median(diff)), 2),
                                          p05=round(float(np.percentile(diff, 5)), 2),
                                          p95=round(float(np.percentile(diff, 95)), 2),
                                          mad_sigma=round(float(1.4826 * np.median(np.abs(diff - np.median(diff)))), 2)))
    filled = np.where(valid, dst, nas + rep["gem15_minus_nasadem_m"]["median"])   # gaps (water, masks) from NASADEM
    with rasterio.open(common.ROOT / "work/gem15_dtm_15m.tif", "w", driver="GTiff", height=h, width=w, count=1,
                       dtype="float32", crs="EPSG:32632", transform=tr, compress="deflate", predictor=3, tiled=True) as o:
        o.write(filled.astype(np.float32), 1)
    with rasterio.open(common.ROOT / "work/gem15_valid_15m.tif", "w", driver="GTiff", height=h, width=w, count=1,
                       dtype="uint8", crs="EPSG:32632", transform=tr, compress="deflate") as o:
        o.write(valid.astype(np.uint8), 1)
    (common.ROOT / "work/gem15_report.json").write_text(json.dumps(rep, indent=1))
    print(json.dumps(rep, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
