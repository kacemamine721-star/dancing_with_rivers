#!/usr/bin/env python3
"""00 · Context data: download, clip, reproject and package the ancillary geodata (analysis + web).

Sources (all raw downloads cached under cache/context/<source>/, re-runs work offline from the cache)
  osm          OpenStreetMap via Overpass: places, roads, railways, waterways, water bodies, dams, reservoirs,
               building centroids, and two probes (Mellègue names/construction, irrigation/farmland)
  boundaries   geoBoundaries gbOpen: TUN ADM0/1/2, DZA ADM0 → admin units + Tunisia–Algeria border
  hydrosheds   HydroRIVERS v1.0 + HydroBASINS v1c (Africa): rivers, lev06/07 basins, Mellègue + Sidi Salem catchments
  gsw          JRC Global Surface Water (Planetary Computer `jrc-gsw`): occurrence + extent
  worldcover   ESA WorldCover 2021 v200 (Planetary Computer `esa-worldcover`)
  worldpop     WorldPop 2020 constrained, Tunisia, 100 m → 30 m (sum-preserving)
  checks       consistency checks + MISSING list      report   work/context/report.md

Outputs
  work/context/*.gpkg (EPSG:32632)  work/gsw_*_30m.tif  work/worldcover_*.tif  work/pop_30m.tif
  <bundle>/vectors/*.geojson (EPSG:32632 metres, 1 m precision)  <bundle>/landcover/worldcover.png
  <bundle>/water/gsw_occurrence.png — all registered in manifest.json

  python pipeline/00_context_data.py [--config config.yaml] [--only osm|boundaries|hydrosheds|gsw|worldcover|worldpop|checks|report]
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import math
import re
import sys
import time
import unicodedata
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
from common import contracts as C  # noqa: E402

import numpy as np  # noqa: E402

ROOT = common.ROOT
CACHE = ROOT / "cache" / "context"
WORK = ROOT / "work"
CTX = WORK / "context"
CRS = "EPSG:32632"
PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
OVERPASS_MIRRORS = ["https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
WEB_CRS = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32632"}}
STATE = CTX / "report_state.json"

WORLDCOVER = {  # official ESA WorldCover v200 legend: code -> (label, hex)
    10: ("Tree cover", "006400"), 20: ("Shrubland", "ffbb22"), 30: ("Grassland", "ffff4c"),
    40: ("Cropland", "f096ff"), 50: ("Built-up", "fa0000"), 60: ("Bare / sparse vegetation", "b4b4b4"),
    70: ("Snow and ice", "f0f0f0"), 80: ("Permanent water bodies", "0064c8"), 90: ("Herbaceous wetland", "0096a0"),
    95: ("Mangroves", "00cf75"), 100: ("Moss and lichen", "fae6a0"),
}


# ================================================================================================ small helpers
def log(*a):
    print(*a, flush=True)


def bundle_mod():
    spec = importlib.util.spec_from_file_location("bundle08", Path(__file__).with_name("08_bundle.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


RUN_KEYS: set = set()


def save_state(st: dict) -> None:
    """Merge this run's steps into the on-disk state (other steps' results, possibly from other runs, are kept)."""
    CTX.mkdir(parents=True, exist_ok=True)
    disk = load_state()
    for k in RUN_KEYS:
        if k in st:
            disk[k] = st[k]
    disk.setdefault("web", {}).update(st.get("web", {}))
    if "step_errors" in st:
        disk.setdefault("step_errors", {}).update(st["step_errors"])
    st.clear()
    st.update(disk)
    STATE.write_text(json.dumps(st, indent=1, ensure_ascii=False, default=str), encoding="utf-8")


def norm(s) -> str:
    """Lower-case, strip accents and anything that is not a Latin or Arabic letter (for name matching)."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z؀-ۿ]", "", s)


NAME_COLS = ("name", "name_fr", "name_en", "name_ar")


def names_of(row) -> list[str]:
    return [row[c] for c in NAME_COLS if c in row and isinstance(row[c], str) and row[c]]


def name_match(row, keys: list[str], exact=False) -> bool:
    ns = [norm(n) for n in names_of(row)]
    return any((n == k if exact else (k in n)) for n in ns for k in keys if n)


def fsize(p: Path) -> int:
    return p.stat().st_size if p.exists() else 0


def to_utm(gdf):
    return gdf.to_crs(CRS)


def lonlat_box_utm(b):
    """WGS84 bbox → polygon in EPSG:32632 (densified edges)."""
    from shapely.geometry import Polygon
    from pyproj import Transformer
    tr = Transformer.from_crs(4326, CRS, always_xy=True)
    lon0, lat0, lon1, lat1 = b
    n = 20
    pts = ([(lon0 + (lon1 - lon0) * i / n, lat0) for i in range(n)] + [(lon1, lat0 + (lat1 - lat0) * i / n) for i in range(n)]
           + [(lon1 - (lon1 - lon0) * i / n, lat1) for i in range(n)] + [(lon0, lat1 - (lat1 - lat0) * i / n) for i in range(n)])
    return Polygon([tr.transform(x, y) for x, y in pts])


def dam_point_utm(cfg):
    from pyproj import Transformer
    from shapely.geometry import Point
    x, y = Transformer.from_crs(4326, CRS, always_xy=True).transform(*cfg["dam"]["lonlat"])
    return Point(x, y)


def analysis_grid():
    import rasterio
    with rasterio.open(WORK / "dem_32632_30m.tif") as src:
        return src.transform, src.shape, src.crs


def scene_grid(cfg):
    from rasterio.transform import from_bounds
    g = json.loads((common.bundle_dir(cfg) / "terrain/grid.json").read_text(encoding="utf-8"))
    w, h = g["size_px"]
    return from_bounds(*g["bounds_m"], w, h), (h, w), g


# ================================================================================================ HTTP
def http_download(url: str, dest: Path, ua: str, tries: int = 5) -> Path:
    """Stream to <dest>.part with HTTP Range resume; verify size against Content-Length; atomic rename."""
    import requests
    if dest.exists() and dest.stat().st_size > 0:
        log(f"  cached {dest.relative_to(ROOT)} ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    hdr = {"User-Agent": ua}
    total = None
    for k in range(tries):
        try:
            h = requests.head(url, headers=hdr, allow_redirects=True, timeout=60)
            total = int(h.headers.get("Content-Length", 0)) or None
            have = part.stat().st_size if part.exists() else 0
            if total and have > total:
                part.unlink()
                have = 0
            rh = dict(hdr)
            if have and total and have < total:
                rh["Range"] = f"bytes={have}-"
            if total and have == total:
                break
            with requests.get(url, headers=rh, stream=True, timeout=120, allow_redirects=True) as r:
                r.raise_for_status()
                mode = "ab" if (have and r.status_code == 206) else "wb"
                if mode == "wb":
                    have = 0
                t0, done = time.time(), have
                with open(part, mode) as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        f.write(chunk)
                        done += len(chunk)
                        if total and time.time() - t0 > 15:
                            log(f"    {dest.name}: {done / 1e6:.0f}/{total / 1e6:.0f} MB")
                            t0 = time.time()
            if total is None or part.stat().st_size == total:
                break
            log(f"  short read {part.stat().st_size} / {total}, resuming")
        except Exception as e:  # noqa: BLE001
            log(f"  download error ({k + 1}/{tries}) {type(e).__name__}: {e}")
            time.sleep(5 * (k + 1))
    if not part.exists() or (total and part.stat().st_size != total):
        raise RuntimeError(f"download failed: {url}")
    part.replace(dest)
    log(f"  downloaded {dest.relative_to(ROOT)} ({dest.stat().st_size / 1e6:.1f} MB, Content-Length verified)")
    return dest


_last_overpass = [0.0]


def overpass(name: str, body: str, out: str, cfg: dict) -> dict:
    """Run one Overpass query (cached raw JSON). `out` is 'geom' or 'center'."""
    import requests
    p = CACHE / "osm" / f"{name}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    q = f"[out:json][timeout:180];\n{body}\nout {out};"
    urls = [cfg["context"]["overpass"]] + OVERPASS_MIRRORS
    hdr = {"User-Agent": cfg["context"]["user_agent"]}
    last = None
    for url in urls:
        for k, wait in enumerate((0, 15, 45, 90)):
            if wait:
                log(f"    retry {name} in {wait} s")
                time.sleep(wait)
            dt_ = time.time() - _last_overpass[0]
            if dt_ < 2:
                time.sleep(2 - dt_)
            try:
                r = requests.post(url, data={"data": q}, headers=hdr, timeout=300)
                _last_overpass[0] = time.time()
                if r.status_code != 200:
                    last = f"HTTP {r.status_code}"
                    log(f"  overpass {name}: {last} from {url}")
                    continue
                js = r.json()
                rem = js.get("remark", "")
                if "runtime error" in rem.lower() or "timed out" in rem.lower():
                    last = rem[:200]
                    log(f"  overpass {name}: {last}")
                    continue
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(js, ensure_ascii=False), encoding="utf-8")
                js["_endpoint"] = url
                log(f"  overpass {name}: {len(js.get('elements', []))} elements ({url})")
                return js
            except Exception as e:  # noqa: BLE001
                _last_overpass[0] = time.time()
                last = f"{type(e).__name__}: {e}"
                log(f"  overpass {name}: {last}")
    raise RuntimeError(f"Overpass failed for {name}: {last}")


def bb(b):  # Overpass bbox order: south, west, north, east
    lon0, lat0, lon1, lat1 = b
    return f"{lat0},{lon0},{lat1},{lon1}"


# ================================================================================================ OSM → shapely
AREA_KEYS = ("natural", "water", "landuse", "building", "man_made", "leisure", "amenity", "area", "irrigation", "place")


def _coords(g):
    return [(p["lon"], p["lat"]) for p in (g or []) if p]


def _ring_polys(lines):
    from shapely.geometry import LineString
    from shapely.ops import polygonize, unary_union
    ls = [LineString(c) for c in lines if len(c) >= 2]
    if not ls:
        return None
    polys = list(polygonize(unary_union(ls)))
    return unary_union(polys) if polys else None


