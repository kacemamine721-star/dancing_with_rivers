"""Shared pipeline helpers.

Importing this package first neutralises foreign PROJ/GDAL data folders (PostGIS, QGIS…) that break
rasterio/pyproj on Windows, then exposes config, paths and the .env loader. NISAR/S1 readers live in
`pipeline.common.nisar_io` (the proven functions from TESTS/mellegue_test.py).
"""
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):  # Windows consoles/redirects default to cp1252 and choke on "→", "²", "−"
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

for _k in ("PROJ_LIB", "PROJ_DATA", "GDAL_DATA"):
    if _k in os.environ and re.search(r"postg|qgis|osgeo|arcgis", os.environ[_k], re.I):
        os.environ.pop(_k)

from pathlib import Path  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def load_env(path: Path | None = None) -> None:
    """Load KEY=VALUE lines from the repo .env into os.environ (never overrides, never prints)."""
    p = path or ROOT / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_config(path: Path | None = None) -> dict:
    import yaml

    return yaml.safe_load((path or ROOT / "config.yaml").read_text(encoding="utf-8"))


def bundle_dir(cfg: dict) -> Path:
    return ROOT / cfg["bundle"]["out"]
