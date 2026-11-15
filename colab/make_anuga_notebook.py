#!/usr/bin/env python3
"""Generate colab/anuga_gpu_all_dams.ipynb (reviewable source of the notebook).

  python colab/make_anuga_notebook.py

The notebook embeds pipeline/v2/anuga_run.py verbatim (%%writefile), so a package zip + the notebook is all a Colab or
Kaggle session needs. Platform-agnostic (Colab: Drive; Kaggle: attached dataset + /kaggle/working), shardable.
"""
from __future__ import annotations

from pathlib import Path

import nbformat as nbf

ROOT = Path(__file__).resolve().parents[1]
RUNNER = (ROOT / "pipeline/v2/anuga_run.py").read_text("utf-8")
cells = []


def md(s):
    cells.append(nbf.v4.new_markdown_cell(s.strip("\n")))


def code(s):
    cells.append(nbf.v4.new_code_cell(s.strip("\n")))


md("""
# Dancing with the Rivers: ANUGA dam-release scenarios on GPU (all dams)

**MODELLED. Scenario exploration, not a forecast. 30 m terrain.** The volumes (5 / 20 / 100 Mm³, 12 h triangular
release) are *screening* values, not reported events. ANUGA (GPL) runs here, offline; nothing of it ships in the web app.

What this notebook does, on **Google Colab or Kaggle** (detected automatically):

1. checks the GPU (`nvidia-smi`);
2. installs the NVIDIA HPC SDK from NVIDIA's apt repository and builds **ANUGA 4.2.0 from source with `nvc` and
   `-Dgpu_offload=true`** (flags taken from ANUGA's own `meson_options.txt` and `tools/install_anuga_nvc.sh`), then caches
   the wheel plus the NVHPC runtime libraries so later sessions skip the ~30–40 min build;
3. reads the dam packages (`<dam>.zip`, made by `pipeline/v2/anuga_package.py`);
4. runs a small **CPU-vs-GPU consistency test** before any real run;
5. runs every (dam, scenario) of the shard, with progress, wall time and resume-if-done;
6. writes one results zip per run (each with its own `run.json`), so results from Colab and Kaggle merge without
   conflicts in `pipeline/v2/anuga_ingest.py`.

> **The GPU build is untested by us.** We verified the GPU code paths exist in ANUGA 4.2.0 (`set_gpu_offload`,
> `set_compute_mode('unified')`, GPU `Inlet_operator`) and ran the same runner on CPU in Docker. The consistency test in
> step 4 is the guard: if it fails, use the CPU fallback below.
""")

md("""
## Platform notes

**Colab.** Runtime → Change runtime type → GPU (T4 is fine; L4/A100 faster). Upload the package zips to
`MyDrive/dwr_anuga/packages/`. Results go to `MyDrive/dwr_anuga/results/<dam>/<scenario>/`. The built wheel is cached in
`MyDrive/dwr_anuga/wheels/`. Free sessions disconnect after a few hours: just re-run all cells; finished runs are skipped.

**Kaggle.** Settings → Accelerator **GPU T4 ×2** (preferred) or P100; **Internet ON** (needs a phone-verified account) —
apt and pip need it. Add the package zips as a dataset named **`dwr-anuga-packages`** (Add data → Upload →
the zips); they appear in `/kaggle/input/dwr-anuga-packages/`. Results are written to `/kaggle/working/results/`: download
them from the notebook's **Output** tab (or "Save Version" → output). To skip the build next time: after the first
session, download `/kaggle/working/wheels/` from Output, upload it as a dataset named **`dwr-anuga-wheel`**, and attach it;
the build cell then finds it in `/kaggle/input/dwr-anuga-wheel/`. Kaggle sessions stop at 12 h and the weekly GPU quota
is ~30 h: give Kaggle the long runs (see the split helper). One ANUGA process uses one GPU; on T4 ×2 the loop runs two
scenarios at a time (one per GPU) when `PARALLEL_GPUS = True`.

**P100 (compute capability 6.0).** CUDA 13 dropped Pascal, so the build cell then installs the `cuda-multi` SDK and
builds with `-Dgpu_arch=cuda12.9,cc60`. This is the least tested path: prefer T4.
""")