def osm_geom(el, area_mode: str):
    """area_mode: 'always' (closed ways → polygon), 'never' (lines), 'auto' (closed + area-ish tag → polygon)."""
    from shapely.geometry import LineString, MultiLineString, Point, Polygon
    from shapely.validation import make_valid
    t = el["type"]
    if t == "node":
        return Point(el["lon"], el["lat"])
    if "center" in el and "geometry" not in el and "members" not in el:
        return Point(el["center"]["lon"], el["center"]["lat"])
    tags = el.get("tags", {})
    if t == "way":
        c = _coords(el.get("geometry"))
        if len(c) < 2:
            return None
        closed = len(c) >= 4 and c[0] == c[-1]
        as_area = closed and (area_mode == "always" or (area_mode == "auto" and (tags.get("area") == "yes" or any(
            k in tags for k in AREA_KEYS if k != "man_made") or tags.get("man_made") == "dam" and tags.get("area") != "no")))
        if area_mode == "never" and tags.get("area") != "yes":
            as_area = False
        if as_area:
            g = make_valid(Polygon(c))
            return g if not g.is_empty else None
        return LineString(c)
    if t == "relation":
        mem = [m for m in el.get("members", []) if m.get("type") == "way" and m.get("geometry")]
        if tags.get("type") in ("multipolygon", "boundary") and area_mode != "never":
            outer = [_coords(m["geometry"]) for m in mem if m.get("role", "outer") in ("outer", "")]
            inner = [_coords(m["geometry"]) for m in mem if m.get("role") == "inner"]
            po, pi = _ring_polys(outer), _ring_polys(inner)
            if po is None:
                return None
            g = po.difference(pi) if pi is not None else po
            g = make_valid(g)
            return g if not g.is_empty else None
        ls = [c for c in (_coords(m["geometry"]) for m in mem) if len(c) >= 2]
        return MultiLineString(ls) if ls else None
    return None


def osm_gdf(js: dict, area_mode: str, keep: list[str]):
    import geopandas as gpd
    rows, seen = [], set()
    for el in js.get("elements", []):
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        try:
            g = osm_geom(el, area_mode)
        except Exception:  # noqa: BLE001  (broken relation)
            g = None
        if g is None or g.is_empty:
            continue
        tags = el.get("tags", {})
        r = {"osm_id": f"{el['type'][0]}{el['id']}"}
        for k in keep:
            r[k.replace(":", "_")] = tags.get(k)
        r["geometry"] = g
        rows.append(r)
    cols = ["osm_id"] + [k.replace(":", "_") for k in keep] + ["geometry"]
    return gpd.GeoDataFrame(rows, columns=cols, geometry="geometry", crs=4326)


def polys_only(gdf):
    from shapely.geometry import MultiPolygon
    def f(g):
        if g.geom_type in ("Polygon", "MultiPolygon"):
            return g
        if g.geom_type == "GeometryCollection":
            ps = [p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
            if ps:
                out = []
                for p in ps:
                    out.extend(p.geoms if p.geom_type == "MultiPolygon" else [p])
                return MultiPolygon(out)
        return None
    g = gdf.copy()
    g["geometry"] = g.geometry.apply(f)
    return g[g.geometry.notna()].copy()


def lines_only(gdf):
    return gdf[gdf.geom_type.isin(["LineString", "MultiLineString"])].copy()


# ================================================================================================ writers
def write_gpkg(gdf, name: str) -> Path:
    CTX.mkdir(parents=True, exist_ok=True)
    p = CTX / f"{name}.gpkg"
    if p.exists():
        p.unlink()
    g = gdf.to_crs(CRS) if gdf.crs and gdf.crs.to_epsg() != 32632 else gdf
    kinds = set(g.geom_type)
    kw = {"geometry_type": "Unknown"} if len(kinds) > 1 and not kinds <= {"Polygon", "MultiPolygon"} \
        and not kinds <= {"LineString", "MultiLineString"} else {}
    g.to_file(p, driver="GPKG", layer=name, engine="pyogrio", **kw)
    return p


def _intify(o):
    if isinstance(o, (list, tuple)):
        if o and isinstance(o[0], (int, float)) and not isinstance(o[0], bool):
            return [int(round(v)) for v in o]
        return [_intify(v) for v in o]
    return o


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float):
        if math.isnan(v):
            return None
        return int(v) if v.is_integer() else (round(v, 3) if abs(v) < 1e6 else round(v))
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return _clean(float(v))
    return v


def write_web_geojson(gdf, path: Path, props: list[str], tol: float, clip=None, name="") -> dict:
    """UTM metres, simplified (tol m), 1 m precision, minimal properties, top-level crs member."""
    import shapely
    from shapely.geometry import mapping
    g = gdf.to_crs(CRS) if gdf.crs.to_epsg() != 32632 else gdf.copy()
    if clip is not None:
        g = g.clip(clip)
    if tol > 0:
        g["geometry"] = g.geometry.simplify(tol, preserve_topology=True)
    g["geometry"] = shapely.set_precision(g.geometry.values, 1.0)
    g = g[~g.geometry.is_empty & g.geometry.notna()]
    feats = []
    for _, r in g.iterrows():
        geom = r.geometry
        if geom.geom_type == "GeometryCollection":
            parts = [p for p in geom.geoms if not p.is_empty]
            if not parts:
                continue
            geom = shapely.union_all(parts)
        gj = mapping(geom)
        gj = {"type": gj["type"], "coordinates": _intify(gj["coordinates"])}
        feats.append({"type": "Feature", "properties": {k: _clean(r.get(k)) for k in props}, "geometry": gj})
    fc = {"type": "FeatureCollection", "name": name or path.stem, "crs": WEB_CRS, "features": feats}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return {"file": str(path.relative_to(ROOT)).replace("\\", "/"), "features": len(feats), "bytes": fsize(path)}


class Bundle:
    def __init__(self, cfg):
        self.cfg, self.out, self.b = cfg, common.bundle_dir(cfg), bundle_mod()

    def register(self, **layer):
        layer.setdefault("placeholder", False)
        self.b.register_layer(self.out, layer, self.cfg["brand"]["product"], self.cfg["dam"]["id"],
                              self.cfg["bundle"]["version"])


ODBL = "© OpenStreetMap contributors (ODbL 1.0)"


