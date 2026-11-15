#!/usr/bin/env python3
"""V2 · Building centroids from Microsoft Global ML Building Footprints (Planetary Computer `ms-buildings`, ODbL).

  python pipeline/v2/ms_buildings.py <dam_id> [<dam_id> …]

Overpass building downloads failed (HTTP 502/504 on every mirror, 15 Nov). This reads the GeoParquet partitions
(RegionName=<country>/quadkey=<level-9>) of the latest delta release that intersect the dam's corridor
(apps/web/public/data/v2/<dam>/vectors/corridor.geojson ⊕ 1 km), straight from Azure Blob with the Planetary Computer
SAS token (no adlfs), and keeps footprint centroids inside it.
Output: cache/v2/hydro/<dam>/ms_buildings_utm.npy (N × 2, EPSG:32632) + ms_buildings_meta.json. route_hand.py uses it
for the building counts when present. Needs pyarrow (installed with --target cache/v2/pylib, not in the venv).
"""
from __future__ import annotations

import json
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.append(str(ROOT / "cache/v2/pylib"))
import common  # noqa: E402,F401  (PROJ guard first)

import numpy as np  # noqa: E402

PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"


def log(*a):
    print(*a, flush=True)


def list_blobs(account, container, prefix, sas):
    import requests
    out, marker = [], ""
    while True:
        u = (f"https://{account}.blob.core.windows.net/{container}?restype=container&comp=list&prefix={prefix}"
             f"&{sas}" + (f"&marker={marker}" if marker else ""))
        r = requests.get(u, timeout=120)
        r.raise_for_status()
        x = ET.fromstring(r.content)
        out += [b.findtext("Name") for b in x.iter("Blob")]
        marker = x.findtext("NextMarker") or ""
        if not marker:
            return out


def run(dam):
    import planetary_computer as pc
    import pyarrow.parquet as pq
    import pystac_client
    import requests
    import shapely
    from pyproj import Transformer
    from shapely.geometry import shape
    cache = ROOT / "cache/v2/hydro" / dam
    corr = json.loads((ROOT / "apps/web/public/data/v2" / dam / "vectors/corridor.geojson").read_text("utf-8"))
    poly = shapely.union_all([shape(f["geometry"]) for f in corr["features"]]).buffer(1000)
    to_ll = Transformer.from_crs(32632, 4326, always_xy=True)
    to_utm = Transformer.from_crs(4326, 32632, always_xy=True)
    x0, y0, x1, y1 = poly.bounds
    lo0, la0 = to_ll.transform(x0, y0)
    lo1, la1 = to_ll.transform(x1, y1)
    bbox = [min(lo0, lo1) - 0.01, min(la0, la1) - 0.01, max(lo0, lo1) + 0.01, max(la0, la1) + 0.01]
    cat = pystac_client.Client.open(PC_STAC)
    items = [i for i in cat.search(collections=["ms-buildings"], bbox=bbox).items()
             if "msbuildings:quadkey" in i.properties]
    latest = max(i.properties["msbuildings:processing-date"] for i in items)
    items = [pc.sign(i) for i in items if i.properties["msbuildings:processing-date"] == latest]
    log(f"[{dam}] ms-buildings {latest}: {len(items)} quadkey partitions "
        f"{sorted((i.properties['msbuildings:region'], i.properties['msbuildings:quadkey']) for i in items)}")
    pts, n_all = [], 0
    pq_dir = ROOT / "cache/v2/ms_buildings"
    pq_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    for it in items:
        a = it.assets["data"]
        so = a.extra_fields["table:storage_options"]
        container, prefix = a.href.replace("abfs://", "").split("/", 1)
        for name in list_blobs(so["account_name"], container, prefix, so["credential"]):
            if not name.endswith(".parquet") and "part-" not in name:
                continue
            f = pq_dir / name.replace("/", "__")
            if not f.exists():
                r = requests.get(f"https://{so['account_name']}.blob.core.windows.net/{container}/{name}?{so['credential']}",
                                 timeout=600)
                r.raise_for_status()
                f.write_bytes(r.content)
            t = pq.read_table(f, columns=["geometry"])
            g = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
            c = shapely.get_coordinates(shapely.centroid(g))
            n_all += len(c)
            m = (c[:, 0] >= bbox[0]) & (c[:, 0] <= bbox[2]) & (c[:, 1] >= bbox[1]) & (c[:, 1] <= bbox[3])
            if m.any():
                ux, uy = to_utm.transform(c[m, 0], c[m, 1])
                p = np.c_[ux, uy]
                pts.append(p[shapely.contains_xy(poly, p[:, 0], p[:, 1])])
    P = np.vstack(pts) if pts else np.zeros((0, 2))
    n_raw = len(P)
    P = np.unique(np.round(P, 0), axis=0)            # "Africa" and country partitions can hold the same footprint
    log(f"[{dam}] dedupe: {n_raw} → {len(P)} centroids")
    np.save(cache / "ms_buildings_utm.npy", P)
    meta = dict(source="Microsoft Global ML Building Footprints (ms-buildings, Planetary Computer), ODbL",
                release=latest, partitions=len(items), footprints_read=int(n_all), in_corridor_plus_1km=int(len(P)), before_dedupe=int(n_raw),
                seconds=round(time.time() - t0))
    (cache / "ms_buildings_meta.json").write_text(json.dumps(meta, indent=1), "utf-8")
    log(f"[{dam}] {len(P)} building centroids in corridor ⊕ 1 km ({n_all} read, {meta['seconds']} s)")


if __name__ == "__main__":
    for d in sys.argv[1:]:
        run(d)
