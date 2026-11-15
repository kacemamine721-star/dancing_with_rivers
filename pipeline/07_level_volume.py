#!/usr/bin/env python3
"""07 · Level & volume (docs/03 §5.4, docs/07 §2): SWOT lake height, shoreline × DEM, ΔV from area × level.

  A · SWOT LakeSP (MEASURED)   Prior Lake Database ID looked up once in a LakeSP_Prior granule (Earthdata token,
                               cached in cache/swot/), then the Hydrocron time series (no auth, cached CSV).
  B · Shoreline × DEM          land-side DEM elevations along each radar water mask edge; flagged "not measurable"
                               where the shoreline lies on/below the DEM-era water surface (NASADEM = SRTM Feb 2000).
  C · ΔV (C2, docs/07 §2.3)    trapezoid ∫A dh between two SWOT passes; A from the radar series (low side) and from
                               SWOT area_total (high side). MODELLED.
  Reported volumes (REPORTED)  21 Mm³ released (alt. 29 Mm³), press sources.

Outputs: <bundle>/level/level_volume.json · work/level/{swot_all.csv, shoreline.csv, tests.json, qa.png}

  python pipeline/07_level_volume.py [--config config.yaml] [--refresh] [--max-quality 1]
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import io
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
from common import contracts as C  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

ROOT = common.ROOT
CACHE = ROOT / "cache" / "swot"
WORK = ROOT / "work" / "level"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
LAKESP_PRIOR = "C3233942291-POCLOUD"          # SWOT_L2_HR_LakeSP_prior_D (version D)
HYDROCRON = "https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries"
FIELDS = ("lake_id,time_str,wse,wse_u,wse_r_u,area_total,area_tot_u,quality_f,partial_f,dark_frac,ice_clim_f,"
          "xtrk_dist,crid")
FILL = -999999999999.0
SWOT_SRC = "SWOT (NASA/CNES) Hydrocron LakeSP"
REPORTED = [
    dict(what="Released volume (gate failure, 17–18 Jun 2026)", value_m3=21e6, alt=29e6,
         source="https://www.lapresse.tn/2026/06/19/panne-au-barrage-de-mellegue-21-millions-de-m%C2%B3-deau-relaches-en-quelques-heures/ ; "
                "alt. 29 Mm³: https://www.tunisienumerique.com/incident-du-barrage-de-mellegue-ce-que-lon-sait-apres-lecoulement-de-29-millions-de-m%C2%B3/"),
]


def load_mod(fname: str, name: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(fname))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ================================================================================================ A · SWOT
def pld_lookup(cfg, lake_poly_ll) -> dict:
    """Find the PLD lake whose reference point falls in/near our lake polygon (cached in cache/swot/pld_lookup.json)."""
    fp = CACHE / "pld_lookup.json"
    if fp.exists():
        return json.loads(fp.read_text(encoding="utf-8"))
    import requests
    common.load_env()
    tok = os.environ.get("EARTHDATA_TOKEN")
    if not tok:
        return dict(lake_id=None, reason="EARTHDATA_TOKEN not set: cannot read a LakeSP_Prior granule to find the PLD lake ID")
    lon0, lat0, lon1, lat1 = cfg["aoi"]["lake"]
    js = requests.get(CMR, params=dict(collection_concept_id=LAKESP_PRIOR, bounding_box=f"{lon0},{lat0},{lon1},{lat1}",
                                       temporal="2026-01-01T00:00:00Z,2026-11-15T00:00:00Z", page_size=50),
                      timeout=120).json()
    links = [l["href"] for e in js["feed"]["entry"] if "_AF_" in e["title"]
             for l in e.get("links", []) if l["href"].startswith("https") and l["href"].endswith(".zip")]
    if not links:
        return dict(lake_id=None, reason="no SWOT LakeSP_Prior (AF) granule over the lake box in CMR")
    import geopandas as gpd
    from shapely.geometry import Point
    CACHE.mkdir(parents=True, exist_ok=True)
    for url in links[:5]:
        p = CACHE / url.rsplit("/", 1)[1]
        if not p.exists():
            r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=300)
            r.raise_for_status()
            p.write_bytes(r.content)
        g = gpd.read_file(f"zip://{p}")
        d = g.apply(lambda r: lake_poly_ll.distance(Point(r.p_lon, r.p_lat)), axis=1)
        cand = g[d < 0.02]  # ≈ 2 km; several PLD lakes (river pools, tail) touch the polygon: take the largest
        if len(cand):
            r = cand.loc[cand.p_ref_area.idxmax()]
            d = d[cand.index]
            out = dict(lake_id=str(r.lake_id), lake_name=str(r.lake_name), p_lon=float(r.p_lon), p_lat=float(r.p_lat),
                       p_ref_area_km2=float(r.p_ref_area), p_ref_wse=float(r.p_ref_wse), granule=p.name,
                       dist_deg=round(float(d[r.name]), 5), n_candidates=int(len(cand)), looked_up_utc=dt.datetime.now(dt.timezone.utc).isoformat()[:16])
            fp.write_text(json.dumps(out, indent=1), encoding="utf-8")
            return out
    return dict(lake_id=None, reason="no Prior Lake Database lake within 2 km of the Mellègue lake polygon")


def hydrocron(lake_id: str, refresh: bool) -> tuple[pd.DataFrame, str]:
    fp = CACHE / f"hydrocron_{lake_id}.csv"
    if refresh or not fp.exists():
        import requests
        end = dt.date.today().isoformat() + "T00:00:00Z"
        r = requests.get(HYDROCRON, params=dict(feature="PriorLake", feature_id=lake_id, start_time="2023-07-01T00:00:00Z",
                                                end_time=end, output="csv", fields=FIELDS), timeout=180)
        r.raise_for_status()
        CACHE.mkdir(parents=True, exist_ok=True)
        fp.write_text(r.json()["results"]["csv"], encoding="utf-8")
        (CACHE / f"hydrocron_{lake_id}.meta.json").write_text(json.dumps(dict(
            url=r.url, retrieved_utc=dt.datetime.now(dt.timezone.utc).isoformat()[:16]), indent=1), encoding="utf-8")
    meta = json.loads((CACHE / f"hydrocron_{lake_id}.meta.json").read_text(encoding="utf-8")) \
        if (CACHE / f"hydrocron_{lake_id}.meta.json").exists() else {}
    df = pd.read_csv(fp, dtype={"lake_id": str})
    df = df[(df.time_str != "no_data") & (df.wse > FILL / 2)].copy()
    df["date"] = df.time_str.str[:10]
    return df.sort_values("time_str").reset_index(drop=True), meta.get("retrieved_utc", "")


# ================================================================================================ B · shoreline × DEM
def shoreline_levels(cfg, swot_dates: list[str]) -> pd.DataFrame:
    """Recompute the 02_reservoir adaptive masks for selected dates and read NASADEM on the land side of the edge."""
    import geopandas as gpd
    import rasterio
    import rasterio.features
    from rasterio.warp import Resampling, reproject
    from scipy import ndimage as ndi
    R = load_mod("02_reservoir.py", "res02")
    out = common.bundle_dir(cfg)
    series = pd.read_csv(ROOT / "work/reservoir/series_adaptive.csv")
    series = series[series.confidence != "low"]
    # dates: every NISAR D80 pass + the S1 "before" + the radar image closest to each SWOT pass (≤ 3 days)
    pick = series[(series.sensor == "NISAR") & (series.track.str.startswith("D80"))].copy()
    pick = pd.concat([pick, series[(series.date == cfg["event"]["s1_before"]["date"]) & (series.track == "o88")]])
    sd = pd.to_datetime(series.date)
    for d in swot_dates:
        k = (sd - pd.Timestamp(d)).abs()
        if k.min() <= pd.Timedelta(days=3):
            pick = pd.concat([pick, series.loc[[k.idxmin()]]])
    pick = pick.drop_duplicates(["date", "sensor", "track"]).sort_values("date")

    lake = cfg["aoi"]["lake"]
    pad = 0.03
    grid = R.Grid(R.utm_box((lake[0] - pad, lake[1] - pad, lake[2] + pad, lake[3] + pad)))
    lp = gpd.read_file(out / "vectors/lake_max.geojson").to_crs(32632)
    lake_mask = rasterio.features.rasterize([(g, 1) for g in lp.geometry], out_shape=(grid.h, grid.w),
                                            transform=grid.transform).astype(bool)
    ring = ndi.binary_dilation(lake_mask, structure=R.disk(30)) & ~lake_mask
    zone = lake_mask | ring
    dl = gpd.read_file(out / "vectors/dam_line.geojson").to_crs(32632).buffer(150)
    near_dam = rasterio.features.rasterize([(g, 1) for g in dl], out_shape=(grid.h, grid.w),
                                           transform=grid.transform).astype(bool)
    with rasterio.open(ROOT / "work/dem_32632_30m.tif") as src:
        dem = np.full((grid.h, grid.w), np.nan, np.float32)
        reproject(rasterio.band(src, 1), dem, dst_transform=grid.transform, dst_crs="EPSG:32632",
                  resampling=Resampling.bilinear)
        flat30 = np.full((grid.h, grid.w), 0, np.uint8)
        z30 = src.read(1)
        from rasterio.mask import mask as rmask
        zin, _ = rmask(src, list(lp.geometry), crop=False, filled=False)
        v = np.round(zin[0].compressed(), 1)
        vals, cnt = np.unique(v, return_counts=True)
        z_flat = float(vals[np.argmax(cnt)])
        flat_area = float(cnt.max()) * 900 / 1e6
        reproject(((np.abs(z30 - z_flat) < 0.05)).astype(np.uint8), flat30, src_transform=src.transform,
                  src_crs=src.crs, dst_transform=grid.transform, dst_crs="EPSG:32632", resampling=Resampling.nearest)
    flat = flat30.astype(bool) & ndi.binary_dilation(lake_mask, iterations=3)
    k = cfg["water"]["boxcar"]
    rows = []
    for _, r in pick.iterrows():
        db = R.load_db(r, grid, k)
        t, _ = R.otsu_thr(db[zone], *R.CLAMP[r["sensor"]])
        water = R.clean((db < t) & lake_mask)
        land = ndi.binary_dilation(water, iterations=2) & ~water & ~near_dam & np.isfinite(dem)
        z = dem[land]
        frac_flat = float(flat[land].mean()) if land.any() else 1.0
        row = dict(date=r["date"], sensor=r["sensor"], track=r["track"], thr_db=round(t, 2),
                   area_km2=round(water.sum() * 1e-4, 3), n_land=int(land.sum()), frac_on_dem_water=round(frac_flat, 3),
                   z_flat=z_flat)
        if z.size < 50:
            row.update(level_m=None, sigma_m=None, measurable=False, note="too few shoreline pixels")
        elif frac_flat > 0.3:
            row.update(level_m=None, sigma_m=None, measurable=False,
                       note=f"{frac_flat:.0%} of the shoreline lies on the DEM-era water surface "
                            f"({z_flat:.0f} m, SRTM Feb 2000): level at or below it is not measurable")
        else:
            lo, hi = np.percentile(z, [10, 90])
            zz = z[(z > lo) & (z < hi)]
            lev = float(np.median(zz))
            s_stat = 1.4826 * float(np.median(np.abs(zz - lev))) / np.sqrt(max(1, z.size / 9))
            sig = float(np.hypot(s_stat, 2.0))   # + NASADEM vertical error on gentle banks (docs/03 §5.4: ±1–3 m)
            row.update(level_m=round(lev, 2), sigma_m=round(sig, 2), measurable=True,
                       note=f"trimmed median of {z.size} land-side DEM cells; {frac_flat:.0%} on the DEM-era water surface")
        rows.append(row)
        print(f"  B {r['date']} {r['sensor']} {r['track']}: {row['note'][:80]} {row.get('level_m')}")
    df = pd.DataFrame(rows)
    df.attrs.update(z_flat=z_flat, flat_area_km2=round(flat_area, 2))
    return df


# ================================================================================================ helpers
def radar_area(points: pd.DataFrame, date: str, days=3) -> tuple[float, float, int] | None:
    """Median harmonised radar area (NISAR + S1, confidence ≠ low) within ±days of a date; σ = median sigma_km2."""
    d = (pd.to_datetime(points.date) - pd.Timestamp(date)).dt.days.abs()
    w = points[(d <= days) & (points.confidence != "low")]
    if w.empty:
        return None
    a = w.area_norm_km2.fillna(w.area_km2)
    return float(a.median()), float(w.sigma_km2.fillna(0).median()), int(len(w))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=ROOT / "config.yaml")
    ap.add_argument("--refresh", action="store_true", help="re-query Hydrocron (default: use the cached CSV)")
    ap.add_argument("--max-quality", type=int, default=1, choices=[0, 1, 2],
                    help="SWOT quality_f kept in the bundle (docs/07 §2.1: ≤ 1 = good + suspect [default]; "
                         "ΔV and tests L1–L3/L6 always use quality_f = 0 only)")
    ap.add_argument("--no-shoreline", action="store_true")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    out = common.bundle_dir(cfg)
    WORK.mkdir(parents=True, exist_ok=True)
    b = load_mod("08_bundle.py", "bundle08")
    import geopandas as gpd

    lake_ll = gpd.read_file(out / "vectors/lake_max.geojson").to_crs(4326).geometry.union_all()
    ra = json.loads((out / C.BUNDLE_PATHS["reservoir_area"]).read_text(encoding="utf-8"))
    pts = pd.DataFrame(ra["points"])
    failure = cfg["event"]["s1_before"]["date"]
    tests: dict = {}

    # ---- A · SWOT
    pld = pld_lookup(cfg, lake_ll)
    good = pd.DataFrame()
    if pld.get("lake_id"):
        allp, retrieved = hydrocron(pld["lake_id"], args.refresh)
        allp.to_csv(WORK / "swot_all.csv", index=False)
        keep = (allp.quality_f <= args.max_quality) & (allp.partial_f == 0) & (allp.ice_clim_f == 0)
        good = allp[keep].reset_index(drop=True)
        qn = allp.quality_f.value_counts().to_dict()
        swot = C.Swot(
            available=len(good) > 0, lake_id=pld["lake_id"],
            reason=(f"PLD lake {pld['lake_id']} ({pld['lake_name']}); {len(allp)} observed passes "
                    f"{allp.date.min()}…{allp.date.max()} (quality_f 0/1/2 = {qn.get(0, 0)}/{qn.get(1, 0)}/{qn.get(2, 0)}); "
                    f"kept quality_f ≤ {args.max_quality}, partial_f = 0: {len(good)} passes") if len(allp) else
                   f"PLD lake {pld['lake_id']} found but Hydrocron returned no observation",
            points=[C.SwotPoint(time=r.time_str, wse_m=round(float(r.wse), 3), wse_u=round(float(r.wse_u), 3),
                                area_km2=round(float(r.area_total), 3), quality=int(r.quality_f)) for r in good.itertuples()],
            badge="MEASURED", source=f"{SWOT_SRC} (PLD lake_id {pld['lake_id']}, collection SWOT_L2_HR_LakeSP_D; "
                                     f"Hydrocron retrieved {retrieved} UTC)",
            method="lake water-surface elevation (wse, m above the EGM2008 geoid) and area_total per pass; "
                   f"quality_f ≤ {args.max_quality} (0 good, 1 suspect: shown hollow), partial_f = 0, no ice flag; "
                   "ΔV and the level-drop tests use only quality_f = 0 passes",
            uncertainty="± wse_u per pass (product total uncertainty, 1σ); area_total includes SWOT's dark-water/"
                        "edge estimate and reads larger than the radar masks")
    else:
        swot = C.Swot(available=False, lake_id=None, reason=pld.get("reason", "PLD lake not found"),
                      badge="MEASURED", source=SWOT_SRC)

    # ---- tests L1–L3
    q0 = good[good.quality_f == 0] if len(good) else good   # ΔV and L1–L3/L6 use good-quality passes only
    pre = q0[q0.date < failure]
    post = q0[q0.date > failure]
    if len(q0):
        l1 = []
        for r in q0.itertuples():
            a = radar_area(pts, r.date)
            if a:
                l1.append(dict(date=r.date, swot_km2=round(r.area_total, 3), radar_km2=round(a[0], 3),
                               diff=round(r.area_total / a[0] - 1, 3)))
        md = float(np.median([abs(x["diff"]) for x in l1])) if l1 else None
        tests["L1"] = dict(name="SWOT area_total vs radar area (≤ 3 days)", pairs=l1,
                           median_abs_diff=round(md, 3) if md is not None else None, criterion="≤ 20%",
                           passed=(md <= 0.20) if md is not None else None)
    if len(pre) and len(post):
        p0, p1 = pre.iloc[-1], post.iloc[0]
        dh = float(p1.wse - p0.wse)
        su = float(np.hypot(p0.wse_u, p1.wse_u))
        a0, a1 = radar_area(pts, p0.date), radar_area(pts, p1.date)
        sign_ok = (a0 is not None and a1 is not None and (a1[0] - a0[0]) < 0 and dh < 0)
        tests["L2"] = dict(name="Sign test: SWOT level and radar area both fall across the failure",
                           swot_dates=[p0.date, p1.date], dh_m=round(dh, 3),
                           radar_area_km2=[round(a0[0], 3) if a0 else None, round(a1[0], 3) if a1 else None],
                           criterion="same sign", passed=bool(sign_ok))
        tests["L3"] = dict(name="Level drop across the event (last SWOT before → first after)",
                           from_date=p0.date, to_date=p1.date, wse_from=float(p0.wse), wse_to=float(p1.wse),
                           dh_m=round(dh, 3), dh_u_m=round(su, 3), criterion="report Δh ± wse_u", passed=True)

    # ---- C · ΔV (C2: trapezoid between SWOT passes; area from radar (low) and SWOT area_total (high))
    deltas, dv_rows = [], []
    if len(pre) and len(post):
        p0 = pre.iloc[-1]
        for p1 in post.iloc[:1].itertuples():   # last good pass before → first good pass after the failure
            a0, a1 = radar_area(pts, p0.date), radar_area(pts, p1.date)
            if not (a0 and a1):
                continue
            dh = float(p0.wse - p1.wse)                       # positive = level fell
            sh = 2 * float(np.hypot(p0.wse_u, p1.wse_u))
            v_radar = (a0[0] + a1[0]) / 2 * 1e6 * dh
            v_swot = (p0.area_total + p1.area_total) / 2 * 1e6 * dh
            low = ((a0[0] - a0[1]) + (a1[0] - a1[1])) / 2 * 1e6 * (dh - sh)
            high = ((p0.area_total + p0.area_tot_u) + (p1.area_total + p1.area_tot_u)) / 2 * 1e6 * (dh + sh)
            mid = (v_radar + v_swot) / 2
            dv_rows.append(dict(from_=p0.date, to=p1.date, dh=dh, v_radar=v_radar, v_swot=v_swot, low=low, high=high))
            deltas.append(C.DeltaVolume(**{"from": p0.date}, to=p1.date, dV_m3=round(-mid, -4), low=round(-high, -4),
                                        high=round(-low, -4), badge="MODELLED",
                                        method=(f"C2 trapezoid ∫A·dh between quality_f = 0 SWOT passes: Δh = {-dh:+.2f} m (SWOT {p0.wse:.2f} → {p1.wse:.2f} m); "
                                                f"A = radar {a0[0]:.2f}/{a1[0]:.2f} km² (low side) or SWOT area_total "
                                                f"{p0.area_total:.2f}/{p1.area_total:.2f} km² (high side); central = mean")))
    if dv_rows:
        r0 = next((r for r in dv_rows if r["to"] <= "2026-07-05"), dv_rows[0])
        mid = (r0["v_radar"] + r0["v_swot"]) / 2
        ratio = mid / 21e6
        tests["L6"] = dict(name="ΔV across the event vs reported 21 Mm³ (alt. 29)", from_date=r0["from_"], to_date=r0["to"],
                           dV_mm3=round(mid / 1e6, 1), low_mm3=round(r0["low"] / 1e6, 1), high_mm3=round(r0["high"] / 1e6, 1),
                           ratio_to_21=round(ratio, 2), criterion="within a factor of 2, or the discrepancy explained",
                           passed=bool(0.5 <= ratio <= 2.0))

    # ---- B · shoreline × DEM
    shore, sh_df = [], pd.DataFrame()
    if not args.no_shoreline:
        sh_df = shoreline_levels(cfg, list(good.date) if len(good) else [])
        sh_df.to_csv(WORK / "shoreline.csv", index=False)
        m = sh_df[sh_df.measurable]
        stab = m[m.date >= "2026-09-01"]
        tests["L4"] = dict(name="Shoreline level stability on stable dates (Sep–Oct)", n=int(len(stab)),
                           sd_m=round(float(stab.level_m.std()), 2) if len(stab) > 1 else None, criterion="σ ≤ 1.5 m",
                           passed=(bool(stab.level_m.std() <= 1.5) if len(stab) > 1 else None),
                           note=f"{len(m)}/{len(sh_df)} dates measurable; DEM-era water surface {sh_df.attrs['z_flat']:.1f} m "
                                f"over {sh_df.attrs['flat_area_km2']} km²")
        l5 = []
        for r in m.itertuples():
            d = (pd.to_datetime(good.date) - pd.Timestamp(r.date)).dt.days.abs() if len(good) else pd.Series(dtype=int)
            if len(d) and d.min() <= 3:
                s = good.loc[d.idxmin()]
                l5.append(dict(date=r.date, shoreline_m=r.level_m, swot_m=round(float(s.wse), 2),
                               diff_m=round(r.level_m - float(s.wse), 2)))
        tests["L5"] = dict(name="Shoreline level vs SWOT (≤ 3 days)", pairs=l5,
                           max_abs_diff_m=max((abs(x["diff_m"]) for x in l5), default=None), criterion="≤ 2 m",
                           passed=(all(abs(x["diff_m"]) <= 2 for x in l5) if l5 else None))
        # Ship method B only if it passes L5 against SWOT; otherwise every date is "not measurable" with the reason
        rejected = tests["L5"]["passed"] is False
        why = (f"method rejected: shoreline × NASADEM reads {tests['L5']['max_abs_diff_m']:+.1f} m vs SWOT "
               f"(test L5, criterion ≤ 2 m) — 30 m DEM on steep banks, lake within ~1 m of the DEM-era water "
               f"surface ({sh_df.attrs['z_flat']:.0f} m, SRTM Feb 2000); post-failure levels are below it") if rejected else ""
        for r in sh_df.itertuples():
            ok = bool(r.measurable) and not rejected
            shore.append(C.ShorelineLevel(date=r.date, level_m=r.level_m if ok else None, sigma_m=r.sigma_m if ok else None,
                                          measurable=ok, badge="MODELLED",
                                          note=f"{r.sensor} {r.track}: " + (why if rejected and r.measurable else r.note)))
        tests["L5"]["shipped"] = not rejected

    # ---- write
    n_meas = sum(s.measurable for s in shore)
    lv = C.LevelVolume(
        badge="MEASURED" if swot.available else "MODELLED",
        source=f"{SWOT_SRC}; NISAR GCOV + Sentinel-1 RTC water areas (timeseries/reservoir_area.json); NASADEM; press (reported volumes)",
        method="A: SWOT lake height (MEASURED). B: radar shoreline × NASADEM (MODELLED, valid only above the DEM-era "
               "water surface" + ("; rejected here, fails test L5 against SWOT, see notes" if tests.get("L5", {}).get("passed") is False
                                  else "") + "). C: ΔV = trapezoid ∫A·dh between SWOT passes (MODELLED). "
               "Reported volumes are press figures (REPORTED).",
        uncertainty="SWOT wse ± wse_u (cm–dm); ΔV band spans radar-area (low) vs SWOT-area (high) and ±2σ Δh; "
                    "storage change is net of inflow, so it is not the released volume",
        dam_id=cfg["dam"]["id"], swot=swot, dem_shoreline=shore, delta_volume=deltas,
        reported=[C.Reported(badge="REPORTED", **r) for r in REPORTED])
    b.write_json(out / C.BUNDLE_PATHS["level_volume"], lv, force=True)
    prov = dict(script="pipeline/07_level_volume.py", run_utc=dt.datetime.now(dt.timezone.utc).isoformat()[:16],
                pld=pld, max_quality=args.max_quality, n_swot_kept=len(good), n_shoreline=len(shore),
                n_shoreline_measurable=n_meas, tests=tests)
    (WORK / "tests.json").write_text(json.dumps(prov, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    qa_plot(allp if pld.get("lake_id") else pd.DataFrame(), good, pts, sh_df, cfg)
    print(json.dumps(tests, indent=1, ensure_ascii=False, default=str))
    return b.validate(out)


def qa_plot(allp, good, pts, sh_df, cfg):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(2, 1, figsize=(12, 7), dpi=100, sharex=True)
    if len(allp):
        for q, mk in ((0, "o"), (1, "s"), (2, "x")):
            g = allp[allp.quality_f == q]
            ax[0].errorbar(pd.to_datetime(g.date), g.wse, yerr=g.wse_u, fmt=mk, ms=5,
                           mfc="C0" if q == 0 else "none", color="C0", label=f"SWOT quality_f={q}")
    if len(sh_df):
        m = sh_df[sh_df.measurable]
        ax[0].errorbar(pd.to_datetime(m.date), m.level_m, yerr=m.sigma_m, fmt="d", color="C3", label="shoreline × NASADEM")
        ax[0].axhline(sh_df.attrs["z_flat"], color="grey", ls=":", lw=1, label="NASADEM water surface (Feb 2000)")
    ax[0].set_ylabel("water level (m)")
    ax[0].legend(fontsize=7)
    x = pd.to_datetime(pts.date)
    ax[1].plot(x, pts.area_norm_km2, ".", ms=4, color="C2", label="radar area (harmonised)")
    if len(allp):
        ax[1].plot(pd.to_datetime(allp.date), allp.area_total, "o", mfc="none", color="C0", label="SWOT area_total")
    ax[1].set_ylabel("area (km²)")
    ax[1].legend(fontsize=7)
    for e in cfg["events"]:
        for a in ax:
            a.axvline(pd.to_datetime(e["date"]), color="#ff4fd2", ls="--", lw=.8)
    ax[0].set_title("Mellègue — SWOT lake height, shoreline × DEM, radar area (QA)")
    fig.tight_layout()
    fig.savefig(WORK / "qa.png")
    plt.close(fig)


if __name__ == "__main__":
    sys.exit(main())