# ================================================================================================ step: OSM
def step_osm(cfg, st, bnd: Bundle):
    log("== OSM (Overpass)")
    scene, dams_bb, hydro = cfg["aoi"]["scene"], cfg["context"]["dams_bbox"], cfg["context"]["hydro_bbox"]
    bld_bb = [8.55, 36.20, 9.50, 36.70]
    NM = ["name", "name:fr", "name:en", "name:ar"]
    res_body = ('(way["water"="reservoir"]({b});relation["water"="reservoir"]({b});'
                'way["landuse"="reservoir"]({b});relation["landuse"="reservoir"]({b}););')
    qs = {
        "places": (f'nwr["place"~"^(city|town|village|hamlet)$"]({bb(scene)});', "center"),
        "roads": (f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track)$"]({bb(scene)});', "geom"),
        "railways": (f'way["railway"="rail"]({bb(scene)});', "geom"),
        "waterways": (f'way["waterway"~"^(river|stream|canal|drain)$"]({bb(scene)});', "geom"),
        "waterbodies": ('(way["natural"="water"]({b});relation["natural"="water"]({b});'.format(b=bb(scene))
                        + res_body.format(b=bb(scene))[1:], "geom"),
        "dams": ('(nwr["waterway"="dam"]({b});nwr["man_made"="dam"]({b}););'.format(b=bb(dams_bb)), "geom"),
        "reservoirs": (res_body.format(b=bb(dams_bb)), "geom"),
        "probe_mellegue": ('(nwr["name"~"Mell[eèé]gue|Mellag|Mallaq|ملاق|ملاڨ",i]({b});'
                           'nwr["name:fr"~"Mell[eèé]gue",i]({b});nwr["name:ar"~"ملاق|ملاڨ"]({b});'
                           'nwr["construction"~"dam|reservoir"]({b});nwr["proposed"~"dam|reservoir"]({b});'
                           'nwr["waterway"="construction"]({b});nwr["landuse"="construction"]["name"]({b}););'
                           .format(b=bb(hydro)), "geom"),
        "probe_irrigation": ('(nwr["irrigation"]({b});nwr["landuse"="farmland"]({b});nwr["landuse"="irrigation"]({b});'
                             'nwr["name"~"rim[eè]tre|irrig|PPI|سقوي",i]({b}););'.format(b=bb(bld_bb)), "geom"),
    }
    raw, fails = {}, []
    for name, (body, out) in qs.items():
        try:
            raw[name] = overpass(name, body, out, cfg)
        except Exception as e:  # noqa: BLE001
            log(f"  FAILED {name}: {e}")
            fails.append(f"osm/{name}: {e}")
    # buildings: 2×2 tiles (centroids only)
    bld = []
    lon0, lat0, lon1, lat1 = bld_bb
    for i in range(2):
        for j in range(2):
            t = [lon0 + (lon1 - lon0) * i / 2, lat0 + (lat1 - lat0) * j / 2,
                 lon0 + (lon1 - lon0) * (i + 1) / 2, lat0 + (lat1 - lat0) * (j + 1) / 2]
            try:
                bld.append(overpass(f"buildings_{i}{j}", f'nwr["building"]({bb(t)});', "center", cfg))
            except Exception as e:  # noqa: BLE001
                fails.append(f"osm/buildings_{i}{j}: {e}")
    if bld:
        raw["buildings"] = {"elements": [e for js in bld for e in js.get("elements", [])]}

    S = st.setdefault("osm", {})
    S["failures"] = fails
    S["accessed"] = dt.date.today().isoformat()
    S["layers"] = {}
    out = bnd.out / "vectors"
    scene_clip = lonlat_box_utm(scene)
    web = st.setdefault("web", {})

    def rec(name, gdf, extra=None):
        p = write_gpkg(gdf, name)
        S["layers"][name] = dict(count=int(len(gdf)), gpkg=str(p.relative_to(ROOT)).replace("\\", "/"),
                                 bytes=fsize(p), **(extra or {}))
        log(f"  {name}: {len(gdf)} features → {p.name}")

    # places
    if "places" in raw:
        g = osm_gdf(raw["places"], "never", NM + ["place", "population"])
        g["population"] = g["population"].apply(lambda v: int(re.sub(r"\D", "", v)) if isinstance(v, str) and re.sub(r"\D", "", v) else None)
        g = g[g.geom_type == "Point"]
        rec("villages", g, {"by_place": g["place"].value_counts().to_dict()})
        web["villages"] = write_web_geojson(g, out / "villages.geojson",
                                            ["name", "name_fr", "name_en", "name_ar", "place", "population"], 0)
        bnd.register(id="villages", kind="vector", grid="none", file="vectors/villages.geojson", label="Towns and villages",
                     sensor="OSM", badge="REPORTED", source=ODBL,
                     method=f"Overpass place=city|town|village|hamlet in aoi.scene, accessed {S['accessed']}",
                     uncertainty="Point positions are mapper-placed village centres; completeness of hamlets varies")
    # roads
    if "roads" in raw:
        g = lines_only(osm_gdf(raw["roads"], "never", ["highway", "name", "ref"]))
        gu = to_utm(g)
        km = (gu.length / 1000).groupby(gu["highway"]).sum().round(1).to_dict()
        rec("roads", g, {"km_by_class": km})
        major = g[g["highway"].isin(["motorway", "trunk", "primary", "secondary", "tertiary"])]
        web["roads"] = write_web_geojson(major, out / "roads.geojson", ["highway", "name", "ref"], 20)
        bnd.register(id="roads", kind="vector", grid="none", file="vectors/roads.geojson", label="Main roads",
                     sensor="OSM", badge="REPORTED", source=ODBL,
                     method="Overpass highway=motorway…tertiary in aoi.scene; simplified 20 m (analysis copy keeps all "
                            "classes incl. unclassified/residential/track)",
                     uncertainty="OSM geometry ±5–20 m; rural tracks incomplete")
    if "railways" in raw:
        g = lines_only(osm_gdf(raw["railways"], "never", ["name", "usage", "service"]))
        rec("railways", g, {"km": round(float(to_utm(g).length.sum() / 1000), 1)})
    # waterways
    if "waterways" in raw:
        g = lines_only(osm_gdf(raw["waterways"], "never", ["waterway", "name", "name:fr", "name:ar"]))
        gu = to_utm(g)
        rec("waterways", g, {"km_by_type": (gu.length / 1000).groupby(gu["waterway"]).sum().round(1).to_dict()})
        named = g[(g["waterway"] == "river") | (g["waterway"].isin(["canal", "stream"]) & (g["name"].notna() | g["name_fr"].notna()))]
        web["rivers"] = write_web_geojson(named, out / "rivers.geojson", ["waterway", "name", "name_fr"], 15)
        bnd.register(id="rivers_osm", kind="vector", grid="none", file="vectors/rivers.geojson",
                     label="Rivers and canals (OSM)", sensor="OSM", badge="REPORTED", source=ODBL,
                     method="Overpass waterway=river (all) + named canals/streams in aoi.scene; simplified 15 m",
                     uncertainty="Mapped centrelines; braided wadi beds are approximated")
    # water bodies
    wbodies = None
    if "waterbodies" in raw:
        g = polys_only(osm_gdf(raw["waterbodies"], "always", ["name", "name:fr", "name:ar", "natural", "water", "landuse"]))
        g["area_km2"] = to_utm(g).area / 1e6
        wbodies = g
        rec("waterbodies", g, {"area_km2_total": round(float(g["area_km2"].sum()), 2)})
        wb = g[g["area_km2"] >= 0.005]
        web["waterbodies"] = write_web_geojson(wb, out / "waterbodies.geojson", ["name", "water", "area_km2"], 15)
        bnd.register(id="waterbodies", kind="vector", grid="none", file="vectors/waterbodies.geojson",
                     label="Lakes and reservoirs (OSM)", sensor="OSM", badge="REPORTED", source=ODBL,
                     method="Overpass natural=water, water=reservoir, landuse=reservoir in aoi.scene (ways + multipolygons); "
                            "web copy ≥ 0.5 ha, simplified 15 m",
                     uncertainty="Mapped shorelines are a nominal/full extent, not the water surface on a given date")
    # reservoirs + dams (northern Tunisia)
    res = None
    if "reservoirs" in raw:
        res = polys_only(osm_gdf(raw["reservoirs"], "always", ["name", "name:fr", "name:ar", "water", "landuse"]))
        res["area_km2"] = to_utm(res).area / 1e6
        rec("reservoirs", res, {"area_km2_total": round(float(res["area_km2"].sum()), 2)})
    if "dams" in raw:
        d = osm_gdf(raw["dams"], "auto", NM + ["waterway", "man_made", "operator", "start_date", "height"])
        du = to_utm(d)
        rec("dams", d)
        pts = du.copy()
        pts["geometry"] = [g.interpolate(0.5, normalized=True) if g.geom_type in ("LineString",) else
                           (g.representative_point() if g.geom_type != "Point" else g) for g in du.geometry]
        pts["geom_type"] = du.geom_type.values
        pts["reservoir_area_km2"] = None
        pts["reservoir_name"] = None
        pts["reservoir_osm_id"] = None
        pool = [x for x in (res, wbodies) if x is not None and len(x)]   # natural=water lakes lack water=reservoir
        if pool:
            ru = to_utm(pd_concat(pool).drop_duplicates("osm_id")).reset_index(drop=True)
            sidx = ru.sindex
            for i, g in zip(pts.index, du.geometry):
                cand = list(sidx.query(g.buffer(300), predicate="intersects"))
                if cand:
                    k = max(cand, key=lambda c: ru.at[c, "area_km2"])
                    pts.at[i, "reservoir_area_km2"] = round(float(ru.at[k, "area_km2"]), 3)
                    pts.at[i, "reservoir_name"] = ru.at[k, "name"] or ru.at[k, "name_fr"]
                    pts.at[i, "reservoir_osm_id"] = ru.at[k, "osm_id"]
        pts["source"] = "OSM"
        pts["dname"] = [next(iter(names_of(r)), None) for _, r in pts.iterrows()]
        rec("dam_points", pts.drop(columns=["dname"]))
        web["dams"] = write_web_geojson(
            pts.rename(columns={"osm_id": "osm_id"}), out / "dams.geojson",
            ["name", "name_fr", "name_ar", "reservoir_area_km2", "reservoir_name", "source", "osm_id", "geom_type"], 0)
        bnd.register(id="dams", kind="vector", grid="none", file="vectors/dams.geojson", label="Dams (northern Tunisia)",
                     sensor="OSM", badge="REPORTED", source=ODBL,
                     method="Overpass waterway=dam + man_made=dam over context.dams_bbox → one point per feature (line "
                            "midpoint / polygon interior point); reservoir = largest OSM reservoir / natural=water polygon within 300 m of the dam geometry",
                     uncertainty="Reservoir area is the mapped (nominal) polygon, not current storage; small hill-lake "
                                 "dams are incomplete; a dam may appear twice (node + way)")
    # buildings (analysis only)
    if "buildings" in raw:
        g = osm_gdf(raw["buildings"], "never", ["building"])
        g = g[g.geom_type == "Point"]
        rec("buildings", g, {"bbox": bld_bb, "by_type_top": g["building"].value_counts().head(8).to_dict()})
    # probes
    for pn in ("probe_mellegue", "probe_irrigation"):
        if pn in raw:
            g = osm_gdf(raw[pn], "auto", NM + ["waterway", "man_made", "natural", "water", "landuse", "irrigation",
                                              "construction", "proposed", "crop", "type"])
            g = g[~g.geometry.is_empty]
            rec(pn, g)
    save_state(st)


# ================================================================================================ step: boundaries
def step_boundaries(cfg, st, bnd: Bundle):
    log("== geoBoundaries")
    import geopandas as gpd
    import requests
    from shapely.geometry import box
    api = cfg["context"]["sources"]["geoboundaries_api"]
    ua = cfg["context"]["user_agent"]
    S = st.setdefault("boundaries", {"meta": {}, "layers": {}})
    S["accessed"] = dt.date.today().isoformat()
    gdfs, fails = {}, []
    for iso, adm in (("TUN", "ADM0"), ("TUN", "ADM1"), ("TUN", "ADM2"), ("DZA", "ADM0")):
        d = CACHE / "geoboundaries"
        mp = d / f"{iso}_{adm}_meta.json"
        try:
            if mp.exists():
                meta = json.loads(mp.read_text(encoding="utf-8"))
            else:
                r = requests.get(api.format(iso=iso, adm=adm), headers={"User-Agent": ua}, timeout=60)
                r.raise_for_status()
                meta = r.json()
                d.mkdir(parents=True, exist_ok=True)
                mp.write_text(json.dumps(meta, indent=1), encoding="utf-8")
            gj = http_download(meta["gjDownloadURL"], d / f"{iso}_{adm}.geojson", ua)
            gdfs[(iso, adm)] = gpd.read_file(gj).to_crs(4326)
            S["meta"][f"{iso}_{adm}"] = {k: meta.get(k) for k in ("boundaryID", "boundaryName", "boundaryYearRepresented",
                                                                   "boundarySource", "boundaryLicense", "licenseDetail",
                                                                   "licenseSource", "buildDate", "gjDownloadURL")}
        except Exception as e:  # noqa: BLE001
            log(f"  FAILED {iso} {adm}: {e}")
            fails.append(f"geoboundaries/{iso}_{adm}: {e}")
    S["failures"] = fails
    out = bnd.out / "vectors"
    web = st.setdefault("web", {})
    dams_box = box(*cfg["context"]["dams_bbox"])
    keep = ["shapeName", "shapeISO", "shapeID", "level"]

    for (iso, adm), g in gdfs.items():
        g = g.copy()
        g["level"] = adm
        if iso == "TUN" and adm in ("ADM1", "ADM2"):
            g = g[g.intersects(dams_box)]
        p = write_gpkg(g[[c for c in keep if c in g.columns] + ["geometry"]], f"{iso.lower()}_{adm.lower()}")
        S["layers"][f"{iso}_{adm}"] = dict(count=int(len(g)), gpkg=str(p.relative_to(ROOT)).replace("\\", "/"), bytes=fsize(p))
        log(f"  {iso} {adm}: {len(g)} units")
    # admin web layer: ADM1 + ADM2 clipped to the scene
    if ("TUN", "ADM1") in gdfs and ("TUN", "ADM2") in gdfs:
        a = gpd.GeoDataFrame(
            [*[dict(level="ADM1", name=r.shapeName, geometry=r.geometry) for r in gdfs[("TUN", "ADM1")].itertuples()],
             *[dict(level="ADM2", name=r.shapeName, geometry=r.geometry) for r in gdfs[("TUN", "ADM2")].itertuples()]],
            crs=4326)
        web["admin"] = write_web_geojson(a, out / "admin.geojson", ["level", "name"], 25,
                                         clip=lonlat_box_utm(cfg["aoi"]["scene"]))
        lic = S["meta"].get("TUN_ADM2", {}).get("boundaryLicense", "see geoBoundaries metadata")
        bnd.register(id="admin", kind="vector", grid="none", file="vectors/admin.geojson",
                     label="Governorates and delegations", badge="REPORTED",
                     source=f"geoBoundaries gbOpen TUN ADM1/ADM2 (licence: {lic}; "
                            f"{S['meta'].get('TUN_ADM2', {}).get('boundarySource', '')})",
                     method="ADM1 + ADM2 polygons clipped to aoi.scene, simplified 25 m",
                     uncertainty="Open-source administrative boundaries, not legally authoritative; ±100 m or more")
    # border line
    if ("DZA", "ADM0") in gdfs and ("TUN", "ADM0") in gdfs:
        dz = to_utm(gdfs[("DZA", "ADM0")]).union_all()
        tn = to_utm(gdfs[("TUN", "ADM0")]).union_all()
        hb = lonlat_box_utm(cfg["context"]["hydro_bbox"])
        line = dz.boundary.intersection(tn.buffer(2000)).intersection(hb)
        bl = gpd.GeoDataFrame([dict(name="Tunisia–Algeria border", geometry=line)], crs=CRS)
        p = write_gpkg(bl, "border")
        S["layers"]["border"] = dict(count=1, gpkg=str(p.relative_to(ROOT)).replace("\\", "/"), bytes=fsize(p),
                                     km=round(line.length / 1000, 1))
        web["border"] = write_web_geojson(bl, out / "border.geojson", ["name"], 25)
        bnd.register(id="border", kind="vector", grid="none", file="vectors/border.geojson", label="Tunisia–Algeria border",
                     badge="REPORTED", source="geoBoundaries gbOpen DZA ADM0 + TUN ADM0",
                     method="DZA ADM0 outline within 2 km of TUN ADM0, clipped to context.hydro_bbox, simplified 25 m",
                     uncertainty="Datasets are not edge-matched; line is indicative (±0.1–1 km)")
    save_state(st)