md("""
## CPU fallback (`--mode cpu`)

If the GPU build fails, or the consistency test does not pass, set `MODE = "cpu"` below: the same runner then uses
ANUGA's **'unified' compute mode on the CPU** (the C Runge–Kutta loop, OpenMP threads, no device), with the stock pip
wheel `anuga==4.2.0` (no SDK, no build). `--mode legacy` is the v1 behaviour (Python evolve loop).

Expected CPU time: v1 measured 33–48 min for 69,616 triangles over 48 h simulated on 4 threads. These domains are larger
(see `est_triangles` / `est_cpu_h` in each `scenarios.json`): roughly **2–10 h per scenario** on Colab's 2 vCPUs, so on CPU
run only the fine `s20_d12` + its coarse E4 pair per dam first.
""")

code("""
# ---- settings (edit) --------------------------------------------------------------------------
SHARD = "all"            # "all", or an explicit list, e.g. [("sidi-salem", "s100_d12"), ("el-aroussia", "s20_d12")]
MODE = "gpu"             # "gpu" | "cpu" (unified on CPU, stock wheel) | "legacy"
ANUGA_TAG = "4.2.0"
NVHPC_VERSION = "25-9"   # ANUGA's validated SDK (docker/Dockerfile.gpu.slim: nvhpc 25.9)
PARALLEL_GPUS = True     # Kaggle T4 x2: run two scenarios at once, one per GPU
FORCE_REBUILD = False
SKIP_CONSISTENCY_TEST = False
""")

code("""
# ---- platform + paths -------------------------------------------------------------------------
import os, sys, json, glob, shutil, subprocess, time, zipfile, pathlib
# Kaggle images ship the google.colab package too, so "import google.colab" is NOT a Colab test.
# Kaggle sets KAGGLE_KERNEL_RUN_TYPE and has /kaggle/input; Colab has /var/colab/hostname (what
# drive.mount itself checks) and COLAB_RELEASE_TAG. Kaggle is decided first.
ON_KAGGLE = bool(os.environ.get("KAGGLE_KERNEL_RUN_TYPE")) or os.path.exists("/kaggle/input")
ON_COLAB = (not ON_KAGGLE) and (os.path.exists("/var/colab/hostname") or bool(os.environ.get("COLAB_RELEASE_TAG")))
print("platform:", "kaggle" if ON_KAGGLE else "colab" if ON_COLAB else "local")
if ON_COLAB:
    from google.colab import drive
    drive.mount("/content/drive")
    BASE = pathlib.Path("/content/drive/MyDrive/dwr_anuga")
    PKG_SRC = BASE / "packages"
    RESULTS = BASE / "results"
    WHEELS = BASE / "wheels"
    WHEEL_SRC = [WHEELS]
    WORK = pathlib.Path("/content/dwr")
elif ON_KAGGLE:
    PKG_SRC = pathlib.Path("/kaggle/input/dwr-anuga-packages")
    RESULTS = pathlib.Path("/kaggle/working/results")
    WHEELS = pathlib.Path("/kaggle/working/wheels")
    WHEEL_SRC = [pathlib.Path("/kaggle/input/dwr-anuga-wheel"), WHEELS]
    WORK = pathlib.Path("/kaggle/temp/dwr") if os.path.exists("/kaggle/temp") else pathlib.Path("/tmp/dwr")
else:
    BASE = pathlib.Path.cwd() / "dwr_anuga"
    PKG_SRC, RESULTS, WHEELS = BASE / "packages", BASE / "results", BASE / "wheels"
    WHEEL_SRC = [WHEELS]
    WORK = BASE / "work"
for p in (RESULTS, WHEELS, WORK):
    p.mkdir(parents=True, exist_ok=True)
PLATFORM = "colab" if ON_COLAB else "kaggle" if ON_KAGGLE else "local"
print(PLATFORM, "| packages:", PKG_SRC, "| results:", RESULTS, "| wheels:", WHEELS)
print(sorted(str(p.relative_to(PKG_SRC)) for p in PKG_SRC.rglob("*") if p.suffix == ".zip" or p.name == "scenarios.json") if PKG_SRC.exists() else f"{PKG_SRC} not found (will search /kaggle/input)")
""")

