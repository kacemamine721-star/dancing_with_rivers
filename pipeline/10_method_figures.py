#!/usr/bin/env python3
"""10 · Method figures: presentation-quality stills for the Methods tutorial page and the V2 preview page.

Every figure is drawn from files already produced by the pipeline (no new data, nothing invented):
  work/reservoir/**, cache/{gcov,s1}/*.npz (via 02_reservoir.py functions), work/anomaly/departure.csv,
  work/level/swot_all.csv, work/routing/gem15/*.tif, work/anuga/v*_d12/*.tif, work/upper_mellegue/*.npz,
  TESTS/nisar_tunisia_output/*.csv and the bundle apps/web/public/data/<version>/**.

Outputs: apps/web/public/methods/<id>_<name>.webp + figures.json (list of {id, file, title, caption_simple,
caption_expert, badge, source, group, width, height}). Deterministic: no timestamps, fixed inputs.

  python pipeline/10_method_figures.py [--config config.yaml] [--only m01,m05] [--max-kb 250]
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common  # noqa: E402  (PROJ guard first: neutralises foreign PROJ_LIB/PROJ_DATA/GDAL_DATA)

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import colors as mcolors  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Patch, Rectangle  # noqa: E402
import matplotlib.patheffects as pe  # noqa: E402

ROOT = common.ROOT
OUT = ROOT / "apps/web/public/methods"

# ------------------------------------------------------------------------------------------------ style
BG, PANEL, FG, MUTED, GRID = "#05070b", "#0a0e15", "#e9eef3", "#8b97a6", "#1b2330"
CYAN, AMBER, MAGENTA = "#4fe3f0", "#f0a020", "#ff4fd2"
TEAL, BLUE, VIOLET = "#2ec4b6", "#3d8bfd", "#b39dff"
WARN, ALERT = "#ffd166", "#ff5a7a"
W, H, DPI = 16.0, 9.0, 100           # 1600 × 900 px

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 15, "text.color": FG, "axes.labelcolor": FG,
    "axes.edgecolor": "#3a4554", "axes.facecolor": BG, "figure.facecolor": BG, "savefig.facecolor": BG,
    "xtick.color": MUTED, "ytick.color": MUTED, "xtick.labelsize": 13, "ytick.labelsize": 13,
    "axes.titlesize": 17, "axes.titleweight": "bold", "axes.titlecolor": FG, "axes.titlelocation": "left",
    "axes.titlepad": 10, "axes.labelsize": 14, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": False, "grid.color": GRID, "grid.linewidth": 0.8, "legend.frameon": False,
    "legend.fontsize": 12.5, "legend.labelcolor": FG, "axes.unicode_minus": True,
})

CR_S1 = "ESA Copernicus Sentinel-1"
CR_NISAR = "NISAR (NASA-ISRO), ASF DAAC"
CR_GEM = "GEM-15 DTM produced by Google (CC-BY 4.0)"


def mod(name):
    spec = importlib.util.spec_from_file_location(f"m_{name[:3]}", Path(__file__).with_name(name))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def figure(w=W, h=H):
    return plt.figure(figsize=(w, h), dpi=DPI)


def header(fig, title, sub=None, badge=None):
    fig.text(0.03, 0.955, title, fontsize=24, fontweight="bold", color=FG, va="top")
    if sub:
        fig.text(0.03, 0.895, sub, fontsize=14.5, color=MUTED, va="top")
    if badge:
        col = {"MEASURED": CYAN, "MODELLED": AMBER, "REPORTED": VIOLET, "ILLUSTRATIVE": MAGENTA}.get(badge, FG)
        fig.text(0.97, 0.952, f"●  {badge}", fontsize=12.5, color=col, ha="right", va="top", family="DejaVu Sans Mono",
                 fontweight="bold", bbox=dict(boxstyle="round,pad=0.45,rounding_size=0.8", fc=BG, ec=col, lw=1.2))


def credit(fig, text):
    fig.text(0.985, 0.012, f"Dancing with the Rivers · data: {text}", fontsize=9.5, color="#5d6875", ha="right",
             va="bottom")


def style_axes(ax, grid_y=True, grid_x=False):
    ax.set_facecolor(BG)
    ax.spines["left"].set_color("#3a4554")
    ax.spines["bottom"].set_color("#3a4554")
    if grid_y:
        ax.grid(True, axis="y", color=GRID, lw=0.8)
    if grid_x:
        ax.grid(True, axis="x", color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    ax.tick_params(length=0, pad=6)


def map_axes(ax):
    ax.set_xticks([]), ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)


def scalebar(ax, km, x0f=0.04, y0f=0.05, color=FG, extent=None):
    """Scale bar in data units (metres). `extent` = (xmin, xmax, ymin, ymax) of the axes in metres."""
    xmin, xmax, ymin, ymax = extent if extent else (*ax.get_xlim(), *ax.get_ylim())
    x0 = xmin + x0f * (xmax - xmin)
    y0 = ymin + y0f * (ymax - ymin)
    ax.plot([x0, x0 + km * 1000], [y0, y0], color=color, lw=3, solid_capstyle="butt",
            path_effects=[pe.withStroke(linewidth=5, foreground=BG)])
    ax.text(x0 + km * 500, y0 + 0.018 * (ymax - ymin), f"{km:g} km", color=color, ha="center", va="bottom",
            fontsize=12, path_effects=[pe.withStroke(linewidth=3, foreground=BG)])


def halo(lw=3):
    return [pe.withStroke(linewidth=lw, foreground=BG)]


def save(fig, name, max_kb, quality=82):
    from PIL import Image
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=DPI)
    plt.close(fig)
    buf.seek(0)
    im = Image.open(buf).convert("RGB")
    path = OUT / f"{name}.webp"
    q = quality
    while True:
        im.save(path, "WEBP", quality=q, method=6)
        kb = path.stat().st_size / 1024
        if kb <= max_kb or q <= 50:
            break
        q -= 6
    print(f"  {path.name}: {im.size[0]}×{im.size[1]} px, {kb:.0f} KB (q={q})")
    return path.name, im.size


def hillshade(z, res, az=315, alt=40, zf=1.6):
    z = np.where(np.isfinite(z), z, np.nanmedian(z))
    gy, gx = np.gradient(z * zf, res)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, b = np.radians(az), np.radians(alt)
    hs = np.sin(b) * np.sin(slope) + np.cos(b) * np.cos(slope) * np.cos(a - aspect)
    return np.clip(hs, 0, 1)


def terrain_rgb(z, res):
    """Dark, desaturated relief: hillshade × elevation tint (keeps overlays readable)."""
    hs = hillshade(z, res)
    lo, hi = np.nanpercentile(z, [2, 98])
    t = np.clip((z - lo) / (hi - lo + 1e-9), 0, 1)
    tint = mcolors.LinearSegmentedColormap.from_list("t", ["#141b24", "#25303a", "#3d4650", "#5a6068"])(t)[..., :3]
    rgb = tint * (0.35 + 0.85 * hs[..., None])
    return np.clip(rgb, 0, 1)


def read_tif(path):
    import rasterio
    with rasterio.open(path) as r:
        a = r.read(1).astype(np.float32)
        if r.nodata is not None and np.isfinite(r.nodata):
            a[a == r.nodata] = np.nan
        b = r.bounds
        return a, (b.left, b.right, b.bottom, b.top), r.res[0]


def geo(path):
    return json.loads(Path(path).read_text("utf-8"))


def coords_of(geom):
    t = geom["type"]
    c = geom["coordinates"]
    if t == "LineString":
        return [np.asarray(c)]
    if t == "MultiLineString":
        return [np.asarray(x) for x in c]
    if t == "Polygon":
        return [np.asarray(x) for x in c]
    if t == "MultiPolygon":
        return [np.asarray(r) for p in c for r in p]
    return []


def um(x, fmt="{:+.1f}"):
    """Format a signed number with a true minus sign (U+2212)."""
    return fmt.format(x).replace("-", "−")


def scene_time(ctx, sensor, date, track):
    """UTC hh:mm of a pass: from reservoir_area.json, else parsed from the product name in series.csv."""
    p = ctx.point(sensor, date, track)
    if p is not None and isinstance(p.time_utc, str) and p.time_utc:
        return p.time_utc
    import re
    s = pd.read_csv(ROOT / "work/reservoir/series.csv")
    r = s[(s.sensor == sensor) & (s.date == date) & (s.track == track)]
    m = re.search(r"_(\d{8})T(\d{2})(\d{2})", r.iloc[0].scene) if len(r) else None
    return f"{m.group(2)}:{m.group(3)}" if m else "time n/a"


def short_date(d):
    return pd.Timestamp(d).strftime("%-d %b %Y") if sys.platform != "win32" else pd.Timestamp(d).strftime("%#d %b %Y")


# ================================================================================================ context
class Ctx:
    def __init__(self, cfg):
        self.cfg = cfg
        self.bundle = common.bundle_dir(cfg)
        self.res = mod("02_reservoir.py")
        self.area = geo(self.bundle / "timeseries/reservoir_area.json")
        self.pts = pd.DataFrame(self.area["points"])
        self.events = geo(self.bundle / "story/events.json")["events"]
        self.grid = geo(self.bundle / "terrain/grid.json")
        self._lake = None

    def ev(self, kind):
        return next(e for e in self.events if e["kind"] == kind)

    def point(self, sensor, date, track):
        r = self.pts[(self.pts.sensor == sensor) & (self.pts.date == date) & (self.pts.track == track)]
        return r.iloc[0] if len(r) else None

    def chip(self, lid):
        from PIL import Image
        enc = np.asarray(Image.open(self.bundle / f"radar/{lid}.png")).astype(np.float32)
        db = np.where(enc > 0, enc / 255 * 25 - 25, np.nan)
        mask = np.asarray(Image.open(self.bundle / f"radar/{lid}_mask.png")) > 127
        return db, mask

    def chip_extent(self):
        b = self.grid["lake_chip"]["bounds_m"]
        return (b[0], b[2], b[1], b[3])

    def lake(self):
        """Recompute the lake polygon exactly as 02_reservoir.py does (pre-failure S1 water frequency)."""
        if self._lake is None:
            R = self.res
            series = pd.read_csv(ROOT / "work/reservoir/series.csv")
            series = series[series["status"] == "ok"].reset_index(drop=True)
            lake = self.cfg["aoi"]["lake"]
            pad = 0.03
            grid = R.Grid(R.utm_box((lake[0] - pad, lake[1] - pad, lake[2] + pad, lake[3] + pad)))
            gj = self.grid["lake_chip"]
            chip = R.Grid(tuple(gj["bounds_m"]), gj["res_m"])
            cw = grid.window_of(chip)
            from pyproj import Transformer
            dam_xy = Transformer.from_crs(4326, 32632, always_xy=True).transform(*self.cfg["dam"]["lonlat"])
            pre = series[(series.sensor == "S1") & (series.date < "2026-06-17")]
            k = self.cfg["water"]["boxcar"]
            print(f"  recomputing lake polygon from {len(pre)} pre-failure S1 images (cache)…")
            dbs = [R.load_db(r, grid, k) for _, r in pre.iterrows()]
            lake_mask, freq, _ = R.lake_polygon(dbs, grid, dam_xy, self.cfg["water"]["polygon_dilate_m"])
            from scipy import ndimage as ndi
            ring = ndi.binary_dilation(lake_mask, structure=R.disk(30)) & ~lake_mask
            self._lake = dict(grid=grid, cw=cw, mask=lake_mask, ring=ring, freq=freq, series=series, pre=pre,
                              dam_xy=dam_xy, k=k)
        return self._lake


# ================================================================================================ tutorial
def m01(ctx, mk):
    t_s1 = scene_time(ctx, "S1", "2026-06-17", "o88")
    t_ni = scene_time(ctx, "NISAR", "2026-06-19", "D80/F70")
    a, _ = ctx.chip("s1_2026-06-17_o88_VV")
    b, _ = ctx.chip("nisar_2026-06-19_D80F70_HH")
    ext = ctx.chip_extent()
    fig = figure()
    header(fig, "Same lake, two radars",
           "Sentinel-1 (C-band) two days before NISAR's first image (L-band). A cross-sensor pair: compare the "
           "look, not the numbers.", "MEASURED")
    for i, (img, ttl, sub) in enumerate([
            (a, "C-band, before (Sentinel-1)", f"17 Jun 2026 · {t_s1} UTC · orbit 88 · VV"),
            (b, "L-band, after (NISAR)", f"19 Jun 2026 · {t_ni} UTC · track D80 · HH")]):
        ax = fig.add_axes([0.03 + i * 0.475, 0.12, 0.445, 0.66])
        im = ax.imshow(img, cmap="gray", vmin=-25, vmax=0, extent=ext, interpolation="lanczos")
        map_axes(ax)
        ax.set_title(ttl, fontsize=18, color=CYAN if i else VIOLET, pad=30)
        ax.text(0, 1.015, sub, transform=ax.transAxes, fontsize=13, color=MUTED, va="bottom")
        scalebar(ax, 1, extent=ext)
    cax = fig.add_axes([0.03, 0.075, 0.26, 0.018])
    cb = fig.colorbar(im, cax=cax, orientation="horizontal")
    cb.set_label("radar backscatter (dB)", fontsize=12, color=MUTED, labelpad=4)
    cb.outline.set_visible(False)
    cb.ax.tick_params(labelsize=11, colors=MUTED, length=0)
    fig.text(0.505, 0.085, "Dark = smooth water: it reflects the radar pulse away,\nlike a mirror, so little comes back.",
             fontsize=13.5, color=FG, ha="left", va="center", linespacing=1.4,
             bbox=dict(boxstyle="round,pad=0.6", fc="#0d1520", ec=CYAN, lw=1))
    credit(fig, f"{CR_S1}; {CR_NISAR}")
    name, size = save(fig, "m01_radar_basics", mk)
    return dict(id="m01", file=name, size=size, title="Same lake, two radars",
                caption_simple="Radar sees through cloud and at night. Calm water looks dark because it bounces the "
                               "radar signal away, so the lake stands out from the brighter land around it.",
                caption_expert=f"γ0 backscatter, boxcar 5×5, 10 m lake-chip grid (UTM 32N), −25…0 dB. Left: Sentinel-1 "
                               f"C-band VV, 17 Jun 2026 {t_s1} UTC (orbit 88); right: NISAR L-band HH GCOV, "
                               f"19 Jun 2026 {t_ni} UTC (D80/F70). Cross-sensor pair (different band, polarisation, incidence): "
                               f"illustrates the signal, not evidence of change.",
                badge="MEASURED", source=f"{CR_S1} RTC (Microsoft Planetary Computer); NASA/JPL–ISRO NISAR GCOV (ASF DAAC)")


def m02(ctx, mk):
    L = ctx.lake()
    cw = L["cw"]
    freq = L["freq"][cw]
    lake = L["mask"][cw]
    ext = ctx.chip_extent()
    pre = L["pre"]
    n = len(pre)
    d0, d1 = pre.date.min(), pre.date.max()
    lake_km2 = L["mask"].sum() * 100 / 1e6
    fig = figure()
    header(fig, "Step 1 · Where is the lake?",
           f"Before the failure: how often each 10 m pixel was water in {n} Sentinel-1 images ({short_date(d0)} – "
           f"{short_date(d1)}).", "MEASURED")
    ax = fig.add_axes([0.03, 0.08, 0.62, 0.78])
    cmap = mcolors.LinearSegmentedColormap.from_list("f", ["#070a10", "#0f2a3a", "#1b6f86", CYAN, "#d8fbff"])
    im = ax.imshow(np.where(freq > 0.02, freq, np.nan), cmap=cmap, vmin=0, vmax=1, extent=ext, interpolation="nearest")
    ax.set_facecolor("#070a10")
    yy = np.linspace(ext[3], ext[2], lake.shape[0])
    xx = np.linspace(ext[0], ext[1], lake.shape[1])
    ax.contour(xx, yy, lake.astype(float), levels=[0.5], colors=[MAGENTA], linewidths=2)
    dx, dy = L["dam_xy"]
    ax.plot(dx, dy, marker="v", ms=13, color=FG, mec=BG, mew=1.5)
    ax.text(dx + 150, dy - 250, "dam", color=FG, fontsize=13, path_effects=halo())
    ax.set_xlim(ext[0], ext[1]), ax.set_ylim(ext[2], ext[3])
    map_axes(ax)
    scalebar(ax, 1, extent=ext)
    cax = fig.add_axes([0.67, 0.18, 0.012, 0.5])
    cb = fig.colorbar(im, cax=cax)
    cb.outline.set_visible(False)
    cb.ax.tick_params(labelsize=11, colors=MUTED, length=0)
    cb.set_ticks([0, .5, 1]), cb.set_ticklabels(["0 %", "50 %", "100 %"])
    cb.set_label("share of images classified as water", fontsize=12, color=MUTED)
    tx = 0.735
    fig.text(tx, 0.72, "Lake polygon", fontsize=17, fontweight="bold", color=MAGENTA)
    fig.text(tx, 0.68, f"{lake_km2:.2f} km²", fontsize=34, family="DejaVu Sans Mono", color=FG, va="top")
    lines = ["water in ≥ 50 % of the images,",
             "the patch nearest the dam,",
             "holes filled, grown by 100 m.",
             "",
             "All later areas are counted inside",
             "this polygon only, so dark dry fields",
             "around the lake cannot inflate them."]
    fig.text(tx, 0.56, "\n".join(lines), fontsize=13.5, color=MUTED, va="top", linespacing=1.5)
    credit(fig, f"{CR_S1} RTC via Microsoft Planetary Computer")
    name, size = save(fig, "m02_lake_polygon", mk)
    return dict(id="m02", file=name, size=size, title="Step 1 · Where is the lake?",
                caption_simple="We first map the lake as it was before the failure: the pixels that were water in most "
                               "Sentinel-1 images. Every later measurement is counted inside this outline only.",
                caption_expert=f"Water frequency over {n} pre-failure Sentinel-1 RTC VV images ({d0} → {d1}), each "
                               f"thresholded by Otsu (clamped −23…−13.5 dB). Polygon = frequency ≥ 50 %, component "
                               f"nearest the dam, holes filled, dilated 100 m: {lake_km2:.2f} km² on the 10 m grid.",
                badge="MEASURED", source=f"{CR_S1} RTC (Microsoft Planetary Computer); this project (02_reservoir.py)")


def m03(ctx, mk):
    L = ctx.lake()
    R = ctx.res
    sel = L["series"]
    row = sel[(sel.sensor == "S1") & (sel.date == "2026-06-17") & (sel.track == "o88")].iloc[0]
    db = R.load_db(row, L["grid"], L["k"])
    zone = L["mask"] | L["ring"]
    t, _ = R.otsu_thr(db[zone], -23.0, -13.5)
    water = R.clean((db < t) & L["mask"])
    fix = R.clean((db < -18) & L["mask"])
    a_ad, a_fx = water.sum() * 100 / 1e6, fix.sum() * 100 / 1e6
    a_lo = R.clean((db < t - 2) & L["mask"]).sum() * 100 / 1e6
    a_hi = R.clean((db < t + 2) & L["mask"]).sum() * 100 / 1e6
    v = np.clip(db[zone][np.isfinite(db[zone])], -30, 2)
    fig = figure()
    header(fig, "Step 2 · A threshold for each image",
           "Sentinel-1, 17 Jun 2026 17:20 UTC (orbit 88): wind roughens the lake, so a fixed −18 dB cut misses it.",
           "MEASURED")
    ax = fig.add_axes([0.06, 0.13, 0.42, 0.66])
    style_axes(ax)
    bins = np.linspace(-30, 2, 97)
    hist, edges = np.histogram(v, bins=bins)
    mids = (edges[:-1] + edges[1:]) / 2
    ax.bar(mids, hist, width=np.diff(edges), color=np.where(mids < t, CYAN, "#4a5563"), alpha=0.95, lw=0)
    ymax = hist.max() * 1.55
    ax.axvline(t, color=CYAN, lw=2.2)
    ax.text(t + 0.4, ymax * 0.93, f"adaptive (Otsu)\n{um(t)} dB" + ("\n(at its upper\nlimit)" if t >= -13.5 else ""), color=CYAN, fontsize=13.5, va="top")
    ax.axvline(-18, color=ALERT, lw=1.8, ls="--")
    ax.text(-18.4, ymax * 0.93, "fixed\n−18 dB", color=ALERT, fontsize=13.5, va="top", ha="right")
    ax.set_ylim(0, ymax)
    ax.set_xlim(-30, 2)
    ax.set_xlabel("backscatter (dB), lake polygon + 300 m ring of land")
    ax.set_ylabel("pixels (10 m)")
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda x, _: f"{x / 1000:.0f}k" if x else "0"))
    ax.text(-29.5, ymax * 0.55, "darker:\nwater", color=CYAN, fontsize=12.5)
    ax.text(1.5, ymax * 0.55, "brighter:\nland", color=MUTED, fontsize=12.5, ha="right")
    cw = L["cw"]
    ext = ctx.chip_extent()
    ax2 = fig.add_axes([0.53, 0.13, 0.44, 0.66])
    ax2.imshow(db[cw], cmap="gray", vmin=-25, vmax=0, extent=ext, interpolation="lanczos")
    over = np.zeros((*water[cw].shape, 4))
    over[water[cw]] = mcolors.to_rgba(CYAN, 0.55)
    ax2.imshow(over, extent=ext, interpolation="nearest")
    yy = np.linspace(ext[3], ext[2], water[cw].shape[0])
    xx = np.linspace(ext[0], ext[1], water[cw].shape[1])
    ax2.contour(xx, yy, L["mask"][cw].astype(float), levels=[0.5], colors=[MAGENTA], linewidths=1.2)
    ax2.contour(xx, yy, fix[cw].astype(float), levels=[0.5], colors=[ALERT], linewidths=1.0, linestyles="--")
    map_axes(ax2)
    scalebar(ax2, 1, extent=ext)
    ax2.set_title("Resulting water mask", pad=12)
    leg = [Patch(fc=mcolors.to_rgba(CYAN, .55), ec="none", label=f"water, adaptive: {a_ad:.2f} km²"),
           Line2D([], [], color=ALERT, ls="--", lw=1.5, label=f"fixed −18 dB: {a_fx:.2f} km²"),
           Line2D([], [], color=MAGENTA, lw=1.5, label="lake polygon")]
    ax2.legend(handles=leg, loc="lower right", fontsize=12, facecolor=BG, framealpha=0.85, frameon=True,
               edgecolor="#2a3340")
    credit(fig, f"{CR_S1} RTC via Microsoft Planetary Computer")
    name, size = save(fig, "m03_adaptive_threshold", mk)
    return dict(id="m03", file=name, size=size, title="Step 2 · A threshold for each image",
                caption_simple="Wind and wet mud change how dark water looks. Instead of one fixed cut-off, each image "
                               "gets its own, found where its 'water' and 'land' pixels separate best.",
                caption_expert=f"Otsu threshold on γ0 dB (boxcar 5×5) in the lake polygon + 300 m land ring, clamped "
                               f"−23…−13.5 dB. Sentinel-1 VV 17 Jun 2026 (o88): T = {um(t, '{:.1f}')} dB (at the clamp "
                               f"limit) → {a_ad:.2f} km² ({a_lo:.2f}–{a_hi:.2f} for T ±2 dB); a "
                               f"fixed −18 dB gives {a_fx:.2f} km² because the wind-roughened lake sits at about "
                               f"−15…−17 dB. Threshold ±2 dB moves areas by a median ±23 % (validation A1).",
                badge="MEASURED", source=f"{CR_S1} RTC (Microsoft Planetary Computer); this project (02_reservoir.py)")


def m04(ctx, mk):
    sel = [("S1", "2026-06-10", "o161", "s1_2026-06-10_o161_VV"),
           ("S1", "2026-06-17", "o88", "s1_2026-06-17_o88_VV"),
           ("NISAR", "2026-06-19", "D80/F70", "nisar_2026-06-19_D80F70_HH"),
           ("NISAR", "2026-07-01", "D80/F70", "nisar_2026-07-01_D80F70_HH"),
           ("NISAR", "2026-07-13", "D80/F70", "nisar_2026-07-13_D80F70_HH"),
           ("NISAR", "2026-10-29", "D80/F70", "nisar_2026-10-29_D80F70_HH")]
    ext = ctx.chip_extent()
    fig = figure(16, 10)
    header(fig, "Step 3 · One mask per image",
           "Radar input and detected water (inside the lake polygon), Sentinel-1 before and NISAR after the failure.",
           "MEASURED")
    gw, gh = 0.235, 0.222
    x0s = [0.025, 0.26, 0.515, 0.75]
    y0s = [0.585, 0.31, 0.04]
    areas = {}
    for i, (s, d, tr, lid) in enumerate(sel):
        db, mask = ctx.chip(lid)
        p = ctx.point(s, d, tr)
        areas[d] = p.area_km2
        r, c = divmod(i, 2)
        for j in range(2):
            ax = fig.add_axes([x0s[c * 2 + j], y0s[r] + 0.005, gw, gh])
            if j == 0:
                ax.imshow(db, cmap="gray", vmin=-25, vmax=0, extent=ext, interpolation="lanczos")
            else:
                ax.imshow(db, cmap="gray", vmin=-25, vmax=0, extent=ext, interpolation="lanczos", alpha=0.35)
                over = np.zeros((*mask.shape, 4))
                over[mask] = mcolors.to_rgba(CYAN, 0.95)
                ax.imshow(over, extent=ext, interpolation="nearest")
            map_axes(ax)
            ax.set_facecolor("#000")
            lab = "INPUT" if j == 0 else "WATER MASK"
            ax.text(0.025, 0.96, lab, transform=ax.transAxes, fontsize=10.5, family="DejaVu Sans Mono",
                    color=FG, va="top", fontweight="bold", path_effects=halo())
        col = VIOLET if s == "S1" else CYAN
        band = "Sentinel-1 C-band" if s == "S1" else "NISAR L-band"
        trk = tr.split("/")[0]
        fig.text(x0s[c * 2], y0s[r] + gh + 0.012, f"{short_date(d)}", fontsize=14.5, fontweight="bold", color=FG)
        fig.text(x0s[c * 2] + 0.115, y0s[r] + gh + 0.012, f"{band} · {trk}", fontsize=12, color=col)
        fig.text(x0s[c * 2 + 1] + gw, y0s[r] + gh + 0.012, f"{p.area_km2:.2f} km²", fontsize=15,
                 family="DejaVu Sans Mono", color=FG, ha="right", fontweight="bold")
    credit(fig, f"{CR_S1}; {CR_NISAR}")
    name, size = save(fig, "m04_masks_through_time", mk)
    a = areas
    return dict(id="m04", file=name, size=size, title="Step 3 · One mask per image",
                caption_simple="The same method is applied to every image. The lake shrinks over the weeks after the "
                               "failure and starts to recover with the autumn rain.",
                caption_expert=f"Adaptive-Otsu water masks inside the lake polygon, 10 m grid. Areas (km², raw per "
                               f"track): S1 10 Jun o161 {a['2026-06-10']:.2f}, S1 17 Jun o88 {a['2026-06-17']:.2f}, "
                               f"NISAR D80 19 Jun {a['2026-06-19']:.2f}, 1 Jul {a['2026-07-01']:.2f}, 13 Jul "
                               f"{a['2026-07-13']:.2f}, 29 Oct {a['2026-10-29']:.2f}. S1 → NISAR is cross-sensor "
                               f"(C vs L band); compare within one sensor and track.",
                badge="MEASURED", source=f"{CR_S1} RTC (Microsoft Planetary Computer); NASA/JPL–ISRO NISAR GCOV (ASF DAAC)")


TRACK_MARK = {"D80/F70": "o", "A101/F20": "s", "A173/F20": "D", "D8/F70": "^", "o88": "o", "o161": "s", "o168": "D"}


def m05(ctx, mk):
    df = ctx.pts.copy()
    df["t"] = pd.to_datetime(df.date)
    df["fac"] = df.area_norm_km2 / df.area_km2
    df["lo"] = df.area_norm_km2 - 2 * df.sigma_km2 * df.fac
    df["hi"] = df.area_norm_km2 + 2 * df.sigma_km2 * df.fac
    fig = figure()
    header(fig, "Step 4 · The lake area over time",
           "All passes, harmonised per track (incidence angles differ). Bars: threshold ±2 dB.", "MEASURED")
    ax = fig.add_axes([0.065, 0.15, 0.9, 0.66])
    style_axes(ax)
    gap = ctx.area["gaps"][0]
    ax.axvspan(pd.Timestamp(gap[0]), pd.Timestamp(gap[1]), color="#101722", lw=0)
    ax.text(pd.Timestamp(gap[0]) + (pd.Timestamp(gap[1]) - pd.Timestamp(gap[0])) / 2, 0.25, "no NISAR\nacquisitions",
            ha="center", fontsize=11.5, color=MUTED)
    for (s, tr), g in df.groupby(["sensor", "track"]):
        g = g.sort_values("t")
        col = CYAN if s == "NISAR" else VIOLET
        ok = g[g.confidence != "low"]
        ax.vlines(ok.t, ok.lo, ok.hi, color=col, alpha=0.28, lw=1.4)
        ax.plot(ok.t, ok.area_norm_km2, ls="-" if s == "NISAR" else (0, (3, 2)), lw=1.1, color=col, alpha=0.55)
        ax.plot(ok.t, ok.area_norm_km2, ls="none", marker=TRACK_MARK.get(tr, "o"), ms=6.5, color=col, mec=BG, mew=0.6)
        lo = g[g.confidence == "low"]
        if len(lo):
            ax.plot(lo.t, lo.area_norm_km2, ls="none", marker=TRACK_MARK.get(tr, "o"), ms=8, mfc="none", mec=WARN,
                    mew=1.6)
    ymax = 4.0
    for kind, txt in [("failure", "gate failure 17 Jun"), ("repair", "gate repaired 16 Jul")]:
        e = ctx.ev(kind)
        x = pd.Timestamp(e["date"])
        ax.axvline(x, color=MAGENTA if kind == "failure" else FG, lw=1.3, ls="--", alpha=0.9)
        ax.text(x + pd.Timedelta(days=1.5), ymax * 0.985, f"{txt}\n(REPORTED)", fontsize=11.5, va="top",
                color=MAGENTA if kind == "failure" else FG)
    ax.set_ylim(0, ymax)
    ax.set_xlim(df.t.min() - pd.Timedelta(days=3), df.t.max() + pd.Timedelta(days=3))
    ax.set_ylabel("water area (km², harmonised)")
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%b"))
    ax.xaxis.set_major_locator(matplotlib.dates.MonthLocator())
    hand = [Line2D([], [], color=CYAN, marker="o", lw=1.2, label="NISAR L-band (4 tracks)"),
            Line2D([], [], color=VIOLET, marker="s", lw=1.2, ls=(0, (3, 2)), label="Sentinel-1 C-band (3 orbits)"),
            Line2D([], [], color=WARN, marker="o", mfc="none", ls="none", mew=1.6,
                   label="low confidence (wind-roughened lake)")]
    ax.legend(handles=hand, loc="upper right", ncol=3, bbox_to_anchor=(1, 1.1), fontsize=12)
    n_lo = int((df.confidence == "low").sum())
    n = len(df)
    credit(fig, f"{CR_S1}; {CR_NISAR}; events: Tunisian press")
    name, size = save(fig, "m05_area_series", mk)
    return dict(id="m05", file=name, size=size, title="Step 4 · The lake area over time",
                caption_simple="After the gate failed the lake shrank over several weeks, not overnight, until the "
                               "gate was repaired in mid-July. It stayed low in summer and rose again with the autumn rain.",
                caption_expert=f"{n} water-area measurements ({n - n_lo} good, {n_lo} low-confidence) from NISAR GCOV HH "
                               f"(D80, A101, A173, D8) and Sentinel-1 RTC VV (o88, o161, o168), adaptive Otsu inside the "
                               f"lake polygon, harmonised per track on Aug–Oct medians; bars = threshold ±2 dB. NISAR "
                               f"gap {gap[0]} → {gap[1]}. Event dates are press reports (REPORTED). Right after the "
                               f"failure, L-band reads wet mud as water, so NISAR area lags.",
                badge="MEASURED", source=f"{CR_S1} RTC; NASA/JPL–ISRO NISAR GCOV (ASF DAAC); events: Tunisian press (REPORTED)")


def m06(ctx, mk):
    d = pd.read_csv(ROOT / "work/anomaly/departure.csv")
    d = d[np.isfinite(d.dep)].copy()
    d["t"] = pd.to_datetime(d.date)
    d["pct"] = d.dep * 100
    fig = figure()
    header(fig, "Step 5 · When does a drop become an alert?",
           "Each new pass vs the median of all sensors over the previous 21 days. Flags need a second, independent pass.",
           "MODELLED")
    ax = fig.add_axes([0.075, 0.15, 0.89, 0.66])
    style_axes(ax)
    lo_y, hi_y = -60, 45
    ax.axhspan(-20, -12, color=WARN, alpha=0.07, lw=0)
    ax.axhspan(lo_y, -20, color=ALERT, alpha=0.08, lw=0)
    ax.axhline(0, color="#3a4554", lw=1)
    ax.axhline(-12, color=WARN, lw=1.3, ls="--")
    ax.axhline(-20, color=ALERT, lw=1.3, ls="--")
    x_end = d.t.max() + pd.Timedelta(days=4)
    x_l = d.t.min() - pd.Timedelta(days=2)
    ax.text(x_l, -12 + 1.2, "WARNING  −12 %", color=WARN, ha="left", fontsize=12, family="DejaVu Sans Mono")
    ax.text(x_l, -20 - 1.2, "ALERT  −20 %", color=ALERT, ha="left", va="top", fontsize=12,
            family="DejaVu Sans Mono")
    col = d.level.map({"ALERT": ALERT, "WARNING": WARN}).fillna("#7d8896")
    for s, mkr in [("S1", "s"), ("NISAR", "o")]:
        g = d[d.sensor == s]
        ax.scatter(g.t, g.pct.clip(lo_y + 2, hi_y - 2), c=col[g.index], marker=mkr, s=46, edgecolors=BG,
                   linewidths=0.6, zorder=3)
    e = ctx.ev("failure")
    ax.axvline(pd.Timestamp(e["date"]), color=MAGENTA, lw=1.3, ls="--")
    ax.text(pd.Timestamp(e["date"]) - pd.Timedelta(days=1.5), hi_y - 3, "gate failure\n17 Jun (REPORTED)",
            color=MAGENTA, fontsize=11.5, ha="right", va="top")
    fa = d[d.level == "ALERT"].sort_values(["date", "dep"], ascending=[True, False]).iloc[0]
    conf = d[(d.date == fa.date) & (d.level == "ALERT") & (d.index != fa.name)]
    ax.annotate(f"first ALERT {short_date(fa.date)}\nS1 {fa.track} {um(fa.pct)} %"
                + (f", confirmed by S1 {conf.iloc[0].track} {um(conf.iloc[0].pct)} %" if len(conf) else ""),
                xy=(fa.t, fa.pct), xytext=(fa.t + pd.Timedelta(days=8), -50), color=FG, fontsize=12.5,
                arrowprops=dict(arrowstyle="-", color=FG, lw=1), va="center")
    ax.set_ylim(lo_y, hi_y)
    ax.set_xlim(d.t.min() - pd.Timedelta(days=3), x_end)
    ax.set_ylabel("departure from 21-day baseline (%)")
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%b"))
    ax.xaxis.set_major_locator(matplotlib.dates.MonthLocator())
    hand = [Line2D([], [], marker="o", color="#7d8896", ls="none", label="NISAR"),
            Line2D([], [], marker="s", color="#7d8896", ls="none", label="Sentinel-1  (grey: no confirmed flag)"),
            Line2D([], [], marker="o", color=WARN, ls="none", label="WARNING (confirmed)"),
            Line2D([], [], marker="o", color=ALERT, ls="none", label="ALERT (confirmed)")]
    ax.legend(handles=hand, loc="upper right", ncol=4, bbox_to_anchor=(1, 1.1), fontsize=12)
    pre = d[d.date < e["date"]]
    n_pre_flag = int(pre.level.isin(["ALERT", "WARNING"]).sum())
    credit(fig, f"{CR_S1}; {CR_NISAR}; rule: this project")
    name, size = save(fig, "m06_anomaly_rule", mk)
    return dict(id="m06", file=name, size=size, title="Step 5 · When does a drop become an alert?",
                caption_simple="NISAR and Sentinel-1 together would have raised an alarm on 22 June, five days after "
                               "the failure, with no ground sensor. Red points are confirmed alerts, yellow ones confirmed warnings.",
                caption_expert=f"Harmonised area vs median of all passes in the previous 21 days; WARNING < −12 %, "
                               f"ALERT < −20 %, each confirmed by an independent pass within 6 days. First ALERT "
                               f"{fa.date}: S1 {fa.track} {um(fa.pct)} %"
                               + (f", confirmed by S1 {conf.iloc[0].track} {um(conf.iloc[0].pct)} %" if len(conf) else "")
                               + f"; {n_pre_flag} flags before the failure. NISAR is in the baseline; first NISAR flag "
                               f"26 Jun (A173, WARNING). Oct–Nov flags follow a real multi-sensor decline and need an "
                               f"operator check.",
                badge="MODELLED", source="Rule-based detector (this project, 03_anomaly.py) on MEASURED NISAR + Sentinel-1 areas")


def m07(ctx, mk):
    lv = geo(ctx.bundle / "level/level_volume.json")
    sw = pd.DataFrame(lv["swot"]["points"])
    sw["t"] = pd.to_datetime(sw.time).dt.tz_localize(None)
    sw26 = sw[sw.t >= "2026-01-01"]
    n_old = int((sw.t < "2026-01-01").sum())
    dv = lv["delta_volume"][0]
    fig = figure()
    header(fig, "Step 6 · How far did the water drop?",
           "SWOT measures the lake's surface height directly, from orbit.", "MEASURED")
    ax = fig.add_axes([0.075, 0.15, 0.6, 0.66])
    style_axes(ax)
    e = ctx.ev("failure")
    ax.axvline(pd.Timestamp(e["date"]), color=MAGENTA, lw=1.3, ls="--")
    ax.text(pd.Timestamp(e["date"]) + pd.Timedelta(days=2), 261.6, "gate failure\n17 Jun (REPORTED)", color=MAGENTA,
            fontsize=11.5, va="top")
    q0, q1 = sw26[sw26.quality == 0], sw26[sw26.quality == 1]
    ax.plot(sw26.t, sw26.wse_m, color=CYAN, lw=1, alpha=0.4)
    ax.errorbar(q0.t, q0.wse_m, yerr=q0.wse_u, fmt="o", ms=8, color=CYAN, mec=BG, ecolor=CYAN, elinewidth=1.2,
                label="quality 0 (good)")
    ax.errorbar(q1.t, q1.wse_m, yerr=q1.wse_u, fmt="o", ms=8, mfc="none", mec=CYAN, mew=1.5, ecolor=CYAN,
                elinewidth=1, label="quality 1 (suspect)")
    a = sw[sw.time.str.startswith(dv["from"])].iloc[0]
    b = sw[sw.time.str.startswith(dv["to"])].iloc[0]
    xm = a.t + (b.t - a.t) / 2
    ax.annotate("", xy=(b.t, b.wse_m), xytext=(a.t, a.wse_m),
                arrowprops=dict(arrowstyle="-|>", color=FG, lw=1.6, shrinkA=8, shrinkB=8))
    dh = b.wse_m - a.wse_m
    ax.text(xm + pd.Timedelta(days=4), (a.wse_m + b.wse_m) / 2 + 0.25, f"Δh {um(dh, '{:+.2f}')} m", fontsize=17,
            family="DejaVu Sans Mono", fontweight="bold", color=FG)
    ax.set_ylabel("lake surface height (m)")
    ax.set_ylim(254.2, 261.8)
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%b"))
    ax.xaxis.set_major_locator(matplotlib.dates.MonthLocator())
    ax.legend(loc="lower left", fontsize=12)
    tx = 0.72
    fig.text(tx, 0.78, "SWOT height (MEASURED)", fontsize=13, color=CYAN, family="DejaVu Sans Mono")
    fig.text(tx, 0.745, f"{a.wse_m:.2f} m → {b.wse_m:.2f} m", fontsize=21, family="DejaVu Sans Mono", color=FG, va="top")
    fig.text(tx, 0.685, f"{short_date(a.t)} → {short_date(b.t)}  (± {b.wse_u:.2f} m)", fontsize=12.5, color=MUTED,
             va="top")
    fig.text(tx, 0.57, "Storage change (MODELLED)", fontsize=13, color=AMBER, family="DejaVu Sans Mono")
    fig.text(tx, 0.535, f"ΔV {um(dv['dV_m3'] / 1e6)} Mm³", fontsize=27, family="DejaVu Sans Mono", color=FG,
             va="top", fontweight="bold")
    fig.text(tx, 0.455, f"range {um(dv['low'] / 1e6, '{:.1f}')} … {um(dv['high'] / 1e6, '{:.1f}')} Mm³", fontsize=13, color=MUTED, va="top")
    fig.text(tx, 0.38, "= area × height change, net of river\ninflow. Not the released volume\n"
             f"(reported: {lv['reported'][0]['value_m3'] / 1e6:.0f} Mm³, REPORTED).", fontsize=13, color=MUTED, va="top",
             linespacing=1.45)
    credit(fig, "SWOT (NASA/CNES) Hydrocron LakeSP; areas: Sentinel-1, NISAR")
    name, size = save(fig, "m07_swot_level", mk)
    return dict(id="m07", file=name, size=size, title="Step 6 · How far did the water drop?",
                caption_simple=f"The SWOT satellite measured the lake surface {abs(dh):.2f} m lower on 28 June than on "
                               f"7 June. Multiplying by the lake area gives a storage loss of about "
                               f"{abs(dv['dV_m3']) / 1e6:.0f} million m³.",
                caption_expert=f"SWOT Hydrocron LakeSP, PLD lake {lv['swot']['lake_id']}; quality_f 0 vs 1, ± wse_u. "
                               f"{a.wse_m:.2f} → {b.wse_m:.2f} ± {b.wse_u:.2f} m ({dv['from']} → {dv['to']}, Δh "
                               f"{um(dh, '{:+.2f}')} m). ΔV = trapezoid ∫A·dh = {um(dv['dV_m3'] / 1e6)} Mm³ "
                               f"({um(dv['low'] / 1e6, '{:.1f}')}…{um(dv['high'] / 1e6, '{:.1f}')}; radar vs SWOT area), MODELLED net "
                               f"storage change, not the release. {n_old} passes from 2024 not shown.",
                badge="MEASURED", source="SWOT (NASA/CNES) Hydrocron LakeSP; ΔV: this project (07_level_volume.py), MODELLED")


def _flow(ctx):
    fp = geo(ctx.bundle / "vectors/flowpath.geojson")["features"][0]
    xy = np.asarray(fp["geometry"]["coordinates"], float)
    dk = np.asarray(fp["properties"]["vertex_dist_km"], float)
    breaks = fp["properties"]["reach_breaks"]
    return xy, dk, breaks


def _at_km(xy, dk, km):
    return np.interp(km, dk, xy[:, 0]), np.interp(km, dk, xy[:, 1])


def m08(ctx, mk):
    z, ext, res = read_tif(ROOT / "work/routing/gem15/dem30.tif")
    xy, dk, breaks = _flow(ctx)
    pad = 6000
    x0, x1 = xy[:, 0].min() - pad, xy[:, 0].max() + pad
    y0, y1 = xy[:, 1].min() - pad, xy[:, 1].max() + pad
    # keep 16:9-ish, clamp to grid
    c0, c1 = int((x0 - ext[0]) / res), int((x1 - ext[0]) / res)
    r0, r1 = int((ext[3] - y1) / res), int((ext[3] - y0) / res)
    c0, r0 = max(c0, 0), max(r0, 0)
    sub = z[r0:r1, c0:c1]
    sext = (ext[0] + c0 * res, ext[0] + c1 * res, ext[3] - r1 * res, ext[3] - r0 * res)
    rgb = terrain_rgb(sub, res)
    fig = figure()
    header(fig, "Step 7 · Where does the water go?",
           "Following the steepest way down, cell by cell, on a 30 m bare-earth terrain model.", "MODELLED")
    ax = fig.add_axes([0.03, 0.05, 0.64, 0.8])
    ax.imshow(rgb, extent=sext, interpolation="bilinear")
    ax.plot(xy[:, 0], xy[:, 1], color=CYAN, lw=7, alpha=0.18, solid_capstyle="round")
    ax.plot(xy[:, 0], xy[:, 1], color=CYAN, lw=2.4, solid_capstyle="round")
    labels = [("Mellègue dam", 0.0, (2200, -400), "left")]
    for b in breaks:
        nm = "Sidi Salem reservoir" if b["name"].startswith("Sidi Salem") else b["name"]
        off = {"Jendouba": (-2500, -600), "Medjerda confluence": (2500, 900), "Bou Salem": (0, 2600),
               "Sidi Salem reservoir": (-300, -5400)}.get(nm, (2000, 2000))
        ha = {"Jendouba": "right", "Sidi Salem reservoir": "center"}.get(nm, "left")
        labels.append((nm, b["dist_km"], off, ha))
    for nm, km, (ox, oy), ha in labels:
        px, py = _at_km(xy, dk, km)
        ax.plot(px, py, "o", ms=10, color=BG, mec=CYAN, mew=2.2, zorder=5)
        ax.text(px + ox, py + oy, f"{nm}\nkm {km:.1f}", color=FG, fontsize=13, ha=ha, va="center",
                path_effects=halo(4), linespacing=1.25)
    ax.set_xlim(sext[0], sext[1]), ax.set_ylim(sext[2], sext[3])
    map_axes(ax)
    scalebar(ax, 10, x0f=0.72, extent=sext)
    ax.text(0.97, 0.12, "N ↑", transform=ax.transAxes, color=FG, fontsize=13, ha="right", path_effects=halo())
    tx = 0.71
    L = float(dk[-1])
    fig.text(tx, 0.76, "Flow path", fontsize=17, fontweight="bold", color=CYAN)
    fig.text(tx, 0.725, f"{L:.0f} km", fontsize=36, family="DejaVu Sans Mono", color=FG, va="top")
    fig.text(tx, 0.615, "dam → Medjerda → Sidi Salem", fontsize=13.5, color=MUTED, va="top")
    lines = ["How it is traced", "",
             "1  Terrain: GEM-15 bare-earth model,",
             "    averaged to 30 m.",
             "2  Each cell drains to its steepest",
             "    neighbour (D8).",
             "3  Mapped rivers are burned 2 m in so",
             "    the path follows the real bed.",
             "4  Check: 98.8 % of the path lies within",
             "    300 m of OpenStreetMap rivers."]
    fig.text(tx, 0.55, "\n".join(lines), fontsize=12.5, color=MUTED, va="top", linespacing=1.45)
    credit(fig, f"{CR_GEM}; HydroRIVERS; OpenStreetMap contributors")
    name, size = save(fig, "m08_flow_path", mk)
    return dict(id="m08", file=name, size=size, title="Step 7 · Where does the water go?",
                caption_simple=f"Water runs downhill. Following the slope cell by cell from the dam traces the "
                               f"{L:.0f} km path the released water takes, past Jendouba to the Sidi Salem reservoir.",
                caption_expert=f"D8 steepest descent (pysheds) on GEM-15 (experimental) DTM 15 m block-averaged to 30 m, "
                               f"HydroRIVERS main stem burned −2 m, depressions filled. Path {L:.1f} km; Jendouba "
                               f"km 37.6 (town 4.4 km off the path), Medjerda confluence km 44.9, Bou Salem km 66.8. "
                               f"Test D2: 98.8 % of the path within 300 m of OSM rivers.",
                badge="MODELLED", source=f"{CR_GEM} (doi:10.31223/X55N75); HydroRIVERS v1.0; OpenStreetMap; this project (04_routing_hand.py)")


def _lut(ctx):
    lut = geo(ctx.bundle / "flood/hand_lut.json")
    return lut, pd.DataFrame(lut["rows"])


def _lut_at(rows, v, col):
    return float(np.interp(v, rows.V_m3, rows[col]))


def m09(ctx, mk):
    hand, ext, res = read_tif(ROOT / "work/routing/gem15/hand_30m.tif")
    z, _, _ = read_tif(ROOT / "work/routing/gem15/dem30.tif")
    lut, rows = _lut(ctx)
    h21 = _lut_at(rows, 21e6, "h")
    a21 = _lut_at(rows, 21e6, "area_km2")
    wet = np.isfinite(hand) & (hand < h21)
    a_chk = wet.sum() * res * res / 1e6
    xy, dk, _ = _flow(ctx)
    pad = 5000
    x0, x1 = xy[:, 0].min() - pad, xy[:, 0].max() + pad
    y0, y1 = xy[:, 1].min() - pad, xy[:, 1].max() + pad
    c0, c1 = max(int((x0 - ext[0]) / res), 0), int((x1 - ext[0]) / res)
    r0, r1 = max(int((ext[3] - y1) / res), 0), int((ext[3] - y0) / res)
    sext = (ext[0] + c0 * res, ext[0] + c1 * res, ext[3] - r1 * res, ext[3] - r0 * res)
    hs = hillshade(z[r0:r1, c0:c1], res)
    base = (np.stack([hs] * 3, -1) * 0.32 + 0.04)
    hsub = hand[r0:r1, c0:c1]
    cmap = mcolors.LinearSegmentedColormap.from_list("h", ["#3a4a5c", "#24303d", "#151c25"])
    fig = figure()
    header(fig, "Step 8 · Fill the valley like a bathtub",
           "Height above the river (HAND): how high water must rise to reach each cell.", "MODELLED")
    ax = fig.add_axes([0.02, 0.05, 0.55, 0.8])
    ax.imshow(base, extent=sext, interpolation="bilinear")
    im = ax.imshow(np.where(np.isfinite(hsub), np.clip(hsub, 0, 30), np.nan), cmap=cmap, vmin=0, vmax=30,
                   extent=sext, alpha=0.9, interpolation="nearest")
    over = np.zeros((*hsub.shape, 4))
    over[wet[r0:r1, c0:c1]] = mcolors.to_rgba(AMBER, 1.0)
    ax.imshow(over, extent=sext, interpolation="nearest")
    ax.set_xlim(sext[0], sext[1]), ax.set_ylim(sext[2], sext[3])
    map_axes(ax)
    scalebar(ax, 10, extent=sext)
    ax.legend(handles=[Patch(fc=AMBER, label=f"21 Mm³ spread at h = {h21:.2f} m"),
                       Patch(fc="#3a4a5c", label="corridor: low HAND"),
                       Patch(fc="#151c25", ec="#3a4554", label="corridor: high HAND (≥ 30 m)")],
              loc="upper left", fontsize=12, facecolor=BG, frameon=True, edgecolor="#2a3340", framealpha=0.85)
    ax2 = fig.add_axes([0.64, 0.15, 0.33, 0.62])
    style_axes(ax2, grid_x=True)
    r = rows[rows.V_m3 <= 260e6]
    ax2.plot(r.V_m3 / 1e6, r.h, color=AMBER, lw=2.4)
    for v, lab in [(21e6, "21 Mm³\nJune 2026 (reported)"), (50e6, "50 Mm³"), (195e6, "195 Mm³\nhypothetical")]:
        h = _lut_at(rows, v, "h")
        ax2.plot(v / 1e6, h, "o", ms=9, color=BG, mec=AMBER, mew=2.2, zorder=4)
        ax2.text(v / 1e6 + 6, h - 0.15, f"{lab}\nh {h:.2f} m", fontsize=11.5, color=FG, va="top")
    ax2.set_xlabel("released volume (million m³)")
    ax2.set_ylabel("water height above river (m)")
    ax2.set_xlim(0, 260), ax2.set_ylim(0, 5.6)
    ax2.set_title("Volume → height", pad=10)
    credit(fig, f"{CR_GEM}; HydroRIVERS")
    name, size = save(fig, "m09_hand_bathtub", mk)
    return dict(id="m09", file=name, size=size, title="Step 8 · Fill the valley like a bathtub",
                caption_simple=f"A quick first estimate: spread the released water at one height along the whole "
                               f"valley. 21 million m³ reaches about {h21:.1f} m above the river and covers about "
                               f"{a21:.0f} km². It ignores timing, so it is a screening map, not a forecast.",
                caption_expert=f"HAND = height above the main-stem flow-path cell each cell drains to (D8, GEM-15 30 m), "
                               f"corridor ≤ 5 km, dam → Sidi Salem, reservoirs excluded. V(h) = Σ(h − HAND)·900 m². "
                               f"21 Mm³ → h {h21:.2f} m, {a21:.1f} km² (map: {a_chk:.1f} km²). Static bathtub: no "
                               f"timing or attenuation; HAND ≈ 0 in filled channel reaches makes small volumes wide "
                               f"and shallow.",
                badge="MODELLED", source=f"{CR_GEM}; HydroRIVERS v1.0; this project (04_routing_hand.py)")


def _anuga(sid):
    d, ext, res = read_tif(ROOT / f"work/anuga/{sid}/maxdepth_30m.tif")
    return d, ext, res


def m10(ctx, mk):
    idx = geo(ctx.bundle / "flood/anuga/index.json")["scenarios"]
    z, zext, zres = read_tif(ROOT / "work/routing/gem15/dem30.tif")
    reach, _, _ = read_tif(ROOT / "work/routing/gem15/reach1_30m.tif")
    rr, cc = np.where(reach > 0)
    pad = 60
    r0, r1 = max(rr.min() - pad, 0), rr.max() + pad
    c0, c1 = max(cc.min() - pad, 0), cc.max() + pad
    sext = (zext[0] + c0 * zres, zext[0] + c1 * zres, zext[3] - r1 * zres, zext[3] - r0 * zres)
    hs = hillshade(z[r0:r1, c0:c1], zres)
    base = np.stack([hs] * 3, -1) * 0.3 + 0.03
    bounds = [0.1, 0.25, 0.5, 1, 2, 4, 8, 50]
    cmap = mcolors.ListedColormap(["#0d3b4f", "#11607a", "#1b86a3", "#27a9c4", "#4cc9de", "#93e6f2", "#e3fbff"])
    norm = mcolors.BoundaryNorm(bounds, cmap.N)
    fig = figure()
    header(fig, "Step 9 · Let the water flow (2D model)",
           "ANUGA solves the shallow-water equations over time; the map is the deepest water reached anywhere.",
           "MODELLED")
    xy, dk, breaks = _flow(ctx)
    conf_km = next(b["dist_km"] for b in breaks if b["name"].startswith("Medjerda"))
    stats = {}
    for i, sc in enumerate(sorted(idx, key=lambda s: s["volume_m3"])):
        sid = sc["id"]
        d, ext, res = _anuga(sid)
        st = geo(ctx.bundle / sc["stats"])
        stats[sid] = st
        assert abs(res - zres) < 1e-6 and abs(ext[0] - zext[0]) < 1 and abs(ext[3] - zext[3]) < 1
        sub = d[r0:r1, c0:c1]
        ax = fig.add_axes([0.02 + i * 0.325, 0.17, 0.31, 0.6])
        ax.imshow(base, extent=sext, interpolation="bilinear")
        im = ax.imshow(np.where(sub > 0.1, sub, np.nan), cmap=cmap, norm=norm, extent=sext, interpolation="nearest")
        m = xy[:, 1] > 0
        ax.plot(xy[m, 0], xy[m, 1], color=FG, lw=0.6, alpha=0.35)
        ax.set_xlim(sext[0], sext[1]), ax.set_ylim(sext[2], sext[3])
        map_axes(ax)
        v = sc["volume_m3"] / 1e6
        tag = "June 2026 reconstruction" if v < 25 else ("hypothetical" if v > 100 else "scenario")
        ax.set_title(f"{v:.0f} Mm³", fontsize=20, pad=26)
        ax.text(0, 1.012, tag, transform=ax.transAxes, color=MUTED, fontsize=12.5, va="bottom")
        arr = st["arrival_h"].get("Medjerda confluence")
        arr_s = "13–19 h" if sid == "v21_d12" else f"≈ {arr:.0f} h"
        ax.text(0.03, 0.97, f"wet {st['inundated_km2']:.1f} km²\nconfluence {arr_s}" if arr else
                f"wet {st['inundated_km2']:.1f} km²", transform=ax.transAxes, color=FG, fontsize=12.5, va="top",
                family="DejaVu Sans Mono", path_effects=halo(3), linespacing=1.4)
        if i == 0:
            scalebar(ax, 5, extent=sext)
    cax = fig.add_axes([0.03, 0.085, 0.4, 0.02])
    cb = fig.colorbar(matplotlib.cm.ScalarMappable(norm=norm, cmap=cmap), cax=cax, orientation="horizontal",
                      spacing="uniform")
    cb.set_ticks([0.1, 0.25, 0.5, 1, 2, 4, 8])
    cb.set_ticklabels(["0.1", "0.25", "0.5", "1", "2", "4", "≥ 8 m"])
    cb.outline.set_visible(False)
    cb.ax.tick_params(labelsize=11, colors=MUTED, length=0)
    fig.text(0.03, 0.118, "maximum water depth", fontsize=12, color=MUTED)
    fig.text(0.97, 0.1, "Mesh: 69,616 triangles ≤ 2,500 m²\ndam → Medjerda confluence (Reach 1) · 12 h release",
             fontsize=11.5, color=MUTED, ha="right", va="center", linespacing=1.4)
    credit(fig, f"ANUGA (GA/ANU); {CR_GEM}; ESA WorldCover")
    name, size = save(fig, "m10_anuga_depth", mk)
    a = {k: v["arrival_h"].get("Medjerda confluence") for k, v in stats.items()}
    w = {k: v["inundated_km2"] for k, v in stats.items()}
    return dict(id="m10", file=name, size=size, title="Step 9 · Let the water flow (2D model)",
                caption_simple="A flood model lets the water move over the terrain hour by hour. For the June 2026 "
                               "volume it shows where the water could spread and roughly when it reaches the Medjerda "
                               "(13–19 hours). These are scenarios, not forecasts.",
                caption_expert=f"ANUGA 4.2.0 (DE0), 69,616 triangles ≤ 2,500 m², GEM-15 30 m with flow path lowered 2 m, "
                               f"Manning n from WorldCover, triangular 12 h release at the dam, 48 h simulated, wet > "
                               f"0.1 m. Wet 21/50/195 Mm³: {w['v21_d12']:.1f} / {w['v50_d12']:.1f} / "
                               f"{w['v195_d12']:.1f} km²; confluence arrival {a['v21_d12']:.1f} / {a['v50_d12']:.1f} / "
                               f"{a['v195_d12']:.1f} h. Mesh-sensitive (test E4): report arrival as 13–19 h. 195 Mm³ is "
                               f"hypothetical. No bathymetry, no calibration.",
                badge="MODELLED", source=f"ANUGA (Geoscience Australia / ANU); {CR_GEM}; ESA WorldCover 2021; this project (05_anuga_scenarios.py)")


def m11(ctx, mk):
    imp = geo(ctx.bundle / "impacts/impacts.json")["scenarios"]
    _, rows = _lut(ctx)
    vols = [(21e6, "v21_d12"), (50e6, "v50_d12"), (195e6, "v195_d12")]
    metrics = [("cropland_ha", "Cropland (ha)"), ("buildings", "Buildings (OSM)"), ("road_km", "Roads (km)"),
               ("population", "People (WorldPop)")]
    fig = figure()
    header(fig, "Step 10 · What lies in the water's way?",
           "Exposure inside each flood footprint. Exposure ≠ damage: a field under 10 cm counts like one under 5 m.",
           "MODELLED")
    for i, (key, lab) in enumerate(metrics):
        ax = fig.add_axes([0.06 + i * 0.237, 0.17, 0.19, 0.6])
        style_axes(ax)
        xs = np.arange(3)
        hv = [_lut_at(rows, v, key) for v, _ in vols]
        av = [imp[s].get(key) for _, s in vols]
        ax.bar(xs - 0.2, hv, 0.38, color=AMBER, label="HAND bathtub")
        ax.bar(xs + 0.2, [a if a is not None else 0 for a in av], 0.38, color=TEAL, label="ANUGA 2D")
        top = max(hv + [a or 0 for a in av]) * 1.18
        for x, a in zip(xs, av):
            if a is None:
                ax.text(x + 0.2, top * 0.02, "not\ncomputed", rotation=90, fontsize=10, color=MUTED, ha="center",
                        va="bottom")
        for x, hval, a in zip(xs, hv, av):
            fmt = (lambda q: f"{q:,.0f}")
            ax.text(x - 0.2, hval + top * 0.015, fmt(hval), ha="center", va="bottom", fontsize=9.5, color=AMBER,
                    rotation=90)
            if a is not None:
                ax.text(x + 0.2, a + top * 0.015, fmt(a), ha="center", va="bottom", fontsize=9.5, color=TEAL,
                        rotation=90)
        ax.set_ylim(0, top * 1.22)
        ax.set_xticks(xs)
        ax.set_xticklabels(["21", "50", "195*"])
        ax.set_xlabel("volume (Mm³)", fontsize=12)
        ax.set_title(lab, fontsize=15)
        ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda x, _: f"{x:,.0f}"))
    fig.legend(handles=[Patch(fc=AMBER, label="HAND bathtub · whole valley dam → Sidi Salem (101 km)"),
                        Patch(fc=TEAL, label="ANUGA 2D · Reach 1 dam → Medjerda confluence (45 km)")],
               loc="lower left", bbox_to_anchor=(0.05, 0.035), ncol=2, fontsize=12.5)
    fig.text(0.97, 0.045, "* 195 Mm³ is hypothetical", fontsize=11.5, color=MUTED, ha="right")
    credit(fig, "ESA WorldCover 2021; OpenStreetMap contributors; WorldPop 2020; GEM-15 (Google)")
    name, size = save(fig, "m11_exposure", mk)
    h = {s: {k: _lut_at(rows, v, k) for k, _ in metrics} for v, s in vols}
    return dict(id="m11", file=name, size=size, title="Step 10 · What lies in the water's way?",
                caption_simple="We count the fields, buildings, roads and people inside each flood footprint. This is "
                               "exposure, not damage, and the two models cover different stretches of the valley.",
                caption_expert=f"HAND values interpolated from flood/hand_lut.json at V (whole 101 km corridor, static); "
                               f"ANUGA from impacts/impacts.json (Reach 1 only, max depth > 0.1 m). 21 Mm³: cropland "
                               f"HAND {h['v21_d12']['cropland_ha']:,.0f} ha vs ANUGA {imp['v21_d12']['cropland_ha']:,.0f} "
                               f"ha. Population is not computed for ANUGA. OSM buildings/roads are incomplete (lower "
                               f"bounds); WorldPop is itself a model.",
                badge="MODELLED", source="ESA WorldCover 2021; OpenStreetMap contributors; WorldPop 2020; this project (04, 06)")


# ================================================================================================ V2 preview
def v01(ctx, mk):
    z, ext, res = read_tif(ROOT / "work/routing/gem15/dem30.tif")
    acc, _, _ = read_tif(ROOT / "work/routing/gem15/acc_30m.tif")
    rgb = terrain_rgb(z, res)
    km2 = acc * res * res / 1e6
    xy, dk, _ = _flow(ctx)
    corr = geo(ctx.bundle / "vectors/corridor.geojson")["features"][0]["geometry"]
    fig = figure()
    header(fig, "V2 preview · Rivers found from terrain alone",
           "Drainage network and flood corridor computed automatically from a 30 m terrain model.", "MODELLED")
    ax = fig.add_axes([0.03, 0.04, 0.68, 0.82])
    ax.imshow(rgb, extent=ext, interpolation="bilinear")
    from scipy import ndimage as ndi
    lvl = np.log10(np.clip(np.nan_to_num(km2, nan=0), 1, None))
    lvl = np.where(km2 >= 10, lvl, 0)
    lvl = ndi.grey_dilation(lvl, size=(3, 3))            # thicken 1-cell channels so they survive downsampling
    net = np.where(lvl >= 1, lvl, np.nan)
    cm = mcolors.LinearSegmentedColormap.from_list("n", ["#2a7f9e", "#3cc0dc", CYAN])
    ax.imshow(net, cmap=cm, vmin=1, vmax=3.5, extent=ext, interpolation="antialiased", alpha=0.95)
    for ring in coords_of(corr):
        ax.plot(ring[:, 0], ring[:, 1], color=AMBER, lw=1.1, alpha=0.9)
    ax.plot(xy[:, 0], xy[:, 1], color=FG, lw=1.8)
    dx, dy = xy[0]
    ax.plot(dx, dy, "v", ms=12, color=FG, mec=BG)
    ax.text(dx - 1500, dy - 2500, "Mellègue dam", color=FG, fontsize=13, ha="right", path_effects=halo(4))
    ex, ey = xy[-1]
    ax.text(ex - 1000, ey + 2500, "Sidi Salem", color=FG, fontsize=13, ha="right", path_effects=halo(4))
    ax.set_xlim(ext[0], ext[1]), ax.set_ylim(ext[2], ext[3])
    map_axes(ax)
    scalebar(ax, 10, extent=ext)
    tx = 0.74
    fig.text(tx, 0.78, "What V2 automates", fontsize=17, fontweight="bold", color=FG)
    items = [(CYAN, "Drainage network", "every cell draining ≥ 10 km²,\nbrighter = larger river"),
             (FG, "Downstream path", f"dam → Sidi Salem, {dk[-1]:.0f} km"),
             (AMBER, "Flood corridor", "5 km either side, used for HAND")]
    y = 0.71
    for col, t, d in items:
        fig.text(tx, y, "■", color=col, fontsize=16, va="top")
        fig.text(tx + 0.025, y, t, color=FG, fontsize=14, va="top", fontweight="bold")
        fig.text(tx + 0.025, y - 0.04, d, color=MUTED, fontsize=12.5, va="top", linespacing=1.4)
        y -= 0.15
    fig.text(tx, 0.22, "Today: one dam, run offline.\nV2: any dam, same steps.", color=MUTED, fontsize=13,
             va="top", linespacing=1.5)
    credit(fig, f"{CR_GEM}; HydroRIVERS")
    name, size = save(fig, "v01_river_network", mk)
    return dict(id="v01", file=name, size=size, title="V2 preview · Rivers found from terrain alone",
                caption_simple="V2 preview: from a terrain model alone, the computer finds the rivers, the path the "
                               "water would take below a dam and the corridor to check for flooding.",
                caption_expert=f"V2 preview. D8 flow accumulation (pysheds) on GEM-15 30 m: cells with contributing "
                               f"area ≥ 10 km² (colour = log area); main-stem path {dk[-1]:.1f} km dam → Sidi Salem; "
                               f"HAND corridor ≤ 5 km. Computed for Mellègue only; generalisation to other dams is "
                               f"roadmap work.",
                badge="MODELLED", source=f"{CR_GEM}; HydroRIVERS v1.0; this project (04_routing_hand.py)")


def v02(ctx, mk):
    cat = geo(ctx.bundle / "vectors/catchment.geojson")["features"]
    bas = geo(ctx.bundle / "vectors/basins.geojson")["features"]
    bor = geo(ctx.bundle / "vectors/border.geojson")["features"]
    dams = geo(ctx.bundle / "vectors/dams.geojson")["features"]
    xy, _, _ = _flow(ctx)
    ss = next(f for f in dams if (f["properties"].get("name_fr") or "") == "Barrage Sidi Salem")
    me = next(f for f in dams if (f["properties"].get("name_fr") or "") == "Barrage Mellègue")
    fig = figure()
    header(fig, "V2 preview · Any dam, its catchment, automatically",
           "Everything upstream that drains into each dam, assembled from HydroBASINS sub-basins.", "MODELLED")
    ax = fig.add_axes([0.03, 0.04, 0.64, 0.82])
    ax.set_facecolor(BG)
    allx, ally = [], []
    for f in bas:
        for r in coords_of(f["geometry"]):
            ax.plot(r[:, 0], r[:, 1], color="#222c38", lw=0.7)
    styles = {"sidi_salem": (VIOLET, 0.10), "mellegue": (CYAN, 0.22)}
    order = sorted(cat, key=lambda f: -f["properties"]["area_km2"])
    for f in order:
        col, al = styles.get(f["properties"]["id"], (FG, 0.1))
        for r in coords_of(f["geometry"]):
            ax.fill(r[:, 0], r[:, 1], color=col, alpha=al, lw=0)
            ax.plot(r[:, 0], r[:, 1], color=col, lw=1.6)
            allx += [r[:, 0].min(), r[:, 0].max()]
            ally += [r[:, 1].min(), r[:, 1].max()]
    for f in bor:
        for r in coords_of(f["geometry"]):
            ax.plot(r[:, 0], r[:, 1], color=FG, lw=1.1, ls=(0, (5, 3)), alpha=0.7)
    ax.plot(xy[:, 0], xy[:, 1], color=FG, lw=1.6)
    for f, nm, off in [(me, "Mellègue dam", (5000, -9000)), (ss, "Sidi Salem dam", (4000, 6000))]:
        x, y = f["geometry"]["coordinates"]
        ax.plot(x, y, "o", ms=11, color=BG, mec=FG, mew=2.2, zorder=5)
        ax.text(x + off[0], y + off[1], nm, color=FG, fontsize=13.5, ha="right" if off[0] < 0 else "left",
                path_effects=halo(4))
    pad = 15000
    x0, x1, y0, y1 = min(allx) - pad, max(allx) + pad, min(ally) - pad, max(ally) + pad
    # 64:82 axes aspect at 16:9 → keep equal scaling
    ax.set_xlim(x0, x1), ax.set_ylim(y0, y1)
    ax.set_aspect("equal")
    map_axes(ax)
    scalebar(ax, 50, extent=(x0, x1, y0, y1))
    bx = (x0 + x1) / 2
    ax.text(0.30, 0.12, "ALGERIA", transform=ax.transAxes, color=MUTED, fontsize=13, alpha=0.8)
    ax.text(0.80, 0.12, "TUNISIA", transform=ax.transAxes, color=MUTED, fontsize=13, alpha=0.8)
    del bx
    a_m = next(f["properties"]["area_km2"] for f in cat if f["properties"]["id"] == "mellegue")
    a_s = next(f["properties"]["area_km2"] for f in cat if f["properties"]["id"] == "sidi_salem")
    tx = 0.71
    fig.text(tx, 0.76, "Mellègue dam catchment", fontsize=14, color=CYAN, fontweight="bold")
    fig.text(tx, 0.725, f"{a_m:,.0f} km²", fontsize=32, family="DejaVu Sans Mono", color=FG, va="top")
    fig.text(tx, 0.57, "Sidi Salem dam catchment", fontsize=14, color=VIOLET, fontweight="bold")
    fig.text(tx, 0.535, f"{a_s:,.0f} km²", fontsize=32, family="DejaVu Sans Mono", color=FG, va="top")
    fig.text(tx, 0.4, "Much of the Mellègue catchment lies\nin Algeria: rain there reaches this dam.\n\n"
             "Grey lines: HydroBASINS level 6.\nDashed: international border.", fontsize=12.5, color=MUTED, va="top",
             linespacing=1.45)
    credit(fig, "HydroSHEDS / HydroBASINS; OpenStreetMap contributors; GEM-15 (Google)")
    name, size = save(fig, "v02_catchment", mk)
    return dict(id="v02", file=name, size=size, title="V2 preview · Any dam, its catchment, automatically",
                caption_simple=f"V2 preview: for any dam, find all the land whose rain flows into it. The Mellègue "
                               f"dam collects water from {a_m:,.0f} km², much of it across the border in Algeria.",
                caption_expert=f"V2 preview. Each catchment = union of HydroBASINS level-12 sub-basins upstream of the "
                               f"HydroRIVERS main-stem reach nearest the dam point: Mellègue {a_m:,.1f} km², Sidi Salem "
                               f"{a_s:,.1f} km² (00_context_data.py), drawn over HydroBASINS level 6. Dam points from "
                               f"OpenStreetMap; flow path from GEM-15 D8.",
                badge="MODELLED", source="HydroSHEDS/HydroBASINS; OpenStreetMap contributors; this project (00_context_data.py)")


def v03(ctx, mk):
    from pyproj import Transformer
    tr = Transformer.from_crs(4326, 32632, always_xy=True)
    bx0, by0 = tr.transform(8.62, 36.24)
    bx1, by1 = tr.transform(8.63, 36.25)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    half_w, half_h = 3200, 2400
    dates = ["2026-04-07", "2026-11-13"]
    imgs = []
    for d in dates:
        z = np.load(ROOT / f"work/upper_mellegue/s2_{d}.npz", allow_pickle=True)
        t = z["transform"]
        res, x0, y0 = t[0], t[2], t[5]
        c0, c1 = int((cx - half_w - x0) / res), int((cx + half_w - x0) / res)
        r0, r1 = int((y0 - (cy + half_h)) / res), int((y0 - (cy - half_h)) / res)
        rgb = np.stack([z[b][r0:r1, c0:c1] for b in ("B04", "B03", "B02")], -1).astype(np.float32)
        scl = z["SCL"][r0:r1, c0:c1]
        imgs.append((rgb, scl, (x0 + c0 * res, x0 + c1 * res, y0 - r1 * res, y0 - r0 * res), list(z["ids"])))
    allv = np.concatenate([i[0][np.isfinite(i[0])].ravel() for i in imgs])
    lo, hi = np.percentile(allv, [1, 99.3])
    fig = figure()
    header(fig, "V2 preview · Watching a site upstream",
           "Sentinel-2 true colour around 8.62–8.63 E, 36.24–36.25 N, upstream of the Mellègue reservoir.",
           "ILLUSTRATIVE")
    for i, ((rgb, scl, ext, ids), d) in enumerate(zip(imgs, dates)):
        ax = fig.add_axes([0.03 + i * 0.48, 0.1, 0.455, 0.72])
        img = np.clip((rgb - lo) / (hi - lo), 0, 1) ** 0.8
        ax.imshow(img, extent=ext, interpolation="lanczos")
        ax.add_patch(Rectangle((bx0, by0), bx1 - bx0, by1 - by0, fill=False, ec=MAGENTA, lw=2, ls=(0, (4, 3))))
        ax.set_xlim(ext[0], ext[1]), ax.set_ylim(ext[2], ext[3])
        map_axes(ax)
        ax.set_title(short_date(d), pad=10)
        ax.text(0.015, 0.975, "UNCONFIRMED", transform=ax.transAxes, color=MAGENTA, fontsize=12, va="top",
                family="DejaVu Sans Mono", fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.35", fc=BG, ec=MAGENTA, lw=1))
        scalebar(ax, 1, extent=ext)
        cloud = np.isin(scl, [8, 9, 10]).mean() * 100
        if cloud >= 1:
            ax.text(0.985, 0.975, f"cloud {cloud:.0f} %", transform=ax.transAxes, color=FG, fontsize=11.5,
                    ha="right", va="top", path_effects=halo())
    fig.text(0.03, 0.045, "Dashed box: candidate construction site for the planned Upper Mellègue dam, spotted by eye. "
             "Not confirmed by any official source.", fontsize=12.5, color=MUTED)
    credit(fig, "ESA Copernicus Sentinel-2 L2A via Microsoft Planetary Computer")
    name, size = save(fig, "v03_upper_mellegue_watch", mk)
    return dict(id="v03", file=name, size=size, title="V2 preview · Watching a site upstream",
                caption_simple="V2 preview: satellites can also keep an eye on changes upstream. This box marks a "
                               "possible construction site for the planned Upper Mellègue dam. It is unconfirmed.",
                caption_expert="V2 preview. Sentinel-2 L2A true colour (B4/B3/B2, 10 m, common 1–99.3 % stretch), "
                               "7 Apr vs 13 Nov 2026, tile T32SME/SMF. Box 8.62–8.63 E, 36.24–36.25 N flagged by visual "
                               "inspection only; no detection algorithm, no official confirmation.",
                badge="ILLUSTRATIVE", source="ESA Copernicus Sentinel-2 L2A (Microsoft Planetary Computer); visual inspection (this project)")


def v04(ctx, mk):
    inv = pd.read_csv(ROOT / "TESTS/nisar_tunisia_output/inventory.csv")
    sites = pd.read_csv(ROOT / "TESTS/nisar_tunisia_output/sites_coverage.csv")
    mel = sites[sites.site.str.contains("Mellegue") & (sites["product"] == "GCOV")].iloc[0]
    mdates = set(x.strip() for x in mel.dates.split(","))
    n_tot = inv.sceneName.nunique()
    per = inv.groupby(["date", "product"]).sceneName.nunique().unstack(fill_value=0)
    per.index = pd.to_datetime(per.index)
    full = pd.date_range(per.index.min(), per.index.max())
    per = per.reindex(full, fill_value=0)
    prods = [p for p in ["GCOV", "GSLC", "RSLC", "GUNW", "SME2"] if p in per.columns]
    cols = {"GCOV": CYAN, "GSLC": "#2e9fbf", "RSLC": "#1d5f7a", "GUNW": VIOLET, "SME2": "#6b7a8c"}
    fig = figure()
    header(fig, "V2 preview · How often NISAR looks at Tunisia",
           f"{n_tot:,} NISAR products over Tunisia, {inv.date.min()} → {inv.date.max()} (ASF catalogue).", "MEASURED")
    ax = fig.add_axes([0.065, 0.25, 0.9, 0.55])
    style_axes(ax)
    bottom = np.zeros(len(per))
    for p in prods:
        ax.bar(per.index, per[p].values, bottom=bottom, width=0.85, color=cols[p], label=p, lw=0)
        bottom += per[p].values
    md = pd.to_datetime(sorted(mdates))
    axm = fig.add_axes([0.065, 0.09, 0.9, 0.045])
    axm.set_facecolor(BG)
    axm.vlines(md, 0, 1, color=MAGENTA, lw=2.2)
    axm.set_ylim(0, 1)
    axm.set_xlim(*ax.get_xlim())
    map_axes(axm)
    fig.text(0.065, 0.145, f"NISAR GCOV over the Mellègue dam: {len(md)} dates", color=MAGENTA, fontsize=12.5)
    ax.set_ylim(0, bottom.max() * 1.12)
    ax.set_ylabel("products per day")
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%b"))
    ax.xaxis.set_major_locator(matplotlib.dates.MonthLocator())
    ax.legend(loc="upper right", ncol=5, bbox_to_anchor=(1, 1.1), fontsize=12)
    credit(fig, "NISAR (NASA-ISRO) catalogue, ASF DAAC")
    name, size = save(fig, "v04_nisar_coverage", mk)
    counts = inv.groupby("product").sceneName.nunique().to_dict()
    k = int(np.argmax(np.diff(md.values)))
    gap_a, gap_b = md[k].strftime("%Y-%m-%d"), md[k + 1].strftime("%Y-%m-%d")
    return dict(id="v04", file=name, size=size, title="V2 preview · How often NISAR looks at Tunisia",
                caption_simple=f"V2 preview: NISAR delivered {n_tot:,} products over Tunisia in its first months, and "
                               f"imaged the Mellègue dam on {len(md)} different dates.",
                caption_expert=f"V2 preview. ASF catalogue search over Tunisia: {n_tot:,} unique NISAR products (L1 RSLC, L2 GSLC/GCOV/GUNW, L3 SME2) "
                               f"{inv.date.min()} → {inv.date.max()} ("
                               + ", ".join(f"{k} {v}" for k, v in sorted(counts.items()))
                               + f"); GCOV over the Mellègue dam on {len(md)} dates ({mel.tracks_frames}); longest "
                               f"gap {gap_a} → {gap_b}.",
                badge="MEASURED", source="NASA/JPL–ISRO NISAR product catalogue (ASF DAAC search, TESTS/nisar_tunisia_output)")


FIGS = [("m01", m01), ("m02", m02), ("m03", m03), ("m04", m04), ("m05", m05), ("m06", m06), ("m07", m07),
        ("m08", m08), ("m09", m09), ("m10", m10), ("m11", m11), ("v01", v01), ("v02", v02), ("v03", v03),
        ("v04", v04)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=ROOT / "config.yaml")
    ap.add_argument("--only", default="", help="comma-separated ids to (re)draw; figures.json keeps the others")
    ap.add_argument("--max-kb", type=float, default=250)
    args = ap.parse_args()
    cfg = common.load_config(args.config)
    OUT.mkdir(parents=True, exist_ok=True)
    ctx = Ctx(cfg)
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    idx_path = OUT / "figures.json"
    prev = {f["id"]: f for f in json.loads(idx_path.read_text("utf-8"))} if (only and idx_path.exists()) else {}
    out, skipped = [], []
    for fid, fn in FIGS:
        if only and fid not in only:
            if fid in prev:
                out.append(prev[fid])
            continue
        print(f"[{fid}]")
        try:
            rec = fn(ctx, args.max_kb)
        except FileNotFoundError as e:
            print(f"  SKIPPED: missing input {e}")
            skipped.append(fid)
            continue
        w, h = rec.pop("size")
        rec.update(group="tutorial" if fid.startswith("m") else "v2", width=w, height=h)
        out.append({k: rec[k] for k in ("id", "file", "title", "caption_simple", "caption_expert", "badge", "source",
                                        "group", "width", "height")})
    idx_path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", "utf-8")
    listed = {f["file"] for f in out}
    for f in OUT.glob("*.webp"):
        if f.name not in listed:
            f.unlink()
    total = sum(f.stat().st_size for f in OUT.iterdir() if f.is_file()) / 1024
    print(f"{len(out)} figures, {total:.0f} KB total in {OUT}" + (f"; skipped {skipped}" if skipped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
