#!/usr/bin/env python3
"""V2 · Self-contained ANUGA input package for one dam (MODELLED set-up; ANUGA itself runs offline only, GPL).

  python pipeline/v2/anuga_package.py --dam sidi-salem [--hand-max 15] [--area-fine 2500] [--coarse-factor 4]

Reads the outputs of route_hand.py (work/v2/<dam>/: dem30.tif, hand_30m.tif, drain_k_30m.tif, stop_30m.tif,
path_cells.npy, route.json) and writes work/v2/<dam>/anuga_package/ + work/v2/anuga_packages/<dam>.zip:

  dem_30m.tif        corridor DEM actually used by routing (GEM-15 30 m with GLO-30 in its gaps, or GLO-30)
  manning_30m.tif    Manning n from WorldCover area fractions (config anuga.manning)
  path_cells.npy     D8 path cells in the package grid (burned BURN_M in the mesh elevation, as V1)
  domain.json        domain polygon (EPSG:32632), outflow segment indices, inlet line at the crest outlet, mesh-zone
                     polygons (HAND < 5 m channel/flood-plain zone), landmarks for arrival (reach breaks + end)
  scenarios.json     5 / 20 / 100 Mm³ screening releases (12 h triangular, peak at 0.3 D) on a uniform fine mesh, plus
                     an E4 mesh-sensitivity pair: 20 Mm³ on a coarse uniform mesh (area × coarse-factor)
  README.txt

Domain (V1 05_anuga_scenarios.prepare, generalised): corridor cells with HAND < hand-max draining to the flow path up
to 1 km before its end, the piece connected to the outlet; the face that meets the downstream remainder, the sea or the
next reservoir is tagged 'outflow', the rest 'walls'. Scenario exploration, not a forecast. 30 m terrain.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402,F401  (PROJ guard first)

import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RES = 30.0
BURN_M = 2.0
VOLUMES_MM3 = (5, 20, 100)
DURATION_H = 12.0
SEC_PER_TRI_STEP = 1.1e-6      # V1 CPU (4 OpenMP threads): ≈ 33–48 min for 69,616 triangles, used for estimates only


def log(*a):
    print(*a, flush=True)


def read(p):
    import rasterio
    with rasterio.open(p) as s:
        return s.read(1), s.transform


def polygonize(mask, T):
    from rasterio import features
    from shapely.geometry import shape
    from shapely.ops import unary_union
    return unary_union([shape(g) for g, v in features.shapes(mask.astype(np.uint8), mask=mask, transform=T) if v == 1])


def largest(g):
    return max(g.geoms, key=lambda x: x.area) if hasattr(g, "geoms") else g


def build(dam: str, hand_max: float, area_fine: float, coarse_factor: float, finaltime_h: float | None):
    import rasterio
    import yaml
    from rasterio.transform import Affine
    from scipy import ndimage as ndi
    from shapely.geometry import Point, Polygon
    wd = ROOT / "work/v2" / dam
    pk = wd / "anuga_package"
    if pk.exists():
        shutil.rmtree(pk)
    pk.mkdir(parents=True)
    route = json.loads((wd / "route.json").read_text("utf-8"))
    tests = json.loads((wd / "tests.json").read_text("utf-8"))
    hand, T = read(wd / "hand_30m.tif")
    z, _ = read(wd / "dem30.tif")
    drain_k, _ = read(wd / "drain_k_30m.tif")
    stop, _ = read(wd / "stop_30m.tif")
    path = np.load(wd / "path_cells.npy")
    H, W = hand.shape
    px = T.c + (path[:, 1] + 0.5) * RES
    py = T.f - (path[:, 0] + 0.5) * RES
    cum = np.r_[0, np.cumsum(np.hypot(np.diff(px), np.diff(py)))] / 1000
    scale = route["length_km"] / cum[-1]
    k_end = int(np.searchsorted(cum * scale, route["length_km"] - 1.0))
    ok = np.isfinite(hand) & (hand < hand_max) & (drain_k >= 0)
    dom_m = ok & (drain_k < k_end)
    lab, _ = ndi.label(dom_m, structure=np.ones((3, 3)))
    lp = lab[path[:200, 0], path[:200, 1]]
    lp = lp[lp > 0]
    assert lp.size, "flow path start not inside the HAND domain"
    dom_m = lab == np.bincount(lp).argmax()
    beyond = ndi.binary_dilation((ok & (drain_k >= k_end)) | (stop > 0), iterations=4)
    dom = largest(polygonize(dom_m, T).buffer(90).buffer(-60))
    dom = Polygon(Polygon(dom.exterior).simplify(60).exterior)
    cor = polygonize(dom_m & (hand < 5), T).buffer(60).buffer(-30).intersection(dom.buffer(-200))
    cor = cor.buffer(-100).buffer(100)
    parts = [Polygon(g.exterior).simplify(60) for g in (cor.geoms if hasattr(cor, "geoms") else [cor])
             if g.geom_type == "Polygon" and g.area > 2e5]
    xy = np.array(dom.exterior.coords)[:-1]
    mid = (xy + np.roll(xy, -1, axis=0)) / 2
    r = np.clip(((T.f - mid[:, 1]) // RES).astype(int), 0, H - 1)
    c = np.clip(((mid[:, 0] - T.c) // RES).astype(int), 0, W - 1)
    outflow = [int(i) for i in np.nonzero(beyond[r, c])[0]]
    assert outflow, "no outflow segment found"
    i1 = int(np.searchsorted(cum, 0.3))
    d = np.array([px[i1] - px[0], py[i1] - py[0]])
    d /= np.hypot(*d)
    n = np.array([-d[1], d[0]])
    cen = np.array([px[2], py[2]])
    inlet = [list(cen - 60 * n), list(cen + 60 * n)]
    assert dom.contains(Point(*inlet[0])) and dom.contains(Point(*inlet[1])), "inlet line outside the domain"
    # landmarks: reach breaks inside the domain (arrival = first wet within 300 m of the path point)
    from shapely.geometry import LineString
    line = LineString(route["path_xy"])
    marks = []
    for b in route["breaks"]:
        p = line.interpolate(min(b["dist_km"], route["length_km"] - 1.2) * 1000)
        if dom.buffer(-30).contains(p):
            marks.append(dict(name=b["name"], kind=b.get("kind"), dist_km=b["dist_km"], xy=[p.x, p.y]))
    # crop rasters to the domain bbox + 1 km
    x0, y0, x1, y1 = dom.bounds
    c0, c1 = max(int((x0 - 1000 - T.c) // RES), 0), min(int((x1 + 1000 - T.c) // RES) + 1, W)
    r0, r1 = max(int((T.f - y1 - 1000) // RES), 0), min(int((T.f - y0 + 1000) // RES) + 1, H)
    Tc = Affine(RES, 0, T.c + c0 * RES, 0, -RES, T.f - r0 * RES)
    zc = z[r0:r1, c0:c1].astype(np.float32)
    # Manning from WorldCover fractions
    cfg = yaml.safe_load((ROOT / "config.yaml").read_text("utf-8"))
    man = cfg["anuga"]["manning"]
    wcz = np.load(ROOT / "cache/v2/hydro" / dam / "worldcover_frac_30m.npz")
    fc, fb, fw = (wcz[k][r0:r1, c0:c1].astype(np.float32) for k in ("crop", "built", "water"))
    rest = np.clip(1 - fc - fb - fw, 0, 1)
    mann = (fc * man["cropland"] + fb * man["builtup"] + fw * man["water"] + rest * man["grassland"]).astype(np.float32)
    prof = dict(driver="GTiff", height=zc.shape[0], width=zc.shape[1], count=1, dtype="float32", crs="EPSG:32632",
                transform=Tc, compress="deflate", predictor=3, tiled=True)
    with rasterio.open(pk / "dem_30m.tif", "w", **prof) as o:
        o.write(zc, 1)
    with rasterio.open(pk / "manning_30m.tif", "w", **prof) as o:
        o.write(mann, 1)
    pc = path - np.array([r0, c0])
    pc = pc[(pc[:, 0] >= 0) & (pc[:, 0] < zc.shape[0]) & (pc[:, 1] >= 0) & (pc[:, 1] < zc.shape[1])]
    np.save(pk / "path_cells.npy", pc.astype(np.int32))
    dom_km2 = dom.area / 1e6
    ft = finaltime_h or float(min(72, max(24, np.ceil(12 + route["length_km"] * 1000 / 0.8 / 3600))))
    domain = dict(dam_id=dam, crs="EPSG:32632", dem=tests["dem_chosen"], dem_label=tests.get("dem_choice_reason"),
                  origin=[float(xy[:, 0].min()), float(xy[:, 1].min())], domain=xy.tolist(), outflow_segments=outflow,
                  mesh_zones=[np.array(p.exterior.coords)[:-1].tolist() for p in parts], inlet_line=inlet,
                  outlet_xy=route["outlet_xy"], landmarks=marks, path_length_km=route["length_km"], end=route["end"],
                  domain_km2=dom_km2, zone_km2=sum(p.area for p in parts) / 1e6, hand_max_m=hand_max, burn_m=BURN_M,
                  outflow_len_m=float(sum(np.hypot(*(xy[(i + 1) % len(xy)] - xy[i])) for i in outflow)),
                  wet_threshold_m=0.1, manning=man, yieldstep_s=float(cfg["anuga"]["yieldstep_s"]))
    (pk / "domain.json").write_text(json.dumps(domain, ensure_ascii=False), "utf-8")
    # scenarios + cost estimate (triangles ≈ domain / (0.5 × max area); CFL dt ∝ sqrt(area))
    def est(area):
        ntri = dom_km2 * 1e6 / (0.55 * area)
        steps = ft * 3600 / (0.35 * np.sqrt(area) / 6.0)                 # dt ≈ 0.35·edge/(|u|+√gh), |u|+√gh ≈ 6 m/s
        return int(ntri), float(ntri * steps * SEC_PER_TRI_STEP / 3600)
    sc = []
    for V in VOLUMES_MM3:
        nt, hcpu = est(area_fine)
        sc.append(dict(id=f"s{V}_d12", volume_m3=V * 1e6, duration_h=DURATION_H, max_area_m2=area_fine, uniform=True,
                       finaltime_h=ft, label=f"{V} Mm³ over {DURATION_H:g} h (screening scenario, not tied to any event)",
                       est_triangles=nt, est_cpu_h=round(hcpu, 1), role="scenario"))
    nt, hcpu = est(area_fine * coarse_factor)
    sc.append(dict(id="s20_d12_coarse", volume_m3=20e6, duration_h=DURATION_H, max_area_m2=area_fine * coarse_factor,
                   uniform=True, finaltime_h=ft, label=f"20 Mm³, coarse mesh (E4 mesh-sensitivity pair of s20_d12)",
                   est_triangles=nt, est_cpu_h=round(hcpu, 1), role="mesh_sensitivity", pair_of="s20_d12"))
    (pk / "scenarios.json").write_text(json.dumps(dict(dam_id=dam, release="triangular, peak at 0.3 D, Q_peak = 2V/D",
                                                       scenarios=sc), indent=1, ensure_ascii=False), "utf-8")
    (pk / "README.txt").write_text(
        f"ANUGA input package for {dam} (MODELLED). Scenario exploration, not a forecast. 30 m terrain.\n"
        f"DEM: {tests['dem_chosen']} ({tests.get('dem_choice_reason')}). Domain {dom_km2:.0f} km², path "
        f"{route['length_km']:.1f} km to {route['end']}.\nRun: python anuga_run.py --package <this dir> --scenario s20_d12 "
        "--mode gpu|cpu|legacy\nVolumes are screening values, not reported events.\n", "utf-8")
    zp = ROOT / "work/v2/anuga_packages" / f"{dam}.zip"
    zp.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(pk.iterdir()):
            zf.write(f, f"{dam}/{f.name}")
    mb = zp.stat().st_size / 1e6
    assert mb < 50, f"package {mb:.1f} MB ≥ 50 MB"
    log(f"[{dam}] domain {dom_km2:.1f} km² ({len(xy)} vertices), zone {domain['zone_km2']:.1f} km² in {len(parts)} "
        f"polygons, outflow {len(outflow)} segments / {domain['outflow_len_m']:.0f} m, {len(marks)} landmarks, "
        f"finaltime {ft:g} h; zip {mb:.1f} MB")
    for s in sc:
        log(f"   {s['id']}: ≤ {s['max_area_m2']:g} m², ~{s['est_triangles']} triangles, ~{s['est_cpu_h']} h CPU (estimate)")
    return dict(zip=str(zp), mb=mb, domain_km2=dom_km2, scenarios=sc)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dam", nargs="+", required=True)
    ap.add_argument("--hand-max", type=float, default=15.0)
    ap.add_argument("--area-fine", type=float, default=2500.0, help="uniform max triangle area (V1 final: 2,500 m²)")
    ap.add_argument("--coarse-factor", type=float, default=4.0)
    ap.add_argument("--finaltime-h", type=float, default=None)
    a = ap.parse_args()
    for d in a.dam:
        build(d, a.hand_max, a.area_fine, a.coarse_factor, a.finaltime_h)
    return 0


if __name__ == "__main__":
    sys.exit(main())