# ================================================================================================ step: HydroSHEDS
def _zip_member(zp: Path, pattern: str) -> str:
    with zipfile.ZipFile(zp) as z:
        for n in z.namelist():
            if re.search(pattern, n, re.I):
                return n
    raise FileNotFoundError(pattern)


def _upstream(ids_down: dict, start: int) -> set:
    up: dict[int, list] = {}
    for i, nd in ids_down.items():
        up.setdefault(nd, []).append(i)
    out, stack = set(), [start]
    while stack:
        k = stack.pop()
        if k in out:
            continue
        out.add(k)
        stack.extend(up.get(k, []))
    return out


def catchment(b12, rivers_u, pt_u, label: str, read_bbox) -> dict:
    """Snap a dam point to the nearest main-stem HydroRIVERS reach, take its HYBAS_L12 basin, collect upstream basins."""
    import geopandas as gpd
    b12u = b12.to_crs(CRS)
    ids_down = dict(zip(b12["HYBAS_ID"].astype(int), b12["NEXT_DOWN"].astype(int)))
    contain = b12u[b12u.contains(pt_u)]
    r = rivers_u[rivers_u.distance(pt_u) < 3000].copy()
    r["d"] = r.distance(pt_u)
    snap = None
    if len(r):
        main = r[r["UPLAND_SKM"] >= 0.5 * r["UPLAND_SKM"].max()]
        snap = main.sort_values("d").iloc[0]
    out = {"label": label}
    if len(contain):
        c = contain.iloc[0]
        ids = _upstream(ids_down, int(c["HYBAS_ID"]))
        out["containing_basin"] = dict(hybas_id=int(c["HYBAS_ID"]), up_area_km2=float(c["UP_AREA"]),
                                       n_basins=len(ids),
                                       sum_sub_area_km2=round(float(b12[b12["HYBAS_ID"].isin(ids)]["SUB_AREA"].sum()), 1))
    if snap is not None:
        start = int(snap["HYBAS_L12"])
        out["snap"] = dict(hyriv_id=int(snap["HYRIV_ID"]), dist_m=round(float(snap["d"]), 1),
                           upland_skm=float(snap["UPLAND_SKM"]), ord_stra=int(snap["ORD_STRA"]),
                           dis_av_cms=float(snap["DIS_AV_CMS"]), hybas_l12=start)
    else:
        start = out.get("containing_basin", {}).get("hybas_id")
    if start is None:
        out["error"] = "no basin found"
        return out
    ids = _upstream(ids_down, start)
    sel = b12u[b12u["HYBAS_ID"].astype(int).isin(ids)]
    poly = sel.union_all()
    st = b12[b12["HYBAS_ID"].astype(int) == start].iloc[0]
    rb = gpd.GeoSeries([poly], crs=CRS).to_crs(4326).total_bounds
    touches = (rb[0] <= read_bbox[0] + 0.05 or rb[1] <= read_bbox[1] + 0.05 or rb[2] >= read_bbox[2] - 0.05
               or rb[3] >= read_bbox[3] - 0.05)
    out.update(method="snap" if snap is not None else "containing", outlet_hybas_id=start, n_basins=len(ids),
               area_km2_polygon_utm32=round(poly.area / 1e6, 1),
               area_km2_sum_sub_area=round(float(sel["SUB_AREA"].sum()), 1),
               outlet_up_area_km2=float(st["UP_AREA"]), bounds_lonlat=[round(float(v), 3) for v in rb],
               touches_read_bbox=bool(touches))
    out["_geom"] = poly
    return out


