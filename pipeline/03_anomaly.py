#!/usr/bin/env python3
"""03 · Anomaly detection on the reservoir series (docs/03 §5.3, tests docs/07 §4 B1–B4).

Two explainable rules, both calibrated on the stable period (14 Aug → end of series):

  PAIR rule (per docs/03 §5.3) — each observation vs the previous one on the SAME sensor+track
      Δa = (A_t − A_prev)/A_prev ;  expected = seasonal_rate × days ;  z = (Δa − expected) / (σ × √days)
      ALERT   if z < z_alert and Δa < drop_alert,   or  z < z_warn and Δa < drop_warn and brightness z > +2
      WARNING if z < z_warn  and Δa < drop_warn
      brightness = median dB inside the lake polygon (water → wet sediment raises it). It only CONFIRMS an
      area drop: on its own it also jumps with wind (e.g. S1 o168 11 → 16 Jun, before the failure).

  TREND rule — NISAR only, all tracks harmonised (area_norm): Theil–Sen slope over a sliding 14-day window
      with ≥ 3 observations; ALERT if the slope is below seasonal − 3σ_slope AND the window lost > 15 %.
      This uses NISAR's combined 2–7-day revisit, where single 12-day same-track pairs are too noisy.

Outputs: <bundle>/anomaly/alerts.json (contract Alerts), work/anomaly/{evaluations.csv, tests.json, report.md}
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402
from common import contracts as C  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

STABLE_FROM = "2026-08-14"
FAILURE = "2026-06-17"


def bundle_mod():
    spec = importlib.util.spec_from_file_location("bundle08", Path(__file__).with_name("08_bundle.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def mad_sigma(x):
    x = np.asarray(x, float)
    x = x[np.isfinite(x)]
    return float(1.4826 * np.median(np.abs(x - np.median(x)))) if x.size else np.nan


def pairs(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (s, t), g in df.groupby(["sensor", "track"]):
        g = g.sort_values("date")
        for a, b in zip(g.iloc[:-1].itertuples(), g.iloc[1:].itertuples()):
            days = (b.date - a.date).days
            if days <= 0:
                continue
            rows.append(dict(sensor=s, track=t, prev=a.date, date=b.date, days=days,
                             A_prev=a.area_km2, A=b.area_km2, da=(b.area_km2 - a.area_km2) / a.area_km2,
                             db=b.lake_median_db - a.lake_median_db))
    return pd.DataFrame(rows).sort_values(["date", "sensor", "track"]).reset_index(drop=True)


def calibrate(p: pd.DataFrame, min_points: int, prior: float):
    st = p[p.date >= STABLE_FROM]
    rate = float((st.da / st.days).median()) if len(st) >= min_points else prior
    sig_a = mad_sigma(st.da / np.sqrt(st.days) - rate * np.sqrt(st.days))
    sig_b = mad_sigma(st.db / np.sqrt(st.days))
    return rate, sig_a, sig_b, len(st)


def pair_rule(p, rate, sig_a, sig_b, r):
    exp = rate * p.days
    za = (p.da - exp) / (sig_a * np.sqrt(p.days))
    zb = p.db / (sig_b * np.sqrt(p.days))
    alert = ((za < r["z_alert"]) & (p.da < r["drop_alert"])) | ((za < r["z_warn"]) & (p.da < r["drop_warn"]) & (zb > 2))
    warn = (za < r["z_warn"]) & (p.da < r["drop_warn"])
    level = np.where(alert, "ALERT", np.where(warn, "WARNING", "NORMAL"))
    return exp, za, zb, level


def theil_sen(x, y):
    s = [(y[j] - y[i]) / (x[j] - x[i]) for i in range(len(x)) for j in range(i + 1, len(x)) if x[j] != x[i]]
    return float(np.median(s)) if s else np.nan


def trend_rule(nisar: pd.DataFrame, window_days=14, min_obs=3):
    """Relative Theil–Sen slope (per day) of harmonised NISAR area over trailing windows."""
    n = nisar.sort_values("date").reset_index(drop=True)
    out = []
    for i, r in n.iterrows():
        w = n[(n.date > r.date - pd.Timedelta(days=window_days)) & (n.date <= r.date)]
        if len(w) < min_obs:
            continue
        x = (w.date - w.date.min()).dt.days.values.astype(float)
        y = w.area_norm.values / w.area_norm.values[0]
        out.append(dict(date=r.date, n=len(w), slope=theil_sen(x, y), loss=1 - y[-1] / max(y.max(), 1e-9),
                        span=float(x.max())))
    return pd.DataFrame(out)


def departure_rule(df: pd.DataFrame, r: dict) -> pd.DataFrame:
    """PRIMARY rule: harmonised area vs the median of the previous `baseline_days` (all sensors), confirmed by an
    independent observation (different sensor or track) within `confirm_days` that also departs below the level."""
    d = df.sort_values("date").reset_index(drop=True)
    dep, base_n, base_from = [], [], []
    for _, x in d.iterrows():
        b = d[(d.date < x.date) & (d.date >= x.date - pd.Timedelta(days=r["baseline_days"]))]
        dep.append(x.area_norm / b.area_norm.median() - 1 if len(b) >= 3 else np.nan)
        base_n.append(len(b))
        base_from.append(b.date.min() if len(b) else x.date)
    d = d.assign(dep=dep, base_n=base_n, base_from=base_from)
    lv, conf_by = [], []
    for _, x in d.iterrows():
        level, by = "NORMAL", ""
        for name, thr in (("ALERT", r["dep_alert"]), ("WARNING", r["dep_warn"])):
            if not (x.dep < thr):
                continue
            c = d[(d.date <= x.date) & (d.date >= x.date - pd.Timedelta(days=r["confirm_days"])) &
                  ((d.sensor != x.sensor) | (d.track != x.track)) & (d.dep < thr)]
            if len(c):
                level, by = name, ", ".join(f"{a.sensor} {a.track} {a.date.date()}" for a in c.itertuples())
                break
        lv.append(level)
        conf_by.append(by)
    return d.assign(level=lv, confirmed_by=conf_by)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=common.ROOT / "config.yaml")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    r = cfg["anomaly"]
    out = common.bundle_dir(cfg)
    work = common.ROOT / "work" / "anomaly"
    work.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(common.ROOT / "work/reservoir/series_adaptive.csv")
    df = df[df.confidence != "low"].copy()
    df["date"] = pd.to_datetime(df.date)

    # ---------------- PAIR rule
    p = pairs(df)
    rate, sig_a, sig_b, n_cal = calibrate(p, r["min_points_for_seasonal"], r["seasonal_prior_per_day"])
    p["expected"], p["z"], p["zb"], p["level"] = pair_rule(p, rate, sig_a, sig_b, r)

    # ---------------- TREND rule (NISAR)
    nis = df[df.sensor == "NISAR"].copy()
    tr = trend_rule(nis)
    st = tr[tr.date >= STABLE_FROM]
    t_rate, t_sig = float(st.slope.median()), mad_sigma(st.slope)
    tr["z"] = (tr.slope - t_rate) / t_sig
    tr["level"] = np.where((tr.z < r["z_alert"]) & (tr.loss > -r["drop_alert"]), "ALERT",
                           np.where((tr.z < r["z_warn"]) & (tr.loss > -r["drop_warn"]), "WARNING", "NORMAL"))

    # ---------------- PRIMARY departure rule
    dep = departure_rule(df, r)
    dsig = mad_sigma(dep[dep.date >= STABLE_FROM].dep)
    dep["z"] = dep.dep / dsig
    dep.to_csv(work / "departure.csv", index=False)
    d_post = dep[(dep.date > FAILURE) & (dep.date <= "2026-07-31")]
    primary = dict(
        first_alert=d_post[d_post.level == "ALERT"].head(1)[["date", "sensor", "track", "dep", "confirmed_by"]].astype(str).to_dict("records"),
        first_warning=d_post[d_post.level != "NORMAL"].head(1)[["date", "sensor", "track", "dep", "confirmed_by"]].astype(str).to_dict("records"),
        first_nisar_flag=d_post[(d_post.level != "NORMAL") & (d_post.sensor == "NISAR")].head(1)[["date", "track", "dep", "level"]].astype(str).to_dict("records"),
        pre_failure_flags=int((dep[dep.date <= FAILURE].level != "NORMAL").sum()),
        aug_nov_alerts=dep[(dep.date >= "2026-08-01") & (dep.level == "ALERT")][["date", "sensor", "track", "dep"]].astype(str).to_dict("records"),
        aug_nov_warnings=int(((dep.date >= "2026-08-01") & (dep.level == "WARNING")).sum()),
        sigma_departure=round(dsig, 4))

    # ---------------- tests (docs/07 §4)
    post = p[(p.date > FAILURE) & (p.date <= "2026-07-31")]
    first_pair_alert = post[post.level == "ALERT"].head(1)
    first_trend_alert = tr[(tr.date > FAILURE) & (tr.level == "ALERT")].head(1)
    calm = p[p.date >= "2026-08-01"]
    b2 = dict(pairs=int(len(calm)), warnings=int((calm.level == "WARNING").sum()), alerts=int((calm.level == "ALERT").sum()),
              trend_warnings=int((tr[tr.date >= "2026-08-01"].level == "WARNING").sum()),
              trend_alerts=int((tr[tr.date >= "2026-08-01"].level == "ALERT").sum()))
    pre = p[p.date <= FAILURE]
    b2_pre = dict(pairs=int(len(pre)), warnings=int((pre.level == "WARNING").sum()), alerts=int((pre.level == "ALERT").sum()))
    # B3 synthetic injection on stable same-track pairs
    rng = np.random.default_rng(42)
    stable = p[p.date >= STABLE_FROM]
    b3 = {}
    for drop in (-0.10, -0.20, -0.30):
        hits = 0
        for _ in range(300):
            row = stable.iloc[rng.integers(len(stable))]
            da = (1 + row.da) * (1 + drop) - 1
            za = (da - rate * row.days) / (sig_a * np.sqrt(row.days))
            hits += bool((za < r["z_alert"] and da < r["drop_alert"]) or (za < r["z_warn"] and da < r["drop_warn"]))
        b3[f"{int(drop * 100)}%"] = round(hits / 300, 3)
    fa = float(((stable.z < r["z_warn"]) & (stable.da < r["drop_warn"])).mean())
    b4 = {}
    for zt in (-2.5, -3.0, -3.5):
        b4[str(zt)] = int(((post.z < zt) & (post.da < r["drop_alert"])).sum())

    tests = dict(PRIMARY_departure_rule=primary, calibration=dict(stable_from=STABLE_FROM, n_pairs=n_cal, seasonal_rate_per_day=round(rate, 5),
                                  sigma_area_per_sqrt_day=round(sig_a, 4), sigma_db_per_sqrt_day=round(sig_b, 3),
                                  trend_rate=round(t_rate, 5), trend_sigma=round(t_sig, 5)),
                 B1_first_pair_alert=first_pair_alert[["date", "sensor", "track", "prev", "da", "z"]].astype(str).to_dict("records"),
                 B1_first_trend_alert=first_trend_alert[["date", "n", "slope", "loss", "z"]].astype(str).to_dict("records"),
                 B2_false_alarms_aug_oct=b2, B2_pre_failure=b2_pre,
                 B3_detection_rate=b3, B3_false_alarm_rate_stable=round(fa, 3), B4_alerts_by_z=b4)
    (work / "tests.json").write_text(json.dumps(tests, indent=2, default=str), "utf-8")
    p.to_csv(work / "evaluations.csv", index=False)
    tr.to_csv(work / "trend.csv", index=False)

    # ---------------- alerts.json (pair evaluations for NISAR + S1; trend alerts as NISAR "trend" entries)
    def fmt_date(d):
        return pd.Timestamp(d).strftime("%-d %b %Y") if sys.platform != "win32" else pd.Timestamp(d).strftime("%#d %b %Y")

    evals = []
    for e in dep.itertuples():                     # PRIMARY: one evaluation per observation
        if not np.isfinite(e.dep):
            continue
        sensor_name = "NISAR" if e.sensor == "NISAR" else "Sentinel-1"
        everyone = (f"{fmt_date(e.date)} ({sensor_name}): lake area {e.dep * 100:+.0f}% compared with the previous "
                    f"{r['baseline_days']} days.")
        if e.level != "NORMAL":
            everyone += (f" Confirmed by another satellite pass ({e.confirmed_by}). "
                         + ("ALERT: far outside normal." if e.level == "ALERT" else "WARNING: unusual."))
        experts = (f"{e.sensor} {e.track}: harmonised area {e.area_norm:.2f} km² vs median of {e.base_n} obs since "
                   f"{e.base_from.date()} → departure {e.dep * 100:+.1f}% (z {e.z:.1f}, σ {dsig * 100:.1f}% from the "
                   f"Aug–Oct period). Levels: WARNING < {r['dep_warn'] * 100:.0f}%, ALERT < {r['dep_alert'] * 100:.0f}%, "
                   f"each confirmed by an independent pass within {r['confirm_days']} days."
                   + (f" Confirmed by: {e.confirmed_by}." if e.confirmed_by else ""))
        evals.append(C.Evaluation(date=str(e.date.date()), prev=str(e.base_from.date()), days=float(r["baseline_days"]),
                                  delta=round(float(e.dep), 4), expected=0.0, z=round(float(e.z), 2), level=e.level,
                                  cross_sensor=bool(e.confirmed_by and (("S1" in e.confirmed_by) != (e.sensor == "S1"))),
                                  text=C.Text(everyone=everyone, experts=experts)))
    _pair_evals = []
    for e in p.itertuples():
        cross = False
        sensor_name = "NISAR" if e.sensor == "NISAR" else "Sentinel-1"
        everyone = (f"{fmt_date(e.date)}: lake area {e.da * 100:+.0f}% in {e.days} days ({sensor_name}). "
                    f"A normal summer change would be {e.expected * 100:+.1f}%.")
        if e.level == "ALERT":
            everyone += " That is far outside normal: ALERT."
        elif e.level == "WARNING":
            everyone += " Unusual: WARNING."
        experts = (f"{e.sensor} {e.track}: A {e.A_prev:.2f} → {e.A:.2f} km² ({e.prev.date()} → {e.date.date()}, Δa {e.da * 100:+.1f}%); "
                   f"expected {e.expected * 100:+.2f}% (seasonal {rate * 100:+.2f}%/day); z = {e.z:.2f} "
                   f"(σ {sig_a:.3f}/√day, calibrated on {n_cal} stable pairs); lake median Δ {e.db:+.2f} dB (z_b {e.zb:.1f}).")
        _pair_evals.append(C.Evaluation(date=str(e.date.date()), prev=str(e.prev.date()), days=float(e.days), delta=round(float(e.da), 4),
                                  expected=round(float(e.expected), 4), z=round(float(e.z), 2), level=e.level,
                                  cross_sensor=cross, text=C.Text(everyone=everyone, experts=experts)))
    for t in tr[tr.level != "NORMAL"].itertuples():
        _pair_evals.append(C.Evaluation(
            date=str(t.date.date()), prev=str((t.date - pd.Timedelta(days=t.span)).date()), days=float(t.span),
            delta=round(-float(t.loss), 4), expected=round(float(t_rate * t.span), 4), z=round(float(t.z), 2), level=t.level,
            cross_sensor=False,
            text=C.Text(everyone=(f"{fmt_date(t.date)}: across all NISAR tracks the lake lost {t.loss * 100:.0f}% in "
                                  f"{t.span:.0f} days — a sustained decline. {t.level}."),
                        experts=(f"NISAR trend rule: {t.n} harmonised obs in a 14-day window, Theil–Sen slope "
                                 f"{t.slope * 100:+.2f}%/day vs stable {t_rate * 100:+.2f}%/day (σ {t_sig * 100:.2f}); z = {t.z:.2f}."))))
    evals.sort(key=lambda e: e.date)
    b = bundle_mod()
    b.write_json(out / C.BUNDLE_PATHS["alerts"], C.Alerts(
        badge="MODELLED", source="Rule-based detector on MEASURED NISAR + Sentinel-1 water areas (this project)",
        method=f"harmonised area vs {r['baseline_days']}-day multi-sensor baseline; WARNING < {r['dep_warn']*100:.0f}%, "
               f"ALERT < {r['dep_alert']*100:.0f}%, each confirmed by an independent pass within {r['confirm_days']} days",
        uncertainty=f"σ of departures {dsig * 100:.1f}% (Aug–Oct); flags in Oct–Nov coincide with a real multi-sensor decline after the late-September rise and cannot be classified without operator data",
        dam_id=cfg["dam"]["id"],
        rule=C.Rule(z_alert=r["z_alert"], drop_alert=r["drop_alert"], z_warn=r["z_warn"], drop_warn=r["drop_warn"],
                    seasonal_rate_per_day=round(rate, 5), sigma_per_sqrt_day=round(sig_a, 4)),
        evaluations=evals), force=True)

    lines = ["# Anomaly detector — test report", "", "```json", json.dumps(tests, indent=2, default=str), "```", "",
             "## Non-normal evaluations", "",
             p[p.level != "NORMAL"][["date", "sensor", "track", "prev", "days", "da", "z", "zb", "level"]].round(3).to_markdown(index=False),
             "", "## NISAR trend rule", "", tr[tr.level != "NORMAL"].round(4).to_markdown(index=False)]
    (work / "report.md").write_text("\n".join(lines), "utf-8")
    print(json.dumps(tests, indent=1, default=str))
    print(p[p.level != "NORMAL"][["date", "sensor", "track", "days", "da", "z", "zb", "level"]].round(3).to_string(index=False))
    print(tr[tr.level != "NORMAL"].round(4).to_string(index=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
