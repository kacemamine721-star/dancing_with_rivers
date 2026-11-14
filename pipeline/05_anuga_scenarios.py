#!/usr/bin/env python3
"""05 · ANUGA dam-release scenarios on Reach 1 (dam → Medjerda confluence). MODELLED: scenario exploration, not a forecast.

Run the hydraulics in Docker (ANUGA is GPL, offline only; nothing of it ships in the web app):
  docker run --rm -v "<repo>:/work" -w /work dwd-anuga:1 python pipeline/05_anuga_scenarios.py --scenario v21_d12
Post-process in the project venv (rasters, PNGs, stats, index.json, tests E1–E3, E7, D5):
  .venv/Scripts/python pipeline/05_anuga_scenarios.py --post v21_d12

Set-up (docs/03 §5.7, docs/07 §6)
  Domain    cells of the HAND corridor with HAND < 15 m that drain to the flow path upstream of (confluence + 2 km),
            largest piece, smoothed, one polygon. The cut face in the Medjerda plain is tagged 'outflow', the rest 'walls'.
  Mesh      config anuga.max_triangle_area_m2: corridor (HAND < 5 m) / elsewhere, × --coarsen.
  Elevation the DEM used by 04 (work/routing/<dem>/dem30.tif; GEM-15 (experimental) by default), bilinear at centroids,
            flow-path cells lowered 2 m (channel connectivity; same depth as the routing burn, but on the D8 path).
  Friction  Manning n from ESA WorldCover (config anuga.manning).
  Inflow    anuga.Inlet_operator on a short line at the dam outlet; triangular hydrograph, volume V, duration D,
            peak at 0.3 D, Q_peak = 2V/D.
  Boundary  Dirichlet stage below the bed on 'outflow' (free outflow), reflective walls. Dry start. DE0.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BURN_M = 2.0
WET_M = 0.1
MANNING_CLASS = {10: "trees", 20: "shrub", 30: "grassland", 40: "cropland", 50: "builtup", 60: "bare", 80: "water",
                 90: "grassland", 95: "trees", 100: "bare"}
ARRIVAL_STEP_H = 0.2            # arrival.png: 0 = not reached, else hours = value × 0.2
DEM_LABEL = {"gem15": "GEM-15 (experimental) bare-earth DTM 15 m block-averaged to 30 m", "nasadem": "NASADEM 30 m"}


def log(*a):
    print(*a, flush=True)


def load_cfg(path=None):
    import yaml
    return yaml.safe_load(Path(path or ROOT / "config.yaml").read_text(encoding="utf-8"))


def read(path):
    import rasterio
    with rasterio.open(path) as s:
        return s.read(1), s.transform


# ------------------------------------------------------------------------------------------------ set-up (shapely + rasterio)
def largest(geom):
    return max(geom.geoms, key=lambda g: g.area) if hasattr(geom, "geoms") else geom


def polygonize(mask, T):
    from rasterio import features
    from shapely.geometry import shape
    from shapely.ops import unary_union
    return unary_union([shape(g) for g, v in features.shapes(mask.astype(np.uint8), mask=mask, transform=T) if v == 1])


def prepare(dem: str, setup: Path, extra_km=2.0):
    from scipy import ndimage as ndi
    from shapely.geometry import Point, Polygon

    wr = ROOT / "work" / "routing" / dem
    o = json.loads((wr / "outlet.json").read_text("utf-8"))
    hand, T = read(wr / "hand_30m.tif")
    drain_k, _ = read(wr / "drain_k_30m.tif")
    path = np.load(wr / "path_cells.npy")
    px = T.c + (path[:, 1] + 0.5) * 30
    py = T.f - (path[:, 0] + 0.5) * 30
    cum = np.r_[0, np.cumsum(np.hypot(np.diff(px), np.diff(py)))] / 1000
    scale = o["length_km"] / cum[-1]                                    # staircase → simplified-line kilometres
    k_end = int(np.searchsorted(cum * scale, o["confluence_km"] + extra_km))
    ok = np.isfinite(hand) & (hand < 15) & (drain_k >= 0)
    dom_m = ok & (drain_k < k_end)
    beyond = ndi.binary_dilation(ok & (drain_k >= k_end), iterations=4)
    lab, _ = ndi.label(dom_m, structure=np.ones((3, 3)))
    dom_m = lab == lab[path[0, 0], path[0, 1]]
    dom = largest(polygonize(dom_m, T).buffer(90).buffer(-60))
    dom = Polygon(dom.exterior).simplify(60)
    dom = Polygon(dom.exterior)
    cor = polygonize(dom_m & (hand < 5), T).buffer(60).buffer(-30).intersection(dom.buffer(-200))
    cor = cor.buffer(-100).buffer(100)                                  # drop necks narrower than 200 m (sliver triangles)
    parts = [Polygon(g.exterior).simplify(60) for g in (cor.geoms if hasattr(cor, "geoms") else [cor])
             if g.geom_type == "Polygon" and g.area > 2e5]
    xy = np.array(dom.exterior.coords)[:-1]
    mid = (xy + np.roll(xy, -1, axis=0)) / 2
    r = ((T.f - mid[:, 1]) // 30).astype(int)
    c = ((mid[:, 0] - T.c) // 30).astype(int)
    outflow = [int(i) for i in np.nonzero(beyond[r, c])[0]]
    assert outflow, "no outflow segment found"
    ox, oy = o["outlet_xy"]
    # inlet line: perpendicular to the first 300 m of the path, 120 m long, 60 m downstream of the outlet cell
    i1 = int(np.searchsorted(cum, 0.3))
    d = np.array([px[i1] - px[0], py[i1] - py[0]])
    d /= np.hypot(*d)
    n = np.array([-d[1], d[0]])
    cen = np.array([px[2], py[2]])
    inlet = [list(cen - 60 * n), list(cen + 60 * n)]
    assert dom.contains(Point(*inlet[0])) and dom.contains(Point(*inlet[1])), "inlet line outside the domain"
    out = dict(dem=dem, origin=[float(xy[:, 0].min()), float(xy[:, 1].min())], domain=xy.tolist(), outflow_segments=outflow,
               corridor=[np.array(p.exterior.coords)[:-1].tolist() for p in parts], inlet_line=inlet,
               outlet_xy=[ox, oy], confluence_xy=o["confluence_xy"], confluence_km=o["confluence_km"],
               domain_km2=dom.area / 1e6, corridor_km2=sum(p.area for p in parts) / 1e6, k_end=k_end,
               outflow_len_m=float(sum(np.hypot(*(xy[(i + 1) % len(xy)] - xy[i])) for i in outflow)))
    setup.mkdir(parents=True, exist_ok=True)
    (setup / "domain.json").write_text(json.dumps(out), "utf-8")
    log(f"set-up: domain {out['domain_km2']:.1f} km² ({len(xy)} vertices), HAND<5 corridor {out['corridor_km2']:.1f} km² "
        f"in {len(parts)} polygon(s), outflow {len(outflow)} segments / {out['outflow_len_m']:.0f} m")
    return out


# ------------------------------------------------------------------------------------------------ run (Docker, ANUGA)
def hydrograph(V, D):
    Qp, tp = 2 * V / D, 0.3 * D
    return (lambda t: Qp * t / tp if t < tp else (Qp * (D - t) / (D - tp) if t < D else 0.0)), Qp


def run(sc: dict, cfg: dict, dem: str, coarsen: float, finaltime_h: float | None, uniform: bool = False):
    import anuga
    from scipy.interpolate import RegularGridInterpolator
    from scipy.ndimage import map_coordinates

    A = cfg["anuga"]
    setup = ROOT / "work" / "anuga" / "setup"
    S = prepare(dem, setup)
    od = ROOT / "work" / "anuga" / sc["id"]
    od.mkdir(parents=True, exist_ok=True)
    x0, y0 = S["origin"]
    loc = lambda pts: [[p[0] - x0, p[1] - y0] for p in pts]                 # noqa: E731  (local coordinates)
    bounding = loc(S["domain"])
    nseg = len(bounding)
    outflow = set(S["outflow_segments"])
    tags = {"walls": [i for i in range(nseg) if i not in outflow], "outflow": sorted(outflow)}
    a_cor = A["max_triangle_area_m2"]["corridor"] * coarsen
    a_else = A["max_triangle_area_m2"]["elsewhere"] * coarsen
    t0 = time.time()
    domain = anuga.create_domain_from_regions(
        bounding, boundary_tags=tags, maximum_triangle_area=a_cor if uniform else a_else,
        interior_regions=[] if uniform else [[loc(p), a_cor] for p in S["corridor"]],
        mesh_filename=str(od / "mesh.msh"), use_cache=False, verbose=False)
    domain.set_name(sc["id"])
    domain.set_datadir(str(od))
    domain.set_minimum_storable_height(0.01)
    domain.set_flow_algorithm("DE0")
    ntri = len(domain)
    rad = domain.radii
    log(f"mesh quality: area min/median/max {domain.areas.min():.0f}/{np.median(domain.areas):.0f}/{domain.areas.max():.0f} m², "
        f"inradius min/p1/median {rad.min():.2f}/{np.percentile(rad, 1):.2f}/{np.median(rad):.2f} m; uniform={uniform}")
    log(f"mesh: {ntri} triangles (corridor ≤ {a_cor:g} m², elsewhere ≤ {a_else:g} m²) in {time.time() - t0:.0f} s")

    wr = ROOT / "work" / "routing" / dem
    z, T = read(wr / "dem30.tif")
    z = z.astype(np.float64)
    path = np.load(wr / "path_cells.npy")
    z[path[:, 0], path[:, 1]] -= BURN_M
    wc, _ = read(ROOT / "work" / "worldcover_30m.tif")

    def rowcol(x, y):
        return (T.f - (np.asarray(y) + y0)) / 30 - 0.5, ((np.asarray(x) + x0) - T.c) / 30 - 0.5

    def elev(x, y):
        r, c = rowcol(x, y)
        return map_coordinates(z, [r, c], order=1, mode="nearest")

    man = cfg["anuga"]["manning"]

    def fric(x, y):
        r, c = rowcol(x, y)
        cls = wc[np.clip(np.rint(r).astype(int), 0, wc.shape[0] - 1), np.clip(np.rint(c).astype(int), 0, wc.shape[1] - 1)]
        return np.array([man.get(MANNING_CLASS.get(int(k), "grassland"), 0.035) for k in cls])

    domain.set_quantity("elevation", function=elev, location="centroids")
    domain.set_quantity("friction", function=fric, location="centroids")
    domain.set_quantity("stage", expression="elevation")

    V, D = sc["volume_mm3"] * 1e6, sc["duration_h"] * 3600.0
    Q, Qp = hydrograph(V, D)
    tt = np.linspace(0, D, 200001)
    V_analytic = float(getattr(np, "trapezoid", None)([Q(t) for t in tt], tt))
    inlet = anuga.Inlet_operator(domain, loc(S["inlet_line"]), Q=Q)
    del inlet
    cen = domain.get_centroid_coordinates()                                # local coords
    elev_c = domain.quantities["elevation"].centroid_values.copy()
    # outflow stage: 2 m below the lowest bed along the outflow face
    bxy = np.array(bounding)
    zmin = min(float(elev(*(((bxy[i] + bxy[(i + 1) % nseg]) / 2).T)[:, None])[0]) for i in outflow)
    seg_z = []
    for i in outflow:
        a, b = bxy[i], bxy[(i + 1) % nseg]
        s = np.linspace(0, 1, 20)
        seg_z.append(elev(a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])).min())
    zmin = float(min(seg_z))
    domain.set_boundary({"walls": anuga.Reflective_boundary(domain),
                         "outflow": anuga.Dirichlet_boundary([zmin - 2.0, 0.0, 0.0])})
    log(f"scenario {sc['id']}: V = {V / 1e6:g} Mm³, D = {D / 3600:g} h, Q_peak = {Qp:.0f} m³/s (scenario value); "
        f"∫Q dt = {V_analytic:.0f} m³; outflow stage {zmin - 2:.1f} m")

    areas = domain.areas.copy()
    ys = float(A["yieldstep_s"])
    ft = float(finaltime_h if finaltime_h is not None else A["finaltime_h"]) * 3600
    frame_dt = 1800.0
    maxd = np.zeros(ntri)
    maxs = np.zeros(ntri)
    arr = np.full(ntri, np.nan)
    frames, ftimes, series = [], [], []
    nan_seen = False
    wall0 = time.time()
    st, xm, ym = (domain.quantities[q].centroid_values for q in ("stage", "xmomentum", "ymomentum"))
    for t in domain.evolve(yieldstep=ys, finaltime=ft):
        dep = np.maximum(st - elev_c, 0)
        if not (np.isfinite(st).all() and np.isfinite(xm).all() and np.isfinite(ym).all()):
            nan_seen = True
        spd = np.where(dep > WET_M, np.hypot(xm, ym) / np.maximum(dep, 1e-6), 0.0)
        maxd = np.maximum(maxd, dep)
        maxs = np.maximum(maxs, spd)
        arr = np.where(np.isnan(arr) & (dep > WET_M), t, arr)
        vol = float(domain.get_water_volume())
        bfi = float(domain.get_boundary_flux_integral())
        fsi = float(domain.get_fractional_step_volume_integral())
        series.append([float(t), vol, bfi, fsi, float(Q(t)), float((dep > WET_M).dot(areas)), float(spd.max()),
                       float(dep.max())])
        if abs(t / frame_dt - round(t / frame_dt)) < 1e-6:
            frames.append(dep.astype(np.float32))
            ftimes.append(float(t))
        if abs(t / 3600 - round(t / 3600)) < 1e-6:
            log(f"  t = {t / 3600:5.1f} h | wall {time.time() - wall0:6.0f} s | volume {vol / 1e6:7.3f} Mm³ | out "
                f"{-bfi / 1e6:7.3f} Mm³ | in {fsi / 1e6:7.3f} Mm³ | wet {series[-1][5] / 1e6:6.2f} km² | "
                f"max speed {spd.max():.1f} m/s | {domain.timestepping_statistics()}")
    wall = time.time() - wall0
    tri = domain.triangles
    nodes = domain.nodes
    np.savez_compressed(od / "results.npz", centroids=cen + np.array([x0, y0]), nodes=nodes + np.array([x0, y0]),
                        triangles=tri, areas=areas, elevation=elev_c, max_depth=maxd.astype(np.float32),
                        max_speed=maxs.astype(np.float32), arrival_s=arr.astype(np.float32),
                        frames=np.array(frames, dtype=np.float16), frame_t=np.array(ftimes), series=np.array(series))
    s = np.array(series)
    meta = dict(id=sc["id"], dem=dem, volume_m3=V, duration_s=D, Q_peak_m3s=Qp, V_analytic_m3=V_analytic,
                triangles=int(ntri), coarsen=coarsen, uniform=bool(uniform), max_area_corridor_m2=a_cor, max_area_elsewhere_m2=a_else,
                wall_s=wall, finaltime_s=ft, yieldstep_s=ys, nan_seen=bool(nan_seen),
                final_volume_m3=float(s[-1, 1]), boundary_flux_integral_m3=float(s[-1, 2]),
                inflow_applied_m3=float(s[-1, 3]), domain_km2=S["domain_km2"], outflow_stage_m=zmin - 2.0,
                anuga_version=anuga.__version__, manning=man, burn_m=BURN_M)
    (od / "run.json").write_text(json.dumps(meta, indent=1), "utf-8")
    log(f"done in {wall / 60:.1f} min wall; results → {od}")


# ------------------------------------------------------------------------------------------------ post (venv)
def tri_index_raster(nodes, triangles, T, shape):
    from rasterio import features
    from shapely import polygons
    P = polygons(nodes[triangles])
    return features.rasterize(((g, i + 1) for i, g in enumerate(P)), out_shape=shape, transform=T, dtype="int32") - 1


def post(sid: str, cfg: dict, results_dir=None, frames_mb: float = 1.2):
    sys.path.insert(0, str(ROOT / "pipeline"))
    import importlib.util

    import common  # noqa: F401  (PROJ guard)
    from common import contracts as C
    import geopandas as gpd
    import rasterio
    from PIL import Image
    from rasterio.transform import from_bounds
    from rasterio.warp import Resampling, reproject

    def mod(name):
        spec = importlib.util.spec_from_file_location(name.replace(".", "_"), ROOT / "pipeline" / name)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    b = mod("08_bundle.py")
    r4 = mod("04_routing_hand.py")

    od = Path(results_dir) if results_dir else ROOT / "work" / "anuga" / sid
    meta = json.loads((od / "run.json").read_text("utf-8"))
    R = np.load(od / "results.npz")
    dem = meta["dem"]
    wr = ROOT / "work" / "routing" / dem
    with rasterio.open(wr / "hand_30m.tif") as s:
        hand, T, crs = s.read(1), s.transform, s.crs
    H, W = hand.shape
    idx = tri_index_raster(R["nodes"], R["triangles"], T, (H, W))
    inside = idx >= 0

    def to30(v, fill=np.nan):
        out = np.full((H, W), fill, np.float32)
        out[inside] = v[idx[inside]]
        return out

    maxd = to30(R["max_depth"].astype(np.float32), 0)
    maxs = to30(R["max_speed"].astype(np.float32), 0)
    arr_h = to30(R["arrival_s"] / 3600.0)
    wet = maxd > WET_M
    arr_h[~wet] = np.nan
    for name, a in (("maxdepth", maxd), ("maxspeed", maxs), ("arrival_h", arr_h)):
        r4.write_tif(od / f"{name}_30m.tif", a, T, crs, nodata=np.nan if name == "arrival_h" else None, dtype="float32")

    # ---- tests
    s = R["series"]
    V = meta["volume_m3"]
    t, vol, bfi, fsi = s[:, 0], s[:, 1], s[:, 2], s[:, 3]
    mb = (vol - (fsi + bfi)) / V                                           # ANUGA: boundary flux integral is + inward
    tests = {}
    tests["E1"] = dict(mass_balance_err=float(abs(mb[-1])), max_abs_during_run=float(np.abs(mb).max()),
                       inflow_applied_m3=float(fsi[-1]), out_through_boundary_m3=float(-bfi[-1]),
                       final_volume_in_domain_m3=float(vol[-1]), passed=bool(abs(mb[-1]) < 0.01))
    tests["E2"] = dict(V_scenario_m3=V, V_hydrograph_integral_m3=meta["V_analytic_m3"],
                       err_analytic=float(abs(meta["V_analytic_m3"] - V) / V), inflow_applied_by_anuga_m3=float(fsi[-1]),
                       err_applied=float(abs(fsi[-1] - V) / V),
                       passed=bool(abs(meta["V_analytic_m3"] - V) / V < 1e-3 and abs(fsi[-1] - V) / V < 1e-3))
    tri_wet = R["max_depth"] > WET_M
    inund_km2 = float(R["areas"][tri_wet].sum() / 1e6)
    high = float(np.nanpercentile(hand[wet], 99)) if wet.any() else 0.0
    tests["E3"] = dict(nan_seen=meta["nan_seen"], max_speed_m_s=float(R["max_speed"].max()),
                       speed_definition=f"|momentum|/depth at centroids where depth > {WET_M} m",
                       p99_speed_m_s=float(np.percentile(R["max_speed"][tri_wet], 99)) if tri_wet.any() else 0.0,
                       max_depth_m=float(R["max_depth"].max()), wet_cells_HAND_p99_m=high,
                       wet_cells_HAND_max_m=float(np.nanmax(hand[wet])) if wet.any() else 0.0,
                       passed=bool((not meta["nan_seen"]) and R["max_speed"].max() < 15))
    S = json.loads((ROOT / "work/anuga/setup/domain.json").read_text("utf-8"))
    cx, cy = S["confluence_xy"]
    d = np.hypot(R["centroids"][:, 0] - cx, R["centroids"][:, 1] - cy)
    near = (d < 300) & np.isfinite(R["arrival_s"])
    conf_arr = float(np.nanmin(R["arrival_s"][near]) / 3600) if near.any() else None
    tests["E7"] = dict(arrival_at_confluence_h=conf_arr, confluence_km=S["confluence_km"],
                       mean_front_speed_m_s=(S["confluence_km"] * 1000 / (conf_arr * 3600)) if conf_arr else None,
                       first_outflow_h=float(t[np.argmax(-bfi > 0.001 * V)] / 3600) if (-bfi > 0.001 * V).any() else None,
                       reported="water reached Sidi Salem on 21 Jun 2026 (≈ 3–4 days, REPORTED); the model's arrival at "
                                "the end of Reach 1 must be earlier (hours to ~1 day)",
                       passed=bool(conf_arr is not None and 1.0 <= conf_arr <= 30.0))
    # D5: HAND bathtub vs ANUGA max extent inside the ANUGA domain
    lut_all = json.loads((ROOT / cfg["bundle"]["out"] / "flood/hand_lut.json").read_text("utf-8"))["rows"]
    lut_r1 = json.loads((wr / "lut_reach1.json").read_text("utf-8"))
    d5 = {}
    for nm, rows in (("whole_corridor_LUT", lut_all), ("reach1_only_LUT", lut_r1)):
        h = r4.h_for_volume(rows, V)
        if h is None:
            continue
        hw = inside & np.isfinite(hand) & (hand < h)
        d5[nm] = dict(h_m=h, hand_km2=float(hw.sum() * 900 / 1e6), anuga_km2=float(wet.sum() * 900 / 1e6),
                      iou=float((hw & wet).sum() / max((hw | wet).sum(), 1)))
    best = max((v["iou"] for v in d5.values()), default=0)
    tests["D5"] = dict(**d5, passed=bool(best >= 0.4))

    # ---- villages
    villages = gpd.read_file(ROOT / "work/context/villages.gpkg")
    villages = villages[villages.place.isin(["village", "town", "hamlet"])].reset_index(drop=True)
    v_arr = r4.village_min(arr_h, T, villages, 200.0, fn=np.nanmin)
    v_dep = r4.village_min(np.where(wet, maxd, np.nan), T, villages, 200.0, fn=np.nanmax)
    hit = np.nonzero(np.isfinite(v_arr))[0]
    names = [r4.village_name(villages.iloc[i]) for i in hit]
    arrival = {n: round(float(v_arr[i]), 2) for n, i in zip(names, hit)}
    depth = {n: round(float(v_dep[i]), 2) for n, i in zip(names, hit)}
    (od / "villages.json").write_text(json.dumps([dict(
        name=n, osm_id=str(villages.osm_id[i]), place=villages.place[i], x=float(villages.geometry[i].x),
        y=float(villages.geometry[i].y), arrival_h=arrival[n], max_depth_m=depth[n]) for n, i in zip(names, hit)],
        ensure_ascii=False, indent=1), "utf-8")
    (od / "tests.json").write_text(json.dumps(tests, indent=1, ensure_ascii=False), "utf-8")
    for k, v in tests.items():
        log(k, json.dumps(v, ensure_ascii=False))

    # ---- web PNGs on the scene grid
    out = ROOT / cfg["bundle"]["out"]
    gj = json.loads((out / "terrain/grid.json").read_text("utf-8"))
    w, h = gj["size_px"]
    Tw = from_bounds(*gj["bounds_m"], w, h)

    def to_web(a, resampling):
        dst = np.zeros((h, w), np.float32)
        reproject(a.astype(np.float32), dst, src_transform=T, src_crs=crs, dst_transform=Tw, dst_crs=crs,
                  resampling=resampling, src_nodata=np.nan, dst_nodata=np.nan)
        return dst

    fd = out / "flood/anuga" / sid
    (fd / "frames").mkdir(parents=True, exist_ok=True)
    for f in (fd / "frames").glob("*.png"):
        f.unlink()
    MAXM = 8.0

    def depth_png(a30, path, thr):
        dw = np.nan_to_num(to_web(np.where(a30 > thr, a30, 0.0), Resampling.average))
        v = np.where(dw > thr / 2, np.clip(np.round(dw / MAXM * 255), 1, 255), 0).astype(np.uint8)
        Image.fromarray(v, "L").save(path, optimize=True)

    depth_png(maxd, fd / "maxdepth.png", WET_M)
    aw = to_web(arr_h, Resampling.min)
    av = np.where(np.isfinite(aw), np.clip(np.ceil(aw / ARRIVAL_STEP_H), 1, 255), 0).astype(np.uint8)
    Image.fromarray(av, "L").save(fd / "arrival.png", optimize=True)
    frames, ft = R["frames"].astype(np.float32), R["frame_t"]
    step = 1
    while True:
        sel = list(range(0, len(ft), step))
        for f in (fd / "frames").glob("*.png"):
            f.unlink()
        for i, k in enumerate(sel):
            depth_png(to30(frames[k], 0), fd / "frames" / f"{i}.png", 0.03)
        size = sum(f.stat().st_size for f in (fd / "frames").glob("*.png"))
        if size <= frames_mb * 1e6 or step >= 8:
            break
        step *= 2
    dt_s = float(ft[1] - ft[0]) * step
    log(f"frames: {len(sel)} every {dt_s / 60:.0f} min, {size / 1e6:.2f} MB")

    stats = C.AnugaStats(mass_balance_err=float(abs(mb[-1])), peak_Q_m3s=float(meta["Q_peak_m3s"]),
                         inundated_km2=round(inund_km2, 3), arrival_h=arrival, max_depth_m=depth)
    (fd / "stats.json").write_text(json.dumps(stats.model_dump(mode="json"), indent=1, ensure_ascii=False) + "\n", "utf-8")

    # ---- index.json
    ip = out / C.BUNDLE_PATHS["anuga_index"]
    index = json.loads(ip.read_text("utf-8"))
    mesh_txt = (f"≤ {meta['max_area_corridor_m2']:g} m² everywhere" if meta.get("uniform") else
                f"≤ {meta['max_area_corridor_m2']:g} m² where HAND < 5 m, ≤ {meta['max_area_elsewhere_m2']:g} m² elsewhere")
    method = (f"ANUGA {meta['anuga_version']} 2D shallow-water (DE0) on Reach 1 (dam → Medjerda confluence + 2 km, "
              f"{meta['domain_km2']:.0f} km², {meta['triangles']} triangles, {mesh_txt}). DEM: {DEM_LABEL[dem]}, flow-path cells "
              f"lowered {meta['burn_m']:g} m. Manning n from ESA WorldCover. Triangular release hydrograph at the dam "
              f"outlet: V = {V / 1e6:g} Mm³ over {meta['duration_s'] / 3600:g} h, peak {meta['Q_peak_m3s']:.0f} m³/s at "
              f"0.3 D (scenario values, not measurements). Dry start, free outflow at the downstream face, "
              f"{meta['finaltime_s'] / 3600:g} h simulated. Wet = max depth > {WET_M} m. maxdepth/frames: uint8, depth = "
              f"value/255 × {MAXM:g} m; arrival.png: 0 = not reached, else hours = value × {ARRIVAL_STEP_H}. Frames every "
              f"{dt_s / 60:.0f} min.")
    unc = ("Scenario exploration, not a forecast. 30 m terrain without channel bathymetry: the river channel is "
           "narrower than a mesh triangle, so depths, speeds and arrival times are indicative only; the release "
           "hydrograph shape and duration are assumptions; no calibration data (no gauge, no surveyed flood marks). "
           f"Mass balance error {abs(mb[-1]) * 100:.3f}% of V. Reach 2 (Medjerda to Sidi Salem) is not modelled.")
    for scn in index["scenarios"]:
        if scn["id"] == sid:
            scn.update(badge="MODELLED", source=f"ANUGA (Geoscience Australia / ANU, GPL) on {r4.DEM_SOURCE[dem]}; "
                       "ESA WorldCover 2021; OpenStreetMap", method=method, uncertainty=unc, placeholder=False,
                       computed=True,
                       files=dict(maxdepth=f"flood/anuga/{sid}/maxdepth.png", arrival=f"flood/anuga/{sid}/arrival.png",
                                  frames=f"flood/anuga/{sid}/frames/{{i}}.png", n_frames=len(sel), dt_s=dt_s),
                       depth_encoding=dict(type="r8", max=MAXM), stats=f"flood/anuga/{sid}/stats.json")
    b.write_json(ip, C.AnugaIndex.model_validate(index), force=True)
    tot = sum(f.stat().st_size for f in fd.rglob("*") if f.is_file())
    log(f"bundle flood/anuga/{sid}: {tot / 1e6:.2f} MB; inundated {inund_km2:.2f} km²; villages {arrival}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scenario", help="run this scenario id with ANUGA (Docker)")
    ap.add_argument("--post", help="post-process this scenario id (venv)")
    ap.add_argument("--dem", default="gem15", choices=["gem15", "nasadem"])
    ap.add_argument("--coarsen", type=float, default=1.0, help="multiply max triangle areas (docs/03: ×2 if too slow)")
    ap.add_argument("--finaltime-h", type=float, default=None)
    ap.add_argument("--uniform", action="store_true", help="one triangle size (the corridor value) over the whole domain")
    ap.add_argument("--threads", type=int, default=4, help="OpenMP threads (8 on this 8-vCPU Docker VM oversubscribes: ×6 slower)")
    ap.add_argument("--frames-mb", type=float, default=1.2, help="post: cap on the frames per scenario (bundle flood/ ≤ 5 MB)")
    ap.add_argument("--prepare-only", action="store_true")
    ap.add_argument("--config", type=Path, default=None)
    ap.add_argument("--results-dir", type=Path, default=None, help="post: read results from here (testing)")
    args = ap.parse_args()
    cfg = load_cfg(args.config)
    if args.prepare_only:
        prepare(args.dem, ROOT / "work" / "anuga" / "setup")
        return 0
    if args.scenario:
        import os
        os.environ["OMP_NUM_THREADS"] = str(args.threads)
        sc = next(s for s in cfg["anuga"]["scenarios"] if s["id"] == args.scenario)
        run(sc, cfg, args.dem, args.coarsen, args.finaltime_h, args.uniform)
    if args.post:
        post(args.post, cfg, args.results_dir, args.frames_mb)
    return 0


if __name__ == "__main__":
    sys.exit(main())