def step_hydrosheds(cfg, st, bnd: Bundle):
    log("== HydroSHEDS")
    import geopandas as gpd
    from pyproj import Transformer
    from shapely.geometry import Point, box
    src, ua = cfg["context"]["sources"], cfg["context"]["user_agent"]
    S = st.setdefault("hydrosheds", {})
    S["accessed"] = dt.date.today().isoformat()
    S["failures"] = []
    hb = cfg["context"]["hydro_bbox"]
    out = bnd.out / "vectors"
    web = st.setdefault("web", {})
    try:
        zr = http_download(src["hydrorivers"], CACHE / "hydrosheds" / Path(src["hydrorivers"]).name, ua)
        zb = http_download(src["hydrobasins"], CACHE / "hydrosheds" / Path(src["hydrobasins"]).name, ua)
    except Exception as e:  # noqa: BLE001
        S["failures"].append(str(e))
        save_state(st)
        log(f"  FAILED: {e}")
        return
    shp = _zip_member(zr, r"HydroRIVERS_v10_af\.shp$")
    riv = gpd.read_file(f"zip://{zr.as_posix()}!{shp}", bbox=tuple(hb), engine="pyogrio")
    riv = riv.clip(box(*hb))
    keep = ["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "ORD_STRA", "UPLAND_SKM", "DIS_AV_CMS", "HYBAS_L12", "geometry"]
    riv = riv[keep]
    p = write_gpkg(riv, "hydrorivers")
    S["rivers"] = dict(count=int(len(riv)), gpkg=str(p.relative_to(ROOT)).replace("\\", "/"), bytes=fsize(p))
    log(f"  HydroRIVERS: {len(riv)} reaches in hydro_bbox")
    r4 = riv[riv["ORD_STRA"] >= 4]
    web["rivers_hydrorivers"] = write_web_geojson(r4, out / "rivers_hydrorivers.geojson",
                                                  ["ORD_STRA", "UPLAND_SKM", "DIS_AV_CMS", "MAIN_RIV"], 25)
    bnd.register(id="rivers_hydrorivers", kind="vector", grid="none", file="vectors/rivers_hydrorivers.geojson",
                 label="River network (HydroRIVERS, Strahler ≥ 4)", badge="MEASURED",
                 source="HydroRIVERS v1.0 (Lehner & Grill 2013, WWF/McGill), derived from SRTM 15 arc-second hydrology",
                 method="Africa shapefile clipped to context.hydro_bbox, ORD_STRA ≥ 4, simplified 25 m",
                 uncertainty="Modelled from a 500 m DEM-derived network: centrelines off by up to a few hundred metres; "
                             "DIS_AV_CMS is a long-term modelled mean (WaterGAP), not a gauge record")

    # ---- basins
    read_bb = (5.5, 33.5, 11.5, 38.0)
    m12 = _zip_member(zb, r"hybas_af_lev12_v1c\.shp$")
    b12 = gpd.read_file(f"zip://{zb.as_posix()}!{m12}", bbox=read_bb, engine="pyogrio")
    log(f"  HydroBASINS lev12: {len(b12)} basins in {read_bb}")
    riv_u = to_utm(riv)
    rows = []
    mel = catchment(b12, riv_u, dam_point_utm(cfg), "Mellègue dam", read_bb)
    S["catchment_mellegue"] = {k: v for k, v in mel.items() if k != "_geom"}
    if "_geom" in mel:
        g = gpd.GeoDataFrame([dict(id="mellegue", name="Mellègue dam catchment", area_km2=mel["area_km2_polygon_utm32"],
                                   outlet=mel["outlet_hybas_id"], geometry=mel["_geom"])], crs=CRS)
        write_gpkg(g, "catchment_mellegue")
        rows.append(g)
    # Sidi Salem: dam location from OSM
    ss_pt, ss_src = None, None
    dp = CTX / "dam_points.gpkg"
    if dp.exists():
        d = gpd.read_file(dp)
        m = d[[name_match(r, ["sidisalem", "سيديسالم"]) for _, r in d.iterrows()]]
        if len(m):
            m = m.sort_values("reservoir_area_km2", ascending=False, na_position="last")
            ss_pt, ss_src = m.geometry.iloc[0], f"OSM {m['osm_id'].iloc[0]} ({next(iter(names_of(m.iloc[0])), '')}, {m['geom_type'].iloc[0]})"
    if ss_pt is None:  # fall back: downstream end of the OSM reservoir polygon named Sidi Salem
        rp = CTX / "reservoirs.gpkg"
        if rp.exists():
            rr = gpd.read_file(rp)
            m = rr[[name_match(r, ["sidisalem", "سيديسالم"]) for _, r in rr.iterrows()]]
            if len(m):
                poly = m.sort_values("area_km2").geometry.iloc[-1]
                cand = riv_u[riv_u.intersects(poly.buffer(500))]
                if len(cand):
                    top = cand.sort_values("UPLAND_SKM").iloc[-1]
                    ss_pt = poly.boundary.interpolate(poly.boundary.project(top.geometry.centroid))
                    ss_src = f"OSM reservoir {m['osm_id'].iloc[-1]} outlet (no OSM dam named Sidi Salem)"
    if ss_pt is not None:
        ll = Transformer.from_crs(CRS, 4326, always_xy=True).transform(ss_pt.x, ss_pt.y)
        ssc = catchment(b12, riv_u, ss_pt, "Sidi Salem dam", read_bb)
        ssc["dam_point_lonlat"] = [round(ll[0], 5), round(ll[1], 5)]
        ssc["dam_point_source"] = ss_src
        S["catchment_sidi_salem"] = {k: v for k, v in ssc.items() if k != "_geom"}
        if "_geom" in ssc:
            g = gpd.GeoDataFrame([dict(id="sidi_salem", name="Sidi Salem dam catchment",
                                       area_km2=ssc["area_km2_polygon_utm32"], outlet=ssc["outlet_hybas_id"],
                                       geometry=ssc["_geom"])], crs=CRS)
            write_gpkg(g, "catchment_sidi_salem")
            rows.append(g)
    else:
        S["catchment_sidi_salem"] = {"error": "Sidi Salem dam not found in OSM dams/reservoirs"}
    if rows:
        cat = gpd.GeoDataFrame(pd_concat(rows), crs=CRS)
        web["catchment"] = write_web_geojson(cat, out / "catchment.geojson", ["id", "name", "area_km2"], 25)
        bnd.register(id="catchment", kind="vector", grid="none", file="vectors/catchment.geojson",
                     label="Catchments upstream of Mellègue and Sidi Salem dams", badge="MEASURED",
                     source="HydroBASINS v1c level 12 (Lehner & Grill 2013) + HydroRIVERS v1.0",
                     method="dam point snapped to the nearest main-stem HydroRIVERS reach (≤ 3 km), its HYBAS_L12 "
                            "basin + all basins draining to it via NEXT_DOWN, dissolved; area in EPSG:32632",
                     uncertainty="Outlet is the pour point of the level-12 sub-basin holding the dam (can include "
                                 "a few km² downstream of the dam); 15 arc-second boundaries (±0.5 km)")
    # lev06/07 outlines
    bl = []
    hbox = box(*hb)
    for lev in (6, 7):
        ml = _zip_member(zb, r"hybas_af_lev%02d_v1c\.shp$" % lev)
        g = gpd.read_file(f"zip://{zb.as_posix()}!{ml}", engine="pyogrio")   # (.sbn index of lev06 breaks bbox reads)
        g = g[g.intersects(hbox)]
        g = g.clip(hbox)[["HYBAS_ID", "NEXT_DOWN", "SUB_AREA", "UP_AREA", "geometry"]]
        g["level"] = lev
        write_gpkg(g, f"basins_lev{lev:02d}")
        S[f"basins_lev{lev:02d}"] = int(len(g))
        bl.append(g)
    basins = gpd.GeoDataFrame(pd_concat(bl), crs=4326)
    web["basins"] = write_web_geojson(basins, out / "basins.geojson", ["level", "HYBAS_ID", "SUB_AREA"], 25)
    bnd.register(id="basins", kind="vector", grid="none", file="vectors/basins.geojson",
                 label="River basins (HydroBASINS levels 6–7)", badge="MEASURED",
                 source="HydroBASINS v1c (Lehner & Grill 2013)",
                 method="levels 6 and 7 clipped to context.hydro_bbox, simplified 25 m",
                 uncertainty="15 arc-second DEM-derived boundaries (±0.5 km)")
    save_state(st)


def pd_concat(lst):
    import pandas as pd
    return pd.concat(lst, ignore_index=True)


# ================================================================================================ rasters (Planetary Computer)
def _env():
    import rasterio
    return rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="6", GDAL_HTTP_RETRY_DELAY="3",
                        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF")


def pc_cached_windows(collection: str, assets: list[str], bbox_ll, cache_dir: Path, query=None, datetime=None):
    """Read and cache (as local GeoTIFF) the window of every STAC item asset covering bbox_ll."""
    import rasterio
    from rasterio.windows import Window, from_bounds
    idx = cache_dir / "index.json"
    if idx.exists():
        ix = json.loads(idx.read_text(encoding="utf-8"))
        if all((cache_dir / f).exists() for a in assets for f in ix["files"].get(a, [])) and all(a in ix["files"] for a in assets):
            return ix
    import planetary_computer as pc
    import pystac_client
    cat = pystac_client.Client.open(PC_STAC, modifier=pc.sign_inplace)
    kw = dict(collections=[collection], bbox=list(bbox_ll))
    if datetime:
        kw["datetime"] = datetime
    if query:
        kw["query"] = query
    items = list(cat.search(**kw).items())
    if not items:
        raise RuntimeError(f"no {collection} items for {bbox_ll}")
    cache_dir.mkdir(parents=True, exist_ok=True)
    ix = {"collection": collection, "items": [it.id for it in items], "files": {a: [] for a in assets},
          "properties": {it.id: {k: v for k, v in it.properties.items() if isinstance(v, (str, int, float))} for it in items}}
    with _env():
        for it in items:
            for a in assets:
                fn = f"{it.id}_{a}.tif"
                p = cache_dir / fn
                if not p.exists():
                    with rasterio.open(it.assets[a].href) as src:
                        pad = 5 * abs(src.transform.a)
                        from rasterio.warp import transform_bounds
                        l, b, r, t = transform_bounds(4326, src.crs, *bbox_ll, densify_pts=21)
                        win = from_bounds(l - pad, b - pad, r + pad, t + pad, src.transform).round_offsets().round_lengths()
                        try:
                            win = win.intersection(Window(0, 0, src.width, src.height))
                        except Exception:  # noqa: BLE001
                            continue
                        arr = src.read(1, window=win)
                        prof = dict(driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=arr.dtype,
                                    crs=src.crs, transform=src.window_transform(win), nodata=src.nodata,
                                    compress="deflate", tiled=True)
                        with rasterio.open(p, "w", **prof) as dst:
                            dst.write(arr, 1)
                            cmap = None
                            try:
                                cmap = src.colormap(1)
                            except Exception:  # noqa: BLE001
                                pass
                            if cmap:
                                dst.write_colormap(1, cmap)
                    log(f"  cached window {fn} {arr.shape} nodata={src.nodata}")
                ix["files"][a].append(fn)
    idx.write_text(json.dumps(ix, indent=1), encoding="utf-8")
    return ix


def warp_mosaic(files: list[Path], dst_transform, shape, resampling, dtype, dst_nodata, src_nodata=None):
    import rasterio
    from rasterio.warp import reproject
    dst = np.full(shape, dst_nodata, dtype)
    for f in files:
        with rasterio.open(f) as src:
            tmp = np.full(shape, dst_nodata, dtype)
            nod = src.nodata if src.nodata is not None else src_nodata
            reproject(rasterio.band(src, 1), tmp, src_nodata=nod, dst_nodata=dst_nodata, dst_transform=dst_transform,
                      dst_crs=CRS, resampling=resampling)
        fill = (dst == dst_nodata) & (tmp != dst_nodata)
        dst[fill] = tmp[fill]
    return dst


def write_tif(path: Path, arr, transform, nodata, colormap=None):
    import rasterio
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=arr.dtype,
                       crs=CRS, transform=transform, nodata=nodata, compress="deflate", tiled=True,
                       predictor=3 if arr.dtype.kind == "f" else 2) as dst:
        dst.write(arr, 1)
        if colormap:
            dst.write_colormap(1, colormap)
    return path


def grid_lonlat_bbox(transform, shape, pad=0.01):
    from rasterio.transform import array_bounds
    from rasterio.warp import transform_bounds
    l, b, r, t = transform_bounds(CRS, 4326, *array_bounds(shape[0], shape[1], transform), densify_pts=21)
    return [l - pad, b - pad, r + pad, t + pad]


def step_gsw(cfg, st, bnd: Bundle):
    log("== JRC Global Surface Water")
    from PIL import Image
    from rasterio.enums import Resampling
    S = st.setdefault("gsw", {})
    S["accessed"] = dt.date.today().isoformat()
    tr, shape, _ = analysis_grid()
    try:
        ix = pc_cached_windows("jrc-gsw", ["occurrence", "extent"], grid_lonlat_bbox(tr, shape), CACHE / "jrc-gsw")
    except Exception as e:  # noqa: BLE001
        S["failure"] = f"{type(e).__name__}: {e}"
        log(f"  FAILED: {e}")
        save_state(st)
        return
    d = CACHE / "jrc-gsw"
    S["items"] = ix["items"]
    occ = warp_mosaic([d / f for f in ix["files"]["occurrence"]], tr, shape, Resampling.bilinear, np.float32, -1.0, 255)
    occ8 = np.where(occ < 0, 255, np.clip(np.round(occ), 0, 100)).astype(np.uint8)
    write_tif(WORK / "gsw_occurrence_30m.tif", occ8, tr, 255)
    ext = warp_mosaic([d / f for f in ix["files"]["extent"]], tr, shape, Resampling.nearest, np.uint8, 255, 255)
    write_tif(WORK / "gsw_extent_30m.tif", ext, tr, 255)
    S["occurrence_valid_pct"] = round(float((occ8 != 255).mean() * 100), 2)
    S["extent_water_km2"] = round(float((ext == 1).sum() * 900 / 1e6), 2)
    S["occ_ge50_km2"] = round(float(((occ8 >= 50) & (occ8 <= 100)).sum() * 900 / 1e6), 2)
    # web: scene grid
    str_, sshape, _g = scene_grid(cfg)
    occw = warp_mosaic([d / f for f in ix["files"]["occurrence"]], str_, sshape, Resampling.average, np.float32, -1.0, 255)
    png = np.where(occw < 0, 0, np.round(np.clip(occw, 0, 100) * 2.55)).astype(np.uint8)
    p = bnd.out / "water" / "gsw_occurrence.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(png, "L").save(p, optimize=True)
    st.setdefault("web", {})["gsw_occurrence"] = {"file": str(p.relative_to(ROOT)).replace("\\", "/"), "bytes": fsize(p)}
    bnd.register(id="gsw_occurrence", kind="mask", grid="scene", file="water/gsw_occurrence.png",
                 label="Surface-water occurrence 1984–2020 (JRC GSW)", badge="MEASURED",
                 source="Source: EC JRC/Google — Global Surface Water v1.3 1984–2020 (Pekel et al. 2016) via Microsoft Planetary Computer",
                 method=f"occurrence mosaic of {', '.join(ix['items'])} → scene grid (area average); "
                        "pixel = round(occurrence % × 2.55), 0 = never water or no data",
                 uncertainty="Landsat 30 m monthly history; occurrence is a long-term frequency, not the 2026 state; "
                             "small/narrow water is under-detected",
                 encoding=dict(type="r8", min=0, max=100, scale=round(100 / 255, 6), offset=0))
    log(f"  occurrence valid {S['occurrence_valid_pct']}% · extent {S['extent_water_km2']} km² · PNG {fsize(p) / 1e3:.0f} kB")
    save_state(st)


