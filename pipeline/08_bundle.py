#!/usr/bin/env python3
"""08 · Bundle: assemble, validate and (optionally) bootstrap the web data bundle.

  python pipeline/08_bundle.py --fixture     # write a complete PLACEHOLDER bundle (badge ILLUSTRATIVE) so the web
                                             # app can be built before real outputs exist; real files overwrite it
  python pipeline/08_bundle.py --validate    # validate every contract JSON + check that every manifest file exists
  python pipeline/08_bundle.py --schemas     # export contracts/*.schema.json from pipeline/common/contracts.py

Real pipeline steps (01–07) write their own files into the bundle and register layers through `register_layer`;
this script never overwrites a non-placeholder file with a fixture.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
from common import contracts as C  # noqa: E402

PH = dict(badge="ILLUSTRATIVE", source="Placeholder fixture — replaced by pipeline output", placeholder=True)


# ------------------------------------------------------------------------------------------------ io helpers
def write_json(path: Path, model, force: bool = False) -> bool:
    """Write a validated contract model. Refuse to overwrite real (non-placeholder) data with a fixture."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        try:
            if not json.loads(path.read_text(encoding="utf-8")).get("placeholder", False):
                print(f"  keep (real data) {path.name}")
                return False
        except json.JSONDecodeError:
            pass
    data = model.model_dump(mode="json", by_alias=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def load_manifest(out: Path) -> dict:
    p = out / C.BUNDLE_PATHS["manifest"]
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def register_layer(out: Path, layer: dict, product: str, dam_id: str, version: str) -> None:
    """Add or replace one layer entry in manifest.json (used by every pipeline step)."""
    m = load_manifest(out) or dict(version=version, product=product, dam_id=dam_id, layers=[], files=dict(C.BUNDLE_PATHS))
    m["layers"] = [l for l in m.get("layers", []) if l["id"] != layer["id"]] + [layer]
    m["generated_utc"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    m["placeholder"] = all(l.get("placeholder", False) for l in m["layers"])
    write_json(out / C.BUNDLE_PATHS["manifest"], C.Manifest.model_validate(m), force=True)


# ------------------------------------------------------------------------------------------------ fixture rasters
def _png(path: Path, arr, mode: str) -> None:
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, mode=mode).save(path, optimize=True)


def fixture_rasters(out: Path, grid: C.Grid) -> None:
    import numpy as np

    w, h = 512, 384                                    # small placeholder; real grid comes from 01_terrain.py
    y, x = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    z = (450 + 380 * np.sin(x * 7.0) * np.cos(y * 5.0) + 260 * np.exp(-((x - .2) ** 2 + (y - .3) ** 2) * 12)
         - 300 * np.exp(-((y - .55 + .25 * x) ** 2) * 90))          # a valley running SW→NE
    enc = np.clip(np.round((z + 100) / 0.1), 0, 65535).astype(np.uint16)
    rgb = np.zeros((h, w, 3), np.uint8)
    rgb[..., 0], rgb[..., 1] = enc >> 8, enc & 255
    _png(out / "terrain/height_scene.png", rgb, "RGB")
    shade = np.clip(128 + np.gradient(z, axis=1) * 6 - np.gradient(z, axis=0) * 6, 0, 255).astype(np.uint8)
    _png(out / "terrain/hillshade.png", shade, "L")
    cw, ch = grid.lake_chip.size_px
    yy, xx = np.mgrid[0:ch, 0:cw] / np.array([ch, cw])[:, None, None]
    lake = ((xx - .5) / .38) ** 2 + ((yy - .45) / .12) ** 2 < 1
    rng = np.random.default_rng(7)
    for name, shrink in (("S1_17jun", 1.0), ("NISAR_19jun", .7), ("NISAR_01jul", .45)):
        m = ((xx - .5) / (.38 * shrink)) ** 2 + ((yy - .45) / .12) ** 2 < 1
        db = np.where(m, -23, -9) + rng.normal(0, 1.5, (ch, cw))
        _png(out / f"radar/fixture_{name}.png", np.clip((db + 25) / 25 * 255, 0, 255).astype(np.uint8), "L")
        _png(out / f"radar/fixture_{name}_mask.png", (m * 255).astype(np.uint8), "L")
    del lake
    from PIL import Image

    hand = np.clip(np.abs(y - .55 + .25 * x) * 3000, 0, 65535).astype(np.uint16)   # cm, scene grid
    (out / "flood").mkdir(parents=True, exist_ok=True)
    Image.fromarray(hand).save(out / "flood/hand.png")


# ------------------------------------------------------------------------------------------------ fixture JSON
def fixture(cfg: dict, out: Path) -> None:
    import numpy as np

    dam = cfg["dam"]["id"]
    product = cfg["brand"]["product"]
    version = cfg["bundle"]["version"]
    lon0, lat0, lon1, lat1 = cfg["aoi"]["scene"]
    grid = C.Grid(crs=cfg["crs"]["analysis"], bounds_m=(440000, 3995000, 535000, 4067000),
                  bounds_lonlat=(lon0, lat0, lon1, lat1), res_m=cfg["crs"]["scene_res_m"], size_px=(512, 384),
                  height_encoding=C.HeightEncoding(), z_min=140, z_max=1250, placeholder=True,
                  lake_chip=C.ChipGrid(bounds_m=(470500, 4016900, 476800, 4021300),
                                       bounds_lonlat=tuple(cfg["aoi"]["lake"]), res_m=10, size_px=(630, 440)))
    write_json(out / C.BUNDLE_PATHS["grid"], grid)
    fixture_rasters(out, grid)

    events = [C.Event(date=e["date"], label=e["label"], kind=e["kind"], badge="REPORTED",
                      source="docs/01_CONTEXT_AND_RESEARCH.md §6") for e in cfg["events"]]
    write_json(out / C.BUNDLE_PATHS["events"], C.Events(events=events), force=True)

    # Acquisition dates are real (docs/01 §4); AREAS ARE PLACEHOLDERS until 02_reservoir.py runs.
    acq = [("2026-06-17", "S1", "o88"), ("2026-06-19", "NISAR", "D80"), ("2026-06-21", "NISAR", "A101"),
           ("2026-06-22", "S1", "o88"), ("2026-06-26", "NISAR", "A173"), ("2026-07-01", "NISAR", "D80"),
           ("2026-07-03", "NISAR", "A101"), ("2026-07-08", "NISAR", "A173"), ("2026-07-13", "NISAR", "D80"),
           ("2026-07-15", "NISAR", "A101"), ("2026-07-20", "NISAR", "A173"), ("2026-07-25", "NISAR", "D80"),
           ("2026-08-14", "NISAR", "A101"), ("2026-08-18", "NISAR", "D80"), ("2026-08-26", "NISAR", "A101"),
           ("2026-08-30", "NISAR", "D80"), ("2026-09-07", "NISAR", "A101"), ("2026-09-11", "NISAR", "D80"),
           ("2026-09-19", "NISAR", "A101"), ("2026-09-23", "NISAR", "D80"), ("2026-10-01", "NISAR", "A101"),
           ("2026-10-05", "NISAR", "D80"), ("2026-10-13", "NISAR", "A101"), ("2026-10-17", "NISAR", "D80"),
           ("2026-10-29", "NISAR", "D80")]
    t0 = dt.date(2026, 6, 17)
    pts = []
    for d, sensor, trk in acq:
        k = (dt.date.fromisoformat(d) - t0).days
        a = 4.0 if k == 0 else 1.2 + 0.8 * (1 - math.exp(-max(k - 30, 0) / 25))   # illustrative shape only
        pts.append(C.AreaPoint(date=d, sensor=sensor, track=trk, area_km2=round(a, 3), sigma_km2=0.15,
                               confidence="low", note="placeholder"))
    write_json(out / C.BUNDLE_PATHS["reservoir_area"], C.ReservoirArea(
        **PH, method="HH < −18 dB inside lake polygon (fixture)", dam_id=dam, reservoir=cfg["dam"]["name"],
        polygon="vectors/lake_max.geojson", threshold_db=cfg["water"]["hh_db"], points=pts, events=events,
        gaps=[tuple(cfg["event"]["gap"])]))

    a = cfg["anomaly"]
    write_json(out / C.BUNDLE_PATHS["alerts"], C.Alerts(
        **PH, dam_id=dam, rule=C.Rule(z_alert=a["z_alert"], drop_alert=a["drop_alert"], z_warn=a["z_warn"],
                                      drop_warn=a["drop_warn"], seasonal_rate_per_day=a["seasonal_prior_per_day"],
                                      sigma_per_sqrt_day=0.02),
        evaluations=[C.Evaluation(date="2026-06-19", prev="2026-06-17", days=1.5, delta=-0.7, expected=-0.0045,
                                  z=-9.9, level="ALERT", cross_sensor=True,
                                  text=C.Text(everyone="Placeholder alert — real numbers come from 03_anomaly.py.",
                                              experts="Placeholder: z-score rule from docs/03 §5.3."))]))

    hs = np.arange(0.25, 15.01, 0.25)
    rows = [C.HandRow(h=float(h), V_m3=float(2.4e6 * h ** 1.9), area_km2=float(9 * h ** 0.9),
                      cropland_ha=float(600 * h ** 0.9), builtup_ha=float(12 * h ** 1.2), villages=int(h * 1.6),
                      road_km=float(5 * h)) for h in hs]
    write_json(out / C.BUNDLE_PATHS["hand_lut"], C.HandLut(
        **PH, dam_id=dam, corridor="vectors/corridor.geojson", reach="dam→Sidi Salem", hand_file="flood/hand.png",
        hand_encoding=C.Encoding(type="r16", scale=0.01), rows=rows))

    write_json(out / C.BUNDLE_PATHS["anuga_index"], C.AnugaIndex(dam_id=dam, scenarios=[
        C.AnugaScenario(**PH, id=s["id"], volume_m3=s["volume_mm3"] * 1e6, duration_h=s["duration_h"],
                        label=s["label"], computed=False) for s in cfg["anuga"]["scenarios"]]))

    write_json(out / C.BUNDLE_PATHS["impacts"], C.Impacts(**PH, dam_id=dam, scenarios={}))

    write_json(out / C.BUNDLE_PATHS["level_volume"], C.LevelVolume(
        **PH, dam_id=dam, swot=C.Swot(available=False, reason="Not queried yet (07_level_volume.py)"),
        dem_shoreline=[], delta_volume=[],
        reported=[C.Reported(what="Released volume", value_m3=21e6, alt=29e6,
                             source="https://www.lapresse.tn/2026/06/19/panne-au-barrage-de-mellegue-21-millions-de-m%C2%B3-deau-relaches-en-quelques-heures/")]))

    write_json(out / C.BUNDLE_PATHS["sources"], C.Sources(sources=SOURCES), force=True)

    # manifest: fixture layers
    for lid, kind, grd, f, label, date, sensor, extra in [
        ("terrain_height", "terrain", "scene", "terrain/height_scene.png", "Terrain (placeholder)", None, None,
         dict(encoding=dict(type="rg16", scale=0.1, offset=-100))),
        ("terrain_hillshade", "hillshade", "scene", "terrain/hillshade.png", "Hillshade (placeholder)", None, None, {}),
        ("s1_2026-06-17_o88_VV", "radar", "lake_chip", "radar/fixture_S1_17jun.png", "Sentinel-1 · before",
         "2026-06-17", "S1", dict(band="C", pol="VV", track="o88", time_utc="17:20",
                                  encoding=dict(type="db8", min=-25, max=0), mask="radar/fixture_S1_17jun_mask.png")),
        ("nisar_2026-06-19_D80_HH", "radar", "lake_chip", "radar/fixture_NISAR_19jun.png", "NISAR · 19 Jun",
         "2026-06-19", "NISAR", dict(band="L", pol="HH", track="D80", encoding=dict(type="db8", min=-25, max=0),
                                     mask="radar/fixture_NISAR_19jun_mask.png")),
        ("nisar_2026-07-01_D80_HH", "radar", "lake_chip", "radar/fixture_NISAR_01jul.png", "NISAR · 1 Jul",
         "2026-07-01", "NISAR", dict(band="L", pol="HH", track="D80", encoding=dict(type="db8", min=-25, max=0),
                                     mask="radar/fixture_NISAR_01jul_mask.png")),
        ("hand", "hand", "scene", "flood/hand.png", "HAND (placeholder)", None, "model",
         dict(encoding=dict(type="r16", scale=0.01))),
    ]:
        register_layer(out, dict(id=lid, kind=kind, grid=grd, file=f, label=label, date=date, sensor=sensor,
                                 **PH, **extra), product, dam, version)
    print(f"fixture bundle written to {out}")


SOURCES = [C.Source(**s) for s in [
    dict(id="asf-nisar", title="NISAR Data User Guide (ASF DAAC)", url="https://nisar-docs.asf.alaska.edu/", kind="data"),
    dict(id="nisar-worldview", title="NISAR in Worldview / GIBS", url="https://nisar-docs.asf.alaska.edu/worldview/", kind="data"),
    dict(id="nasa-nisar-pol", title="NISAR polarimetry (NASA)", url="https://science.nasa.gov/mission/nisar/polarimetry/", kind="data"),
    dict(id="pc", title="Microsoft Planetary Computer (Sentinel-1 RTC, NASADEM, ESA WorldCover)", url="https://planetarycomputer.microsoft.com/", kind="data"),
    dict(id="hydrocron", title="SWOT Hydrocron API (PO.DAAC)", url="https://podaac.github.io/hydrocron/timeseries", kind="data"),
    dict(id="osm", title="OpenStreetMap contributors (ODbL)", url="https://www.openstreetmap.org/copyright", kind="data"),
    dict(id="hydrorivers", title="HydroRIVERS v1.0 (HydroSHEDS, Lehner & Grill 2013)", url="https://www.hydrosheds.org/products/hydrorivers", kind="data"),
    dict(id="hydrobasins", title="HydroBASINS v1c (HydroSHEDS, Lehner & Grill 2013)", url="https://www.hydrosheds.org/products/hydrobasins", kind="data"),
    dict(id="jrc-gsw", title="JRC Global Surface Water v1.3 1984–2020 (EC JRC/Google, Pekel et al. 2016)", url="https://global-surface-water.appspot.com/", kind="data"),
    dict(id="esa-worldcover", title="ESA WorldCover 10 m 2021 v200 (CC BY 4.0)", url="https://esa-worldcover.org/", kind="data"),
    dict(id="worldpop", title="WorldPop 2020 constrained population, Tunisia 100 m (CC BY 4.0)", url="https://hub.worldpop.org/geodata/summary?id=49920", kind="data"),
    dict(id="geoboundaries", title="geoBoundaries gbOpen (Runfola et al. 2020)", url="https://www.geoboundaries.org/", kind="data"),
    dict(id="gem-15", title="GEM-15 15 m elevation models (Google Research, experimental) — \"This dataset is produced by Google\"", url="https://developers.google.com/earth-engine/datasets/catalog/projects_climate-and-sustainability_assets_gem-15_v1", kind="data"),
    dict(id="lgrip30", title="NASA LGRIP30 v001 irrigated/rainfed cropland, 30 m (LP DAAC)", url="https://doi.org/10.5067/Community/LGRIP/LGRIP30.001", kind="data"),
    dict(id="anuga", title="ANUGA hydrodynamic model", url="https://github.com/GeoscienceAustralia/anuga_core", kind="method"),
    dict(id="bn-gate", title="Gate failure details (Business News, 18 Jun 2026)", url="https://businessnews.com.tn/2026/06/18/la-fuite-spectaculaire-du-barrage-de-mellegue-na-cause-aucun-degat/1406440/", kind="press"),
    dict(id="lp-21mm3", title="21 Mm³ released in a few hours (La Presse, 19 Jun 2026)", url="https://www.lapresse.tn/2026/06/19/panne-au-barrage-de-mellegue-21-millions-de-m%C2%B3-deau-relaches-en-quelques-heures/", kind="press"),
    dict(id="lp-farmland", title="Farmland damaged (La Presse, 18 Jun 2026)", url="https://www.lapresse.tn/2026/06/18/tunisie-des-terres-agricoles-endommagees-apres-la-montee-des-eaux-a-mellegue/", kind="press"),
    dict(id="aa-sidisalem", title="Arrival at Sidi Salem, 80% silted (AllAfrica)", url="https://fr.allafrica.com/stories/202606240126.html", kind="press"),
    dict(id="tn-29mm3", title="What we know, 29 Mm³ (Tunisie Numérique)", url="https://www.tunisienumerique.com/incident-du-barrage-de-mellegue-ce-que-lon-sait-apres-lecoulement-de-29-millions-de-m%C2%B3/", kind="press"),
    dict(id="mg-repair", title="Gate back in service, 16 Jul 2026 (Managers)", url="https://managers.tn/2026/07/16/barrage-de-mellegue-la-vanne-est-de-nouveau-operationnelle-un-mois-apres-lincident-qui-a-libere-21-millions-de-m%C2%B3-deau/", kind="press"),
    dict(id="wd-divers", title="Divers inspect leaks (Webdo, Sep 2026)", url="https://www.webdo.tn/fr/actualite/regions/barrage-de-mellegue-des-plongeurs-mobilises-pour-inspecter-les-infiltrations/404376/", kind="press"),
    dict(id="wd-upper", title="Upper Mellègue dam, 195 Mm³ (Webdo)", url="https://www.webdo.tn/fr/?p=396788", kind="press"),
    dict(id="lp-46pct", title="Dam reserves 46% on 23 Oct 2026 (La Presse)", url="https://www.lapresse.tn/2026/10/24/barrages-tunisiens-les-reserves-atteignent-1075-milliard-de-m³/", kind="press"),
    dict(id="bn-onagri", title="ONAGRI stopped daily bulletins (Business News)", url="https://businessnews.com.tn/2026/06/23/barrages-le-taux-de-remplissage-atteint-60-selon-le-ministere-de-lagriculture/1407255/", kind="press"),
    dict(id="wd-stress", title="Water stress below 400 m³/person (Webdo)", url="https://webdo.tn/en/?p=396510", kind="press"),
    dict(id="spaceapps", title="NASA Space Apps judging & awards", url="https://www.spaceappschallenge.org/resources/judging-awards-guide", kind="challenge"),
]]


# ------------------------------------------------------------------------------------------------ validation
def validate(out: Path) -> int:
    errors = 0
    for name, rel in C.BUNDLE_PATHS.items():
        p = out / rel
        if not p.exists():
            print(f"  MISSING {rel}")
            errors += 1
            continue
        try:
            obj = C.validate_file(name, p)
            ph = getattr(obj, "placeholder", None)
            print(f"  ok  {rel}{'  (placeholder)' if ph else ''}")
        except Exception as e:  # noqa: BLE001
            print(f"  BAD {rel}: {e}")
            errors += 1
    m = load_manifest(out)
    for l in m.get("layers", []):
        for key in ("file", "mask"):
            if l.get(key) and not (out / l[key]).exists():
                print(f"  MISSING layer file {l[key]} ({l['id']})")
                errors += 1
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"bundle size {size / 1e6:.2f} MB · {'OK' if errors == 0 else f'{errors} error(s)'}")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=common.ROOT / "config.yaml")
    ap.add_argument("--fixture", action="store_true")
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--schemas", action="store_true")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    out = common.bundle_dir(cfg)
    if args.schemas or args.fixture:
        for p in C.export_schemas(common.ROOT / "contracts"):
            print("schema", p.relative_to(common.ROOT))
    if args.fixture:
        fixture(cfg, out)
    if args.validate or args.fixture:
        return 1 if validate(out) else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
