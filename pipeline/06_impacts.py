#!/usr/bin/env python3
"""06 · Impacts (MODELLED): exposure inside each computed ANUGA scenario's max-depth footprint.

  python pipeline/06_impacts.py

Wet = ANUGA max depth > 0.1 m (30 m rasters written by `05_anuga_scenarios.py --post`). Per scenario: cropland ha
(WorldCover 40), built-up ha (50), OSM building centroids, OSM road km (all classes incl. tracks), population (WorldPop,
printed in the report only: the Impacts contract has no field for it), and villages (OSM place=village|town|hamlet
within 200 m of a wet cell) with earliest arrival and max depth within 200 m, sorted by arrival.
Tests F1 (areas ≤ wet area), F2 (monotonic with volume), F3 (5 villages listed with coordinates for a manual check).
Output: <bundle>/impacts/impacts.json (contract Impacts), work/anuga/impacts_report.json.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
from common import contracts as C  # noqa: E402

import numpy as np  # noqa: E402

WET_M = 0.1


def mod(name):
    spec = importlib.util.spec_from_file_location(name.replace(".", "_"), Path(__file__).with_name(name))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main() -> int:
    import geopandas as gpd
    import rasterio
    from pyproj import Transformer

    cfg = common.load_config()
    out = common.bundle_dir(cfg)
    b, r4 = mod("08_bundle.py"), mod("04_routing_hand.py")
    work = common.ROOT / "work"
    ctx = work / "context"
    index = json.loads((out / C.BUNDLE_PATHS["anuga_index"]).read_text("utf-8"))
    done = [s for s in index["scenarios"] if s["computed"] and (work / "anuga" / s["id"] / "maxdepth_30m.tif").exists()]
    if not done:
        print("no computed ANUGA scenario: impacts.json left untouched")
        return 0

    with rasterio.open(work / "worldcover_30m.tif") as s:
        wc, T = s.read(1), s.transform
    with rasterio.open(work / "pop_30m.tif") as s:
        pop = s.read(1).astype(np.float64)
    pop[pop < 0] = 0
    H, W = wc.shape
    roads = gpd.read_file(ctx / "roads.gpkg")
    bld = r4.point_count_raster(gpd.read_file(ctx / "buildings.gpkg"), T, (H, W))
    villages = gpd.read_file(ctx / "villages.gpkg")
    villages = villages[villages.place.isin(["village", "town", "hamlet"])].reset_index(drop=True)
    to_ll = Transformer.from_crs(32632, 4326, always_xy=True)
    road = None

    scen, rep, dems = {}, {}, set()
    for s in sorted(done, key=lambda s: s["volume_m3"]):
        sid = s["id"]
        od = work / "anuga" / sid
        dems.add(json.loads((od / "run.json").read_text("utf-8"))["dem"])
        with rasterio.open(od / "maxdepth_30m.tif") as f:
            maxd = f.read(1)
        with rasterio.open(od / "arrival_h_30m.tif") as f:
            arr = f.read(1)
        wet = maxd > WET_M
        if road is None:
            rr, cc = np.nonzero(wet)
            road = r4.road_length_raster(roads, T, (H, W), (T.c, T.f - H * 30, T.c + W * 30, T.f))
        v_arr = r4.village_min(np.where(wet, arr, np.nan), T, villages, 200.0, fn=np.nanmin)
        v_dep = r4.village_min(np.where(wet, maxd, np.nan), T, villages, 200.0, fn=np.nanmax)
        hit = [i for i in np.argsort(v_arr) if np.isfinite(v_arr[i])]
        vl = [C.VillageImpact(name=r4.village_name(villages.iloc[i]), arrival_h=round(float(v_arr[i]), 2),
                              max_depth_m=round(float(v_dep[i]), 2)) for i in hit]
        si = C.ScenarioImpact(cropland_ha=round(float((wet & (wc == 40)).sum() * 0.09), 1),
                              builtup_ha=round(float((wet & (wc == 50)).sum() * 0.09), 1),
                              buildings=int(bld[wet].sum()), road_km=round(float(road[wet].sum() / 1000), 2), villages=vl)
        scen[sid] = si
        wet_ha = float(wet.sum() * 0.09)
        rep[sid] = dict(volume_m3=s["volume_m3"], wet_ha=wet_ha, population=float(pop[wet].sum()),
                        **si.model_dump(mode="json"),
                        F1=dict(cropland_plus_builtup_ha=si.cropland_ha + si.builtup_ha, wet_ha=wet_ha,
                                passed=bool(si.cropland_ha + si.builtup_ha <= wet_ha + 1e-6)),
                        F3_spot_check=[dict(name=r4.village_name(villages.iloc[i]), osm_id=str(villages.osm_id[i]),
                                            place=villages.place[i],
                                            lon=round(to_ll.transform(villages.geometry[i].x, villages.geometry[i].y)[0], 5),
                                            lat=round(to_ll.transform(villages.geometry[i].x, villages.geometry[i].y)[1], 5),
                                            arrival_h=round(float(v_arr[i]), 2), max_depth_m=round(float(v_dep[i]), 2))
                                       for i in hit[:5]])
        print(sid, json.dumps({k: v for k, v in rep[sid].items() if k != "villages"}, ensure_ascii=False))
        print("   villages:", [(v.name, v.arrival_h, v.max_depth_m) for v in vl])

    order = sorted(rep, key=lambda k: rep[k]["volume_m3"])
    keys = ("wet_ha", "cropland_ha", "builtup_ha", "buildings", "road_km", "population")
    f2 = {k: bool(all(rep[b_][k] >= rep[a][k] for a, b_ in zip(order, order[1:]))) for k in keys}
    f2["villages"] = bool(all(len(rep[b_]["villages"]) >= len(rep[a]["villages"]) for a, b_ in zip(order, order[1:])))
    rep["F2"] = dict(order=order, monotonic=f2, passed=bool(all(f2.values())), n_scenarios=len(order))
    print("F2", json.dumps(rep["F2"]))
    (work / "anuga" / "impacts_report.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False), "utf-8")

    dem_txt = ", ".join(r4.DEM_LABEL[d] for d in sorted(dems))
    imp = C.Impacts(
        badge="MODELLED", placeholder=False,
        source="ANUGA scenarios (05_anuga_scenarios.py); ESA WorldCover 2021; OpenStreetMap contributors; "
               f"{', '.join(r4.DEM_SOURCE[d] for d in sorted(dems))}",
        method=f"Exposure inside the ANUGA max-depth footprint (depth > {WET_M} m) on the 30 m grid, Reach 1 only (dam → "
               f"Medjerda confluence). DEM: {dem_txt}. Cropland = WorldCover class 40, built-up = class 50; buildings = "
               "OSM building centroids; roads = OSM highway lines of all classes incl. tracks; villages = OSM "
               "place=village|town|hamlet within 200 m of a wet cell, arrival = earliest first time depth > 0.1 m within "
               "200 m, depth = max within 200 m.",
        uncertainty="Scenario exploration, not a forecast. Exposure, not damage: a wet cell is counted whatever the depth "
                    "above 0.1 m. 30 m terrain without channel bathymetry; OSM buildings and roads are incomplete in "
                    "rural Tunisia (counts are lower bounds); WorldCover 2021 has its own classification errors.",
        dam_id=cfg["dam"]["id"], scenarios=scen)
    b.write_json(out / C.BUNDLE_PATHS["impacts"], imp, force=True)
    print(f"wrote impacts/impacts.json ({(out / C.BUNDLE_PATHS['impacts']).stat().st_size} bytes), scenarios {list(scen)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
