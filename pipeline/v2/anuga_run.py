#!/usr/bin/env python3
"""V2 · Run ONE ANUGA dam-release scenario from a self-contained package (dam-agnostic refactor of
pipeline/05_anuga_scenarios.py). MODELLED: scenario exploration, not a forecast. 30 m terrain.

  python anuga_run.py --package <dir with domain.json> --scenario s20_d12 --mode gpu|cpu|legacy [--out DIR]
  python anuga_run.py --package <dir> --scenario custom --volume-m3 2e7 --duration-h 12 --max-area 2500 --finaltime-h 1

Needs only: anuga (4.2.0), numpy, scipy, rasterio. ANUGA is GPL and runs offline only; nothing of it ships in the web app.

Modes
  legacy  V1 behaviour: Python evolve loop, OpenMP CPU kernels (multiprocessor mode 1).
  cpu     'unified' compute mode (mode 2) on the CPU: the C Runge–Kutta loop, no device (CPU fallback for Colab/Kaggle).
  gpu     'unified' + anuga.set_gpu_offload(True, strict=True): OpenMP target offload. Only on a GPU build of ANUGA
          (nvc, -Dgpu_offload=true); fails loudly otherwise.
  Mode 2 skips Python forcing terms other than Manning friction and the degenerate-timestep protection. This set-up
  uses neither: friction is Manning only, forcing is one Inlet_operator (GPU-registered), boundaries are Reflective +
  Dirichlet (C-side); the run checks for NaN at every yield step (test E3).

Set-up (as V1): uniform mesh (or mesh_zones refined) from domain.json; elevation = package DEM bilinear at centroids,
D8 path cells lowered burn_m; Manning n from the package raster; Inlet_operator on the crest line; triangular release
(peak 0.3 D, Q_peak = 2V/D); Dirichlet stage 2 m below the lowest outflow bed on 'outflow', reflective walls; dry start;
DE0. Outputs in --out: results.npz, run.json, maxdepth_30m.tif, maxspeed_30m.tif, arrival_h_30m.tif, stats.json,
tests.json (E1 mass balance, E2 inflow, E3 stability, E7 arrival).
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

WET_M = 0.1


def log(*a):
    print(*a, flush=True)


def hydrograph(V, D):
    Qp, tp = 2 * V / D, 0.3 * D
    return (lambda t: Qp * t / tp if t < tp else (Qp * (D - t) / (D - tp) if t < D else 0.0)), Qp


def read(p):
    import rasterio
    with rasterio.open(p) as s:
        return s.read(1).astype(np.float64), s.transform, s.crs


def gpu_name():
    try:
        return subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                              capture_output=True, text=True, timeout=20).stdout.strip() or None
    except Exception:  # noqa: BLE001
        return None


def set_mode(domain, anuga, mode):
    info = dict(mode=mode, gpu_offload=False, gpu_offload_supported=bool(getattr(anuga, "gpu_offload_supported",
                                                                                 lambda: False)()))
    if mode == "legacy":
        domain.set_multiprocessor_mode(1)
        return info
    if mode == "gpu":
        anuga.set_gpu_offload(True, strict=True)
    if hasattr(domain, "set_compute_mode"):
        domain.set_compute_mode("unified")
    else:
        domain.set_multiprocessor_mode(2)
    info["compute_mode"] = domain.get_compute_mode() if hasattr(domain, "get_compute_mode") else "mode2"
    info["gpu_offload"] = bool(getattr(anuga, "gpu_offload_enabled", lambda: False)())
    if mode == "gpu" and not info["gpu_offload"]:
        raise RuntimeError("gpu mode requested but anuga.gpu_offload_enabled() is False (not a GPU build?)")
    return info


def run(pkg: Path, sc: dict, mode: str, out: Path, threads: int, active_set: bool):
    import anuga
    import rasterio
    from rasterio import features
    from scipy.ndimage import map_coordinates
    from shapely import polygons

    S = json.loads((pkg / "domain.json").read_text("utf-8"))
    out.mkdir(parents=True, exist_ok=True)
    x0, y0 = S["origin"]
    loc = lambda pts: [[p[0] - x0, p[1] - y0] for p in pts]                 # noqa: E731
    bounding = loc(S["domain"])
    nseg = len(bounding)
    outflow = set(S["outflow_segments"])
    tags = {"walls": [i for i in range(nseg) if i not in outflow], "outflow": sorted(outflow)}
    a_fine = float(sc["max_area_m2"])
    uniform = bool(sc.get("uniform", True))
    a_else = float(sc.get("max_area_elsewhere_m2", a_fine * 8))
    t0 = time.time()
    domain = anuga.create_domain_from_regions(
        bounding, boundary_tags=tags, maximum_triangle_area=a_fine if uniform else a_else,
        interior_regions=[] if uniform else [[loc(p), a_fine] for p in S["mesh_zones"]],
        mesh_filename=str(out / "mesh.msh"), use_cache=False, verbose=False)
    domain.set_name(sc["id"])
    domain.set_datadir(str(out))
    domain.set_minimum_storable_height(0.01)
    domain.set_flow_algorithm("DE0")
    ntri = len(domain)
    log(f"mesh: {ntri} triangles (≤ {a_fine:g} m²{'' if uniform else f' in zones, ≤ {a_else:g} m² elsewhere'}) in "
        f"{time.time() - t0:.0f} s; areas min/median/max {domain.areas.min():.0f}/{np.median(domain.areas):.0f}/"
        f"{domain.areas.max():.0f} m²")

    z, T, crs = read(pkg / "dem_30m.tif")
    path = np.load(pkg / "path_cells.npy")
    z[path[:, 0], path[:, 1]] -= float(S["burn_m"])
    mann, _, _ = read(pkg / "manning_30m.tif")

    def rowcol(x, y):
        return (T.f - (np.asarray(y) + y0)) / T.a - 0.5, ((np.asarray(x) + x0) - T.c) / T.a - 0.5

    def elev(x, y):
        r, c = rowcol(x, y)
        return map_coordinates(z, [r, c], order=1, mode="nearest")

    def fric(x, y):
        r, c = rowcol(x, y)
        return mann[np.clip(np.rint(r).astype(int), 0, mann.shape[0] - 1), np.clip(np.rint(c).astype(int), 0,
                                                                                    mann.shape[1] - 1)]

    domain.set_quantity("elevation", function=elev, location="centroids")
    domain.set_quantity("friction", function=fric, location="centroids")
    domain.set_quantity("stage", expression="elevation")
    V, D = float(sc["volume_m3"]), float(sc["duration_h"]) * 3600.0
    Q, Qp = hydrograph(V, D)
    tt = np.linspace(0, D, 200001)
    V_analytic = float(np.trapezoid([Q(t) for t in tt], tt))
    anuga.Inlet_operator(domain, loc(S["inlet_line"]), Q=Q)
    bxy = np.array(bounding)
    seg_z = []
    for i in outflow:
        a, b = bxy[i], bxy[(i + 1) % nseg]
        s = np.linspace(0, 1, 20)
        seg_z.append(elev(a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1])).min())
    zmin = float(min(seg_z))
    domain.set_boundary({"walls": anuga.Reflective_boundary(domain),
                         "outflow": anuga.Dirichlet_boundary([zmin - 2.0, 0.0, 0.0])})
    os.environ["OMP_NUM_THREADS"] = str(threads)
    minfo = set_mode(domain, anuga, mode)
    if active_set and mode != "legacy" and hasattr(domain, "set_use_active_set"):
        domain.set_use_active_set(True)
    cen = domain.get_centroid_coordinates()
    elev_c = domain.quantities["elevation"].centroid_values.copy()
    areas = domain.areas.copy()
    log(f"scenario {sc['id']}: V = {V / 1e6:g} Mm³, D = {D / 3600:g} h, Q_peak = {Qp:.0f} m³/s (scenario value); "
        f"mode {json.dumps(minfo)}; outflow stage {zmin - 2:.1f} m")
    ys = float(sc.get("yieldstep_s", S.get("yieldstep_s", 300)))
    ft = float(sc["finaltime_h"]) * 3600
    frame_dt = 1800.0
    maxd, maxs, arr = np.zeros(ntri), np.zeros(ntri), np.full(ntri, np.nan)
    frames, ftimes, series = [], [], []
    nan_seen = False
    wall0 = time.time()
    for t in domain.evolve(yieldstep=ys, finaltime=ft):
        st = domain.quantities["stage"].centroid_values
        xm = domain.quantities["xmomentum"].centroid_values
        ym = domain.quantities["ymomentum"].centroid_values
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
        if abs(t / 3600 - round(t / 3600)) < 1e-6 or t >= ft:
            log(f"  t = {t / 3600:5.1f} h | wall {time.time() - wall0:6.0f} s | volume {vol / 1e6:8.3f} Mm³ | out "
                f"{-bfi / 1e6:8.3f} | in {fsi / 1e6:8.3f} | wet {series[-1][5] / 1e6:7.2f} km² | max speed "
                f"{spd.max():.1f} m/s")
        if nan_seen:
            log("  NaN in the state: stopping (E3 fails)")
            break
    wall = time.time() - wall0
    nodes, tri = domain.nodes + np.array([x0, y0]), domain.triangles
    np.savez_compressed(out / "results.npz", centroids=cen + np.array([x0, y0]), nodes=nodes, triangles=tri,
                        areas=areas, elevation=elev_c, max_depth=maxd.astype(np.float32),
                        max_speed=maxs.astype(np.float32), arrival_s=arr.astype(np.float32),
                        frames=np.array(frames, dtype=np.float16), frame_t=np.array(ftimes), series=np.array(series))
    s = np.array(series)
    meta = dict(id=sc["id"], dam_id=S["dam_id"], dem=S["dem"], volume_m3=V, duration_s=D, Q_peak_m3s=Qp,
                V_analytic_m3=V_analytic, triangles=int(ntri), uniform=uniform, max_area_m2=a_fine,
                max_area_elsewhere_m2=None if uniform else a_else, wall_s=wall, finaltime_s=ft,
                simulated_s=float(s[-1, 0]), yieldstep_s=ys, nan_seen=bool(nan_seen), final_volume_m3=float(s[-1, 1]),
                boundary_flux_integral_m3=float(s[-1, 2]), inflow_applied_m3=float(s[-1, 3]),
                domain_km2=S["domain_km2"], outflow_stage_m=zmin - 2.0, anuga_version=anuga.__version__,
                burn_m=S["burn_m"], threads=threads, active_set=bool(active_set and mode != "legacy"),
                active_set_stats=(list(domain.get_active_set_stats()) if hasattr(domain, "get_active_set_stats")
                                  and mode != "legacy" else None),
                role=sc.get("role", "scenario"), pair_of=sc.get("pair_of"),
                platform=dict(host=platform.node(), python=platform.python_version(), gpu=gpu_name(),
                              kaggle=os.path.exists("/kaggle"), colab="google.colab" in sys.modules),
                **minfo)
    (out / "run.json").write_text(json.dumps(meta, indent=1), "utf-8")
    # rasters (30 m, package grid)
    H, W = z.shape
    idx = features.rasterize(((g, i + 1) for i, g in enumerate(polygons(nodes[tri]))), out_shape=(H, W),
                             transform=T, dtype="int32") - 1
    inside = idx >= 0

    def to30(v, fill):
        o = np.full((H, W), fill, np.float32)
        o[inside] = v[idx[inside]]
        return o
    md, ms = to30(maxd.astype(np.float32), 0), to30(maxs.astype(np.float32), 0)
    ar = to30((arr / 3600.0).astype(np.float32), np.nan)
    ar[md <= WET_M] = np.nan
    prof = dict(driver="GTiff", height=H, width=W, count=1, dtype="float32", crs=crs, transform=T, compress="deflate",
                predictor=3, tiled=True)
    for nm, a in (("maxdepth_30m", md), ("maxspeed_30m", ms), ("arrival_h_30m", ar)):
        with rasterio.open(out / f"{nm}.tif", "w", nodata=np.nan if nm.startswith("arrival") else None, **prof) as o:
            o.write(a, 1)
    # tests (V1 definitions)
    t_, vol, bfi, fsi = s[:, 0], s[:, 1], s[:, 2], s[:, 3]
    mb = (vol - (fsi + bfi)) / V
    tests = {}
    tests["E1"] = dict(mass_balance_err=float(abs(mb[-1])), max_abs_during_run=float(np.abs(mb).max()),
                       inflow_applied_m3=float(fsi[-1]), out_through_boundary_m3=float(-bfi[-1]),
                       final_volume_in_domain_m3=float(vol[-1]), passed=bool(abs(mb[-1]) < 0.01))
    full = t_[-1] >= D - 1
    tests["E2"] = dict(V_scenario_m3=V, V_hydrograph_integral_m3=V_analytic, err_analytic=float(abs(V_analytic - V) / V),
                       inflow_applied_by_anuga_m3=float(fsi[-1]), err_applied=float(abs(fsi[-1] - V) / V),
                       inflow_expected_by_t_end_m3=float(np.trapezoid([Q(x) for x in np.linspace(0, t_[-1], 20001)],
                                                                      np.linspace(0, t_[-1], 20001))),
                       full_release_simulated=bool(full))
    exp = tests["E2"]["inflow_expected_by_t_end_m3"]
    tests["E2"]["err_vs_expected_by_t_end"] = float(abs(fsi[-1] - exp) / max(exp, 1))
    tests["E2"]["passed"] = bool(tests["E2"]["err_analytic"] < 1e-3 and tests["E2"]["err_vs_expected_by_t_end"] < 1e-3)
    wet_t = maxd > WET_M
    tests["E3"] = dict(nan_seen=bool(nan_seen), max_speed_m_s=float(maxs.max()),
                       p99_speed_m_s=float(np.percentile(maxs[wet_t], 99)) if wet_t.any() else 0.0,
                       max_depth_m=float(maxd.max()), passed=bool((not nan_seen) and maxs.max() < 15))
    cxy = cen + np.array([x0, y0])
    arrival = {}
    for m in S["landmarks"]:
        d = np.hypot(cxy[:, 0] - m["xy"][0], cxy[:, 1] - m["xy"][1])
        near = (d < 300) & np.isfinite(arr)
        arrival[m["name"]] = round(float(np.nanmin(arr[near]) / 3600), 2) if near.any() else None
    reached = [(m["dist_km"], arrival[m["name"]]) for m in S["landmarks"] if arrival[m["name"]] is not None]
    # E7 fails (not "vacuously passes") when no landmark was reached, e.g. a short smoke run
    mono = all(b[1] >= a[1] - 0.05 for a, b in zip(sorted(reached), sorted(reached)[1:]))
    tests["E7"] = dict(arrival_h=arrival, monotonic_downstream=bool(mono),
                       first_outflow_h=float(t_[np.argmax(-bfi > 0.001 * V)] / 3600) if (-bfi > 0.001 * V).any() else None,
                       note="no reported event for these screening volumes: plausibility = arrival grows downstream and "
                            "mean front speed 0.1–5 m/s",
                       mean_front_speed_m_s={k: round(m["dist_km"] * 1000 / (arrival[m["name"]] * 3600), 2)
                                             for m in S["landmarks"] for k in [m["name"]]
                                             if arrival[m["name"]] not in (None, 0)},
                       passed=bool(reached and mono and all(0.1 <= v <= 5 for v in
                                                [m["dist_km"] * 1000 / (arrival[m["name"]] * 3600)
                                                 for m in S["landmarks"] if arrival[m["name"]] not in (None, 0)])))
    (out / "tests.json").write_text(json.dumps(tests, indent=1, ensure_ascii=False), "utf-8")
    stats = dict(mass_balance_err=float(abs(mb[-1])), peak_Q_m3s=float(Qp),
                 inundated_km2=round(float(areas[wet_t].sum() / 1e6), 3), arrival_h={k: v for k, v in arrival.items()
                                                                                    if v is not None},
                 max_depth_m={})
    (out / "stats.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False), "utf-8")
    for k, v in tests.items():
        log(k, json.dumps(v, ensure_ascii=False))
    log(f"done in {wall / 60:.1f} min wall, {ntri} triangles; results → {out}")
    return meta, tests


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", type=Path, required=True)
    ap.add_argument("--scenario", required=True, help="id from scenarios.json, or a new id with --volume-m3")
    ap.add_argument("--volume-m3", type=float)
    ap.add_argument("--duration-h", type=float, default=None)
    ap.add_argument("--max-area", type=float, default=None, help="override max triangle area (m²)")
    ap.add_argument("--finaltime-h", type=float, default=None)
    ap.add_argument("--mode", choices=["gpu", "cpu", "legacy"], default="cpu")
    ap.add_argument("--threads", type=int, default=None, help="OpenMP threads (default: 1 for gpu, 4 otherwise)")
    ap.add_argument("--no-active-set", action="store_true")
    ap.add_argument("--out", type=Path, default=None, help="default <package>/../results/<dam>/<scenario>")
    a = ap.parse_args()
    S = json.loads((a.package / "domain.json").read_text("utf-8"))
    scs = {s["id"]: s for s in json.loads((a.package / "scenarios.json").read_text("utf-8"))["scenarios"]}
    sc = dict(scs.get(a.scenario) or dict(id=a.scenario, volume_m3=None, duration_h=12.0, max_area_m2=2500.0,
                                          uniform=True, finaltime_h=24.0, role="custom"))
    if a.volume_m3 is not None:
        sc["volume_m3"] = a.volume_m3
    for k, v in (("duration_h", a.duration_h), ("max_area_m2", a.max_area), ("finaltime_h", a.finaltime_h)):
        if v is not None:
            sc[k] = v
    if not sc.get("volume_m3"):
        raise SystemExit("unknown scenario: give --volume-m3")
    sc["id"] = a.scenario
    out = a.out or a.package.parent / "results" / S["dam_id"] / a.scenario
    run(a.package, sc, a.mode, out, a.threads or (1 if a.mode == "gpu" else 4), not a.no_active_set)
    return 0


if __name__ == "__main__":
    sys.exit(main())
