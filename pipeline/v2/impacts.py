#!/usr/bin/env python3
"""V2 · HAND screening impacts for any dam (MODELLED) + the per-dam hydro report.

  python pipeline/v2/impacts.py <dam_id> [<dam_id> …] [--volumes 5 20 100]

Reads route_hand.py outputs (work/v2/<dam>/lut_rows.json, hand_30m.tif, exposure_30m.npz, villages.gpkg, tests.json)
and writes apps/web/public/data/v2/<dam>/impacts/impacts.json (contract Impacts). Scenarios "hand_s<V>" are SCREENING
volumes on the static HAND bathtub, not tied to any reported event and not ANUGA runs: arrival_h is null, max_depth_m is
the bathtub depth at the village's lowest built cell (OSM building or ≥ 25 % WorldCover built-up within 300 m of the
OSM place node). Tests F1 (areas ≤ wet), F2 (monotonic with volume), F3 (5 villages listed for a manual check).
Also writes work/v2/<dam>/hydro_report.md and updates hydro_layers.json. Scenario exploration, not a forecast.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402,F401  (PROJ guard first)
from common import contracts as C  # noqa: E402

import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RADIUS = 300.0


def log(*a):
    print(*a, flush=True)


def name_of(r):
    for k in ("name_fr", "name_en", "name"):
        v = r.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return str(r.get("osm_id"))


def village_min(field, T, vil, valid):
    k = int(np.ceil(RADIUS / 30)) + 1
    H, W = field.shape
    out = []
    for p in vil.geometry:
        r0, c0 = int((T.f - p.y) // 30), int((p.x - T.c) // 30)
        rs, cs = np.mgrid[max(r0 - k, 0):min(r0 + k + 1, H), max(c0 - k, 0):min(c0 + k + 1, W)]
        if rs.size == 0:
            out.append(np.nan)
            continue
        x, y = T.c + (cs + 0.5) * 30, T.f - (rs + 0.5) * 30
        m = (np.hypot(x - p.x, y - p.y) <= RADIUS) & valid[rs, cs]
        v = field[rs, cs][m]
        v = v[np.isfinite(v)]
        out.append(float(v.min()) if v.size else np.nan)
    return np.array(out)


def h_for_volume(rows, V):
    hs, vs = np.array([r["h"] for r in rows]), np.array([r["V_m3"] for r in rows])
    return None if V > vs[-1] else float(np.interp(V, np.r_[0, vs], np.r_[0, hs]))


def run(dam: str, volumes):
    import geopandas as gpd
    import rasterio
    from pyproj import Transformer
    wd = ROOT / "work/v2" / dam
    out = ROOT / "apps/web/public/data/v2" / dam
    rows = json.loads((wd / "lut_rows.json").read_text("utf-8"))
    tests = json.loads((wd / "tests.json").read_text("utf-8"))
    hl = json.loads((wd / "hydro_layers.json").read_text("utf-8"))
    with rasterio.open(wd / "hand_30m.tif") as s:
        hand, T = s.read(1).astype(np.float64), s.transform
    ex = np.load(wd / "exposure_30m.npz")
    corr, builtcell = ex["corr"], ex["builtcell"]
    vil = gpd.read_file(wd / "villages.gpkg")
    vmin = village_min(hand, T, vil, corr & builtcell)
    to_ll = Transformer.from_crs(32632, 4326, always_xy=True)
    hmin = hl["min_meaningful"]["h_m"]
    scen, rep = {}, {}
    for Vm in volumes:
        V = Vm * 1e6
        h = h_for_volume(rows, V)
        sid = f"hand_s{Vm:g}"
        if h is None:
            log(f"[{dam}] {sid}: beyond the LUT")
            continue
        wet = corr & (hand < h)
        hit = [i for i in np.argsort(vmin) if np.isfinite(vmin[i]) and vmin[i] < h]
        vl = [C.VillageImpact(name=name_of(vil.iloc[i]), arrival_h=None, max_depth_m=round(float(h - vmin[i]), 2))
              for i in hit]
        si = C.ScenarioImpact(cropland_ha=round(float(ex["crop"][wet].sum() * 0.09), 1),
                              builtup_ha=round(float(ex["built"][wet].sum() * 0.09), 1),
                              buildings=int(ex["bld"][wet].sum()), road_km=round(float(ex["road"][wet].sum() / 1000), 2),
                              villages=vl)
        scen[sid] = si
        wet_ha = float(wet.sum() * 0.09)
        rep[sid] = dict(volume_m3=V, h_m=round(h, 3), below_min_meaningful=bool(h < hmin), wet_ha=round(wet_ha, 1),
                        area_km2=round(wet_ha / 100, 3), mean_depth_m=round(V / max(wet_ha * 1e4, 1), 3),
                        population=round(float(ex["pop"][wet].sum())), **si.model_dump(mode="json"),
                        F1=dict(cropland_plus_builtup_ha=si.cropland_ha + si.builtup_ha, wet_ha=wet_ha,
                                passed=bool(si.cropland_ha + si.builtup_ha <= wet_ha + 1e-6)),
                        F3_spot_check=[dict(name=name_of(vil.iloc[i]), osm_id=str(vil.osm_id[i]), place=vil.place[i],
                                            lonlat=[round(v, 5) for v in to_ll.transform(vil.geometry[i].x,
                                                                                         vil.geometry[i].y)],
                                            depth_at_lowest_built_cell_m=round(float(h - vmin[i]), 2)) for i in hit[:5]])
        log(f"[{dam}] {sid}: h {h:.2f} m, {wet_ha / 100:.1f} km², crop {si.cropland_ha} ha, {len(vl)} villages, "
            f"{rep[sid]['population']} people, {si.buildings} buildings, {si.road_km} km roads")
    order = sorted(rep, key=lambda k: rep[k]["volume_m3"])
    keys = ("wet_ha", "cropland_ha", "builtup_ha", "buildings", "road_km", "population")
    f2 = {k: bool(all(rep[b][k] >= rep[a][k] for a, b in zip(order, order[1:]))) for k in keys}
    f2["villages"] = bool(all(len(rep[b]["villages"]) >= len(rep[a]["villages"]) for a, b in zip(order, order[1:])))
    rep["F2"] = dict(order=order, monotonic=f2, passed=bool(all(f2.values())))
    (wd / "impacts_report.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False), "utf-8")
    imp = C.Impacts(
        badge="MODELLED", placeholder=False,
        source=f"HAND bathtub ({hl['dem_label']}); ESA WorldCover 2021; WorldPop 2020; OpenStreetMap contributors (ODbL)"
               + ("; Microsoft Global ML Building Footprints (ODbL)"
                  if str(hl.get("exposure_available", {}).get("buildings_source", "")).startswith("Microsoft") else ""),
        method=f"Screening volumes {', '.join(f'{v:g}' for v in volumes)} Mm³ (not tied to any reported event) on the "
               "static HAND volume→stage table of the whole corridor (flood/hand_lut.json). Wet = HAND < h. Cropland/"
               "built-up = WorldCover 2021 class 40/50 area fractions; buildings = building centroids (Microsoft ML footprints where available, else OSM); roads = OSM highway "
               "lines of all classes; villages = OSM place nodes whose lowest built cell within 300 m is below h, depth "
               "= h − HAND there. No timing: arrival_h is null (needs ANUGA).",
        uncertainty="Scenario exploration, not a forecast. 30 m terrain. Static bathtub: one water height along the whole "
                    "corridor at once, no timing or attenuation. Exposure, not damage. OSM buildings and roads are "
                    f"incomplete (lower bounds){'' if hl.get('exposure_available', {}).get('roads', True) else '; roads only partly downloaded (see hand_lut uncertainty)'}"
                    f"{'' if hl.get('exposure_available', {}).get('buildings', True) else '; BUILDINGS NOT AVAILABLE: 0 = not counted'}. Volumes below {hl['min_meaningful']['V_m3'] / 1e6:.1f} Mm³ "
                    f"(h < {hmin:g} m) are not meaningful.",
        dam_id=dam, scenarios=scen)
    p = out / C.BUNDLE_PATHS["impacts"]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(imp.model_dump(mode="json", by_alias=True), indent=1, ensure_ascii=False), "utf-8")
    C.Impacts.model_validate_json(p.read_text("utf-8"))
    hl["impacts"] = "impacts/impacts.json"
    hl["files"]["impacts/impacts.json"] = p.stat().st_size
    hl["screening_scenarios"] = {k: dict(volume_m3=v["volume_m3"], h_m=v["h_m"], below_min_meaningful=v[
        "below_min_meaningful"]) for k, v in rep.items() if k.startswith("hand_")}
    scene_png(dam, hand, T, hl, out)
    (wd / "hydro_layers.json").write_text(json.dumps(hl, indent=1, ensure_ascii=False), "utf-8")
    report(dam, tests, rows, rep, hl)


def scene_png(dam, hand, T, hl, out):
    """HAND also on geo-pipeline's terrain/grid.json (scene grid), area-averaged, V1 encoding; only where they overlap."""
    from PIL import Image
    from rasterio.transform import from_bounds
    from rasterio.warp import Resampling, reproject
    gp = out / "terrain/grid.json"
    if not gp.exists():
        return
    gj = json.loads(gp.read_text("utf-8"))
    w, h = gj["size_px"]
    dst = np.full((h, w), np.nan, np.float32)
    reproject(hand.astype(np.float32), dst, src_transform=T, src_crs="EPSG:32632", src_nodata=np.nan,
              dst_transform=from_bounds(*gj["bounds_m"], w, h), dst_crs=gj["crs"], dst_nodata=np.nan,
              resampling=Resampling.average)
    enc = np.where(np.isfinite(dst), np.clip(np.round(dst * 100), 0, 65534), 65535).astype(np.uint16)
    Image.fromarray(enc).save(out / "flood/hand_scene.png", optimize=True)
    lay = dict(next(l for l in hl["layers"] if l["id"] == "hand"))
    lay.update(id="hand_scene", grid="scene", file="flood/hand_scene.png",
               label="Height above the river (HAND), scene grid",
               method=lay["method"].split(" Corridor grid")[0] + " Scene grid (terrain/grid.json): area-averaged from "
               f"30 m; covers only the part of the corridor inside the scene ({np.isfinite(dst).mean() * 100:.0f} % of "
               "scene pixels); uint16 cm, 65535 = no data.")
    C.Layer.model_validate(lay)
    hl["layers"] = [l for l in hl["layers"] if l["id"] != "hand_scene"] + [lay]
    hl["files"]["flood/hand_scene.png"] = (out / "flood/hand_scene.png").stat().st_size


