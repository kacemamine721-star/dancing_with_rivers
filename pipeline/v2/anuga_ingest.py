#!/usr/bin/env python3
"""V2 · Ingest ANUGA results (from Colab and/or Kaggle) into the per-dam web bundle (V1 flood/anuga/ contract).

  python pipeline/v2/anuga_ingest.py --results <dir-or-zip> [<dir-or-zip> …] [--dam sidi-salem …]
                                     [--out-root apps/web/public/data/v2] [--allow-partial]

Every run folder holds run.json (dam_id + scenario id) written by anuga_run.py, so results from several platforms
merge without conflicts. The ingest walks every given directory (and every *.zip in it, extracted to
work/v2/anuga_results/_extracted/), keys runs by (dam_id, scenario), and reports runs that are MISSING (in the dam's
scenarios.json, not found) or DUPLICATED (found more than once; the most recent complete run wins, the others are
listed). A run is "complete" when it simulated the scenario's full final time; partial runs (e.g. the 1 h smoke test)
are written only with --allow-partial, and then as ILLUSTRATIVE placeholders, never as results.

Per dam (bundle root apps/web/public/data/v2/<dam>/):
  flood/anuga/index.json                  AnugaIndex: every packaged scenario; computed=false → UI "Not computed yet"
  flood/anuga/<sid>/maxdepth.png, arrival.png, frames/{i}.png, stats.json   on the corridor grid (flood/hand_grid.json)
  work/v2/<dam>/anuga_tests.json          E1 E2 E3 E7 per run, D5 (HAND vs ANUGA IoU), E4 mesh pair comparison
Scenario exploration, not a forecast. 30 m terrain.
"""
from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import common  # noqa: E402,F401  (PROJ guard first)
from common import contracts as C  # noqa: E402

import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WET_M = 0.1
MAXM = 8.0
ARRIVAL_STEP_H = 0.2


def log(*a):
    print(*a, flush=True)


def discover(paths):
    found = []
    ex_root = ROOT / "work/v2/anuga_results/_extracted"
    for p in paths:
        p = Path(p)
        zips = [p] if p.suffix == ".zip" else sorted(p.rglob("*.zip")) if p.is_dir() else []
        for z in zips:
            dst = ex_root / z.stem
            if not dst.exists():
                with zipfile.ZipFile(z) as zf:
                    zf.extractall(dst)
            found += [(r, f"{z}") for r in dst.rglob("run.json")]
        if p.is_dir():
            found += [(r, str(r.parent)) for r in p.rglob("run.json") if ex_root not in r.parents]
    runs = {}
    for rj, origin in found:
        m = json.loads(rj.read_text("utf-8"))
        runs.setdefault((m["dam_id"], m["id"]), []).append(dict(dir=rj.parent, origin=origin, meta=m,
                                                                mtime=rj.stat().st_mtime))
    return runs


def tri_index(nodes, triangles, T, shape):
    from rasterio import features
    from shapely import polygons
    return features.rasterize(((g, i + 1) for i, g in enumerate(polygons(nodes[triangles]))), out_shape=shape,
                              transform=T, dtype="int32") - 1


def to_grid(a, T, hg, resampling):
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject
    w, h = hg["size_px"]
    dst = np.full((h, w), np.nan, np.float32)
    reproject(a.astype(np.float32), dst, src_transform=T, src_crs="EPSG:32632", src_nodata=np.nan,
              dst_transform=from_bounds(*hg["bounds_m"], w, h), dst_crs="EPSG:32632", dst_nodata=np.nan,
              resampling=resampling)
    return dst


