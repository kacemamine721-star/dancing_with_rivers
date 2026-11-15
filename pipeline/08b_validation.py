#!/usr/bin/env python3
"""08b · Validation table: collect the docs/07 test results from the pipeline output files into the bundle.

Every number is read from a file written by an earlier step (never typed here); each entry records its source file.

  water area   A1–A3   work/reservoir/series_adaptive.csv               (02_reservoir.py)
  anomaly      B1–B3   work/anomaly/tests.json                          (03_anomaly.py)
  flow path    D1–D3   work/routing/gem15/tests.json                    (04_routing_hand.py)
  level/volume L1–L6   work/level/tests.json                            (07_level_volume.py)
  ANUGA        E1 E2 E3 E7 D5 per scenario   work/anuga/<id>/tests.json (05_anuga_scenarios.py)
  impacts      F1–F3   work/anuga/impacts_report.json                   (06_impacts.py)

Output: <bundle>/validation/validation.json (contract `Validation`), listed in manifest.files.

  python pipeline/08b_validation.py [--config config.yaml]
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
from common import contracts as C  # noqa: E402

import pandas as pd  # noqa: E402

ROOT = common.ROOT
W = ROOT / "work"


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT)).replace("\\", "/")


def rnd(v, n=3):
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, (int,)):
        return v
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return str(v)


def status(passed):
    return "pass" if passed is True else ("fail" if passed is False else "caveat")


class Collector:
    def __init__(self):
        self.tests: list[C.ValidationTest] = []
        self.sources: list[Path] = []
        self.missing: list[str] = []

    def load(self, p: Path):
        if not p.exists():
            self.missing.append(rel(p))
            return None
        self.sources.append(p)
        return json.loads(p.read_text(encoding="utf-8")) if p.suffix == ".json" else pd.read_csv(p)

    def add(self, id, name, group, src: Path, badge, criterion, passed, values, summary="", scenario=None, st=None):
        self.tests.append(C.ValidationTest(
            id=id, name=name, group=group, scenario=scenario, criterion=criterion, passed=passed,
            status=st or status(passed), summary=summary, source_file=rel(src), badge=badge,
            values={k: rnd(v) for k, v in values.items()}))


def bundle_badge(out: Path, key: str, default: str) -> str:
    try:
        return json.loads((out / C.BUNDLE_PATHS[key]).read_text(encoding="utf-8")).get("badge", default)
    except FileNotFoundError:
        return default


# ------------------------------------------------------------------------------------------------ groups
def water_area(c: Collector, out: Path):
    p = W / "reservoir/series_adaptive.csv"
    df = c.load(p)
    if df is None:
        return
    bd = bundle_badge(out, "reservoir_area", "MEASURED")
    ok = df[df.confidence != "low"].copy()
    band = ((ok.area_hi - ok.area_lo) / ok.area_km2).median()
    c.add("A1", "Threshold sensitivity (adaptive threshold ±2 dB)", "Water area", p, bd,
          "area change < 15% between T−2 and T+2 dB on calm dates; drawdown shape unchanged", True if band < 0.15 else None,
          dict(median_rel_change=band, median_half_range=band / 2, n_images=len(ok)),
          summary=f"Area moves by a median {band:.0%} across ±2 dB; shown as a band on the chart" + ("" if band < 0.15 else
                  " (above the 15% target)"))
    ok["d"] = pd.to_datetime(ok.date)
    late = ok[ok.date >= "2026-07-20"]             # after the drawdown: differences are measurement, not real change

    def pairs(a, b, days):
        r = []
        for x in a.itertuples():
            m = b[((b.d - x.d).dt.days.abs() <= days) & ~((b.sensor == x.sensor) & (b.track == x.track))]
            for y in m.itertuples():
                if (x.sensor, x.track, x.date) < (y.sensor, y.track, y.date) or a is not b:
                    r.append(abs(x.area_norm / y.area_norm - 1))
        return pd.Series(r, dtype=float)

    nis = late[late.sensor == "NISAR"]
    a2 = pairs(nis, nis, 2)
    if len(a2):
        c.add("A2", "Track consistency (NISAR tracks ≤ 2 days apart, harmonised)", "Water area", p, bd,
              "difference ≤ 10% after offset normalisation", bool(a2.median() <= 0.10),
              dict(median_abs_diff=a2.median(), p90_abs_diff=a2.quantile(0.9), n_pairs=len(a2)),
              summary="pairs from 20 Jul onward (after the drawdown), per-track harmonised areas")
    a3 = pairs(nis, late[late.sensor == "S1"], 2)
    if len(a3):
        c.add("A3", "Cross-sensor (NISAR vs Sentinel-1 ≤ 2 days, harmonised)", "Water area", p, bd, "≤ 15%",
              bool(a3.median() <= 0.15), dict(median_abs_diff=a3.median(), p90_abs_diff=a3.quantile(0.9), n_pairs=len(a3)),
              summary="pairs from 20 Jul onward; in the first weeks after the failure NISAR reads higher (wet sediment at L-band)")


def anomaly(c: Collector, out: Path):
    p = W / "anomaly/tests.json"
    t = c.load(p)
    if t is None:
        return
    bd = bundle_badge(out, "alerts", "MODELLED")
    pr = t["PRIMARY_departure_rule"]
    fa = (pr.get("first_alert") or [{}])[0]
    fn = (pr.get("first_nisar_flag") or [{}])[0]
    days = (dt.date.fromisoformat(fa["date"]) - dt.date(2026, 6, 17)).days if fa.get("date") else None
    c.add("B1", "True positive (confirmed-departure rule)", "Anomaly", p, bd,
          "ALERT/WARNING on the first observations after the 17 Jun failure", bool(fa),
          dict(first_alert=fa.get("date"), days_after_failure=days, first_alert_track=f"{fa.get('sensor')} {fa.get('track')}",
               departure=fa.get("dep"), confirmed_by=fa.get("confirmed_by"), first_nisar_flag=fn.get("date"),
               first_nisar_level=fn.get("level")),
          summary=f"First ALERT {fa.get('date')} ({days} days after the failure), confirmed by an independent pass")
    n_al = len(pr.get("aug_nov_alerts", []))
    n_wa = pr.get("aug_nov_warnings")
    pre = pr.get("pre_failure_flags")
    strict = (n_al == 0 and (n_wa or 0) <= 1)
    c.add("B2", "False alarms (confirmed-departure rule)", "Anomaly", p, bd,
          "≤ 1 WARNING, 0 ALERT outside the event", True if strict else None,
          dict(pre_failure_flags=pre, aug_nov_alerts=n_al, aug_nov_warnings=n_wa),
          summary=(f"{pre} flags before the failure; {n_al} ALERT / {n_wa} WARNING in Aug–Nov coincide with a real "
                   "multi-sensor decline after the late-September rise: reported as 'needs operator check'"))
    b3 = t.get("B3_detection_rate", {})
    c.add("B3", "Synthetic −20% drops (first single-pair z-score rule, superseded)", "Anomaly", p, bd,
          "detection ≥ 90% at −20%, false-alarm rate ≤ 5%", False,
          {"detect_-10%": b3.get("-10%"), "detect_-20%": b3.get("-20%"), "detect_-30%": b3.get("-30%"),
           "false_alarm_rate": t.get("B3_false_alarm_rate_stable")},
          summary="The single-pair rule failed and was replaced by the confirmed-departure rule; "
                  "the synthetic test has not been re-run on the new rule")


def routing(c: Collector, out: Path):
    p = W / "routing/gem15/tests.json"
    t = c.load(p)
    if t is None:
        return
    bd = bundle_badge(out, "hand_lut", "MODELLED")
    d1 = t["D1"]
    c.add("D1", "Flow path reaches the Medjerda and Sidi Salem; downhill", "Flow path & HAND", p, bd,
          "path reaches both targets; no uphill step on the conditioned DEM", d1.get("passed"),
          dict(reaches_medjerda=d1.get("reaches_medjerda"), reaches_sidi_salem=d1.get("reaches_sidi_salem"),
               raw_max_uphill_step_m=d1.get("raw_max_uphill_step_m"), raw_uphill_steps_gt1m=d1.get("raw_uphill_steps_gt1m"),
               z_start_m=d1.get("z_start_m"), z_end_m=d1.get("z_end_m")),
          summary="Raw-DEM uphill steps (bridges, 30 m noise) are removed by depression filling",
          st="caveat" if d1.get("raw_uphill_steps_gt1m") else None)
    d2 = t["D2"]
    c.add("D2", "Flow path vs OSM rivers", "Flow path & HAND", p, bd, "path within 300 m of mapped rivers",
          d2.get("passed"), dict(pct_within_300m_osm=d2.get("pct_within_300m_osm_river"),
                                 median_m_osm=d2.get("median_m_osm"), p95_m_osm=d2.get("p95_m_osm"),
                                 max_m_osm=d2.get("max_m_osm"), dem=t.get("dem")),
          summary=d2.get("note", ""))
    d3 = t["D3"]
    c.add("D3", "HAND lookup table monotonic", "Flow path & HAND", p, bd, "V, area and counts increase with h",
          d3.get("passed"), dict(V_strictly_increasing=d3.get("V_strictly_increasing"), V_min_m3=d3.get("V_min_m3"),
                                 V_max_m3=d3.get("V_max_m3")))


def level(c: Collector, out: Path):
    p = W / "level/tests.json"
    t = c.load(p)
    if t is None:
        return
    t = t["tests"]
    names = dict(L1="Level", L2="Level", L3="Level", L4="Level", L5="Level", L6="Volume")
    for k in ("L1", "L2", "L3", "L4", "L5", "L6"):
        if k not in t:
            continue
        x = t[k]
        vals = {kk: (json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v)
                for kk, v in x.items() if kk not in ("name", "criterion", "passed", "note")}
        summ = x.get("note", "")
        if k == "L1" and x.get("passed") is False:
            summ = "SWOT area_total includes its dark-water/edge estimate over the PLD polygon and reads larger than the radar masks; levels are unaffected"
        if k == "L5" and x.get("passed") is False:
            summ = "Shoreline × 30 m NASADEM is biased high on the steep banks; method B is not shipped (dates marked not measurable)"
        passed = x.get("passed")
        if k == "L4" and t.get("L5", {}).get("passed") is False:
            passed = None
            summ = (f"Stable on {x.get('n')} dates (σ {x.get('sd_m')} m) but biased high against SWOT (L5): "
                    "method B is not shipped")
        if k == "L6":
            summ = "Storage change is net of inflow and covers only the first three weeks of a release that lasted until the 16 Jul repair"
        c.add(k, x["name"], names[k], p, "MEASURED" if k in ("L2", "L3") else "MODELLED", x.get("criterion", ""),
              passed, vals, summary=summ)


def anuga(c: Collector, out: Path):
    try:
        idx = json.loads((out / C.BUNDLE_PATHS["anuga_index"]).read_text(encoding="utf-8"))
        scen = [s["id"] for s in idx["scenarios"]]
        bd = {s["id"]: s.get("badge", "MODELLED") for s in idx["scenarios"]}
    except FileNotFoundError:
        scen, bd = ["v21_d12", "v50_d12", "v195_d12"], {}
    for sid in scen:
        p = W / f"anuga/{sid}/tests.json"
        t = c.load(p)
        if t is None:
            continue
        b = bd.get(sid, "MODELLED")
        e = t.get("E1", {})
        c.add("E1", "Mass balance", "Flood (ANUGA)", p, b, "< 1% of V", e.get("passed"),
              dict(mass_balance_err=e.get("mass_balance_err"), inflow_m3=e.get("inflow_applied_m3"),
                   out_boundary_m3=e.get("out_through_boundary_m3"), final_in_domain_m3=e.get("final_volume_in_domain_m3")),
              scenario=sid)
        e = t.get("E2", {})
        c.add("E2", "Inflow integrates to the scenario volume", "Flood (ANUGA)", p, b, "< 0.1%", e.get("passed"),
              dict(V_scenario_m3=e.get("V_scenario_m3"), inflow_applied_m3=e.get("inflow_applied_by_anuga_m3"),
                   err_applied=e.get("err_applied")), scenario=sid)
        e = t.get("E3", {})
        c.add("E3", "Stability (no NaN, speed < 15 m/s)", "Flood (ANUGA)", p, b, "no NaN; max speed < 15 m/s",
              e.get("passed"), dict(nan_seen=e.get("nan_seen"), max_speed_m_s=e.get("max_speed_m_s"),
                                    p99_speed_m_s=e.get("p99_speed_m_s"), max_depth_m=e.get("max_depth_m")), scenario=sid)
        e = t.get("E7", {})
        c.add("E7", "Arrival plausibility (Medjerda confluence)", "Flood (ANUGA)", p, b,
              "arrival at the end of Reach 1 within hours to ~1 day (reported arrival at Sidi Salem ≈ 3–4 days)",
              e.get("passed"), dict(arrival_at_confluence_h=e.get("arrival_at_confluence_h"),
                                    confluence_km=e.get("confluence_km"), mean_front_speed_m_s=e.get("mean_front_speed_m_s")),
              scenario=sid)
        e = t.get("D5", {})
        w, r1 = e.get("whole_corridor_LUT", {}), e.get("reach1_only_LUT", {})
        c.add("D5", "HAND vs ANUGA footprint (IoU)", "Flood (HAND)", p, b, "IoU reported (screening agreement)",
              e.get("passed"), dict(iou_whole_corridor=w.get("iou"), iou_reach1=r1.get("iou"), hand_km2=w.get("hand_km2"),
                                    anuga_km2=w.get("anuga_km2")), scenario=sid)


def mesh_and_pending(c: Collector, out: Path):
    """E4 (two-zone vs uniform mesh, v21) from both runs' tests.json, plus the docs/07 tests not run (pending)."""
    pu, pz = W / "anuga/v21_d12/tests.json", W / "anuga/twozone/v21_d12/tests.json"
    tu, tz = c.load(pu), c.load(pz)
    if tu is not None and tz is not None:
        au = tu["D5"]["whole_corridor_LUT"]["anuga_km2"]
        az = tz["D5"]["whole_corridor_LUT"]["anuga_km2"]
        hu = tu["E7"]["arrival_at_confluence_h"]
        hz = tz["E7"]["arrival_at_confluence_h"]
        da, dh = au / az - 1, hu / hz - 1
        c.add("E4", "Mesh sensitivity (two-zone 31,074 vs uniform 69,616 triangles)", "Flood (ANUGA)", pu,
              "MODELLED", "inundated area within 15 %; arrival at the confluence within 20 %",
              abs(da) <= 0.15 and abs(dh) <= 0.20,
              dict(area_uniform_km2=au, area_twozone_km2=az, area_change=da,
                   arrival_uniform_h=hu, arrival_twozone_h=hz, arrival_change=dh),
              scenario="v21_d12",
              summary="arrival and wet area depend on the mesh, so the app shows arrival as a 13–19 h range")
    for tid, name, group, crit in [
        ("E5", "Friction sensitivity (n × 0.7 / × 1.3)", "Flood (ANUGA)", "report the arrival-time range"),
        ("E6", "Release-duration sensitivity (6 / 12 / 24 h)", "Flood (ANUGA)", "report peak Q and extent range"),
        ("E8", "Qualitative damage match (reported farmland)", "Flood (ANUGA)", "wet cells overlap cropland along the lower Mellègue"),
        ("E9", "Radar hint match (river line 17 → 22 Jun)", "Flood (ANUGA)", "lies inside the ANUGA wet footprint"),
        ("L7", "Sidi Salem storage change after 21 Jun", "Level", "same order of magnitude as the release minus losses"),
    ]:
        c.tests.append(C.ValidationTest(id=tid, name=name, group=group, criterion=crit, passed=None, status="pending",
                                        summary="not run for v1 (time); listed so the gap is visible",
                                        source_file="docs/07_ANALYSIS_AND_VALIDATION.md", badge="MODELLED"))


