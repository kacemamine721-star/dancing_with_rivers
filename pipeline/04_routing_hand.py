#!/usr/bin/env python3
"""04 · Routing + HAND (MODELLED): D8 flow path dam → Medjerda → Sidi Salem, HAND corridor, volume→height LUT.

  python pipeline/04_routing_hand.py [--dem gem15|nasadem] [--no-bundle]

DEM
  gem15   (default) GEM-15 bare-earth DTM (Google Research, experimental, CC-BY 4.0), 15 m, block-mean 2×2 → 30 m on
          the analysis grid; cells outside its bbox come from NASADEM (the flow path and corridor are checked to lie
          inside the GEM-15 bbox).
  nasadem work/dem_32632_30m.tif

Method (docs/03 §5.5–5.6, docs/07 §5)
  1. Channel burn: the HydroRIVERS main stem (reach nearest the dam → NEXT_DOWN chain) is rasterised on the 30 m grid
     and lowered by BURN_M (2 m). Reason: reservoir surfaces and the Medjerda plain are flat in a 30 m DEM.
  2. Depression filling by priority-flood + ε (Barnes 2014; pysheds fill + resolve_flats left pits on the flat plain),
     then pysheds D8 flow direction → accumulation.
  3. Outlet = max-accumulation cell within dam.outlet_snap_m of the dam point, on the downstream side of the OSM dam
     line; D8 walk until the Sidi Salem reservoir polygon (OSM r2307563).
  4. HAND relative to the MAIN STEM (drainage mask = flow-path cells): height of each cell above the path cell it drains
     to. (docs/07 uses all streams > 5 km²; for a dam release that would "flood" every tributary channel, so the main
     stem is the reference. The all-streams variant is computed and reported for comparison.)
  5. Corridor = ≤ hand.corridor_km from the path (flat caps), minus the Mellègue and Sidi Salem reservoir polygons.
  6. LUT: V(h) = Σ_{HAND<h} (h − HAND)·cell and exposure (WorldCover, WorldPop, OSM) for h = 0.25 … 15 m.

Outputs
  work/routing/<dem>/…            dem30, burn, fdir, acc, hand tifs, path, outlet.json, tests.json, report.md
  <bundle>/vectors/flowpath.geojson, streams.geojson, corridor.geojson
  <bundle>/flood/hand.png (web scene grid, uint16 cm, 65535 = no data), flood/hand_lut.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first)
from common import contracts as C  # noqa: E402

import numpy as np  # noqa: E402

BURN_M = 2.0
SIDI_SALEM_OSM = "r2307563"
MELLEGUE_RES_OSM = ("w177959779", "w178135177")
DAM_LINE_OSM = "w177960794"
DIRMAP = (64, 128, 1, 2, 4, 8, 16, 32)                       # N NE E SE S SW W NW (pysheds default)
OFFS = {64: (-1, 0), 128: (-1, 1), 1: (0, 1), 2: (1, 1), 4: (1, 0), 8: (1, -1), 16: (0, -1), 32: (-1, -1)}
DEM_LABEL = {"gem15": "GEM-15 (experimental) bare-earth DTM 15 m block-averaged to 30 m",
             "nasadem": "NASADEM 30 m"}
DEM_SOURCE = {"gem15": "GEM-15 (experimental) DTM, Google Research, CC-BY 4.0 (gaps: NASADEM)",
              "nasadem": "NASADEM (NASA JPL) via Microsoft Planetary Computer"}


def bundle_mod():
    spec = importlib.util.spec_from_file_location("bundle08", Path(__file__).with_name("08_bundle.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------------------------------------ inputs
def load_dem(which: str, work: Path):
    """Return (z30, transform, gem_bbox or None). gem15 is block-averaged 2×2 and pasted into the NASADEM grid."""
    import rasterio
    with rasterio.open(work / "dem_32632_30m.tif") as s:
        z, T, crs = s.read(1).astype(np.float64), s.transform, s.crs
    if which == "nasadem":
        return z, T, crs, None
    with rasterio.open(work / "gem15_dtm_15m.tif") as s:
        g, GT, gb = s.read(1).astype(np.float64), s.transform, s.bounds
    assert abs(GT.a - 15) < 1e-6 and g.shape[0] % 2 == 0 and g.shape[1] % 2 == 0
    g30 = g.reshape(g.shape[0] // 2, 2, g.shape[1] // 2, 2).mean(axis=(1, 3))
    c0, r0 = (GT.c - T.c) / 30.0, (T.f - GT.f) / 30.0
    assert abs(c0 - round(c0)) < 1e-6 and abs(r0 - round(r0)) < 1e-6, "GEM-15 grid not aligned with the 30 m grid"
    c0, r0 = int(round(c0)), int(round(r0))
    z = z.copy()
    z[r0:r0 + g30.shape[0], c0:c0 + g30.shape[1]] = g30
    return z, T, crs, (gb.left, gb.bottom, gb.right, gb.top)


def write_tif(path: Path, arr, T, crs, nodata=None, dtype=None):
    import rasterio
    dtype = dtype or arr.dtype
    kw = dict(driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype=dtype, crs=crs, transform=T,
              compress="deflate", tiled=True)
    if nodata is not None:
        kw["nodata"] = nodata
    with rasterio.open(path, "w", **kw) as d:
        d.write(arr.astype(dtype), 1)


def rc_of(T, x, y):
    return int((T.f - y) // 30), int((x - T.c) // 30)


def xy_of(T, r, c):
    return T.c + (np.asarray(c) + 0.5) * T.a, T.f + (np.asarray(r) + 0.5) * T.e


def main_stem(hr, dam_pt, grid_box):
    """HydroRIVERS chain from the reach nearest the dam (UPLAND ≥ 1000 km²) downstream, clipped to the grid."""
    big = hr[hr.UPLAND_SKM >= 1000]
    d = big.distance(dam_pt)
    rid = int(big.loc[d.idxmin(), "HYRIV_ID"])
    idx = hr.set_index("HYRIV_ID")
    chain = []
    while rid in idx.index and rid != 0:
        chain.append(rid)
        rid = int(idx.loc[rid, "NEXT_DOWN"])
    c = idx.loc[chain]
    c = c[c.geometry.intersects(grid_box)]
    return c, float(d.min())


# ------------------------------------------------------------------------------------------------ routing
def priority_flood_eps(z, eps=1e-5):
    """Barnes et al. (2014) priority-flood + ε: every cell gets a strictly descending D8 route to the grid edge."""
    import heapq

    import numba

    @numba.njit(cache=True)
    def _pf(z, eps):
        H, W = z.shape
        out = z.copy()
        done = np.zeros((H, W), np.bool_)
        heap = [(z[0, 0], 0, 0)]
        done[0, 0] = True
        for r in range(H):
            for c in range(W):
                if (r == 0 or c == 0 or r == H - 1 or c == W - 1) and not done[r, c]:
                    heapq.heappush(heap, (z[r, c], r, c))
                    done[r, c] = True
        while len(heap) > 0:
            e, r, c = heapq.heappop(heap)
            for dr in range(-1, 2):
                for dc in range(-1, 2):
                    rr, cc = r + dr, c + dc
                    if rr < 0 or cc < 0 or rr >= H or cc >= W or done[rr, cc]:
                        continue
                    done[rr, cc] = True
                    if out[rr, cc] <= e:
                        out[rr, cc] = e + eps
                    heapq.heappush(heap, (out[rr, cc], rr, cc))
        return out

    return _pf(np.ascontiguousarray(z, dtype=np.float64), eps)


def condition(zb, T, crs):
    """Depression filling by priority-flood + ε (pysheds fill_depressions + resolve_flats left unresolved pits on the
    flat Medjerda plain: flats wider than its iteration limit), then pysheds D8 flow direction and accumulation."""
    from pysheds.grid import Grid
    from pysheds.sview import Raster, ViewFinder
    vf = ViewFinder(affine=T, shape=zb.shape, nodata=np.float64(-9999), crs=crs)
    grid = Grid(viewfinder=vf)
    t = time.time()
    d = Raster(priority_flood_eps(zb), viewfinder=vf)
    log(f"  priority-flood + ε in {time.time() - t:.0f} s; filled cells {(np.asarray(d) > zb + 1e-9).mean() * 100:.1f}%, "
        f"max fill {(np.asarray(d) - zb).max():.1f} m")
    t = time.time()
    fdir = grid.flowdir(d, dirmap=DIRMAP)
    acc = grid.accumulation(fdir, dirmap=DIRMAP)
    log(f"  flowdir + accumulation in {time.time() - t:.0f} s")
    return grid, d, fdir, acc


def trace(fdir, start, stop_mask, max_steps=200000):
    r, c = start
    H, W = fdir.shape
    path = [(r, c)]
    seen = {(r, c)}
    why = "max_steps"
    for _ in range(max_steps):
        if stop_mask[r, c]:
            why = "target"
            break
        d = int(fdir[r, c])
        if d not in OFFS:
            why = f"no direction (fdir={d})"
            break
        r, c = r + OFFS[d][0], c + OFFS[d][1]
        if not (0 <= r < H and 0 <= c < W):
            why = "left grid"
            break
        if (r, c) in seen:
            why = "loop"
            break
        seen.add((r, c))
        path.append((r, c))
    return np.array(path), why


def stream_lines(mask, fdir, T, simplify_m=30.0):
    """Vectorise stream cells: one segment per cell → its D8 neighbour, merged and simplified."""
    from shapely import line_merge, linestrings, unary_union
    rr, cc = np.nonzero(mask)
    d = np.asarray(fdir)[rr, cc]
    dr = np.zeros(len(rr), int)
    dc = np.zeros(len(rr), int)
    for k, (a, b) in OFFS.items():
        dr[d == k], dc[d == k] = a, b
    r2, c2 = rr + dr, cc + dc
    ok = ((dr != 0) | (dc != 0)) & (r2 >= 0) & (r2 < mask.shape[0]) & (c2 >= 0) & (c2 < mask.shape[1])
    rr, cc, r2, c2 = rr[ok], cc[ok], r2[ok], c2[ok]
    x1, y1 = xy_of(T, rr, cc)
    x2, y2 = xy_of(T, r2, c2)
    segs = linestrings(np.stack([np.stack([x1, y1], 1), np.stack([x2, y2], 1)], 1))
    merged = line_merge(unary_union(segs))
    geoms = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    return [g.simplify(simplify_m) for g in geoms if g.length > 150]


# ------------------------------------------------------------------------------------------------ exposure rasters
def road_length_raster(roads, T, shape, bbox):
    import shapely
    g = roads.cx[bbox[0]:bbox[2], bbox[1]:bbox[3]].geometry.explode(index_parts=False)
    g = shapely.segmentize(g.values, 10.0)
    xy, idx = shapely.get_coordinates(g, return_index=True)
    same = idx[1:] == idx[:-1]
    a, b = xy[:-1][same], xy[1:][same]
    ln = np.hypot(*(b - a).T)
    mid = (a + b) / 2
    r = ((T.f - mid[:, 1]) // 30).astype(int)
    c = ((mid[:, 0] - T.c) // 30).astype(int)
    ok = (r >= 0) & (r < shape[0]) & (c >= 0) & (c < shape[1])
    out = np.zeros(shape, np.float64)
    np.add.at(out, (r[ok], c[ok]), ln[ok])
    return out


def point_count_raster(pts, T, shape):
    x, y = pts.geometry.x.values, pts.geometry.y.values
    r = ((T.f - y) // 30).astype(int)
    c = ((x - T.c) // 30).astype(int)
    ok = (r >= 0) & (r < shape[0]) & (c >= 0) & (c < shape[1])
    out = np.zeros(shape, np.int32)
    np.add.at(out, (r[ok], c[ok]), 1)
    return out


def village_name(row):
    for k in ("name_fr", "name_en", "name"):
        v = row.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return str(row.get("osm_id"))


def village_min(field, T, villages, radius_m=200.0, valid=None, fn=np.nanmin):
    """fn of `field` over valid cells within radius of each village point (nan if none)."""
    k = int(np.ceil(radius_m / 30)) + 1
    out = []
    H, W = field.shape
    for p in villages.geometry:
        r0, c0 = rc_of(T, p.x, p.y)
        rs, cs = np.mgrid[max(r0 - k, 0):min(r0 + k + 1, H), max(c0 - k, 0):min(c0 + k + 1, W)]
        if rs.size == 0:
            out.append(np.nan)
            continue
        x, y = xy_of(T, rs, cs)
        m = np.hypot(x - p.x, y - p.y) <= radius_m
        v = field[rs, cs][m]
        if valid is not None:
            v = v[valid[rs, cs][m]]
        v = v[np.isfinite(v)]
        out.append(float(fn(v)) if v.size else np.nan)
    return np.array(out)


def exposure_at(h, hand, corr, ex, vmin):
    wet = corr & (hand < h)
    return dict(h=float(h), V_m3=float(((h - hand[wet]) * 900.0).sum()), area_km2=float(wet.sum() * 900 / 1e6),
                cropland_ha=float((wet & ex["crop"]).sum() * 0.09), builtup_ha=float((wet & ex["built"]).sum() * 0.09),
                villages=int(np.sum(vmin < h)), road_km=float(ex["road"][wet].sum() / 1000),
                population=float(ex["pop"][wet].sum()), buildings=int(ex["bld"][wet].sum()))


def h_for_volume(rows, V):
    hs = np.array([r["h"] for r in rows])
    vs = np.array([r["V_m3"] for r in rows])
    if V > vs[-1]:
        return None
    return float(np.interp(V, np.r_[0, vs], np.r_[0, hs]))


def geojson_utm(features):
    return {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32632"}},
            "features": features}


def rnd_coords(geom, nd=1):
    from shapely.geometry import mapping
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(float(v), nd) for v in c]
    m = mapping(geom)
    return {"type": m["type"], "coordinates": r(m["coordinates"])}


# ------------------------------------------------------------------------------------------------ main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=common.ROOT / "config.yaml")
    ap.add_argument("--dem", default="gem15", choices=["gem15", "nasadem"])
    ap.add_argument("--no-bundle", action="store_true", help="compute + test only (comparison run)")
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    out = common.bundle_dir(cfg)
    work = common.ROOT / "work"
    wr = work / "routing" / args.dem
    wr.mkdir(parents=True, exist_ok=True)

    import geopandas as gpd
    import rasterio
    from pyproj import Transformer
    from rasterio import features
    from shapely.geometry import LineString, Point, box
    from shapely.ops import unary_union

    tests: dict = {"dem": args.dem}
    log(f"DEM: {DEM_LABEL[args.dem]}")
    z, T, crs, gem_bbox = load_dem(args.dem, work)
    H, W = z.shape
    grid_box = box(T.c, T.f - H * 30, T.c + W * 30, T.f)
    tr = Transformer.from_crs(4326, 32632, always_xy=True)
    dam_xy = tr.transform(*cfg["dam"]["lonlat"])
    dam_pt = Point(dam_xy)

    ctx = work / "context"
    hr = gpd.read_file(ctx / "hydrorivers.gpkg")
    wb = gpd.read_file(ctx / "waterbodies.gpkg")
    dams = gpd.read_file(ctx / "dams.gpkg")
    ww = gpd.read_file(ctx / "waterways.gpkg")
    villages = gpd.read_file(ctx / "villages.gpkg")
    villages = villages[villages.place.isin(["village", "town", "hamlet"])].reset_index(drop=True)
    sidi = wb[wb.osm_id == SIDI_SALEM_OSM].geometry.iloc[0]
    mel_res = unary_union(list(wb[wb.osm_id.isin(MELLEGUE_RES_OSM)].geometry))
    dam_line = dams[dams.osm_id == DAM_LINE_OSM].geometry.iloc[0]

    # ---- 1. channel burn
    stem, snap_d = main_stem(hr, dam_pt, grid_box)
    stem_line = unary_union(list(stem.geometry))
    burn = features.rasterize([(stem_line, 1)], out_shape=(H, W), transform=T, all_touched=False, dtype="uint8") > 0
    zb = z - BURN_M * burn
    log(f"main stem: {len(stem)} HydroRIVERS reaches, {stem.length.sum() / 1000:.1f} km in grid, "
        f"{snap_d:.0f} m from the dam point; burn −{BURN_M:g} m on {burn.sum()} cells")
    write_tif(wr / "dem30.tif", z, T, crs, dtype="float32")
    write_tif(wr / "burn_30m.tif", burn.astype(np.uint8), T, crs, dtype="uint8")

    # ---- 2. conditioning + D8
    grid, dcond, fdir, acc = condition(zb, T, crs)
    fd = np.asarray(fdir)
    ac = np.asarray(acc)
    zc = np.asarray(dcond)

    # ---- 3. outlet snap (downstream side of the dam line) and trace
    rr, cc = np.mgrid[0:H, 0:W]
    r0, c0 = rc_of(T, *dam_xy)
    k = int(cfg["dam"]["outlet_snap_m"] // 30) + 2
    sl = (slice(r0 - k, r0 + k + 1), slice(c0 - k, c0 + k + 1))
    x, y = xy_of(T, rr[sl], cc[sl])
    (ax, ay), (bx, by) = dam_line.coords[0], dam_line.coords[-1]
    side = lambda px, py: np.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax))          # noqa: E731
    res_side = side(mel_res.centroid.x, mel_res.centroid.y)
    res_m = features.rasterize([(mel_res.buffer(30), 1)], out_shape=(H, W), transform=T, dtype="uint8")[sl] > 0
    cand = (np.hypot(x - dam_xy[0], y - dam_xy[1]) <= cfg["dam"]["outlet_snap_m"]) & (side(x, y) == -res_side) & ~res_m
    a = np.where(cand, ac[sl], -1)
    i = np.unravel_index(a.argmax(), a.shape)
    start = (int(rr[sl][i]), int(cc[sl][i]))
    ox, oy = (float(v) for v in xy_of(T, *start))
    log(f"outlet: cell {start} at ({ox:.0f}, {oy:.0f}), {np.hypot(ox - dam_xy[0], oy - dam_xy[1]):.0f} m from the dam "
        f"point, accumulation {ac[start] * 900 / 1e6:.1f} km² (in-grid only), z {z[start]:.1f} m")
    sidi_m = features.rasterize([(sidi, 1)], out_shape=(H, W), transform=T, dtype="uint8") > 0
    path, why = trace(fd, start, sidi_m)
    log(f"trace: {len(path)} cells, stopped: {why}")
    px, py = xy_of(T, path[:, 0], path[:, 1])
    raw_line = LineString(np.c_[px, py])
    line = raw_line.simplify(30.0)
    vx = np.array(line.coords)
    vdist = np.r_[0, np.cumsum(np.hypot(*np.diff(vx, axis=0).T))] / 1000
    length_km = float(vdist[-1])
    cell_dist = np.array([line.project(Point(p)) for p in np.c_[px, py]]) / 1000
    np.save(wr / "path_cells.npy", path)

    # reach breaks
    ups = stem.UPLAND_SKM.values
    j = int(np.argmax(ups[1:] / ups[:-1] > 1.15)) + 1
    g = stem.geometry.iloc[j]
    conf_pt = Point(list(g.geoms)[0].coords[0] if hasattr(g, "geoms") else g.coords[0])
    conf_km = line.project(conf_pt) / 1000
    medj = unary_union(list(ww[ww.name_fr.fillna("").str.contains("Medjerda")].geometry))
    d_medj = np.array([medj.distance(Point(p)) for p in vx])
    first_medj_km = float(vdist[np.argmax(d_medj < 100)]) if (d_medj < 100).any() else None
    breaks = [dict(name="Medjerda confluence", dist_km=round(conf_km, 2))]
    town_off = {}
    for nm in ("Jendouba", "Bou Salem"):
        p = villages[villages.name_fr == nm].geometry.iloc[0]
        breaks.append(dict(name=nm, dist_km=round(line.project(p) / 1000, 2)))
        town_off[nm] = round(line.distance(p))
    breaks.append(dict(name="Sidi Salem entry", dist_km=round(length_km, 2)))
    breaks.sort(key=lambda b: b["dist_km"])
    log(f"flow path {length_km:.1f} km (D8 staircase {raw_line.length / 1000:.1f} km), {len(vx)} vertices; breaks {breaks}; "
        f"town offsets from path {town_off} m; first vertex < 100 m from OSM Medjerda at km {first_medj_km}; "
        f"confluence (HydroRIVERS upland jump {ups[j - 1]:.0f} → {ups[j]:.0f} km²) {line.distance(conf_pt):.0f} m off path")

    # ---- D1 / D2
    ends_in_sidi = why == "target"
    zr = z[path[:, 0], path[:, 1]]
    zcp = zc[path[:, 0], path[:, 1]]
    up_raw = np.diff(zr)
    up_c = np.diff(zcp)
    kmax = int(up_raw.argmax())
    runmin = np.minimum.accumulate(zr)
    dam_like = zr - runmin                                   # how far a cell stands above the lowest upstream cell
    kd = int(dam_like.argmax())
    tests["D1"] = dict(reaches_medjerda=bool((d_medj < 100).any()), reaches_sidi_salem=bool(ends_in_sidi),
                       stop_reason=why, conditioned_max_uphill_m=float(max(up_c.max(), 0)),
                       raw_max_uphill_step_m=float(up_raw.max()), raw_max_uphill_at_km=float(cell_dist[kmax]),
                       raw_uphill_steps_gt1m=int((up_raw > 1).sum()), raw_n_steps=int(len(up_raw)),
                       raw_max_rise_above_running_min_m=float(dam_like[kd]), raw_max_rise_at_km=float(cell_dist[kd]),
                       z_start_m=float(zr[0]), z_end_m=float(zr[-1]),
                       passed=bool(ends_in_sidi and (d_medj < 100).any() and up_c.max() <= 1e-6))
    osm_riv = unary_union(list(ww[ww.waterway == "river"].geometry))
    samp = [raw_line.interpolate(s) for s in np.arange(0, raw_line.length, 30.0)]
    d_hr = np.array([stem_line.distance(p) for p in samp])
    d_osm = np.array([osm_riv.distance(p) for p in samp])
    d_min = np.minimum(d_hr, d_osm)
    tests["D2"] = dict(n=len(samp), pct_within_300m_hydrorivers=float((d_hr <= 300).mean() * 100),
                       pct_within_300m_osm_river=float((d_osm <= 300).mean() * 100),
                       pct_within_300m_either=float((d_min <= 300).mean() * 100),
                       median_m_osm=float(np.median(d_osm)), p95_m_osm=float(np.percentile(d_osm, 95)),
                       max_m_osm=float(d_osm.max()), note="HydroRIVERS is the burn line (not independent); OSM river "
                       "lines are the independent reference", passed=bool((d_osm <= 300).mean() >= 0.9))
    log("D1", json.dumps(tests["D1"]))
    log("D2", json.dumps(tests["D2"]))
    inside_gem = None
    if gem_bbox:
        b = raw_line.bounds
        inside_gem = bool(b[0] > gem_bbox[0] and b[1] > gem_bbox[1] and b[2] < gem_bbox[2] and b[3] < gem_bbox[3])
        tests["path_inside_gem15_bbox"] = inside_gem

    # ---- 4. HAND (main stem) + all-streams variant
    from pysheds.sview import Raster, ViewFinder
    t = time.time()
    pmask = np.zeros((H, W), bool)
    pmask[path[:, 0], path[:, 1]] = True
    stream_thr = cfg["hand"]["stream_area_km2"] * 1e6 / 900
    smask = ac > stream_thr
    vfb = ViewFinder(affine=T, shape=(H, W), nodata=False, crs=crs)
    zref = zc + BURN_M * burn                                 # filled DEM with the burn removed: no artificial trench storage

    def hand_of(mask):
        idx = np.asarray(grid.compute_hand(fdir, dcond, Raster(mask, viewfinder=vfb), dirmap=DIRMAP, return_index=True))
        ok = idx >= 0
        hnd = np.full((H, W), np.nan)
        hnd[ok] = np.maximum(zref[ok] - zref.ravel()[idx[ok]], 0)
        return hnd, idx

    hand, idx_r = hand_of(pmask)
    hand_s, _ = hand_of(smask)
    log(f"HAND ×2 in {time.time() - t:.0f} s; cells draining to the path {np.isfinite(hand).mean() * 100:.0f}% of grid")

    # ---- 5. corridor
    corr_poly = line.buffer(cfg["hand"]["corridor_km"] * 1000, cap_style="flat").difference(mel_res.buffer(30)) \
        .difference(sidi)
    corr_poly = corr_poly.intersection(grid_box)
    if gem_bbox:
        frac_in = corr_poly.intersection(box(*gem_bbox)).area / corr_poly.area
        tests["corridor_fraction_inside_gem15_bbox"] = float(frac_in)
        log(f"corridor inside GEM-15 bbox: {frac_in * 100:.2f}% (path inside: {inside_gem})")
    corr_geom = features.rasterize([(corr_poly, 1)], out_shape=(H, W), transform=T, dtype="uint8") > 0
    corr = corr_geom & np.isfinite(hand)
    hand_c = np.where(corr, hand, np.nan)
    write_tif(wr / "hand_30m.tif", hand_c.astype(np.float32), T, crs, nodata=np.nan, dtype="float32")
    write_tif(wr / "acc_30m.tif", ac.astype(np.float32), T, crs, dtype="float32")
    write_tif(wr / "fdir_30m.tif", fd.astype(np.int16), T, crs, dtype="int16")
    reach1 = np.zeros((H, W), bool)                           # cells draining to the path upstream of the confluence
    k_conf = int(np.argmin(np.abs(cell_dist - conf_km)))
    order = np.full(H * W, -1, np.int64)
    order[path[:, 0] * W + path[:, 1]] = np.arange(len(path))
    drain_k = np.where(idx_r >= 0, order[np.clip(idx_r, 0, H * W - 1)], -1)
    reach1 = corr & (drain_k >= 0) & (drain_k < k_conf)
    write_tif(wr / "reach1_30m.tif", reach1.astype(np.uint8), T, crs, dtype="uint8")
    write_tif(wr / "drain_k_30m.tif", drain_k.astype(np.int32), T, crs, nodata=-1, dtype="int32")
    log(f"corridor {corr.sum() * 900 / 1e6:.0f} km² with HAND ({corr_geom.sum() * 900 / 1e6:.0f} km² geometric); "
        f"Reach 1 part {reach1.sum() * 900 / 1e6:.0f} km²")

    # ---- 6. exposure + LUT
    with rasterio.open(work / "worldcover_30m.tif") as s:
        wc = s.read(1)
    with rasterio.open(work / "pop_30m.tif") as s:
        pop = s.read(1).astype(np.float64)
    pop[pop < 0] = 0
    roads = gpd.read_file(ctx / "roads.gpkg")
    bld = gpd.read_file(ctx / "buildings.gpkg")
    ex = dict(crop=wc == 40, built=wc == 50, pop=pop, bld=point_count_raster(bld, T, (H, W)),
              road=road_length_raster(roads, T, (H, W), corr_poly.bounds))
    vmin = village_min(hand, T, villages, 200.0, valid=corr)
    hs = np.arange(cfg["hand"]["h_step_m"], cfg["hand"]["h_max_m"] + 1e-9, cfg["hand"]["h_step_m"])
    rows = [exposure_at(h, hand, corr, ex, vmin) for h in hs]
    rows1 = [exposure_at(h, hand, reach1, ex, np.full(len(villages), np.inf)) for h in hs]
    hs_alt = np.where(corr_geom & np.isfinite(hand_s), hand_s, np.nan)
    rows_alt = [exposure_at(h, hs_alt, np.isfinite(hs_alt), ex, np.full(len(villages), np.inf)) for h in hs]

    keys = ("V_m3", "area_km2", "cropland_ha", "builtup_ha", "villages", "road_km", "population", "buildings")
    mono = {k: bool(all(b[k] >= a[k] for a, b in zip(rows, rows[1:]))) for k in keys}
    strict = bool(all(b["V_m3"] > a["V_m3"] and b["area_km2"] >= a["area_km2"] for a, b in zip(rows, rows[1:])))
    tests["D3"] = dict(monotonic=mono, V_strictly_increasing=strict, V_min_m3=rows[0]["V_m3"], V_max_m3=rows[-1]["V_m3"],
                       passed=bool(all(mono.values()) and strict))
    tests["F2"] = dict(counts_monotonic_with_volume=bool(mono["villages"] and mono["buildings"] and mono["population"]),
                       passed=bool(mono["villages"] and mono["buildings"] and mono["population"]))
    log("D3", json.dumps(tests["D3"]))

    d4 = {}
    for V in (21e6, 50e6, 195e6):
        h = h_for_volume(rows, V)
        e = dict(h_m=None)
        if h is not None:
            e = exposure_at(h, hand, corr, ex, vmin)
            wet = corr & (hand < h)
            e["h_m"] = e.pop("h")
            e["villages_list"] = [village_name(villages.iloc[i]) for i in np.nonzero(vmin < h)[0]]
            e["wet_within_1km_of_path_pct"] = float(
                (wet & (features.rasterize([(line.buffer(1000), 1)], out_shape=(H, W), transform=T, dtype="uint8") > 0)
                 ).sum() / max(wet.sum(), 1) * 100)
            e["mean_depth_m"] = float(e["V_m3"] / (e["area_km2"] * 1e6)) if e["area_km2"] else 0.0
            e["F1_crop_plus_built_le_wet"] = bool(e["cropland_ha"] + e["builtup_ha"] <= e["area_km2"] * 100 + 1e-6)
        h1 = h_for_volume(rows1, V)
        ha = h_for_volume(rows_alt, V)
        e["h_reach1_only_m"] = h1
        e["h_all_streams_variant_m"] = ha
        if ha is not None:
            e["area_all_streams_variant_km2"] = exposure_at(ha, hs_alt, np.isfinite(hs_alt), ex,
                                                            np.full(len(villages), np.inf))["area_km2"]
        d4[f"{V / 1e6:g}"] = e
        log(f"D4 V={V / 1e6:g} Mm³:", json.dumps({k: (round(v, 2) if isinstance(v, float) else v) for k, v in e.items()},
                                                 ensure_ascii=False))
    tests["D4"] = d4
    (wr / "lut_reach1.json").write_text(json.dumps(rows1), "utf-8")

    # ---- streams
    lines = stream_lines(smask & corr_geom, fd, T)
    log(f"streams: {len(lines)} lines, {sum(l.length for l in lines) / 1000:.0f} km")

    (wr / "outlet.json").write_text(json.dumps(dict(
        dem=args.dem, outlet_xy=[ox, oy], outlet_rc=list(start), dam_xy=list(dam_xy), length_km=length_km,
        confluence_km=conf_km, confluence_xy=[conf_pt.x, conf_pt.y], breaks=breaks, burn_m=BURN_M,
        path_xy=[[round(float(a), 1), round(float(b), 1)] for a, b in vx], vertex_dist_km=[round(float(v), 3) for v in vdist]),
        indent=1), "utf-8")
    (wr / "corridor.geojson").write_text(json.dumps(geojson_utm([dict(type="Feature", properties={}, geometry=rnd_coords(corr_poly, 0))])), "utf-8")
    (wr / "tests.json").write_text(json.dumps(tests, indent=1, ensure_ascii=False), "utf-8")

    if args.no_bundle:
        log("--no-bundle: bundle untouched")
        return 0

    # ---- bundle
    b = bundle_mod()
    dem_txt = DEM_LABEL[args.dem]
    src = f"{DEM_SOURCE[args.dem]}; HydroRIVERS v1.0; OpenStreetMap; pysheds 0.5"
    unc = ("30 m terrain; no surveyed channel geometry; the channel is burned along HydroRIVERS (≈ 500 m source "
           "resolution), so the path is a routing line, not a surveyed thalweg")
    (out / "vectors").mkdir(parents=True, exist_ok=True)
    fp = geojson_utm([dict(type="Feature", properties=dict(
        name="Flow path: Mellègue dam → Medjerda → Sidi Salem reservoir", length_km=round(length_km, 2),
        reach_breaks=breaks, vertex_dist_km=[round(float(v), 2) for v in vdist], badge="MODELLED", dem=dem_txt,
        method=f"D8 steepest descent on {dem_txt}, HydroRIVERS main stem burned −{BURN_M:g} m, depressions filled (priority-flood + ε)"),
        geometry=rnd_coords(line))])
    (out / "vectors/flowpath.geojson").write_text(json.dumps(fp, ensure_ascii=False), "utf-8")
    st = geojson_utm([dict(type="Feature", properties=dict(length_km=round(l.length / 1000, 2)), geometry=rnd_coords(l, 0))
                      for l in lines])
    (out / "vectors/streams.geojson").write_text(json.dumps(st), "utf-8")
    (out / "vectors/corridor.geojson").write_text(json.dumps(geojson_utm([dict(
        type="Feature", properties=dict(name="HAND corridor", width_km=cfg["hand"]["corridor_km"], badge="MODELLED"),
        geometry=rnd_coords(corr_poly.simplify(30), 0))])), "utf-8")

    # hand.png on the web scene grid
    from PIL import Image
    from rasterio.transform import from_bounds
    from rasterio.warp import Resampling, reproject
    gj = json.loads((out / C.BUNDLE_PATHS["grid"]).read_text("utf-8"))
    w, h = gj["size_px"]
    dst = np.full((h, w), np.nan, np.float32)
    reproject(hand_c.astype(np.float32), dst, src_transform=T, src_crs=crs, src_nodata=np.nan,
              dst_transform=from_bounds(*gj["bounds_m"], w, h), dst_crs=crs, dst_nodata=np.nan,
              resampling=Resampling.average)
    enc = np.where(np.isfinite(dst), np.clip(np.round(dst * 100), 0, 65534), 65535).astype(np.uint16)
    (out / "flood").mkdir(parents=True, exist_ok=True)
    Image.fromarray(enc).save(out / "flood/hand.png", optimize=True)

    method = (f"DEM: {dem_txt}. HAND = height above the main-stem flow-path cell each cell drains to (pysheds D8, "
              f"HydroRIVERS channel burned −{BURN_M:g} m). Corridor ≤ {cfg['hand']['corridor_km']} km from the path, "
              f"dam → Sidi Salem ({length_km:.0f} km; Reach 1 dam → Medjerda confluence {conf_km:.0f} km), reservoirs "
              "excluded. V(h) = Σ(h − HAND)·900 m² over HAND < h. Exposure: ESA WorldCover 2021 (cropland 40, built-up "
              "50), WorldPop 2020 constrained (population), OSM (roads all classes incl. tracks, building centroids, "
              "place=village|town|hamlet within 200 m of wet cells).")
    uncert = ("Static 'bathtub': the whole volume is spread at one height along the entire valley at once; it ignores "
              "timing, attenuation and channel capacity, so it underestimates depth near the dam during the peak and "
              "overstates simultaneous extent downstream. HAND is ≈ 0 inside depression-filled channel reaches "
              f"({rows[0]['area_km2']:.0f} km² are already 'wet' at h = {rows[0]['h']:g} m): storage below the fill level "
              "is not counted, so small volumes map to a wide, shallow footprint. 30 m terrain with no channel bathymetry (±5–10 m vertical "
              "in places); OSM buildings and roads are incomplete; WorldPop is itself a model. Exposure screening "
              "only, not a forecast.")
    lut = C.HandLut(badge="MODELLED", source=src + "; ESA WorldCover 2021; WorldPop 2020", method=method,
                    uncertainty=uncert, placeholder=False, dam_id=cfg["dam"]["id"], corridor="vectors/corridor.geojson",
                    reach="dam→Sidi Salem", hand_file="flood/hand.png", hand_encoding=C.Encoding(type="r16", scale=0.01),
                    rows=[C.HandRow(h=round(r["h"], 2), V_m3=round(r["V_m3"]), area_km2=round(r["area_km2"], 3),
                                    cropland_ha=round(r["cropland_ha"], 1), builtup_ha=round(r["builtup_ha"], 1),
                                    villages=r["villages"], road_km=round(r["road_km"], 2),
                                    population=round(r["population"]), buildings=r["buildings"]) for r in rows])
    b.write_json(out / C.BUNDLE_PATHS["hand_lut"], lut, force=True)

    ids = (cfg["brand"]["product"], cfg["dam"]["id"], cfg["bundle"]["version"])
    meta = dict(badge="MODELLED", source=src, uncertainty=unc, placeholder=False, sensor="model")
    b.register_layer(out, dict(id="flowpath", kind="vector", grid="none", file="vectors/flowpath.geojson",
                               label="Flow path: dam → Sidi Salem", method=fp["features"][0]["properties"]["method"]
                               + f"; {length_km:.0f} km, simplified 30 m", **meta), *ids)
    b.register_layer(out, dict(id="streams", kind="vector", grid="none", file="vectors/streams.geojson",
                               label="Stream network (corridor)",
                               method=f"D8 accumulation > {cfg['hand']['stream_area_km2']} km² (in-grid area only) on "
                                      f"{dem_txt}, inside the HAND corridor", **meta), *ids)
    b.register_layer(out, dict(id="corridor", kind="vector", grid="none", file="vectors/corridor.geojson",
                               label="HAND corridor", method=f"≤ {cfg['hand']['corridor_km']} km from the flow path, "
                               f"reservoirs excluded ({dem_txt})", **meta), *ids)
    b.register_layer(out, dict(id="hand", kind="hand", grid="scene", file="flood/hand.png",
                               label="Height above the river (HAND)", method=method + " Web grid: area-averaged from "
                               "30 m; uint16 = HAND in cm, 65535 = outside the corridor.",
                               encoding=dict(type="r16", scale=0.01),
                               **{**meta, "uncertainty": uncert}), *ids)
    for f in ("vectors/flowpath.geojson", "vectors/streams.geojson", "vectors/corridor.geojson", "flood/hand.png",
              "flood/hand_lut.json"):
        log(f"  wrote {f}: {(out / f).stat().st_size / 1e3:.1f} kB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