def step_worldcover(cfg, st, bnd: Bundle):
    log("== ESA WorldCover 2021 v200")
    import rasterio
    from PIL import Image
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.warp import transform_bounds
    S = st.setdefault("worldcover", {})
    S["accessed"] = dt.date.today().isoformat()
    tr, shape, _ = analysis_grid()
    try:
        ix = pc_cached_windows("esa-worldcover", ["map"], grid_lonlat_bbox(tr, shape), CACHE / "esa-worldcover",
                               datetime="2021-01-01/2021-12-31")
    except Exception as e:  # noqa: BLE001
        S["failure"] = f"{type(e).__name__}: {e}"
        log(f"  FAILED: {e}")
        save_state(st)
        return
    d = CACHE / "esa-worldcover"
    files = [d / f for f in ix["files"]["map"]]
    S["items"] = ix["items"]
    S["versions"] = sorted({str(v.get("esa_worldcover:product_version", "?")) for v in ix["properties"].values()})
    cmap = {k: tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,) for k, (_, h) in WORLDCOVER.items()}
    # 10 m valley (EPSG:32632, 10 m grid aligned to multiples of 10 m)
    vb = [8.55, 36.20, 9.50, 36.70]
    l, b, r, t = transform_bounds(4326, CRS, *vb, densify_pts=21)
    l, b, r, t = math.floor(l / 10) * 10, math.floor(b / 10) * 10, math.ceil(r / 10) * 10, math.ceil(t / 10) * 10
    tr10 = from_origin(l, t, 10, 10)
    sh10 = (int((t - b) / 10), int((r - l) / 10))
    wc10 = warp_mosaic(files, tr10, sh10, Resampling.nearest, np.uint8, 0, 0)
    write_tif(WORK / "worldcover_10m_valley.tif", wc10, tr10, 0, cmap)
    wc30 = warp_mosaic(files, tr, shape, Resampling.mode, np.uint8, 0, 0)
    write_tif(WORK / "worldcover_30m.tif", wc30, tr, 0, cmap)
    vals, cnt = np.unique(wc30, return_counts=True)
    S["classes_km2_30m"] = {WORLDCOVER.get(int(v), ("nodata",))[0]: round(float(c * 900 / 1e6), 1) for v, c in zip(vals, cnt)}
    S["grid_10m"] = dict(shape=list(sh10), bounds_m=[l, b, r, t])
    # web palette PNG on the scene grid: pixel value = WorldCover class code
    str_, sshape, _g = scene_grid(cfg)
    wcs = warp_mosaic(files, str_, sshape, Resampling.mode, np.uint8, 0, 0)
    pal = [0] * 768
    for k, (_, h) in WORLDCOVER.items():
        pal[3 * k:3 * k + 3] = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    img = Image.fromarray(wcs, "P")
    img.putpalette(pal)
    p = bnd.out / "landcover" / "worldcover.png"
    p.parent.mkdir(parents=True, exist_ok=True)
    img.save(p, optimize=True, transparency=0)
    st.setdefault("web", {})["worldcover"] = {"file": str(p.relative_to(ROOT)).replace("\\", "/"), "bytes": fsize(p)}
    bnd.register(id="worldcover", kind="other", grid="scene", file="landcover/worldcover.png",
                 label="Land cover 2021 (ESA WorldCover)", sensor="WorldCover", badge="MEASURED",
                 source="ESA WorldCover 10 m 2021 v200 (Zanaga et al. 2022), © ESA WorldCover project / contains "
                        "modified Copernicus Sentinel data (2021), via Microsoft Planetary Computer",
                 method=f"map mosaic of {', '.join(ix['items'])} → scene grid (MODE). Palette PNG: pixel value = class "
                        "code (10 tree, 20 shrub, 30 grass, 40 cropland, 50 built-up, 60 bare, 80 water, 90 wetland); "
                        "0 = no data (transparent); official WorldCover colours",
                 uncertainty="Global map, ~77% overall accuracy (v200 validation); cropland/grassland confusion common "
                             "in semi-arid Tunisia; state of 2021",
                 encoding=dict(type="r8", min=0, max=100))
    log(f"  10 m valley {sh10[1]}×{sh10[0]} · 30 m classes {S['classes_km2_30m']} · PNG {fsize(p) / 1e3:.0f} kB")
    save_state(st)


def step_worldpop(cfg, st, bnd: Bundle):
    log("== WorldPop 2020 constrained (TUN)")
    import rasterio
    from pyproj import Transformer
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    S = st.setdefault("worldpop", {})
    S["accessed"] = dt.date.today().isoformat()
    url = cfg["context"]["sources"]["worldpop"]
    try:
        f = http_download(url, CACHE / "worldpop" / Path(url).name, cfg["context"]["user_agent"])
    except Exception as e:  # noqa: BLE001
        S["failure"] = str(e)
        save_state(st)
        return
    tr, shape, _ = analysis_grid()
    lon0, lat0, lon1, lat1 = cfg["aoi"]["scene"]
    with rasterio.open(f) as src:
        a = src.read(1).astype(np.float64)
        nod = src.nodata
        valid = np.isfinite(a) & (a != nod) & (a >= 0) if nod is not None else np.isfinite(a) & (a >= 0)
        a = np.where(valid, a, 0.0)
        S["total_tunisia"] = round(float(a.sum()))
        # source pixel centres inside aoi.scene
        rows, cols = np.arange(src.height), np.arange(src.width)
        lons = src.transform.c + (cols + 0.5) * src.transform.a
        lats = src.transform.f + (rows + 0.5) * src.transform.e
        inside = ((lats >= lat0) & (lats <= lat1))[:, None] & ((lons >= lon0) & (lons <= lon1))[None, :]
        S["scene_before"] = round(float(a[inside].sum()))
        # people → density (people/m²), using spherical pixel area per row
        R = 6371007.2
        dlon, dlat = math.radians(abs(src.transform.a)), math.radians(abs(src.transform.e))
        area_row = (R ** 2) * dlon * np.abs(np.sin(np.radians(lats + abs(src.transform.e) / 2)) -
                                            np.sin(np.radians(lats - abs(src.transform.e) / 2)))
        dens = (a / area_row[:, None]).astype(np.float32)
        dst = np.zeros(shape, np.float32)
        reproject(dens, dst, src_transform=src.transform, src_crs=src.crs, src_nodata=None, dst_transform=tr,
                  dst_crs=CRS, dst_nodata=None, resampling=Resampling.average)
        src_crs = src.crs
    pop = dst * 900.0                                   # 30 m × 30 m UTM cell (scale-factor area error < 0.1%)
    # destination cells whose centres are inside aoi.scene
    h, w = shape
    xs = tr.c + (np.arange(w) + 0.5) * tr.a
    ys = tr.f + (np.arange(h) + 0.5) * tr.e
    tf = Transformer.from_crs(CRS, 4326, always_xy=True)
    X, Y = np.meshgrid(xs, ys)
    LON, LAT = tf.transform(X, Y)
    ins = (LON >= lon0) & (LON <= lon1) & (LAT >= lat0) & (LAT <= lat1)
    S["scene_after"] = round(float(pop[ins].sum()))
    S["grid_total_after"] = round(float(pop.sum()))
    S["scene_diff_pct"] = round((S["scene_after"] - S["scene_before"]) / max(S["scene_before"], 1) * 100, 3)
    S["sum_preserved"] = abs(S["scene_diff_pct"]) <= 2.0
    # mask outside Tunisia (WorldPop TUN covers Tunisia only) if the TUN ADM0 polygon is available
    out_nodata = -1.0
    tun = CTX / "tun_adm0.gpkg"
    if tun.exists():
        import geopandas as gpd
        from rasterio.features import geometry_mask
        poly = gpd.read_file(tun).to_crs(CRS).union_all().buffer(500)
        outside = geometry_mask([poly], out_shape=shape, transform=tr, invert=False)
        S["pop_outside_tun_masked"] = round(float(pop[outside].sum()), 1)
        pop = np.where(outside, out_nodata, pop).astype(np.float32)
        S["mask"] = "cells > 500 m outside geoBoundaries TUN ADM0 set to nodata (-1): WorldPop TUN does not cover Algeria"
    write_tif(WORK / "pop_30m.tif", pop.astype(np.float32), tr, out_nodata)
    S["src_crs"] = str(src_crs)
    log(f"  scene total before {S['scene_before']:,} · after {S['scene_after']:,} ({S['scene_diff_pct']:+.3f}%) · "
        f"Tunisia {S['total_tunisia']:,}")
    save_state(st)


