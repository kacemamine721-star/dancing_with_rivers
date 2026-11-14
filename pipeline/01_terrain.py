#!/usr/bin/env python3
"""01 · Terrain: NASADEM → analysis DEM (UTM 32N, 30 m) + web scene grid (heightmap, hillshade, grid.json).

Outputs
  work/dem_32632_30m.tif                 analysis DEM for routing, HAND, ANUGA (full 30 m)
  <bundle>/terrain/height_scene.png      RG16 heightmap on the WEB scene grid (≤ 2048 px wide)
  <bundle>/terrain/hillshade.png         8-bit hillshade, low NW sun
  <bundle>/terrain/basemap_s2.jpg        optional (--basemap): desaturated Sentinel-2 summer composite
  <bundle>/terrain/grid.json             scene grid + lake-chip grid (contract: Grid)

  python pipeline/01_terrain.py [--dem nasadem|cop-dem-glo-30] [--max-width 2048] [--basemap]
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

import numpy as np  # noqa: E402

PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
DEM_ASSET = {"nasadem": "elevation", "cop-dem-glo-30": "data"}


def bundle_mod():
    spec = importlib.util.spec_from_file_location("bundle08", Path(__file__).with_name("08_bundle.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def utm_bounds(lonlat, crs, snap):
    from pyproj import Transformer
    tr = Transformer.from_crs(4326, crs, always_xy=True)
    lon0, lat0, lon1, lat1 = lonlat
    xs, ys = tr.transform([lon0, lon1, lon0, lon1, (lon0 + lon1) / 2, (lon0 + lon1) / 2],
                          [lat0, lat0, lat1, lat1, lat0, lat1])
    x0, x1 = np.floor(min(xs) / snap) * snap, np.ceil(max(xs) / snap) * snap
    y0, y1 = np.floor(min(ys) / snap) * snap, np.ceil(max(ys) / snap) * snap
    return float(x0), float(y0), float(x1), float(y1)


def fetch_dem(collection: str, lonlat, crs, bounds, res):
    """Mosaic DEM tiles from Planetary Computer and warp them onto the target UTM grid."""
    import planetary_computer as pc
    import pystac_client
    import rasterio
    from rasterio.warp import Resampling, reproject
    from rasterio.transform import from_origin

    cat = pystac_client.Client.open(PC_STAC, modifier=pc.sign_inplace)
    pad = 0.02
    items = list(cat.search(collections=[collection],
                            bbox=[lonlat[0] - pad, lonlat[1] - pad, lonlat[2] + pad, lonlat[3] + pad]).items())
    if not items:
        raise RuntimeError(f"no {collection} tiles found")
    x0, y0, x1, y1 = bounds
    w, h = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
    dst_tr = from_origin(x0, y1, res, res)
    dst = np.full((h, w), np.nan, np.float32)
    for it in items:
        href = it.assets[DEM_ASSET[collection]].href
        with rasterio.open(href) as src:
            tmp = np.full((h, w), np.nan, np.float32)
            reproject(source=rasterio.band(src, 1), destination=tmp, src_nodata=src.nodata, dst_nodata=np.nan,
                      dst_transform=dst_tr, dst_crs=crs, resampling=Resampling.bilinear)
        dst = np.where(np.isnan(dst), tmp, dst)
        print(f"  tile {it.id}: {np.isfinite(tmp).mean() * 100:.0f}% of grid")
    return dst, dst_tr, [it.id for it in items]


def fill_nan(z):
    if not np.isnan(z).any():
        return z
    from scipy import ndimage as ndi
    idx = ndi.distance_transform_edt(np.isnan(z), return_distances=False, return_indices=True)
    return z[tuple(idx)]


def hillshade(z, res, az=315.0, alt=35.0, exag=2.0):
    gy, gx = np.gradient(z * exag, res)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, al = np.radians(az), np.radians(alt)
    hs = np.sin(al) * np.sin(slope) + np.cos(al) * np.cos(slope) * np.cos(a - aspect)
    return np.clip(hs * 255, 0, 255).astype(np.uint8)


def to_rg16(z, scale=0.1, offset=-100.0):
    enc = np.clip(np.round((z - offset) / scale), 0, 65535).astype(np.uint16)
    rgb = np.zeros(z.shape + (3,), np.uint8)
    rgb[..., 0], rgb[..., 1] = enc >> 8, enc & 255
    return rgb


def resample(z, shape):
    from PIL import Image
    return np.asarray(Image.fromarray(z.astype(np.float32), mode="F").resize(shape[::-1], Image.BILINEAR))


def s2_basemap(lonlat, crs, bounds, shape, months=("2026-06-01", "2026-08-31"), per_tile=3):
    """Low-cloud Sentinel-2 L2A median composite (B04,B03,B02), read at the web grid resolution."""
    import planetary_computer as pc
    import pystac_client
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.warp import Resampling, reproject

    cat = pystac_client.Client.open(PC_STAC, modifier=pc.sign_inplace)
    items = cat.search(collections=["sentinel-2-l2a"], bbox=list(lonlat), datetime="/".join(months),
                       query={"eo:cloud_cover": {"lt": 5}}).item_collection()
    by_tile: dict[str, list] = {}
    for it in sorted(items, key=lambda i: i.properties["eo:cloud_cover"]):   # best scenes for EVERY MGRS tile
        by_tile.setdefault(it.properties.get("s2:mgrs_tile", it.id[:-20]), []).append(it)
    items = [it for lst in by_tile.values() for it in lst[:per_tile]]
    print(f"  S2: {len(items)} scenes over {len(by_tile)} tiles ({', '.join(sorted(by_tile))})")
    h, w = shape
    tr = from_bounds(*bounds, w, h)
    stack = []
    for band in ("B04", "B03", "B02"):
        acc = np.full((len(items), h, w), np.nan, np.float32)
        for k, it in enumerate(items):
            with rasterio.open(it.assets[band].href) as src:
                reproject(rasterio.band(src, 1), acc[k], src_nodata=0, dst_nodata=np.nan, dst_transform=tr,
                          dst_crs=crs, resampling=Resampling.average)
        stack.append(np.nanmedian(acc, axis=0))
        print(f"  S2 {band}: {np.isfinite(stack[-1]).mean() * 100:.0f}% covered from {len(items)} scenes")
    rgb = np.dstack(stack)
    rgb = np.clip(rgb / 4200.0, 0, 1) ** (1 / 1.25)       # darker: arid summer soils are very bright
    grey = rgb.mean(axis=2, keepdims=True)
    rgb = (grey + (rgb - grey) * 0.6) * 0.85               # desaturate so radar and water stand out
    return (np.nan_to_num(rgb) * 255).astype(np.uint8), [i.id for i in items]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=common.ROOT / "config.yaml")
    ap.add_argument("--dem", default="nasadem", choices=list(DEM_ASSET))
    ap.add_argument("--max-width", type=int, default=2048)
    ap.add_argument("--basemap", action="store_true")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    out = common.bundle_dir(cfg)
    crs = cfg["crs"]["analysis"]
    res = float(cfg["crs"]["scene_res_m"])
    scene = cfg["aoi"]["scene"]

    import rasterio
    bounds = utm_bounds(scene, crs, res)
    work = common.ROOT / "work"
    work.mkdir(exist_ok=True)
    dem_tif = work / f"dem_{crs.split(':')[1]}_{int(res)}m.tif"
    if dem_tif.exists():
        with rasterio.open(dem_tif) as src:
            z30, tr30 = src.read(1), src.transform
        tiles = json.loads((work / "dem_tiles.json").read_text()) if (work / "dem_tiles.json").exists() else []
        print(f"reusing {dem_tif.name} {z30.shape}")
    else:
        print(f"fetching {args.dem} for {scene} → {crs} {res} m")
        z30, tr30, tiles = fetch_dem(args.dem, scene, crs, bounds, res)
        z30 = fill_nan(z30)
        with rasterio.open(dem_tif, "w", driver="GTiff", height=z30.shape[0], width=z30.shape[1], count=1,
                           dtype="float32", crs=crs, transform=tr30, compress="deflate", predictor=3,
                           tiled=True) as dst:
            dst.write(z30, 1)
        (work / "dem_tiles.json").write_text(json.dumps(tiles))
    print(f"DEM 30 m: {z30.shape[1]}×{z30.shape[0]} px, z {np.nanmin(z30):.0f}…{np.nanmax(z30):.0f} m")

    # ---- web scene grid
    h30, w30 = z30.shape
    w = min(args.max_width, w30)
    h = int(round(h30 * w / w30))
    web_res = (bounds[2] - bounds[0]) / w
    zw = resample(z30, (h, w)) if (w, h) != (w30, h30) else z30
    from PIL import Image
    (out / "terrain").mkdir(parents=True, exist_ok=True)
    Image.fromarray(to_rg16(zw), "RGB").save(out / "terrain/height_scene.png", optimize=True)
    Image.fromarray(hillshade(zw, web_res), "L").save(out / "terrain/hillshade.jpg", quality=82, optimize=True)
    (out / "terrain/hillshade.png").unlink(missing_ok=True)

    # ---- lake chip grid (10 m)
    lres = float(cfg["crs"]["lake_res_m"])
    lb = utm_bounds(cfg["aoi"]["lake"], crs, lres)
    lsize = (int(round((lb[2] - lb[0]) / lres)), int(round((lb[3] - lb[1]) / lres)))

    grid = C.Grid(crs=crs, bounds_m=bounds, bounds_lonlat=tuple(scene), res_m=round(web_res, 3), size_px=(w, h),
                  height_encoding=C.HeightEncoding(), z_min=float(np.floor(np.nanmin(zw))),
                  z_max=float(np.ceil(np.nanmax(zw))),
                  lake_chip=C.ChipGrid(bounds_m=lb, bounds_lonlat=tuple(cfg["aoi"]["lake"]), res_m=lres, size_px=lsize))
    b = bundle_mod()
    b.write_json(out / C.BUNDLE_PATHS["grid"], grid, force=True)

    src_dem = "NASADEM (NASA JPL) via Microsoft Planetary Computer" if args.dem == "nasadem" else \
        "Copernicus DEM GLO-30 (ESA) via Microsoft Planetary Computer"
    common_meta = dict(badge="MEASURED", source=src_dem, placeholder=False,
                       uncertainty="±5–10 m vertical (30 m DEM); reservoir floor = DEM-era water surface")
    b.register_layer(out, dict(id="terrain_height", kind="terrain", grid="scene", file="terrain/height_scene.png",
                               label="Terrain", sensor="NASADEM" if args.dem == "nasadem" else "COPDEM",
                               method=f"{args.dem} mosaic → {crs} {res:g} m (bilinear) → web grid {web_res:.1f} m; "
                                      f"tiles {', '.join(tiles)}",
                               encoding=dict(type="rg16", scale=0.1, offset=-100), **common_meta),
                     cfg["brand"]["product"], cfg["dam"]["id"], cfg["bundle"]["version"])
    b.register_layer(out, dict(id="terrain_hillshade", kind="hillshade", grid="scene", file="terrain/hillshade.jpg",
                               label="Hillshade", method="NW sun 315°/35°, ×2 exaggeration", **common_meta),
                     cfg["brand"]["product"], cfg["dam"]["id"], cfg["bundle"]["version"])

    if args.basemap:
        print("Sentinel-2 summer composite…")
        rgb, ids = s2_basemap(scene, crs, bounds, (h, w))
        Image.fromarray(rgb, "RGB").save(out / "terrain/basemap_s2.jpg", quality=82, optimize=True)
        b.register_layer(out, dict(id="basemap_s2", kind="basemap", grid="scene", file="terrain/basemap_s2.jpg",
                                   label="Optical basemap (Sentinel-2, summer 2026)", sensor="S2", band="optical",
                                   badge="MEASURED", source="ESA Copernicus Sentinel-2 L2A via Microsoft Planetary Computer",
                                   method=f"median of {len(ids)} scenes, cloud < 5%, Jun–Aug 2026, desaturated 45%",
                                   placeholder=False),
                         cfg["brand"]["product"], cfg["dam"]["id"], cfg["bundle"]["version"])

    sizes = {p.name: f"{p.stat().st_size / 1e6:.2f} MB" for p in (out / "terrain").iterdir()}
    print(f"web grid {w}×{h} @ {web_res:.1f} m · lake chip {lsize[0]}×{lsize[1]} @ {lres:g} m · {sizes}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
