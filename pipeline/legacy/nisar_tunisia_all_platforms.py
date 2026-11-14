#!/usr/bin/env python3
"""
NISAR over Tunisia: check EVERY platform
========================================
Checks all known places that serve NISAR data and reports what exists over Tunisia.

  1. ASF DAAC (Vertex / asf_search)    L-band products, full metadata, download URLs   (no login to search)
  2. NASA CMR (Earthdata Search)       every NISAR collection incl. Urgent Response, custom and
                                       ancillary ones, granule counts over Tunisia, Harmony services (no login)
  3. NASA Worldview / GIBS             ready-made NISAR GCOV RGB mosaics: available dates, % of Tunisia
                                       covered per date, PNG snapshots + animated GIF                 (no login)
  4. ISRO Bhoonidhi (STAC API)         S-band, joint L+S and ISRO L-band products     (needs Bhoonidhi login)
  5. Microsoft Planetary Computer      checks whether a NISAR collection exists                       (no login)
  6. Google Earth Engine catalog       checks whether a NISAR collection exists                       (no login)

Install:
  pip install "asf_search>=11" pandas shapely folium plotly requests pillow numpy

Run:
  python nisar_tunisia_all_platforms.py
  python nisar_tunisia_all_platforms.py --start 2026-06-01 --end 2026-11-15
  python nisar_tunisia_all_platforms.py --skip gee pc          # skip some platforms
  python nisar_tunisia_all_platforms.py --asf-from-csv nisar_tunisia_output/inventory.csv   # reuse a previous ASF run

Bhoonidhi (optional): register at https://bhoonidhi.nrsc.gov.in then either
  set env vars   BHOONIDHI_USER=...  BHOONIDHI_PASSWORD=...
  or pass        --bhoonidhi-user YOUR_ID   (the password is asked interactively)

Outputs in ./nisar_all_platforms_output/ :
  platforms_summary.csv     one line per platform: status, products over Tunisia, first/last date
  asf_inventory.csv         ASF products (with footprints) + asf_coverage_by_frame.csv + asf_sites_coverage.csv
  cmr_collections.csv       all NISAR collections in NASA CMR with granule counts over Tunisia
  gibs_layers.csv           NISAR layers in GIBS/Worldview and their time range
  gibs_coverage.csv         per layer/date: % of Tunisia with NISAR imagery
  gibs/*.png, gibs_animation.gif   snapshots of Tunisia from Worldview (ready for your app / pitch)
  bhoonidhi_inventory.csv   ISRO products over Tunisia (if logged in)
  map.html                  interactive map with all layers;  timeline.html  acquisitions over time
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
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd
import requests
from shapely import wkt as shapely_wkt
from shapely.geometry import Point, box, mapping, shape
from shapely.geometry.polygon import orient

# ==========================================================================
# Configuration
# ==========================================================================
TUNISIA_BBOX = (7.49, 30.22, 11.6, 37.35)  # lon_min, lat_min, lon_max, lat_max
NATURAL_EARTH_URL = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
                     "geojson/ne_50m_admin_0_countries.geojson")
SCIENCE_PRODUCTS = ["RSLC", "RIFG", "RUNW", "ROFF", "GSLC", "GCOV", "GUNW", "GOFF", "SME2"]

CMR = "https://cmr.earthdata.nasa.gov/search"
GIBS_WMTS_CAPS = "https://gibs.earthdata.nasa.gov/wmts/epsg{epsg}/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities"
GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg{epsg}/best/wms.cgi"
BHOONIDHI_API = "https://bhoonidhi-api.nrsc.gov.in"
BHOONIDHI_DOC_COLLECTIONS = ["NISAR_SSAR_RSLC", "NISAR_SSAR_GSLC", "NISAR_SSAR_GCOV", "NISAR_SSAR_RUNW",
                             "NISAR_SSAR_GUNW", "NISAR_SSAR_RIFG", "NISAR_SSAR_ROFF", "NISAR_SSAR_GOFF"]
PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
GEE_STAC = "https://storage.googleapis.com/earthengine-stac/catalog/catalog.json"

SITES = {  # approximate; NISAR swaths are ~240 km wide
    "Sidi Salem dam": (36.60, 9.39), "Sidi El Barrak dam": (37.02, 9.09), "Mellegue dam": (36.32, 8.71),
    "Lake Ichkeul (UNESCO)": (37.16, 9.67), "Tunis city": (36.80, 10.18), "Sebkhet Sejoumi": (36.77, 10.13),
    "Mornag plain": (36.68, 10.29), "Cap Bon / Grombalia": (36.60, 10.50), "Gafsa phosphate basin": (34.33, 8.40),
    "Chott el Djerid": (33.75, 8.40), "Sfax olive groves": (34.74, 10.76),
}
UA = {"User-Agent": "nisar-tunisia-spaceapps/1.0"}
SUMMARY = []  # one dict per platform


def log(msg):
    print(msg, flush=True)


def add_summary(platform, status, n=None, first=None, last=None, notes=""):
    SUMMARY.append({"platform": platform, "status": status, "products_over_tunisia": n,
                    "first": first, "last": last, "notes": notes})


def http_get(url, **kw):
    kw.setdefault("timeout", 120)
    headers = {**UA, **kw.pop("headers", {})}
    r = requests.get(url, headers=headers, **kw)
    r.raise_for_status()
    return r


def http_post(url, **kw):
    kw.setdefault("timeout", 120)
    headers = {**UA, **kw.pop("headers", {})}
    r = requests.post(url, headers=headers, **kw)
    r.raise_for_status()
    return r


# ==========================================================================
# Area of interest
# ==========================================================================
def load_tunisia_outline(out: Path):
    for cache in (out / "tunisia_outline.geojson", Path("nisar_tunisia_output/tunisia_outline.geojson"),
                  Path("tunisia_outline.geojson")):
        if cache.exists():
            feat = json.loads(cache.read_text())
            geom = feat["geometry"] if "geometry" in feat else feat
            (out / "tunisia_outline.geojson").write_text(json.dumps(feat))
            return shape(geom), f"Natural Earth ({cache})"
    try:
        for feat in http_get(NATURAL_EARTH_URL, timeout=60).json()["features"]:
            if feat["properties"].get("ISO_A3") == "TUN":
                (out / "tunisia_outline.geojson").write_text(json.dumps(feat))
                return shape(feat["geometry"]), "Natural Earth"
    except Exception as exc:  # noqa: BLE001
        log(f"  ! Tunisia border not available ({exc}); using bounding box.")
    return box(*TUNISIA_BBOX), "bounding box"


def query_polygon(aoi):
    """Simple counter-clockwise polygon (convex hull) accepted by every API."""
    return orient(aoi.convex_hull.simplify(0.02), sign=1.0)


# ==========================================================================
# 1. ASF
# ==========================================================================
def maturity_from_collection(name, prod_conf=None):
    n = (name or "").upper()
    if prod_conf == "UR" or "_UR_" in n or n.endswith("_UR"):
        return "URGENT_RESPONSE"
    if "BETA" in n:
        return "BETA (pre-calibration)"
    if "PROVISIONAL" in n:
        return "PROVISIONAL (calibrated)"
    return "VALIDATED" if n else "UNKNOWN"


def _txt(v):
    if v is None:
        return ""
    return "+".join(map(str, v)) if isinstance(v, (list, tuple)) else str(v)


def asf_results_to_df(results):
    rows = []
    for r in results:
        p = r.properties
        size = sum(int(i.get("bytes") or 0) for i in (p.get("bytes") or {}).values() if isinstance(i, dict))
        geom = r.geometry if r.geometry and r.geometry.get("coordinates") else None
        rows.append({
            "platform": "ASF", "sceneName": p.get("sceneName") or p.get("fileID"),
            "product": p.get("processingLevel"),
            "maturity": maturity_from_collection(p.get("collectionName"), p.get("productionConfiguration")),
            "collection": p.get("collectionName"), "productionConfiguration": p.get("productionConfiguration"),
            "startTime": p.get("startTime"), "flightDirection": p.get("flightDirection"),
            "track": p.get("pathNumber"), "frame": p.get("frameNumber"),
            "polA": _txt(p.get("mainBandPolarization")), "polB": _txt(p.get("sideBandPolarization")),
            "bandwidth": _txt(p.get("rangeBandwidth")), "jointLS": p.get("jointObservation"),
            "crid": p.get("crid"), "size_GB": round(size / 1e9, 2) if size else None,
            "url": p.get("url"), "browse": (p.get("browse") or [None])[0],
            "geometry_wkt": shape(geom).wkt if geom else None,
        })
    return finalize_df(pd.DataFrame(rows))


def finalize_df(df):
    if df.empty:
        return df
    df["startTime"] = pd.to_datetime(df["startTime"], utc=True, errors="coerce")
    df["date"] = df["startTime"].dt.strftime("%Y-%m-%d")
    df["month"] = df["startTime"].dt.strftime("%Y-%m")
    return df.sort_values(["product", "startTime"]).reset_index(drop=True)


def run_asf(aoi, qpoly, args, out):
    log("\n[1/6] ASF DAAC (asf_search)")
    if args.asf_from_csv:
        df = pd.read_csv(args.asf_from_csv)
        df["platform"] = "ASF"
        df = finalize_df(df.drop(columns=["date", "month"], errors="ignore"))
        log(f"  reused {len(df)} products from {args.asf_from_csv}")
    else:
        import asf_search as asf
        opts = {"dataset": asf.DATASET.NISAR, "intersectsWith": qpoly.wkt, "processingLevel": args.products}
        if args.start:
            opts["start"] = args.start
        if args.end:
            opts["end"] = args.end
        try:
            log(f"  ASF reports {asf.search_count(**opts)} products for the search polygon; fetching...")
        except Exception:  # noqa: BLE001
            pass
        df = asf_results_to_df(asf.search(**opts))
        if not df.empty:
            keep = [w is None or shapely_wkt.loads(w).intersects(aoi) for w in df["geometry_wkt"]]
            df = df[keep].reset_index(drop=True)
    if df.empty:
        add_summary("ASF DAAC", "no data")
        return df

    df.to_csv(out / "asf_inventory.csv", index=False)
    cov = (df.groupby(["product", "flightDirection", "track", "frame"], dropna=False)
             .agg(n_products=("sceneName", "count"), n_dates=("date", "nunique"), first=("date", "min"),
                  last=("date", "max"), pols=("polA", lambda s: ", ".join(sorted({str(x) for x in s if pd.notna(x) and x}))),
                  bandwidths=("bandwidth", lambda s: ", ".join(sorted({str(x) for x in s if pd.notna(x) and x}))),
                  joint_LS=("jointLS", lambda s: bool(pd.Series(s).fillna(False).astype(bool).any())))
             .reset_index().sort_values(["product", "n_dates"], ascending=[True, False]))
    cov.to_csv(out / "asf_coverage_by_frame.csv", index=False)
    sites_df = sites_coverage(df)
    sites_df.to_csv(out / "asf_sites_coverage.csv", index=False)

    log(f"  {len(df)} products, {df['date'].min()} -> {df['date'].max()}")
    log(pd.crosstab(df["product"], df["maturity"], margins=True).to_string())
    joint = df[df["jointLS"].astype(str).str.lower() == "true"]
    if len(joint):
        tr = sorted({f"{str(d)[0]}{int(t)}/F{int(f)}" for d, t, f in
                     zip(joint["flightDirection"], joint["track"], joint["frame"]) if pd.notna(t) and pd.notna(f)})
        log(f"  Joint L+S observations: {joint['date'].nunique()} dates on {', '.join(tr)} -> check S-band in Bhoonidhi")
    add_summary("ASF DAAC", "ok", len(df), df["date"].min(), df["date"].max(),
                "products: " + ", ".join(f"{k}={v}" for k, v in df["product"].value_counts().items()))
    return df


def sites_coverage(df, product="GCOV"):
    sub = df[(df["product"] == product)]
    if "geometry_wkt" not in sub or sub["geometry_wkt"].isna().all():
        return pd.DataFrame()
    sub = sub[sub["geometry_wkt"].notna()]
    geoms = [shapely_wkt.loads(w) for w in sub["geometry_wkt"]]
    rows = []
    for site, (lat, lon) in SITES.items():
        hits = sub[[g.contains(Point(lon, lat)) for g in geoms]]
        rows.append({"site": site, "lat": lat, "lon": lon, "n_dates": hits["date"].nunique(),
                     "first": hits["date"].min() if len(hits) else None,
                     "last": hits["date"].max() if len(hits) else None,
                     "dates": ", ".join(sorted(hits["date"].unique()))})
    return pd.DataFrame(rows)


# ==========================================================================
# 2. NASA CMR (Earthdata Search)
# ==========================================================================
def cmr_polygon_param(qpoly):
    return ",".join(f"{x:.4f},{y:.4f}" for x, y in qpoly.exterior.coords)


def cmr_list_nisar_collections():
    cols, headers = [], {}
    params = {"short_name": "NISAR*", "options[short_name][pattern]": "true", "page_size": 200}
    while True:
        r = http_get(f"{CMR}/collections.umm_json", params=params, headers=headers)
        items = r.json().get("items", [])
        cols.extend(items)
        sa = r.headers.get("CMR-Search-After")
        if not items or not sa or len(items) < params["page_size"]:
            break
        headers = {"CMR-Search-After": sa}
    return cols


def cmr_granules(concept_id, poly_param, temporal, page_size=0, sort=None):
    params = {"collection_concept_id": concept_id, "polygon": poly_param, "page_size": page_size}
    if temporal:
        params["temporal"] = temporal
    if sort:
        params["sort_key"] = sort
    r = http_get(f"{CMR}/granules.json", params=params)
    return int(r.headers.get("CMR-Hits", 0)), r.json().get("feed", {}).get("entry", [])


def run_cmr(qpoly, args, out):
    log("\n[2/6] NASA CMR / Earthdata Search (all NISAR collections)")
    try:
        cols = cmr_list_nisar_collections()
    except Exception as exc:  # noqa: BLE001
        log(f"  ! CMR not reachable: {exc}")
        add_summary("NASA CMR / Earthdata Search", f"error: {exc}")
        return pd.DataFrame()
    log(f"  {len(cols)} NISAR collections in CMR. Counting granules over Tunisia...")
    poly = cmr_polygon_param(qpoly)
    temporal = f"{args.start or '2025-07-30'}T00:00:00Z,{args.end or dt.date.today().isoformat()}T23:59:59Z"

    service_ids = set()
    rows = []
    for c in cols:
        meta, umm = c.get("meta", {}), c.get("umm", {})
        cid = meta.get("concept-id")
        svc = (meta.get("associations") or {}).get("services", [])
        service_ids.update(svc)
        try:
            hits, _ = cmr_granules(cid, poly, temporal)
            first = last = None
            if hits:
                _, e1 = cmr_granules(cid, poly, temporal, 1, "start_date")
                _, e2 = cmr_granules(cid, poly, temporal, 1, "-start_date")
                first = (e1[0].get("time_start") or "")[:10] if e1 else None
                last = (e2[0].get("time_start") or "")[:10] if e2 else None
            err = ""
        except Exception as exc:  # noqa: BLE001
            hits, first, last, err = None, None, None, str(exc)[:120]
        rows.append({"short_name": umm.get("ShortName"), "version": umm.get("Version"), "concept_id": cid,
                     "granules_over_tunisia": hits, "first": first, "last": last,
                     "n_services": len(svc), "service_ids": " ".join(svc), "error": err})
        time.sleep(0.1)

    df = pd.DataFrame(rows).sort_values(["granules_over_tunisia", "short_name"], ascending=[False, True])
    # Resolve service names (e.g. Harmony)
    names = {}
    if service_ids:
        try:
            ids = list(service_ids)
            for i in range(0, len(ids), 50):
                r = http_get(f"{CMR}/services.json", params=[("concept_id[]", s) for s in ids[i:i + 50]]
                             + [("page_size", 50)])
                for it in r.json().get("items", []):
                    names[it.get("concept_id")] = it.get("name")
        except Exception:  # noqa: BLE001
            pass
    df["services"] = [", ".join(names.get(s, s) for s in str(x).split()) if x else "" for x in df["service_ids"]]
    df.drop(columns=["service_ids"]).to_csv(out / "cmr_collections.csv", index=False)

    found = df[df["granules_over_tunisia"].fillna(0) > 0]
    log(found[["short_name", "granules_over_tunisia", "first", "last", "services"]].to_string(index=False)
        if len(found) else "  no NISAR granules over Tunisia in CMR")
    add_summary("NASA CMR / Earthdata Search", "ok", int(found["granules_over_tunisia"].sum()),
                found["first"].min() if len(found) else None, found["last"].max() if len(found) else None,
                f"{len(found)} of {len(df)} NISAR collections have data over Tunisia; "
                f"collections with Harmony/services: {int((found['n_services'] > 0).sum())}")
    return df


# ==========================================================================
# 3. NASA Worldview / GIBS
# ==========================================================================
NS = {"wmts": "http://www.opengis.net/wmts/1.0", "ows": "http://www.opengis.net/ows/1.1"}


def parse_gibs_capabilities(xml_bytes, keyword="nisar"):
    root = ET.fromstring(xml_bytes)
    layers = []
    for lyr in root.iter(f"{{{NS['wmts']}}}Layer"):
        ident = (lyr.findtext("ows:Identifier", default="", namespaces=NS) or "").strip()
        title = (lyr.findtext("ows:Title", default="", namespaces=NS) or "").strip()
        if keyword not in (ident + " " + title).lower():
            continue
        values = []
        for dim in lyr.findall("wmts:Dimension", NS):
            if (dim.findtext("ows:Identifier", default="", namespaces=NS) or "").lower() == "time":
                values = [v.text.strip() for v in dim.findall("wmts:Value", NS) if v.text]
        tms = [t.text for t in lyr.findall("wmts:TileMatrixSetLink/wmts:TileMatrixSet", NS)]
        layers.append({"identifier": ident, "title": title, "time_values": values, "tile_matrix_sets": tms})
    return layers


def expand_time_values(values, start, end):
    """Turn GIBS time values like '2026-06-17/2026-11-13/P1D' into a list of dates within [start, end]."""
    dates = set()
    for v in values:
        parts = v.split("/")
        try:
            a = dt.date.fromisoformat(parts[0][:10])
            b = dt.date.fromisoformat(parts[1][:10]) if len(parts) > 1 else a
        except ValueError:
            continue
        step = 1
        if len(parts) > 2:
            m = re.fullmatch(r"P(\d+)D", parts[2])
            step = int(m.group(1)) if m else max((b - a).days, 1)
        d = a
        while d <= b:
            if start <= d <= end:
                dates.add(d)
            d += dt.timedelta(days=step)
        if start <= b <= end:
            dates.add(b)
    return sorted(dates)


def tunisia_mask(aoi, bbox, width, height):
    from PIL import Image, ImageDraw
    minx, miny, maxx, maxy = bbox
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    polys = getattr(aoi, "geoms", [aoi])
    for p in polys:
        pts = [((x - minx) / (maxx - minx) * width, (maxy - y) / (maxy - miny) * height) for x, y in p.exterior.coords]
        draw.polygon(pts, fill=255)
    return mask


def gibs_snapshot(layer, date, bbox, width, height):
    minx, miny, maxx, maxy = bbox
    params = {"SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "",
              "SRS": "EPSG:4326", "BBOX": f"{minx},{miny},{maxx},{maxy}", "WIDTH": width, "HEIGHT": height,
              "FORMAT": "image/png", "TRANSPARENT": "TRUE", "TIME": date.isoformat()}
    r = http_get(GIBS_WMS.format(epsg=4326), params=params, timeout=90)
    if not r.headers.get("Content-Type", "").startswith("image"):
        raise RuntimeError(r.text[:200])
    return r.content


def coverage_fraction(png_bytes, mask):
    import numpy as np
    from PIL import Image
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    if img.size != mask.size:
        img = img.resize(mask.size)
    a = np.array(img)
    has_data = (a[..., 3] > 0) & (a[..., :3].sum(axis=2) > 0)
    m = np.array(mask) > 0
    return float((has_data & m).sum() / max(m.sum(), 1))


def run_gibs(aoi, asf_df, args, out):
    log("\n[3/6] NASA Worldview / GIBS (ready-made NISAR GCOV mosaics)")
    try:
        caps = http_get(GIBS_WMTS_CAPS.format(epsg=4326), timeout=300).content
        layers = parse_gibs_capabilities(caps)
    except Exception as exc:  # noqa: BLE001
        log(f"  ! GIBS not reachable: {exc}")
        add_summary("NASA Worldview / GIBS", f"error: {exc}")
        return pd.DataFrame(), []
    layers = [l for l in layers if not l["identifier"].startswith("OrbitTracks")]  # track lines, not imagery
    if not layers:
        log("  no NISAR layer found in GIBS capabilities")
        add_summary("NASA Worldview / GIBS", "no NISAR layer")
        return pd.DataFrame(), []

    start = dt.date.fromisoformat(args.start) if args.start else dt.date(2026, 6, 1)
    end = dt.date.fromisoformat(args.end) if args.end else dt.date.today()
    asf_dates = set()
    if asf_df is not None and not asf_df.empty:
        asf_dates = {dt.date.fromisoformat(d) for d in asf_df.loc[asf_df["product"] == "GCOV", "date"].dropna()}

    pd.DataFrame([{**l, "time_values": " ; ".join(l["time_values"]), "tile_matrix_sets": ", ".join(l["tile_matrix_sets"])}
                  for l in layers]).to_csv(out / "gibs_layers.csv", index=False)
    for l in layers:
        log(f"  layer: {l['identifier']}  ({l['title']})  time: {' ; '.join(l['time_values'])[:120]}")

    region = aoi
    if args.gibs_bbox:  # zoom on one site, e.g. a dam: high-resolution snapshots
        region = box(*args.gibs_bbox)
        bbox, width = tuple(args.gibs_bbox), args.gibs_width
        asf_dates = set()  # check every available day for the site
    else:
        bbox, width = (aoi.bounds[0] - 0.2, aoi.bounds[1] - 0.2, aoi.bounds[2] + 0.2, aoi.bounds[3] + 0.2), 600
    height = int(width * (bbox[3] - bbox[1]) / (bbox[2] - bbox[0]))
    mask = tunisia_mask(region, bbox, width, height)
    (out / "gibs").mkdir(exist_ok=True)

    rows, frames = [], []
    for l in layers:
        dates = expand_time_values(l["time_values"], start, end)
        is_daily = "12" not in l["identifier"] and "12" not in l["title"]
        if is_daily and asf_dates:
            preferred = [d for d in dates if d in asf_dates]
            dates = preferred or dates
        if len(dates) > args.gibs_max:  # thin evenly
            step = len(dates) / args.gibs_max
            dates = [dates[int(i * step)] for i in range(args.gibs_max)]
        log(f"  {l['identifier']}: checking {len(dates)} dates...")
        for d in dates:
            try:
                png = gibs_snapshot(l["identifier"], d, bbox, width, height)
                frac = coverage_fraction(png, mask)
                fname = None
                if frac > 0.001:
                    fname = out / "gibs" / f"{l['identifier']}_{d.isoformat()}.png"
                    fname.write_bytes(png)
                    if is_daily and frac > 0.02:
                        frames.append((d, png))
                rows.append({"layer": l["identifier"], "date": d.isoformat(), "tunisia_covered_pct": round(100 * frac, 1),
                             "snapshot": str(fname) if fname else ""})
            except Exception as exc:  # noqa: BLE001
                rows.append({"layer": l["identifier"], "date": d.isoformat(), "tunisia_covered_pct": None,
                             "snapshot": "", "error": str(exc)[:120]})
            time.sleep(0.2)

    cov = pd.DataFrame(rows)
    cov.to_csv(out / "gibs_coverage.csv", index=False)
    if frames:
        make_gif(sorted(frames), bbox, width, height, region, out / "gibs_animation.gif")
    ok = cov[cov["tunisia_covered_pct"].fillna(0) > 0.1]
    log(f"  dates with NISAR imagery over Tunisia: {ok['date'].nunique()} "
        f"(snapshots in {out/'gibs'}, animation: {'yes' if frames else 'no'})")
    add_summary("NASA Worldview / GIBS", "ok", int(ok["date"].nunique()),
                ok["date"].min() if len(ok) else None, ok["date"].max() if len(ok) else None,
                "layers: " + ", ".join(l["identifier"] for l in layers) + " (counts = dates with imagery)")
    return cov, layers


def make_gif(frames, bbox, width, height, aoi, path):
    from PIL import Image, ImageDraw
    outline = tunisia_mask(aoi, bbox, width, height)
    imgs = []
    for d, png in frames:
        base = Image.new("RGBA", (width, height), (20, 20, 30, 255))
        layer = Image.open(io.BytesIO(png)).convert("RGBA")
        base.alpha_composite(layer)
        edge = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        edge.putalpha(outline.point(lambda v: 40 if v else 0))
        base.alpha_composite(edge)
        draw = ImageDraw.Draw(base)
        draw.rectangle([0, 0, width, 28], fill=(0, 0, 0, 180))
        draw.text((8, 7), f"NISAR L-band (NASA Worldview/GIBS)  {d.isoformat()}", fill=(255, 255, 255, 255))
        imgs.append(base.convert("P", palette=Image.ADAPTIVE))
    imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=700, loop=0)


# ==========================================================================
# 4. ISRO Bhoonidhi (STAC)
# ==========================================================================
def bhoonidhi_token(user, password):
    r = requests.post(f"{BHOONIDHI_API}/auth/token",
                      json={"userId": user, "password": password, "grant_type": "password"},
                      headers={**UA, "Content-Type": "application/json"}, timeout=60)
    if r.status_code != 200:
        hint = {401: "user id/password refused, or API access not enabled for this account "
                     "(email bhoonidhi@nrsc.gov.in to enable it)",
                429: "too many logins (limit 20/hour), wait and retry"}.get(r.status_code, "")
        raise RuntimeError(f"HTTP {r.status_code} from /auth/token: {r.text[:300]!r}  -> {hint}")
    return r.json()["access_token"]


def bhoonidhi_collections(token):
    r = http_get(f"{BHOONIDHI_API}/data/collections", headers={"Authorization": f"Bearer {token}"})
    js = r.json()
    items = js.get("collections", js) if isinstance(js, dict) else js
    ids = [c.get("id") if isinstance(c, dict) else str(c) for c in items]
    return [i for i in ids if i and "NISAR" in i.upper()]


BHOONIDHI_VARIANT = {}  # remembers which request format the server accepted


def _bh_variants(collection, geom_geojson, datetime_range, bbox):
    d0, d1 = datetime_range.split("/")
    ms = f"{d0.replace('Z', '.000Z')}/{d1.replace('Z', '.000Z')}"
    bb = [round(v, 4) for v in bbox]
    acc_json = {"Accept": "application/json"}
    acc_geo = {"Accept": "application/geo+json"}
    return [
        ("POST bbox", "POST", {"collections": [collection], "bbox": bb, "datetime": datetime_range, "limit": 500}, acc_json),
        ("POST bbox ms-dates", "POST", {"collections": [collection], "bbox": bb, "datetime": ms, "limit": 500}, acc_json),
        ("POST intersects", "POST", {"collections": [collection], "intersects": geom_geojson,
                                     "datetime": datetime_range, "limit": 500}, acc_json),
        ("POST bbox geo+json", "POST", {"collections": [collection], "bbox": bb, "datetime": datetime_range, "limit": 100}, acc_geo),
        ("POST bbox no-date", "POST", {"collections": [collection], "bbox": bb, "limit": 500}, acc_json),
        ("GET params", "GET", {"collections": collection, "bbox": ",".join(map(str, bb)),
                               "datetime": datetime_range, "limit": 500}, acc_json),
        ("GET params no-date", "GET", {"collections": collection, "bbox": ",".join(map(str, bb)), "limit": 500}, acc_json),
    ]


def _bh_request(method, url, payload, headers):
    for attempt in range(4):
        if method == "POST":
            r = requests.post(url, json=payload, headers={**UA, **headers}, timeout=120)
        else:
            r = requests.get(url, params=payload, headers={**UA, **headers}, timeout=120)
        if r.status_code == 429:
            time.sleep(2 ** attempt * 2)
            continue
        return r
    return r


def bhoonidhi_search(token, collection, geom_geojson, datetime_range, bbox, max_pages=40, verbose=True):
    auth = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{BHOONIDHI_API}/data/search"
    variants = _bh_variants(collection, geom_geojson, datetime_range, bbox)
    if BHOONIDHI_VARIANT.get("name"):
        variants.sort(key=lambda v: v[0] != BHOONIDHI_VARIANT["name"])
    js, used, errors = None, None, []
    for name, method, payload, extra in variants:
        r = _bh_request(method, url, payload, {**auth, **extra})
        if r.status_code == 200:
            js, used = r.json(), (name, method, payload, extra)
            BHOONIDHI_VARIANT["name"] = name
            break
        errors.append(f"{name}: HTTP {r.status_code} {r.text[:160]!r}")
        time.sleep(0.4)
    if js is None:
        raise RuntimeError("all request formats refused ->\n      " + "\n      ".join(errors))
    if verbose and errors:
        log(f"    (server accepted format '{used[0]}')")

    feats = list(js.get("features", []))
    name, method, payload, extra = used
    for _ in range(max_pages - 1):
        nxt = next((l for l in js.get("links", []) if l.get("rel") == "next"), None)
        if not nxt or not js.get("features"):
            break
        time.sleep(0.4)  # API limit: 3 searches / second
        m = nxt.get("method", method).upper()
        body = nxt.get("body") or payload
        r = _bh_request(m, nxt.get("href", url), body if m == "POST" else None, {**auth, **extra})
        if r.status_code != 200:
            log(f"    ! next page refused: HTTP {r.status_code} {r.text[:160]!r}")
            break
        js = r.json()
        feats.extend(js.get("features", []))
    return feats


def _feature_date(props):
    for k in ("datetime", "start_datetime", "DateOfPass", "Date_of_Pass", "acquisition_date", "DOP"):
        if props.get(k):
            return str(props[k])
    for k, v in props.items():
        if v and ("date" in k.lower() or "time" in k.lower()):
            return str(v)
    return None


def run_bhoonidhi(aoi, qpoly, args, out):
    log("\n[4/6] ISRO Bhoonidhi (S-band, joint L+S, ISRO L-band)")
    user = args.bhoonidhi_user or os.environ.get("BHOONIDHI_USER")
    if not user:
        log("  skipped: no Bhoonidhi login. Register at https://bhoonidhi.nrsc.gov.in and rerun with "
            "--bhoonidhi-user ID (or set BHOONIDHI_USER / BHOONIDHI_PASSWORD).")
        add_summary("ISRO Bhoonidhi", "skipped (no login)", notes="search manually in Browse & Order")
        return pd.DataFrame()
    password = os.environ.get("BHOONIDHI_PASSWORD") or getpass.getpass("  Bhoonidhi password: ")
    try:
        token = bhoonidhi_token(user, password)
        try:
            cols = bhoonidhi_collections(token) or BHOONIDHI_DOC_COLLECTIONS
        except Exception:  # noqa: BLE001
            cols = BHOONIDHI_DOC_COLLECTIONS
        log(f"  NISAR collections: {', '.join(cols)}")
        geom = mapping(qpoly)
        rng = f"{args.start or '2025-07-30'}T00:00:00Z/{args.end or dt.date.today().isoformat()}T23:59:59Z"
        rows, failed = [], 0
        for c in cols:
            try:
                feats = bhoonidhi_search(token, c, geom, rng, qpoly.bounds)
            except Exception as exc:  # noqa: BLE001
                log(f"  ! {c}: {exc}")
                failed += 1
                continue
            for f in feats:
                g = shape(f["geometry"]) if f.get("geometry") else None
                if g is not None and not g.intersects(aoi):
                    continue
                props = f.get("properties", {}) or {}
                row = {"platform": "Bhoonidhi", "sceneName": f.get("id"), "collection": f.get("collection", c),
                       "product": f.get("collection", c), "maturity": "ISRO Bhoonidhi",
                       "startTime": _feature_date(props), "geometry_wkt": g.wkt if g is not None else None,
                       "download": f"{BHOONIDHI_API}/download?id={f.get('id')}&collection={f.get('collection', c)}"}
                row.update({f"p_{k}": v for k, v in props.items() if isinstance(v, (str, int, float, bool))})
                rows.append(row)
            log(f"  {c}: {sum(1 for r in rows if r['collection'] == c)} products over Tunisia")
            time.sleep(0.4)
    except Exception as exc:  # noqa: BLE001
        log(f"  ! Bhoonidhi error: {exc}")
        add_summary("ISRO Bhoonidhi", f"error: {exc}")
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.drop_duplicates(subset=["sceneName", "collection"])
    df = finalize_df(df)
    if df.empty and failed == len(cols):
        add_summary("ISRO Bhoonidhi", "error: every search refused", notes="see messages above")
        return df
    if df.empty:
        add_summary("ISRO Bhoonidhi", "ok, nothing over Tunisia", notes=f"{failed} collections failed")
        return df
    df.to_csv(out / "bhoonidhi_inventory.csv", index=False)
    add_summary("ISRO Bhoonidhi", "ok", len(df), df["date"].min(), df["date"].max(),
                ", ".join(f"{k}={v}" for k, v in df["collection"].value_counts().items()))
    return df


# ==========================================================================
# 5. Microsoft Planetary Computer   6. Google Earth Engine catalog
# ==========================================================================
def run_planetary_computer(qpoly, out):
    log("\n[5/6] Microsoft Planetary Computer")
    try:
        cols = http_get(f"{PC_STAC}/collections").json().get("collections", [])
        hits = [c for c in cols if "nisar" in (c.get("id", "") + c.get("title", "") + c.get("description", "")).lower()]
        if not hits:
            log(f"  no NISAR collection among {len(cols)} collections")
            add_summary("Microsoft Planetary Computer", "no NISAR collection", 0)
            return
        n = 0
        for c in hits:
            r = http_post(f"{PC_STAC}/search", json={"collections": [c["id"]], "intersects": mapping(qpoly), "limit": 1000})
            k = len(r.json().get("features", []))
            n += k
            log(f"  {c['id']}: {k} items over Tunisia (first page)")
        add_summary("Microsoft Planetary Computer", "ok", n, notes=", ".join(c["id"] for c in hits))
    except Exception as exc:  # noqa: BLE001
        log(f"  ! {exc}")
        add_summary("Microsoft Planetary Computer", f"error: {exc}")


def run_gee():
    log("\n[6/6] Google Earth Engine public catalog")
    try:
        root = http_get(GEE_STAC).json()
        children = [l for l in root.get("links", []) if l.get("rel") == "child"]
        found = [l for l in children if "nisar" in (l.get("href", "") + l.get("title", "")).lower()]
        providers = [l for l in children if re.search(r"nasa|jpl|isro|asf|nisar", (l.get("href", "") + l.get("title", "")), re.I)]
        for p in providers:
            try:
                sub = http_get(p["href"]).json()
                found += [l for l in sub.get("links", []) if "nisar" in (l.get("href", "") + l.get("title", "")).lower()]
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.1)
        if found:
            names = sorted({l.get("title") or l.get("href") for l in found})
            log("  found: " + ", ".join(names))
            add_summary("Google Earth Engine", "NISAR listed", len(names), notes="; ".join(names))
        else:
            log(f"  no NISAR dataset (scanned {len(children)} providers, {len(providers)} in depth)")
            add_summary("Google Earth Engine", "no NISAR dataset", 0)
    except Exception as exc:  # noqa: BLE001
        log(f"  ! {exc}")
        add_summary("Google Earth Engine", f"error: {exc}")


# ==========================================================================
# Map and timeline
# ==========================================================================
def make_map(aoi, asf_df, bh_df, gibs_layers, gibs_cov, out):
    import folium
    from branca.colormap import linear

    m = folium.Map(location=[34.0, 9.5], zoom_start=6, tiles="OpenStreetMap", control_scale=True)
    folium.TileLayer("Esri.WorldImagery", name="Satellite (Esri)").add_to(m)
    folium.GeoJson(mapping(aoi), name="Tunisia",
                   style_function=lambda _: {"color": "black", "weight": 2, "fillOpacity": 0}).add_to(m)

    # GIBS live NISAR layer(s), latest date with imagery over Tunisia
    for l in gibs_layers or []:
        sub = gibs_cov[(gibs_cov["layer"] == l["identifier"]) & (gibs_cov["tunisia_covered_pct"].fillna(0) > 1)] \
            if gibs_cov is not None and not gibs_cov.empty else pd.DataFrame()
        if sub.empty:
            continue
        date = sub["date"].max()
        folium.raster_layers.WmsTileLayer(
            url=GIBS_WMS.format(epsg=3857), layers=l["identifier"], fmt="image/png", transparent=True,
            version="1.1.1", name=f"Worldview: {l['title'] or l['identifier']} ({date})",
            attr="NASA GIBS / Worldview", show=False, time=date).add_to(m)

    def footprint_layers(df, label, color_by_count=True):
        if df is None or df.empty or "geometry_wkt" not in df or df["geometry_wkt"].isna().all():
            return
        d = df[df["geometry_wkt"].notna()].copy()
        keys = ["product", "flightDirection", "track", "frame"] if "track" in d else ["product", "geometry_wkt"]
        for k in keys:
            if k not in d:
                d[k] = None
        g = (d.groupby(keys, dropna=False)
               .agg(n_dates=("date", "nunique"), first=("date", "min"), last=("date", "max"),
                    geometry=("geometry_wkt", "first")).reset_index())
        cmap = linear.YlOrRd_09.scale(1, max(int(g["n_dates"].max()), 2))
        for prod in sorted(g["product"].dropna().unique(), key=lambda p: (p != "GCOV", str(p))):
            fg = folium.FeatureGroup(name=f"{label}: {prod}", show=(label == "ASF" and prod == "GCOV"))
            for _, r in g[g["product"] == prod].iterrows():
                c = cmap(r["n_dates"])
                tip = f"{label} {prod} {r.get('flightDirection') or ''} T{r.get('track')} F{r.get('frame')}: " \
                      f"{r['n_dates']} dates ({r['first']} → {r['last']})"
                folium.GeoJson(mapping(shapely_wkt.loads(r["geometry"])), tooltip=tip,
                               style_function=lambda _, c=c: {"color": c, "weight": 1, "fillColor": c,
                                                              "fillOpacity": 0.25}).add_to(fg)
            fg.add_to(m)
        cmap.caption = f"{label}: number of dates per footprint"
        cmap.add_to(m)

    footprint_layers(asf_df, "ASF")
    footprint_layers(bh_df, "Bhoonidhi")

    sites = sites_coverage(asf_df) if asf_df is not None and not asf_df.empty else pd.DataFrame()
    fg = folium.FeatureGroup(name="Sites of interest (ASF GCOV dates)")
    for site, (lat, lon) in SITES.items():
        n = int(sites.loc[sites["site"] == site, "n_dates"].iloc[0]) if not sites.empty else 0
        color = "green" if n >= 5 else ("orange" if n else "red")
        folium.CircleMarker([lat, lon], radius=7, color=color, fill=True, fill_opacity=0.9,
                            tooltip=f"{site}: {n} GCOV dates").add_to(fg)
    fg.add_to(m)
    folium.LayerControl(collapsed=False).add_to(m)
    m.save(str(out / "map.html"))


def make_timeline(frames, out):
    import plotly.express as px
    frames = [f for f in frames if f is not None and not f.empty]
    if not frames:
        return
    d = pd.concat(frames, ignore_index=True)
    d = d.dropna(subset=["startTime"])
    if d.empty:
        return
    d["label"] = d["platform"] + " · " + d["product"].astype(str)
    fig = px.scatter(d, x="startTime", y="label", color="maturity", hover_data=["sceneName"],
                     title="NISAR products over Tunisia, all platforms (each dot = one product)", height=600)
    fig.update_traces(marker=dict(size=7, opacity=0.7))
    fig.write_html(str(out / "timeline.html"), include_plotlyjs="cdn")


# ==========================================================================
# Main
# ==========================================================================
def main():
    ap = argparse.ArgumentParser(description="Check all platforms for NISAR data over Tunisia")
    ap.add_argument("--start", help="YYYY-MM-DD")
    ap.add_argument("--end", help="YYYY-MM-DD")
    ap.add_argument("--products", nargs="+", default=SCIENCE_PRODUCTS, help="ASF product types")
    ap.add_argument("--skip", nargs="*", default=[], choices=["asf", "cmr", "gibs", "bhoonidhi", "pc", "gee"])
    ap.add_argument("--asf-from-csv", help="reuse an ASF inventory CSV instead of searching again")
    ap.add_argument("--gibs-max", type=int, default=40, help="max dates to snapshot per GIBS layer")
    ap.add_argument("--gibs-bbox", nargs=4, type=float, metavar=("LON_MIN", "LAT_MIN", "LON_MAX", "LAT_MAX"),
                    help="zoom GIBS snapshots on one area, e.g. Sidi Salem: 9.25 36.52 9.50 36.68")
    ap.add_argument("--gibs-width", type=int, default=1200, help="snapshot width in pixels with --gibs-bbox")
    ap.add_argument("--bhoonidhi-user", help="Bhoonidhi user id (password asked interactively)")
    ap.add_argument("--out", default="nisar_all_platforms_output")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    aoi, src = load_tunisia_outline(out)
    qpoly = query_polygon(aoi)
    log(f"Area: Tunisia ({src})")

    asf_df = run_asf(aoi, qpoly, args, out) if "asf" not in args.skip else pd.DataFrame()
    if "cmr" not in args.skip:
        run_cmr(qpoly, args, out)
    gibs_cov, gibs_layers = run_gibs(aoi, asf_df, args, out) if "gibs" not in args.skip else (pd.DataFrame(), [])
    bh_df = run_bhoonidhi(aoi, qpoly, args, out) if "bhoonidhi" not in args.skip else pd.DataFrame()
    if "pc" not in args.skip:
        run_planetary_computer(qpoly, out)
    if "gee" not in args.skip:
        run_gee()

    log("\nBuilding map and timeline...")
    try:
        make_map(aoi, asf_df, bh_df, gibs_layers, gibs_cov, out)
        make_timeline([asf_df, bh_df], out)
    except Exception as exc:  # noqa: BLE001
        log(f"  ! map/timeline: {exc}")

    summary = pd.DataFrame(SUMMARY)
    summary.to_csv(out / "platforms_summary.csv", index=False)
    log("\n" + "=" * 90 + "\nSUMMARY: NISAR DATA OVER TUNISIA, ALL PLATFORMS\n" + "=" * 90)
    with pd.option_context("display.max_colwidth", 70, "display.width", 200):
        log(summary.to_string(index=False))
    log(f"\nOpen {out/'map.html'} and {out/'timeline.html'} in your browser. All tables are in {out}/")


if __name__ == "__main__":
    main()