# ================================================================================================ checks + report
def step_checks(cfg, st):
    log("== checks")
    import geopandas as gpd
    from shapely.geometry import box
    C_ = st["checks"] = {}
    dam = dam_point_utm(cfg)

    def rd(n):
        p = CTX / f"{n}.gpkg"
        return gpd.read_file(p) if p.exists() else None

    v = rd("villages")
    if v is not None:
        targets = {"Nebeur": ["nebeur", "nebber", "nebbeur", "نبر"], "Jendouba": ["jendouba", "jandouba", "جندوبة"],
                   "Bou Salem": ["bousalem", "boussalem", "bouselem", "بوسالم"]}
        res = {}
        for k, keys in targets.items():
            hit = v[[name_match(r, keys, exact=True) for _, r in v.iterrows()]]
            if not len(hit):
                hit = v[[name_match(r, keys) for _, r in v.iterrows()]]
            res[k] = dict(found=bool(len(hit)), matches=[f"{r['name']} ({r['place']}, {r['osm_id']})" for _, r in hit.head(3).iterrows()])
        C_["villages"] = res
    d, wb, rs = rd("dams"), rd("waterbodies"), rd("reservoirs")
    if d is not None:
        dist = d.distance(dam)
        k = dist.idxmin()
        C_["dam_nearest_osm_dam"] = dict(dist_m=round(float(dist[k]), 1), osm_id=d.at[k, "osm_id"], name=d.at[k, "name"],
                                         name_fr=d.at[k, "name_fr"], geom_type=d.geometry[k].geom_type,
                                         waterway=d.at[k, "waterway"], man_made=d.at[k, "man_made"])
        near = d[dist < 1500]
        C_["dams_within_1500m"] = [dict(osm_id=r["osm_id"], name=r["name"], geom=r.geometry.geom_type,
                                        waterway=r["waterway"], man_made=r["man_made"], dist_m=round(float(dist[i]), 1))
                                   for i, r in near.iterrows()]
    polys = [g for g in (wb, rs) if g is not None]
    if polys:
        allp = gpd.GeoDataFrame(pd_concat(polys), crs=CRS).drop_duplicates("osm_id")
        mel = allp[[name_match(r, ["mellegue", "mellag", "ملاق", "ملاڨ"]) for _, r in allp.iterrows()]]
        lake = box(*__import__("shapely").ops.transform(lambda x, y: (x, y), lonlat_box_utm(cfg["aoi"]["lake"])).bounds)
        inlake = allp[allp.intersects(lake)].sort_values("area_km2", ascending=False)
        C_["mellegue_reservoir_named"] = [dict(osm_id=r["osm_id"], name=r["name"], area_km2=round(float(r["area_km2"]), 3),
                                               dist_m=round(float(r.geometry.distance(dam)), 1)) for _, r in mel.iterrows()]
        C_["reservoir_in_lake_box"] = [dict(osm_id=r["osm_id"], name=r["name"], area_km2=round(float(r["area_km2"]), 3),
                                            dist_m=round(float(r.geometry.distance(dam)), 1)) for _, r in inlake.head(3).iterrows()]
        dd = [C_.get("dam_nearest_osm_dam", {}).get("dist_m", 1e9)] + [x["dist_m"] for x in C_["mellegue_reservoir_named"]] \
            + [x["dist_m"] for x in C_["reservoir_in_lake_box"][:1]]
        C_["dam_point_within_500m"] = bool(min(dd) <= 500)
        ss = allp[[name_match(r, ["sidisalem", "سيديسالم"]) for _, r in allp.iterrows()]]
        C_["sidi_salem_reservoir"] = [dict(osm_id=r["osm_id"], name=r["name"], area_km2=round(float(r["area_km2"]), 2))
                                      for _, r in ss.sort_values("area_km2", ascending=False).iterrows()]
        C_["sidi_salem_found"] = bool(len(ss))
    r = rd("hydrorivers")
    if r is not None:
        big = r[r["UPLAND_SKM"] >= 1000]
        dist = big.distance(dam)
        k = dist.idxmin()
        C_["hydrorivers_main_stem"] = dict(dist_m=round(float(dist[k]), 1), hyriv_id=int(big.at[k, "HYRIV_ID"]),
                                           upland_skm=float(big.at[k, "UPLAND_SKM"]), ord_stra=int(big.at[k, "ORD_STRA"]),
                                           main_riv=int(big.at[k, "MAIN_RIV"]), dis_av_cms=float(big.at[k, "DIS_AV_CMS"]))
    # ---- MISSING probes
    M = C_["missing"] = {}
    pm = rd("probe_mellegue")
    cat = rd("catchment_mellegue")
    if pm is not None:
        def plain(r):
            t = unicodedata.normalize("NFKD", " ".join(names_of(r)))
            return "".join(c for c in t if not unicodedata.combining(c)).lower()

        def is_mel(r):
            return bool(re.search(r"mell?[eé]?gue|mellag|(?<!ع)ملا[قڨ]", plain(r)))

        def is_upper(r):
            return is_mel(r) and bool(re.search(r"amont|haut|upper|sup[eé]rieur|2|ii|علوي|الأعلى|اعلى", plain(r)))
        up = pm[[is_upper(rr) for _, rr in pm.iterrows()]]
        constr = pm[pm["construction"].notna() | pm["proposed"].notna()]
        # any OSM dam/reservoir inside the Mellègue catchment upstream of the old dam (Tunisian side)
        cands = []
        if cat is not None and d is not None:
            cpoly = cat.geometry.iloc[0]
            for gdf, kind in ((d, "dam"), (rs, "reservoir")):
                if gdf is None:
                    continue
                sel = gdf[gdf.intersects(cpoly) & (gdf.distance(dam) > 2000)]
                for _, rr in sel.iterrows():
                    cands.append(dict(kind=kind, osm_id=rr["osm_id"], name=rr.get("name"), geom=rr.geometry.geom_type,
                                      area_km2=round(float(rr["area_km2"]), 3) if "area_km2" in rr and rr["area_km2"] == rr["area_km2"] else None,
                                      dist_km=round(float(rr.geometry.distance(dam)) / 1000, 1)))
        M["upper_mellegue"] = dict(found=bool(len(up)),
                                   named_features=[dict(osm_id=rr["osm_id"], name=rr["name"], geom=rr.geometry.geom_type)
                                                   for _, rr in up.iterrows()],
                                   construction_or_proposed=[dict(osm_id=rr["osm_id"], name=rr["name"],
                                                                  construction=rr["construction"], proposed=rr["proposed"])
                                                             for _, rr in constr.iterrows()],
                                   dams_reservoirs_in_catchment_upstream=sorted(cands, key=lambda x: -(x["area_km2"] or 0))[:15],
                                   all_mellegue_named=[dict(osm_id=rr["osm_id"], name=rr["name"], name_fr=rr["name_fr"],
                                                            geom=rr.geometry.geom_type, waterway=rr["waterway"],
                                                            natural=rr["natural"], man_made=rr["man_made"])
                                                       for _, rr in pm[[is_mel(rr) for _, rr in pm.iterrows()]].iterrows()][:30])
    pi = rd("probe_irrigation")
    if pi is not None:
        pu = pi.copy()
        pu["area_km2"] = pu.area / 1e6
        irr = pu[pu["irrigation"].notna() | (pu["landuse"] == "irrigation")]
        named = pu[[bool(re.search(r"rim[eè]tre|irrig|ppi|سقوي", " ".join(names_of(rr)), re.I)) for _, rr in pu.iterrows()]]
        farm = pu[pu["landuse"] == "farmland"]
        M["jendouba_irrigated_perimeter"] = dict(
            found=bool(len(irr) or len(named)),
            irrigation_tagged=dict(count=int(len(irr)), area_km2=round(float(irr["area_km2"].sum()), 2)),
            named_perimeters=[dict(osm_id=rr["osm_id"], name=rr["name"], area_km2=round(float(rr["area_km2"]), 2))
                              for _, rr in named.head(10).iterrows()],
            farmland_polygons=dict(count=int(len(farm)), area_km2=round(float(farm["area_km2"].sum()), 1)))
    if d is not None:
        crest = d[(d["waterway"] == "dam") & d.geom_type.isin(["LineString", "MultiLineString", "Polygon", "MultiPolygon"])
                  & (d.distance(dam) <= 1000)]
        M["mellegue_dam_crest"] = dict(found=bool(len(crest)),
                                       features=[dict(osm_id=rr["osm_id"], name=rr["name"], geom=rr.geometry.geom_type,
                                                      length_m=round(float(rr.geometry.length), 1),
                                                      dist_m=round(float(rr.geometry.distance(dam)), 1))
                                                 for _, rr in crest.iterrows()],
                                       other_dam_features_within_1km=[dict(osm_id=rr["osm_id"], geom=rr.geometry.geom_type,
                                                                           man_made=rr["man_made"], waterway=rr["waterway"])
                                                                      for _, rr in d[(d.distance(dam) <= 1000)].iterrows()])
    web = st.get("web", {})
    vec = {k: v for k, v in web.items() if str(v.get("file", "")).endswith(".geojson")}
    C_["web_vectors_bytes"] = int(sum(fsize(ROOT / v["file"]) for v in vec.values()))
    C_["web_vectors_ok"] = C_["web_vectors_bytes"] <= 2.5e6
    save_state(st)
    log(json.dumps(C_, indent=1, ensure_ascii=False, default=str)[:6000])


def ok(b):
    return "PASS" if b else "FAIL"