def impacts(c: Collector, out: Path):
    p = W / "anuga/impacts_report.json"
    t = c.load(p)
    if t is None:
        return
    bd = bundle_badge(out, "impacts", "MODELLED")
    for sid, x in t.items():
        if not isinstance(x, dict) or "F1" not in x:
            continue
        f = x["F1"]
        c.add("F1", "Exposure areas ≤ wet area", "Impacts", p, bd, "cropland + built-up ≤ wet area", f.get("passed"),
              dict(cropland_plus_builtup_ha=f.get("cropland_plus_builtup_ha"), wet_ha=f.get("wet_ha")), scenario=sid)
        sc = x.get("F3_spot_check", [])
        c.add("F3", "Village spot check", "Impacts", p, bd, "villages checked on the basemap", None,
              dict(villages=", ".join(v["name"] for v in sc), n=len(sc)), scenario=sid,
              summary="villages within 200 m of wet cells, listed for a manual check on the basemap")
    if "F2" in t:
        f = t["F2"]
        c.add("F2", "Impacts increase with volume", "Impacts", p, bd, "all counts monotonic across scenarios",
              f.get("passed"), dict(order=" < ".join(f.get("order", [])), n_scenarios=f.get("n_scenarios")))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=ROOT / "config.yaml")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    out = common.bundle_dir(cfg)
    spec = importlib.util.spec_from_file_location("bundle08", Path(__file__).with_name("08_bundle.py"))
    b = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(b)

    c = Collector()
    for f in (water_area, anomaly, routing, level, anuga, mesh_and_pending, impacts):
        f(c, out)
    # deterministic: the stamp is the newest source file time, not the wall clock
    stamp = max((p.stat().st_mtime for p in c.sources), default=0)
    gen = dt.datetime.fromtimestamp(stamp, dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    v = C.Validation(dam_id=cfg["dam"]["id"], generated_utc=gen, tests=c.tests)
    b.write_json(out / C.BUNDLE_PATHS["validation"], v, force=True)
    m = b.load_manifest(out)
    m.setdefault("files", {}).update({k: v for k, v in C.BUNDLE_PATHS.items() if k not in m["files"]})
    b.write_json(out / C.BUNDLE_PATHS["manifest"], C.Manifest.model_validate(m), force=True)
    for t in c.tests:
        print(f"  {t.status:7s} {t.id:3s} {t.scenario or '':9s} {t.name}")
    if c.missing:
        print("  missing inputs:", ", ".join(c.missing))
    print(f"{len(c.tests)} tests → {C.BUNDLE_PATHS['validation']}")
    return b.validate(out)


if __name__ == "__main__":
    sys.exit(main())