md("## (a) GPU check")
code("""
!nvidia-smi
q = subprocess.run(["nvidia-smi", "--query-gpu=name,compute_cap,driver_version", "--format=csv,noheader"],
                   capture_output=True, text=True)
GPUS = [l.split(", ") for l in q.stdout.strip().splitlines()] if q.returncode == 0 else []
print("GPUs:", GPUS)
if MODE == "gpu":
    assert GPUS, "No GPU visible: switch the runtime to GPU, or set MODE = 'cpu'"
    CC = GPUS[0][1].replace(".", "")
    smi = subprocess.run(["nvidia-smi"], capture_output=True, text=True).stdout
    CUDA_DRIVER = smi.split("CUDA Version:")[1].split()[0] if "CUDA Version:" in smi else "12.0"
    # CUDA 13 dropped compute capability < 7.5 (P100 = 6.0); a 12.x driver also needs a 12.x build
    USE_CUDA12 = int(CC) < 75 or CUDA_DRIVER.startswith("12")
    GPU_ARCH = f"cuda12.9,cc{CC}" if USE_CUDA12 else f"cc{CC}"
    NVHPC_PKG = f"nvhpc-{NVHPC_VERSION}-cuda-multi" if USE_CUDA12 else f"nvhpc-{NVHPC_VERSION}"
    print(f"compute capability {CC}, driver CUDA {CUDA_DRIVER} -> -Dgpu_arch={GPU_ARCH}, apt package {NVHPC_PKG}")
""")

md("""
## (b) Install the NVIDIA HPC SDK and build ANUGA 4.2.0 with GPU offload (cached)

Build command, from ANUGA's `tools/install_anuga_nvc.sh` / `docker/Dockerfile.gpu.slim`:
`CC=nvc CFLAGS=-tp=haswell pip wheel --no-build-isolation -Csetup-args=-Dgpu_offload=true -Csetup-args=-Dgpu_arch=<arch>`
(`-tp=haswell` keeps the cached wheel portable across Colab/Kaggle host CPUs). The SDK download is ~4.5 GB
(~9 GB for `cuda-multi`). The NVHPC redistributable runtime libraries (`REDIST/compilers/lib`, e.g. libnvomp) are cached
next to the wheel: ANUGA runs in a subprocess with them on `LD_LIBRARY_PATH`.
""")
code("""
PYTAG = f"cp{sys.version_info.major}{sys.version_info.minor}"
KEY = f"anuga-{ANUGA_TAG}-gpu-{GPU_ARCH.replace(',', '_')}-{PYTAG}" if MODE == "gpu" else None
REDIST = pathlib.Path("/opt/nvhpc-redist")
RUN_ENV = dict(os.environ)

def find_cached():
    for d in WHEEL_SRC:
        whl = sorted(d.glob(f"{KEY}/anuga-*.whl")) if d.exists() else []
        if whl and (whl[0].parent / "nvhpc-redist.tar.gz").exists():
            return whl[0]
    return None

def sh(cmd):
    print("+", cmd)
    subprocess.run(cmd, shell=True, check=True)

if MODE == "gpu":
    cached = None if FORCE_REBUILD else find_cached()
    if cached is None:
        t0 = time.time()
        sh("curl -fsSL https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK | "
           "gpg --dearmor --yes -o /usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg")
        sh("echo 'deb [signed-by=/usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg] "
           "https://developer.download.nvidia.com/hpc-sdk/ubuntu/amd64 /' > /etc/apt/sources.list.d/nvhpc.list")
        sh(f"apt-get update -y -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq {NVHPC_PKG}")
        NVC = sorted(glob.glob(f"/opt/nvidia/hpc_sdk/Linux_x86_64/*/compilers/bin/nvc"))[-1]
        print("nvc:", NVC, f"({(time.time() - t0) / 60:.0f} min)")
        sh(f"{sys.executable} -m pip install -q 'numpy>=2.0' cython 'meson>=1.4' meson-python ninja pybind11")
        src = WORK / "anuga_core"
        if not src.exists():
            sh(f"git clone --depth 1 --branch {ANUGA_TAG} https://github.com/anuga-community/anuga_core.git {src}")
        out = WHEELS / KEY
        out.mkdir(parents=True, exist_ok=True)
        sh(f"cd {src} && rm -rf build && CC={NVC} CFLAGS=-tp=haswell {sys.executable} -m pip wheel --no-build-isolation "
           f"--no-deps -w {out} -Csetup-args=-Dgpu_offload=true -Csetup-args=-Dgpu_arch={GPU_ARCH} .")
        lib = pathlib.Path(sorted(glob.glob("/opt/nvidia/hpc_sdk/Linux_x86_64/*/REDIST/compilers/lib"))[-1])
        sh(f"tar -C {lib} -czf {out}/nvhpc-redist.tar.gz .")
        cached = sorted(out.glob("anuga-*.whl"))[0]
        print(f"built + cached {cached} in {(time.time() - t0) / 60:.0f} min")
    else:
        print("using cached wheel", cached)
    REDIST.mkdir(parents=True, exist_ok=True)
    sh(f"tar -C {REDIST} -xzf {cached.parent}/nvhpc-redist.tar.gz")
    sh(f"{sys.executable} -m pip install -q --force-reinstall --no-deps {cached}")
    sh(f"{sys.executable} -m pip install -q scipy matplotlib netCDF4 dill meshpy pymetis xarray rasterio shapely pyproj")
    RUN_ENV["LD_LIBRARY_PATH"] = f"{REDIST}:" + RUN_ENV.get("LD_LIBRARY_PATH", "")
    RUN_ENV["OMP_NUM_THREADS"] = "1"
    chk = subprocess.run([sys.executable, "-c", "import anuga; print(anuga.__version__, anuga.gpu_offload_supported())"],
                         env=RUN_ENV, capture_output=True, text=True)
    print(chk.stdout, chk.stderr[-2000:])
    assert chk.stdout.strip().endswith("True"), "anuga.gpu_offload_supported() is False: GPU build failed (use MODE='cpu')"
else:
    sh(f"{sys.executable} -m pip install -q anuga=={ANUGA_TAG} rasterio shapely pyproj")
""")

