#!/usr/bin/env python3
"""V2 · Dam-agnostic flow path + HAND + exposure LUT (MODELLED). Generalises pipeline/04_routing_hand.py.

  python pipeline/v2/route_hand.py <dam_id> [<dam_id> …] [--dem auto|gem15|cop30]
  python pipeline/v2/route_hand.py my-dam --lon 9.40 --lat 36.59 --crest-osm-way 172827257

For any dam point (+ optional crest line):
  1. HydroRIVERS snap (nearest main stem within 3 km, as dam_catalog.py) → NEXT_DOWN chain to the sea / the next
     catalogued reservoir / 130 km. Window = chain ⊕ 10 km, UTM 32N 30 m grid.
  2. DEM: GEM-15 (Google Research, experimental, model-predicted DTM, CC-BY 4.0) area-averaged 15 → 30 m, gaps (water
     masks, tiles east of 10° E that are not in the public bucket) from Copernicus GLO-30 (Planetary Computer) shifted by
     the median GEM-15 − GLO-30 offset; and a pure GLO-30 variant. Both are routed; GEM-15 is used when it passes D1 and
     D2 (≥ 90 % of the path within 300 m of an OSM river), else GLO-30 (docs/09 §3.6).
  3. Channel burn −2 m on the HydroRIVERS chain, priority-flood + ε, pysheds D8 (V1 functions). Outlet = max
     accumulation (burn cells first) within 400 m of the dam, downstream side of the crest line, outside its reservoir.
     D8 walk until the sea / a catalogued reservoir; the line is cut at 120 km.
  4. Reach breaks found automatically: HydroRIVERS tributary junctions (tributary ≥ max(100 km², 5 % of the main stem))
     named from OSM rivers, and OSM place=city|town within 3 km of the path.
  5. HAND relative to the main-stem path; corridor ≤ 5 km from the path minus reservoirs and sea.
  6. LUT (HandLut contract, V1 form): V(h) = Σ_{HAND<h}(h − HAND)·900 m², h = 0.25 m steps until V ≥ 500 Mm³ (≤ 30 m).
     Exposure: WorldCover 2021 cropland (40) / built-up (50) area fractions at 30 m, OSM building centroids, OSM roads
     (all classes), WorldPop 2020 constrained (TUN, DZA), villages = OSM place nodes whose own built cells (OSM building
     or ≥ 25 % WorldCover built-up within 300 m of the node) are wet — depth at the buildings, not "near a wet cell"
     (science review 15 Nov, docs/09 §0.4).

Outputs: apps/web/public/data/v2/<dam_id>/{vectors/flowpath,corridor,streams.geojson, flood/hand.png,
hand_grid.json, hand_lut.json}; work/v2/<dam_id>/{routing/<dem>/…, tests.json, exposure_30m.npz, hydro_layers.json}.
Never writes manifest.json (geo-pipeline owns it). Scenario exploration, not a forecast. 30 m terrain.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

import os
import tempfile
os.environ.setdefault("NUMBA_CACHE_DIR", tempfile.mkdtemp(prefix="numba_v2_"))   # V1 cache=True clashes across runs
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402,F401  (PROJ guard first)
from common import contracts as C  # noqa: E402

import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT.parent / "NASA_CHALLENGE"
CRS = 32632
RES = 30.0
BURN_M = 2.0
SNAP_M = 400.0
CAP_KM = 120.0
CHAIN_KM = 135.0
WIN_BUF_M = 10000.0
CORR_KM = 5.0
STREAM_KM2 = 5.0
H_STEP, H_MAX, V_TOP = 0.25, 30.0, 500e6
H_MIN_MEANINGFUL = 0.5          # below 2 LUT steps the bathtub only re-fills depression-filled channel cells
OVERPASS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]
UA = "osm-research-client/0.1"
GEM_BASE = "https://storage.googleapis.com/climate-and-sustainability/gem-15/p30_p0/{t}/dtm/zall/mosaic.tif"
GEM_LIST = "https://storage.googleapis.com/storage/v1/b/climate-and-sustainability/o?prefix=gem-15/p30_p0/&delimiter=/"
PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
WORLDPOP = "https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/BSGM/{U}/{l}_ppp_2020_constrained.tif"
DEM_LABEL = {"gem15": "GEM-15 (experimental, model-predicted) DTM 15 m area-averaged to 30 m, gaps from Copernicus GLO-30",
             "cop30": "Copernicus GLO-30 DEM 30 m"}
DEM_SOURCE = {"gem15": "GEM-15 (experimental) DTM, Google Research, CC-BY 4.0, doi:10.31223/X55N75 (gaps: Copernicus "
                       "GLO-30 © DLR/Airbus, via Microsoft Planetary Computer)",
              "cop30": "Copernicus GLO-30 DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, via "
                       "Microsoft Planetary Computer"}

DAMS = {
    "sidi-salem": dict(name="Sidi Salem", lonlat=(9.3964, 36.5897), crest_osm_way=172827257),
    "el-aroussia": dict(name="El Aroussia", lonlat=(9.772606, 36.799646),
                        crest_geojson=str(MAIN / "geojson_data/BARRAGE_AROUSSIA.geojson")),
    "ouldjet-mellegue": dict(name="Ouldjet Mellègue (unnamed OSM dam w720711317)", lonlat=(8.0321, 35.9843),
                             crest_osm_way=720711317),
}


def log(*a):
    print(*a, flush=True)


def v1(name):
    spec = importlib.util.spec_from_file_location(name.replace(".", "_"), ROOT / "pipeline" / name)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


R4 = v1("04_routing_hand.py")
CAT = None


def cat():
    global CAT
    if CAT is None:
        spec = importlib.util.spec_from_file_location("dam_catalog", ROOT / "pipeline/v2/dam_catalog.py")
        CAT = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(CAT)
    return CAT


# ------------------------------------------------------------------------------------------------ fetch helpers
OSM_SOURCES: dict = {}
OFFLINE_OSM = False         # --offline-osm: use only cached Overpass answers (+ national fallbacks); never block


def national_fallback(name: str, bbox_ll):
    """Tunisia-wide Overpass extracts written by dam_catalog.py (places: city|town|village; rivers: named only)."""
    f = ROOT / "cache/v2/osm" / f"{name}_tn.json"
    js = json.loads(f.read_text("utf-8"))
    lo0, la0, lo1, la1 = bbox_ll

    def inside(e):
        if "lat" in e:
            return lo0 <= e["lon"] <= lo1 and la0 <= e["lat"] <= la1
        if "center" in e:
            return lo0 <= e["center"]["lon"] <= lo1 and la0 <= e["center"]["lat"] <= la1
        g = e.get("geometry") or []
        return any(lo0 <= p["lon"] <= lo1 and la0 <= p["lat"] <= la1 for p in g if p)
    return {"elements": [e for e in js["elements"] if inside(e)]}


def overpass(q: str, path: Path, timeout=300, waits=(0, 15, 45, 90), fallback=None):
    import requests
    if path.exists():
        js = json.loads(path.read_text("utf-8"))
        if "elements" in js:
            OSM_SOURCES.setdefault(path.name, js.get("_source", "overpass (cached)"))
            return js
    if OFFLINE_OSM and fallback is None:
        OSM_SOURCES[path.name] = "MISSING (offline: not fetched)"
        raise RuntimeError(f"offline: {path.name} not cached")
    if OFFLINE_OSM:
        waits = ()
    body = f"[out:json][timeout:{timeout}];{q}"
    for wait in waits:
        for url in OVERPASS:
            time.sleep(wait)
            try:
                r = requests.post(url, data={"data": body}, headers={"User-Agent": UA}, timeout=timeout + 30)
                if r.status_code == 200 and r.text.lstrip().startswith("{"):
                    js = r.json()
                    if "runtime error" not in js.get("remark", "").lower():
                        path.parent.mkdir(parents=True, exist_ok=True)
                        js["_source"] = f"overpass {url.split('/')[2]}"
                        OSM_SOURCES[path.name] = js["_source"]
                        path.write_text(json.dumps(js), "utf-8")
                        log(f"  overpass {path.name}: {len(js['elements'])} elements ({url.split('/')[2]})")
                        return js
                    log(f"  overpass {path.name}: {js.get('remark')}")
                else:
                    log(f"  overpass {path.name}: HTTP {r.status_code} {url.split('/')[2]}")
            except Exception as e:  # noqa: BLE001
                log(f"  overpass {path.name}: {type(e).__name__} {url.split('/')[2]}")
    if fallback is not None:
        js = fallback()
        js["_source"] = "national extract cache/v2/osm (Overpass unavailable)"
        path.write_text(json.dumps(js), "utf-8")
        OSM_SOURCES[path.name] = js["_source"]
        log(f"  overpass {path.name}: FALLBACK national extract, {len(js['elements'])} elements")
        return js
    raise RuntimeError(f"overpass failed: {path.name}")


def gdf_osm(js, keys=("name", "name:fr", "name:en", "place", "waterway", "highway", "natural", "water")):
    import geopandas as gpd
    if not any(cat().el_geom(e) is not None for e in js["elements"]):
        return gpd.GeoDataFrame({"osm_id": [], **{k.replace(":", "_"): [] for k in keys}}, geometry=[], crs=CRS)
    return cat().osm_to_gdf(js, list(keys)).to_crs(CRS)


def gdal_env():
    import rasterio
    return rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                        GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="3", VSI_CACHE="TRUE")


def warp_to(src_ds, T, shape, resampling, src_nodata=None):
    import rasterio
    from rasterio.warp import reproject
    dst = np.full(shape, np.nan, np.float32)
    reproject(rasterio.band(src_ds, 1), dst, dst_transform=T, dst_crs=f"EPSG:{CRS}", dst_nodata=np.nan,
              src_nodata=src_nodata if src_nodata is not None else src_ds.nodata, resampling=resampling)
    return dst


def ll_bbox(T, shape, pad=0.01):
    from rasterio.warp import transform_bounds
    H, W = shape
    b = transform_bounds(f"EPSG:{CRS}", "EPSG:4326", T.c, T.f - H * RES, T.c + W * RES, T.f, densify_pts=21)
    return (b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad)


def fetch_cop(T, shape, cache: Path):
    import planetary_computer as pc
    import pystac_client
    import rasterio
    from rasterio.enums import Resampling
    p = cache / "cop30_30m.tif"
    if p.exists():
        with rasterio.open(p) as s:
            return s.read(1)
    cat_ = pystac_client.Client.open(PC_STAC, modifier=pc.sign_inplace)
    items = list(cat_.search(collections=["cop-dem-glo-30"], bbox=list(ll_bbox(T, shape))).items())
    log(f"  GLO-30: {len(items)} tiles")
    out = np.full(shape, np.nan, np.float32)
    with gdal_env():
        for it in items:
            with rasterio.open(it.assets["data"].href) as s:
                tmp = warp_to(s, T, shape, Resampling.bilinear)
            out = np.where(np.isnan(out), tmp, out)
    R4.write_tif(p, out, T, f"EPSG:{CRS}", nodata=np.nan, dtype="float32")
    return out


def fetch_gem(T, shape, cache: Path):
    import requests
    import rasterio
    from rasterio.enums import Resampling
    p = cache / "gem15_30m.tif"
    if p.exists():
        with rasterio.open(p) as s:
            return s.read(1), json.loads((cache / "gem15_tiles.json").read_text())
    avail = {x.rstrip("/").split("/")[-1] for x in requests.get(GEM_LIST, timeout=60).json().get("prefixes", [])}
    b = ll_bbox(T, shape, 0)
    want = [f"w{lo}s{la}" for lo in range(int(np.floor(b[0])), int(np.floor(b[2])) + 1)
            for la in range(int(np.floor(b[1])), int(np.floor(b[3])) + 1)]
    tiles = dict(wanted=want, used=[t for t in want if t in avail], missing=[t for t in want if t not in avail])
    log(f"  GEM-15 tiles {tiles}")
    out = np.full(shape, np.nan, np.float32)
    with gdal_env():
        for t in tiles["used"]:
            with rasterio.open(GEM_BASE.format(t=t)) as s:
                tmp = warp_to(s, T, shape, Resampling.average)        # 2×2 block mean of the 15 m cells
            out = np.where(np.isnan(out), tmp, out)
    R4.write_tif(p, out, T, f"EPSG:{CRS}", nodata=np.nan, dtype="float32")
    (cache / "gem15_tiles.json").write_text(json.dumps(tiles))
    return out, tiles


def fetch_worldcover(T, shape, cache: Path):
    """Cropland (40) and built-up (50) area fractions on the 30 m grid from WorldCover 2021 10 m."""
    import planetary_computer as pc
    import pystac_client
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import Affine
    from rasterio.warp import reproject
    p = cache / "worldcover_frac_30m.npz"
    if p.exists():
        z = np.load(p)
        return z["crop"], z["built"], z["water"]
    cat_ = pystac_client.Client.open(PC_STAC, modifier=pc.sign_inplace)
    items = list(cat_.search(collections=["esa-worldcover"], bbox=list(ll_bbox(T, shape)),
                             query={"esa_worldcover:product_version": {"eq": "2.0.0"}}).items())
    log(f"  WorldCover: {len(items)} tiles")
    H, W = shape
    T10 = Affine(10.0, 0, T.c, 0, -10.0, T.f)
    wc = np.zeros((H * 3, W * 3), np.uint8)
    with gdal_env():
        for it in items:
            with rasterio.open(it.assets["map"].href) as s:
                tmp = np.zeros_like(wc)
                reproject(rasterio.band(s, 1), tmp, dst_transform=T10, dst_crs=f"EPSG:{CRS}", dst_nodata=0,
                          src_nodata=0, resampling=Resampling.nearest)
            wc = np.where(wc == 0, tmp, wc)

    def frac(cls):
        return (wc == cls).reshape(H, 3, W, 3).mean(axis=(1, 3)).astype(np.float32)
    crop, built, water = frac(40), frac(50), frac(80)
    np.savez_compressed(p, crop=crop, built=built, water=water, valid=(wc > 0).reshape(H, 3, W, 3).mean(axis=(1, 3)))
    return crop, built, water


def fetch_worldpop(T, shape, cache: Path):
    """People per 30 m cell (WorldPop 2020 constrained, TUN + DZA, density area-averaged = sum-preserving)."""
    import math

    import rasterio
    import requests
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    from rasterio.windows import from_bounds
    p = cache / "pop_30m.tif"
    if p.exists():
        with rasterio.open(p) as s:
            return s.read(1).astype(np.float64), json.loads((cache / "pop_meta.json").read_text())
    b = ll_bbox(T, shape, 0.02)
    out = np.zeros(shape, np.float64)
    meta = {}
    for iso in ("TUN", "DZA"):
        if iso == "DZA" and b[0] > 8.75:          # window entirely east of the Algerian border (≈ 8.2–8.7° E here)
            continue
        f = MAIN / "cache/context/worldpop" / f"{iso.lower()}_ppp_2020_constrained.tif"
        if not f.exists():
            f = ROOT / "cache/v2/worldpop" / f.name
        if not f.exists():
            f.parent.mkdir(parents=True, exist_ok=True)
            log(f"  downloading WorldPop {iso}…")
            with requests.get(WORLDPOP.format(U=iso, l=iso.lower()), stream=True, timeout=600,
                              headers={"User-Agent": UA}) as r:
                r.raise_for_status()
                with open(f.with_suffix(".part"), "wb") as o:
                    for ch in r.iter_content(1 << 20):
                        o.write(ch)
            f.with_suffix(".part").rename(f)
        with rasterio.open(f) as s:
            sb = s.bounds
            if b[2] < sb.left or b[0] > sb.right or b[3] < sb.bottom or b[1] > sb.top:
                continue
            win = from_bounds(max(b[0], sb.left), max(b[1], sb.bottom), min(b[2], sb.right), min(b[3], sb.top),
                              s.transform).round_offsets().round_lengths()
            a = s.read(1, window=win).astype(np.float64)
            wt = s.window_transform(win)
            nod = s.nodata
            a = np.where(np.isfinite(a) & (a >= 0) & ((a != nod) if nod is not None else True), a, 0.0)
            lats = wt.f + (np.arange(a.shape[0]) + 0.5) * wt.e
            R = 6371007.2
            dlon, dlat = math.radians(abs(wt.a)), abs(wt.e)
            area = (R ** 2) * dlon * np.abs(np.sin(np.radians(lats + dlat / 2)) - np.sin(np.radians(lats - dlat / 2)))
            dens = (a / area[:, None]).astype(np.float32)
            dst = np.zeros(shape, np.float32)
            reproject(dens, dst, src_transform=wt, src_crs=s.crs, dst_transform=T, dst_crs=f"EPSG:{CRS}",
                      resampling=Resampling.average)
            out += dst * 900.0
            meta[iso] = dict(file=f.name, window_people=round(float(a.sum())))
    R4.write_tif(p, out.astype(np.float32), T, f"EPSG:{CRS}", dtype="float32")
    (cache / "pop_meta.json").write_text(json.dumps(meta))
    return out, meta


# ------------------------------------------------------------------------------------------------ geometry helpers
def hydrorivers():
    import geopandas as gpd
    return gpd.read_file(ROOT / "work/v2/hydrorivers_tn.gpkg").to_crs(CRS)


def snap_chain(riv, pt):
    cand = riv[riv.intersects(pt.buffer(3000))].copy()
    cand["d"] = cand.distance(pt)
    mainr = cand[cand.UPLAND_SKM >= 0.5 * cand.UPLAND_SKM.max()]
    # the reach the dam point lies on or just downstream of it: nearest, ties → larger upland (downstream reach)
    s = mainr.assign(d1=mainr.d.round(0)).sort_values(["d1", "UPLAND_SKM"], ascending=[True, False]).iloc[0]
    idx = riv.set_index("HYRIV_ID")
    rid, chain, km = int(s.HYRIV_ID), [], 0.0
    while rid in idx.index and rid != 0 and km < CHAIN_KM:
        chain.append(rid)
        km += float(idx.loc[rid, "LENGTH_KM"])
        rid = int(idx.loc[rid, "NEXT_DOWN"])
    up = riv[riv.NEXT_DOWN == int(s.HYRIV_ID)].sort_values("UPLAND_SKM", ascending=False)
    return idx.loc[chain].reset_index(), dict(snap_id=int(s.HYRIV_ID), snap_d_m=float(s.d), upland_km2=float(s.UPLAND_SKM),
                                              chain_km=km, reaches=len(chain), mouth=bool(rid == 0)), \
        (up.geometry.iloc[0] if len(up) else None)


def catalogue_reservoirs(exclude_pt):
    """Reservoir polygons of every catalogued dam (apps/web/public/v2/dams/*.geojson), except the one at this dam."""
    import geopandas as gpd
    from shapely.geometry import shape
    rows = []
    for f in sorted((ROOT / "apps/web/public/v2/dams").glob("*.geojson")):
        d = json.loads(f.read_text("utf-8"))
        name = next((x["properties"].get("name") for x in d["features"] if x["properties"].get("role") == "dam"), f.stem)
        for x in d["features"]:
            if x["properties"].get("role") == "reservoir":
                rows.append(dict(dam=f.stem, name=name, geometry=shape(x["geometry"])))
    g = gpd.GeoDataFrame(rows, geometry="geometry", crs=4326).to_crs(CRS)
    return g[g.distance(exclude_pt) > 1500].reset_index(drop=True)


def crest_line(spec, cache: Path):
    from shapely.geometry import LineString, shape
    from pyproj import Transformer
    tr = Transformer.from_crs(4326, CRS, always_xy=True)
    if spec.get("crest_geojson"):
        d = json.loads(Path(spec["crest_geojson"]).read_text("utf-8"))
        g = next(shape(f["geometry"]) for f in d["features"] if f["geometry"]["type"] == "LineString")
        src = Path(spec["crest_geojson"]).name
    elif spec.get("crest_osm_way"):
        import requests
        f = cache / "crest_osmapi.json"
        if not f.exists():
            r = requests.get(f"https://api.openstreetmap.org/api/0.6/way/{spec['crest_osm_way']}/full.json",
                             headers={"User-Agent": UA}, timeout=60)
            r.raise_for_status()
            f.write_text(r.text, "utf-8")
        els = json.loads(f.read_text("utf-8"))["elements"]
        nodes = {e["id"]: (e["lon"], e["lat"]) for e in els if e["type"] == "node"}
        e = next(x for x in els if x["type"] == "way")
        g = LineString([nodes[n] for n in e["nodes"]])
        src = f"OSM w{spec['crest_osm_way']} (OSM API) {json.dumps(e.get('tags', {}), ensure_ascii=False)}"
        if g.is_ring:
            g = LineString(list(g.coords))
    else:
        return None, "none"
    return LineString([tr.transform(*c) for c in g.coords]), src


def osm_poly_str(poly_utm):
    from pyproj import Transformer
    tr = Transformer.from_crs(CRS, 4326, always_xy=True)
    ring = poly_utm.exterior.simplify(250)
    return " ".join(f"{la:.5f} {lo:.5f}" for lo, la in (tr.transform(*c) for c in ring.coords))


def name_of(row):
    for k in ("name_fr", "name_en", "name"):
        v = row.get(k) if hasattr(row, "get") else None
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


# ------------------------------------------------------------------------------------------------ inputs (DEM-independent)
def prepare(dam_id, spec):
    import geopandas as gpd
    from pyproj import Transformer
    from rasterio.transform import from_origin
    from shapely.geometry import Point, box
    from shapely.ops import substring, unary_union
    wd = ROOT / "work/v2" / dam_id
    cache = ROOT / "cache/v2/hydro" / dam_id
    wd.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    tr = Transformer.from_crs(4326, CRS, always_xy=True)
    dam_pt = Point(tr.transform(*spec["lonlat"]))
    riv = hydrorivers()
    chain, snap, up_geom = snap_chain(riv, dam_pt)
    log(f"[{dam_id}] HydroRIVERS snap {snap}")
    res_all = catalogue_reservoirs(dam_pt)
    chain_line = unary_union(list(chain.geometry))
    hit = res_all[res_all.intersects(chain_line)]
    target = None
    if len(hit):
        # first reservoir along the chain
        hit = hit.assign(k=[min(i for i, g in enumerate(chain.geometry) if g.intersects(p)) for p in hit.geometry])
        target = hit.sort_values("k").iloc[0]
        chain = chain.iloc[:int(target.k) + 1]
        chain_line = unary_union(list(chain.geometry))
    crest, crest_src = crest_line(spec, cache)
    # window
    geoms = [chain_line.buffer(WIN_BUF_M), dam_pt.buffer(WIN_BUF_M)]
    x0, y0, x1, y1 = unary_union(geoms).bounds
    x0, y0 = np.floor(x0 / RES) * RES, np.floor(y0 / RES) * RES
    x1, y1 = np.ceil(x1 / RES) * RES, np.ceil(y1 / RES) * RES
    W, H = int((x1 - x0) / RES), int((y1 - y0) / RES)
    T = from_origin(x0, y1, RES, RES)
    log(f"[{dam_id}] window {W}×{H} px ({W * RES / 1000:.0f} × {H * RES / 1000:.0f} km)")
    from concurrent.futures import ThreadPoolExecutor
    pool = ThreadPoolExecutor(4)
    t_r = time.time()
    fut = dict(cop=pool.submit(fetch_cop, T, (H, W), cache), gem=pool.submit(fetch_gem, T, (H, W), cache),
               wc=pool.submit(fetch_worldcover, T, (H, W), cache), pop=pool.submit(fetch_worldpop, T, (H, W), cache))
    llb = ll_bbox(T, (H, W), 0)
    bb = f"({llb[1]:.4f},{llb[0]:.4f},{llb[3]:.4f},{llb[2]:.4f})"
    lon, lat = spec["lonlat"]
    in_tn = llb[0] > 8.4 and llb[1] > 33 and llb[2] < 11.7
    fb = (lambda n: (lambda: national_fallback(n, llb))) if in_tn else (lambda n: None)
    js_r = overpass(f"way[waterway=river]{bb};out tags geom qt;", cache / "osm_rivers.json", 180, (0, 30),
                    fb("rivers"))
    js_p = overpass(f'node[place~"^(city|town|village|hamlet)$"]{bb};out qt;', cache / "osm_places.json", 180, (0, 30),
                    fb("places"))
    try:
        js_w = overpass(f"(way[natural=water](around:3000,{lat},{lon});relation[natural=water](around:3000,{lat},{lon}););"
                        "out tags geom qt;", cache / "osm_water_dam.json", 120, (0, 30))
    except RuntimeError:
        js_w = {"elements": []}
        OSM_SOURCES["osm_water_dam.json"] = "FAILED: own reservoir unknown (Overpass unavailable)"
    # buildings + roads inside chain ⊕ 6.5 km, in chunks of ~40 km of chain
    L = chain_line if chain_line.geom_type == "LineString" else __import__("shapely").line_merge(chain_line)
    if L.geom_type != "LineString":
        L = max(L.geoms, key=lambda g: g.length)
    blds, rds = [], []
    n = max(1, int(np.ceil(L.length / 40000)))
    for i in range(n):
        seg = substring(L, i * L.length / n, (i + 1) * L.length / n)
        poly = seg.buffer(CORR_KM * 1000 + 1500)
        if i == 0:
            poly = poly.union(dam_pt.buffer(CORR_KM * 1000 + 1500))
        ps = osm_poly_str(poly)
        for lst, kind, q in ((blds, "buildings", f'way[building](poly:"{ps}");out center qt;'),
                             (rds, "roads", f'way[highway](poly:"{ps}");out tags geom qt;')):
            try:
                lst.append(overpass(q, cache / f"osm_{kind}_{i}.json", 240, (0, 30, 90, 180, 300)))
            except RuntimeError:
                lst.append(None)
    cover = dict(buildings=[b is not None for b in blds], roads=[r is not None for r in rds])
    osm_ok = {k: all(v) for k, v in cover.items()}
    n = len(cover["roads"])
    log(f"[{dam_id}] OSM chunk coverage {cover}")
    blds = [b for b in blds if b is not None] if osm_ok["buildings"] else []
    rds = [r for r in rds if r is not None]            # partial chunks kept: road_km is then a partial lower bound
    cover["chunk_km"] = round(L.length / n / 1000, 1)
    rivers = gdf_osm(js_r)
    rivers = rivers[rivers.geom_type.isin(["LineString", "MultiLineString"])].reset_index(drop=True)
    places = gdf_osm(js_p)
    water = gdf_osm(js_w)
    b_el = {e["id"]: e for js in blds for e in js["elements"]}
    r_el = {e["id"]: e for js in rds for e in js["elements"]}
    bld = gdf_osm({"elements": list(b_el.values())}, ("building",))
    msf = cache / "ms_buildings_utm.npy"
    bld_src = "OSM building centroids"
    if msf.exists():                     # Microsoft Global ML Building Footprints (pipeline/v2/ms_buildings.py)
        pts = np.load(msf)
        msm = json.loads((cache / "ms_buildings_meta.json").read_text("utf-8"))
        log(f"[{dam_id}] buildings: Microsoft ML footprints {len(pts)} centroids (OSM had {len(bld)})")
        bld = gpd.GeoDataFrame(geometry=gpd.points_from_xy(pts[:, 0], pts[:, 1]), crs=CRS)
        bld_src = f"Microsoft Global ML Building Footprints ({msm['release']} release, ODbL) centroids"
        osm_ok["buildings"] = True
    roads = gdf_osm({"elements": list(r_el.values())}, ("highway",))
    roads = roads[roads.geom_type.isin(["LineString", "MultiLineString", "Polygon"])].copy()
    roads["geometry"] = roads.geometry.boundary.where(roads.geom_type == "Polygon", roads.geometry)
    # own reservoir: OSM water polygon touching the crest (or the dam point) on its upstream side
    own = None
    wp = water[water.geom_type.isin(["Polygon", "MultiPolygon"])]
    if len(wp):
        ref = (crest if crest is not None else dam_pt).buffer(300)
        near = wp[wp.intersects(ref) & (wp.area > 5e4)]
        if len(near):
            own = unary_union(list(near.geometry))
    log(f"[{dam_id}] OSM: {len(rivers)} river ways, {len(places)} places, {len(bld)} buildings, {len(roads)} roads; "
        f"own reservoir {'%.2f km²' % (own.area / 1e6) if own is not None else 'none'}; target "
        f"{target['name'] if target is not None else 'sea/none'}")
    # rasters
    cop = fut["cop"].result()
    gem, tiles = fut["gem"].result()
    crop, built, wcw = fut["wc"].result()
    pop, pop_meta = fut["pop"].result()
    pool.shutdown()
    log(f"[{dam_id}] rasters + OSM in {time.time() - t_r:.0f} s; GEM-15 valid {np.isfinite(gem).mean() * 100:.1f}% of window")
    return dict(dam_id=dam_id, spec=spec, wd=wd, cache=cache, T=T, shape=(H, W), dam_pt=dam_pt, riv=riv, chain=chain,
                chain_line=chain_line, snap=snap, up_geom=up_geom, target=target, crest=crest, crest_src=crest_src,
                rivers=rivers, places=places, own=own, bld=bld, roads=roads, cop=cop, gem=gem, tiles=tiles, crop=crop,
                built=built, wc_water=wcw, pop=pop, pop_meta=pop_meta, grid_box=box(x0, y0, x1, y1), osm_ok=osm_ok, bld_src=bld_src,
                osm_cover=cover)


def build_dem(P, which):
    cop, gem = P["cop"], P["gem"]
    if which == "cop30":
        return cop.astype(np.float64), {}
    ok = np.isfinite(gem) & np.isfinite(cop)
    off = float(np.median(gem[ok] - cop[ok])) if ok.any() else 0.0
    d = gem[ok] - cop[ok] if ok.any() else np.array([0.0])
    z = np.where(np.isfinite(gem), gem, cop + off).astype(np.float64)
    return z, dict(gem_minus_cop_median_m=round(off, 2), p05=round(float(np.percentile(d, 5)), 2),
                   p95=round(float(np.percentile(d, 95)), 2), gem_valid_window_pct=round(float(np.isfinite(gem).mean() * 100), 1))


def sea_mask(cop):
    from scipy import ndimage
    low = ~np.isfinite(cop) | (cop <= 0.0)
    lab, n = ndimage.label(low)
    edge = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])
    edge = edge[edge > 0]
    return np.isin(lab, edge) if len(edge) else np.zeros_like(low)


# ------------------------------------------------------------------------------------------------ routing for one DEM
BURNS_M = (2.0, 5.0, 10.0)   # tried in order until D2 passes (flat deltas need a deeper burn to keep the D8 line in the channel)


def route(P, which, burn_m=BURN_M):
    from rasterio import features
    from shapely.geometry import LineString, Point
    from shapely.ops import unary_union
    T, (H, W) = P["T"], P["shape"]
    crs = f"EPSG:{CRS}"
    wr = P["wd"] / "routing" / which
    wr.mkdir(parents=True, exist_ok=True)
    z, dem_info = build_dem(P, which)
    sea = sea_mask(P["cop"])
    z = np.where(np.isfinite(z), z, 0.0)
    burn = features.rasterize([(P["chain_line"], 1)], out_shape=(H, W), transform=T, dtype="uint8") > 0
    burn &= ~sea
    zb = z - burn_m * burn
    grid, dcond, fdir, acc = R4.condition(zb, T, crs)
    fd, ac, zc = np.asarray(fdir), np.asarray(acc), np.asarray(dcond)
    # stop mask: sea + target reservoir
    stop = sea.copy()
    if P["target"] is not None:
        stop |= features.rasterize([(P["target"].geometry, 1)], out_shape=(H, W), transform=T, dtype="uint8") > 0
    own_m = np.zeros((H, W), bool)
    if P["own"] is not None:
        own_m = features.rasterize([(P["own"].buffer(30), 1)], out_shape=(H, W), transform=T, dtype="uint8") > 0
    # outlet: downstream side of the crest line
    dx, dy = P["dam_pt"].x, P["dam_pt"].y
    r0, c0 = R4.rc_of(T, dx, dy)
    k = int(SNAP_M // RES) + 2
    rr, cc = np.mgrid[max(r0 - k, 0):min(r0 + k + 1, H), max(c0 - k, 0):min(c0 + k + 1, W)]
    x, y = R4.xy_of(T, rr, cc)
    cand = (np.hypot(x - dx, y - dy) <= SNAP_M) & ~own_m[rr, cc]
    side_note = "no crest line"
    if P["crest"] is not None:
        (ax, ay), (bx, by) = P["crest"].coords[0], P["crest"].coords[-1]
        side = lambda px, py: np.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax))   # noqa: E731
        upref = P["own"].centroid if P["own"] is not None else (
            P["up_geom"].interpolate(0.5, normalized=True) if P["up_geom"] is not None else None)
        if upref is not None:
            cand &= side(x, y) == -side(upref.x, upref.y)
            side_note = "downstream side of the crest chord (upstream ref: " + \
                        ("own reservoir centroid)" if P["own"] is not None else "upstream HydroRIVERS reach)")
    pick = np.where(cand & burn[rr, cc], ac[rr, cc], -1)
    if pick.max() < 0:
        pick = np.where(cand, ac[rr, cc], -1)
    i = np.unravel_index(pick.argmax(), pick.shape)
    start = (int(rr[i]), int(cc[i]))
    ox, oy = (float(v) for v in R4.xy_of(T, *start))
    path, why = R4.trace(fd, start, stop)
    end_kind = "sea" if why == "target" and sea[tuple(path[-1])] else (
        f"{P['target']['name']} reservoir" if why == "target" else why)
    px, py = R4.xy_of(T, path[:, 0], path[:, 1])
    line_full = LineString(np.c_[px, py]).simplify(RES)
    cd = np.array([line_full.project(Point(p)) for p in np.c_[px, py]]) / 1000
    capped = cd[-1] > CAP_KM
    if capped:
        n = int(np.argmax(cd > CAP_KM))
        path, cd = path[:n], cd[:n]
        end_kind = f"{CAP_KM:g} km cap"
        px, py = px[:n], py[:n]
    raw_line = LineString(np.c_[px, py])
    line = raw_line.simplify(RES)
    vx = np.array(line.coords)
    vdist = np.r_[0, np.cumsum(np.hypot(*np.diff(vx, axis=0).T))] / 1000
    length_km = float(vdist[-1])
    # D1
    zr, zcp = z[path[:, 0], path[:, 1]], zc[path[:, 0], path[:, 1]]
    up_c, up_raw = np.diff(zcp), np.diff(zr)
    dam_like = zr - np.minimum.accumulate(zr)
    reached = why == "target" or capped
    D1 = dict(stop_reason=why, end=end_kind, reached_end=bool(reached), conditioned_max_uphill_m=float(max(up_c.max(), 0)),
              raw_max_uphill_step_m=float(up_raw.max()), raw_uphill_steps_gt1m=int((up_raw > 1).sum()),
              raw_n_steps=int(len(up_raw)), raw_max_rise_above_running_min_m=float(dam_like.max()),
              raw_max_rise_at_km=float(cd[int(dam_like.argmax())]), z_start_m=float(zr[0]), z_end_m=float(zr[-1]),
              passed=bool(reached and up_c.max() <= 1e-6))
    # D2: OSM rivers are the independent reference; HydroRIVERS is the burn line
    osm_riv = unary_union(list(P["rivers"].geometry)) if len(P["rivers"]) else None
    samp = [raw_line.interpolate(s) for s in np.arange(0, raw_line.length, RES)]
    d_hr = np.array([P["chain_line"].distance(p) for p in samp])
    d_osm = np.array([osm_riv.distance(p) for p in samp]) if osm_riv is not None else np.full(len(samp), np.inf)
    D2 = dict(n=len(samp), pct_within_300m_osm_river=float((d_osm <= 300).mean() * 100),
              pct_within_300m_hydrorivers=float((d_hr <= 300).mean() * 100),
              median_m_osm=float(np.median(d_osm)), p95_m_osm=float(np.percentile(d_osm, 95)),
              max_m_osm=float(d_osm.max()), longest_gt300m_run_km=float(_longest_run(d_osm > 300) * RES / 1000),
              note="OSM waterway=river is the independent reference; HydroRIVERS is the burn line",
              passed=bool((d_osm <= 300).mean() >= 0.9))
    gem_path = None
    if which == "gem15":
        gem_path = float(np.isfinite(P["gem"][path[:, 0], path[:, 1]]).mean() * 100)
    log(f"[{P['dam_id']}/{which}/burn {burn_m:g} m] outlet {np.hypot(ox - dx, oy - dy):.0f} m from dam, acc {ac[start] * 900 / 1e6:.1f} km² "
        f"(in-window); path {length_km:.1f} km → {end_kind}; D1 {D1['passed']} D2 {D2['pct_within_300m_osm_river']:.1f}%"
        + (f"; GEM-15 on path {gem_path:.0f}%" if gem_path is not None else ""))
    return dict(which=which, z=z, zc=zc, burn=burn, sea=sea, grid=grid, fdir=fdir, dcond=dcond, fd=fd, ac=ac,
                path=path, cd=cd, line=line, raw_line=raw_line, vdist=vdist, length_km=length_km, start=start,
                outlet_xy=(ox, oy), outlet_note=side_note, end_kind=end_kind, D1=D1, D2=D2, dem_info=dem_info,
                gem_path_pct=gem_path, stop=stop, own_m=own_m, wr=wr, burn_m=burn_m)


def _longest_run(b):
    best = cur = 0
    for v in b:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best


# ------------------------------------------------------------------------------------------------ reach breaks
def reach_breaks(P, R):
    from shapely.geometry import Point
    from shapely.ops import unary_union
    line, riv, chain = R["line"], P["riv"], P["chain"]
    rivers = P["rivers"]
    rivers = rivers.assign(nm=[name_of(r) for _, r in rivers.iterrows()])
    named = rivers[rivers.nm.notna()]
    main_name = None
    if len(named):
        buf = line.buffer(300)
        ov = named.assign(ov=named.intersection(buf).length).groupby("nm").ov.sum().sort_values(ascending=False)
        main_name = ov.index[0] if ov.iloc[0] > 0 else None
    out = []
    ids = chain.HYRIV_ID.tolist()
    ups = chain.UPLAND_SKM.values
    for i in range(1, len(ids)):
        tr_ = riv[(riv.NEXT_DOWN == ids[i]) & (riv.HYRIV_ID != ids[i - 1])]
        if not len(tr_):
            continue
        t = tr_.sort_values("UPLAND_SKM", ascending=False).iloc[0]
        if t.UPLAND_SKM < max(100.0, 0.05 * ups[i - 1]):
            continue
        g = chain.geometry.iloc[i]
        cp = Point(list(g.geoms)[0].coords[0] if hasattr(g, "geoms") else g.coords[0])
        off = line.distance(cp)
        dk = line.project(cp) / 1000
        if off > 1000 or dk <= 0.2 or dk >= R["length_km"] - 0.2:
            continue
        tn = None
        if len(named):
            cand = named[named.nm != main_name]
            ov = cand.assign(ov=cand.intersection(t.geometry.buffer(400)).length)
            ov = ov[ov.ov > 200].groupby("nm").ov.sum().sort_values(ascending=False)
            tn = ov.index[0] if len(ov) else None
        out.append(dict(name=f"Confluence {tn or 'unnamed tributary'}", kind="confluence", dist_km=round(dk, 2),
                        offset_m=round(off), tributary_upland_km2=round(float(t.UPLAND_SKM)),
                        main_upland_km2=round(float(ups[i - 1])), source="HydroRIVERS junction; name OSM" if tn else
                        "HydroRIVERS junction"))
    pl = P["places"]
    towns = pl[pl.place.isin(["city", "town"])]
    for _, r in towns.iterrows():
        off = line.distance(r.geometry)
        dk = line.project(r.geometry) / 1000
        if off <= 3000 and 0.2 < dk < R["length_km"] - 0.2:
            out.append(dict(name=name_of(r) or r.osm_id, kind=r.place, dist_km=round(dk, 2), offset_m=round(off),
                            osm_id=r.osm_id, source="OSM place"))
    out.sort(key=lambda b: b["dist_km"])
    out.append(dict(name={"sea": "Sea"}.get(R["end_kind"], R["end_kind"]) if R["end_kind"] != "sea" else "Sea",
                    kind="end", dist_km=round(R["length_km"], 2), source="end of the D8 path"))
    return out, main_name


# ------------------------------------------------------------------------------------------------ HAND + LUT
def exposure_rasters(P):
    T, (H, W) = P["T"], P["shape"]
    bld = R4.point_count_raster(P["bld"], T, (H, W)) if len(P["bld"]) else np.zeros((H, W), np.int32)
    road = R4.road_length_raster(P["roads"], T, (H, W), P["grid_box"].bounds) if len(P["roads"]) else np.zeros((H, W))
    return dict(crop=P["crop"].astype(np.float64), built=P["built"].astype(np.float64), pop=P["pop"], bld=bld, road=road)


def village_hand(hand, corr, ex, T, villages, radius=300.0):
    """Min HAND over each village's built cells (OSM building or ≥ 25 % WorldCover built-up) within radius of its node."""
    builtcell = (ex["bld"] > 0) | (ex["built"] >= 0.25)
    return R4.village_min(hand, T, villages, radius, valid=corr & builtcell), builtcell


def exposure_at(h, hand, corr, ex, vmin):
    wet = corr & (hand < h)
    return dict(h=float(h), V_m3=float(((h - hand[wet]) * 900.0).sum()), area_km2=float(wet.sum() * 900 / 1e6),
                cropland_ha=float(ex["crop"][wet].sum() * 0.09), builtup_ha=float(ex["built"][wet].sum() * 0.09),
                villages=int(np.sum(vmin < h)), road_km=float(ex["road"][wet].sum() / 1000),
                population=float(ex["pop"][wet].sum()), buildings=int(ex["bld"][wet].sum()))


def hand_lut(P, R):
    from pysheds.sview import Raster, ViewFinder
    from rasterio import features
    T, (H, W) = P["T"], P["shape"]
    crs = f"EPSG:{CRS}"
    path = R["path"]
    pmask = np.zeros((H, W), bool)
    pmask[path[:, 0], path[:, 1]] = True
    vfb = ViewFinder(affine=T, shape=(H, W), nodata=False, crs=crs)
    zref = R["zc"] + R["burn_m"] * R["burn"]
    idx = np.asarray(R["grid"].compute_hand(R["fdir"], R["dcond"], Raster(pmask, viewfinder=vfb), dirmap=R4.DIRMAP,
                                            return_index=True))
    ok = idx >= 0
    hand = np.full((H, W), np.nan)
    hand[ok] = np.maximum(zref[ok] - zref.ravel()[idx[ok]], 0)
    corr_poly = R["line"].buffer(CORR_KM * 1000, cap_style="flat")
    for g in (P["own"], P["target"].geometry if P["target"] is not None else None):
        if g is not None:
            corr_poly = corr_poly.difference(g.buffer(30))
    corr_poly = corr_poly.intersection(P["grid_box"])
    corr_geom = features.rasterize([(corr_poly, 1)], out_shape=(H, W), transform=T, dtype="uint8") > 0
    corr = corr_geom & np.isfinite(hand) & ~R["sea"]
    hand_c = np.where(corr, hand, np.nan)
    order = np.full(H * W, -1, np.int64)
    order[path[:, 0] * W + path[:, 1]] = np.arange(len(path))
    drain_k = np.where(ok, order[np.clip(idx, 0, H * W - 1)], -1).astype(np.int32)
    ex = exposure_rasters(P)
    vil = P["places"][P["places"].place.isin(["city", "town", "village", "hamlet"])]
    vil = vil[vil.within(P["grid_box"].buffer(-400))].reset_index(drop=True)
    vmin, builtcell = village_hand(hand, corr, ex, T, vil)
    rows, h = [], H_STEP
    while h <= H_MAX + 1e-9:
        rows.append(exposure_at(h, hand, corr, ex, vmin))
        if rows[-1]["V_m3"] >= V_TOP:
            break
        h += H_STEP
    return dict(hand=hand, hand_c=hand_c, corr=corr, drain_k=drain_k, corr_geom=corr_geom, corr_poly=corr_poly, ex=ex, villages=vil,
                vmin=vmin, builtcell=builtcell, rows=rows)


def h_for_volume(rows, V):
    hs = np.array([r["h"] for r in rows])
    vs = np.array([r["V_m3"] for r in rows])
    if V > vs[-1]:
        return None
    return float(np.interp(V, np.r_[0, vs], np.r_[0, hs]))


# ------------------------------------------------------------------------------------------------ outputs
def write_outputs(P, R, L, breaks, main_name, tests, alt):
    from PIL import Image
    from shapely.geometry import mapping
    from pyproj import Transformer
    dam_id = P["dam_id"]
    out = ROOT / "apps/web/public/data/v2" / dam_id
    (out / "vectors").mkdir(parents=True, exist_ok=True)
    (out / "flood").mkdir(parents=True, exist_ok=True)
    T, (H, W) = P["T"], P["shape"]
    which = R["which"]
    dem_txt = DEM_LABEL[which]
    src_txt = f"{DEM_SOURCE[which]}; HydroRIVERS v1.0 (Lehner & Grill 2013); OpenStreetMap contributors (ODbL); pysheds"
    end_txt = R["end_kind"]
    reach = f"dam→{'sea' if end_txt == 'sea' else end_txt}"
    rows = L["rows"]
    gj = lambda feats: R4.geojson_utm(feats)  # noqa: E731
    fp = gj([dict(type="Feature", properties=dict(
        name=f"Flow path: {P['spec']['name']} dam → {end_txt}", length_km=round(R["length_km"], 2),
        river=main_name, reach_breaks=breaks, vertex_dist_km=[round(float(v), 2) for v in R["vdist"]], badge="MODELLED",
        dem=dem_txt, method=f"D8 steepest descent on {dem_txt}, HydroRIVERS chain burned −{R['burn_m']:g} m, depressions "
        f"filled (priority-flood + ε); line simplified 30 m, cut at {CAP_KM:g} km"),
        geometry=R4.rnd_coords(R["line"]))])
    (out / "vectors/flowpath.geojson").write_text(json.dumps(fp, ensure_ascii=False), "utf-8")
    (out / "vectors/corridor.geojson").write_text(json.dumps(gj([dict(
        type="Feature", properties=dict(name="HAND corridor", width_km=CORR_KM, badge="MODELLED"),
        geometry=R4.rnd_coords(L["corr_poly"].simplify(30), 0))])), "utf-8")
    smask = (R["ac"] > STREAM_KM2 * 1e6 / 900) & L["corr_geom"]
    lines = R4.stream_lines(smask, R["fd"], T)
    (out / "vectors/streams.geojson").write_text(json.dumps(gj([dict(
        type="Feature", properties=dict(length_km=round(l.length / 1000, 2)), geometry=R4.rnd_coords(l, 0))
        for l in lines])), "utf-8")
    # hand.png cropped to the corridor bbox (30 m; halve if > 2 MB)
    rr, cc = np.nonzero(L["corr"])
    r0, r1, c0, c1 = rr.min(), rr.max() + 1, cc.min(), cc.max() + 1
    sub = L["hand_c"][r0:r1, c0:c1]
    res = RES
    for f in (1, 2, 3):
        if f > 1:
            hh, ww = sub.shape[0] // f * f, sub.shape[1] // f * f
            s = sub[:hh, :ww].reshape(hh // f, f, ww // f, f)
            with np.errstate(all="ignore"):
                arr = np.nanmean(s, axis=(1, 3))
        else:
            arr = sub
        enc = np.where(np.isfinite(arr), np.clip(np.round(arr * 100), 0, 65534), 65535).astype(np.uint16)
        Image.fromarray(enc).save(out / "flood/hand.png", optimize=True)
        res = RES * f
        if (out / "flood/hand.png").stat().st_size <= 2e6:
            break
    bx0, by1 = T.c + c0 * RES, T.f - r0 * RES
    bounds = [bx0, by1 - enc.shape[0] * res, bx0 + enc.shape[1] * res, by1]
    to_ll = Transformer.from_crs(CRS, 4326, always_xy=True)
    from rasterio.warp import transform_bounds
    hg = dict(crs=f"EPSG:{CRS}", bounds_m=[round(v, 1) for v in bounds],
              bounds_lonlat=[round(v, 5) for v in transform_bounds(f"EPSG:{CRS}", "EPSG:4326", *bounds)],
              res_m=res, size_px=[int(enc.shape[1]), int(enc.shape[0])], encoding=dict(type="r16", scale=0.01),
              nodata=65535, note="Corridor grid (not the scene grid): HAND in cm, 65535 = outside the corridor",
              badge="MODELLED")
    (out / "flood/hand_grid.json").write_text(json.dumps(hg, indent=1), "utf-8")
    vmin_mm = rows[int(round(H_MIN_MEANINGFUL / H_STEP)) - 1]["V_m3"]
    method = (f"DEM: {dem_txt}. HAND = height above the main-stem D8 flow-path cell each cell drains to (pysheds, "
              f"HydroRIVERS channel burned −{R['burn_m']:g} m). Corridor ≤ {CORR_KM:g} km from the path, {reach} "
              f"({R['length_km']:.0f} km), reservoirs and sea excluded. V(h) = Σ(h − HAND)·900 m² over HAND < h. "
              "Exposure: ESA WorldCover 2021 cropland (40) and built-up (50) area fractions at 30 m, WorldPop 2020 "
              f"constrained (population), {P['bld_src']}, OSM roads (all classes incl. tracks), villages = OSM "
              "place=city|town|village|hamlet whose built cells (building centroid or ≥ 25 % WorldCover built-up) within "
              "300 m of the node lie below h.")
    uncert = ("Scenario exploration, not a forecast. 30 m terrain. Static 'bathtub': the whole volume is spread at one "
              "height along the entire corridor at once (no timing, attenuation or channel capacity), so it "
              "underestimates depth near the dam and overstates simultaneous extent downstream. HAND ≈ 0 inside "
              f"depression-filled channel reaches ({rows[0]['area_km2']:.0f} km² 'wet' at h = {rows[0]['h']:g} m): "
              f"volumes below ≈ {vmin_mm / 1e6:.1f} Mm³ (h < {H_MIN_MEANINGFUL:g} m) are not meaningful. No channel "
              "bathymetry; GEM-15 is a model-predicted DTM and GLO-30 is a surface model (trees, buildings); OSM "
              "buildings and roads are incomplete (lower bounds); WorldPop is itself a model."
              + ("" if P["osm_ok"]["buildings"] else " BUILDINGS NOT AVAILABLE for this corridor (OSM download failed): "
                 "buildings = 0 means 'not counted', not 'none'; villages use WorldCover built-up only.")
              + ("" if P["osm_ok"]["roads"] else " ROADS PARTIAL: OSM roads were downloaded only for the corridor "
                 f"chunks {[i for i, ok in enumerate(P['osm_cover']['roads']) if ok]} (each ≈ "
                 f"{P['osm_cover']['chunk_km']} km of river from the dam); road_km counts only those."))
    lut = C.HandLut(badge="MODELLED", source=src_txt + "; ESA WorldCover 2021; WorldPop 2020 constrained"
                    + ("; Microsoft Global ML Building Footprints" if P["bld_src"].startswith("Microsoft") else ""),
                    method=method, uncertainty=uncert, placeholder=False, dam_id=dam_id,
                    corridor="vectors/corridor.geojson", reach=reach, hand_file="flood/hand.png",
                    hand_encoding=C.Encoding(type="r16", scale=0.01),
                    rows=[C.HandRow(h=round(r["h"], 2), V_m3=round(r["V_m3"]), area_km2=round(r["area_km2"], 3),
                                    cropland_ha=round(r["cropland_ha"], 1), builtup_ha=round(r["builtup_ha"], 1),
                                    villages=r["villages"], road_km=round(r["road_km"], 2),
                                    population=round(r["population"]), buildings=r["buildings"]) for r in rows])
    p = out / C.BUNDLE_PATHS["hand_lut"]
    p.write_text(json.dumps(lut.model_dump(mode="json", by_alias=True), ensure_ascii=False, indent=1), "utf-8")
    C.HandLut.model_validate_json(p.read_text("utf-8"))
    meta = dict(badge="MODELLED", source=src_txt, uncertainty="Scenario exploration, not a forecast. 30 m terrain. "
                "Routing line, not a surveyed thalweg.", placeholder=False, sensor="model")
    layers = [
        dict(id="flowpath", kind="vector", grid="none", file="vectors/flowpath.geojson",
             label=f"Flow path: dam → {end_txt}", method=fp["features"][0]["properties"]["method"], **meta),
        dict(id="streams", kind="vector", grid="none", file="vectors/streams.geojson", label="Stream network (corridor)",
             method=f"D8 accumulation > {STREAM_KM2:g} km² (in-window area only) on {dem_txt}", **meta),
        dict(id="corridor", kind="vector", grid="none", file="vectors/corridor.geojson", label="HAND corridor",
             method=f"≤ {CORR_KM:g} km from the flow path, reservoirs and sea excluded ({dem_txt})", **meta),
        dict(id="hand", kind="hand", grid="none", file="flood/hand.png", label="Height above the river (HAND)",
             method=method + f" Corridor grid in flood/hand_grid.json ({res:g} m); uint16 cm, 65535 = outside.",
             encoding=dict(type="r16", scale=0.01), **{**meta, "uncertainty": uncert}),
    ]
    for l in layers:
        C.Layer.model_validate(l)
    files = {f: (out / f).stat().st_size for f in ("vectors/flowpath.geojson", "vectors/streams.geojson",
                                                    "vectors/corridor.geojson", "flood/hand.png", "flood/hand_grid.json",
                                                    "flood/hand_lut.json")}
    for f, s in files.items():
        log(f"  wrote {dam_id}/{f}: {s / 1e3:.1f} kB")
    hl = dict(dam_id=dam_id, generated_by="pipeline/v2/route_hand.py", dem=which, dem_label=dem_txt,
              hand_lut="flood/hand_lut.json", hand_grid="flood/hand_grid.json", layers=layers, files=files,
              min_meaningful=dict(h_m=H_MIN_MEANINGFUL, V_m3=round(vmin_mm)), exposure_available=dict(
                  buildings=P["osm_ok"]["buildings"], buildings_source=P["bld_src"], roads=P["osm_ok"]["roads"], population=bool(P["pop_meta"]),
                  cropland=True), banner="Scenario exploration, not a "
              "forecast. 30 m terrain.", note="Register these layers in manifest.json (geo-pipeline/lead). hand is on "
              "its own corridor grid (grid='none', see flood/hand_grid.json), not on terrain/grid.json.")
    (P["wd"] / "hydro_layers.json").write_text(json.dumps(hl, indent=1, ensure_ascii=False), "utf-8")
    # work artefacts for impacts.py / QA
    crs = f"EPSG:{CRS}"
    R4.write_tif(P["wd"] / "hand_30m.tif", L["hand_c"].astype(np.float32), T, crs, nodata=np.nan, dtype="float32")
    R4.write_tif(P["wd"] / "dem30.tif", R["z"].astype(np.float32), T, crs, dtype="float32")
    R4.write_tif(P["wd"] / "drain_k_30m.tif", L["drain_k"], T, crs, nodata=-1, dtype="int32")
    R4.write_tif(P["wd"] / "stop_30m.tif", R["stop"].astype(np.uint8), T, crs, dtype="uint8")
    (P["wd"] / "route.json").write_text(json.dumps(dict(
        dem=R["which"], outlet_xy=list(R["outlet_xy"]), dam_xy=[P["dam_pt"].x, P["dam_pt"].y], length_km=R["length_km"],
        end=R["end_kind"], breaks=breaks, burn_m=R["burn_m"], path_xy=[[round(float(a), 1), round(float(b), 1)]
        for a, b in np.array(R["line"].coords)], vertex_dist_km=[round(float(v), 3) for v in R["vdist"]]), indent=1,
        ensure_ascii=False), "utf-8")
    np.savez_compressed(P["wd"] / "exposure_30m.npz", crop=L["ex"]["crop"].astype(np.float32),
                        built=L["ex"]["built"].astype(np.float32), pop=L["ex"]["pop"].astype(np.float32),
                        bld=L["ex"]["bld"], road=L["ex"]["road"].astype(np.float32), corr=L["corr"],
                        builtcell=L["builtcell"], T=np.array(list(T)[:6]))
    L["villages"].to_file(P["wd"] / "villages.gpkg", driver="GPKG")
    np.save(P["wd"] / "path_cells.npy", R["path"])
    (P["wd"] / "lut_rows.json").write_text(json.dumps(rows), "utf-8")
    return hl


def qa_png(P, R, L, breaks, path_png):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LightSource
    rr, cc = np.nonzero(L["corr"])
    pad = 150
    r0, r1 = max(rr.min() - pad, 0), min(rr.max() + pad, P["shape"][0])
    c0, c1 = max(cc.min() - pad, 0), min(cc.max() + pad, P["shape"][1])
    f = max(1, int(np.ceil(max(r1 - r0, c1 - c0) / 2500)))
    z = R["z"][r0:r1:f, c0:c1:f]
    hs = LightSource(315, 35).hillshade(z, vert_exag=3, dx=RES * f, dy=RES * f)
    hd = L["hand_c"][r0:r1:f, c0:c1:f]
    T = P["T"]
    ext = [T.c + c0 * RES, T.c + c1 * RES, T.f - r1 * RES, T.f - r0 * RES]
    fig, ax = plt.subplots(figsize=(13, 13 * (r1 - r0) / max(c1 - c0, 1) + 1.2), dpi=110)
    ax.imshow(hs, cmap="gray", extent=ext, alpha=0.9)
    im = ax.imshow(np.where(hd < 10, hd, np.nan), cmap="viridis_r", vmin=0, vmax=10, extent=ext, alpha=0.75)
    for g in P["rivers"].geometry:
        xs = [g] if g.geom_type == "LineString" else list(g.geoms)
        for s in xs:
            ax.plot(*s.xy, color="deepskyblue", lw=0.6)
    ax.plot(*R["line"].xy, color="red", lw=1.4, label=f"D8 path {R['length_km']:.1f} km ({R['which']})")
    ax.plot(P["dam_pt"].x, P["dam_pt"].y, "*", color="yellow", ms=16, mec="k", label="dam")
    for b in breaks:
        p = R["line"].interpolate(b["dist_km"] * 1000)
        ax.plot(p.x, p.y, "o", color="white", mec="k", ms=5)
        ax.annotate(f"{b['name']} km {b['dist_km']:.1f}", (p.x, p.y), fontsize=7, color="k",
                    bbox=dict(fc="white", alpha=0.7, lw=0), xytext=(4, 4), textcoords="offset points")
    ax.set_xlim(ext[0], ext[1])
    ax.set_ylim(ext[2], ext[3])
    plt.colorbar(im, ax=ax, shrink=0.5, label="HAND (m), < 10 m shown")
    ax.legend(loc="lower right", fontsize=8)
    ax.set_title(f"{P['spec']['name']}: D8 path + HAND (MODELLED, EPSG:32632). D2 {R['D2']['pct_within_300m_osm_river']:.1f}% "
                 f"within 300 m of OSM rivers. Scenario exploration, not a forecast. 30 m terrain.", fontsize=9)
    fig.tight_layout()
    fig.savefig(path_png)
    plt.close(fig)


# ------------------------------------------------------------------------------------------------ main
def run(dam_id, spec, dem_choice):
    P = prepare(dam_id, spec)
    runs = {}
    for which in (("gem15", "cop30") if dem_choice == "auto" else (dem_choice,)):
        if which == "gem15" and not P["tiles"]["used"]:
            continue
        for bm in BURNS_M:
            r = route(P, which, bm)
            if r["D2"]["passed"] or bm == BURNS_M[-1]:
                break
        runs[which] = r
    ok = lambda r: r["D1"]["passed"] and r["D2"]["passed"]  # noqa: E731
    if "gem15" in runs and ok(runs["gem15"]):
        R, why = runs["gem15"], "GEM-15 passes D1 and D2"
    elif "cop30" in runs and ok(runs["cop30"]):
        R, why = runs["cop30"], "GEM-15 variant failed D1/D2 (or no tile); GLO-30 passes"
    else:
        R = max(runs.values(), key=lambda r: r["D2"]["pct_within_300m_osm_river"])
        why = "no variant passes both D1 and D2: kept the higher D2 (claims limited)"
    log(f"[{dam_id}] DEM chosen: {R['which']} ({why})")
    breaks, main_name = reach_breaks(P, R)
    L = hand_lut(P, R)
    rows = L["rows"]
    keys = ("V_m3", "area_km2", "cropland_ha", "builtup_ha", "villages", "road_km", "population", "buildings")
    mono = {k: bool(all(b[k] >= a[k] - 1e-9 for a, b in zip(rows, rows[1:]))) for k in keys}
    D3 = dict(monotonic=mono, V_strictly_increasing=bool(all(b["V_m3"] > a["V_m3"] for a, b in zip(rows, rows[1:]))),
              n_rows=len(rows), h_max_m=rows[-1]["h"], V_max_m3=rows[-1]["V_m3"], passed=bool(all(mono.values())))
    D4 = {}
    for V in (1e6, 5e6, 20e6, 100e6, 500e6):
        h = h_for_volume(rows, V)
        e = dict(h_m=None)
        if h is not None:
            e = exposure_at(h, L["hand"], L["corr"], L["ex"], L["vmin"])
            e["h_m"] = e.pop("h")
            e["mean_depth_m"] = e["V_m3"] / max(e["area_km2"] * 1e6, 1)
            e["villages_list"] = [name_of(L["villages"].iloc[i]) or L["villages"].osm_id[i]
                                  for i in np.nonzero(L["vmin"] < h)[0]]
            e["below_min_meaningful"] = bool(h < H_MIN_MEANINGFUL)
        D4[f"{V / 1e6:g}"] = e
    tests = dict(dam_id=dam_id, dem_chosen=R["which"], dem_choice_reason=why,
                 burn_m=R["burn_m"],
                 variants={w: dict(D1=r["D1"], D2=r["D2"], length_km=r["length_km"], end=r["end_kind"], burn_m=r["burn_m"],
                                   gem15_on_path_pct=r["gem_path_pct"], dem_info=r["dem_info"]) for w, r in runs.items()},
                 D1=R["D1"], D2=R["D2"], D3=D3, D4=D4, snap=P["snap"], crest=P["crest_src"],
                 outlet=dict(xy=R["outlet_xy"], dist_from_dam_m=float(np.hypot(R["outlet_xy"][0] - P["dam_pt"].x,
                                                                              R["outlet_xy"][1] - P["dam_pt"].y)),
                             rule=R["outlet_note"]),
                 length_km=R["length_km"], end=R["end_kind"], river=main_name, reach_breaks=breaks,
                 gem15_tiles=P["tiles"], worldpop=P["pop_meta"],
                 corridor_km2=float(L["corr"].sum() * 900 / 1e6),
                 corridor_gem15_pct=float(np.isfinite(P["gem"][L["corr"]]).mean() * 100),
                 villages_in_window=int(len(L["villages"])),
                 villages_with_built_cells_in_corridor=int(np.isfinite(L["vmin"]).sum()),
                 osm_sources=dict(OSM_SOURCES), osm_available=P["osm_ok"], osm_chunk_coverage=P["osm_cover"],
                 osm=dict(buildings=int(len(P["bld"])), roads=int(len(P["roads"])), rivers=int(len(P["rivers"]))))
    for k in ("D1", "D2", "D3"):
        log(f"[{dam_id}] {k}", json.dumps(tests[k], ensure_ascii=False)[:600])
    for k, e in D4.items():
        log(f"[{dam_id}] V={k} Mm³: " + json.dumps({a: (round(b, 2) if isinstance(b, float) else b) for a, b in e.items()},
                                                  ensure_ascii=False)[:500])
    hl = write_outputs(P, R, L, breaks, main_name, tests, runs)
    tests["min_meaningful"] = hl["min_meaningful"]
    (P["wd"] / "tests.json").write_text(json.dumps(tests, indent=1, ensure_ascii=False, default=float), "utf-8")
    qa_png(P, R, L, breaks, P["wd"] / "qa_path_hand.png")
    return tests


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dams", nargs="+")
    ap.add_argument("--dem", default="auto", choices=["auto", "gem15", "cop30"])
    ap.add_argument("--lon", type=float)
    ap.add_argument("--lat", type=float)
    ap.add_argument("--crest-osm-way", type=int)
    ap.add_argument("--name")
    ap.add_argument("--offline-osm", action="store_true", help="never query Overpass for uncached buildings/roads")
    a = ap.parse_args()
    global OFFLINE_OSM
    OFFLINE_OSM = a.offline_osm
    for d in a.dams:
        spec = dict(DAMS.get(d, {}))
        if a.lon is not None:
            spec.update(lonlat=(a.lon, a.lat), name=a.name or spec.get("name", d))
        if a.crest_osm_way:
            spec["crest_osm_way"] = a.crest_osm_way
        if "lonlat" not in spec:
            raise SystemExit(f"unknown dam {d}: give --lon/--lat")
        spec.setdefault("name", d)
        t = time.time()
        run(d, spec, a.dem)
        log(f"[{d}] done in {(time.time() - t) / 60:.1f} min")
    return 0


if __name__ == "__main__":
    sys.exit(main())