def report(dam, t, rows, rep, hl):
    L = []
    a = L.append
    a(f"# Hydro report: {dam} (MODELLED)\n\n**Scenario exploration, not a forecast. 30 m terrain.**\n")
    a(f"- DEM used: **{hl['dem_label']}** ({t['dem_choice_reason']})")
    for w, v in t["variants"].items():
        a(f"  - variant `{w}`: path {v['length_km']:.1f} km → {v['end']}; D1 {'pass' if v['D1']['passed'] else 'FAIL'}; "
          f"D2 {v['D2']['pct_within_300m_osm_river']:.1f} % within 300 m of OSM rivers"
          + (f"; GEM-15 on {v['gem15_on_path_pct']:.0f} % of the path" if v.get("gem15_on_path_pct") is not None else "")
          + (f"; GEM−GLO-30 median {v['dem_info'].get('gem_minus_cop_median_m')} m" if v.get("dem_info") else ""))
    a(f"- GEM-15 tiles: used {t['gem15_tiles']['used']}, missing {t['gem15_tiles']['missing']}; corridor on GEM-15 "
      f"{t['corridor_gem15_pct']:.0f} %")
    a(f"- HydroRIVERS snap: {t['snap']}")
    a(f"- Crest: {t['crest']}; outlet {t['outlet']['dist_from_dam_m']:.0f} m from the dam point ({t['outlet']['rule']})")
    a(f"- OSM sources: {json.dumps(t.get('osm_sources', {}), ensure_ascii=False)}; counts {t['osm']}")
    a(f"\n## Flow path\n\n- Length **{t['length_km']:.1f} km**, end: **{t['end']}**, river (OSM): {t['river']}")
    d1, d2 = t["D1"], t["D2"]
    a(f"- **D1** {'✅' if d1['passed'] else '❌'}: reached end {d1['reached_end']} ({d1['stop_reason']}); conditioned max "
      f"uphill {d1['conditioned_max_uphill_m']:.2g} m; raw DEM max rise above running min "
      f"{d1['raw_max_rise_above_running_min_m']:.1f} m at km {d1['raw_max_rise_at_km']:.1f}; z {d1['z_start_m']:.1f} → "
      f"{d1['z_end_m']:.1f} m")
    a(f"- **D2** {'✅' if d2['passed'] else '❌'}: {d2['pct_within_300m_osm_river']:.1f} % of {d2['n']} samples within 300 m "
      f"of OSM rivers (HydroRIVERS {d2['pct_within_300m_hydrorivers']:.1f} %, not independent); median "
      f"{d2['median_m_osm']:.0f} m, p95 {d2['p95_m_osm']:.0f} m, longest run > 300 m {d2['longest_gt300m_run_km']:.1f} km")
    a("\n| km | reach break | kind | offset from path | source |\n|---:|---|---|---:|---|")
    for b in t["reach_breaks"]:
        a(f"| {b['dist_km']:.1f} | {b['name']} | {b['kind']} | {b.get('offset_m', '')} | {b['source']} |")
    a(f"\n## HAND LUT (whole corridor, {t['corridor_km2']:.0f} km²)\n")
    a(f"- **D3** {'✅' if t['D3']['passed'] else '❌'}: {len(rows)} rows, h 0.25 → {t['D3']['h_max_m']:g} m, V up to "
      f"{t['D3']['V_max_m3'] / 1e6:.0f} Mm³; monotonic {t['D3']['monotonic']}")
    mm = hl["min_meaningful"]
    a(f"- Minimum meaningful volume ≈ **{mm['V_m3'] / 1e6:.2f} Mm³** (h = {mm['h_m']} m); at h = 0.25 m "
      f"{rows[0]['area_km2']:.1f} km² are already 'wet' (depression-filled channel cells)")
    a("\n| V (Mm³) | h (m) | area km² | cropland ha | built-up ha | villages | people (WorldPop) | buildings | roads km |"
      "\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for k, e in t["D4"].items():
        if e.get("h_m") is None:
            a(f"| {k} | beyond LUT | | | | | | | |")
            continue
        a(f"| {k} | {e['h_m']:.2f}{' *' if e['below_min_meaningful'] else ''} | {e['area_km2']:.1f} | "
          f"{e['cropland_ha']:.0f} | {e['builtup_ha']:.0f} | {e['villages']} | {e['population']:.0f} | {e['buildings']} | "
          f"{e['road_km']:.1f} |")
    a("\n(* below the minimum meaningful stage)\n\n## Screening impacts (impacts/impacts.json)\n")
    for k, v in rep.items():
        if not k.startswith("hand_"):
            continue
        a(f"- **{k}** ({v['volume_m3'] / 1e6:g} Mm³): h {v['h_m']} m, {v['area_km2']} km², mean depth "
          f"{v['mean_depth_m']} m; F1 {'✅' if v['F1']['passed'] else '❌'}; villages: "
          + (", ".join(f"{x['name']} ({x['max_depth_m']} m)" for x in v["villages"]) or "none"))
        if v["F3_spot_check"]:
            a("  - F3 spot-check: " + "; ".join(f"{x['name']} {x['lonlat']}" for x in v["F3_spot_check"]))
    a(f"- **F2** {'✅' if rep['F2']['passed'] else '❌'}: {rep['F2']['monotonic']}")
    a("\n## Caveats the UI must show\n")
    for c in ["Scenario exploration, not a forecast. 30 m terrain.",
              "HAND bathtub: one height along the whole corridor at once; no timing (arrival needs ANUGA), no "
              "attenuation, no channel capacity.",
              "Screening volumes (5 / 20 / 100 Mm³) are not tied to any reported event at this dam.",
              f"Volumes below ≈ {mm['V_m3'] / 1e6:.1f} Mm³ are not meaningful on this terrain.",
              "GEM-15 is an experimental, model-predicted DTM (MODELLED); east of 10° E and in its masked water cells "
              "the terrain is Copernicus GLO-30, a surface model (trees, buildings raise it).",
              "No channel bathymetry; reservoirs and the sea are excluded from the corridor.",
              "Exposure, not damage. OSM buildings/roads are incomplete (lower bounds); WorldPop is a model.",
              "Villages count only when their own built cells are below the water height (not 'near a wet cell')."]:
        a(f"- {c}")
    a("\n## What an ANUGA run would need\n\nSee `work/v2/anuga_packages/<dam>.zip` (domain, inlet, outflow face, mesh "
      "zones, scenarios.json with the E4 mesh pair) and `colab/anuga_gpu_all_dams.ipynb`. Cost estimates are in "
      "scenarios.json.")
    (ROOT / "work/v2" / dam / "hydro_report.md").write_text("\n".join(L) + "\n", "utf-8")
    log(f"[{dam}] wrote work/v2/{dam}/hydro_report.md")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dams", nargs="+")
    ap.add_argument("--volumes", type=float, nargs="+", default=[5, 20, 100])
    a = ap.parse_args()
    for d in a.dams:
        run(d, a.volumes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