md("## (c) Packages and the runner\n\nThe runner below is `pipeline/v2/anuga_run.py`, embedded verbatim.")
cells.append(nbf.v4.new_code_cell("%%writefile anuga_run.py\n" + RUNNER))
code("""
PKGS = WORK / "packages"
PKGS.mkdir(exist_ok=True)
# Packages may arrive zipped (<dam>.zip) or already extracted: Kaggle unzips uploaded archives in
# datasets, and its mount path can differ (/kaggle/input/<slug>/ or deeper), so search recursively.
roots = [PKG_SRC] + ([pathlib.Path("/kaggle/input")] if ON_KAGGLE else [])
roots = [r for r in roots if r.exists()]
for r in roots:
    for z in sorted(r.rglob("*.zip")):
        if not (PKGS / z.stem / "domain.json").exists():
            with zipfile.ZipFile(z) as zf:
                if any(n.endswith("/scenarios.json") for n in zf.namelist()):
                    zf.extractall(PKGS)
    for sj in sorted(r.rglob("scenarios.json")):
        d = sj.parent
        if (d / "domain.json").exists() and not (PKGS / d.name / "domain.json").exists():
            shutil.copytree(d, PKGS / d.name, dirs_exist_ok=True)   # read-only input → writable copy
DAMS = sorted(p.parent.name for p in PKGS.glob("*/scenarios.json"))
if not DAMS:
    raise SystemExit(
        "No dam packages found. Looked for <dam>.zip or <dam>/scenarios.json under: "
        + ", ".join(map(str, roots or [PKG_SRC]))
        + ". On Kaggle: Add data → attach the dataset with the zips; on Colab: put them in MyDrive/dwr_anuga/packages/."
    )
print("dams found:", DAMS)
ALL = [(d, s) for d in DAMS for s in json.loads((PKGS / d / "scenarios.json").read_text())["scenarios"]]
for d, s in ALL:
    print(f"{d:20s} {s['id']:16s} V={s['volume_m3'] / 1e6:5g} Mm³  ≤{s['max_area_m2']:6g} m²  ~{s['est_triangles']:7d} tri  "
          f"~{s['est_cpu_h']:5.1f} h CPU (est.)  {s['finaltime_h']:g} h simulated")
""")