def ingest_dam(dam, runs, out_root: Path, allow_partial: bool, frames_mb: float):
    import rasterio
    from PIL import Image
    from rasterio.warp import Resampling
    wd = ROOT / "work/v2" / dam
    pk = wd / "anuga_package"
    S = json.loads((pk / "domain.json").read_text("utf-8"))
    scs = json.loads((pk / "scenarios.json").read_text("utf-8"))["scenarios"]
    out = out_root / dam
    hg = json.loads((ROOT / "apps/web/public/data/v2" / dam / "flood/hand_grid.json").read_text("utf-8"))
    with rasterio.open(wd / "hand_30m.tif") as s:
        hand, Th = s.read(1), s.transform
    lut = json.loads((wd / "lut_rows.json").read_text("utf-8"))
    report = dict(dam_id=dam, missing=[], duplicated={}, partial=[], ingested=[], runs={})
    index = []
    for sc in scs:
        cand = runs.get((dam, sc["id"]), [])
        if len(cand) > 1:
            report["duplicated"][sc["id"]] = [c["origin"] for c in cand]
        full = [c for c in cand if c["meta"]["simulated_s"] >= sc["finaltime_h"] * 3600 - 1]
        pick = max(full or cand, key=lambda c: c["mtime"]) if cand else None
        base = dict(id=sc["id"], volume_m3=sc["volume_m3"], duration_h=sc["duration_h"], label=sc["label"])
        if pick is None:
            report["missing"].append(sc["id"])
            index.append(C.AnugaScenario(**base, badge="MODELLED", source="ANUGA (not run yet)", computed=False,
                                         placeholder=True, method="Not computed yet",
                                         uncertainty="Scenario exploration, not a forecast."))
            continue
        partial = not full
        if partial:
            report["partial"].append(dict(id=sc["id"], simulated_h=pick["meta"]["simulated_s"] / 3600,
                                          origin=pick["origin"]))
            if not allow_partial:
                index.append(C.AnugaScenario(**base, badge="MODELLED", source="ANUGA (partial run only)",
                                             computed=False, placeholder=True, method="Not computed yet",
                                             uncertainty="Only a partial run exists; not shown."))
                continue
        d, meta = pick["dir"], pick["meta"]
        tests = json.loads((d / "tests.json").read_text("utf-8"))
        with rasterio.open(d / "maxdepth_30m.tif") as s:
            md, T = s.read(1), s.transform
        with rasterio.open(d / "arrival_h_30m.tif") as s:
            ar = s.read(1)
        R = np.load(d / "results.npz")
        fd = out / "flood/anuga" / sc["id"]
        (fd / "frames").mkdir(parents=True, exist_ok=True)
        for f in (fd / "frames").glob("*.png"):
            f.unlink()

        def depth_png(a30, path, thr):
            dw = np.nan_to_num(to_grid(np.where(a30 > thr, a30, 0.0), T, hg, Resampling.average))
            v = np.where(dw > thr / 2, np.clip(np.round(dw / MAXM * 255), 1, 255), 0).astype(np.uint8)
            Image.fromarray(v, "L").save(path, optimize=True)
        depth_png(md, fd / "maxdepth.png", WET_M)
        aw = to_grid(ar, T, hg, Resampling.min)
        av = np.where(np.isfinite(aw), np.clip(np.ceil(aw / ARRIVAL_STEP_H), 1, 255), 0).astype(np.uint8)
        Image.fromarray(av, "L").save(fd / "arrival.png", optimize=True)
        idx = tri_index(R["nodes"], R["triangles"], T, md.shape)
        ins = idx >= 0
        frames, ft = R["frames"].astype(np.float32), R["frame_t"]
        step, sel, size = 1, [], 0
        while len(ft):
            for f in (fd / "frames").glob("*.png"):
                f.unlink()
            sel = list(range(0, len(ft), step))
            for i, k in enumerate(sel):
                a = np.zeros(md.shape, np.float32)
                a[ins] = frames[k][idx[ins]]
                depth_png(a, fd / "frames" / f"{i}.png", 0.03)
            size = sum(f.stat().st_size for f in (fd / "frames").glob("*.png"))
            if size <= frames_mb * 1e6 or step >= 8:
                break
            step *= 2
        dt_s = float(ft[1] - ft[0]) * step if len(ft) > 1 else 1800.0
        # stats: arrival + max depth near each landmark (within 300 m of the path point)
        arrival = {k: v for k, v in tests["E7"]["arrival_h"].items() if v is not None}
        depth = {}
        for m in S["landmarks"]:
            r0, c0 = int((T.f - m["xy"][1]) // 30), int((m["xy"][0] - T.c) // 30)
            win = md[max(r0 - 10, 0):r0 + 11, max(c0 - 10, 0):c0 + 11]
            if win.size and win.max() > WET_M:
                depth[m["name"]] = round(float(win.max()), 2)
        wet_tri = R["max_depth"] > WET_M
        stats = C.AnugaStats(mass_balance_err=float(tests["E1"]["mass_balance_err"]), peak_Q_m3s=float(meta["Q_peak_m3s"]),
                             inundated_km2=round(float(R["areas"][wet_tri].sum() / 1e6), 3), arrival_h=arrival,
                             max_depth_m=depth)
        (fd / "stats.json").write_text(json.dumps(stats.model_dump(mode="json"), indent=1, ensure_ascii=False), "utf-8")
        # D5: HAND bathtub (whole-corridor LUT) vs ANUGA wet extent inside the ANUGA domain
        from rasterio.warp import reproject
        wet = md > WET_M
        hand_p = np.full(md.shape, np.nan, np.float32)
        reproject(hand.astype(np.float32), hand_p, src_transform=Th, src_crs="EPSG:32632", src_nodata=np.nan,
                  dst_transform=T, dst_crs="EPSG:32632", dst_nodata=np.nan, resampling=Resampling.nearest)
        hs, vs = np.array([r["h"] for r in lut]), np.array([r["V_m3"] for r in lut])
        h = float(np.interp(meta["volume_m3"], np.r_[0, vs], np.r_[0, hs])) if meta["volume_m3"] <= vs[-1] else None
        d5 = None
        if h is not None:
            hw = ins & np.isfinite(hand_p) & (hand_p < h)
            d5 = dict(h_m=h, hand_km2=float(hw.sum() * 900 / 1e6), anuga_km2=float(wet.sum() * 900 / 1e6),
                      iou=float((hw & wet).sum() / max((hw | wet).sum(), 1)),
                      passed=bool((hw & wet).sum() / max((hw | wet).sum(), 1) >= 0.4))
        report["runs"][sc["id"]] = dict(origin=pick["origin"], mode=meta.get("mode"), gpu_offload=meta.get("gpu_offload"),
                                       gpu=meta.get("platform", {}).get("gpu"), triangles=meta["triangles"],
                                       wall_min=round(meta["wall_s"] / 60, 1), partial=partial,
                                       E1=tests["E1"], E2=tests["E2"], E3=tests["E3"], E7=tests["E7"], D5=d5,
                                       inundated_km2=stats.inundated_km2)
        mesh = f"uniform ≤ {meta['max_area_m2']:g} m²" if meta.get("uniform") else f"≤ {meta['max_area_m2']:g} m² zones"
        method = (f"ANUGA {meta['anuga_version']} 2D shallow-water (DE0, compute mode {meta.get('mode')}"
                  f"{', GPU offload' if meta.get('gpu_offload') else ''}) dam → {S['end']} ({S['domain_km2']:.0f} km², "
                  f"{meta['triangles']} triangles, {mesh}). DEM: {S['dem']} 30 m, path cells lowered {S['burn_m']:g} m. "
                  f"Manning n from WorldCover fractions. Triangular release at the crest outlet: V = "
                  f"{meta['volume_m3'] / 1e6:g} Mm³ over {meta['duration_s'] / 3600:g} h, peak {meta['Q_peak_m3s']:.0f} "
                  f"m³/s at 0.3 D (screening values, not tied to any event). Dry start, free outflow, "
                  f"{meta['simulated_s'] / 3600:g} h simulated. Wet = max depth > {WET_M} m. Grid: flood/hand_grid.json. "
                  f"maxdepth/frames uint8 depth = value/255 × {MAXM:g} m; arrival.png 0 = not reached, else hours = value "
                  f"× {ARRIVAL_STEP_H}. Frames every {dt_s / 60:.0f} min.")
        unc = ("Scenario exploration, not a forecast. 30 m terrain without channel bathymetry; no calibration data; the "
               "release hydrograph is an assumption, not a breach model. Arrival times are mesh-sensitive (see test E4): "
               f"show them as a range. Mass balance error {tests['E1']['mass_balance_err'] * 100:.3g} % of V.")
        if partial:
            unc = "PARTIAL RUN (smoke test), not a result. " + unc
        index.append(C.AnugaScenario(
            **base, badge="ILLUSTRATIVE" if partial else "MODELLED", placeholder=partial, computed=not partial,
            source="ANUGA (Geoscience Australia / ANU, GPL); GEM-15 / Copernicus GLO-30; ESA WorldCover 2021",
            method=method, uncertainty=unc,
            files=C.AnugaFiles(maxdepth=f"flood/anuga/{sc['id']}/maxdepth.png", arrival=f"flood/anuga/{sc['id']}/arrival.png",
                               frames=f"flood/anuga/{sc['id']}/frames/{{i}}.png", n_frames=len(sel), dt_s=dt_s),
            depth_encoding=C.Encoding(type="r8", max=MAXM), stats=f"flood/anuga/{sc['id']}/stats.json"))
        report["ingested"].append(sc["id"])
        log(f"[{dam}] {sc['id']}: {'PARTIAL ' if partial else ''}{stats.inundated_km2} km², E1 "
            f"{tests['E1']['passed']} E2 {tests['E2']['passed']} E3 {tests['E3']['passed']} E7 {tests['E7']['passed']}, "
            f"D5 {d5 and round(d5['iou'], 2)}, frames {len(sel)} ({size / 1e6:.2f} MB)")
    # E4: mesh-sensitivity pair
    for sc in scs:
        if sc.get("role") == "mesh_sensitivity":
            a, b = report["runs"].get(sc["pair_of"]), report["runs"].get(sc["id"])
            if a and b:
                arr_a, arr_b = a["E7"]["arrival_h"], b["E7"]["arrival_h"]
                common_ = [k for k in arr_a if arr_a[k] and arr_b.get(k)]
                rel = {k: (arr_b[k] - arr_a[k]) / arr_a[k] for k in common_}
                dw = (b["inundated_km2"] - a["inundated_km2"]) / max(a["inundated_km2"], 1e-9)
                report["E4"] = dict(fine=sc["pair_of"], coarse=sc["id"], wet_area_rel_change=dw,
                                    arrival_rel_change=rel, arrival_range_h={k: sorted([arr_a[k], arr_b[k]])
                                                                             for k in common_},
                                    passed=bool(abs(dw) < 0.15 and all(abs(v) < 0.15 for v in rel.values())),
                                    rule="|Δ| < 15 % for wet area and every landmark arrival (V1 E4 failed: −32 % / +29 %)")
            else:
                report["E4"] = dict(passed=None, note=f"needs both {sc['pair_of']} and {sc['id']}")
    ai = C.AnugaIndex(dam_id=dam, scenarios=index)
    p = out / C.BUNDLE_PATHS["anuga_index"]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ai.model_dump(mode="json", by_alias=True), indent=1, ensure_ascii=False), "utf-8")
    C.AnugaIndex.model_validate_json(p.read_text("utf-8"))
    (wd / "anuga_tests.json").write_text(json.dumps(report, indent=1, ensure_ascii=False, default=str), "utf-8")
    log(f"[{dam}] index: {len(index)} scenarios, computed {sum(s.computed for s in index)}; missing {report['missing']}; "
        f"duplicated {list(report['duplicated'])}; partial {[x['id'] for x in report['partial']]}; E4 "
        f"{report.get('E4', {}).get('passed')}")
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", nargs="+", required=True, help="results directories and/or zips (Colab, Kaggle, …)")
    ap.add_argument("--dam", nargs="*", default=None)
    ap.add_argument("--out-root", type=Path, default=ROOT / "apps/web/public/data/v2")
    ap.add_argument("--allow-partial", action="store_true", help="write partial runs as ILLUSTRATIVE placeholders")
    ap.add_argument("--frames-mb", type=float, default=1.2)
    a = ap.parse_args()
    runs = discover(a.results)
    log(f"found {sum(len(v) for v in runs.values())} run(s): {sorted(runs)}")
    dams = a.dam or sorted({d for d, _ in runs} | {p.parent.name for p in (ROOT / "work/v2").glob("*/anuga_package")})
    unknown = sorted({d for d, _ in runs} - set(dams))
    if unknown:
        log(f"runs for dams not requested / without a package: {unknown}")
    for d in dams:
        if not (ROOT / "work/v2" / d / "anuga_package/scenarios.json").exists():
            log(f"[{d}] no package: skipped")
            continue
        ingest_dam(d, runs, a.out_root, a.allow_partial, a.frames_mb)
    return 0


if __name__ == "__main__":
    sys.exit(main())
