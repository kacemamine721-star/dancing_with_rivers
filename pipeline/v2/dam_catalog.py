"""V2 dam catalogue for the "Dancing with your Dam" page.

Builds a static catalogue of the real reservoirs of Tunisia from OpenStreetMap + HydroSHEDS + the NISAR product
inventory. For every dam: crest point, names, reservoir polygon, upstream catchment (HydroBASINS lev-12), downstream
HydroRIVERS path to the sea / the border / the next catalogued dam, upstream river network, towns along the path and
the number of NISAR GCOV acquisitions whose footprint covers the dam. Nothing is invented: unknown → null.

Inputs (read-only):
  <main>/work/context/*.gpkg            fallback OSM dams / reservoirs / villages (northern Tunisia only)
  <main>/cache/context/hydrosheds/*.zip HydroRIVERS v1.0 + HydroBASINS v1c (Africa)
  <main>/cache/context/geoboundaries/   TUN ADM0 / ADM1
  <main>/TESTS/nisar_tunisia_output/footprints.geojson  NISAR product footprints (ASF search, Tunisia)
  <worktree>/cache/v2/osm/*.json        Overpass extracts for the whole of Tunisia (fetched with --fetch-osm)

Outputs: apps/web/public/v2/dams/index.json, apps/web/public/v2/dams/<id>.geojson, apps/web/public/v2/tunisia.geojson,
work/v2/catalog_qa.png, work/v2/catalog_provenance.json.

Usage: python pipeline/v2/dam_catalog.py --config config.yaml [--main-repo ../NASA_CHALLENGE] [--fetch-osm] [--qa]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
import time
import unicodedata
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402,F401  (PROJ guard first: before geopandas / pyproj)

import geopandas as gpd  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402
from shapely.geometry import LineString, MultiLineString, Point, Polygon, mapping, shape  # noqa: E402
from shapely.ops import linemerge, polygonize, substring, unary_union  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CRS = 32632
READ_BB = (5.5, 29.8, 12.2, 38.0)  # Tunisia + the Algerian headwaters of the Medjerda / Mellègue
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = "osm-research-client/0.1"
RIV_PAT = r"HydroRIVERS_v10_af.shp$"
BAS_PAT = r"hybas_af_lev12_v1c.shp$"
LATIN_DAM = re.compile(r"barrage|dam\b|\bsd\b", re.I)
AR_DAM = re.compile(r"سد|سدّ")
NATURAL_LAKES = r"ichkeul|sud de tunis|nord de tunis|lac de tunis|lagune|lagoon|sebkh|chott|garaa|bahiret|سبخة|شط|إشكل|اشكل|تونس الجنوبية|تونس الشمالية"
BAD_WATER = {"lagoon", "salt", "salt_pool", "river", "oxbow", "canal", "wastewater", "stream", "ditch", "salt_lake",
             "sebkha", "fishpond", "pond", "basin", "lock", "moat"}


def log(m):
    print(m, flush=True)


# ------------------------------------------------------------------------------------------------ OSM
def overpass_fetch(name: str, body: str, out: str, cache: Path):
    import requests
    p = cache / f"{name}.json"
    if p.exists():
        try:
            js = json.loads(p.read_text(encoding="utf-8"))
            if "elements" in js:
                return js
        except json.JSONDecodeError:
            pass
    q = f'[out:json][timeout:240];area["ISO3166-1"="TN"][admin_level=2]->.a;{body}out {out};'
    for url in OVERPASS:
        for wait in (0, 20, 60):
            time.sleep(wait)
            try:
                r = requests.post(url, data={"data": q}, headers={"User-Agent": UA}, timeout=300)
                if r.status_code == 200 and r.text.lstrip().startswith("{"):
                    js = r.json()
                    if "runtime error" not in js.get("remark", "").lower():
                        cache.mkdir(parents=True, exist_ok=True)
                        p.write_text(json.dumps(js, ensure_ascii=False), encoding="utf-8")
                        log(f"  overpass {name}: {len(js['elements'])} elements")
                        return js
                log(f"  overpass {name}: HTTP {r.status_code} from {url}")
            except Exception as e:  # noqa: BLE001
                log(f"  overpass {name}: {type(e).__name__}")
    return None


def el_geom(e):
    if e["type"] == "node":
        return Point(e["lon"], e["lat"])
    if e["type"] == "way":
        if "geometry" in e:
            cs = [(g["lon"], g["lat"]) for g in e["geometry"] if g]
        elif "center" in e:
            return Point(e["center"]["lon"], e["center"]["lat"])
        else:
            return None
        if len(cs) >= 4 and cs[0] == cs[-1]:
            return Polygon(cs)
        return LineString(cs) if len(cs) >= 2 else None
    if e["type"] == "relation":
        if "center" in e and "members" not in e:
            return Point(e["center"]["lon"], e["center"]["lat"])
        lines = []
        for m in e.get("members", []):
            if m.get("type") == "way" and m.get("geometry") and m.get("role", "outer") in ("outer", ""):
                cs = [(g["lon"], g["lat"]) for g in m["geometry"] if g]
                if len(cs) >= 2:
                    lines.append(LineString(cs))
        if not lines:
            return Point(e["center"]["lon"], e["center"]["lat"]) if "center" in e else None
        u = unary_union(lines)
        polys = list(polygonize(u))
        if polys:
            return unary_union(polys)
        return linemerge(u) if u.geom_type == "MultiLineString" else u
    return None


def osm_to_gdf(js, keys):
    rows = []
    for e in js["elements"]:
        g = el_geom(e)
        if g is None or g.is_empty:
            continue
        t = e.get("tags", {})
        r = {"osm_id": f"{e['type'][0]}{e['id']}", "geometry": g}
        for k in keys:
            r[k.replace(":", "_")] = t.get(k)
        rows.append(r)
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=4326)


# ------------------------------------------------------------------------------------------------ helpers
def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"^(barrage|dam|lac|retenue)\s+(de\s+|du\s+|d'|el\s+)?", "", s.strip(), flags=re.I)
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s


def is_arabic(s) -> bool:
    return bool(s) and bool(re.search(r"[؀-ۿ]", s))


def clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    v = str(v).strip()
    return v or None


def parse_height(v):
    v = clean(v)
    if not v:
        return None
    m = re.match(r"^\s*([0-9]+(?:[.,][0-9]+)?)\s*(m|metres?|meters?)?\s*$", v)
    return round(float(m.group(1).replace(",", ".")), 1) if m else None


def r5(x):
    return round(float(x), 5)


def round_geom(g):
    """GeoJSON mapping with coordinates rounded to 5 decimals (≈ 1 m)."""
    def rr(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [r5(c[0]), r5(c[1])]
        return [rr(x) for x in c]
    if g.geom_type in ("Polygon", "MultiPolygon"):
        import shapely
        g = shapely.set_precision(g, 1e-5)  # snap-rounding keeps polygons valid at 5 decimals
    m = mapping(g)
    return {"type": m["type"], "coordinates": rr(m["coordinates"])}


def to_ll(g):
    return gpd.GeoSeries([g], crs=CRS).to_crs(4326).iloc[0]


def zip_member(zp: Path, pat: str) -> str:
    with zipfile.ZipFile(zp) as z:
        return next(n for n in z.namelist() if re.search(pat, n, re.I))


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--main-repo", default=str(ROOT.parent / "NASA_CHALLENGE"),
                    help="checkout holding work/context, cache/context and TESTS (read-only)")
    ap.add_argument("--fetch-osm", action="store_true", help="query Overpass for missing Tunisia-wide extracts")
    ap.add_argument("--qa", action="store_true", help="write work/v2/catalog_qa.png")
    ap.add_argument("--min-res-km2", type=float, default=0.2)
    ap.add_argument("--extra", nargs="+", action="append", default=[], metavar="ID LON LAT [CREST]",
                    help="add (or override the nearest entry within 1.5 km with) an explicit dam anywhere: id, point and "
                         "an optional crest GeoJSON. Name / reservoir come from config/dams/<id>.yaml + "
                         "work/v2/<id>/osm_dam.geojson (pipeline/v2/run_dam.py --steps config) when present. Repeatable.")
    a = ap.parse_args()
    cfg = yaml.safe_load((ROOT / a.config).read_text(encoding="utf-8")) if (ROOT / a.config).exists() else \
        yaml.safe_load(Path(a.config).read_text(encoding="utf-8"))
    M = Path(a.main_repo).resolve()
    ctx, hyd, gb = M / "work/context", M / "cache/context/hydrosheds", M / "cache/context/geoboundaries"
    osm_cache = ROOT / "cache/v2/osm"
    work = ROOT / "work/v2"
    work.mkdir(parents=True, exist_ok=True)
    out_dir = ROOT / "apps/web/public/v2"
    (out_dir / "dams").mkdir(parents=True, exist_ok=True)
    inputs: list[Path] = []
    prov = {"script": "pipeline/v2/dam_catalog.py", "inputs": {}, "thresholds": {}}

    # ---- boundaries
    adm0 = gpd.read_file(gb / "TUN_ADM0.geojson").to_crs(CRS)
    adm1 = gpd.read_file(gb / "TUN_ADM1.geojson").to_crs(CRS)
    inputs += [gb / "TUN_ADM0.geojson", gb / "TUN_ADM1.geojson"]
    tun = adm0.union_all()
    tun_in = tun.buffer(1000)

    # ---- OSM: prefer Tunisia-wide extracts, else the northern-Tunisia context layers
    NM = ["name", "name:fr", "name:en", "name:ar"]
    q = {
        "dams_tn": ('(nwr["waterway"="dam"](area.a);nwr["man_made"="dam"](area.a););', "geom"),
        "reservoirs_tn": ('(way["water"="reservoir"](area.a);relation["water"="reservoir"](area.a);'
                          'way["landuse"="reservoir"](area.a);relation["landuse"="reservoir"](area.a);'
                          'way["natural"="water"](area.a);relation["natural"="water"](area.a););', "geom"),
        "places_tn": ('nwr["place"~"^(city|town|village)$"](area.a);', "center"),
        "rivers_tn": ('way["waterway"="river"]["name"](area.a);', "geom"),
    }
    raw = {}
    for k, (body, o) in q.items():
        p = osm_cache / f"{k}.json"
        js = None
        if p.exists():
            try:
                js = json.loads(p.read_text(encoding="utf-8"))
                js = js if "elements" in js else None
            except json.JSONDecodeError:
                js = None
        if js is None and a.fetch_osm:
            js = overpass_fetch(k, body, o, osm_cache)
        if js is not None:
            raw[k] = js
            inputs.append(p)
            prov["inputs"][k] = {"file": f"cache/v2/osm/{k}.json",
                                 "osm_base": js.get("osm3s", {}).get("timestamp_osm_base"), "elements": len(js["elements"])}
    osm_scope = "Tunisia (Overpass area ISO3166-1=TN)"
    if "dams_tn" in raw and "reservoirs_tn" in raw:
        dams = osm_to_gdf(raw["dams_tn"], NM + ["waterway", "man_made", "height", "start_date", "operator"])
        res = osm_to_gdf(raw["reservoirs_tn"], NM + ["water", "landuse", "natural", "salt", "intermittent"])
    else:
        osm_scope = "northern Tunisia only (context.dams_bbox 8.30–11.20 E, 35.80–37.40 N)"
        dams = gpd.read_file(ctx / "dams.gpkg").to_crs(4326)
        res = gpd.read_file(ctx / "reservoirs.gpkg").to_crs(4326)
        inputs += [ctx / "dams.gpkg", ctx / "reservoirs.gpkg"]
    if "places_tn" in raw:
        places = osm_to_gdf(raw["places_tn"], NM + ["place", "population"])
        places_scope = "Tunisia"
    else:
        places = gpd.read_file(ctx / "villages.gpkg").to_crs(4326)
        inputs.append(ctx / "villages.gpkg")
        places_scope = "Mellègue scene only (8.46–9.46 E, 36.10–36.74 N)"
    rivers_osm = osm_to_gdf(raw["rivers_tn"], NM) if "rivers_tn" in raw else None
    prov["osm_scope"], prov["places_scope"] = osm_scope, places_scope
    log(f"OSM: {len(dams)} dam features, {len(res)} water polygons, {len(places)} places ({osm_scope})")

    dams = dams.to_crs(CRS)
    dams = dams[dams.intersects(tun_in)].reset_index(drop=True)
    res = res.to_crs(CRS)
    res = res[res.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    res["geometry"] = res.geometry.make_valid()
    res["area_km2"] = res.area / 1e6
    wt = res.get("water", pd.Series(index=res.index, dtype=object)).fillna("")
    is_res = (wt == "reservoir") | (res.get("landuse", pd.Series(index=res.index, dtype=object)).fillna("") == "reservoir")
    nm_all = (res.get("name", pd.Series(index=res.index, dtype=object)).fillna("") + " " +
              res.get("name_fr", pd.Series(index=res.index, dtype=object)).fillna(""))
    # natural lakes / lagoons / sebkhas are not reservoirs (many real reservoirs are tagged water=lake, so the
    # exclusion is by name: Ichkeul, the Tunis lagoons, sebkhas / chotts / garaas)
    natural = nm_all.str.contains(NATURAL_LAKES, case=False, regex=True)
    res = res[((is_res & ~nm_all.str.contains(NATURAL_LAKES, case=False, regex=True)) | (~wt.isin(BAD_WATER) & ~natural)) & (res.get("salt", pd.Series(index=res.index, dtype=object)).fillna("") != "yes")
              & (res["area_km2"] < 200) & res.intersects(tun_in)].reset_index(drop=True)
    places = places.to_crs(CRS)

    # ---- dam crest point + reservoir match (largest polygon within 500 m)
    sidx = res.sindex
    recs = []
    for i, d in dams.iterrows():
        g = d.geometry
        pt = g.interpolate(0.5, normalized=True) if g.geom_type == "LineString" else \
            (g if g.geom_type == "Point" else g.representative_point())
        cand = list(sidx.query(g.buffer(500), predicate="intersects"))
        k = max(cand, key=lambda c: res.at[c, "area_km2"]) if cand else None
        nm = {f: clean(d.get(f)) for f in ("name", "name_fr", "name_en", "name_ar")}
        rnm = {f: clean(res.at[k, f]) if k is not None and f in res.columns else None
               for f in ("name", "name_fr", "name_en", "name_ar")}
        recs.append(dict(i=i, osm_id=d["osm_id"], pt=pt, geom=g, res_k=k,
                         res_km2=float(res.at[k, "area_km2"]) if k is not None else None,
                         res_osm=res.at[k, "osm_id"] if k is not None else None, nm=nm, rnm=rnm,
                         height=parse_height(d.get("height")), start=clean(d.get("start_date")),
                         length=g.length if g.geom_type == "LineString" else 0.0))

    def has_dam_name(r):
        names = [v for v in r["nm"].values() if v] + [v for v in r["rnm"].values() if v]
        return any(LATIN_DAM.search(n) or AR_DAM.search(n) for n in names)

    keep = [r for r in recs if (has_dam_name(r) and (r["res_km2"] or 0) >= 0.02 or
                                has_dam_name(r) and r["res_k"] is None and any(r["nm"].values()))
            or (r["res_km2"] or 0) >= a.min_res_km2]
    log(f"candidate dam features: {len(keep)} of {len(recs)}")

    # ---- dedupe: one entry per reservoir; reservoir-less dams merged within 1.5 km
    def rank(r):
        return (bool(r["nm"]["name"] or r["nm"]["name_fr"]), has_dam_name(r), r["length"])
    groups: dict = {}
    for r in keep:
        key = r["res_osm"] or None
        if key is None:
            for gk, gl in groups.items():
                if any(x["pt"].distance(r["pt"]) < 1500 for x in gl):
                    key = gk
                    break
            key = key or f"pt:{r['osm_id']}"
        groups.setdefault(key, []).append(r)
    # merge reservoir-less named dams into a reservoir group within 1.5 km (same dam mapped as node + way)
    for gk in [k for k in groups if k.startswith("pt:")]:
        r0 = groups[gk][0]
        best = min((k for k in groups if not k.startswith("pt:")),
                   key=lambda k: min(x["pt"].distance(r0["pt"]) for x in groups[k]), default=None)
        if best and min(x["pt"].distance(r0["pt"]) for x in groups[best]) < 1500:
            groups[best] += groups.pop(gk)
    entries = []
    for gk, gl in groups.items():
        gl = sorted(gl, key=rank, reverse=True)
        main_r = gl[0]
        names = {f: next((x["nm"][f] for x in gl if x["nm"][f]), None) for f in ("name", "name_fr", "name_en", "name_ar")}
        rn = main_r["rnm"]
        entries.append(dict(rec=main_r, all=gl, names=names, rnames=rn,
                            height=next((x["height"] for x in gl if x["height"]), None),
                            start=next((x["start"] for x in gl if x["start"]), None)))

    # ---- names + ids
    mel_pt = gpd.GeoSeries([Point(*cfg["dam"]["lonlat"])], crs=4326).to_crs(CRS).iloc[0]
    mel_e = min(entries, key=lambda e: e["rec"]["pt"].distance(mel_pt))
    prov["mellegue_match_m"] = round(mel_e["rec"]["pt"].distance(mel_pt), 1)
    mel_e["rec"]["pt"] = mel_pt  # v1 dam point (config dam.lonlat, user-checked in QGIS), same snap as v1
    for e in entries:
        n, rn = e["names"], e["rnames"]
        latin = [v for v in (n["name_fr"], n["name_en"], n["name"] if not is_arabic(n["name"]) else None,
                             rn["name_fr"], rn["name_en"], rn["name"] if not is_arabic(rn["name"]) else None) if v]
        arab = next((v for v in (n["name_ar"], n["name"] if is_arabic(n["name"]) else None, rn["name_ar"],
                                 rn["name"] if is_arabic(rn["name"]) else None) if v), None)
        e["name"] = latin[0] if latin else arab
        e["name_ar"] = arab
        e["name_en"] = n["name_en"] or rn["name_en"]
        if e is mel_e:
            e["id"] = "mellegue"
        else:
            s = slugify(latin[0]) if latin else ""
            e["id"] = s if s and s not in ("barrage", "lac", "dam") else f"osm-{e['rec']['osm_id']}"
    # Sidi Salem must be present
    ss = [e for e in entries if e["name"] and re.search(r"sidi\s*salem", e["name"], re.I)
          or (e["name_ar"] and "سيدي سالم" in e["name_ar"])]
    for e in ss:
        if e["rec"]["res_km2"] and e["rec"]["res_km2"] > 10:
            e["id"] = "sidi-salem"
    seen: dict = {}
    for e in sorted(entries, key=lambda e: (-(e["rec"]["res_km2"] or 0), e["rec"]["osm_id"])):
        b = e["id"]
        if b in seen:
            seen[b] += 1
            e["id"] = f"{b}-{seen[b]}"
        else:
            seen[b] = 1
    assert any(e["id"] == "sidi-salem" for e in entries), "Sidi Salem not found in OSM"

    # ---- explicit extra dams (any country): --extra id lon lat [crest.geojson]
    extra_ids = set()
    for ex in a.extra:
        if len(ex) < 3:
            raise SystemExit(f"--extra needs ID LON LAT [CREST], got {ex}")
        xid, xlon, xlat = ex[0], float(ex[1]), float(ex[2])
        dcfg_p = ROOT / "config/dams" / f"{xid}.yaml"
        dcfg = yaml.safe_load(dcfg_p.read_text(encoding="utf-8")).get("dam", {}) if dcfg_p.exists() else {}
        xpt = gpd.GeoSeries([Point(xlon, xlat)], crs=4326).to_crs(CRS).iloc[0]
        crest = None
        if len(ex) > 3:
            for f in json.loads(Path(ex[3]).read_text(encoding="utf-8"))["features"]:
                if f["geometry"]["type"] == "LineString":
                    crest = gpd.GeoSeries([shape(f["geometry"])], crs=4326).to_crs(CRS).iloc[0]
        elif dcfg.get("crest"):
            c = dcfg["crest"]
            cg = shape(c) if isinstance(c, dict) else (LineString(c) if np.ndim(c) == 2 else Polygon(c[0]))
            crest = gpd.GeoSeries([cg], crs=4326).to_crs(CRS).iloc[0]
        osm_dam = dcfg.get("osm_dam")
        hit = min(entries, key=lambda e: e["rec"]["pt"].distance(xpt))
        if hit["rec"]["pt"].distance(xpt) > 1500:
            hit = None
        if hit is None:                               # new entry: reservoir polygon from the run_dam config step
            rk, rkm2, rosm = None, None, None
            od = ROOT / "work/v2" / xid / "osm_dam.geojson"
            if od.exists():
                rf = [f for f in json.loads(od.read_text(encoding="utf-8"))["features"]
                      if f["properties"].get("role") == "reservoir_osm"]
                if rf:
                    rg = gpd.GeoSeries([shape(rf[0]["geometry"])], crs=4326).to_crs(CRS).iloc[0].buffer(0)
                    rosm = rf[0]["properties"].get("source", "OSM ?").split(" ")[1]
                    rk = int(res.index.max()) + 1
                    res = pd.concat([res, gpd.GeoDataFrame([dict(osm_id=rosm, geometry=rg, area_km2=rg.area / 1e6)],
                                                           geometry="geometry", crs=res.crs, index=[rk])])
                    rkm2 = rg.area / 1e6
            nn = {f: None for f in ("name", "name_fr", "name_en", "name_ar")}
            hit = dict(rec=dict(i=None, osm_id=osm_dam or "user", pt=xpt, geom=crest or xpt, res_k=rk, res_km2=rkm2,
                                res_osm=rosm, nm=dict(nn), rnm=dict(nn), height=None, start=None,
                                length=crest.length if crest is not None else 0.0),
                       all=[], names=dict(nn), rnames=dict(nn), height=None, start=None, name_ar=None, name_en=None)
            entries.append(hit)
        hit["id"] = xid
        hit["rec"]["pt"] = xpt
        if osm_dam:
            hit["rec"]["osm_id"] = osm_dam
        hit["name"] = dcfg.get("name") or hit.get("name") or xid
        hit["name_source"] = dcfg.get("name_source") or None
        extra_ids.add(xid)
    prov["extra"] = [dict(id=x[0], lonlat=[float(x[1]), float(x[2])], crest=x[3] if len(x) > 3 else None) for x in a.extra]

    # ---- HydroSHEDS
    hr_cache = work / "hydrorivers_tn.gpkg"
    hb_cache = work / "hybas12_tn.gpkg"
    zr, zb = hyd / "HydroRIVERS_v10_af_shp.zip", hyd / "hybas_af_lev01-12_v1c.zip"
    inputs += [zr, zb]
    if not hr_cache.exists():
        log("reading HydroRIVERS (Africa zip, bbox)…")
        riv = gpd.read_file(f"zip://{zr.as_posix()}!{zip_member(zr, RIV_PAT)}", bbox=READ_BB,
                            engine="pyogrio")
        riv.to_file(hr_cache, driver="GPKG")
    if not hb_cache.exists():
        log("reading HydroBASINS lev12…")
        b12 = gpd.read_file(f"zip://{zb.as_posix()}!{zip_member(zb, BAS_PAT)}", bbox=READ_BB,
                            engine="pyogrio")
        b12.to_file(hb_cache, driver="GPKG")
    riv = gpd.read_file(hr_cache).to_crs(CRS)
    b12 = gpd.read_file(hb_cache).to_crs(CRS)
    riv["HYRIV_ID"] = riv["HYRIV_ID"].astype(int)
    riv["NEXT_DOWN"] = riv["NEXT_DOWN"].astype(int)
    riv.index = riv["HYRIV_ID"].values
    rsidx = riv.sindex
    b12["HYBAS_ID"] = b12["HYBAS_ID"].astype(int)
    up_map: dict[int, list] = {}
    for i, nd in zip(b12["HYBAS_ID"], b12["NEXT_DOWN"].astype(int)):
        up_map.setdefault(nd, []).append(i)
    b12i = b12.copy(); b12i.index = b12["HYBAS_ID"].values
    log(f"HydroRIVERS {len(riv)} reaches, HydroBASINS lev12 {len(b12)} basins")

    def upstream(start):
        out, st = set(), [start]
        while st:
            k = st.pop()
            if k in out:
                continue
            out.add(k)
            st.extend(up_map.get(k, []))
        return out

    # snap (as pipeline/00_context_data.catchment): reaches within 3 km, main stem = upland ≥ 0.5 × max, nearest
    for e in entries:
        pt = e["rec"]["pt"]
        cand = riv.iloc[list(rsidx.query(pt.buffer(3000), predicate="intersects"))].copy()
        rk = e["rec"]["res_k"]
        e["snap_rule"] = "nearest main stem within 3 km"
        if len(cand) and rk is not None and e["id"] != "mellegue":  # prefer the river that runs through the reservoir
            through = cand[cand.intersects(res.at[rk, "geometry"].buffer(150))]
            if len(through):
                cand, e["snap_rule"] = through, "main stem through the reservoir polygon"
        if len(cand):
            cand["d"] = cand.distance(pt)
            mainr = cand[cand["UPLAND_SKM"] >= 0.5 * cand["UPLAND_SKM"].max()]
            mainr = mainr.assign(d1=mainr["d"].round(0))  # tie at a reach junction → the upstream reach
            s = mainr.sort_values(["d1", "UPLAND_SKM", "HYRIV_ID"]).iloc[0]
            e["snap"] = dict(id=int(s["HYRIV_ID"]), d=float(s["d"]), up=float(s["UPLAND_SKM"]),
                             hybas=int(s["HYBAS_L12"]), ord=int(s["ORD_STRA"]))
        else:
            e["snap"] = None
    # unnamed water bodies with no HydroRIVERS reach within 1.5 km are not identifiable river dams (port basins,
    # salt pans, urban ponds): excluded and listed in the provenance
    drop = [e for e in entries if e["name"] is None and (e["snap"] is None or e["snap"]["d"] > 1500)]
    prov["excluded_unnamed_off_network"] = [e["rec"]["osm_id"] for e in drop]
    entries = [e for e in entries if e not in drop]
    snap_of = {}
    for e in entries:
        if e["snap"]:
            snap_of.setdefault(e["snap"]["id"], []).append(e)

    # ---- per-dam geometry
    tun_line = tun.boundary
    endo = "ENDORHEIC" in riv.columns
    for e in entries:
        pt = e["rec"]["pt"]
        e["catch"], e["down"], e["up_rivers"] = None, None, None
        e["catch_km2"] = e["sum_sub"] = None
        e["down_to"] = None
        if not e["snap"]:
            continue
        ids = upstream(e["snap"]["hybas"])
        sel = b12i.loc[sorted(ids)]
        poly = sel.geometry.union_all().buffer(0)
        e["catch"], e["catch_km2"] = poly, poly.area / 1e6
        e["sum_sub"] = float(sel["SUB_AREA"].sum())
        e["n_basins"] = len(ids)
        if e["id"] in ("mellegue", "sidi-salem"):
            prov[f"snap_{e['id']}"] = dict(e["snap"], n_basins=len(ids))
        # upstream rivers
        ur = riv[riv["HYBAS_L12"].astype(int).isin(ids)]
        u3 = ur[ur["ORD_STRA"] >= 3]
        if len(u3) < 15:
            u3 = ur
        e["up_rivers"] = u3.sort_values(["UPLAND_SKM", "HYRIV_ID"], ascending=[False, True]).head(150)
        # downstream walk
        rid = e["snap"]["id"]
        first = riv.loc[rid].geometry
        if first.geom_type == "MultiLineString":
            first = linemerge(first)
        parts = [substring(first, first.project(pt), first.length)]
        visited = {rid}
        stop = None
        entered = pt.within(tun_in)   # a dam outside Tunisia walks until it has entered and left the country
        nd = int(riv.loc[rid, "NEXT_DOWN"])
        while True:
            if nd == 0:
                last = riv.loc[rid]
                if endo and int(last.get("ENDORHEIC", 0)) == 1:
                    stop = "sink"
                else:
                    stop = "sea" if Point(parts[-1].coords[-1]).distance(tun_line) < 15000 else "sink"
                break
            if nd not in riv.index or nd in visited:
                stop = "border"  # left the read window
                break
            g = riv.loc[nd].geometry
            g = linemerge(g) if g.geom_type == "MultiLineString" else g
            other = [o for o in snap_of.get(nd, []) if o is not e and o["rec"]["pt"].distance(pt) > 500]
            if other:
                o = min(other, key=lambda o: g.project(o["rec"]["pt"]))
                parts.append(substring(g, 0, g.project(o["rec"]["pt"])))
                stop = o["id"]
                break
            if g.centroid.within(tun_in):
                entered = True
            elif entered:
                inside = g.intersection(tun_in)
                if not inside.is_empty:
                    parts.append(inside if inside.geom_type == "LineString" else linemerge(inside))
                stop = "border"
                break
            parts.append(g)
            visited.add(nd)
            rid, nd = nd, int(riv.loc[nd, "NEXT_DOWN"])
        cs = []  # chain coordinates in walk order (reaches are ordered from the dam)
        for p in parts:
            if p.is_empty:
                continue
            for geom in (p.geoms if hasattr(p, "geoms") else [p]):
                c = list(geom.coords)
                cs += c[1:] if cs and c and c[0] == cs[-1] else c
        line = LineString(cs) if len(cs) >= 2 else None
        e["down"], e["down_to"] = line, stop

    # ---- towns, NISAR, governorate
    fp = gpd.read_file(M / "TESTS/nisar_tunisia_output/footprints.geojson")
    inputs.append(M / "TESTS/nisar_tunisia_output/footprints.geojson")
    if "product" in fp.columns:
        fp = fp[fp["product"] == "GCOV"]
    fp = fp.to_crs(4326)
    places = places[places["name"].notna() | places.get("name_fr", pd.Series(index=places.index)).notna()]
    pidx = places.sindex
    adm1i = adm1.reset_index(drop=True)
    for e in entries:
        pt = e["rec"]["pt"]
        ll = to_ll(pt)
        e["ll"] = ll
        hit = fp[fp.contains(ll)]
        e["nisar_dates"] = int(hit["date"].nunique()) if "date" in hit else int(
            pd.to_datetime(hit["startTime"]).dt.date.nunique())
        e["nisar_tracks"] = sorted({f"{str(r.flightDirection)[0]}{int(r.track)}" for r in hit.itertuples()},
                                   key=lambda s: (s[0], int(s[1:])))
        g = adm1i[adm1i.contains(pt)]
        if not len(g):
            g = adm1i.iloc[[int(adm1i.distance(pt).idxmin())]] if adm1i.distance(pt).min() < 5000 else g
        e["gov"] = g.iloc[0]["shapeName"] if len(g) else None
        e["towns"] = []
        if e["down"] is not None:
            ln = e["down"]
            ci = places.iloc[list(pidx.query(ln.buffer(2000), predicate="intersects"))]
            tw = []
            for _, p in ci.iterrows():
                nm = clean(p.get("name_fr")) or clean(p.get("name_en")) or clean(p.get("name"))
                if not nm:
                    continue
                pop = pd.to_numeric(p.get("population"), errors="coerce")
                tw.append(dict(name=nm, name_ar=clean(p.get("name_ar")) or (clean(p.get("name")) if is_arabic(
                    clean(p.get("name"))) else None), km=round(ln.project(p.geometry) / 1000, 1),
                    dist_m=round(ln.distance(p.geometry)), population=None if pd.isna(pop) else int(pop),
                    place=clean(p.get("place")), geom=p.geometry))
            uniq = {}
            for t in sorted(tw, key=lambda t: (t["dist_m"], t["name"])):
                uniq.setdefault(t["name"], t)
            tw = sorted(uniq.values(), key=lambda t: (-(t["population"] or -1), t["km"], t["name"]))[:12]
            e["towns"] = sorted(tw, key=lambda t: (t["km"], t["name"]))
        # river name: nearest named OSM river within 1 km of the dam point
        e["river"] = None
        if rivers_osm is not None and len(rivers_osm):
            if "ru" not in locals():
                ru = rivers_osm.to_crs(CRS)
                ru_idx = ru.sindex
            ci = ru.iloc[list(ru_idx.query(pt.buffer(1000), predicate="intersects"))]
            if len(ci):
                r0 = ci.iloc[int(np.argmin(ci.distance(pt).values))]
                e["river"] = clean(r0.get("name_fr")) or clean(r0.get("name_en")) or clean(r0.get("name"))
        if not e["river"]:
            for nm in (e["names"]["name_fr"], e["names"]["name"], e["rnames"]["name_fr"], e["rnames"]["name"]):
                m = re.search(r"\b(oued|wadi)\s+[\w'’\- ]+", nm or "", re.I)
                if m:
                    e["river"] = m.group(0).strip()
                    break

    # ---- write per-dam GeoJSON + index
    def feat(g, **props):
        return {"type": "Feature", "properties": props, "geometry": round_geom(g)}

    def ll_simpl(g, tol):
        return to_ll(g.simplify(tol, preserve_topology=True))

    for old in (out_dir / "dams").glob("*.geojson"):  # drop files of ids no longer in the catalogue
        if old.stem not in {e["id"] for e in entries}:
            old.unlink()
    dams_out = []
    sizes = {}
    mel_ss = None
    entries = sorted(entries, key=lambda e: e["id"])
    for e in entries:
        pt, ll = e["rec"]["pt"], e["ll"]
        feats = [feat(ll, role="dam", id=e["id"], name=e["name"], osm_id=e["rec"]["osm_id"])]
        rk = e["rec"]["res_k"]
        if rk is not None:
            rg = res.at[rk, "geometry"].simplify(15, preserve_topology=True)
            rg = rg if rg.is_valid else rg.buffer(0)
            feats.append(feat(to_ll(rg).buffer(0), role="reservoir", osm_id=res.at[rk, "osm_id"],
                              area_km2=round(e["rec"]["res_km2"], 3)))
        tol = 150
        if e["catch"] is not None:
            for tol in (150, 250, 400, 700):
                cg = ll_simpl(e["catch"], tol)
                if len(json.dumps(round_geom(cg))) < 50_000:
                    break
            feats.append(feat(cg, role="catchment", area_km2=round(e["catch_km2"], 1), simplify_m=tol))
        if e["down"] is not None:
            feats.append(feat(ll_simpl(e["down"], 100), role="river_down", length_km=round(e["down"].length / 1000, 1),
                              to=e["down_to"]))
        if e["up_rivers"] is not None and len(e["up_rivers"]):
            ur = e["up_rivers"]
            for tolr in (100, 200, 400):
                lines = [ll_simpl(g, tolr) for g in ur.geometry]
                if sum(len(json.dumps(round_geom(x))) for x in lines) < 45_000:
                    break
            for (_, r), lg in zip(ur.iterrows(), lines):
                feats.append(feat(lg, role="rivers_up", ord=int(r["ORD_STRA"]), upland_km2=round(float(r["UPLAND_SKM"]), 1)))
        for t in e["towns"]:
            feats.append(feat(to_ll(t["geom"]), role="town", name=t["name"], name_ar=t["name_ar"], km=t["km"],
                              population=t["population"]))
        fc = {"type": "FeatureCollection", "id": e["id"], "badge": "MODELLED",
              "source": "OSM (ODbL) dam + reservoir; HydroBASINS lev-12 v1c catchment; HydroRIVERS v1.0 network",
              "features": feats}
        p = out_dir / "dams" / f"{e['id']}.geojson"
        p.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        sizes[p.name] = p.stat().st_size
        snap_m = round(e["snap"]["d"]) if e["snap"] else None
        warn = None
        if e["snap"] is None:
            warn = "no HydroRIVERS reach within 3 km"
        elif e["catch_km2"] is not None and e["catch_km2"] < 5:
            warn = "catchment < 5 km² — dam probably snapped to a small tributary"
        elif e["snap"]["d"] > 1500:
            warn = f"snapped {snap_m} m away — check the reach"
        dams_out.append(dict(
            id=e["id"], name=e["name"], name_en=e["name_en"], name_ar=e["name_ar"], osm_id=e["rec"]["osm_id"],
            lon=r5(ll.x), lat=r5(ll.y), river=e["river"], governorate=e["gov"],
            reservoir_km2=round(e["rec"]["res_km2"], 3) if e["rec"]["res_km2"] is not None else None,
            height_m=e["height"], start_date=e["start"],
            catchment_km2=round(e["catch_km2"], 1) if e["catch_km2"] is not None else None,
            catchment_sum_sub_area_km2=round(e["sum_sub"], 1) if e["sum_sub"] is not None else None,
            snap_m=snap_m, snap_rule=e.get("snap_rule"),
            catchment_shared_with=sorted(o["id"] for o in entries if o is not e and o["snap"] and e["snap"]
                                         and o["snap"]["hybas"] == e["snap"]["hybas"]) or None, snap_reach_upland_km2=e["snap"]["up"] if e["snap"] else None,
            snap_warning=warn,
            downstream_km=round(e["down"].length / 1000, 1) if e["down"] is not None else None,
            downstream_to=e["down_to"],
            towns=[{"name": t["name"], "km": t["km"]} for t in e["towns"]],
            nisar_dates=e["nisar_dates"], nisar_tracks=e["nisar_tracks"],
            status="processed" if e["id"] == "mellegue" or bundle_ok(e["id"]) else "catalogued", badge="MODELLED",
            **({"name_source": e["name_source"]} if e.get("name_source") else {}),
            **({"bundle": f"data/v2/{e['id']}/"} if bundle_ok(e["id"]) else {}),
            source="OSM dam/reservoir (ODbL); HydroBASINS/HydroRIVERS (Lehner & Grill 2013); "
                   "NISAR footprints from ASF search; geoBoundaries ADM1",
            file=f"v2/dams/{e['id']}.geojson"))
    newest = max(p.stat().st_mtime for p in inputs if p.exists())
    tb = adm0.to_crs(4326).total_bounds
    index = {
        "schema_version": "v2-dams-0.1",
        "generated_utc": dt.datetime.fromtimestamp(newest, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "badge": "MODELLED",
        "sources": [
            "OpenStreetMap contributors (ODbL): waterway/man_made=dam, water=reservoir / natural=water, place, "
            f"waterway=river names; scope {osm_scope}",
            "HydroBASINS v1c level 12 and HydroRIVERS v1.0 (Lehner & Grill 2013, WWF / McGill), 15 arc-second SRTM hydrology",
            "NISAR L2 GCOV product footprints, ASF search inventory 17 Jun – 31 Oct 2026",
            "geoBoundaries gbOpen TUN ADM0 / ADM1",
        ],
        "method": ("Dam = OSM dam feature with a dam name (Barrage / سد) or an OSM reservoir polygon ≥ "
                   f"{a.min_res_km2} km² within 500 m; one entry per reservoir. Crest point = dam-line midpoint. "
                   "Snapped to the nearest main-stem HydroRIVERS reach within 3 km (upland ≥ 0.5 × local max); "
                   "catchment = that reach's HydroBASINS lev-12 unit + all units draining to it (dissolved, "
                   "simplified ~150 m); downstream path = HydroRIVERS NEXT_DOWN chain from the crest to the sea / an "
                   "endorheic sink / the national border / the next catalogued dam (simplified ~100 m). Towns = OSM "
                   f"places within 2 km of the path ({places_scope}). NISAR = distinct GCOV acquisition dates whose "
                   "product footprint contains the crest point."),
        "uncertainty": ("HydroSHEDS is a 500 m-scale model network: catchments include the whole lev-12 unit at "
                        "the outlet (can over-count small dams), paths differ from OSM rivers by up to a few hundred "
                        "metres and from our 30 m D8 path in length. OSM coverage and names are incomplete; null = "
                        "not in the sources. Reservoir area is the mapped polygon, not current storage."),
        "tunisia_bbox": [round(float(v), 3) for v in (min(tb[0], min(d["lon"] for d in dams_out) - 0.1),
                                                      min(tb[1], min(d["lat"] for d in dams_out) - 0.1),
                                                      max(tb[2], max(d["lon"] for d in dams_out) + 0.1),
                                                      max(tb[3], max(d["lat"] for d in dams_out) + 0.1))],
        "tunisia_bbox_note": "Tunisia (geoBoundaries ADM0) extended to every catalogued dam, incl. --extra dams abroad",
        "dams": dams_out,
    }
    pi = out_dir / "dams" / "index.json"
    pi.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    # ---- tunisia.geojson
    tfe = [feat(to_ll(tun.simplify(1000, preserve_topology=True)), role="country", name="Tunisia")]
    for _, r in adm1.sort_values("shapeName").iterrows():
        tfe.append(feat(to_ll(r.geometry.simplify(1000, preserve_topology=True)), role="adm1", name=r["shapeName"],
                        iso=r.get("shapeISO")))
    bbx = gpd.GeoSeries([Polygon.from_bounds(*tb)], crs=4326).to_crs(CRS).iloc[0].buffer(30000)
    mr = riv[(riv["ORD_STRA"] >= 5) & riv.intersects(bbx)]
    # merge per MAIN_RIV to keep the file small
    for mid, grp in mr.groupby("MAIN_RIV"):
        gl = linemerge(unary_union(list(grp.geometry)))
        gl = gl.intersection(bbx)
        if gl.is_empty:
            continue
        tfe.append(feat(to_ll(gl.simplify(500, preserve_topology=False)), role="river", main_riv=int(mid),
                        ord=int(grp["ORD_STRA"].max())))
    tj = {"type": "FeatureCollection", "badge": "REPORTED",
          "source": "geoBoundaries gbOpen TUN ADM0/ADM1 (simplified ~1 km); HydroRIVERS v1.0 Strahler ≥ 5 (~500 m)",
          "features": tfe}
    pt_ = out_dir / "tunisia.geojson"
    pt_.write_text(json.dumps(tj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---- checks + provenance
    validity = {"invalid": []}
    for p in (out_dir / "dams").glob("*.geojson"):
        for f in json.loads(p.read_text(encoding="utf-8"))["features"]:
            if not shape(f["geometry"]).is_valid:
                validity["invalid"].append(f"{p.name}:{f['properties']['role']}")
    for f in tj["features"]:
        if not shape(f["geometry"]).is_valid:
            validity["invalid"].append(f"tunisia:{f['properties']['role']}:{f['properties'].get('name')}")
    byid = {d["id"]: d for d in dams_out}
    checks = {
        "n_dams": len(dams_out),
        "mellegue": {k: byid["mellegue"][k] for k in ("catchment_km2", "catchment_sum_sub_area_km2", "downstream_km",
                                                      "downstream_to", "snap_m", "nisar_dates", "nisar_tracks")},
        "sidi_salem": {k: byid["sidi-salem"][k] for k in ("catchment_km2", "catchment_sum_sub_area_km2",
                                                          "downstream_km", "downstream_to", "snap_m")},
        "null_catchment": [d["id"] for d in dams_out if d["catchment_km2"] is None],
        "snap_warnings": {d["id"]: d["snap_warning"] for d in dams_out if d["snap_warning"]},
        "invalid_geometries": validity["invalid"],
        "sizes_bytes": {"index.json": pi.stat().st_size, "tunisia.geojson": pt_.stat().st_size,
                        "max_dam_file": max(sizes.values()), "total": pi.stat().st_size + pt_.stat().st_size + sum(sizes.values())},
    }
    prov.update(thresholds={"min_reservoir_km2": a.min_res_km2, "reservoir_match_m": 500, "snap_radius_m": 3000,
                            "main_stem_upland_frac": 0.5, "town_buffer_m": 2000, "max_towns": 12,
                            "simplify_catchment_m": 150, "simplify_path_m": 100},
                checks=checks, generated_utc=index["generated_utc"])
    (work / "catalog_provenance.json").write_text(json.dumps(prov, ensure_ascii=False, indent=1), encoding="utf-8")
    log(json.dumps(checks, ensure_ascii=False, indent=1))

    if a.qa:
        qa_png(out_dir, index, adm1, work / "catalog_qa.png")


def bundle_ok(dam_id: str) -> bool:
    """True when apps/web/public/data/v2/<id>/ exists and every contract file validates (pipeline/v2/run_dam.py)."""
    from common import contracts as C
    out = ROOT / "apps/web/public/data/v2" / dam_id
    if not (out / "manifest.json").exists():
        return False
    try:
        for name, rel in C.BUNDLE_PATHS.items():
            C.validate_file(name, out / rel)
        return True
    except Exception:  # noqa: BLE001
        return False


def qa_png(out_dir, index, adm1, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    tj = json.loads((out_dir / "tunisia.geojson").read_text(encoding="utf-8"))
    fig, ax = plt.subplots(figsize=(9, 12), dpi=110)
    for f in tj["features"]:
        g = shape(f["geometry"])
        r = f["properties"]["role"]
        if r == "river":
            for ln in getattr(g, "geoms", [g]):
                ax.plot(*ln.xy, color="#6fa8dc", lw=0.6)
        else:
            for pg in getattr(g, "geoms", [g]):
                ax.plot(*pg.exterior.xy, color="#333" if r == "country" else "#bbb", lw=1.2 if r == "country" else 0.4)
    ex = ["mellegue", "sidi-salem"] + [d["id"] for d in sorted(index["dams"], key=lambda d: -(d["catchment_km2"] or 0))
                                       if d["id"] not in ("mellegue", "sidi-salem")][:1]
    cols = ["#e69138", "#6aa84f", "#a64d79"]
    for idd, c in zip(ex, cols):
        fc = json.loads((out_dir / "dams" / f"{idd}.geojson").read_text(encoding="utf-8"))
        for f in fc["features"]:
            g, r = shape(f["geometry"]), f["properties"]["role"]
            if r == "catchment":
                for pg in getattr(g, "geoms", [g]):
                    ax.fill(*pg.exterior.xy, color=c, alpha=0.18, lw=0)
                    ax.plot(*pg.exterior.xy, color=c, lw=0.8)
            elif r == "river_down":
                ax.plot(*g.xy, color=c, lw=2.2)
            elif r == "town":
                ax.plot(g.x, g.y, "k.", ms=3)
    for d in index["dams"]:
        ax.plot(d["lon"], d["lat"], "o", ms=4, color="red" if d["snap_warning"] else "navy")
        ax.annotate(d["id"], (d["lon"], d["lat"]), fontsize=5, xytext=(2, 2), textcoords="offset points")
    ax.set_aspect(1 / math.cos(math.radians(35)))
    ax.set_xlabel("Longitude (°E)")
    ax.set_ylabel("Latitude (°N)")
    ax.set_title(f"V2 dam catalogue QA: {len(index['dams'])} dams; catchments + downstream paths: {', '.join(ex)}\n"
                 "red = snap warning. MODELLED (OSM + HydroSHEDS)", fontsize=9)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


if __name__ == "__main__":
    main()