md("""
### Split helper (Colab vs Kaggle)

Greedy split by estimated cost (triangles × simulated time / √area, weighted up for larger volumes, which wet more of
the domain): Kaggle (12 h sessions, 2 GPUs) gets the largest runs, Colab the rest. Copy a printed list into `SHARD`.
""")
code("""
def cost(s):
    import math
    return s["est_cpu_h"] * (1 + 0.3 * math.log10(max(s["volume_m3"], 5e6) / 5e6))

def suggest_split(share_kaggle=0.6):
    items = sorted(ALL, key=lambda x: -cost(x[1]))
    tot = sum(cost(s) for _, s in items)
    kag, col, ck = [], [], 0.0
    for d, s in items:
        if ck < share_kaggle * tot:
            kag.append((d, s["id"])); ck += cost(s)
        else:
            col.append((d, s["id"]))
    print(f"KAGGLE ({ck / tot * 100:.0f} % of est. cost):", kag)
    print(f"COLAB  ({100 - ck / tot * 100:.0f} %):", col)
    return kag, col

KAGGLE_SHARD, COLAB_SHARD = suggest_split()
""")

md("""
## (d) CPU-vs-GPU consistency test (small mesh, 1 h simulated)

Same package, same coarse mesh, `legacy` (CPU) vs the selected `MODE`. Pass = wet area and water volume within 2 %.
A failure stops the notebook: do not trust GPU results then; use `MODE = "cpu"`.
""")
code("""
def run_one(dam, sid, mode, out, extra=(), gpu_id=None):
    env = dict(RUN_ENV)
    if gpu_id is not None:
        env["CUDA_VISIBLE_DEVICES"] = str(gpu_id)
    cmd = [sys.executable, "anuga_run.py", "--package", str(PKGS / dam), "--scenario", sid, "--mode", mode,
           "--out", str(out), *extra]
    out = pathlib.Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)   # the log sits next to the run folder
    with open(out.with_suffix(".log"), "w") as log:
        p = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in p.stdout:
            log.write(line)
            if line.startswith(("  t =", "mesh:", "scenario", "E1", "E3", "done", "Traceback", "RuntimeError")):
                print(f"[{dam}/{sid}/{mode}] {line.rstrip()}", flush=True)
        return p.wait()

if MODE != "legacy" and not SKIP_CONSISTENCY_TEST:
    d0 = DAMS[0]
    res = {}
    for m in ("legacy", MODE):
        o = WORK / "selftest" / m
        shutil.rmtree(o, ignore_errors=True)
        rc = run_one(d0, "selftest", m, o, ["--volume-m3", "5e6", "--max-area", "40000", "--finaltime-h", "1"])
        assert rc == 0, f"self-test {m} failed (see {o}.log)"
        res[m] = (json.loads((o / "stats.json").read_text())["inundated_km2"],
                  json.loads((o / "run.json").read_text())["final_volume_m3"],
                  json.loads((o / "run.json").read_text()).get("gpu_offload"))
    (a_w, a_v, _), (b_w, b_v, off) = res["legacy"], res[MODE]
    dw, dv = abs(b_w - a_w) / max(a_w, 1e-9), abs(b_v - a_v) / max(a_v, 1e-9)
    print(f"legacy: wet {a_w} km², volume {a_v:.0f} m³ | {MODE}: wet {b_w} km², volume {b_v:.0f} m³, gpu_offload={off}")
    print(f"relative difference: wet {dw * 100:.2f} %, volume {dv * 100:.3f} %")
    assert dw < 0.02 and dv < 0.02, "CPU vs GPU consistency test FAILED: do not use GPU results; set MODE = 'cpu'"
    print("consistency test passed")
""")

