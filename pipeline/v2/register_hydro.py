#!/usr/bin/env python
"""Register the hydro layers (route_hand.py → work/v2/<id>/hydro_layers.json) in a V2 dam bundle's manifest.

Usage: python pipeline/v2/register_hydro.py sidi-salem el-aroussia ouldjet-mellegue

Layers are merged by id (hydro entries replace older ones with the same id), the manifest is re-validated
against the pydantic contract, then the whole bundle is validated with 08_bundle.validate.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
import common  # noqa: E402,F401  (PROJ guard)
from common import contracts as C  # noqa: E402

spec = importlib.util.spec_from_file_location("bundle08", ROOT / "pipeline" / "08_bundle.py")
B08 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B08)


def register(dam: str) -> int:
    out = ROOT / "apps" / "web" / "public" / "data" / "v2" / dam
    hl = json.loads((ROOT / "work" / "v2" / dam / "hydro_layers.json").read_text(encoding="utf-8"))
    m = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    new = {l["id"]: l for l in hl["layers"]}
    missing = [l["file"] for l in new.values() if not (out / l["file"]).exists()]
    if missing:
        print(f"[{dam}] missing files, not registered: {missing}")
        return 1
    m["layers"] = [l for l in m["layers"] if l["id"] not in new] + list(new.values())
    B08.write_json(out / "manifest.json", C.Manifest.model_validate(m), force=True)
    n_err = B08.validate(out)
    print(f"[{dam}] {len(new)} hydro layers registered ({', '.join(new)}); validation errors: {n_err}")
    return n_err


if __name__ == "__main__":
    sys.exit(max((register(d) for d in sys.argv[1:]), default=0))
