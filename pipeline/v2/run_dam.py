#!/usr/bin/env python3
"""V2 · run_dam: the V1 Mellègue reservoir pipeline, generalised to any dam on Earth (docs/09 §0.2–0.5).

From a dam point (and optionally a crest line / OSM ids) this script derives a per-dam config and runs, with the
V1 methods UNCHANGED (CLAUDE.md §8):

  config     dam point, crest, OSM reservoir polygon (Overpass), lake / read / scene boxes, UTM zone, periods
             → config/dams/<id>.yaml (+ work/v2/<id>/osm_*.geojson)
  catchment  HydroBASINS lev-12 upstream union + HydroRIVERS downstream path (same snap rules as dam_catalog.py)
  terrain    Copernicus GLO-30 (Planetary Computer) on a UTM 30 m scene grid → RG16 heightmap + hillshade + grid.json
  s1         Sentinel-1 RTC VV windows (Planetary Computer COGs), cached per item
  nisar      NISAR L2 GCOV HH/HV windows over HTTP range reads (common.nisar_io.RangeFile), cached per product
  reservoir  lake polygon = water frequency (≥ 50 %) in the pre-period S1 images (∩ JRC GSW max extent when it
             covers the polygon) + 100 m dilation; per-image Otsu in polygon + 300 m ring, clamped −23…−13.5 dB;
             area inside the polygon; ±2 dB band; low/medium/high confidence; per-track harmonisation; chips + masks
  anomaly    03_anomaly.departure_rule unchanged (21-day multi-sensor baseline, −12 % / −20 %, confirmed within 6 d)
  swot       Prior Lake Database lookup (LakeSP_Prior granule, Earthdata token) → Hydrocron LakeSP time series
  bundle     apps/web/public/data/v2/<id>/ validated with pipeline/common/contracts.py (placeholders ILLUSTRATIVE)
  report     work/v2/<id>/report.md + QA PNGs (contact sheet, series)

  python pipeline/v2/run_dam.py --dam sidi-salem --osm-dam w172827257 --osm-reservoir r2307563
  python pipeline/v2/run_dam.py --dam el-aroussia --lonlat 9.772606 36.799646 --crest BARRAGE_AROUSSIA.geojson
  python pipeline/v2/run_dam.py --dam ouldjet-mellegue --osm-dam w720711317 --osm-reservoir w1443429792
  python pipeline/v2/run_dam.py --dam <id> --steps reservoir anomaly bundle report     # re-run from the cache

Secrets: EARTHDATA_TOKEN from the environment or the main checkout's .env (never printed).
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402  (PROJ/GDAL guard first: before rasterio / pyproj)
from common import contracts as C  # noqa: E402
from common import nisar_io as mt  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402

ROOT = common.ROOT
PIPE = ROOT / "pipeline"
STEPS = ["config", "catchment", "terrain", "s1", "nisar", "reservoir", "anomaly", "swot", "bundle", "report"]
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = "osm-research-client/0.1"
SRC = dict(
    nisar="NASA/JPL–ISRO NISAR L2 GCOV via ASF DAAC",
    s1="ESA Copernicus Sentinel-1 RTC via Microsoft Planetary Computer",
    dem="Copernicus DEM GLO-30 (ESA) via Microsoft Planetary Computer",
    osm="OpenStreetMap contributors (ODbL)",
    hydro="HydroBASINS lev-12 v1c / HydroRIVERS v1.0 (Lehner & Grill 2013)",
    swot="SWOT (NASA/CNES) Hydrocron LakeSP",
    gsw="JRC Global Surface Water v1.4 max extent (Pekel et al. 2016) via Microsoft Planetary Computer",
)


def log(m):
    print(m, flush=True)


def load_mod(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


R02 = load_mod(PIPE / "02_reservoir.py", "res02")      # otsu_thr, clean, disk (generic helpers)
T01 = load_mod(PIPE / "01_terrain.py", "terr01")        # fetch_dem, fill_nan, hillshade, to_rg16, resample
B08 = load_mod(PIPE / "08_bundle.py", "bundle08")       # write_json, register_layer, validate


def utm_epsg(lon, lat) -> int:
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def main_repo() -> Path:
    return ROOT.parent / "NASA_CHALLENGE"


def load_token() -> str | None:
    if not os.environ.get("EARTHDATA_TOKEN"):
        common.load_env(main_repo() / ".env")
        common.load_env(ROOT / ".env")
    return os.environ.get("EARTHDATA_TOKEN")


# ================================================================================================ paths / cfg
class Paths:
    def __init__(self, dam_id: str):
        self.id = dam_id
        self.cfg = ROOT / "config" / "dams" / f"{dam_id}.yaml"
        self.cache = ROOT / "cache" / "v2" / dam_id
        self.work = ROOT / "work" / "v2" / dam_id
        self.out = ROOT / "apps" / "web" / "public" / "data" / "v2" / dam_id
        for p in (self.cache / "gcov", self.cache / "s1", self.work, self.out):
            p.mkdir(parents=True, exist_ok=True)


def save_cfg(P: Paths, cfg: dict):
    P.cfg.parent.mkdir(parents=True, exist_ok=True)
    P.cfg.write_text("# generated by pipeline/v2/run_dam.py --steps config (edit and re-run later steps)\n"
                     + yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")


def load_cfg(P: Paths) -> dict:
    if not P.cfg.exists():
        sys.exit(f"{P.cfg} missing: run --steps config first")
    return yaml.safe_load(P.cfg.read_text(encoding="utf-8"))


# ================================================================================================ OSM
def overpass(query: str, cache: Path) -> dict:
    import requests
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    for url in OVERPASS:
        for wait in (0, 15, 45):
            time.sleep(wait)
            try:
                r = requests.post(url, data={"data": query}, headers={"User-Agent": UA}, timeout=180)
                if r.status_code == 200 and r.text.lstrip().startswith("{"):
                    js = r.json()
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(json.dumps(js, ensure_ascii=False), encoding="utf-8")
                    return js
                log(f"  overpass HTTP {r.status_code} ({url})")
            except Exception as e:  # noqa: BLE001
                log(f"  overpass {type(e).__name__} ({url})")
    raise RuntimeError("Overpass unreachable")


def osm_ref(s: str) -> tuple[str, int]:
    kind = {"w": "way", "r": "relation", "n": "node"}[s[0].lower()]
    return kind, int(s[1:])


def osm_features(js) -> "gpd.GeoDataFrame":
    import geopandas as gpd
    cat = load_mod(PIPE / "v2" / "dam_catalog.py", "dam_catalog")
    rows = []
    for e in js.get("elements", []):
        g = cat.el_geom(e)
        if g is None or g.is_empty:
            continue
        t = e.get("tags", {})
        rows.append(dict(osm_id=f"{e['type'][0]}{e['id']}", geometry=g, **{k: t.get(k) for k in (
            "name", "name:fr", "name:en", "name:ar", "waterway", "man_made", "natural", "water", "landuse")}))
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=4326) if rows else gpd.GeoDataFrame(
        columns=["osm_id", "geometry"], geometry="geometry", crs=4326)


# ================================================================================================ step: config
def step_config(P: Paths, a) -> dict:
    import geopandas as gpd
    from shapely.geometry import LineString, Point, box, mapping, shape
    old = yaml.safe_load(P.cfg.read_text(encoding="utf-8")) if P.cfg.exists() else {}
    dam_old = old.get("dam", {})
    main_cfg = common.load_config(ROOT / "config.yaml")
    lonlat = tuple(a.lonlat) if a.lonlat else tuple(dam_old.get("lonlat") or ())
    crest = None
    crest_src = None
    if a.crest:
        fc = json.loads(Path(a.crest).read_text(encoding="utf-8"))
        for f in fc["features"]:
            g = shape(f["geometry"])
            if g.geom_type == "LineString":
                crest, crest_src = g, f"user file {Path(a.crest).name}"
            elif g.geom_type == "Point" and not lonlat:
                lonlat = (g.x, g.y)
    osm_dam = a.osm_dam or dam_old.get("osm_dam")
    osm_res = a.osm_reservoir or dam_old.get("osm_reservoir")
    ids = [osm_ref(x) for x in (osm_dam, osm_res) if x]
    byid = gpd.GeoDataFrame(columns=["osm_id", "geometry"], geometry="geometry", crs=4326)
    if ids:
        q = "[out:json][timeout:120];(" + "".join(f"{k}({i});" for k, i in ids) + ");out geom;"
        byid = osm_features(overpass(q, P.cache / "osm_ids.json"))
    if osm_dam and crest is None:
        d = byid[byid.osm_id == osm_dam]
        if len(d):
            crest, crest_src = d.geometry.iloc[0], f"OSM {osm_dam}"
    if not lonlat:
        if crest is None:
            sys.exit("need --lonlat, --crest or --osm-dam")
        p = crest.interpolate(0.5, normalized=True) if crest.geom_type == "LineString" else crest.representative_point()
        lonlat = (p.x, p.y)
    lon, lat = float(lonlat[0]), float(lonlat[1])
    epsg = utm_epsg(lon, lat)
    # everything water-like and dam-like within 3 km (cached): crest fallback, reservoir fallback, provenance
    R = 3000
    q = (f"[out:json][timeout:120];(nwr(around:{R},{lat},{lon})[\"waterway\"=\"dam\"];"
         f"way(around:{R},{lat},{lon})[\"natural\"=\"water\"];relation(around:{R},{lat},{lon})[\"natural\"=\"water\"];"
         f"way(around:{R},{lat},{lon})[\"landuse\"=\"reservoir\"];relation(around:{R},{lat},{lon})[\"landuse\"=\"reservoir\"];"
         f"way(around:{R},{lat},{lon})[\"waterway\"=\"riverbank\"];);out geom;")
    near = osm_features(overpass(q, P.cache / "osm_around.json")).to_crs(epsg)
    pt = gpd.GeoSeries([Point(lon, lat)], crs=4326).to_crs(epsg).iloc[0]
    dams = near[near.get("waterway", pd.Series(dtype=object)).fillna("").eq("dam") & near.geom_type.eq("LineString")]
    if crest is None and len(dams):
        k = dams.distance(pt).idxmin()
        if dams.distance(pt)[k] < 1000:
            crest, crest_src = dams.to_crs(4326).geometry[k], f"OSM {dams.osm_id[k]} (nearest dam line)"
    crest_u = gpd.GeoSeries([crest], crs=4326).to_crs(epsg).iloc[0] if crest is not None else None
    # reservoir polygon
    res_poly, res_src, res_note = None, None, ""
    if osm_res is not None:
        r = byid[byid.osm_id == osm_res]
        if len(r) and r.geom_type.iloc[0] in ("Polygon", "MultiPolygon"):
            res_poly, res_src = r.to_crs(epsg).geometry.iloc[0].buffer(0), f"OSM {osm_res}"
    if res_poly is None:
        w = near[near.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
        anchor = crest_u.buffer(300) if crest_u is not None else pt.buffer(500)
        w = w[w.intersects(anchor)]
        if len(w):
            w["geometry"] = w.geometry.buffer(0)
            riverish = w.get("water", pd.Series(index=w.index, dtype=object)).fillna("").isin(["river", "canal", "stream"]) | \
                w.get("waterway", pd.Series(index=w.index, dtype=object)).fillna("").eq("riverbank")
            w.loc[riverish, "geometry"] = w.loc[riverish].geometry.intersection(pt.buffer(2500))
            k = w.area.idxmax()
            res_poly, res_src = w.geometry[k], f"OSM {w.osm_id[k]}" + (" (river polygon clipped to 2.5 km)" if riverish[k] else "")
            if riverish[k]:
                res_note = "the only OSM water polygon at the dam is the river channel: pool + channel measured"
    res_km2 = round(res_poly.area / 1e6, 3) if res_poly is not None else None
    # boxes (lon/lat) from the reservoir polygon (or a 1.5 km disc) + margin
    core = res_poly if res_poly is not None else pt.buffer(1500)
    if crest_u is not None:
        core = core.union(crest_u.buffer(100))
    x0, y0, x1, y1 = core.bounds
    m = max(800.0, 0.12 * math.hypot(x1 - x0, y1 - y0))
    lake_u = box(x0 - m, y0 - m, x1 + m, y1 + m)
    read_u = lake_u.buffer(1500, join_style=2)
    scene_u = lake_u.buffer(max(6000.0, 0.25 * math.hypot(x1 - x0, y1 - y0)), join_style=2)

    def ll(g):
        b = gpd.GeoSeries([g], crs=epsg).to_crs(4326).total_bounds
        return [round(float(v), 5) for v in b]
    name = a.name or dam_old.get("name")
    if not name and osm_dam and len(byid):
        d = byid[byid.osm_id == osm_dam]
        for col in ("name:fr", "name:en", "name"):
            if col in d and d[col].notna().any():
                name = str(d[col].dropna().iloc[0])
                break
    small = res_km2 is not None and res_km2 < 1.0 or res_poly is None
    today = dt.date.today().isoformat()
    cfg = dict(
        dam=dict(id=P.id, name=name or P.id, name_source=a.name_source or dam_old.get("name_source", ""),
                 lonlat=[round(lon, 6), round(lat, 6)], crest_source=crest_src,
                 crest=json.loads(json.dumps(mapping(crest))) if crest is not None else None,
                 osm_dam=osm_dam, osm_reservoir=(res_src or "").split(" ")[1] if res_src else None,
                 reservoir_source=res_src, reservoir_osm_km2=res_km2, reservoir_note=res_note),
        crs=dict(analysis=f"EPSG:{epsg}", lake_res_m=10, scene_res_m=30),
        aoi=dict(lake=ll(lake_u), read=ll(read_u), scene=ll(scene_u)),
        period=dict(s1=["2026-04-01", today], nisar=["2026-06-01", today], pre=["2026-04-01", "2026-06-15"]),
        water=dict(boxcar=3 if small else 5, clamp_db=[-23.0, -13.5], ring_m=300, polygon_dilate_m=100,
                   freq_min=0.5, min_core_px=30 if small else 200, s1_wind_flag_median_db=-16.0,
                   nisar_pick="finest" if small else "smallest", small_pool=bool(small)),
        anomaly={k: main_cfg["anomaly"][k] for k in ("baseline_days", "confirm_days", "dep_alert", "dep_warn",
                                                    "z_alert", "drop_alert", "z_warn", "drop_warn")},
        bundle=dict(version=f"v2-{today}", product=main_cfg["brand"]["product"], max_mb=8.0, max_chips=8),
    )
    for k in ("water", "period", "aoi"):        # keep hand edits of an existing per-dam config
        if old.get(k) and not a.reset:
            cfg[k] = {**cfg[k], **old[k]}
    save_cfg(P, cfg)
    gj = {"type": "FeatureCollection", "crs_note": "EPSG:4326", "features": [
        {"type": "Feature", "properties": dict(role="dam", id=P.id), "geometry": mapping(Point(lon, lat))}]}
    if crest is not None:
        gj["features"].append({"type": "Feature", "properties": dict(role="crest", source=crest_src), "geometry": mapping(crest)})
    if res_poly is not None:
        gj["features"].append({"type": "Feature", "properties": dict(role="reservoir_osm", source=res_src, area_km2=res_km2),
                               "geometry": mapping(gpd.GeoSeries([res_poly], crs=epsg).to_crs(4326).iloc[0])})
    (P.work / "osm_dam.geojson").write_text(json.dumps(gj), encoding="utf-8")
    log(f"config: {name} @ {lon:.5f},{lat:.5f} EPSG:{epsg}; crest {crest_src}; reservoir {res_src} {res_km2} km²; "
        f"lake box {cfg['aoi']['lake']}; small_pool={small}")
    return cfg


# ================================================================================================ step: catchment
def step_catchment(P: Paths, cfg: dict) -> dict:
    """HydroBASINS upstream union + HydroRIVERS downstream walk (rules of pipeline/v2/dam_catalog.py)."""
    import geopandas as gpd
    from shapely.geometry import LineString, Point, mapping
    from shapely.ops import linemerge, substring
    hb, hr = ROOT / "work/v2/hybas12_tn.gpkg", ROOT / "work/v2/hydrorivers_tn.gpkg"
    out = dict(available=False)
    if not (hb.exists() and hr.exists()):
        out["reason"] = "HydroSHEDS extracts work/v2/{hybas12,hydrorivers}_tn.gpkg missing (run dam_catalog.py)"
        (P.work / "catchment.json").write_text(json.dumps(out), "utf-8")
        return out
    epsg = int(cfg["crs"]["analysis"].split(":")[1])
    lon, lat = cfg["dam"]["lonlat"]
    pt = gpd.GeoSeries([Point(lon, lat)], crs=4326).to_crs(epsg).iloc[0]
    riv = gpd.read_file(hr, bbox=(lon - 0.1, lat - 0.1, lon + 0.1, lat + 0.1)).to_crs(epsg)
    if riv.empty:
        out["reason"] = "dam outside the HydroRIVERS extract (5.5–12.2 E, 29.8–38.0 N)"
        (P.work / "catchment.json").write_text(json.dumps(out), "utf-8")
        return out
    cand = riv[riv.distance(pt) < 3000].copy()
    rule = "nearest main stem within 3 km"
    resp = [f for f in json.loads((P.work / "osm_dam.geojson").read_text("utf-8"))["features"]
            if f["properties"]["role"] == "reservoir_osm"]
    if resp and len(cand):
        rp = gpd.GeoSeries.from_xy([0], [0])  # noqa: F841
        from shapely.geometry import shape
        rpoly = gpd.GeoSeries([shape(resp[0]["geometry"])], crs=4326).to_crs(epsg).iloc[0]
        th = cand[cand.intersects(rpoly.buffer(150))]
        if len(th):
            cand, rule = th, "main stem through the reservoir polygon"
    if cand.empty:
        out["reason"] = "no HydroRIVERS reach within 3 km"
        (P.work / "catchment.json").write_text(json.dumps(out), "utf-8")
        return out
    cand["d"] = cand.distance(pt)
    mainr = cand[cand.UPLAND_SKM >= 0.5 * cand.UPLAND_SKM.max()].assign(d1=lambda x: x.d.round(0))
    s = mainr.sort_values(["d1", "UPLAND_SKM", "HYRIV_ID"]).iloc[0]
    b12 = gpd.read_file(hb).to_crs(epsg)
    b12["HYBAS_ID"] = b12.HYBAS_ID.astype(int)
    up: dict[int, list] = {}
    for i, nd in zip(b12.HYBAS_ID, b12.NEXT_DOWN.astype(int)):
        up.setdefault(nd, []).append(i)
    ids, st = set(), [int(s.HYBAS_L12)]
    while st:
        k = st.pop()
        if k not in ids:
            ids.add(k)
            st.extend(up.get(k, []))
    sel = b12[b12.HYBAS_ID.isin(ids)]
    poly = sel.geometry.union_all().buffer(0)
    # downstream walk (≤ 200 km or to the end of the network / extract)
    allr = gpd.read_file(hr).to_crs(epsg)
    allr.index = allr.HYRIV_ID.astype(int).values
    rid = int(s.HYRIV_ID)
    first = allr.loc[rid].geometry
    first = linemerge(first) if first.geom_type == "MultiLineString" else first
    parts, L, nd, stop = [substring(first, first.project(pt), first.length)], 0.0, int(allr.loc[rid].NEXT_DOWN), None
    L = parts[0].length
    while L < 200_000:
        if nd == 0:
            stop = "end of network (sea or sink)"
            break
        if nd not in allr.index:
            stop = "edge of the HydroRIVERS extract"
            break
        g = allr.loc[nd].geometry
        g = linemerge(g) if g.geom_type == "MultiLineString" else g
        parts.append(g)
        L += g.length
        nd = int(allr.loc[nd].NEXT_DOWN)
    stop = stop or "200 km cap"
    cs = []
    for p in parts:
        for geom in (p.geoms if hasattr(p, "geoms") else [p]):
            c = list(geom.coords)
            cs += c[1:] if cs and c and c[0] == cs[-1] else c
    line = LineString(cs)
    to_ll = lambda g: gpd.GeoSeries([g], crs=epsg).to_crs(4326).iloc[0]  # noqa: E731
    fc_c = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": dict(
        role="catchment", area_km2=round(poly.area / 1e6, 1), n_basins=len(ids), snap_m=round(float(s.d)),
        snap_rule=rule, badge="MODELLED", source=SRC["hydro"]),
        "geometry": mapping(to_ll(poly.simplify(150, preserve_topology=True)))}]}
    fc_d = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": dict(
        role="river_down", length_km=round(line.length / 1000, 1), to=stop, badge="MODELLED", source=SRC["hydro"]),
        "geometry": mapping(to_ll(line.simplify(60)))}]}
    (P.work / "catchment.geojson").write_text(json.dumps(fc_c), "utf-8")
    (P.work / "flowpath.geojson").write_text(json.dumps(fc_d), "utf-8")
    out = dict(available=True, area_km2=round(poly.area / 1e6, 1), sum_sub_area_km2=round(float(sel.SUB_AREA.sum()), 1),
               n_basins=len(ids), snap_m=round(float(s.d)), snap_rule=rule, reach=rid,
               reach_upland_km2=float(s.UPLAND_SKM), downstream_km=round(line.length / 1000, 1), downstream_to=stop)
    (P.work / "catchment.json").write_text(json.dumps(out, indent=1), "utf-8")
    log(f"catchment {out['area_km2']} km² ({len(ids)} basins, snap {out['snap_m']} m, {rule}); "
        f"downstream {out['downstream_km']} km → {stop}")
    return out


# ================================================================================================ grids
class Grid:
    def __init__(self, bounds, res, crs):
        from rasterio.transform import from_origin
        self.bounds, self.res, self.crs = tuple(float(b) for b in bounds), float(res), crs
        self.w = int(round((bounds[2] - bounds[0]) / res))
        self.h = int(round((bounds[3] - bounds[1]) / res))
        self.transform = from_origin(bounds[0], bounds[3], res, res)

    def window_of(self, other: "Grid"):
        c0 = int(round((other.bounds[0] - self.bounds[0]) / self.res))
        r0 = int(round((self.bounds[3] - other.bounds[3]) / self.res))
        f = int(round(other.res / self.res))
        return slice(r0, r0 + other.h * f), slice(c0, c0 + other.w * f)


def analysis_grid(cfg) -> Grid:
    crs = cfg["crs"]["analysis"]
    res = float(cfg["crs"]["lake_res_m"])
    return Grid(T01.utm_bounds(cfg["aoi"]["read"], crs, res), res, crs)


def chip_grid(cfg, g: Grid, max_px=1000) -> Grid:
    lb = T01.utm_bounds(cfg["aoi"]["lake"], g.crs, g.res)
    f = max(1, math.ceil(max(lb[2] - lb[0], lb[3] - lb[1]) / g.res / max_px))
    s = g.res * f
    x0 = g.bounds[0] + math.floor((lb[0] - g.bounds[0]) / s) * s
    y1 = g.bounds[3] - math.floor((g.bounds[3] - lb[3]) / s) * s
    w, h = math.ceil((lb[2] - x0) / s), math.ceil((y1 - lb[1]) / s)
    w, h = min(w, int((g.bounds[2] - x0) // s)), min(h, int((y1 - g.bounds[1]) // s))
    return Grid((x0, y1 - h * s, x0 + w * s, y1), s, g.crs)


def to_grid(arr, src_transform, src_crs, grid: Grid):
    from rasterio.warp import Resampling, reproject
    dst = np.full((grid.h, grid.w), np.nan, np.float32)
    reproject(arr.astype(np.float32), dst, src_transform=src_transform, src_crs=src_crs, src_nodata=np.nan,
              dst_transform=grid.transform, dst_crs=grid.crs, dst_nodata=np.nan, resampling=Resampling.bilinear)
    return dst


def load_db(P: Paths, row, grid: Grid, k: int):
    """Speckle filter in native geometry (linear power), dB, bilinear onto the analysis grid (as 02_reservoir)."""
    from affine import Affine
    from rasterio.transform import from_origin
    if row["sensor"] == "NISAR":
        z = np.load(P.cache / "gcov" / f"{row['scene']}.npz", allow_pickle=True)
        meta = z["meta"].item()
        p, x, y = z["HH"].astype(np.float32), meta["x"], meta["y"]
        if y[0] < y[-1]:
            p, y = p[::-1], y[::-1]
        dx, dy = float(np.median(np.diff(x))), float(abs(np.median(np.diff(y))))
        tr, crs = from_origin(x.min() - dx / 2, y.max() + dy / 2, dx, dy), f"EPSG:{meta['epsg']}"
    else:
        z = np.load(P.cache / "s1" / f"{row['scene']}.npz", allow_pickle=True)
        p, tr, crs = z["VV"].astype(np.float32), Affine(*z["transform"][:6]), str(z["crs"])
    p = np.where(p > 0, p, np.nan)
    return to_grid(mt.db(mt.boxcar(p, k)), tr, crs, grid)


# ================================================================================================ step: terrain
def step_terrain(P: Paths, cfg: dict) -> dict:
    import rasterio
    from PIL import Image
    crs, res = cfg["crs"]["analysis"], float(cfg["crs"]["scene_res_m"])
    scene = cfg["aoi"]["scene"]
    bounds = T01.utm_bounds(scene, crs, res)
    tif = P.work / "dem_30m.tif"
    if tif.exists():
        with rasterio.open(tif) as src:
            z, tr = src.read(1), src.transform
        tiles = json.loads((P.work / "dem_tiles.json").read_text())
    else:
        z, tr, tiles = T01.fetch_dem("cop-dem-glo-30", scene, crs, bounds, res)
        z = T01.fill_nan(z)
        with rasterio.open(tif, "w", driver="GTiff", height=z.shape[0], width=z.shape[1], count=1, dtype="float32",
                           crs=crs, transform=tr, compress="deflate") as dst:
            dst.write(z, 1)
        (P.work / "dem_tiles.json").write_text(json.dumps(tiles))
    h30, w30 = z.shape
    w = min(1024, w30)
    h = int(round(h30 * w / w30))
    web_res = (bounds[2] - bounds[0]) / w
    zw = T01.resample(z, (h, w)) if (w, h) != (w30, h30) else z
    (P.out / "terrain").mkdir(parents=True, exist_ok=True)
    Image.fromarray(T01.to_rg16(zw), "RGB").save(P.out / "terrain/height_scene.png", optimize=True)
    Image.fromarray(T01.hillshade(zw, web_res), "L").save(P.out / "terrain/hillshade.jpg", quality=80, optimize=True)
    g = analysis_grid(cfg)
    cg = chip_grid(cfg, g)
    from pyproj import Transformer
    inv = Transformer.from_crs(crs, 4326, always_xy=True)
    cll = inv.transform([cg.bounds[0], cg.bounds[2]], [cg.bounds[1], cg.bounds[3]])
    grid = C.Grid(crs=crs, bounds_m=bounds, bounds_lonlat=tuple(scene), res_m=round(web_res, 3), size_px=(w, h),
                  height_encoding=C.HeightEncoding(), z_min=float(np.floor(np.nanmin(zw))), z_max=float(np.ceil(np.nanmax(zw))),
                  lake_chip=C.ChipGrid(bounds_m=cg.bounds, bounds_lonlat=(round(cll[0][0], 5), round(cll[1][0], 5),
                                                                          round(cll[0][1], 5), round(cll[1][1], 5)),
                                       res_m=cg.res, size_px=(cg.w, cg.h)))
    B08.write_json(P.out / C.BUNDLE_PATHS["grid"], grid, force=True)
    meta = dict(badge="MEASURED", source=SRC["dem"], placeholder=False,
                uncertainty="±2–4 m vertical (GLO-30 spec); reservoir surfaces are flattened to the acquisition-day water level")
    reg = dict(product=cfg["bundle"]["product"], dam_id=P.id, version=cfg["bundle"]["version"])
    B08.register_layer(P.out, dict(id="terrain_height", kind="terrain", grid="scene", file="terrain/height_scene.png",
                                   label="Terrain", sensor="COPDEM", encoding=dict(type="rg16", scale=0.1, offset=-100),
                                   method=f"GLO-30 mosaic → {crs} {res:g} m → web grid {web_res:.1f} m; tiles {', '.join(tiles)}",
                                   **meta), **reg)
    B08.register_layer(P.out, dict(id="terrain_hillshade", kind="hillshade", grid="scene", file="terrain/hillshade.jpg",
                                   label="Hillshade", method="NW sun 315°/35°, ×2 exaggeration", **meta), **reg)
    log(f"terrain {w}×{h} @ {web_res:.1f} m, z {grid.z_min:.0f}…{grid.z_max:.0f} m; chip grid {cg.w}×{cg.h} @ {cg.res:g} m")
    return dict(size=(w, h), res=web_res)


# ================================================================================================ step: s1
def step_s1(P: Paths, cfg: dict, workers=6) -> pd.DataFrame:
    from concurrent.futures import ThreadPoolExecutor
    lake, read = cfg["aoi"]["lake"], cfg["aoi"]["read"]
    items = mt.pc_items("sentinel-1-rtc", lake, "/".join(cfg["period"]["s1"]))
    log(f"S1 RTC: {len(items)} items over the lake box {cfg['period']['s1']}")

    def one(it):
        cache = P.cache / "s1" / f"{it.id}.npz"
        orbit = (it.properties or {}).get("sat:relative_orbit")
        rec = dict(date=it.datetime.date().isoformat(), time_utc=it.datetime.strftime("%H:%M"), sensor="S1",
                   track=f"o{orbit}", scene=it.id, platform=(it.properties or {}).get("platform"))
        try:
            if not cache.exists():
                key = "vv" if "vv" in it.assets else next(iter(it.assets))
                for att in range(3):
                    try:
                        arr, tr, crs = mt.read_cog_window(it.assets[key].href, read)
                        break
                    except Exception:  # noqa: BLE001
                        if att == 2:
                            raise
                        time.sleep(4 * (att + 1))
                np.savez_compressed(cache, VV=arr.astype("float32"), transform=np.array(tuple(tr)[:6]), crs=str(crs))
            z = np.load(cache, allow_pickle=True)
            rec["valid_frac"] = round(float((z["VV"] > 0).mean()), 3)
            rec["status"] = "ok"
        except Exception as exc:  # noqa: BLE001
            rec.update(status="failed", error=f"{type(exc).__name__}: {str(exc)[:120]}")
        return rec

    with ThreadPoolExecutor(workers) as ex:
        rows = list(ex.map(one, items))
    df = pd.DataFrame(rows).sort_values(["date", "track", "valid_frac"], ascending=[True, True, False])
    df.to_csv(P.work / "s1_items.csv", index=False)
    ok = df[df.status == "ok"]
    log(f"S1: {len(ok)} ok / {len(df)} items, {ok.date.nunique()} dates, orbits {sorted(ok.track.unique())}; "
        f"{(df.status != 'ok').sum()} failed")
    return df


# ================================================================================================ step: nisar
def step_nisar(P: Paths, cfg: dict) -> pd.DataFrame:
    token = load_token()
    if not token:
        sys.exit("EARTHDATA_TOKEN missing (environment or .env)")
    session = mt.earthdata_session(token)
    lake, read = cfg["aoi"]["lake"], cfg["aoi"]["read"]
    prods = mt.search_products(lake, *cfg["period"]["nisar"])
    g = prods[prods["product"] == "GCOV"].copy()
    if g.empty:
        log("NISAR: no GCOV product over the lake box")
        pd.DataFrame().to_csv(P.work / "nisar_items.csv", index=False)
        return pd.DataFrame()
    g["trk"] = g["dir"].str[0] + g["track"].astype(str) + "/F" + g["frame"].astype(str)
    asc = cfg["water"].get("nisar_pick", "smallest") == "smallest"   # smallest = 20 MHz (20 m) where both exist
    g = g.sort_values(["date", "size_GB"], ascending=[True, asc]).groupby(["date", "trk"]).head(1)
    log(f"NISAR: {len(g)} GCOV products, {g['date'].nunique()} dates, tracks {sorted(g.trk.unique())} "
        f"(pick {cfg['water'].get('nisar_pick')})")
    rows = []
    for i, (_, r) in enumerate(g.sort_values("date").iterrows(), 1):
        t0 = time.time()
        cache = P.cache / "gcov" / f"{r['scene']}.npz"
        rec = dict(date=r["date"], sensor="NISAR", track=r["trk"], scene=r["scene"], bw=r["bw"], size_GB=r["size_GB"])
        src = "cache"
        for attempt in range(3):
            try:
                if not cache.exists():
                    src = "download"
                    h5, _ = mt.open_h5(r["url"], session)
                    try:
                        bands, meta = mt.read_gcov(h5, read, pols=("HHHH", "HVHV"))
                    finally:
                        h5.close()
                    meta = {k: meta[k] for k in ("epsg", "x", "y")}
                    np.savez_compressed(cache, **bands, meta=np.array(meta, dtype=object))
                z = np.load(cache, allow_pickle=True)
                meta = z["meta"].item()
                rec.update(status="ok", pixel_m=round(abs(float(np.median(np.diff(meta["x"])))), 1),
                           valid_frac=round(float(np.isfinite(z["HH"]).mean() * (z["HH"] > 0).mean()), 3), source=src)
                break
            except Exception as exc:  # noqa: BLE001
                rec.update(status="failed", error=f"{type(exc).__name__}: {str(exc)[:160]}")
                if "outside this product" in str(exc):
                    break
                log(f"  [{i}/{len(g)}] {r['date']} {r['trk']}: attempt {attempt + 1} failed ({type(exc).__name__})")
                time.sleep(5 * (attempt + 1))
        rows.append(rec)
        log(f"  [{i}/{len(g)}] {r['date']} {r['trk']:9s} {rec['status']} {src} {rec.get('pixel_m', '')} m  {time.time() - t0:.0f}s")
        pd.DataFrame(rows).to_csv(P.work / "nisar_items.csv", index=False)
    df = pd.DataFrame(rows)
    log(f"NISAR: {(df.status == 'ok').sum()} ok / {len(df)}")
    return df


# ================================================================================================ step: reservoir
def gsw_extent(cfg, grid: Grid):
    """JRC GSW max water extent on the analysis grid (None if the collection is unreachable)."""
    try:
        from rasterio.warp import Resampling, reproject
        import rasterio
        items = mt.pc_items("jrc-gsw", cfg["aoi"]["read"], None)
        dst = np.zeros((grid.h, grid.w), np.uint8)
        for it in items:
            with rasterio.open(it.assets["extent"].href) as src:
                tmp = np.zeros_like(dst)
                reproject(rasterio.band(src, 1), tmp, dst_transform=grid.transform, dst_crs=grid.crs,
                          resampling=Resampling.nearest)
                dst = np.maximum(dst, (tmp == 1).astype(np.uint8))
        return dst.astype(bool), [it.id for it in items]
    except Exception as exc:  # noqa: BLE001
        log(f"  GSW not used: {type(exc).__name__}: {str(exc)[:100]}")
        return None, []


def measurements(P: Paths) -> pd.DataFrame:
    parts = []
    if (P.work / "s1_items.csv").exists():
        s = pd.read_csv(P.work / "s1_items.csv")
        s = s[s.status == "ok"].sort_values("valid_frac", ascending=False).drop_duplicates(["date", "time_utc", "track"])
        parts.append(s)
    if (P.work / "nisar_items.csv").exists() and (P.work / "nisar_items.csv").stat().st_size > 5:
        n = pd.read_csv(P.work / "nisar_items.csv")
        parts.append(n[n.status == "ok"].assign(time_utc=""))
    return pd.concat(parts, ignore_index=True).sort_values(["date", "sensor", "track"]).reset_index(drop=True)


def layer_id(sensor, date, track):
    return f"{'nisar' if sensor == 'NISAR' else 's1'}_{date}_{track.replace('/', '')}_{'HH' if sensor == 'NISAR' else 'VV'}"


def step_reservoir(P: Paths, cfg: dict) -> pd.DataFrame:
    import geopandas as gpd
    import rasterio.features
    from scipy import ndimage as ndi
    from shapely.geometry import Point, shape
    W = cfg["water"]
    k, lo, hi = int(W["boxcar"]), *W["clamp_db"]
    grid = analysis_grid(cfg)
    epsg = int(grid.crs.split(":")[1])
    meas = measurements(P)
    log(f"analysis grid {grid.w}×{grid.h} @ {grid.res:g} m; {len(meas)} measurements "
        f"({(meas.sensor == 'NISAR').sum()} NISAR, {(meas.sensor == 'S1').sum()} S1)")
    feats = json.loads((P.work / "osm_dam.geojson").read_text("utf-8"))["features"]
    dam_pt = gpd.GeoSeries([shape(feats[0]["geometry"])], crs=4326).to_crs(epsg).iloc[0]
    osm_res = [f for f in feats if f["properties"]["role"] == "reservoir_osm"]
    osm_mask = None
    if osm_res:
        og = gpd.GeoSeries([shape(osm_res[0]["geometry"])], crs=4326).to_crs(epsg)
        osm_mask = rasterio.features.rasterize([(g, 1) for g in og], out_shape=(grid.h, grid.w),
                                               transform=grid.transform).astype(bool)

    # ---- 1) lake polygon: pre-period S1 water frequency
    p0, p1 = cfg["period"]["pre"]
    pre = meas[(meas.sensor == "S1") & (meas.date >= p0) & (meas.date <= p1)]
    freq = np.zeros((grid.h, grid.w), np.float32)
    nval = np.zeros((grid.h, grid.w), np.float32)
    for _, r in pre.iterrows():
        d = load_db(P, r, grid, k)
        t, _ = R02.otsu_thr(d[np.isfinite(d)] if osm_mask is None else
                            d[ndi.binary_dilation(osm_mask, iterations=int(W["ring_m"] / grid.res)) & np.isfinite(d)], lo, hi)
        freq += np.where(np.isfinite(d), d < t, 0)
        nval += np.isfinite(d)
    freq = np.where(nval > 0, freq / np.maximum(nval, 1), 0)
    core = R02.clean(freq >= W["freq_min"], W["min_core_px"], 2000)
    lab, n = ndi.label(core)
    if n == 0:
        raise RuntimeError("no water found in the pre-period Sentinel-1 images")
    col = (dam_pt.x - grid.bounds[0]) / grid.res
    row = (grid.bounds[3] - dam_pt.y) / grid.res
    rr, cc = np.indices(core.shape)
    keep, rule = [], ""
    if osm_mask is not None:
        near_osm = ndi.binary_dilation(osm_mask, iterations=20)
        keep = [i for i in range(1, n + 1) if (near_osm & (lab == i)).sum() >= 0.5 * (lab == i).sum()]
        rule = "components ≥ 50 % within 200 m of the OSM reservoir polygon"
    if not keep:
        dist = {i: float(np.sqrt(np.min((rr[lab == i] - row) ** 2 + (cc[lab == i] - col) ** 2))) * grid.res
                for i in range(1, n + 1)}
        keep = [min(dist, key=dist.get)]
        rule = f"component nearest the dam ({dist[keep[0]]:.0f} m)"
    lake = ndi.binary_fill_holes(np.isin(lab, keep))
    gsw, gsw_ids = gsw_extent(cfg, grid)
    gsw_note = "JRC GSW not available"
    if gsw is not None:
        gd = ndi.binary_dilation(gsw, iterations=3)
        cover = float((lake & gd).sum() / max(lake.sum(), 1))
        if cover >= 0.8:
            lake = lake & gd
            gsw_note = f"intersected with JRC GSW max extent (+30 m); GSW covered {cover:.0%} of the S1 core"
        else:
            gsw_note = f"JRC GSW max extent covers only {cover:.0%} of the S1 core (newer or changed reservoir): not applied"
    core_lake = lake.copy()     # undilated: used for the "lake darker than land" confidence test (a narrow pool's
    #                             dilated polygon is mostly shore, so its median says nothing about the water)
    lake = ndi.binary_dilation(lake, structure=R02.disk(int(W["polygon_dilate_m"] / grid.res)))
    ring = ndi.binary_dilation(lake, structure=R02.disk(int(W["ring_m"] / grid.res))) & ~lake
    zone = lake | ring
    lake_km2 = float(lake.sum() * grid.res ** 2 / 1e6)
    dam_d = float(np.sqrt(np.min((rr[lake] - row) ** 2 + (cc[lake] - col) ** 2))) * grid.res
    poly_info = dict(lake_km2=round(lake_km2, 3), n_pre=int(len(pre)), pre_period=[p0, p1], rule=rule,
                     gsw=gsw_note, gsw_items=gsw_ids, dam_to_polygon_m=round(dam_d),
                     osm_km2=cfg["dam"].get("reservoir_osm_km2"), core_km2=round(float(core_lake.sum() * grid.res ** 2 / 1e6), 3))
    log(f"lake polygon {lake_km2:.2f} km² from {len(pre)} pre-period S1 images ({rule}; {gsw_note}); "
        f"OSM {poly_info['osm_km2']} km²; dam {dam_d:.0f} m from polygon")

    # ---- 2) per-image adaptive masks
    cg = chip_grid(cfg, grid)
    cw = grid.window_of(cg)
    rows, keep_db = [], {}
    for i, r in meas.iterrows():
        d = load_db(P, r, grid, k)
        valid = np.isfinite(d) & lake
        if valid.sum() < 0.9 * lake.sum():
            continue
        t, sep = R02.otsu_thr(d[zone], lo, hi)
        water = R02.clean((d < t) & lake, max(4, W["min_core_px"] // 10), 50)
        a = water.sum() * grid.res ** 2 / 1e6
        a_lo = R02.clean((d < t - 2) & lake, max(4, W["min_core_px"] // 10), 50).sum() * grid.res ** 2 / 1e6
        a_hi = R02.clean((d < t + 2) & lake, max(4, W["min_core_px"] // 10), 50).sum() * grid.res ** 2 / 1e6
        med_lake, med_land = float(np.nanmedian(d[lake])), float(np.nanmedian(d[ring]))
        med_core = float(np.nanmedian(d[core_lake]))
        med_w = float(np.nanmedian(d[water])) if water.any() else np.nan
        c_lake = med_land - med_core
        c_water = med_land - med_w if np.isfinite(med_w) else 0.0
        conf = "low" if c_lake < 0.5 else ("medium" if c_water < 5.0 else "high")
        notes = []
        if W.get("small_pool") and conf == "high":
            conf = "medium"
            notes.append("small pool: mixed shore pixels")
        wind = r.sensor == "S1" and np.isfinite(med_w) and med_w > W["s1_wind_flag_median_db"]
        if wind:
            notes.append("wind-roughened (C-band)")
        rows.append(dict(date=r.date, time_utc=r.time_utc if isinstance(r.time_utc, str) else "", sensor=r.sensor,
                         track=r.track, scene=r.scene, thr_db=round(t, 2), sep=round(sep, 3), area_km2=round(a, 3),
                         area_lo=round(a_lo, 3), area_hi=round(a_hi, 3), lake_median_db=round(med_lake, 2),
                         core_median_db=round(med_core, 2), land_median_db=round(med_land, 2), water_median_db=round(med_w, 2) if np.isfinite(med_w) else None,
                         confidence=conf, wind_flag=bool(wind), note="; ".join(notes)))
        keep_db[(r.sensor, r.date, r.track)] = (d[cw], water[cw])
        if len(keep_db) > 60:            # keep memory bounded: chip candidates are picked below from `rows`
            keep_db.pop(next(iter(keep_db)))
        if i % 25 == 0:
            log(f"  {i}/{len(meas)} {r.date} {r.sensor} {r.track}: T={t:.1f} dB area={a:.2f} km² ({conf})")
    df = pd.DataFrame(rows).sort_values(["date", "sensor", "track"]).reset_index(drop=True)
    if df.empty:
        raise RuntimeError("no measurement covers ≥ 90 % of the lake polygon")

    # ---- 3) per-track harmonisation on the period both sensors observe
    t0 = df[df.sensor == "NISAR"].date.min() if (df.sensor == "NISAR").any() else df.date.min()
    ref = df[(df.date >= t0) & (df.confidence != "low")]
    med = ref.area_km2.median()
    fac = (med / ref.groupby(["sensor", "track"]).area_km2.median()).replace([np.inf], np.nan).fillna(1.0)
    df["harm_factor"] = [round(float(fac.get((s, t), 1.0)), 4) for s, t in zip(df.sensor, df.track)]
    df["area_norm"] = (df.area_km2 * df.harm_factor).round(3)
    df.to_csv(P.work / "series_adaptive.csv", index=False)

    # ---- 4) chips: per NISAR track first + last; S1 first pre-period, nearest first NISAR, latest; min/max area
    good = df[df.confidence != "low"]
    pick = []
    for (s, t), g in good[good.sensor == "NISAR"].groupby(["sensor", "track"]):
        pick += [g.iloc[0], g.iloc[-1]]
    s1 = good[good.sensor == "S1"]
    if len(s1):
        pick += [s1.iloc[0], s1.iloc[-1]]
        if (good.sensor == "NISAR").any():
            pick.append(s1.iloc[int(np.argmin(np.abs((pd.to_datetime(s1.date) - pd.Timestamp(t0)).dt.days.values)))])
    if len(good):
        pick += [good.loc[good.area_km2.idxmin()], good.loc[good.area_km2.idxmax()]]
    seen, chosen = set(), []
    for r in sorted(pick, key=lambda r: (r.date, r.sensor)):
        key = (r.sensor, r.date, r.track)
        if key not in seen:
            seen.add(key)
            chosen.append(key)
    chosen = chosen[: cfg["bundle"]["max_chips"]]
    chips = {}
    for key in chosen:
        if key not in keep_db:
            r = meas[(meas.sensor == key[0]) & (meas.date == key[1]) & (meas.track == key[2])].iloc[0]
            d = load_db(P, r, grid, k)
            rr_ = df[(df.sensor == key[0]) & (df.date == key[1]) & (df.track == key[2])].iloc[0]
            water = R02.clean((d < rr_.thr_db) & lake, max(4, W["min_core_px"] // 10), 50)
            keep_db[key] = (d[cw], water[cw])
        chips[key] = keep_db[key]
    f = int(round(cg.res / grid.res))

    def down(a, how):
        a = a[: cg.h * f, : cg.w * f].reshape(cg.h, f, cg.w, f)
        return np.nanmean(a, axis=(1, 3)) if how == "mean" else (a.mean(axis=(1, 3)) >= 0.5)
    chips = {kk: (down(d, "mean"), down(w.astype(np.float32), "mask")) if f > 1 else (d, w) for kk, (d, w) in chips.items()}
    np.savez_compressed(P.work / "chips.npz", **{f"{'|'.join(kk)}|db": v[0] for kk, v in chips.items()},
                        **{f"{'|'.join(kk)}|mask": v[1] for kk, v in chips.items()})

    # ---- 5) lake polygon vector (UTM, like V1 lake_max.geojson)
    import rasterio.features as rf
    from shapely.geometry import mapping
    from shapely.ops import unary_union
    geom = unary_union([shape(g) for g, v in rf.shapes(lake.astype(np.uint8), mask=lake, transform=grid.transform) if v]).simplify(5.0)
    gm = mapping(geom)

    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0]), round(c[1])]
    gm["coordinates"] = rnd(gm["coordinates"])
    lake_gj = {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{epsg}"}},
               "features": [{"type": "Feature", "properties": {
                   "name": f"{cfg['dam']['name']} — reservoir extent ({p0} → {p1})", "area_km2": round(geom.area / 1e6, 3),
                   "method": f"water in ≥ {W['freq_min']:.0%} of {len(pre)} Sentinel-1 RTC images {p0} → {p1} "
                             f"(adaptive Otsu), {rule}, holes filled; {gsw_note}; dilated {W['polygon_dilate_m']} m"},
                   "geometry": gm}]}
    (P.work / "lake_max.geojson").write_text(json.dumps(lake_gj), "utf-8")
    (P.work / "polygon.json").write_text(json.dumps(poly_info, indent=1), "utf-8")
    qa_sheets(P, cfg, df, freq, lake, osm_mask, chips, poly_info)
    log(df.groupby(["sensor", "track"]).agg(n=("area_km2", "size"), med=("area_km2", "median"),
                                            low=("confidence", lambda c: int((c == "low").sum()))).to_string())
    return df


def qa_sheets(P: Paths, cfg, df, freq, lake, osm_mask, chips, poly):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    n = len(chips) + 1
    cols = 3
    rows_ = (n + cols - 1) // cols
    fig, axs = plt.subplots(rows_, cols, figsize=(15, 4.6 * rows_), dpi=85)
    axs = np.atleast_1d(axs).ravel()
    axs[0].imshow(freq, cmap="Blues", vmin=0, vmax=1)
    axs[0].contour(lake, levels=[.5], colors="#ff4fd2", linewidths=1)
    if osm_mask is not None:
        axs[0].contour(osm_mask, levels=[.5], colors="#f5a300", linewidths=.8, linestyles="--")
    axs[0].set_title(f"pre-period S1 water frequency · polygon {poly['lake_km2']} km² (magenta) · OSM {poly['osm_km2']} km² (orange)",
                     fontsize=8)
    for ax, (key, (d, w)) in zip(axs[1:], sorted(chips.items(), key=lambda x: x[0][1])):
        res = float(cfg["crs"]["lake_res_m"]) * (lake.shape[0] and 1)
        ext = None
        ax.imshow(d, cmap="gray", vmin=-25, vmax=0, extent=ext)
        if w.any():
            ax.contour(w.astype(float), levels=[.5], colors="#5ff3ff", linewidths=.7)
        r = df[(df.sensor == key[0]) & (df.date == key[1]) & (df.track == key[2])].iloc[0]
        ax.set_title(f"{key[0]} {key[2]} {key[1]} · {r.area_km2:.2f} km² ({r.confidence}) · T={r.thr_db} dB", fontsize=8)
    for ax in axs:
        ax.set_xticks([]), ax.set_yticks([])
    fig.suptitle(f"{cfg['dam']['name']} — QA contact sheet (pixels; cyan = water mask inside the lake polygon)", fontsize=10)
    fig.tight_layout()
    fig.savefig(P.work / "qa_contact_sheet.png")
    plt.close(fig)
    fig, ax = plt.subplots(3, 1, figsize=(12, 9), dpi=90, sharex=True)
    for (s, t), g in df.groupby(["sensor", "track"]):
        x = pd.to_datetime(g.date)
        st = "o--" if s == "S1" else "o-"
        ax[0].plot(x, g.area_km2, st, ms=3, lw=.8, label=f"{s} {t}")
        ax[1].plot(x, g.area_norm, st, ms=3, lw=.8)
        lowc = g.confidence == "low"
        ax[1].plot(x[lowc], g.area_norm[lowc], "x", color="red", ms=6)
        ax[2].plot(x, g.lake_median_db, st, ms=3, lw=.8)
    ax[0].axhline(poly["lake_km2"], color="#ff4fd2", lw=.8, ls=":")
    if poly.get("osm_km2"):
        ax[0].axhline(poly["osm_km2"], color="#f5a300", lw=.8, ls=":")
    ax[0].set_ylabel("water km² (raw)")
    ax[1].set_ylabel("harmonised km² (x = low conf.)")
    ax[2].set_ylabel("median dB in polygon")
    ax[0].legend(fontsize=7, ncol=5)
    ax[0].set_title(f"{cfg['dam']['name']} — water area series (magenta: polygon, orange: OSM)", fontsize=10)
    fig.tight_layout()
    fig.savefig(P.work / "qa_series.png")
    plt.close(fig)


# ================================================================================================ step: anomaly
def step_anomaly(P: Paths, cfg: dict) -> dict:
    A03 = load_mod(PIPE / "03_anomaly.py", "anom03")
    r = cfg["anomaly"]
    df = pd.read_csv(P.work / "series_adaptive.csv")
    df = df[df.confidence != "low"].copy()
    df["date"] = pd.to_datetime(df.date)
    dep = A03.departure_rule(df, r)
    dsig = A03.mad_sigma(dep.dep)
    dep["z"] = dep.dep / dsig if dsig and np.isfinite(dsig) else np.nan
    dep.to_csv(P.work / "departure.csv", index=False)
    flags = dep[dep.level != "NORMAL"]
    summary = dict(n_eval=int(np.isfinite(dep.dep).sum()), sigma_departure=round(float(dsig), 4) if np.isfinite(dsig) else None,
                   alerts=int((dep.level == "ALERT").sum()), warnings=int((dep.level == "WARNING").sum()),
                   flags=[dict(date=str(x.date.date()), sensor=x.sensor, track=x.track, dep=round(float(x.dep), 3),
                               level=x.level, confirmed_by=x.confirmed_by) for x in flags.itertuples()])
    (P.work / "anomaly.json").write_text(json.dumps(summary, indent=1), "utf-8")
    log(f"anomaly: {summary['n_eval']} evaluations, {summary['alerts']} ALERT, {summary['warnings']} WARNING, σ {dsig:.3f}")
    return summary


# ================================================================================================ step: swot
def step_swot(P: Paths, cfg: dict) -> dict:
    import geopandas as gpd
    import requests
    from shapely.geometry import Point
    H07 = load_mod(PIPE / "07_level_volume.py", "lev07")
    out = dict(available=False)
    lp = gpd.read_file(P.work / "lake_max.geojson")
    lake_ll = lp.to_crs(4326).geometry.union_all()
    tok = load_token()
    if not tok:
        out["reason"] = "EARTHDATA_TOKEN not set: cannot read a LakeSP_Prior granule to find the PLD lake ID"
        return save_swot(P, out)
    cache = ROOT / "cache" / "v2" / "swot"
    cache.mkdir(parents=True, exist_ok=True)
    lon0, lat0, lon1, lat1 = cfg["aoi"]["lake"]
    zips = sorted(set(list(cache.glob("SWOT_L2_HR_LakeSP_Prior_*.zip")) +
                      list((main_repo() / "cache/swot").glob("SWOT_L2_HR_LakeSP_Prior_*.zip"))))
    js = requests.get(H07.CMR, params=dict(collection_concept_id=H07.LAKESP_PRIOR, bounding_box=f"{lon0},{lat0},{lon1},{lat1}",
                                           temporal="2025-06-01T00:00:00Z,2026-11-15T00:00:00Z", page_size=60),
                      timeout=120).json()
    links = [l["href"] for e in js["feed"]["entry"] for l in e.get("links", [])
             if l["href"].startswith("https") and l["href"].endswith(".zip")]
    out["n_granules_cmr"] = len(links)
    tried = 0
    cands = []
    for url in links:
        p = cache / url.rsplit("/", 1)[1]
        if p not in zips:
            if tried >= 6:
                continue
            tried += 1
            r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=300)
            if r.status_code != 200:
                continue
            p.write_bytes(r.content)
            zips.append(p)
    for p in zips:
        try:
            g = gpd.read_file(f"zip://{p}")
        except Exception:  # noqa: BLE001
            continue
        g = g[(g.p_lon.between(lon0 - .05, lon1 + .05)) & (g.p_lat.between(lat0 - .05, lat1 + .05))]
        for _, r in g.iterrows():
            d = lake_ll.distance(Point(r.p_lon, r.p_lat))
            if d < 0.01:
                cands.append(dict(lake_id=str(r.lake_id), lake_name=str(r.lake_name), p_lon=float(r.p_lon), p_lat=float(r.p_lat),
                                  p_ref_area_km2=float(r.p_ref_area), p_ref_wse=float(r.p_ref_wse), dist_deg=round(float(d), 5),
                                  granule=p.name))
    if not cands:
        out["reason"] = (f"no Prior Lake Database lake within ≈1 km of the radar lake polygon in {len(zips)} LakeSP_Prior "
                         f"granules ({len(links)} over the lake box in CMR)")
        return save_swot(P, out)
    c = pd.DataFrame(cands).drop_duplicates("lake_id")
    best = c.loc[c.p_ref_area_km2.idxmax()].to_dict()
    out.update(pld=best, n_candidates=int(len(c)), candidates=c[["lake_id", "lake_name", "p_ref_area_km2"]].to_dict("records"))
    H07.CACHE = cache
    allp, retrieved = H07.hydrocron(best["lake_id"], refresh=False)
    allp.to_csv(P.work / "swot_all.csv", index=False)
    # V1 rule: quality ≤ 1, partial_f = 0, ice_clim_f = 0. Generalised: ice_clim_f fill (-999 = no ice climatology,
    # warm lakes) counts as no ice; partial passes (lake at the swath edge) are kept ONLY when no full pass exists,
    # with area_total dropped (partial area is meaningless; WSE of the observed part is valid). Single-pass WSE
    # outliers (> 5 robust σ, σ ≥ 0.1 m, from the median) are excluded and reported.
    noice = allp.ice_clim_f.isin([0, -999])
    full = allp[(allp.quality_f <= 1) & (allp.partial_f == 0) & noice]
    part = allp[(allp.quality_f <= 1) & (allp.partial_f == 1) & noice]
    use_partial = full.empty and not part.empty
    good = (part if use_partial else full).copy()
    if use_partial:
        good["area_total"] = -2e12
    med_w = good.wse.median() if len(good) else np.nan
    rs = max(0.1, 1.4826 * float((good.wse - med_w).abs().median())) if len(good) else np.nan
    outl = good[(good.wse - med_w).abs() > 5 * rs] if len(good) else good
    good = good.drop(outl.index).reset_index(drop=True)
    out.update(partial_only=bool(use_partial), n_partial=int(len(part)), n_full=int(len(full)),
               outliers=[dict(time=r.time_str, wse_m=float(r.wse)) for r in outl.itertuples()], robust_sigma_m=round(rs, 3) if len(part) + len(full) else None)
    q0 = good[good.quality_f == 0]
    out.update(available=len(good) > 0, n_all=int(len(allp)), n_good=int(len(good)), n_q0=int(len(q0)), retrieved_utc=retrieved,
               points=[dict(time=r.time_str, wse_m=round(float(r.wse), 3), wse_u=round(float(r.wse_u), 3),
                            area_km2=round(float(r.area_total), 3) if r.area_total > -1e9 else None, quality=int(r.quality_f))
                       for r in good.itertuples()])
    if len(good):
        out.update(wse_min=round(float(good.wse.min()), 2), wse_max=round(float(good.wse.max()), 2),
                   first=good.time_str.iloc[0][:10], last=good.time_str.iloc[-1][:10])
    else:
        out["reason"] = f"PLD lake {best['lake_id']} found but no pass with quality ≤ 1 and no ice ({len(allp)} passes)"
    if use_partial and len(good):
        out["note"] = (f"all {len(part)} usable passes are partial observations (partial_f = 1): WSE from the observed part "
                       f"of the lake, area_total omitted")
    if len(outl):
        out["note"] = (out.get("note", "") + f"; {len(outl)} single-pass outlier(s) > 5 robust σ removed: "
                       + ", ".join(f"{o['time'][:10]} {o['wse_m']:.2f} m" for o in out["outliers"])).lstrip("; ")
    log(f"SWOT: PLD {best['lake_id']} '{best['lake_name']}' ({best['p_ref_area_km2']} km²): {len(good)} good passes "
        f"(q0 {len(q0)}), wse {out.get('wse_min')}–{out.get('wse_max')} m")
    return save_swot(P, out)


def save_swot(P: Paths, out: dict) -> dict:
    (P.work / "swot.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), "utf-8")
    if not out.get("available"):
        log(f"SWOT: not available — {out.get('reason')}")
    return out


# ================================================================================================ step: bundle
def step_bundle(P: Paths, cfg: dict) -> int:
    from PIL import Image
    reg = dict(product=cfg["bundle"]["product"], dam_id=P.id, version=cfg["bundle"]["version"])
    name = cfg["dam"]["name"]
    df = pd.read_csv(P.work / "series_adaptive.csv")
    poly = json.loads((P.work / "polygon.json").read_text("utf-8"))
    an = json.loads((P.work / "anomaly.json").read_text("utf-8"))
    sw = json.loads((P.work / "swot.json").read_text("utf-8")) if (P.work / "swot.json").exists() else \
        dict(available=False, reason="SWOT step not run")
    catch = json.loads((P.work / "catchment.json").read_text("utf-8")) if (P.work / "catchment.json").exists() else {}
    W = cfg["water"]
    # stale radar / layers from earlier runs
    m = B08.load_manifest(P.out)
    if m:
        mine = {"lake_max", "dam", "catchment", "river_down"}   # only this script's layers: other agents' stay
        m["layers"] = [l for l in m["layers"] if l["kind"] != "radar" and l["id"] not in mine]
        B08.write_json(P.out / "manifest.json", C.Manifest.model_validate(m), force=True)
    for d in ("radar", "vectors"):
        (P.out / d).mkdir(parents=True, exist_ok=True)
    for f in (P.out / "radar").glob("*.png"):
        f.unlink()
    for fn in ("lake_max.geojson", "dam.geojson", "catchment.geojson", "flowpath.geojson"):
        (P.out / "vectors" / fn).unlink(missing_ok=True)
    # ---- vectors
    import shutil
    shutil.copy(P.work / "lake_max.geojson", P.out / "vectors/lake_max.geojson")
    B08.register_layer(P.out, dict(id="lake_max", kind="vector", grid="none", file="vectors/lake_max.geojson",
                                   label="Reservoir extent (pre-period radar water frequency)", badge="MEASURED", source=SRC["s1"],
                                   method=f"water in ≥ {W['freq_min']:.0%} of {poly['n_pre']} S1 images {poly['pre_period'][0]} → "
                                          f"{poly['pre_period'][1]}; {poly['rule']}; {poly['gsw']}; dilated {W['polygon_dilate_m']} m",
                                   uncertainty=f"OSM polygon {poly['osm_km2']} km² vs radar {poly['lake_km2']} km²",
                                   placeholder=False), **reg)
    shutil.copy(P.work / "osm_dam.geojson", P.out / "vectors/dam.geojson")
    B08.register_layer(P.out, dict(id="dam", kind="vector", grid="none", file="vectors/dam.geojson", sensor="OSM",
                                   label="Dam point, crest line and OSM reservoir polygon", badge="REPORTED",
                                   source=f"{SRC['osm']}; dam point/crest: {cfg['dam'].get('crest_source') or 'point only'}",
                                   method="as mapped", placeholder=False), **reg)
    for fn, lid, lab in (("catchment.geojson", "catchment", "Upstream catchment"), ("flowpath.geojson", "river_down", "Downstream river path")):
        if (P.work / fn).exists():
            shutil.copy(P.work / fn, P.out / f"vectors/{fn}")
            B08.register_layer(P.out, dict(id=lid, kind="vector", grid="none", file=f"vectors/{fn}", label=lab, badge="MODELLED",
                                           source=SRC["hydro"], method="snap to main-stem reach within 3 km; lev-12 upstream union / NEXT_DOWN walk",
                                           uncertainty="500 m-scale hydrography; not a 30 m D8 path", placeholder=False), **reg)
    # ---- radar chips (8-bit dB −25…0) + masks, under the size budget
    z = np.load(P.work / "chips.npz")
    keys = sorted({tuple(k.split("|")[:3]) for k in z.files}, key=lambda k: k[1])
    budget = cfg["bundle"]["max_mb"] * 1e6 * 0.92
    gj = json.loads((P.out / C.BUNDLE_PATHS["grid"]).read_text("utf-8"))
    chip_layers = {}
    for key in keys:
        size_now = sum(f.stat().st_size for f in P.out.rglob("*") if f.is_file())
        if size_now > budget:
            log(f"  chip budget reached: {key} and later chips skipped")
            break
        d, w = z["|".join(key) + "|db"], z["|".join(key) + "|mask"]
        sensor, date, track = key
        lid = layer_id(sensor, date, track)
        enc = np.nan_to_num(np.clip((d + 25) / 25 * 255, 0, 255), nan=0).astype(np.uint8)
        Image.fromarray(enc, "L").save(P.out / f"radar/{lid}.png", optimize=True)
        Image.fromarray((w.astype(bool) * 255).astype(np.uint8), "L").save(P.out / f"radar/{lid}_mask.png", optimize=True)
        r = df[(df.sensor == sensor) & (df.date == date) & (df.track == track)].iloc[0]
        B08.register_layer(P.out, dict(
            id=lid, kind="radar", grid="lake_chip", file=f"radar/{lid}.png", mask=f"radar/{lid}_mask.png",
            label=f"{'NISAR L-band HH' if sensor == 'NISAR' else 'Sentinel-1 C-band VV'} · {date}", date=date,
            time_utc=r.time_utc if isinstance(r.time_utc, str) and r.time_utc else None, sensor=sensor,
            band="L" if sensor == "NISAR" else "C", pol="HH" if sensor == "NISAR" else "VV", track=track, product_id=r.scene,
            encoding=dict(type="db8", min=-25, max=0), badge="MEASURED", source=SRC["nisar" if sensor == "NISAR" else "s1"],
            method=f"γ0 boxcar {W['boxcar']}×{W['boxcar']}, 10 m analysis grid, shown at {gj['lake_chip']['res_m']:g} m; "
                   f"water = dB < {r.thr_db} dB (adaptive Otsu) inside the lake polygon",
            uncertainty=f"area {r.area_lo}–{r.area_hi} km² for threshold ±2 dB; confidence {r.confidence}", placeholder=False), **reg)
        chip_layers[key] = lid
    # ---- reservoir_area.json
    dts = pd.to_datetime(df.date).sort_values().drop_duplicates()
    gaps = [(a.date().isoformat(), b.date().isoformat()) for a, b in zip(dts.iloc[:-1], dts.iloc[1:]) if (b - a).days > 14]
    gq = df[df.confidence != "low"]
    iso = gq[gq.area_norm < 0.7 * gq.area_norm.median()]
    iso_keys = {(r.sensor, r.date, r.track) for r in iso.itertuples()} if len(iso) <= 3 else set()
    pts = [C.AreaPoint(date=r.date, time_utc=r.time_utc if isinstance(r.time_utc, str) and r.time_utc else None, sensor=r.sensor,
                       track=r.track, area_km2=r.area_km2, area_norm_km2=r.area_norm, sigma_km2=round((r.area_hi - r.area_lo) / 4, 3),
                       confidence=r.confidence, layer=chip_layers.get((r.sensor, r.date, r.track)),
                       note="; ".join(x for x in (r.note if isinstance(r.note, str) else "",
                                                  "isolated drop not repeated by any other pass (likely wind, C-band): outlier"
                                                  if (r.sensor, r.date, r.track) in iso_keys else "", f"T={r.thr_db} dB") if x))
           for r in df.itertuples()]
    small = " Small pool: area includes the river channel inside the polygon; 10 m pixels are mixed at the shore." if W.get("small_pool") else ""
    clamp = float((df.thr_db >= W["clamp_db"][1] - 0.01).mean())
    if clamp > 0.3:
        small += f" Threshold at the {W['clamp_db'][1]} dB clamp in {clamp:.0%} of images."
    B08.write_json(P.out / C.BUNDLE_PATHS["reservoir_area"], C.ReservoirArea(
        badge="MEASURED", source=f"{SRC['nisar']}; {SRC['s1']}",
        method=(f"per-image Otsu threshold in lake polygon + {W['ring_m']} m ring (clamped {W['clamp_db'][0]}…{W['clamp_db'][1]} dB), "
                f"boxcar {W['boxcar']}×{W['boxcar']}, area counted inside the pre-period lake polygon; per-track harmonisation on "
                f"medians from the first NISAR date (method of the Mellègue pilot, unchanged)"),
        uncertainty="σ from threshold ±2 dB; tracks differ by incidence angle and band (use area_norm to compare); "
                    "low = undilated pre-period water core not ≥ 0.5 dB darker than the 300 m land ring (wind / wet surfaces)." + small,
        dam_id=P.id, reservoir=name, polygon="vectors/lake_max.geojson", threshold_db=-18.0,
        points=pts, events=[], gaps=gaps), force=True)
    # ---- alerts.json
    dep = pd.read_csv(P.work / "departure.csv", parse_dates=["date", "base_from"])
    r = cfg["anomaly"]
    evals = []
    for e in dep.itertuples():
        if not np.isfinite(e.dep):
            continue
        sn = "NISAR" if e.sensor == "NISAR" else "Sentinel-1"
        conf = e.confirmed_by if isinstance(e.confirmed_by, str) else ""
        every = f"{e.date.date()} ({sn}): lake area {e.dep * 100:+.0f}% compared with the previous {r['baseline_days']} days."
        if e.level != "NORMAL":
            every += f" Confirmed by another pass ({conf}). {e.level}: needs an operator check (monitoring, not a validated detection)."
        experts = (f"{e.sensor} {e.track}: harmonised {e.area_norm:.3f} km² vs median of {e.base_n} obs since {e.base_from.date()} "
                   f"→ {e.dep * 100:+.1f}% (z {e.z:.1f}). WARNING < {r['dep_warn'] * 100:.0f}%, ALERT < {r['dep_alert'] * 100:.0f}%, "
                   f"confirmed within {r['confirm_days']} d. Thresholds tuned on one event (Mellègue 2026): out-of-sample here."
                   + (f" Confirmed by: {conf}." if conf else ""))
        evals.append(C.Evaluation(date=str(e.date.date()), prev=str(e.base_from.date()), days=float(r["baseline_days"]),
                                  delta=round(float(e.dep), 4), expected=0.0, z=round(float(e.z), 2) if np.isfinite(e.z) else 0.0,
                                  level=e.level, cross_sensor=bool(conf and (("S1" in conf) != (e.sensor == "S1"))),
                                  text=C.Text(everyone=every, experts=experts)))
    B08.write_json(P.out / C.BUNDLE_PATHS["alerts"], C.Alerts(
        badge="MODELLED", source="Rule-based detector on MEASURED NISAR + Sentinel-1 water areas (this project)",
        method=f"harmonised area vs {r['baseline_days']}-day multi-sensor baseline; WARNING < {r['dep_warn'] * 100:.0f}%, "
               f"ALERT < {r['dep_alert'] * 100:.0f}%, each confirmed by an independent pass within {r['confirm_days']} days "
               f"(03_anomaly.departure_rule, unchanged)",
        uncertainty=(f"σ of departures {an['sigma_departure'] * 100:.1f}% over the whole series. No reference event is known "
                     "for this dam: flags are monitoring prompts for an operator, not validated detections. rule.sigma_per_sqrt_day "
                     "carries the departure σ (not per √day)."),
        dam_id=P.id, rule=C.Rule(z_alert=r["z_alert"], drop_alert=r["dep_alert"], z_warn=r["z_warn"], drop_warn=r["dep_warn"],
                                 seasonal_rate_per_day=0.0, sigma_per_sqrt_day=an["sigma_departure"] or 0.0),
        evaluations=evals), force=True)
    # ---- level_volume.json
    swot = C.Swot(available=bool(sw.get("available")), lake_id=(sw.get("pld") or {}).get("lake_id"),
                  reason=sw.get("reason", "") if not sw.get("available") else
                  f"PLD '{sw['pld']['lake_name']}' ({sw['pld']['p_ref_area_km2']} km² reference area)"
                  + (f"; {sw['note']}" if sw.get("note") else ""),
                  points=[C.SwotPoint(**p) for p in sw.get("points", [])], badge="MEASURED", source=SRC["swot"],
                  method=("Hydrocron PriorLake time series; kept quality_f ≤ 1, ice_clim_f 0 or fill, partial_f = 0 "
                          "(partial passes only when no full pass exists, area dropped); > 5 robust σ WSE outliers removed"),
                  uncertainty="wse_u per pass; SWOT area_total is the PLD-polygon water area, not the radar area")
    B08.write_json(P.out / C.BUNDLE_PATHS["level_volume"], C.LevelVolume(
        badge="MEASURED" if swot.available else "ILLUSTRATIVE", source=SRC["swot"],
        method="SWOT level only (no DEM-shoreline levels or ΔV computed for V2 dams yet)",
        uncertainty="", placeholder=not swot.available, dam_id=P.id, swot=swot, dem_shoreline=[], delta_volume=[],
        reported=[]), force=True)
    # ---- validation.json (numbers copied from work/v2/<id>/*.json)
    good = df[df.confidence != "low"]
    sens = ((good.area_hi - good.area_lo) / 2 / good.area_km2.replace(0, np.nan)).median()
    ratio = poly["lake_km2"] / poly["osm_km2"] if poly.get("osm_km2") else None
    lowf = float((df.confidence == "low").mean())
    nis, s1 = good[good.sensor == "NISAR"], good[good.sensor == "S1"]
    t0 = nis.date.min() if len(nis) else None
    agree = float(nis.area_km2.median() / s1[s1.date >= t0].area_km2.median()) if len(nis) and len(s1[s1.date >= t0]) else None
    src_rel = f"work/v2/{P.id}/"
    tests = [
        C.ValidationTest(id="A0", name="Radar lake polygon vs OSM reservoir polygon", group="Water area",
                         values=dict(radar_km2=poly["lake_km2"], osm_km2=poly.get("osm_km2"), ratio=round(ratio, 2) if ratio else None),
                         criterion="0.5 ≤ ratio ≤ 2 (polygon includes a 100 m dilation)",
                         passed=None if ratio is None else bool(0.5 <= ratio <= 2),
                         status="caveat" if ratio is None else ("pass" if 0.5 <= ratio <= 2 else "fail"),
                         summary=poly["rule"] + "; " + poly["gsw"], source_file=src_rel + "polygon.json", badge="MEASURED"),
        C.ValidationTest(id="A1", name="Threshold sensitivity (±2 dB)", group="Water area",
                         values=dict(median_half_spread=round(float(sens), 3) if np.isfinite(sens) else None),
                         criterion="median half-spread ≤ 25 % of the area", passed=bool(np.isfinite(sens) and sens <= 0.25),
                         status="pass" if np.isfinite(sens) and sens <= 0.25 else "caveat",
                         summary="band shown as sigma_km2 = (hi − lo)/4", source_file=src_rel + "series_adaptive.csv", badge="MEASURED"),
        C.ValidationTest(id="A2", name="Low-confidence fraction", group="Water area",
                         values=dict(n=int(len(df)), low=int((df.confidence == "low").sum()), fraction=round(lowf, 3)),
                         criterion="≤ 20 % of images low confidence", passed=lowf <= 0.2, status="pass" if lowf <= 0.2 else "caveat",
                         summary="low = undilated water core not ≥ 0.5 dB darker than the 300 m land ring", source_file=src_rel + "series_adaptive.csv",
                         badge="MEASURED"),
        C.ValidationTest(id="A3", name="NISAR vs Sentinel-1 raw area (same period, cross-sensor)", group="Water area",
                         values=dict(nisar_median_km2=round(float(nis.area_km2.median()), 3) if len(nis) else None,
                                     s1_median_km2=round(float(s1[s1.date >= t0].area_km2.median()), 3) if agree else None,
                                     ratio=round(agree, 3) if agree else None),
                         criterion="0.8 ≤ ratio ≤ 1.25 (L vs C band; harmonisation removes the offset)",
                         passed=None if agree is None else bool(0.8 <= agree <= 1.25),
                         status="caveat" if agree is None or not (0.8 <= agree <= 1.25) else "pass",
                         summary="cross-sensor comparison, label as such", source_file=src_rel + "series_adaptive.csv", badge="MEASURED"),
        C.ValidationTest(id="B2", name="Detector flags (no reference event: monitoring only)", group="Anomaly",
                         values=dict(evaluations=an["n_eval"], alerts=an["alerts"], warnings=an["warnings"],
                                     sigma_departure=an["sigma_departure"]),
                         criterion="not evaluable without an operator log", passed=None, status="caveat",
                         summary="out-of-sample run of the Mellègue rule", source_file=src_rel + "anomaly.json", badge="MODELLED"),
        C.ValidationTest(id="L0", name="SWOT LakeSP level available", group="Level",
                         values=dict(available=bool(sw.get("available")), n_good=sw.get("n_good"), wse_min=sw.get("wse_min"),
                                     wse_max=sw.get("wse_max"), lake_id=(sw.get("pld") or {}).get("lake_id")),
                         criterion="PLD lake found and ≥ 1 pass with quality ≤ 1", passed=bool(sw.get("available")),
                         status="pass" if sw.get("available") else "caveat", summary=sw.get("reason", ""),
                         source_file=src_rel + "swot.json", badge="MEASURED"),
    ]
    B08.write_json(P.out / C.BUNDLE_PATHS["validation"], C.Validation(
        dam_id=P.id, generated_utc=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), tests=tests), force=True)
    # ---- sources, events, placeholders for the flood files (hydro-modeler owns them; never overwrite real data)
    srcs = [C.Source(id="nisar", title="NISAR L2 GCOV (NASA/JPL–ISRO), ASF DAAC", url="https://search.asf.alaska.edu/", kind="data"),
            C.Source(id="s1", title="Sentinel-1 RTC, Microsoft Planetary Computer", url="https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc", kind="data"),
            C.Source(id="copdem", title="Copernicus DEM GLO-30", url="https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30", kind="data"),
            C.Source(id="osm", title="OpenStreetMap (ODbL)", url="https://www.openstreetmap.org/copyright", kind="data"),
            C.Source(id="hydrosheds", title="HydroSHEDS HydroBASINS / HydroRIVERS", url="https://www.hydrosheds.org/", kind="data"),
            C.Source(id="swot", title="SWOT Hydrocron (PO.DAAC)", url="https://podaac.github.io/hydrocron/", kind="data"),
            C.Source(id="gsw", title="JRC Global Surface Water", url="https://global-surface-water.appspot.com/", kind="data")]
    if cfg["dam"].get("name_source", "").startswith("http"):
        srcs.append(C.Source(id="name", title=f"Dam identification: {name}", url=cfg["dam"]["name_source"], kind="official"))
    B08.write_json(P.out / C.BUNDLE_PATHS["sources"], C.Sources(sources=srcs), force=True)
    B08.write_json(P.out / C.BUNDLE_PATHS["events"], C.Events(events=[]), force=True)
    PH = dict(badge="ILLUSTRATIVE", source="Placeholder: no flood model run for this dam (V2)", placeholder=True)
    B08.write_json(P.out / C.BUNDLE_PATHS["hand_lut"], C.HandLut(**PH, dam_id=P.id, corridor="", reach="", hand_file="",
                                                                 hand_encoding=C.Encoding(type="r16"), rows=[]))
    B08.write_json(P.out / C.BUNDLE_PATHS["impacts"], C.Impacts(**PH, dam_id=P.id, scenarios={}))
    if not (P.out / C.BUNDLE_PATHS["anuga_index"]).exists():
        B08.write_json(P.out / C.BUNDLE_PATHS["anuga_index"], C.AnugaIndex(dam_id=P.id, scenarios=[]))
    n_err = B08.validate(P.out)
    size = sum(f.stat().st_size for f in P.out.rglob("*") if f.is_file())
    log(f"bundle {P.out.relative_to(ROOT)}: {size / 1e6:.2f} MB, {len(chip_layers)} chips, {n_err} error(s)")
    return n_err


# ================================================================================================ step: report
def step_report(P: Paths, cfg: dict, runtime: dict) -> None:
    df = pd.read_csv(P.work / "series_adaptive.csv")
    poly = json.loads((P.work / "polygon.json").read_text("utf-8"))
    an = json.loads((P.work / "anomaly.json").read_text("utf-8"))
    sw = json.loads((P.work / "swot.json").read_text("utf-8")) if (P.work / "swot.json").exists() else {}
    ca = json.loads((P.work / "catchment.json").read_text("utf-8")) if (P.work / "catchment.json").exists() else {}
    ni = pd.read_csv(P.work / "nisar_items.csv") if (P.work / "nisar_items.csv").exists() and (P.work / "nisar_items.csv").stat().st_size > 5 else pd.DataFrame()
    si = pd.read_csv(P.work / "s1_items.csv") if (P.work / "s1_items.csv").exists() else pd.DataFrame()
    g = df.groupby(["sensor", "track"]).agg(n=("area_km2", "size"), first=("date", "min"), last=("date", "max"),
                                           area_min=("area_km2", "min"), area_med=("area_km2", "median"),
                                           area_max=("area_km2", "max"), harm=("harm_factor", "first"),
                                           low=("confidence", lambda c: int((c == "low").sum()))).reset_index()
    good = df[df.confidence != "low"]
    last = good.sort_values("date").iloc[-1] if len(good) else None
    size = sum(f.stat().st_size for f in P.out.rglob("*") if f.is_file()) / 1e6
    L = [f"# {cfg['dam']['name']} (`{P.id}`) — V2 reservoir run", "",
         f"Generated {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC by `pipeline/v2/run_dam.py`; "
         f"config `config/dams/{P.id}.yaml`; bundle `apps/web/public/data/v2/{P.id}/` ({size:.2f} MB).", "",
         "## Dam", "",
         f"- Point {cfg['dam']['lonlat']} ({cfg['crs']['analysis']}); crest: {cfg['dam'].get('crest_source')}; "
         f"name source: {cfg['dam'].get('name_source') or 'OSM / user'}",
         (f"- OSM reservoir: {cfg['dam'].get('reservoir_source')} = {cfg['dam'].get('reservoir_osm_km2')} km² {cfg['dam'].get('reservoir_note', '')}"
          if cfg["dam"].get("reservoir_source") else "- OSM reservoir: no OSM water polygon within 300–500 m of the dam; lake box = 1.5 km around the dam"),
         f"- Catchment: {ca.get('area_km2', 'n/a')} km² ({ca.get('n_basins', '')} lev-12 basins, snap {ca.get('snap_m', '')} m, "
         f"{ca.get('snap_rule', ca.get('reason', ''))}); downstream path {ca.get('downstream_km', 'n/a')} km → {ca.get('downstream_to', '')}", "",
         "## Inputs", "",
         f"- NISAR GCOV: {(ni.status == 'ok').sum() if len(ni) else 0} read / {len(ni)} selected "
         f"({ni.date.nunique() if len(ni) else 0} dates, tracks {', '.join(sorted(ni.track.unique())) if len(ni) else '—'}); "
         f"failures: {'; '.join((ni[ni.status != 'ok'].date + ' ' + ni[ni.status != 'ok'].track).tolist()) or 'none' if len(ni) else '—'}; "
         f"{(df.sensor == 'NISAR').sum()} kept (≥ 90 % of the polygon covered); median coverage of the read box per track: "
         f"{', '.join(f'{t} {v:.0%}' for t, v in ni[ni.status == 'ok'].groupby('track').valid_frac.median().items()) if len(ni) else '—'}",
         f"- Sentinel-1 RTC: {(si.status == 'ok').sum() if len(si) else 0} items read / {len(si)}; "
         f"{(df.sensor == 'S1').sum()} measurements kept (one per pass; scenes covering < 90 % of the polygon dropped; "
         f"S1 orbits seen: {', '.join(f'{t} (median coverage of the read box {v:.0%})' for t, v in si[si.status == 'ok'].groupby('track').valid_frac.median().items()) if len(si) else '—'})",
         "- Step run times (latest run of each step, provenance.json): " + ", ".join(
             f"{k} {v['seconds']:.0f} s" for k, v in (json.loads((P.work / 'provenance.json').read_text('utf-8'))
                                                   if (P.work / 'provenance.json').exists() else {}).items()
             if isinstance(v, dict) and 'seconds' in v), "",
         "## Lake polygon", "", f"- {poly['lake_km2']} km² from {poly['n_pre']} S1 images {poly['pre_period']}; {poly['rule']}; "
         f"{poly['gsw']}; dam {poly['dam_to_polygon_m']} m from the polygon", "",
         "## Area series (raw km², per sensor/track)", "", g.round(3).to_markdown(index=False), "",
         f"- Low confidence: {(df.confidence == 'low').sum()} of {len(df)}; medium {(df.confidence == 'medium').sum()}; "
         f"wind-flagged S1 {int(df.wind_flag.sum())}",
         f"- Harmonised (non-low) area: min {good.area_norm.min():.3f}, median {good.area_norm.median():.3f}, "
         f"max {good.area_norm.max():.3f} km²; latest {last.date} {last.sensor} {last.track} = {last.area_km2:.3f} km² raw "
         f"({last.area_norm:.3f} harmonised, band {last.area_lo}–{last.area_hi})" if last is not None else "", "",
         "![contact sheet](qa_contact_sheet.png)", "", "![series](qa_series.png)", "",
         "## Anomaly (03_anomaly.departure_rule, unchanged — monitoring, no known event)", "",
         f"- {an['n_eval']} evaluations, {an['alerts']} ALERT, {an['warnings']} WARNING, σ departures {an['sigma_departure']}", ""]
    if an["flags"]:
        L += [pd.DataFrame(an["flags"]).to_markdown(index=False), ""]
    L += ["## SWOT", ""]
    if sw.get("available"):
        L += [f"- PLD lake {sw['pld']['lake_id']} '{sw['pld']['lake_name']}' (ref. area {sw['pld']['p_ref_area_km2']} km², "
              f"{sw['n_candidates']} candidate(s)); {sw['n_good']} passes quality ≤ 1 ({sw['n_q0']} quality 0) of {sw['n_all']}; "
              f"WSE {sw['wse_min']}–{sw['wse_max']} m, {sw['first']} → {sw['last']}", ""]
    else:
        L += [f"- Not available: {sw.get('reason', 'not run')}", ""]
    L += ["## Caveats for the UI", ""] + [f"- {c}" for c in caveats(cfg, df, poly, an, sw)]
    (P.work / "report.md").write_text("\n".join(L) + "\n", "utf-8")
    log(f"report → {P.work / 'report.md'}")


def caveats(cfg, df, poly, an, sw) -> list[str]:
    c = ["Water area is MEASURED from radar with an adaptive threshold; ±2 dB moves the area (band shown). Tracks differ by "
         "incidence angle: compare harmonised values; NISAR (L-band) vs Sentinel-1 (C-band) is a cross-sensor comparison.",
         "No reference event is known for this dam: detector flags are monitoring prompts (\"needs operator check\"), not "
         "validated detections. Thresholds were tuned on one event (Mellègue, June 2026).",
         "Wet mud and shallow water look alike at L-band; wind roughens the lake at C-band (low-confidence points)."]
    if cfg["water"].get("small_pool"):
        c.append("Small diversion pool: the polygon holds the pool and the river channel; at 10 m most pixels touch the "
                 "shore, so absolute area is uncertain and all points are at most medium confidence. Do not tell a drawdown story.")
    if poly.get("osm_km2") and poly["lake_km2"] / poly["osm_km2"] < 0.5:
        c.append("Radar polygon is much smaller than the OSM polygon: the reservoir was low during the pre-period.")
    if not sw.get("available"):
        c.append(f"No SWOT level: {sw.get('reason', 'not run')}.")
    else:
        c.append("SWOT area_total is the PLD-polygon water area and differs from the radar area; levels are unaffected.")
    clamp = float((df.thr_db >= cfg["water"]["clamp_db"][1] - 0.01).mean())
    if clamp > 0.3:
        c.append(f"The per-image Otsu threshold sat on the {cfg['water']['clamp_db'][1]} dB clamp in {clamp:.0%} of images "
                 "(water is a small share of the polygon + ring histogram): the clamp, not the histogram, sets the mask there.")
    if sw.get("note"):
        c.append(f"SWOT: {sw['note']}.")
    good = df[df.confidence != "low"]
    med = good.area_norm.median()
    iso = good[good.area_norm < 0.7 * med]
    if 0 < len(iso) <= 3:
        c.append("Isolated single-pass drops not repeated by any other pass (" + ", ".join(
            f"{r.date} {r.sensor} {r.track} {r.area_km2:.2f} km²" for r in iso.itertuples())
            + "): most likely a wind-roughened surface (C-band) missed by the confidence rule; treat as outliers.")
    if cfg["dam"].get("name_note"):
        c.append(cfg["dam"]["name_note"])
    return c


# ================================================================================================ main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dam", required=True, help="dam id (slug); per-dam config in config/dams/<id>.yaml")
    ap.add_argument("--config", type=Path, default=None, help="per-dam config (default config/dams/<id>.yaml)")
    ap.add_argument("--lonlat", type=float, nargs=2)
    ap.add_argument("--crest", help="GeoJSON with a LineString crest (and optionally a Point)")
    ap.add_argument("--osm-dam", help="OSM dam element, e.g. w172827257")
    ap.add_argument("--osm-reservoir", help="OSM reservoir element, e.g. r2307563")
    ap.add_argument("--name")
    ap.add_argument("--name-source", default="")
    ap.add_argument("--reset", action="store_true", help="recompute water/period/aoi instead of keeping hand edits")
    ap.add_argument("--steps", nargs="+", default=STEPS, choices=STEPS)
    a = ap.parse_args()
    P = Paths(a.dam)
    if a.config:
        P.cfg = a.config
    times = {}
    cfg = None
    for s in STEPS:
        if s not in a.steps:
            continue
        t0 = time.time()
        log(f"==== {a.dam}: {s}")
        if s == "config":
            cfg = step_config(P, a)
        else:
            cfg = cfg or load_cfg(P)
            if s == "catchment":
                step_catchment(P, cfg)
            elif s == "terrain":
                step_terrain(P, cfg)
            elif s == "s1":
                step_s1(P, cfg)
            elif s == "nisar":
                step_nisar(P, cfg)
            elif s == "reservoir":
                step_reservoir(P, cfg)
            elif s == "anomaly":
                step_anomaly(P, cfg)
            elif s == "swot":
                step_swot(P, cfg)
            elif s == "bundle":
                if step_bundle(P, cfg):
                    log("bundle validation FAILED")
            elif s == "report":
                step_report(P, cfg, {k: f"{v:.0f}s" for k, v in times.items()})
        times[s] = time.time() - t0
    prov_p = P.work / "provenance.json"
    prov = json.loads(prov_p.read_text("utf-8")) if prov_p.exists() else {}
    prov.update({s: dict(seconds=round(v, 1), utc=dt.datetime.now(dt.timezone.utc).isoformat()[:16]) for s, v in times.items()})
    prov_p.write_text(json.dumps(prov, indent=1), "utf-8")
    log(f"done {a.dam}: " + ", ".join(f"{k} {v:.0f}s" for k, v in times.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