md("## (e) Run the shard (resume-if-done) and (f) zip each run to the results folder")
code("""
todo = ALL if SHARD == "all" else [(d, s) for d, s in ALL if (d, s["id"]) in set(map(tuple, SHARD))]

def done(dam, sc):
    rj = RESULTS / dam / sc["id"] / "run.json"
    if not rj.exists():
        return False
    m = json.loads(rj.read_text())
    return m.get("simulated_s", 0) >= sc["finaltime_h"] * 3600 - 1 and (RESULTS / dam / sc["id"] / f"{dam}__{sc['id']}.zip").exists()

def job(dam, sc, gpu_id=None):
    out = WORK / "runs" / dam / sc["id"]
    shutil.rmtree(out, ignore_errors=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    rc = run_one(dam, sc["id"], MODE, out, gpu_id=gpu_id)
    dst = RESULTS / dam / sc["id"]
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copy(out.with_suffix(".log"), dst / "run.log")
    if rc != 0:
        print(f"!! {dam}/{sc['id']} failed (rc {rc}), log in {dst / 'run.log'}")
        return
    zp = dst / f"{dam}__{sc['id']}.zip"
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in out.iterdir():
            if f.suffix != ".msh":
                zf.write(f, f"{dam}/{sc['id']}/{f.name}")
    for f in ("run.json", "tests.json", "stats.json"):
        shutil.copy(out / f, dst / f)
    print(f"== {dam}/{sc['id']} done in {(time.time() - t0) / 60:.1f} min -> {zp} ({zp.stat().st_size / 1e6:.1f} MB)")

pending = [(d, s) for d, s in todo if not done(d, s)]
print(f"{len(todo)} runs in shard, {len(todo) - len(pending)} already done, {len(pending)} to run")
ngpu = len(GPUS) if (MODE == "gpu" and PARALLEL_GPUS) else 1
if ngpu > 1:
    from concurrent.futures import ThreadPoolExecutor
    import queue
    slots = queue.Queue()
    for g in range(ngpu):
        slots.put(g)
    def worker(item):
        g = slots.get()
        try:
            job(*item, gpu_id=g)
        finally:
            slots.put(g)
    with ThreadPoolExecutor(ngpu) as ex:
        list(ex.map(worker, pending))
else:
    for i, (d, s) in enumerate(pending, 1):
        print(f"--- [{i}/{len(pending)}] {d} / {s['id']} (est. {s['est_triangles']} triangles)")
        job(d, s)
""")

md("""
## Summary and download

Each run folder holds `<dam>__<scenario>.zip` + `run.json` / `tests.json` / `stats.json`. Bring the zips back and run
locally: `python pipeline/v2/anuga_ingest.py --results <colab results dir> <kaggle results dir>`. The ingest merges both,
reports missing or duplicated runs and computes the E4 mesh-sensitivity comparison. On Kaggle, also download
`/kaggle/working/wheels/` once and re-upload it as the `dwr-anuga-wheel` dataset.
""")
code("""
rows = []
for rj in sorted(RESULTS.glob("*/*/run.json")):
    m = json.loads(rj.read_text())
    t = json.loads((rj.parent / "tests.json").read_text()) if (rj.parent / "tests.json").exists() else {}
    rows.append((m["dam_id"], m["id"], m.get("mode"), m.get("gpu_offload"), m["triangles"], round(m["wall_s"] / 60, 1),
                 t.get("E1", {}).get("passed"), t.get("E2", {}).get("passed"), t.get("E3", {}).get("passed"),
                 t.get("E7", {}).get("passed")))
print("dam | scenario | mode | gpu_offload | triangles | wall min | E1 | E2 | E3 | E7")
for r in rows:
    print(" | ".join(map(str, r)))
if ON_KAGGLE:
    shutil.make_archive("/kaggle/working/results_all", "zip", RESULTS)
    print("download /kaggle/working/results_all.zip from the Output tab")
""")

nb = nbf.v4.new_notebook(cells=cells, metadata={
    "kernelspec": {"name": "python3", "display_name": "Python 3"},
    "accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"}})
out = ROOT / "colab/anuga_gpu_all_dams.ipynb"
nbf.validate(nb)
out.write_text(nbf.writes(nb), "utf-8")
print(f"wrote {out} ({len(cells)} cells)")