def step_report(cfg, st):
    L = [f"# Context data report (00_context_data.py)", "",
         f"Generated {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}. All vectors in EPSG:32632; "
         "rasters on the analysis grid of work/dem_32632_30m.tif unless noted.", ""]
    L += ["## Layers (analysis, work/context/*.gpkg)", "", "| layer | features | size | notes |", "|---|---:|---:|---|"]
    for k, v in st.get("osm", {}).get("layers", {}).items():
        notes = {kk: vv for kk, vv in v.items() if kk not in ("count", "gpkg", "bytes")}
        L.append(f"| {k} (OSM) | {v['count']:,} | {v['bytes'] / 1e6:.2f} MB | {json.dumps(notes, ensure_ascii=False) if notes else ''} |")
    for k, v in st.get("boundaries", {}).get("layers", {}).items():
        L.append(f"| {k} (geoBoundaries) | {v['count']:,} | {v['bytes'] / 1e6:.2f} MB | {('%s km' % v['km']) if 'km' in v else ''} |")
    H = st.get("hydrosheds", {})
    if "rivers" in H:
        L.append(f"| hydrorivers | {H['rivers']['count']:,} | {H['rivers']['bytes'] / 1e6:.2f} MB | clipped to hydro_bbox |")
        L.append(f"| basins_lev06 / lev07 | {H.get('basins_lev06')} / {H.get('basins_lev07')} | | clipped to hydro_bbox |")
    L += ["", "## Rasters", ""]
    for p in ("gsw_occurrence_30m.tif", "gsw_extent_30m.tif", "worldcover_10m_valley.tif", "worldcover_30m.tif", "pop_30m.tif"):
        L.append(f"- work/{p}: {fsize(WORK / p) / 1e6:.2f} MB" if (WORK / p).exists() else f"- work/{p}: **missing**")
    G, W, P = st.get("gsw", {}), st.get("worldcover", {}), st.get("worldpop", {})
    if G:
        L.append(f"- GSW items {G.get('items')}; occurrence valid {G.get('occurrence_valid_pct')}% of grid; "
                 f"max-extent water {G.get('extent_water_km2')} km²; occurrence ≥ 50% {G.get('occ_ge50_km2')} km² {G.get('failure', '')}")
    if W:
        L.append(f"- WorldCover items {W.get('items')} (version {W.get('versions')}); 30 m class areas (km², analysis grid): "
                 f"{json.dumps(W.get('classes_km2_30m'), ensure_ascii=False)} {W.get('failure', '')}")
    if P:
        L.append(f"- WorldPop: Tunisia total {P.get('total_tunisia'):,}; **aoi.scene before {P.get('scene_before'):,} → after "
                 f"{P.get('scene_after'):,} ({P.get('scene_diff_pct'):+.3f}%)** {ok(P.get('sum_preserved'))}; "
                 f"whole analysis grid {P.get('grid_total_after'):,}. {P.get('mask', '')} (population in masked cells "
                 f"{P.get('pop_outside_tun_masked')})")
    L += ["", "## Catchments (HydroBASINS lev12 + HydroRIVERS)", ""]
    for k in ("catchment_mellegue", "catchment_sidi_salem"):
        c = H.get(k)
        if not c:
            continue
        L.append(f"**{c.get('label', k)}**: area **{c.get('area_km2_polygon_utm32')} km²** (dissolved polygon, EPSG:32632); "
                 f"Σ SUB_AREA {c.get('area_km2_sum_sub_area')} km²; outlet basin UP_AREA {c.get('outlet_up_area_km2')} km²; "
                 f"{c.get('n_basins')} lev-12 basins; outlet HYBAS_ID {c.get('outlet_hybas_id')} (method {c.get('method')}); "
                 f"bounds {c.get('bounds_lonlat')}; touches read bbox: {c.get('touches_read_bbox')}.")
        if "snap" in c:
            s = c["snap"]
            L.append(f"  - snapped to HydroRIVERS reach {s['hyriv_id']} at {s['dist_m']} m (UPLAND_SKM {s['upland_skm']}, "
                     f"ORD_STRA {s['ord_stra']}, DIS_AV_CMS {s['dis_av_cms']})")
        if "containing_basin" in c:
            cb = c["containing_basin"]
            L.append(f"  - alternative (lev-12 basin containing the point, {cb['hybas_id']}): UP_AREA {cb['up_area_km2']} km², "
                     f"Σ SUB_AREA {cb['sum_sub_area_km2']} km²")
        if "dam_point_source" in c:
            L.append(f"  - dam point used: {c['dam_point_lonlat']} from {c['dam_point_source']}")
        if "error" in c:
            L.append(f"  - ERROR: {c['error']}")
        hb = cfg["context"]["hydro_bbox"]
        cb = c.get("bounds_lonlat")
        if cb and (cb[0] < hb[0] or cb[1] < hb[1] or cb[2] > hb[2] or cb[3] > hb[3]):
            L.append(f"  - NOTE: catchment extends beyond context.hydro_bbox {hb} (polygon is complete — read from a "
                     "larger window — but HydroRIVERS and the lev06/07 outlines are clipped to hydro_bbox, so a sliver "
                     "of the upper Mellègue headwaters is missing from those two layers)")
    CK = st.get("checks", {})
    L += ["", "## Checks", ""]
    for k, v in CK.get("villages", {}).items():
        L.append(f"- village **{k}**: {ok(v['found'])} {v['matches']}")
    if "dam_nearest_osm_dam" in CK:
        n = CK["dam_nearest_osm_dam"]
        L.append(f"- config dam point → nearest OSM dam {n['osm_id']} ({n['name'] or n['name_fr']}, {n['geom_type']}, "
                 f"waterway={n['waterway']}, man_made={n['man_made']}): **{n['dist_m']} m**")
        L.append(f"- OSM reservoirs named Mellègue: {CK.get('mellegue_reservoir_named')}; largest OSM water polygon in "
                 f"aoi.lake: {CK.get('reservoir_in_lake_box', [])[:1]}")
        L.append(f"- dam point within 500 m of an OSM dam or the Mellègue reservoir polygon: **{ok(CK.get('dam_point_within_500m'))}**")
    if "sidi_salem_found" in CK:
        L.append(f"- Sidi Salem reservoir found: **{ok(CK['sidi_salem_found'])}** {CK['sidi_salem_reservoir'][:2]}")
    if "hydrorivers_main_stem" in CK:
        h = CK["hydrorivers_main_stem"]
        L.append(f"- HydroRIVERS main stem (UPLAND ≥ 1000 km²) nearest the dam: **{h['dist_m']} m** (reach {h['hyriv_id']}, "
                 f"UPLAND_SKM {h['upland_skm']}, ORD_STRA {h['ord_stra']}, DIS_AV_CMS {h['dis_av_cms']})")
    if "web_vectors_bytes" in CK:
        L.append(f"- total web vectors: **{CK['web_vectors_bytes'] / 1e6:.2f} MB** (target ≤ 2.5 MB) {ok(CK['web_vectors_ok'])}")
    L += ["", "## Web files", "", "| file | features | size |", "|---|---:|---:|"]
    for k, v in st.get("web", {}).items():
        L.append(f"| {v['file']} | {v.get('features', '')} | {fsize(ROOT / v['file']) / 1e3:.0f} kB |")
    L += ["", "## MISSING list", ""]
    M = CK.get("missing", {})
    um = M.get("upper_mellegue", {})
    L.append(f"**(a) Upper Mellègue dam (Mellègue amont / Haut Mellègue / Mellègue 2)**: {'FOUND' if um.get('found') else 'NOT FOUND'} in OSM by name.")
    L.append(f"  - named features: {um.get('named_features')}")
    L.append(f"  - construction/proposed dam features in hydro_bbox: {um.get('construction_or_proposed')}")
    L.append(f"  - other OSM dams/reservoirs inside the Mellègue catchment > 2 km from the old dam: {um.get('dams_reservoirs_in_catchment_upstream')}")
    L.append(f"  - all OSM features named Mellègue: {um.get('all_mellegue_named')}")
    ip = M.get("jendouba_irrigated_perimeter", {})
    L.append(f"**(b) Jendouba irrigated perimeter**: {'FOUND' if ip.get('found') else 'NOT FOUND'} "
             f"(irrigation-tagged {ip.get('irrigation_tagged')}; named perimeters {ip.get('named_perimeters')}; "
             f"generic landuse=farmland {ip.get('farmland_polygons')}).")
    cr = M.get("mellegue_dam_crest", {})
    L.append(f"**(c) Mellègue dam crest line (waterway=dam ≤ 1 km)**: {'FOUND' if cr.get('found') else 'NOT FOUND'} "
             f"{cr.get('features')}; other dam features ≤ 1 km: {cr.get('other_dam_features_within_1km')}")
    L += ["", "### What to draw in QGIS (save as GeoJSON in geojson_data/, EPSG:4326 or 32632, with name/status/source "
          "properties)", ""]
    if not um.get("found"):
        L.append("- **(a) Upper Mellègue dam — missing.** Draw (1) a *LineString* along the dam crest/axis across Oued "
                 "Mellègue and (2) a *Polygon* of the reservoir at full supply level (195–200 Mm³ per press). Location: on "
                 "the Mellègue upstream (south-west) of the 1954 dam, between the old dam and the "
                 "Algerian border. The exact site is not known to this pipeline: take it from the ministry/press sources "
                 "(docs/01, webdo.tn/?p=396788) and confirm on recent Sentinel-2 imagery (a dam reported >98% complete in June 2026 "
                 "should be identifiable). OSM has no feature with that name nor any "
                 "construction/proposed dam in hydro_bbox; the unnamed reservoirs listed above are not identified as it "
                 "(the largest, w1571532494, 1.7 km² at 8.466 E 35.829 N, is ~57 km from the old dam).")
    if not ip.get("found"):
        L.append("- **(b) Jendouba irrigated perimeter — missing.** Draw a *Polygon/MultiPolygon* of the public irrigated "
                 "perimeter(s) (PPI) in the Medjerda/Mellègue plain around Jendouba and Bou Salem (roughly "
                 "8.65–9.15 E, 36.42–36.55 N), from CRDA Jendouba / ministry maps, with name and area_ha. OSM only has "
                 f"{ip.get('farmland_polygons', {}).get('count')} generic landuse=farmland polygons "
                 f"({ip.get('farmland_polygons', {}).get('area_km2')} km²) in the valley bbox, none tagged irrigation.")
    if cr.get("found"):
        L.append("- **(c) Mellègue dam crest — present in OSM** (waterway=dam). Nothing to draw; optionally check on "
                 "imagery that the mapped line matches the crest (its length may include abutments/spillway).")
    else:
        L.append("- **(c) Mellègue dam crest — missing.** Draw a *LineString* along the crest at the config dam point "
                 "(8.7026 E, 36.3142 N), traced from imagery.")
    fails = st.get("osm", {}).get("failures", []) + st.get("boundaries", {}).get("failures", []) + \
        st.get("hydrosheds", {}).get("failures", []) + [st[k]["failure"] for k in ("gsw", "worldcover", "worldpop")
                                                         if st.get(k, {}).get("failure")] +         [f"step {k}: {v}" for k, v in st.get("step_errors", {}).items()]
    L += ["", "## Failures", ""] + ([f"- {f}" for f in fails] or ["- none"])
    CTX.mkdir(parents=True, exist_ok=True)
    (CTX / "report.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    log(f"wrote {(CTX / 'report.md').relative_to(ROOT)}")


def step_sources(cfg, st, bnd: Bundle):
    """Refresh story/sources.json from 08_bundle.SOURCES (same as the fixture writer does)."""
    bnd.b.write_json(bnd.out / C.BUNDLE_PATHS["sources"], C.Sources(sources=bnd.b.SOURCES), force=True)


STEPS = ["osm", "boundaries", "hydrosheds", "gsw", "worldcover", "worldpop", "checks", "report"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=common.ROOT / "config.yaml")
    ap.add_argument("--only", choices=STEPS, action="append", help="run only these steps (repeatable)")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    bnd = Bundle(cfg)
    st = load_state()
    todo = args.only or STEPS
    fn = dict(osm=lambda: step_osm(cfg, st, bnd), boundaries=lambda: step_boundaries(cfg, st, bnd),
              hydrosheds=lambda: step_hydrosheds(cfg, st, bnd), gsw=lambda: step_gsw(cfg, st, bnd),
              worldcover=lambda: step_worldcover(cfg, st, bnd), worldpop=lambda: step_worldpop(cfg, st, bnd),
              checks=lambda: step_checks(cfg, st), report=lambda: step_report(cfg, st))
    rc = 0
    RUN_KEYS.update(todo)
    st.pop("step_errors", None) if set(todo) == set(STEPS) else None
    for s in STEPS:
        if s not in todo:
            continue
        try:
            fn[s]()
        except Exception as e:  # noqa: BLE001  (continue with the other sources, report the failure)
            import traceback
            traceback.print_exc()
            st.setdefault("step_errors", {})[s] = f"{type(e).__name__}: {e}"
            save_state(st)
            rc = 1
    step_sources(cfg, st, bnd)
    if "report" not in todo:
        step_report(cfg, st)
    return rc


if __name__ == "__main__":
    sys.exit(main())
